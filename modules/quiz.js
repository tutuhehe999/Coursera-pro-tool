/**
 * Coursera Pro Tool - Auto Quiz Module
 * Uses Gemini AI to automatically:
 * 1. Enter quiz attempt from outside assignment page (Resume / Start)
 * 2. Solve all quiz questions using Gemini AI
 * 3. Auto-submit the quiz attempt
 * 4. Automatically exit back to the overview page!
 */

import {
  waitForSelector,
  sleep,
  safeClick,
  addBadge,
  simulateInput,
  simulateTyping,
  extendStringPrototype,
  decodeHtml,
  cleanText,
  wordOverlapRatio,
  getBlacklistedAnswersForQuestion,
  isAnswerBlacklisted,
  selectOptionElement,
} from '../utils/dom.js';
import { generateQuizAnswers, generateContent, getAISettings } from '../utils/ai.js';
import { showToast, updateProgress } from '../ui/panel.js';
import { getMetadata, extractItemId } from '../utils/metadata.js';
import { apiInitiateAttempt } from '../utils/coursera-api.js';

const STORAGE_KEY_QUIZ = 'cpt_auto_quiz';

/**
 * Extract label text associated with an input element
 * @param {HTMLInputElement} input
 * @returns {string}
 */
function extractOptionLabel(input) {
  // 1. Closest <label>
  const label = input.closest('label');
  if (label) {
    const clone = label.cloneNode(true);
    clone.querySelectorAll('input, .cpt-badge, svg, [aria-hidden="true"], .sr-only, .rc-FormPartsQuestion__error, .rc-FormPartsQuestion__success, [data-testid*="feedback"]').forEach((i) => i.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }

  // 2. <label for="...">
  if (input.id) {
    const forLabel = document.querySelector(`label[for="${input.id}"]`);
    if (forLabel) {
      const clone = forLabel.cloneNode(true);
      clone.querySelectorAll('input, .cpt-badge, svg, [aria-hidden="true"], .sr-only, .rc-FormPartsQuestion__error, .rc-FormPartsQuestion__success, [data-testid*="feedback"]').forEach((i) => i.remove());
      const text = clone.textContent?.trim();
      if (text) return text;
    }
  }

  // 3. Parent element
  const parent = input.parentElement;
  if (parent) {
    const clone = parent.cloneNode(true);
    clone.querySelectorAll('input, .cpt-badge, svg, [aria-hidden="true"], .sr-only, .rc-FormPartsQuestion__error, .rc-FormPartsQuestion__success, [data-testid*="feedback"]').forEach((i) => i.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }

  return input.nextSibling?.textContent?.trim() || input.value || '';
}

/**
 * Extract course slug from current URL
 * @returns {string} e.g. "research-methodologies"
 */
export function getCurrentCourseSlug() {
  const match = location.pathname.match(/\/learn\/([^/]+)/);
  return match ? match[1].toLowerCase() : 'general_course';
}

/**
 * Storage key prefix for course source
 */
const SOURCE_KEY_PREFIX = 'cpt_local_source_';

/**
 * Load all stored Q&A pairs for a course
 * @param {string} [courseSlug]
 * @returns {Promise<Array<{prompt: string, cleanPrompt: string, answer: string, options: string[], timestamp: number}>>}
 */
export async function loadCourseSource(courseSlug = '') {
  const slug = courseSlug || getCurrentCourseSlug();
  const key = `${SOURCE_KEY_PREFIX}${slug}`;
  const data = await chrome.storage.local.get([key]);
  return Array.isArray(data[key]) ? data[key] : [];
}

/**
 * Save new Q&A pairs into course source, merging duplicates
 * @param {string} courseSlug
 * @param {Array<{prompt: string, answer: string, options?: string[]}>} newPairs
 * @returns {Promise<number>} Total items in source
 */
export async function saveToCourseSource(courseSlug, newPairs) {
  if (!newPairs || newPairs.length === 0) return 0;
  const slug = courseSlug || getCurrentCourseSlug();
  const key = `${SOURCE_KEY_PREFIX}${slug}`;

  const existing = await loadCourseSource(slug);
  const existingMap = new Map();

  for (const item of existing) {
    const cp = item.cleanPrompt || cleanText(item.prompt);
    if (cp) existingMap.set(cp, item);
  }

  let addedCount = 0;
  for (const pair of newPairs) {
    if (!pair.prompt || !pair.answer) continue;
    const cp = cleanText(pair.prompt);
    if (!cp) continue;

    const newItem = {
      prompt: pair.prompt.trim(),
      cleanPrompt: cp,
      answer: pair.answer.trim(),
      options: Array.isArray(pair.options) ? pair.options : [],
      timestamp: Date.now(),
    };

    if (!existingMap.has(cp) || existingMap.get(cp).answer !== newItem.answer) {
      existingMap.set(cp, newItem);
      addedCount++;
    }
  }

  const updatedList = Array.from(existingMap.values());
  await chrome.storage.local.set({ [key]: updatedList });
  console.log(`[CourseraPro] Local Source [${slug}]: saved ${addedCount} new items, total ${updatedList.length} items`);
  return updatedList.length;
}

const BLACKLIST_PREFIX = 'cpt_quiz_blacklist_';

/**
 * Load incorrect answers blacklist for Smart Retake
 * @param {string} [courseSlug]
 * @returns {Promise<Record<string, string[]>>}
 */
export async function loadQuizBlacklist(courseSlug = '') {
  const slug = courseSlug || getCurrentCourseSlug();
  const key = `${BLACKLIST_PREFIX}${slug}`;
  const data = await chrome.storage.local.get([key]);
  return data[key] && typeof data[key] === 'object' ? data[key] : {};
}

/**
 * Save incorrect answers blacklist for Smart Retake
 * @param {string} courseSlug
 * @param {Record<string, string[]>} blacklistMap
 */
export async function saveQuizBlacklist(courseSlug, blacklistMap) {
  const slug = courseSlug || getCurrentCourseSlug();
  const key = `${BLACKLIST_PREFIX}${slug}`;
  await chrome.storage.local.set({ [key]: blacklistMap });
}

/**
 * Purge blacklisted incorrect answers from local course source to prevent retake cache poisoning
 * @param {string} courseSlug
 * @param {Record<string, string[]>} blacklistMap
 * @returns {Promise<number>} Number of bad items purged
 */
export async function purgeWrongAnswersFromSource(courseSlug, blacklistMap) {
  if (!blacklistMap || Object.keys(blacklistMap).length === 0) return 0;
  const slug = courseSlug || getCurrentCourseSlug();
  const key = `${SOURCE_KEY_PREFIX}${slug}`;
  const existing = await loadCourseSource(slug);
  if (!existing || existing.length === 0) return 0;

  let purgedCount = 0;
  const cleanedSource = existing.filter((item) => {
    const p = item.cleanPrompt || item.prompt;
    const badAnswers = getBlacklistedAnswersForQuestion(p, blacklistMap);
    if (badAnswers.length === 0) return true;

    const isBad = isAnswerBlacklisted(item.answer, badAnswers);

    if (isBad) {
      console.log(`[CourseraPro Smart Retake] Purging poisoned cache from Source [${slug}]: "${item.prompt}" -> "${item.answer}"`);
      purgedCount++;
      return false;
    }
    return true;
  });

  if (purgedCount > 0) {
    await chrome.storage.local.set({ [key]: cleanedSource });
    console.log(`[CourseraPro Smart Retake] Cleaned ${purgedCount} poisoned items from Local Source.`);
  }
  return purgedCount;
}

/**
 * Extract clean option text from a feedback review element, stripping out feedback banners, errors, and badges
 * @param {Element} element
 * @returns {string}
 */
function extractCleanFeedbackOptionLabel(element) {
  if (!element) return '';
  const clone = element.cloneNode(true);
  clone.querySelectorAll(
    'input, .cpt-badge, svg, [aria-hidden="true"], .sr-only, ' +
    '.rc-FormPartsQuestion__error, .rc-FormPartsQuestion__success, ' +
    '[data-testid*="feedback" i], [class*="feedback" i], [class*="Feedback" i], ' +
    '[class*="callout" i], [class*="Callout" i], [role="alert"], [class*="css-1m4z3k7"]'
  ).forEach((el) => el.remove());

  let raw = clone.textContent?.trim() || '';
  // Split on feedback markers that Coursera attaches
  raw = raw.split(/\b(?:try\s+again|this\s+should\s+not\s+be\s+selected|this\s+should\s+be\s+selected|incorrect|correct|sai|đúng)\b/i)[0].trim();
  return raw;
}

/**
 * Scan post-quiz review / results page, record wrong answers to blacklist and correct answers to Source
 * @returns {Promise<{wrongRecorded: number, correctRecorded: number}>}
 */
export async function recordQuizReviewFeedback() {
  const courseSlug = getCurrentCourseSlug();
  const blacklist = await loadQuizBlacklist(courseSlug);
  const correctToSave = [];
  let wrongRecorded = 0;
  let correctRecorded = 0;

  const questionBlocks = document.querySelectorAll(
    '.rc-FormPartsQuestion, fieldset, [data-testid*="question" i], [class*="QuizQuestion" i], [class*="FormPartsQuestion" i], [class*="QuestionPart" i]'
  );

  questionBlocks.forEach((block) => {
    // Isolate prompt text safely without truncating
    let promptText = '';
    const promptEl = block.querySelector(
      'legend, .rc-FormPartsQuestion__title, [data-testid*="prompt" i], .rc-CML, [class*="Prompt"], [class*="title"], h2, h3, h4'
    );
    if (promptEl) {
      promptText = promptEl.textContent?.trim() || '';
    }
    if (!promptText) {
      try {
        const clone = block.cloneNode(true);
        clone.querySelectorAll('input, label, [role="radio"], [role="checkbox"], .cpt-badge, svg, .rc-FormPartsQuestion__error, .rc-FormPartsQuestion__success, [data-testid*="feedback"]').forEach((el) => el.remove());
        promptText = clone.textContent?.trim() || '';
      } catch (_e) {
        promptText = block.innerText || block.textContent || '';
      }
    }
    promptText = promptText
      .split(/\b(?:try\s+again|this\s+should\s+not\s+be\s+selected|incorrect|correct|sai|đúng)\b/i)[0]
      .replace(/\b\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*(?:points?|pts?|điểm)?\b/gi, '')
      .replace(/\b\d+(?:\.\d+)?\s*(?:points?|pts?|điểm)\b/gi, '')
      .replace(/^\s*(?:question\s*\d+[\s:.-]*|\d+[.):]\s+)/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    const rawPrompt = promptText;
    const cp = cleanText(rawPrompt);
    if (!cp) return;

    const blockText = block.innerText || block.textContent || '';

    // Error & Success evaluation
    let isError = false;
    let isSuccess = false;

    // Check points e.g. "0/1 point", "0/2 points", "1/1 point", "2/2 points", "0/3 points"
    const scoreMatch = blockText.match(/\b(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(?:points?|điểm)?/i);
    if (scoreMatch) {
      const earned = parseFloat(scoreMatch[1]);
      const total = parseFloat(scoreMatch[2]);
      if (total > 0) {
        if (earned === total) {
          isSuccess = true;
        } else if (earned < total) {
          isError = true;
        }
      }
    }

    if (
      block.querySelector('.rc-FormPartsQuestion__error, [data-testid="test-feedback-incorrect"], [aria-label*="Incorrect" i], .css-1m4z3k7') ||
      /\b(?:try\s+again|this\s+should\s+not\s+be\s+selected|incorrect|sai|0\s*điểm)\b/i.test(blockText)
    ) {
      isError = true;
      isSuccess = false;
    }

    if (!isError && (
      block.querySelector('.rc-FormPartsQuestion__success, [data-testid="test-feedback-correct"], [aria-label*="Correct" i]') ||
      /\b(?:correct|đúng|100%)\b/i.test(blockText)
    )) {
      isSuccess = true;
    }

    // 1. Check individual option items for explicit "This should not be selected" or "This should be selected"
    const optionContainers = block.querySelectorAll('.rc-Option, [class*="option" i], label, .rc-FormPartsOption');
    optionContainers.forEach((container) => {
      const cText = container.innerText || container.textContent || '';
      if (/\b(?:this\s+should\s+not\s+be\s+selected|should\s+not\s+be\s+selected)\b/i.test(cText)) {
        const cleanOpt = cleanText(extractCleanFeedbackOptionLabel(container));
        if (cleanOpt) {
          if (!blacklist[cp]) blacklist[cp] = [];
          if (!blacklist[cp].includes(cleanOpt)) {
            blacklist[cp].push(cleanOpt);
            wrongRecorded++;
          }
        }
      } else if (/\b(?:this\s+should\s+be\s+selected|should\s+be\s+selected)\b/i.test(cText)) {
        const cleanOpt = cleanText(extractCleanFeedbackOptionLabel(container));
        if (cleanOpt) {
          correctToSave.push({ prompt: rawPrompt, answer: cleanOpt });
          correctRecorded++;
        }
      }
    });

    // 2. Extract selected/checked answers from inputs and option wrappers
    const selectedOptionsText = [];
    const checkedInputs = block.querySelectorAll('input:checked, [aria-checked="true"]');
    if (checkedInputs && checkedInputs.length > 0) {
      checkedInputs.forEach(inp => {
        const label = inp.closest('label') || inp.parentElement || inp;
        const txt = extractCleanFeedbackOptionLabel(label) || extractOptionLabel(inp);
        if (txt) selectedOptionsText.push(txt);
      });
    } else {
      // Fallback for read-only review pages where inputs might be disabled or rendered without input tags
      for (const container of optionContainers) {
        const isSelected = 
          container.className.includes('selected') || 
          container.className.includes('checked') ||
          container.querySelector('.rc-FormPartsQuestion__error, .rc-FormPartsQuestion__success, [data-testid*="feedback"]') ||
          container.querySelector('svg[aria-label*="Selected" i], svg[aria-label*="Checked" i]') ||
          (container.nextElementSibling && container.nextElementSibling.className && container.nextElementSibling.className.includes('error'));
          
        if (isSelected) {
          const txt = extractCleanFeedbackOptionLabel(container);
          if (txt) selectedOptionsText.push(txt);
        }
      }
    }
    
    const cleanCheckedList = selectedOptionsText.map(t => cleanText(t)).filter(Boolean);

    cleanCheckedList.forEach(cleanChecked => {
      if (isError) {
        if (!blacklist[cp]) blacklist[cp] = [];
        if (!blacklist[cp].includes(cleanChecked)) {
          blacklist[cp].push(cleanChecked);
          wrongRecorded++;
        }
      } else if (isSuccess) {
        correctToSave.push({
          prompt: rawPrompt,
          answer: cleanChecked,
        });
        correctRecorded++;
      }
    });
  });

  if (wrongRecorded > 0) {
    await saveQuizBlacklist(courseSlug, blacklist);
    // Purge poisoned wrong answers from local source cache so retake never picks old wrong answers!
    await purgeWrongAnswersFromSource(courseSlug, blacklist);
  }

  if (correctToSave.length > 0) {
    await saveToCourseSource(courseSlug, correctToSave);
  }

  if (wrongRecorded > 0 || correctRecorded > 0) {
    showToast(`🎯 Smart Retake: Đã nạp ${correctRecorded} câu đúng vào Source và chặn ${wrongRecorded} câu sai!`, 'success');
  }

  return { wrongRecorded, correctRecorded };
}

/**
 * Match a question against the local course source
 * Verifies that matched answer exists in question options to prevent false positives,
 * and confirms answer is not in the Smart Retake blacklist.
 * @param {object} question - { prompt, options }
 * @param {Array<object>} sourceList
 * @param {Record<string, string[]>} [blacklist={}]
 * @returns {object|null} matched source item
 */
function findAnswerInSource(question, sourceList, blacklist = {}) {
  if (!question || !sourceList || sourceList.length === 0) return null;
  const cleanQ = cleanText(question.prompt);
  if (!cleanQ) return null;

  const hasOptions = Array.isArray(question.options) && question.options.length > 0;
  const badAnswers = getBlacklistedAnswersForQuestion(question.prompt, blacklist);

  // Helper to verify if source answer exists in question options and is NOT blacklisted
  const matchesAnyOption = (ans) => {
    if (isAnswerBlacklisted(ans, badAnswers)) return false; // Strictly rejected by Smart Retake blacklist!
    if (!hasOptions) return true;
    const cleanA = cleanText(ans);
    return question.options.some((opt) => {
      const cOpt = cleanText(opt);
      return cOpt === cleanA || (cOpt.length >= 4 && (cOpt.includes(cleanA) || cleanA.includes(cOpt)));
    });
  };

  // 1. Exact clean match
  for (const item of sourceList) {
    const cp = item.cleanPrompt || cleanText(item.prompt);
    if (cp && cp === cleanQ) {
      if (matchesAnyOption(item.answer)) return item;
    }
  }

  // 2. High-overlap match (length ratio >= 0.75 and substring match)
  for (const item of sourceList) {
    const cp = item.cleanPrompt || cleanText(item.prompt);
    if (cleanQ.length >= 25 && cp.length >= 25) {
      const ratio = Math.min(cleanQ.length, cp.length) / Math.max(cleanQ.length, cp.length);
      if (ratio >= 0.75 && (cleanQ.includes(cp) || cp.includes(cleanQ))) {
        if (matchesAnyOption(item.answer)) return item;
      }
    }
  }

  // 3. Word overlap ratio match >= 0.65
  for (const item of sourceList) {
    const cp = item.cleanPrompt || cleanText(item.prompt);
    if (cp && wordOverlapRatio(cleanQ, cp) >= 0.65) {
      if (matchesAnyOption(item.answer)) return item;
    }
  }

  return null;
}

/**
 * Find question container element for an input
 * @param {HTMLInputElement} inp
 * @returns {Element|null}
 */
function findQuestionContainer(inp) {
  return (
    inp.closest('fieldset') ||
    inp.closest('.rc-FormPartsQuestion, [class*="Question"], [class*="question"]') ||
    inp.closest('[data-testid*="question" i]') ||
    inp.closest('[role="radiogroup"]') ||
    inp.closest('[role="group"]') ||
    inp.closest('.rc-QuizQuestion') ||
    inp.closest('.c-question') ||
    inp.closest('form') ||
    inp.parentElement?.parentElement
  );
}

/**
 * Universal question finder that works on modern Coursera assessment layouts
 * @returns {Array<object>}
 */
function discoverQuestions() {
  extendStringPrototype();
  const questions = [];

  // Exclude floating panel elements and non-question agreement checkboxes
  const allInputs = Array.from(
    document.querySelectorAll('input[type="radio"], input[type="checkbox"]')
  ).filter((el) => {
    if (el.closest('#cpt-panel')) return false;

    // Filter out honor code agreements
    const honorContainer = el.closest('[data-testid*="honor" i], .rc-HonorCode, .honor-code-checkbox, [class*="HonorCode"]');
    if (honorContainer) return false;

    const labelText = extractOptionLabel(el).toLowerCase();
    if (
      labelText.includes('honor code') ||
      labelText.includes('submitting work that is my own') ||
      labelText.includes('cam đoan') ||
      labelText.includes('chính trực') ||
      labelText.includes('i agree to the coursera honor code') ||
      labelText.includes('i understand that submitting work')
    ) {
      return false;
    }
    return true;
  });

  if (allInputs.length > 0) {
    const groupsByName = new Map();

    for (const inp of allInputs) {
      // Group by question container, or radio name attribute
      const container = findQuestionContainer(inp);
      const key = (inp.type === 'radio' && inp.name) ? inp.name : (container || inp);
      if (!groupsByName.has(key)) {
        groupsByName.set(key, { container, inputs: [] });
      }
      groupsByName.get(key).inputs.push(inp);
    }

    let qIndex = 1;
    for (const { container, inputs } of groupsByName.values()) {
      if (!inputs || inputs.length === 0) continue;

      // Extract options
      const options = inputs.map((inp) => ({
        input: inp,
        text: extractOptionLabel(inp),
      }));

      // Determine parent question block
      const questionBlock = container || inputs[0].parentElement?.parentElement;

      // Isolate prompt text safely without truncating
      let promptText = '';
      if (questionBlock) {
        // Priority 1: Check dedicated question prompt elements
        const promptEl = questionBlock.querySelector(
          'legend, .rc-FormPartsQuestion__title, [data-testid*="prompt" i], .rc-CML, [class*="Prompt"], [class*="title"], h2, h3, h4'
        );
        if (promptEl) {
          promptText = promptEl.textContent?.trim() || '';
        }

        // Include any instruction / help / legend element (e.g. "Select two.", "Select all that apply")
        const instructionEl = questionBlock.querySelector(
          '.rc-FormPartsQuestion__help, .rc-FormPartsQuestion__description, .rc-FormPartsQuestion__legend, [class*="instruction" i], [class*="subtitle" i], [class*="help" i]'
        );
        if (instructionEl && instructionEl !== promptEl) {
          const instText = instructionEl.textContent?.trim();
          if (instText && !promptText.toLowerCase().includes(instText.toLowerCase())) {
            promptText += ` (${instText})`;
          }
        }

        // Priority 2: Clone container and remove inputs/labels to isolate prompt
        if (!promptText) {
          try {
            const clone = questionBlock.cloneNode(true);
            clone.querySelectorAll('input, label, [role="radio"], [role="checkbox"], .cpt-badge, svg').forEach((el) => el.remove());
            promptText = clone.textContent?.trim() || '';
          } catch (_e) {
            promptText = questionBlock.innerText || questionBlock.textContent || '';
          }
        }

        // If checkboxes and instruction not yet in prompt, check container text
        if (!promptText.toLowerCase().includes('select') && questionBlock) {
          const containerText = questionBlock.innerText || questionBlock.textContent || '';
          const matchInstruction = containerText.match(/\((?:select|choose)\s+[^)]+\)/i) ||
                                  containerText.match(/\b(?:select|choose)\s+(?:all|two|three|four|five|\d+)[^.\n]*/i);
          if (matchInstruction && !promptText.toLowerCase().includes(matchInstruction[0].toLowerCase())) {
            promptText += ` (${matchInstruction[0]})`;
          }
        }

        // Clean point labels and index numbers
        promptText = promptText
          .replace(/\b\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*(?:points?|pts?|điểm)?\b/gi, '')
          .replace(/\b\d+(?:\.\d+)?\s*(?:points?|pts?|điểm)\b/gi, '')
          .replace(/^\s*(?:question\s*\d+[\s:.-]*|\d+[.):]\s+)/i, '')
          .replace(/\s+/g, ' ')
          .trim();
      }

      if (!promptText) {
        promptText = `Question ${qIndex}`;
      }

      questions.push({
        type: inputs[0].type || 'radio',
        prompt: promptText,
        options: options.map((o) => o.text).filter(Boolean),
        optionItems: options,
        container: questionBlock,
      });

      qIndex++;
    }

    if (questions.length > 0) {
      return questions;
    }
  }

  // Strategy 2: Check text inputs (short answer / number / rich text)
  let textInputsRaw = Array.from(
    document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], .ql-editor, .DraftEditor-root')
  );

  const textInputs = [];
  for (const el of textInputsRaw) {
    if (el.closest('#cpt-panel') || el.type === 'hidden') continue;

    // If it's a DraftEditor root, find the actual contenteditable child
    if (el.classList.contains('DraftEditor-root')) {
      const editable = el.querySelector('[contenteditable="true"]');
      if (editable && !textInputs.includes(editable)) {
        textInputs.push(editable);
      }
      continue; // Skip the root wrapper itself
    }
    
    if (!textInputs.includes(el)) {
      textInputs.push(el);
    }
  }

  for (const inp of textInputs) {
    const container = inp.closest('fieldset, [data-testid*="question" i]') || inp.parentElement?.parentElement;
    const promptText = (container?.innerText || container?.textContent || `Question`)
      .replace(/\b\d+\s*points?\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    questions.push({
      type: 'text',
      prompt: promptText,
      options: [],
      textInputs: [inp],
      container,
    });
  }

  return questions;
}

/**
 * Split multi-select raw answer into component targets
 * @param {string|Array} answerDef
 * @param {number} [maxOptions=5]
 * @returns {string[]}
 */
export function parseMultiSelectParts(answerDef, maxOptions = 5) {
  if (!answerDef) return [];
  if (Array.isArray(answerDef)) {
    return answerDef.flatMap((item) => parseMultiSelectParts(item, maxOptions));
  }
  const text = String(answerDef).trim();
  if (!text) return [];

  const maxLetter = String.fromCharCode(64 + Math.max(5, maxOptions));

  // 1. If text is a letter combination like "B, C", "B and E", "Option B, Option C", "A, B, E", "B|C"
  const isLetterList =
    /^(?:(?:options?|choices?)\s*)?[A-Z](?:\s*(?:[,|;&]|\band\b)\s*(?:(?:options?|choices?)\s*)?[A-Z])*\.?$/i.test(text) ||
    /^(?:[A-Z]\s*)+$/i.test(text);

  if (isLetterList) {
    const regex = new RegExp(`\\b([A-${maxLetter}])\\b`, 'gi');
    const matches = text.match(regex) || [];
    if (matches.length > 0) {
      return Array.from(new Set(matches.map((m) => m.toUpperCase())));
    }
  }

  // 2. If it contains pipes, semicolons, or newlines
  if (text.includes('|') || text.includes('\n') || text.includes(';')) {
    return text.split(/[|\n;]/).map((s) => s.trim()).filter(Boolean);
  }

  // 3. If it's a comma-separated list of items
  if (text.includes(',')) {
    return text.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
  }

  // 4. If it has " and " connecting options
  if (/\s+and\s+/i.test(text) && text.length < 100) {
    return text.split(/\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
  }

  return [text];
}

/**
 * Universal multi-select option resolver
 * Converts any AI response format (letters, comma-separated, pipe-separated, full text, etc.)
 * into precise option indices for checkboxes
 * @param {string|Array} answerDef
 * @param {Array<{input: Element, text: string}>} optionItems
 * @param {string} promptText
 * @param {Array<string>} blacklist
 * @returns {Set<number>} Set of option indices to check
 */
export function resolveMultiSelectOptionIndices(answerDef, optionItems = [], promptText = '', blacklist = []) {
  const matchedIndices = new Set();
  if (!optionItems || optionItems.length === 0) return matchedIndices;

  const isBadOpt = (opt) => isAnswerBlacklisted(opt?.text, blacklist);
  const maxOptions = optionItems.length;
  const maxLetter = String.fromCharCode(64 + Math.max(5, maxOptions));

  // 1. Determine expected count from prompt
  const countMatch = (promptText || '').match(/\b(?:select|choose)\s+(two|three|four|five|six|\d+)\b/i);
  let expectedCount = 0;
  if (countMatch) {
    const wordMap = { two: 2, three: 3, four: 4, five: 5, six: 6 };
    expectedCount = wordMap[countMatch[1].toLowerCase()] || parseInt(countMatch[1], 10) || 0;
  } else if (/\b(?:select\s+all|check\s+all|choose\s+all|all\s+that\s+apply)\b/i.test(promptText)) {
    expectedCount = 2;
  }

  // 2. Parse answerDef into raw parts
  const rawParts = parseMultiSelectParts(answerDef, maxOptions);

  // 3. Match each part
  for (const part of rawParts) {
    if (!part) continue;
    const cleanPart = cleanText(part);

    // Letter matching: e.g. 'A', 'B', 'Option C', 'Choice D', 'E'
    const letterMatch = part.match(/^(?:option\s+|choice\s+)?([a-z])$/i);
    if (letterMatch) {
      const idx = letterMatch[1].toLowerCase().charCodeAt(0) - 97;
      if (idx >= 0 && idx < optionItems.length && !isBadOpt(optionItems[idx])) {
        matchedIndices.add(idx);
        continue;
      }
    }

    // Direct exact match
    let exactMatched = false;
    for (let i = 0; i < optionItems.length; i++) {
      const opt = optionItems[i];
      if (isBadOpt(opt)) continue;
      if (cleanText(opt.text) === cleanPart) {
        matchedIndices.add(i);
        exactMatched = true;
        break;
      }
    }
    if (exactMatched) continue;

    // Substring / length ratio match with collision protection
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < optionItems.length; i++) {
      const opt = optionItems[i];
      if (isBadOpt(opt)) continue;
      const cOpt = cleanText(opt.text);
      if (cOpt.length >= 4 && cleanPart.length >= 4 && (cOpt.includes(cleanPart) || cleanPart.includes(cOpt))) {
        const score = Math.min(cOpt.length, cleanPart.length) / Math.max(cOpt.length, cleanPart.length);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
    }
    if (bestIdx !== -1 && bestScore >= 0.4) {
      matchedIndices.add(bestIdx);
      continue;
    }

    // Word overlap match
    let bestWordIdx = -1;
    let bestWordScore = 0;
    const partWords = new Set(cleanPart.split(' ').filter((w) => w.length > 2));
    for (let i = 0; i < optionItems.length; i++) {
      const opt = optionItems[i];
      if (isBadOpt(opt)) continue;
      const cOpt = cleanText(opt.text);
      const optWords = cOpt.split(' ').filter((w) => w.length > 2);
      let overlap = 0;
      for (const w of optWords) {
        if (partWords.has(w)) overlap++;
      }
      const score = optWords.length > 0 ? overlap / Math.max(partWords.size, optWords.length) : 0;
      if (score > bestWordScore && score > 0.3) {
        bestWordScore = score;
        bestWordIdx = i;
      }
    }
    if (bestWordIdx !== -1) {
      matchedIndices.add(bestWordIdx);
    }
  }

  // 4. Letter search in full text as fallback:
  if (matchedIndices.size < (expectedCount || 1)) {
    const rawStr = String(answerDef);
    const regex = new RegExp(`\\b(?:option|choice)?\\s*([A-${maxLetter}])\\b`, 'gi');
    let m;
    while ((m = regex.exec(rawStr)) !== null) {
      const idx = m[1].toUpperCase().charCodeAt(0) - 65;
      if (idx >= 0 && idx < optionItems.length && !isBadOpt(optionItems[idx])) {
        matchedIndices.add(idx);
      }
    }
  }

  // 5. Expected count fulfillment: If we have an expected count and matched fewer than that,
  // fulfill with additional non-blacklisted options!
  const targetCount = expectedCount > 0 ? expectedCount : 0;
  if (targetCount > 0 && matchedIndices.size < targetCount) {
    for (let i = 0; i < optionItems.length; i++) {
      if (matchedIndices.size >= targetCount) break;
      const opt = optionItems[i];
      if (!isBadOpt(opt) && !matchedIndices.has(i)) {
        matchedIndices.add(i);
      }
    }
  }

  // 6. Absolute safety net: If for ANY reason matchedIndices is still empty:
  // Pick candidate non-blacklisted options so the question is NEVER left empty and red!
  if (matchedIndices.size === 0) {
    const fallbackCount = targetCount > 0 ? targetCount : 2;
    for (let i = 0; i < optionItems.length; i++) {
      if (matchedIndices.size >= fallbackCount) break;
      const opt = optionItems[i];
      if (!isBadOpt(opt)) {
        matchedIndices.add(i);
      }
    }
  }

  return matchedIndices;
}

/**
 * Last-resort fallback to ensure a question is never left empty and red
 * @param {object} question
 * @param {Record<string, string[]>} quizBlacklist
 */
export function autoSelectFallbackOptions(question, quizBlacklist = {}) {
  if (!question || !Array.isArray(question.optionItems) || question.optionItems.length === 0) return;

  const qBlacklist = getBlacklistedAnswersForQuestion(question.prompt, quizBlacklist);
  const isBadOpt = (opt) => isAnswerBlacklisted(opt?.text, qBlacklist);
  const validOptionItems = question.optionItems.filter((opt) => !isBadOpt(opt));
  const pool = validOptionItems.length > 0 ? validOptionItems : question.optionItems;

  const countMatch = (question.prompt || '').match(/\b(?:select|choose)\s+(two|three|four|five|six|\d+)\b/i);
  let expectedCount = 1;
  if (countMatch) {
    const wordMap = { two: 2, three: 3, four: 4, five: 5, six: 6 };
    expectedCount = wordMap[countMatch[1].toLowerCase()] || parseInt(countMatch[1], 10) || 1;
  } else if (question.type === 'checkbox' || /\b(?:select\s+all|check\s+all|choose\s+all|all\s+that\s+apply)\b/i.test(question.prompt)) {
    expectedCount = 2;
  }

  const toSelect = pool.slice(0, expectedCount);
  for (const opt of toSelect) {
    const wrapper = opt.input.closest('label') || opt.input.parentElement || opt.input;
    selectOptionElement(opt.input, wrapper, '🤖 AI');
  }
}

/**
 * Fill answers for discovered questions
 * @param {Array<object>} questions
 * @param {Array<object>} answers
 * @param {Set<number>} [sourceMatchIndexes]
 * @returns {number}
 */
async function fillDiscoveredAnswers(questions, answers, sourceMatchIndexes = new Set(), blacklist = {}) {
  let matched = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const cleanQ = cleanText(q.prompt);
    const qBlacklist = getBlacklistedAnswersForQuestion(q.prompt, blacklist);
    const isBlacklisted = (opt) => isAnswerBlacklisted(opt?.text, qBlacklist);

    const ansObj =
      answers.find((a) => a && (a.id === i + 1 || a.id === String(i + 1))) ||
      answers[i];

    if (!ansObj) continue;

    let answerDef = '';
    if (typeof ansObj === 'string') {
      answerDef = ansObj;
    } else if (Array.isArray(ansObj?.answer)) {
      answerDef = ansObj.answer.join('|');
    } else if (Array.isArray(ansObj?.definition)) {
      answerDef = ansObj.definition.join('|');
    } else {
      answerDef = String(ansObj?.definition || ansObj?.answer || ansObj?.text || '');
    }
    answerDef = answerDef.trim();

    if (!answerDef) continue;
    const cleanAns = cleanText(answerDef);
    let questionFilled = false;
    const badgeLabel = sourceMatchIndexes.has(i) ? '📦 Source' : '🤖 AI';

    if (q.type === 'radio') {
      // Single choice: find EXACTLY ONE best matching option that is NOT blacklisted!
      let chosenOpt = null;
      const validOptions = (q.optionItems || []).filter((opt) => !isBlacklisted(opt));

      // Single letter match ('a', 'b', 'c', 'd', etc.)
      if (cleanAns.length === 1 && cleanAns >= 'a' && cleanAns <= 'z') {
        const letterIdx = cleanAns.charCodeAt(0) - 97;
        if (q.optionItems[letterIdx] && !isBlacklisted(q.optionItems[letterIdx])) {
          chosenOpt = q.optionItems[letterIdx];
        }
      }

      // Priority 1: Exact cleaned match against un-blacklisted options
      if (!chosenOpt) {
        for (const opt of validOptions) {
          if (cleanText(opt.text) === cleanAns) {
            chosenOpt = opt;
            break;
          }
        }
      }

      // Priority 2: Prefix / Suffix match
      if (!chosenOpt) {
        for (const opt of validOptions) {
          const cOpt = cleanText(opt.text);
          if (cOpt.length >= 4 && cleanAns.length >= 4) {
            if (cOpt.startsWith(cleanAns) || cleanAns.startsWith(cOpt)) {
              chosenOpt = opt;
              break;
            }
          }
        }
      }

      // Priority 3: Word overlap scoring
      if (!chosenOpt) {
        let bestScore = 0;
        const ansWords = new Set(cleanAns.split(' ').filter((w) => w.length > 2));
        for (const opt of validOptions) {
          const cOpt = cleanText(opt.text);
          const optWords = cOpt.split(' ').filter((w) => w.length > 2);
          let overlap = 0;
          for (const w of optWords) {
            if (ansWords.has(w)) overlap++;
          }
          const score = optWords.length > 0 ? overlap / Math.max(ansWords.size, optWords.length) : 0;
          if (score > bestScore && score > 0.4) {
            bestScore = score;
            chosenOpt = opt;
          }
        }
      }

      // Priority 4: Fallback to any remaining non-blacklisted option if all proposed answers were wrong
      if (!chosenOpt && validOptions.length > 0 && qBlacklist.length > 0) {
        console.log(`[CourseraPro Smart Retake] Selecting fallback non-blacklisted option for question ${i + 1}`);
        chosenOpt = validOptions[0];
      }

      if (chosenOpt) {
        const wrapper = chosenOpt.input.closest('label') || chosenOpt.input.parentElement || chosenOpt.input;
        selectOptionElement(chosenOpt.input, wrapper, badgeLabel);
        questionFilled = true;
      }
    } else if (q.type === 'checkbox') {
      const matchedOptionIndices = resolveMultiSelectOptionIndices(
        ansObj?.answer || ansObj?.definition || answerDef,
        q.optionItems,
        q.prompt,
        qBlacklist
      );

      // Apply selection to all matched checkboxes
      for (const idx of matchedOptionIndices) {
        const opt = q.optionItems[idx];
        if (opt) {
          const wrapper = opt.input.closest('label') || opt.input.parentElement || opt.input;
          selectOptionElement(opt.input, wrapper, badgeLabel);
          questionFilled = true;
        }
      }
    } else if (q.type === 'text') {
      for (const inp of q.textInputs || []) {
        inp.click();
        inp.focus();
        if (inp.isContentEditable || inp.tagName === 'DIV') {
          await simulateTyping(inp, answerDef);
        } else {
          simulateInput(inp, answerDef);
        }
        addBadge(inp.parentElement || inp, badgeLabel);
        questionFilled = true;
      }
    }

    if (questionFilled) matched++;
  }

  return matched;
}

/**
 * Check if a question has been answered in the DOM
 * @param {object} q
 * @returns {boolean}
 */
export function isQuestionAnsweredInDom(q) {
  if (!q) return false;
  if (q.type === 'radio' || q.type === 'checkbox') {
    if (Array.isArray(q.optionItems) && q.optionItems.length > 0) {
      const anyChecked = q.optionItems.some((opt) => opt.input && opt.input.checked);
      if (anyChecked) return true;
    }
    if (q.container) {
      const anyChecked = q.container.querySelector(
        'input[type="radio"]:checked, input[type="checkbox"]:checked, [aria-checked="true"]'
      );
      if (anyChecked) return true;
    }
  } else if (q.type === 'text') {
    if (Array.isArray(q.textInputs) && q.textInputs.length > 0) {
      const anyFilled = q.textInputs.some((inp) => inp && inp.value && inp.value.trim().length > 0);
      if (anyFilled) return true;
    }
    if (q.container) {
      const textVal = q.container.querySelector('textarea, input[type="text"]')?.value?.trim();
      if (textVal) return true;
    }
  }
  return false;
}

/**
 * Fallback targeted retry for a single unanswered question
 * @param {object} question
 * @param {Record<string, string[]>} quizBlacklist
 * @returns {Promise<boolean>}
 */
async function retrySolveSingleQuestion(question, quizBlacklist = {}) {
  if (!question || !question.options || question.options.length === 0) return false;

  const cleanQ = cleanText(question.prompt);
  const qBlacklist = getBlacklistedAnswersForQuestion(question.prompt, quizBlacklist);
  const isBadOpt = (opt) => isAnswerBlacklisted(opt?.text, qBlacklist);
  const validOptionItems = (question.optionItems || []).filter((opt) => !isBadOpt(opt));

  if (validOptionItems.length === 0) return false;

  const isCheckbox = question.type === 'checkbox' ||
    /\b(?:select\s+(?:all|two|three|four|five|\d+)|check\s+all|choose\s+(?:all|two|three|four|five|\d+)|multiple\s+answers?)\b/i.test(question.prompt);

  const countMatch = question.prompt.match(/\b(?:select|choose)\s+(two|three|four|five|\d+)\b/i);
  let expectedCount = 0;
  if (countMatch) {
    const wordMap = { two: 2, three: 3, four: 4, five: 5 };
    expectedCount = wordMap[countMatch[1].toLowerCase()] || parseInt(countMatch[1], 10) || 0;
  }

  const countNote = expectedCount > 1 ? ` (EXACTLY ${expectedCount} OPTIONS REQUIRED)` : '';
  const rule = isCheckbox
    ? `CRITICAL RULE: This is a MULTI-SELECT CHECKBOX question${countNote}. Respond with ALL correct option letters (e.g. "B|C" or "A|D") or texts separated by '|'. Using option letters like "B|C" is strongly preferred!`
    : `CRITICAL RULE: Respond with ONLY the exact text of the correct choice or its letter (A, B, C, or D). Do not add any explanation or preamble.`;

  const prompt = `Solve this university exam question accurately:
Question: ${question.prompt}

Options:
${question.options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join('\n')}

${rule}`;

  try {
    const rawResult = await generateContent(
      prompt,
      isCheckbox
        ? 'You are a university exam expert. Provide ALL correct option letters separated by "|" (e.g. "B|C") for multi-select questions.'
        : 'You are a university exam expert. Provide only the single best answer option text or letter.',
      null,
      { temperature: 0.1 }
    );

    if (!rawResult || typeof rawResult !== 'string') return false;

    if (isCheckbox) {
      const matchedIndices = resolveMultiSelectOptionIndices(
        rawResult,
        question.optionItems,
        question.prompt,
        qBlacklist
      );

      let checkedAny = false;
      for (const idx of matchedIndices) {
        const opt = question.optionItems[idx];
        if (opt) {
          const wrapper = opt.input.closest('label') || opt.input.parentElement || opt.input;
          selectOptionElement(opt.input, wrapper, '🤖 AI');
          checkedAny = true;
        }
      }
      return checkedAny;
    }

    const cleanRes = cleanText(rawResult);
    let chosenOpt = null;

    // Check letter match (e.g. "A", "B", "C", "D")
    const letterMatch = rawResult.trim().match(/^[A-Da-d]\b/);
    if (letterMatch) {
      const idx = letterMatch[0].toUpperCase().charCodeAt(0) - 65;
      if (question.optionItems[idx] && !isBadOpt(question.optionItems[idx])) {
        chosenOpt = question.optionItems[idx];
      }
    }

    // Check exact or substring match against valid options
    if (!chosenOpt) {
      for (const opt of validOptionItems) {
        const cOpt = cleanText(opt.text);
        if (cleanRes === cOpt || cleanRes.includes(cOpt) || (cOpt.length >= 4 && cleanRes.includes(cOpt))) {
          chosenOpt = opt;
          break;
        }
      }
    }

    // Fallback: Word overlap matching
    if (!chosenOpt) {
      let bestScore = 0;
      const resWords = new Set(cleanRes.split(' ').filter((w) => w.length > 2));
      for (const opt of validOptionItems) {
        const cOpt = cleanText(opt.text);
        const optWords = cOpt.split(' ').filter((w) => w.length > 2);
        let overlap = 0;
        for (const w of optWords) {
          if (resWords.has(w)) overlap++;
        }
        const score = optWords.length > 0 ? overlap / Math.max(resWords.size, optWords.length) : 0;
        if (score > bestScore && score > 0.3) {
          bestScore = score;
          chosenOpt = opt;
        }
      }
    }

    // Last resort fallback if blacklist eliminated other options and only 1 valid option remains
    if (!chosenOpt && validOptionItems.length === 1) {
      chosenOpt = validOptionItems[0];
    }

    if (chosenOpt) {
      const wrapper = chosenOpt.input.closest('label') || chosenOpt.input.parentElement || chosenOpt.input;
      selectOptionElement(chosenOpt.input, wrapper, '🤖 AI');
      return true;
    }
  } catch (err) {
    console.warn('[CourseraPro] Single question retry failed:', err.message);
  }

  return false;
}

/**
 * Find the button to enter the quiz from the landing page
 * @returns {Element|null}
 */
export function findQuizEnterButton() {
  const enterSelectors = [
    'button[data-testid="start-quiz-button"]',
    'button[data-testid="resume-assignment-button"]',
    'button[data-testid="take-quiz-button"]',
    'button[data-testid="go-to-assignment-button"]',
    'button[data-testid="start-button"]',
    'button[data-testid*="start" i]',
    'button[data-testid*="resume" i]',
    'button[data-testid*="assignment" i]',
    'button[data-track-component="start_assignment_button"]',
    'button[data-track-component="resume_assignment_button"]',
    'button[data-track-component="go_to_assignment_button"]',
    'button.rc-StartAssignmentButton',
    'button.rc-ResumeAssignmentButton',
    'a[href*="/attempt"]',
    'button[aria-label="Resume"]',
    'button[aria-label="Start"]',
  ];

  for (const sel of enterSelectors) {
    const el = document.querySelector(sel);
    if (el && !el.closest('#cpt-panel') && el.offsetParent !== null) return el;
  }

  // Search all clickable elements by text
  const candidates = Array.from(document.querySelectorAll('button, a, [role="button"]'));
  for (const el of candidates) {
    if (el.closest('#cpt-panel')) continue;
    const text = (el.textContent || '').trim().toLowerCase();
    if (
      text === 'go to assignment' ||
      text === 'start assignment' ||
      text === 'resume assignment' ||
      text === 'take assignment' ||
      text === 'start quiz' ||
      text === 'take quiz' ||
      text === 'resume quiz' ||
      text === 'resume' ||
      text === 'start' ||
      text === 'try again' ||
      text === 'retake' ||
      text === 'làm bài' ||
      text === 'bắt đầu làm bài' ||
      text === 'tiếp tục làm bài' ||
      text === 'làm lại' ||
      text === 'bắt đầu' ||
      text === 'tiếp tục'
    ) {
      return el;
    }
  }

  // Partial text match
  for (const el of candidates) {
    if (el.closest('#cpt-panel')) continue;
    const text = (el.textContent || '').trim().toLowerCase();
    if (
      (text.includes('start assignment') ||
        text.includes('resume assignment') ||
        text.includes('go to assignment') ||
        text.includes('take assignment') ||
        text.includes('start quiz') ||
        text.includes('take quiz') ||
        text.includes('làm bài tập') ||
        text.includes('bắt đầu làm bài')) &&
      !text.includes('next') &&
      !text.includes('prev') &&
      !text.includes('back')
    ) {
      return el;
    }
  }

  return null;
}

/**
 * Poll DOM waiting for the quiz enter button to mount
 * @param {number} [timeoutMs=8000]
 * @returns {Promise<Element|null>}
 */
export async function waitForQuizEnterButton(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const btn = findQuizEnterButton();
    if (btn) return btn;
    await sleep(400);
  }
  return null;
}

