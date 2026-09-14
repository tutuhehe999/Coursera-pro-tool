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

console.log('--- TEST 1: Purge Poisoned Cache from Local Course Source ---');

function purgeSource(existingSource, blacklistMap) {
  return existingSource.filter((item) => {
    const cp = item.cleanPrompt || cleanText(item.prompt);
    const blacklisted = blacklistMap[cp] || [];
    if (blacklisted.length === 0) return true;

    const itemAns = cleanText(item.answer);
    const isBad = blacklisted.some((bad) => {
      const cBad = cleanText(bad);
      return cBad === itemAns || (cBad.length >= 4 && itemAns.length >= 4 && (cBad.includes(itemAns) || itemAns.includes(cBad)));
    });

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

const mockBlacklist = {
  [cleanText('Which of the following software development models can best respond to requirements changes?')]: [
    cleanText('The Waterfall model'),
  ],
  [cleanText('In which of the following software development models are the software development activities performed sequentially rather than in iterations?')]: [
    cleanText('Agile models'),
  ],
  [cleanText('Which of the following are limitations of the waterfall model? Select three.')]: [
    cleanText('It is not suitable for big projects'),
  ],
};

const purged = purgeSource(mockSource, mockBlacklist);
assert.strictEqual(purged.length, 1, 'All 3 poisoned answers must be purged from source!');
assert.strictEqual(purged[0].prompt, 'What is Scrum?');
console.log('✓ Poisoned cache purged cleanly from course source');

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
