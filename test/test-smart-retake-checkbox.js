/**
 * Test Suite for Smart Retake Feedback Processing & Checkbox Multi-Select
 * Verifies:
 * 1. Purging poisoned cache from local course source
 * 2. Feedback extraction on /view-feedback (0/2 points, Try again, This should not be selected)
 * 3. Multi-select checkbox filling (pipes, letters, arrays, expectedCount)
 * 4. Protection against cache poisoning
 * Run: node test/test-smart-retake-checkbox.js
 */

const assert = require('assert');

// 1. cleanText utility
function cleanText(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/^\s*(?:question\s*\d+[\s:.-]*|\d+[.):]\s+|[a-z0-9]{1,2}[.):]\s+)/i, '')
    .replace(/(?<!\d)\.|\.(?!\d)/g, '')
    .replace(/[,;:!?"'‘’“”`~()\[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Import functions from utils/dom.js or define identical implementations for Node testing
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

function wordOverlapRatio(str1, str2) {
  if (!str1 || !str2) return 0;
  const words1 = new Set(cleanText(str1).split(' ').filter((w) => w.length > 2));
  const words2 = new Set(cleanText(str2).split(' ').filter((w) => w.length > 2));
  if (words1.size === 0 || words2.size === 0) return 0;
  let overlap = 0;
  for (const w of words1) {
    if (words2.has(w)) overlap++;
  }
  return overlap / Math.min(words1.size, words2.size);
}

function getBlacklistedAnswersForQuestion(prompt, blacklistMap = {}) {
  if (!prompt || !blacklistMap || typeof blacklistMap !== 'object') return [];
  const cleanP = cleanText(prompt);
  if (!cleanP) return [];

  const badAnswers = new Set();

  if (Array.isArray(blacklistMap[cleanP])) {
    for (const ans of blacklistMap[cleanP]) {
      const c = cleanText(ans);
      if (c) badAnswers.add(c);
    }
  }

  for (const [bKey, answers] of Object.entries(blacklistMap)) {
    if (!Array.isArray(answers) || answers.length === 0) continue;
    const cleanBKey = cleanText(bKey);
    if (!cleanBKey) continue;

    let isMatch = false;
    if (cleanBKey === cleanP) {
      isMatch = true;
    } else {
      if (cleanP.length >= 20 && cleanBKey.length >= 20) {
        if (cleanP.includes(cleanBKey) || cleanBKey.includes(cleanP)) {
          const lenRatio = Math.min(cleanP.length, cleanBKey.length) / Math.max(cleanP.length, cleanBKey.length);
          if (lenRatio >= 0.5) isMatch = true;
        }
      }
      if (!isMatch && wordOverlapRatio(cleanP, cleanBKey) >= 0.55) {
        isMatch = true;
      }
    }

    if (isMatch) {
      for (const ans of answers) {
        const c = cleanText(ans);
        if (c) badAnswers.add(c);
      }
    }
  }

  return Array.from(badAnswers);
}

function isAnswerBlacklisted(ansText, blacklistedAnswers) {
  if (!ansText || !Array.isArray(blacklistedAnswers) || blacklistedAnswers.length === 0) return false;
  const cleanA = cleanText(ansText);
  if (!cleanA) return false;

  return blacklistedAnswers.some((bad) => {
    const cleanBad = cleanText(bad);
    if (!cleanBad) return false;
    if (cleanA === cleanBad) return true;
    if (cleanA.length >= 4 && cleanBad.length >= 4) {
      if (cleanA.includes(cleanBad) || cleanBad.includes(cleanA)) return true;
    }
    if (wordOverlapRatio(cleanA, cleanBad) >= 0.65) return true;
    return false;
  });
}

console.log('--- TEST 1: Purge Poisoned Cache from Local Course Source (With Prompt Variations) ---');

function purgeSource(existingSource, blacklistMap) {
  return existingSource.filter((item) => {
    const p = item.cleanPrompt || item.prompt;
    const badAnswers = getBlacklistedAnswersForQuestion(p, blacklistMap);
    if (badAnswers.length === 0) return true;

    const isBad = isAnswerBlacklisted(item.answer, badAnswers);
    return !isBad;
  });
}

const mockSource = [
  {
    prompt: 'Which of the following software development models can best respond to requirements changes?',
    answer: 'The Waterfall model', // Poisoned wrong answer from attempt 1
  },
  {
    prompt: 'In which of the following software development models are the software development activities performed sequentially rather than in iterations?',
    answer: 'Agile models', // Poisoned wrong answer from attempt 1
  },
  {
    prompt: 'Which of the following are limitations of the waterfall model? Select three.',
    answer: 'It is not suitable for big projects', // Poisoned wrong answer from attempt 1
  },
  {
    prompt: 'What is Scrum?',
    answer: 'An agile framework for developing complex products', // Legitimate correct answer
  },
];

// Note realistic prompt variations from Coursera review page:
// Question numbers "1. ", point labels "0/1 point", "0/2 points", "pts"
const mockBlacklist = {
  [cleanText('1. Which of the following software development models can best respond to requirements changes? 0/1 point')]: [
    cleanText('The Waterfall model'),
  ],
  [cleanText('2. In which of the following software development models are the software development activities performed sequentially rather than in iterations? 0/1 point')]: [
    cleanText('Agile models'),
  ],
  [cleanText('3. Which of the following are limitations of the waterfall model? Select three. 0/2 points')]: [
    cleanText('It is not suitable for big projects'),
  ],
};

const purged = purgeSource(mockSource, mockBlacklist);
assert.strictEqual(purged.length, 1, 'All 3 poisoned answers must be purged from source even with review page prompt differences!');
assert.strictEqual(purged[0].prompt, 'What is Scrum?');
console.log('✓ Poisoned cache purged cleanly from course source even with prompt differences');

console.log('--- TEST 1b: Verify findAnswerInSource Rejects Blacklisted Answers ---');

function findAnswerInSource(question, sourceList, blacklist = {}) {
  if (!question || !sourceList || sourceList.length === 0) return null;
  const cleanQ = cleanText(question.prompt);
  if (!cleanQ) return null;

  const hasOptions = Array.isArray(question.options) && question.options.length > 0;
  const badAnswers = getBlacklistedAnswersForQuestion(question.prompt, blacklist);

  const matchesAnyOption = (ans) => {
    if (isAnswerBlacklisted(ans, badAnswers)) return false;
    if (!hasOptions) return true;
    const cleanA = cleanText(ans);
    return question.options.some((opt) => {
      const cOpt = cleanText(opt);
      return cOpt === cleanA || (cOpt.length >= 4 && (cOpt.includes(cleanA) || cleanA.includes(cOpt)));
    });
  };

  for (const item of sourceList) {
    const cp = item.cleanPrompt || cleanText(item.prompt);
    if (cp && cp === cleanQ) {
      if (matchesAnyOption(item.answer)) return item;
    }
  }

  for (const item of sourceList) {
    const cp = item.cleanPrompt || cleanText(item.prompt);
    if (cleanQ.length >= 25 && cp.length >= 25) {
      const ratio = Math.min(cleanQ.length, cp.length) / Math.max(cleanQ.length, cp.length);
      if (ratio >= 0.75 && (cleanQ.includes(cp) || cp.includes(cleanQ))) {
        if (matchesAnyOption(item.answer)) return item;
      }
    }
  }

  for (const item of sourceList) {
    const cp = item.cleanPrompt || cleanText(item.prompt);
    if (cp && wordOverlapRatio(cleanQ, cp) >= 0.65) {
      if (matchesAnyOption(item.answer)) return item;
    }
  }

  return null;
}

// Attempt page question Q1 (with "1 point" suffix)
const attemptQ1 = {
  prompt: 'Which of the following software development models can best respond to requirements changes? 1 point',
  options: ['The Waterfall model', 'The V-model', 'Agile models'],
};

// Even if sourceList STILL has the bad answer "The Waterfall model":
const testSourceWithBad = [
  {
    prompt: 'Which of the following software development models can best respond to requirements changes?',
    answer: 'The Waterfall model',
  },
];

const foundQ1 = findAnswerInSource(attemptQ1, testSourceWithBad, mockBlacklist);
assert.strictEqual(foundQ1, null, 'findAnswerInSource MUST return null for blacklisted answer "The Waterfall model"!');
console.log('✓ findAnswerInSource strictly rejected blacklisted answer and returned null');

console.log('--- TEST 2: Feedback Evaluation for Multi-Point Questions ---');

function evaluateFeedback(blockText) {
  let isError = false;
  let isSuccess = false;

  const scoreMatch = blockText.match(/\b(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(?:points?|điểm)?/i);
  if (scoreMatch) {
    const earned = parseFloat(scoreMatch[1]);
    const total = parseFloat(scoreMatch[2]);
    if (total > 0) {
      if (earned === total) isSuccess = true;
      else if (earned < total) isError = true;
    }
  }

  if (/\b(?:try\s+again|this\s+should\s+not\s+be\s+selected|incorrect|sai|0\s*điểm)\b/i.test(blockText)) {
    isError = true;
    isSuccess = false;
  }

  if (!isError && /\b(?:correct|đúng|100%)\b/i.test(blockText)) {
    isSuccess = true;
  }

  return { isError, isSuccess };
}

// Q1: 0/1 point with "Try again"
const q1Res = evaluateFeedback('0/1 point Try again Waterfall model is a sequential approach');
assert.strictEqual(q1Res.isError, true);
assert.strictEqual(q1Res.isSuccess, false);

// Q3: 0/2 points with "This should not be selected"
const q3Res = evaluateFeedback('0/2 points It is not suitable for big projects This should not be selected');
assert.strictEqual(q3Res.isError, true);
assert.strictEqual(q3Res.isSuccess, false);

// Correct question: 2/2 points
const qGoodRes = evaluateFeedback('2/2 points Correct! Well done.');
assert.strictEqual(qGoodRes.isError, false);
assert.strictEqual(qGoodRes.isSuccess, true);

console.log('✓ Multi-point and feedback phrase evaluation works accurately');

console.log('--- TEST 3: Multi-Select Checkbox Resolution ---');

function resolveCheckboxSelections(q, answerDef, qBlacklist = []) {
  const isBlacklisted = (opt) => qBlacklist.includes(cleanText(opt.text));

  let rawParts = [];
  if (Array.isArray(answerDef)) {
    rawParts = answerDef;
  } else if (answerDef.includes('|') || answerDef.includes('\n') || answerDef.includes(';')) {
    rawParts = answerDef.split(/[|\n;]/);
  } else if (/\b[A-Da-d](?:\s*,\s*[A-Da-d])+\b/.test(answerDef)) {
    rawParts = answerDef.split(/\s*,\s*/);
  } else {
    rawParts = [answerDef];
  }

  const cleanParts = rawParts.map((p) => cleanText(p)).filter(Boolean);
  const matchedOptionIndices = new Set();

  for (const part of cleanParts) {
    // Letter check
    const letterMatch = part.match(/^(?:option\s+|choice\s+)?([a-z])$/i);
    if (letterMatch) {
      const letterIdx = letterMatch[1].toLowerCase().charCodeAt(0) - 97;
      if (q.optionItems[letterIdx] && !isBlacklisted(q.optionItems[letterIdx])) {
        matchedOptionIndices.add(letterIdx);
        continue;
      }
    }

    // Exact match
    let partMatched = false;
    for (let oIdx = 0; oIdx < q.optionItems.length; oIdx++) {
      const opt = q.optionItems[oIdx];
      const cOpt = cleanText(opt.text);
      if (cOpt === part && !isBlacklisted(opt)) {
        matchedOptionIndices.add(oIdx);
        partMatched = true;
        break;
      }
    }

    // Substring match
    if (!partMatched) {
      for (let oIdx = 0; oIdx < q.optionItems.length; oIdx++) {
        const opt = q.optionItems[oIdx];
        const cOpt = cleanText(opt.text);
        if (cOpt.length >= 4 && part.length >= 4 && (cOpt.includes(part) || part.includes(cOpt)) && !isBlacklisted(opt)) {
          matchedOptionIndices.add(oIdx);
          partMatched = true;
          break;
        }
      }
    }
  }

  // Check expected count from prompt (e.g. "Select three")
  const countMatch = q.prompt.match(/\b(?:select|choose)\s+(two|three|four|five|\d+)\b/i);
  let expectedCount = 0;
  if (countMatch) {
    const wordMap = { two: 2, three: 3, four: 4, five: 5 };
    expectedCount = wordMap[countMatch[1].toLowerCase()] || parseInt(countMatch[1], 10) || 0;
  }

  // Auto-fill to satisfy expectedCount if needed
  if (expectedCount > 0 && matchedOptionIndices.size < expectedCount) {
    for (let oIdx = 0; oIdx < q.optionItems.length; oIdx++) {
      if (matchedOptionIndices.size >= expectedCount) break;
      const opt = q.optionItems[oIdx];
      if (!isBlacklisted(opt) && !matchedOptionIndices.has(oIdx)) {
        matchedOptionIndices.add(oIdx);
      }
    }
  }

  return Array.from(matchedOptionIndices).sort();
}

const qWaterFall = {
  type: 'checkbox',
  prompt: 'Which of the following are limitations of the waterfall model? Select three.',
  optionItems: [
    { text: 'Misinterpretations of requirements or design can remain undetected until the later development phases.' }, // Index 0
    { text: 'It is difficult to respond to requirements changes.' }, // Index 1
    { text: 'It is not suitable for big projects.' }, // Index 2 (Blacklisted!)
    { text: 'Integration issues may remain undetected until the last phase.' }, // Index 3
  ],
};

const qBlacklistWaterFall = [cleanText('It is not suitable for big projects.')];

// Case A: AI returns pipe-delimited answers for 3 correct options
const pickedA = resolveCheckboxSelections(
  qWaterFall,
  'Misinterpretations of requirements or design can remain undetected until the later development phases.|It is difficult to respond to requirements changes.|Integration issues may remain undetected until the last phase.',
  qBlacklistWaterFall
);
assert.deepStrictEqual(pickedA, [0, 1, 3], 'Must pick options 0, 1, 3');
console.log('✓ Pipe-delimited multi-choice correctly selected all 3 options');

// Case B: AI returns letters "A, B, D"
const pickedB = resolveCheckboxSelections(qWaterFall, 'A, B, D', qBlacklistWaterFall);
assert.deepStrictEqual(pickedB, [0, 1, 3], 'Must pick options 0, 1, 3 via letters');
console.log('✓ Letter format "A, B, D" correctly resolved and mapped to options');

// Case C: AI returns only 1 option (the old bug), but question says "Select three", and option 2 is blacklisted
const pickedC = resolveCheckboxSelections(
  qWaterFall,
  'Misinterpretations of requirements or design can remain undetected until the later development phases.',
  qBlacklistWaterFall
);
assert.deepStrictEqual(pickedC, [0, 1, 3], 'Must auto-fill remaining valid options to reach required 3 options!');
assert.ok(!pickedC.includes(2), 'Blacklisted option 2 must NEVER be selected!');
console.log('✓ Expected count fallback auto-fills all 3 required non-blacklisted checkboxes');

// Case D: Array format from LLM
const pickedD = resolveCheckboxSelections(
  qWaterFall,
  [
    'Misinterpretations of requirements or design can remain undetected until the later development phases.',
    'Integration issues may remain undetected until the last phase.',
  ],
  qBlacklistWaterFall
);
assert.deepStrictEqual(pickedD, [0, 1, 3], 'Array format safely handled and auto-filled to 3');
console.log('✓ Array format from LLM response safely handled');

console.log('\n======================================================');
console.log('🎉 ALL SMART RETAKE & CHECKBOX TESTS PASSED 100%!');
console.log('======================================================');