/**
 * Click the submit button and handle confirmation modals
 * @returns {Promise<boolean>}
 */
async function autoSubmitQuiz() {
  try {
    await sleep(1000);

    // 1. Check for Coursera Honor Code agreement checkbox if present
    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(
      (cb) => !cb.checked && !cb.closest('#cpt-panel')
    );
    for (const cb of checkboxes) {
      const container = cb.closest('label, fieldset, div');
      const text = (container?.textContent || '').toLowerCase();
      if (
        text.includes('honor code') ||
        text.includes('submitting work') ||
        text.includes('understand') ||
        text.includes('cam đoan') ||
        text.includes('chấp nhận') ||
        text.includes('chính trực') ||
        text.includes('i agree') ||
        text.includes('i understand')
      ) {
        console.log('[CourseraPro] Checking Honor Code agreement checkbox...');
        cb.focus();
        cb.click();
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(500);
      }
    }

    // 2. Check for Honor Code signature / name input
    const sigInput = document.querySelector(
      'input[data-testid="honor-code-signature-input"], input[aria-label*="signature" i], input[placeholder*="full name" i], input[placeholder*="họ và tên" i]'
    );
    if (sigInput && !sigInput.value) {
      const userNameEl = document.querySelector('[data-testid="user-profile-name"], .rc-UserMenuDropdown button, .profile-name');
      const name = userNameEl?.textContent?.trim() || 'Coursera Learner';
      simulateInput(sigInput, name);
      await sleep(400);
    }

    // 3. Find submit button
    const submitBtn =
      Array.from(document.querySelectorAll('button, input[type="submit"]')).find((b) => {
        if (b.closest('#cpt-panel')) return false;
        const t = (b.textContent || b.value || '').trim().toLowerCase();
        return (
          (t === 'submit' ||
            t === 'submit quiz' ||
            t === 'submit assignment' ||
            t === 'nộp bài' ||
            t.includes('submit assignment') ||
            t.includes('submit quiz')) &&
          !t.includes('canceled') &&
          !t.includes('cancel')
        );
      }) ||
      document.querySelector(
        'button[data-testid="submit-button"], button[type="submit"], button.rc-SubmitQuizButton'
      );

    if (submitBtn) {
      safeClick(submitBtn);
      await sleep(1500);

      // 4. Critical check: Detect if Coursera showed "Missing or invalid answers" modal
      const modalEl = document.querySelector('[role="dialog"], .modal, .rc-Modal, [data-testid*="dialog" i]');
      if (modalEl) {
        const modalText = (modalEl.textContent || '').toLowerCase();
        if (
          modalText.includes('missing or invalid') ||
          modalText.includes('incomplete') ||
          modalText.includes('chưa trả lời') ||
          modalText.includes('you haven\'t answered') ||
          modalText.includes('chưa hoàn thành') ||
          modalText.includes('do you still want to submit')
        ) {
          console.warn('[CourseraPro] Coursera reported incomplete quiz modal! Canceling submit.');
          // Click Cancel button in modal to prevent accidental empty submission
          const cancelBtn = Array.from(modalEl.querySelectorAll('button')).find((b) => {
            const t = b.textContent.trim().toLowerCase();
            return t === 'cancel' || t === 'hủy' || t.includes('cancel');
          });
          if (cancelBtn) safeClick(cancelBtn);
          showToast('⚠️ Coursera báo còn câu hỏi chưa điền! Đã hủy nộp để bảo vệ điểm số.', 'error');
          return false;
        }

        // Check any checkbox inside normal confirmation modal
        const modalCheckbox = modalEl.querySelector('input[type="checkbox"]');
        if (modalCheckbox && !modalCheckbox.checked) {
          modalCheckbox.click();
          await sleep(300);
        }

        // Handle standard confirmation dialog if Coursera prompts
        const confirmBtn =
          Array.from(modalEl.querySelectorAll('button')).find((b) => {
            const t = b.textContent.trim().toLowerCase();
            return (
              t === 'submit' ||
              t === 'submit quiz' ||
              t === 'yes, submit' ||
              t === 'nộp bài' ||
              t === 'đồng ý' ||
              t === 'continue' ||
              t === 'tiếp tục'
            );
          }) || document.querySelector('button[data-testid="dialog-submit-button"]');

        if (confirmBtn) {
          safeClick(confirmBtn);
          await sleep(1500);
        }
      }

      return true;
    }
  } catch (e) {
    console.warn('[CourseraPro] Auto submit error:', e);
  }
  return false;
}

