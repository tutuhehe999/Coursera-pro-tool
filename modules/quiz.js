/**
 * Coursera Pro Tool - Auto Quiz Module
 * Uses Gemini AI to automatically:
 * 1. Enter quiz attempt from outside assignment page (Resume / Start)
 * 2. Solve all quiz questions using Gemini AI
 * 3. Auto-submit the quiz attempt
 * 4. Automatically exit back to the overview page!
 */

import { waitForSelector, sleep, safeClick, addBadge, simulateInput, simulateTyping, extendStringPrototype } from '../utils/dom.js';
import { generateQuizAnswers, generateContent, getAISettings } from '../utils/ai.js';
import { showToast, updateProgress } from '../ui/panel.js';

const STORAGE_KEY_QUIZ = 'cpt_auto_quiz';

/**
 * Clean string for reliable comparison
 * @param {string} str
 * @returns {string}
/**
 * Safely decode common HTML entities
 * @param {string} str
 * @returns {string}
 */
function decodeHtml(str) {
  if (!str || typeof str !== 'string' || !str.includes('&')) return str || '';
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&le;/g, '<=')
    .replace(/&ge;/g, '>=')
    .replace(/&ne;/g, '!=');
}

/**
 * Clean string for reliable comparison
 * Preserves decimal points between numbers (e.g. 10.5%) and relational operators (>=, <=, >, <, +, -)
 * @param {string} str
 * @returns {string}
 */
