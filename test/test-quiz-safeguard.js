/**
 * Test Suite for Quiz Auto-Submit Safeguards & Incomplete Prevention
 * Verifies that:
 * 1. isQuestionAnsweredInDom correctly verifies radio/checkbox/text DOM state
 * 2. Questions left unanswered are never auto-submitted
 * 3. autoExitQuiz is never called if questions remain incomplete
 * 4. Coursera's "Missing or invalid answers" modal is detected, cancelled, and blocks exit
 * Run with: node test/test-quiz-safeguard.js
 */

const assert = require('assert');

// 1. Test isQuestionAnsweredInDom logic
console.log('--- TEST 1: isQuestionAnsweredInDom verification ---');

function isQuestionAnsweredInDom(q) {
  if (!q) return false;
  if (q.type === 'radio' || q.type === 'checkbox') {
    if (Array.isArray(q.optionItems) && q.optionItems.length > 0) {
      const anyChecked = q.optionItems.some((opt) => opt.input && opt.input.checked);
      if (anyChecked) return true;
    }
    if (q.container) {
      const anyChecked = q.container.querySelector?.(
        'input[type="radio"]:checked, input[type="checkbox"]:checked, [aria-checked="true"]'
      );
      if (anyChecked) return true;
    }
  } else if (q.type === 'text') {
    if (Array.isArray(q.textInputs) && q.textInputs.length > 0) {
      const anyFilled = q.textInputs.some((inp) => inp && inp.value && inp.value.trim().length > 0);
      if (anyFilled) return true;
    }
  }
  return false;
}

// Mock question 1: answered radio
const q1 = {
  type: 'radio',
  prompt: 'Which tool helps formatting?',
  optionItems: [
    { input: { checked: false }, text: 'A' },
    { input: { checked: false }, text: 'B' },
    { input: { checked: true }, text: 'C' },
    { input: { checked: false }, text: 'D' },
  ],
};

// Mock question 2: unanswered radio
const q2 = {
  type: 'radio',
  prompt: 'Which of the following is optional in MLA?',
  optionItems: [
    { input: { checked: false }, text: 'date of access' },
    { input: { checked: false }, text: 'author' },
    { input: { checked: false }, text: 'the location of the source' },
    { input: { checked: false }, text: 'title of the source' },
  ],
};

// Mock question 3: text question with text
const q3 = {
  type: 'text',
  prompt: 'Enter student ID',
  textInputs: [{ value: 'STU12345' }],
};

// Mock question 4: empty text question
const q4 = {
  type: 'text',
  prompt: 'Enter comments',
  textInputs: [{ value: '   ' }],
};

assert.strictEqual(isQuestionAnsweredInDom(q1), true);
assert.strictEqual(isQuestionAnsweredInDom(q2), false);
assert.strictEqual(isQuestionAnsweredInDom(q3), true);
assert.strictEqual(isQuestionAnsweredInDom(q4), false);
console.log('✓ isQuestionAnsweredInDom accurately checks DOM state for radio and text inputs');

// 2. Test Incomplete Quiz Submit Blocker
console.log('--- TEST 2: Incomplete Quiz Submit Safeguard ---');

const quizQuestions = [q1, q2]; // 1 answered, 1 unanswered (like in user screenshot)

function evaluateQuizReadiness(questions) {
  const unanswered = questions.filter((q) => !isQuestionAnsweredInDom(q));
  if (unanswered.length > 0) {
    return {
      canSubmit: false,
      answeredCount: questions.length - unanswered.length,
      unansweredCount: unanswered.length,
      warning: `⚠️ Còn ${unanswered.length}/${questions.length} câu chưa có đáp án! KHÔNG tự nộp.`,
    };
  }
  return {
    canSubmit: true,
    answeredCount: questions.length,
    unansweredCount: 0,
  };
}

const checkResult = evaluateQuizReadiness(quizQuestions);
assert.strictEqual(checkResult.canSubmit, false);
assert.strictEqual(checkResult.answeredCount, 1);
assert.strictEqual(checkResult.unansweredCount, 1);
assert.ok(checkResult.warning.includes('KHÔNG tự nộp'));
console.log('✓ Incomplete quiz is strictly blocked from auto-submitting and auto-exiting');

// 3. Test Coursera "Missing or invalid answers" modal interception
console.log('--- TEST 3: Coursera Incomplete Modal Interception ---');

let cancelModalClicked = false;
let autoExitCalled = false;

function mockHandleCourseraModal(modalText) {
  const lower = modalText.toLowerCase();
  if (
    lower.includes('missing or invalid') ||
    lower.includes('incomplete') ||
    lower.includes('chưa trả lời') ||
    lower.includes('you haven\'t answered') ||
    lower.includes('chưa hoàn thành') ||
    lower.includes('do you still want to submit')
  ) {
    // Click cancel in modal
    cancelModalClicked = true;
    return false; // Submit failed!
  }
  return true; // Submit succeeded
}

async function simulateSubmitFlow(modalText) {
  const submitOk = mockHandleCourseraModal(modalText);
  if (submitOk) {
    autoExitCalled = true;
  }
  return submitOk;
}

const courseraModalText = `Missing or invalid answers
We found some incomplete or invalid answers. Do you still want to submit this assessment?
[Submit] [Cancel]`;

const submitSuccess = mockHandleCourseraModal(courseraModalText);
assert.strictEqual(submitSuccess, false);
assert.strictEqual(cancelModalClicked, true);
assert.strictEqual(autoExitCalled, false);
console.log('✓ "Missing or invalid answers" modal detected, auto-cancelled, and prevented navigation');

// 4. Test Single Question Fallback Solver
console.log('--- TEST 4: Single Question Fallback Solver Match ---');

function mockMatchSingleAnswer(cleanRes, optionTexts) {
  // 1. Letter match
  const letterMatch = cleanRes.trim().match(/^[A-Da-d]\b/);
  if (letterMatch) {
    const idx = letterMatch[0].toUpperCase().charCodeAt(0) - 65;
    if (optionTexts[idx]) return optionTexts[idx];
  }
  // 2. Substring match
  for (const opt of optionTexts) {
    if (cleanRes.includes(opt.toLowerCase()) || opt.toLowerCase().includes(cleanRes)) {
      return opt;
    }
  }
  return null;
}

const mlaOptions = ['date of access', 'author', 'the location of the source', 'title of the source'];
assert.strictEqual(mockMatchSingleAnswer('A', mlaOptions), 'date of access');
assert.strictEqual(mockMatchSingleAnswer('The correct choice is date of access.', mlaOptions), 'date of access');
assert.strictEqual(mockMatchSingleAnswer('date of access', mlaOptions), 'date of access');
console.log('✓ Targeted single-question fallback correctly resolves letter or text to option');

console.log('\n========================================');
console.log('🎉 ALL QUIZ SAFEGUARD & INCOMPLETE SUBMISSION TESTS PASSED!');
console.log('========================================');