/**
 * Exit back to the outside overview page after completing
 * @param {string} [outsideUrl]
 */
async function autoExitQuiz(outsideUrl = '') {
  showToast('🎉 Đã hoàn thành và nộp bài! Đang tự động quay lại trang ngoài...', 'success');
  await sleep(2500);

  // Clear storage
  await chrome.storage.local.remove(STORAGE_KEY_QUIZ);

  if (outsideUrl) {
    const cleanTarget = outsideUrl.replace(/\/attempt.*/, '');
    window.location.href = cleanTarget;
    return;
  }

  // Look for back button
  const backBtn =
    document.querySelector('button[aria-label="Back"], a[aria-label="Back"], [data-testid="back-button"]') ||
    Array.from(document.querySelectorAll('a, button')).find((el) => {
      const t = el.textContent.trim().toLowerCase();
      return t === 'back' || t.startsWith('back') || t.includes('quay lại');
    });

  if (backBtn) {
    safeClick(backBtn);
    return;
  }

  // Fallback: strip /attempt
  if (location.href.includes('/attempt')) {
    window.location.href = location.href.replace(/\/attempt.*/, '');
  } else {
    window.history.back();
  }
}

/**
 * Solve questions on current /attempt page and submit
 * @param {string} outsideUrl
 */
export async function solveAndSubmitQuiz(outsideUrl = '') {
  try {
    showToast('Đang phát hiện câu hỏi trên trang...', 'info');

    // 1. Wait up to 10s for questions to render
    let questions = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      questions = discoverQuestions();
      if (questions.length > 0) break;
      await sleep(1000);
    }

    // Clear any previous error box-shadow from previous runs
    for (const q of questions) {
      if (q.container && q.container.style.boxShadow) {
        q.container.style.boxShadow = '';
      }
    }

    if (questions.length === 0) {
      // Check if we are on an uninitialized /attempt page (blank white screen)
      if (location.href.includes('/attempt')) {
        showToast('⚠️ Phiên làm bài chưa được khởi tạo (trắng trang). Đang tự động sửa lỗi và nạp bài...', 'warning');
        const meta = getMetadata();
        const courseId = meta.course_id;
        const itemId = meta.item_id || extractItemId();
        if (courseId && itemId) {
          const initiated = await apiInitiateAttempt(courseId, itemId);
          if (initiated) {
            showToast('✅ Đã kích hoạt phiên làm bài! Đang tải lại...', 'success');
            await sleep(1500);
            window.location.reload();
            return;
          }
        }
        // Fallback: return to overview page and enter properly
        showToast('🔄 Đang quay lại trang bài tập để vào bài chuẩn...', 'info');
        await sleep(1500);
        window.location.href = location.href.replace(/\/attempt.*/, '');
        return;
      }

      showToast('Không tìm thấy câu hỏi trắc nghiệm nào trên trang này.', 'warning');
      return;
    }

    // 2. Load Local Course Source and Smart Retake Blacklist
    const courseSlug = getCurrentCourseSlug();
    const quizBlacklist = await loadQuizBlacklist(courseSlug);

    // CRITICAL: Purge poisoned wrong answers from local source cache right now before reading source!
    const purgedCount = await purgeWrongAnswersFromSource(courseSlug, quizBlacklist);
    if (purgedCount > 0) {
      console.log(`[CourseraPro Smart Retake] Purged ${purgedCount} poisoned items from Source before solving.`);
    }

    const courseSource = await loadCourseSource(courseSlug);
    console.log(`[CourseraPro] Local Source for [${courseSlug}]: ${courseSource.length} questions. Blacklist has ${Object.keys(quizBlacklist).length} entries.`);

    const finalAnswers = new Array(questions.length);
    const sourceMatchSet = new Set();
    const missingForAI = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const matchedItem = findAnswerInSource(q, courseSource, quizBlacklist);
      if (matchedItem && matchedItem.answer) {
        finalAnswers[i] = {
          id: i + 1,
          term: q.prompt,
          definition: matchedItem.answer,
          answer: matchedItem.answer,
          fromSource: true,
        };
        sourceMatchSet.add(i);
      } else {
        missingForAI.push({
          originalIndex: i,
          id: i + 1,
          type: q.type,
          prompt: q.prompt,
          options: q.options,
        });
      }
    }

    const sourceCount = sourceMatchSet.size;
    let aiCount = 0;

    if (sourceCount === questions.length) {
      // 100% of questions answered by Local Source! Zero AI tokens needed!
      showToast(`⚡ Tuyệt vời! 100% câu hỏi (${sourceCount}/${questions.length}) có sẵn trong Source của bạn! Đang điền...`, 'success');
      updateProgress(sourceCount, questions.length, `Điền 100% từ Source (${sourceCount} câu)`);
    } else {
      if (sourceCount > 0) {
        showToast(`📦 Tìm thấy ${sourceCount}/${questions.length} câu trong Source! AI đang giải ${missingForAI.length} câu còn lại...`, 'info');
      } else {
        showToast(`Tìm thấy ${questions.length} câu hỏi! AI đang giải...`, 'info');
      }
      updateProgress(sourceCount, questions.length, `Source: ${sourceCount} · AI giải: ${missingForAI.length}...`);

      // 3. Verify API key before calling AI for missing questions
      const { apiKey, provider } = await getAISettings();
      if (!apiKey) {
        showToast(`⚠️ Chưa nhập API Key cho ${provider.toUpperCase()}! Bấm ⚙️ Cài đặt.`, 'warning');
        return;
      }

      let aiAnswers = [];
      try {
        aiAnswers = await generateQuizAnswers(missingForAI, { blacklist: quizBlacklist });
      } catch (aiErr) {
        console.error('[CourseraPro] Quiz generation error:', aiErr);
        showToast(`⚠️ Lỗi AI (${provider}): ${aiErr.message}`, 'error');
      }

      if (!aiAnswers || aiAnswers.length === 0) {
        if (sourceCount === 0) {
          showToast('AI không giải được bài này. Kiểm tra API key hoặc đổi Model trong Cài đặt.', 'error');
          return;
        } else {
          showToast(`⚠️ AI lỗi, nhưng đã điền ${sourceCount} câu từ Source của bạn!`, 'warning');
        }
      } else {
        for (let j = 0; j < missingForAI.length; j++) {
          const item = missingForAI[j];
          const aiAns =
            aiAnswers.find((a) => a && (a.id === item.id || a.id === String(item.id))) ||
            aiAnswers[j];

          let ansText = '';
          if (typeof aiAns === 'string') {
            ansText = aiAns;
          } else if (Array.isArray(aiAns?.answer)) {
            ansText = aiAns.answer.join('|');
          } else if (Array.isArray(aiAns?.definition)) {
            ansText = aiAns.definition.join('|');
          } else {
            ansText = String(aiAns?.answer || aiAns?.definition || '');
          }
          ansText = ansText.trim();

          if (ansText) {
            finalAnswers[item.originalIndex] = {
              id: item.id,
              term: item.prompt,
              definition: ansText,
              answer: ansText,
              fromAI: true,
            };
            aiCount++;
          }
        }
      }
    }

    // 5. Fill answers into DOM (rejecting any blacklisted options)
    let matched = await fillDiscoveredAnswers(questions, finalAnswers, sourceMatchSet, quizBlacklist);

    // 5b. Retry any remaining unanswered questions individually
    let unanswered = questions.filter((q) => !isQuestionAnsweredInDom(q));
    if (unanswered.length > 0) {
      console.log(`[CourseraPro] ${unanswered.length} questions unanswered after initial pass. Retrying individually...`);
      showToast(`⚡ Đang thử giải bổ sung ${unanswered.length} câu còn thiếu...`, 'info');

      for (const uq of unanswered) {
        const solved = await retrySolveSingleQuestion(uq, quizBlacklist);
        if (solved) matched++;
        await sleep(500);
      }

      // Re-check unanswered after retry
      unanswered = questions.filter((q) => !isQuestionAnsweredInDom(q));
    }

    // 5c. Safety net: If any question is still unanswered after retry, auto-select candidates so it is never left empty and red!
    if (unanswered.length > 0) {
      console.log(`[CourseraPro] Auto-filling ${unanswered.length} remaining questions with best candidates...`);
      for (const uq of unanswered) {
        autoSelectFallbackOptions(uq, quizBlacklist);
      }
      unanswered = questions.filter((q) => !isQuestionAnsweredInDom(q));
    }

    // 5d. CRITICAL SUBMIT SAFEGUARD: If any question is STILL unanswered after all fallbacks, DO NOT SUBMIT, DO NOT EXIT!
    if (unanswered.length > 0) {
      const answeredCount = questions.length - unanswered.length;
      updateProgress(answeredCount, questions.length, `Đã điền ${answeredCount}/${questions.length}`);
      showToast(
        `⚠️ Còn ${unanswered.length}/${questions.length} câu chưa có đáp án! KHÔNG tự nộp để bảo vệ điểm của bạn. Vui lòng kiểm tra và tự nộp!`,
        'warning'
      );

      // Highlight unanswered questions and scroll first one into view
      for (const uq of unanswered) {
        if (uq.container) {
          uq.container.style.boxShadow = '0 0 0 2px #ef4444, 0 0 15px rgba(239, 68, 68, 0.4)';
          uq.container.style.borderRadius = '8px';
        }
      }
      if (unanswered[0]?.container) {
        unanswered[0].container.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      // Stop here! Never submit or exit with unanswered questions!
      return;
    }

    // All questions successfully answered!
    updateProgress(questions.length, questions.length, `Đã điền ${questions.length}/${questions.length}`);
    const summaryMsg =
      sourceCount > 0
        ? `🎉 Đã hoàn thành 100% (${questions.length}/${questions.length} câu - ${sourceCount} từ Source, ${aiCount} từ AI)! Đã lưu vào kho.`
        : `🎉 Đã tự động điền đủ ${questions.length}/${questions.length} câu! Đã lưu vào kho.`;

    showToast(summaryMsg, 'success');
    await sleep(2000);

    // 6. Check auto-submit setting
    const { isAutoSubmitQuiz } = await chrome.storage.local.get(['isAutoSubmitQuiz']);
    const shouldSubmit = isAutoSubmitQuiz !== false; // default true

    if (shouldSubmit) {
      showToast('Đang tự động nộp bài quiz...', 'info');
      const submitOk = await autoSubmitQuiz();
      if (submitOk) {
        showToast('🎉 Đã nộp bài thành công! Tool sẽ giữ nguyên trang này để bạn xem kết quả.', 'success');
        await chrome.storage.local.remove(STORAGE_KEY_QUIZ);

        // Check if Master Course Autopilot Queue is active
        try {
          const queueRes = await chrome.storage.local.get(['cpt_master_autopilot_queue']);
          const autopilotQueue = queueRes?.cpt_master_autopilot_queue;
          if (autopilotQueue && autopilotQueue.active) {
            showToast('🚀 [Master Autopilot]: Chuẩn bị chuyển sang bài Quiz tiếp theo...', 'info');
            await sleep(2500);
            if (typeof advanceAutopilotQuizQueue === 'function') {
              await advanceAutopilotQuizQueue(autopilotQueue);
              return;
            } else if (typeof window !== 'undefined' && window.__cpt_advanceAutopilotQuizQueue) {
              await window.__cpt_advanceAutopilotQuizQueue(autopilotQueue);
              return;
            }
          }
        } catch (_qErr) {}
      } else {
        showToast('⚠️ Bài thi chưa sẵn sàng nộp hoặc cần bạn kiểm tra lại. Đã giữ nguyên trang!', 'warning');
      }
    } else {
      showToast('🎉 Đã điền xong tất cả câu hỏi! Hãy kiểm tra lại trước khi tự nộp.', 'success');
      await chrome.storage.local.remove(STORAGE_KEY_QUIZ);
    }
  } catch (err) {
    console.error('[CourseraPro] Error solving quiz:', err);
    showToast('Lỗi giải quiz: ' + err.message, 'error');
  }
}