function cleanText(str) {
  if (!str) return '';
  let text = decodeHtml(String(str));
  return text
    .toLowerCase()
    .replace(/^\s*(?:question\s*\d+[\s:.-]*|\d+[.):]\s+|[a-z0-9]{1,2}[.):]\s+)/i, '') // remove "Question 1:", "10. ", "A. "
    .replace(/(?<!\d)\.|\.(?!\d)/g, '') // remove dots that are not decimal points
    .replace(/[,;:!?"'‘’“”`~()\[\]{}]/g, '') // remove punctuation noise, keep math: < > = + - * / % ^
    .replace(/\s+/g, ' ')
    .trim();
}

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
    '.rc-FormPartsQuestion, fieldset, [data-testid*="question" i], [class*="QuizQuestion"]'
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
      .replace(/\b\d+\s*(?:points?|điểm)\b/gi, '')
      .replace(/\b\d+\s*\/\s*\d+\s*(?:points?|điểm)\b/gi, '')
      .replace(/^\s*(?:question\s*\d+[\s:.-]*|\d+[.):]\s+)/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    const rawPrompt = promptText;
    const cp = cleanText(rawPrompt);
    if (!cp) return;

    const blockText = block.textContent || '';
    const isError =
      block.querySelector('.rc-FormPartsQuestion__error') ||
      block.querySelector('[data-testid="test-feedback-incorrect"]') ||
      block.querySelector('[aria-label*="Incorrect" i]') ||
      block.querySelector('.css-1m4z3k7') ||
      /\b(?:0\s*\/\s*1\s*point|incorrect|sai|0\s*điểm)\b/i.test(blockText);

    const isSuccess =
      block.querySelector('.rc-FormPartsQuestion__success') ||
      block.querySelector('[data-testid="test-feedback-correct"]') ||
      block.querySelector('[aria-label*="Correct" i]') ||
      /\b(?:1\s*\/\s*1\s*point|correct|đúng|1\s*điểm)\b/i.test(blockText);

    const selectedOptionsText = [];
    const checkedInputs = block.querySelectorAll('input:checked, [aria-checked="true"]');
    if (checkedInputs && checkedInputs.length > 0) {
      checkedInputs.forEach(inp => {
        selectedOptionsText.push(extractOptionLabel(inp));
      });
    } else {
      // Fallback for read-only review pages where inputs might be removed or locked
      const optionContainers = block.querySelectorAll('.rc-Option, [class*="option" i], label, .rc-FormPartsOption');
      for (const container of optionContainers) {
        const isSelected = 
          container.className.includes('selected') || 
          container.className.includes('checked') ||
          container.querySelector('.rc-FormPartsQuestion__error, .rc-FormPartsQuestion__success, [data-testid*="feedback"]') ||
          container.querySelector('svg[aria-label*="Selected" i], svg[aria-label*="Checked" i]') ||
          (container.nextElementSibling && container.nextElementSibling.className && container.nextElementSibling.className.includes('error'));
          
        if (isSelected) {
          const clone = container.cloneNode(true);
          // Remove feedback icons/text so they don't pollute the extracted answer text
          const feedbackEls = clone.querySelectorAll('.rc-FormPartsQuestion__error, .rc-FormPartsQuestion__success, [data-testid*="feedback"]');
          feedbackEls.forEach(el => el.remove());
          selectedOptionsText.push(clone.textContent.trim());
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
          answer: cleanChecked, // using cleaned text for consistency
        });
        correctRecorded++;
      }
    });
  });

  if (wrongRecorded > 0) {
    await saveQuizBlacklist(courseSlug, blacklist);
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
  const qBlacklist = blacklist[cleanQ] || [];

  // Helper to verify if source answer exists in question options and not blacklisted
  const matchesAnyOption = (ans) => {
    const cleanA = cleanText(ans);
    if (qBlacklist.includes(cleanA)) return false; // Rejected by Smart Retake blacklist!
    if (!hasOptions) return true;
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

  return null;
}

/**
 * Select a radio or checkbox option safely in React applications
 * @param {HTMLInputElement} input
 * @param {HTMLElement} wrapper
 * @param {string} [badgeLabel='✓']
 */
function selectOptionElement(input, wrapper, badgeLabel = '✓') {
  if (!input) return;

  const labelTarget =
    input.closest('label') ||
    (input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null) ||
    wrapper ||
    input;

  // 1. Click label target
  try {
    labelTarget.click();
  } catch (e) {}

  // 2. Click input directly if unchecked
  try {
    if (!input.checked) {
      input.focus();
      input.click();
    }
  } catch (e) {}

  // 3. Dispatch native input and change events
  try {
    input.checked = true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (e) {}

  // 4. Force React checked state for controlled components
  try {
    const proto = window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'checked')?.set;
    if (nativeSetter) {
      nativeSetter.call(input, true);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } catch (_e) {}

  // Add badge
  addBadge(labelTarget || wrapper || input.parentElement || input, badgeLabel);
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

        // Clean point labels and index numbers
        promptText = promptText
          .replace(/\b\d+\s*(?:points?|điểm)\b/gi, '')
          .replace(/\b\d+\s*\/\s*\d+\s*(?:points?|điểm)\b/gi, '')
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
    const qBlacklist = blacklist[cleanQ] || [];
    const isBlacklisted = (opt) => qBlacklist.includes(cleanText(opt?.text));

    const ansObj =
      answers.find((a) => a && (a.id === i + 1 || a.id === String(i + 1))) ||
      answers[i];

    if (!ansObj) continue;

    const answerDef = (
      typeof ansObj === 'string'
        ? ansObj
        : (ansObj.definition || ansObj.answer || ansObj.text || '')
    ).trim();

    if (!answerDef) continue;
    const cleanAns = cleanText(answerDef);
    let questionFilled = false;
    const badgeLabel = sourceMatchIndexes.has(i) ? '📦 Source' : '🤖 AI';

    if (q.type === 'radio') {
      // Single choice: find EXACTLY ONE best matching option that is NOT blacklisted!
      let chosenOpt = null;
      const validOptions = (q.optionItems || []).filter((opt) => !isBlacklisted(opt));

      // Single letter match ('a', 'b', 'c', 'd')
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
      // Multiple choice: split into targets
      const parts = answerDef.split(/[|\n;]/).map((p) => cleanText(p)).filter(Boolean);
      if (parts.length === 0 && cleanAns) parts.push(cleanAns);

      for (const part of parts) {
        let partMatched = false;
        // Priority 1: Exact match
        for (const opt of q.optionItems) {
          const cOpt = cleanText(opt.text);
          if (cOpt === part && !isBlacklisted(opt)) {
            const wrapper = opt.input.closest('label') || opt.input.parentElement || opt.input;
            selectOptionElement(opt.input, wrapper, badgeLabel);
            partMatched = true;
            questionFilled = true;
          }
        }

        // Priority 2: Substring match
        if (!partMatched) {
          for (const opt of q.optionItems) {
            const cOpt = cleanText(opt.text);
            if (cOpt.length >= 4 && part.length >= 4 && (cOpt.includes(part) || part.includes(cOpt)) && !isBlacklisted(opt)) {
              const wrapper = opt.input.closest('label') || opt.input.parentElement || opt.input;
              selectOptionElement(opt.input, wrapper, badgeLabel);
              questionFilled = true;
            }
          }
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
  const qBlacklist = quizBlacklist[cleanQ] || [];
  const validOptionItems = (question.optionItems || []).filter(
    (opt) => !qBlacklist.includes(cleanText(opt.text))
  );

  if (validOptionItems.length === 0) return false;

  const prompt = `Solve this university exam question accurately:
Question: ${question.prompt}

Options:
${question.options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join('\n')}

CRITICAL RULE: Respond with ONLY the exact text of the correct choice or its letter (A, B, C, or D). Do not add any explanation or preamble.`;

  try {
    const rawResult = await generateContent(
      prompt,
      'You are a university exam expert. Provide only the single best answer option text or letter.',
      null,
      { temperature: 0.1 }
    );

    if (!rawResult || typeof rawResult !== 'string') return false;
    const cleanRes = cleanText(rawResult);
    let chosenOpt = null;

    // Check letter match (e.g. "A", "B", "C", "D")
    const letterMatch = rawResult.trim().match(/^[A-Da-d]\b/);
    if (letterMatch) {
      const idx = letterMatch[0].toUpperCase().charCodeAt(0) - 65;
      if (question.optionItems[idx] && !qBlacklist.includes(cleanText(question.optionItems[idx].text))) {
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
function findQuizEnterButton() {
  const enterSelectors = [
    'button[data-testid="start-quiz-button"]',
    'button[data-testid="resume-assignment-button"]',
    'button[data-testid="take-quiz-button"]',
    'a[href*="/attempt"]',
    'button[aria-label="Resume"]',
    'button[aria-label="Start"]',
  ];

  for (const sel of enterSelectors) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) return el;
  }

  // Search all clickable elements by text
  const candidates = Array.from(document.querySelectorAll('button, a, [role="button"]'));
  for (const el of candidates) {
    const text = el.textContent.trim().toLowerCase();
    if (
      text === 'resume assignment' ||
      text === 'start assignment' ||
      text === 'resume' ||
      text === 'take quiz' ||
      text === 'start quiz' ||
      text === 'start' ||
      text === 'try again' ||
      text === 'bắt đầu làm bài' ||
      text === 'tiếp tục làm bài' ||
      text === 'làm lại'
    ) {
      return el;
    }
  }

  // Partial text match
  for (const el of candidates) {
    const text = el.textContent.trim().toLowerCase();
    if (
      (text.includes('resume') || text.includes('start assignment') || text.includes('take quiz')) &&
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

    if (questions.length === 0) {
      showToast('Không tìm thấy câu hỏi trắc nghiệm nào trên trang này.', 'warning');
      return;
    }

    // 2. Load Local Course Source and Smart Retake Blacklist
    const courseSlug = getCurrentCourseSlug();
    const courseSource = await loadCourseSource(courseSlug);
    const quizBlacklist = await loadQuizBlacklist(courseSlug);
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
        const newlySolvedToSave = [];

        for (let j = 0; j < missingForAI.length; j++) {
          const item = missingForAI[j];
          const aiAns =
            aiAnswers.find((a) => a && (a.id === item.id || a.id === String(item.id))) ||
            aiAnswers[j];
          const ansText = (
            typeof aiAns === 'string'
              ? aiAns
              : (aiAns?.answer || aiAns?.definition || '')
          ).trim();

          if (ansText) {
            finalAnswers[item.originalIndex] = {
              id: item.id,
              term: item.prompt,
              definition: ansText,
              answer: ansText,
              fromAI: true,
            };
            aiCount++;

            // Verify answer matches at least one option to avoid cache poisoning
            const isMultipleChoice = Array.isArray(item.options) && item.options.length > 0;
            const cleanA = cleanText(ansText);
            const isValidOption = !isMultipleChoice || item.options.some((opt) => {
              const cOpt = cleanText(opt);
              return cOpt === cleanA || (cOpt.length >= 4 && (cOpt.includes(cleanA) || cleanA.includes(cOpt)));
            });

            if (isValidOption) {
              newlySolvedToSave.push({
                prompt: item.prompt,
                answer: ansText,
                options: item.options,
              });
            }
          }
        }

        // 4. Automatically save newly solved questions into Local Source!
        if (newlySolvedToSave.length > 0) {
          const totalInSource = await saveToCourseSource(courseSlug, newlySolvedToSave);
          console.log(`[CourseraPro] Local Source updated! Total in [${courseSlug}]: ${totalInSource} questions`);
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

    // 5c. CRITICAL SUBMIT SAFEGUARD: If any question is still unanswered, DO NOT SUBMIT, DO NOT EXIT!
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

/**
 * Main Auto Quiz entry point (handles inside /attempt, outside landing page, and /review pages)
 */
export async function handleAutoQuiz() {
  try {
    // Check if on Review / Feedback results page
    const isReviewPage = location.href.includes('/review') || Boolean(document.querySelector('.rc-FormPartsQuestion__error, [data-testid="test-feedback-incorrect"]'));
    if (isReviewPage) {
      showToast('🎯 Smart Retake: Đang phân tích kết quả bài thi để lưu câu đúng và loại trừ câu sai...', 'info');
      const stats = await recordQuizReviewFeedback();
      await sleep(1200);

      const enterBtn = findQuizEnterButton();
      if (enterBtn) {
        showToast('🎯 Đã lưu bài học! Đang bấm "Try Again" / Làm lại để đạt 100%...', 'success');
        await sleep(1000);
        safeClick(enterBtn);
        await autoClickStartModal();
      } else {
        showToast(`🎯 Smart Retake: Đã chặn ${stats.wrongRecorded} câu sai & nạp ${stats.correctRecorded} câu đúng! Bấm "Try Again" để làm lại.`, 'success');
      }
      return;
    }

    const isInsideAttempt = location.href.includes('/attempt');

    if (isInsideAttempt) {
      // User clicked while INSIDE the attempt page: solve, submit, and exit
      const outsideUrl = location.href.replace(/\/attempt.*/, '');
      await solveAndSubmitQuiz(outsideUrl);
      return;
    }

    // User is OUTSIDE on the assignment overview page:
    showToast('⚡ Bắt đầu tự động vào làm bài Quiz...', 'info');

    const outsideUrl = location.href;
    const enterBtn = findQuizEnterButton();

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
      // Direct navigation to /attempt
      showToast('Đang chuyển hướng vào trang làm bài...', 'info');
      const cleanUrl = location.href.split('?')[0].replace(/\/$/, '');
      window.location.href = `${cleanUrl}/attempt`;
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

    const result = await chrome.storage.local.get(STORAGE_KEY_QUIZ);
    const state = result[STORAGE_KEY_QUIZ];

    if (state && state.active) {
      // Safety check: don't run if state is older than 5 minutes
      if (Date.now() - state.timestamp > 300000) {
        await chrome.storage.local.remove(STORAGE_KEY_QUIZ);
        return;
      }

      console.log('[CourseraPro] Auto quiz active state detected, starting solving process...');
      setTimeout(() => {
        solveAndSubmitQuiz(state.outsideUrl);
      }, 2000);
    }
  } catch (e) {
    console.warn('[CourseraPro] Error checking auto quiz state:', e);
  }
}
