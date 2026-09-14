import assert from 'assert';

console.log('======================================================');
console.log('🧪 COURSERA PRO TOOL - AUTO DISCUSSION UNIT TESTS');
console.log('======================================================\n');

// 1. Test isDiscussionAlreadySubmitted
console.log('--- 1. Testing isDiscussionAlreadySubmitted Text & Condition Matching ---');

function mockIsDiscussionAlreadySubmitted(pageText, buttonTexts = [], selectorMatches = []) {
  if (selectorMatches.length > 0) return true;

  if (
    pageText.includes('You have submitted a response') ||
    pageText.includes('You submitted this response') ||
    pageText.includes('Your response has been submitted') ||
    pageText.includes('Đã gửi phản hồi')
  ) {
    return true;
  }

  for (const txt of buttonTexts) {
    const t = txt.trim().toLowerCase();
    if (
      t === 'edit response' ||
      t === 'chỉnh sửa phản hồi' ||
      t === 'edit reply' ||
      t === 'view my response'
    ) {
      return true;
    }
  }

  return false;
}

// Ensure "0 learners have submitted a response" DOES NOT trigger already submitted!
const emptyPromptPageText = `
Commenting vs. Self-documentation
Two strong opinions on this one. Do you rely on one more than the other?
Participation is optional
Your Reply
Type your response here...
Reply
0 learners have submitted a response.
`;
assert.strictEqual(
  mockIsDiscussionAlreadySubmitted(emptyPromptPageText, ['Reply']),
  false,
  '"0 learners have submitted a response" must NOT be detected as already submitted'
);
console.log('✓ "0 learners have submitted a response" correctly evaluated as NOT submitted');

// Ensure user submission DOES trigger already submitted
const submittedPromptPageText = `
Commenting vs. Self-documentation
You have submitted a response.
Your submission was recorded.
`;
assert.strictEqual(
  mockIsDiscussionAlreadySubmitted(submittedPromptPageText, ['Edit Response']),
  true,
  '"You have submitted a response" must be detected as already submitted'
);
console.log('✓ "You have submitted a response" correctly detected as submitted');

// 2. Test Submit Button Matching
console.log('\n--- 2. Testing Submit / Reply Button Text Resolution ---');

function mockFindSubmitButton(buttonList) {
  const validButtonTexts = [
    'reply',
    'submit',
    'post',
    'post reply',
    'submit reply',
    'post response',
    'submit response',
    'gửi phản hồi',
    'đăng phản hồi',
    'trả lời',
    'gửi',
    'send',
  ];

  for (const btn of buttonList) {
    const txt = (btn.text || '').trim().toLowerCase();
    if (
      validButtonTexts.includes(txt) ||
      (txt.startsWith('reply') && txt.length <= 15 && !txt.includes('to prompt'))
    ) {
      return btn;
    }
  }
  return null;
}

const buttonsOnPage = [
  { text: 'Cancel', disabled: false },
  { text: 'Reply', disabled: true }, // The target button!
];
const found = mockFindSubmitButton(buttonsOnPage);
assert.ok(found, 'Should find Reply button');
assert.strictEqual(found.text, 'Reply');
console.log('✓ "Reply" button successfully detected as submission button');

const buttonsWithOpener = [
  { text: 'Reply to prompt', disabled: false },
  { text: 'Reply', disabled: false },
];
const foundReply = mockFindSubmitButton(buttonsWithOpener);
assert.strictEqual(foundReply.text, 'Reply', 'Must distinguish "Reply" from "Reply to prompt"');
console.log('✓ "Reply" distinguished correctly from "Reply to prompt"');

// 3. Test Queue Prioritization
console.log('\n--- 3. Testing Queue Prioritization for Active Page Item ---');

function prioritizeCurrentDiscussion(discussions, currentItemId) {
  if (!currentItemId) return discussions;
  const list = [...discussions];
  const idx = list.findIndex((d) => d.id === currentItemId);
  if (idx >= 0) {
    const [curr] = list.splice(idx, 1);
    list.unshift(curr);
  } else {
    list.unshift({
      id: currentItemId,
      name: 'Current Discussion',
      url: `https://coursera.org/learn/course/item/${currentItemId}`,
    });
  }
  return list;
}

const sampleDiscussions = [
  { id: 'item_week1', name: 'Week 1 Discussion' },
  { id: 'QtTkd', name: 'Commenting vs. Self-documentation' },
  { id: 'item_week3', name: 'Week 3 Discussion' },
];

const prioritized = prioritizeCurrentDiscussion(sampleDiscussions, 'QtTkd');
assert.strictEqual(prioritized[0].id, 'QtTkd', 'Current page item QtTkd must be prioritized to index 0');
assert.strictEqual(prioritized.length, 3);
console.log('✓ Active discussion item (QtTkd) successfully shifted to index 0');

// 4. Test Service Worker Response Handling
console.log('\n--- 4. Testing Service Worker Status Forwarding ---');

function handleWorkerResult(res) {
  if (res?.alreadySubmitted) {
    return { status: 'alreadySubmitted', success: true };
  } else if (res?.success === true) {
    return { status: 'submitted', success: true };
  } else {
    return { status: 'failed', success: false, error: res?.error || 'Unknown error' };
  }
}

assert.deepStrictEqual(handleWorkerResult({ success: true, alreadySubmitted: true }), {
  status: 'alreadySubmitted',
  success: true,
});
assert.deepStrictEqual(handleWorkerResult({ success: true }), {
  status: 'submitted',
  success: true,
});
assert.deepStrictEqual(handleWorkerResult({ success: false, error: 'Worker: Textarea not found.' }), {
  status: 'failed',
  success: false,
  error: 'Worker: Textarea not found.',
});
console.log('✓ Worker results and errors handled accurately without false positive success');

console.log('\n======================================================');
console.log('🎉 ALL DISCUSSION LOGIC & ALGORITHM TESTS PASSED 100%!');
console.log('======================================================\n');