let isQuizSolving = false;

/**
 * Main Auto Quiz entry point (handles inside /attempt, outside landing page, and /review pages)
 */
export async function handleAutoQuiz() {
  try {
    const isInsideAttempt = location.href.includes('/attempt');

    if (isInsideAttempt) {
      // User clicked while INSIDE the attempt page: solve, submit, and exit
      console.log('[CourseraPro] Auto Quiz triggered inside /attempt page');
      showToast('⚡ Bắt đầu tự động làm bài kiểm tra...', 'info');
      const outsideUrl = location.href.replace(/\/attempt.*/, '');
      await solveAndSubmitQuiz(outsideUrl);
      return;
    }

    // Check if on Review / Feedback results page (strictly when NOT on /attempt)
    const isReviewPage =
      location.href.includes('/review') ||
      location.href.includes('/view-feedback') ||
      Boolean(document.querySelector('.rc-FormPartsQuestion__error, [data-testid="test-feedback-incorrect"]'));

    if (isReviewPage) {
      showToast('🎯 Smart Retake: Đang phân tích kết quả bài thi để lưu câu đúng và loại trừ câu sai...', 'info');
      const stats = await recordQuizReviewFeedback();
      await sleep(1200);

      const outsideUrl = location.href.replace(/\/(?:view-feedback|review).*/, '');

      // CRITICAL: Save auto quiz state so when /attempt loads it automatically starts!
      await chrome.storage.local.set({
        [STORAGE_KEY_QUIZ]: {
          active: true,
          outsideUrl: outsideUrl,
          timestamp: Date.now(),
        },
      });

      const enterBtn = findQuizEnterButton();
      if (enterBtn) {
        showToast('🎯 Đã lưu bài học! Đang bấm "Resume" / "Try Again" để làm lại...', 'success');
        await sleep(1000);
        safeClick(enterBtn);
        await autoClickStartModal();
      } else {
        showToast(`🎯 Smart Retake: Đã chặn ${stats.wrongRecorded} câu sai & nạp ${stats.correctRecorded} câu đúng! Bấm "Try Again" để làm lại.`, 'success');
      }
      return;
    }

    // User is OUTSIDE on the assignment overview page:
    showToast('⚡ Đang tìm nút vào làm bài...', 'info');

    const outsideUrl = location.href;
    const enterBtn = await waitForQuizEnterButton(6000);

    // Save auto quiz state so when /attempt loads it automatically starts
    await chrome.storage.local.set({
      [STORAGE_KEY_QUIZ]: {
        active: true,
        outsideUrl: outsideUrl,
        timestamp: Date.now(),
      },
    });

    if (enterBtn) {
      showToast('Đang bấm vào bài làm (Resume / Start)...', 'info');
      safeClick(enterBtn);
      await autoClickStartModal();
    } else {
      // Button not found yet, try backend GraphQL initiate before navigating
      const meta = getMetadata();
      const courseId = meta.course_id;
      const itemId = meta.item_id || extractItemId();
      let initiated = false;
      if (courseId && itemId) {
        initiated = await apiInitiateAttempt(courseId, itemId);
      }

      if (initiated) {
        const cleanUrl = location.href.split('?')[0].replace(/\/$/, '');
        window.location.href = `${cleanUrl}/attempt`;
      } else {
        showToast('⚠️ Vui lòng bấm nút "Bắt đầu làm bài" trên trang để AI tự giải!', 'warning');
      }
    }
  } catch (error) {
    console.error('[CourseraPro] Auto Quiz entry error:', error);
    showToast('Lỗi Auto Quiz: ' + error.message, 'error');
  }
}

/**
 * Helper to automatically click the "Continue" button on the "Start new attempt?" modal
 */
async function autoClickStartModal() {
  await sleep(1500);
  const modalConfirmBtn = Array.from(document.querySelectorAll('[role="dialog"] button, .modal button, .rc-Modal button')).find(
    (b) => {
      const t = b.textContent.trim().toLowerCase();
      return t === 'continue' || t === 'tiếp tục';
    }
  );
  if (modalConfirmBtn) {
    console.log('[CourseraPro] Auto-clicked Continue on Start new attempt modal');
    safeClick(modalConfirmBtn);
    await sleep(1000);
  }
}

/**
 * Check and resume auto quiz if active after entering /attempt page
 */
export async function checkAndResumeAutoQuiz() {
  try {
    if (!location.href.includes('/attempt')) return;
    if (isQuizSolving) return;

    const result = await chrome.storage.local.get(STORAGE_KEY_QUIZ);
    const state = result[STORAGE_KEY_QUIZ];

    if (state && state.active) {
      if (Date.now() - state.timestamp > 600000) {
        await chrome.storage.local.remove(STORAGE_KEY_QUIZ);
        return;
      }

      console.log('[CourseraPro] Auto quiz active state detected, starting solving process...');
      showToast('⚡ Phát hiện phiên làm bài! Đang chuẩn bị giải tự động...', 'info');
      await chrome.storage.local.remove(STORAGE_KEY_QUIZ);

      setTimeout(() => {
        if (!isQuizSolving) {
          isQuizSolving = true;
          solveAndSubmitQuiz(state.outsideUrl).finally(() => {
            isQuizSolving = false;
          });
        }
      }, 1500);
    }
  } catch (e) {
    console.warn('[CourseraPro] Error checking auto quiz state:', e);
  }
}
