/**
 * Test suite to verify all logic, edge cases, matching algorithms, and regexes.
 * Run with: node test/test-logic.js
 */

const assert = require('assert');

// 1. Test HTML Entity Decoding
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

// 2. Test Updated cleanText
function cleanText(str) {
  if (!str) return '';
  let text = decodeHtml(String(str));
  return text
    .toLowerCase()
    .replace(/^\s*(?:question\s*\d+[\s:.-]*|\d+[.):]\s+|[a-z0-9]{1,2}[.):]\s+)/i, '') // remove "Question 1:", "10. ", "A. "
    .replace(/(?<!\d)\.|\.(?!\d)/g, '') // remove dots that are NOT decimal points between digits
    .replace(/[,;:!?"'‘’“”`~()\[\]{}]/g, '') // remove other typographical punctuation, preserve math: < > = + - * / % ^
    .replace(/\s+/g, ' ')
    .trim();
}

console.log('--- Testing cleanText & Math Preservations ---');

// Test decimals preservation
const t1 = cleanText('10.5%');
assert.strictEqual(t1, '10.5%', `Expected 10.5%, got ${t1}`);
console.log('✓ 10.5% preserved properly');

const t2 = cleanText('Question 12: What is 2 + 2?');
assert.strictEqual(t2, 'what is 2 + 2', `Expected "what is 2 + 2", got "${t2}"`);
console.log('✓ "Question 12:" stripped cleanly, "+" preserved');

const t3a = cleanText('x >= 0');
const t3b = cleanText('x <= 0');
assert.notStrictEqual(t3a, t3b, 'x >= 0 and x <= 0 must NOT be equal!');
console.log('✓ Relational operators >= and <= remain distinct');

const t4a = cleanText('A. Machine Learning');
assert.strictEqual(t4a, 'machine learning', `Expected "machine learning", got "${t4a}"`);
console.log('✓ "A. " option label stripped cleanly');

// 3. Test Option Matching Algorithm
function matchBestOption(options, answerDef, isRadio = true) {
  const cleanAns = cleanText(answerDef);
  if (!cleanAns) return [];

  // Single letter match: 'a', 'b', 'c', 'd'
  if (isRadio && cleanAns.length === 1 && cleanAns >= 'a' && cleanAns <= 'z') {
    const idx = cleanAns.charCodeAt(0) - 97;
    if (options[idx]) return [options[idx]];
  }

  // Checkbox multiple target matching
  if (!isRadio) {
    const parts = answerDef.split(/[|\n;]/).map((p) => cleanText(p)).filter(Boolean);
    const matched = [];
    for (const part of parts) {
      for (const opt of options) {
        const cOpt = cleanText(opt.text);
        if (cOpt === part || (part.length >= 4 && cOpt.includes(part)) || (cOpt.length >= 4 && part.includes(cOpt))) {
          if (!matched.includes(opt)) matched.push(opt);
        }
      }
    }
    return matched;
  }

  // Radio matching: find EXACTLY ONE best match!
  // Pass 1: Exact match
  for (const opt of options) {
    if (cleanText(opt.text) === cleanAns) {
      return [opt];
    }
  }

  // Pass 2: Prefix / Suffix match
  for (const opt of options) {
    const cOpt = cleanText(opt.text);
    if (cOpt.length >= 4 && cleanAns.length >= 4) {
      if (cOpt.startsWith(cleanAns) || cleanAns.startsWith(cOpt)) {
        return [opt];
      }
    }
  }

  // Pass 3: Highest overlap score
  let bestOpt = null;
  let bestScore = 0;
  const ansWords = new Set(cleanAns.split(' ').filter((w) => w.length > 2));

  for (const opt of options) {
    const cOpt = cleanText(opt.text);
    const optWords = cOpt.split(' ').filter((w) => w.length > 2);
    let overlap = 0;
    for (const w of optWords) {
      if (ansWords.has(w)) overlap++;
    }
    const score = optWords.length > 0 ? overlap / Math.max(ansWords.size, optWords.length) : 0;
    if (score > bestScore && score > 0.4) {
      bestScore = score;
      bestOpt = opt;
    }
  }

  return bestOpt ? [bestOpt] : [];
}

console.log('--- Testing Radio Overwrite Bug Fix ---');
const optionsRadio = [
  { id: 'optA', text: 'Machine Learning' },
  { id: 'optB', text: 'Machine' },
  { id: 'optC', text: 'Deep Learning' },
  { id: 'optD', text: 'Artificial Intelligence' },
];

// Target answer is "Machine Learning"
const matchedRadio = matchBestOption(optionsRadio, 'Machine Learning', true);
assert.strictEqual(matchedRadio.length, 1, 'Should match exactly 1 radio option');
assert.strictEqual(matchedRadio[0].id, 'optA', 'Must match "Machine Learning", NOT "Machine"!');
console.log('✓ Radio matching selected optA ("Machine Learning") without being overwritten by optB ("Machine")');

// Test single letter matching
const matchedLetter = matchBestOption(optionsRadio, 'B', true);
assert.strictEqual(matchedLetter.length, 1);
assert.strictEqual(matchedLetter[0].id, 'optB', 'Letter "B" must match optB');
console.log('✓ Letter "B" successfully matched optB');

// 4. Test Source Verification against Options
function verifySourceAnswerAgainstOptions(answer, options) {
  if (!options || options.length === 0) return true;
  const cleanA = cleanText(answer);
  if (!cleanA) return false;
  return options.some((opt) => {
    const cOpt = cleanText(opt);
    return cOpt === cleanA || (cOpt.length >= 4 && (cOpt.includes(cleanA) || cleanA.includes(cOpt)));
  });
}

console.log('--- Testing Source Cache Verification ---');
const validAnswer = verifySourceAnswerAgainstOptions('Supervised Learning', ['Unsupervised Learning', 'Supervised Learning', 'Reinforcement Learning']);
assert.strictEqual(validAnswer, true);
console.log('✓ Valid answer verified against options');

const invalidAnswer = verifySourceAnswerAgainstOptions('This is a hallucinated explanation from AI', ['Option 1', 'Option 2', 'Option 3']);
assert.strictEqual(invalidAnswer, false);
console.log('✓ Hallucinated answer correctly rejected from poisoning Source Cache');

// 5. Test Shareable Review Link Generator
function buildShareableReviewLink(courseSlug, itemId, submissionId, assignmentSlug = 'course-project') {
  if (!courseSlug || !itemId || !submissionId) return null;
  const cleanSlug = courseSlug.toLowerCase().trim();
  const cleanItem = itemId.trim();
  const cleanSub = submissionId.trim();
  const cleanAssign = (assignmentSlug || 'course-project').trim();
  return `https://www.coursera.org/learn/${cleanSlug}/peer/${cleanItem}/${cleanAssign}/review/${cleanSub}`;
}

console.log('--- Testing Shareable Link Generator ---');
const sampleLink = buildShareableReviewLink('research-methods', 'VZzmN', '9jDP3622EtGdYA791OQB_Q', 'from-proposal-to-peer-review-practicing-as-a-researcher');
assert.strictEqual(
  sampleLink,
  'https://www.coursera.org/learn/research-methods/peer/VZzmN/from-proposal-to-peer-review-practicing-as-a-researcher/review/9jDP3622EtGdYA791OQB_Q',
  'Shareable link must match official Coursera peer review route with assignmentSlug'
);
assert.strictEqual(buildShareableReviewLink('', 'xyz', '123'), null, 'Empty courseSlug must return null');
assert.strictEqual(buildShareableReviewLink('course', '', '123'), null, 'Empty itemId must return null');
assert.strictEqual(buildShareableReviewLink('course', 'xyz', ''), null, 'Empty submissionId must return null');
console.log('✓ Shareable Review Link generated and validated correctly');

// 6. Test Disable AI GraphQL Payload Construction
function createDisableAiMutationPayload(courseId, itemId, submissionId, reason = 'EXPECTED_HIGHER_SCORE') {
  return [
    {
      operationName: 'RequestGradingByPeer',
      variables: {
        input: {
          courseId,
          itemId,
          submissionId,
          reason,
        },
      },
      query: `mutation RequestGradingByPeer($input: PeerReviewAi_RequestGradingByPeerInput!) {
  PeerReviewAi_RequestGradingByPeer(input: $input) {
    submissionId
    __typename
  }
}`,
    },
  ];
}

console.log('--- Testing Disable AI GraphQL Payload ---');
const payload = createDisableAiMutationPayload('course-99', 'item-88', 'sub-77');
assert.strictEqual(payload.length, 1);
assert.strictEqual(payload[0].operationName, 'RequestGradingByPeer');
assert.strictEqual(payload[0].variables.input.reason, 'EXPECTED_HIGHER_SCORE');
assert.strictEqual(payload[0].variables.input.submissionId, 'sub-77');
assert.ok(payload[0].query.includes('PeerReviewAi_RequestGradingByPeer'));
console.log('✓ Disable AI GraphQL mutation payload verified');

// 7. Test Multi-Provider AI Payload & Config
console.log('--- Testing Multi-Provider AI Routing ---');
const PROVIDER_MODELS = {
  gemini: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
};

function validateProviderModel(provider, model) {
  const allowed = PROVIDER_MODELS[provider];
  if (!allowed) return false;
  return allowed.includes(model);
}

assert.strictEqual(validateProviderModel('gemini', 'gemini-2.5-flash'), true);
assert.strictEqual(validateProviderModel('gemini', 'deepseek-chat'), false);
assert.strictEqual(validateProviderModel('deepseek', 'deepseek-reasoner'), true);
assert.strictEqual(validateProviderModel('groq', 'llama-3.3-70b-versatile'), true);
assert.strictEqual(validateProviderModel('groq', 'gemini-2.5-flash'), false);
console.log('✓ Multi-Provider model validation verified for Gemini, DeepSeek, Groq');

function buildOpenAiPayload(model, prompt, systemInstruction, responseSchema) {
  const messages = [];
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
  messages.push({ role: 'user', content: prompt });
  const payload = {
    model,
    messages,
    temperature: responseSchema ? 0.1 : 0.7,
  };
  if (responseSchema) payload.response_format = { type: 'json_object' };
  return payload;
}

const deepseekReq = buildOpenAiPayload('deepseek-chat', 'Hello', 'Act as professor', { type: 'object' });
assert.strictEqual(deepseekReq.model, 'deepseek-chat');
assert.strictEqual(deepseekReq.messages.length, 2);
assert.strictEqual(deepseekReq.messages[0].role, 'system');
assert.strictEqual(deepseekReq.response_format.type, 'json_object');
console.log('✓ OpenAI-compatible Chat Completions payload verified for DeepSeek & Groq');

// 8. Test Smart Retake Blacklist Exclusion
console.log('--- Testing Smart Retake Blacklist Algorithm ---');
function matchWithSmartRetakeBlacklist(options, targetAnswer, blacklistForQuestion = []) {
  const cleanAns = cleanText(targetAnswer);
  const cleanBlacklist = blacklistForQuestion.map((b) => cleanText(b));

  // Filter out any option present in blacklist
  const validOptions = options.filter((opt) => !cleanBlacklist.includes(cleanText(opt.text)));

  // Try exact match in valid options
  for (const opt of validOptions) {
    if (cleanText(opt.text) === cleanAns) {
      return opt;
    }
  }

  // Fallback to remaining valid option if target answer was blacklisted
  return validOptions.length > 0 ? validOptions[0] : null;
}

const retakeOptions = [
  { id: 'optA', text: 'Option A (Wrong from Attempt 1)' },
  { id: 'optB', text: 'Option B (Correct Answer)' },
  { id: 'optC', text: 'Option C (Wrong from Attempt 2)' },
];

// Attempt 1: optA was chosen and marked wrong
const attempt1Blacklist = ['Option A (Wrong from Attempt 1)'];
// AI mistakenly suggests optA again, but tool MUST reject optA and pick another valid option!
const attempt2Pick = matchWithSmartRetakeBlacklist(retakeOptions, 'Option A (Wrong from Attempt 1)', attempt1Blacklist);
assert.notStrictEqual(attempt2Pick.id, 'optA', 'Blacklisted Option A must NEVER be chosen!');
assert.ok(attempt2Pick.id === 'optB' || attempt2Pick.id === 'optC', 'Must select an un-blacklisted alternative');
console.log('✓ Smart Retake successfully rejected blacklisted wrong answer');

// When target is Option B
const correctPick = matchWithSmartRetakeBlacklist(retakeOptions, 'Option B (Correct Answer)', attempt1Blacklist);
assert.strictEqual(correctPick.id, 'optB', 'Must pick Option B when correct and not blacklisted');
console.log('✓ Smart Retake picks correct answer Option B');

// 9. Test Video Playback Speed Presets & Cycling
console.log('--- Testing Video Speed Presets & Cycling ---');
const SPEED_PRESETS = [1, 1.25, 1.5, 2, 2.5, 3, 4];
function cycleSpeed(current) {
  const currentIndex = SPEED_PRESETS.findIndex((s) => Math.abs(s - current) < 0.05);
  const nextIndex = currentIndex === -1 || currentIndex >= SPEED_PRESETS.length - 1 ? 0 : currentIndex + 1;
  return SPEED_PRESETS[nextIndex];
}

assert.strictEqual(cycleSpeed(1), 1.25);
assert.strictEqual(cycleSpeed(2), 2.5);
assert.strictEqual(cycleSpeed(4), 1, 'Cycling after 4x must wrap to 1x');
console.log('✓ Video playback speed cycling math verified (1x -> 1.25x -> ... -> 4x -> 1x)');

// 10. Test Hotkeys Event Shielding
console.log('--- Testing Hotkeys Event Shielding ---');
function shouldIgnoreHotkey(activeElementTag, isContentEditable = false) {
  if (isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElementTag.toUpperCase());
}

assert.strictEqual(shouldIgnoreHotkey('INPUT'), true, 'Must ignore hotkeys when typing in INPUT');
assert.strictEqual(shouldIgnoreHotkey('TEXTAREA'), true, 'Must ignore hotkeys when typing in TEXTAREA');
assert.strictEqual(shouldIgnoreHotkey('DIV', true), true, 'Must ignore hotkeys in contenteditable');
assert.strictEqual(shouldIgnoreHotkey('BODY', false), false, 'Must allow hotkeys when focus is on BODY');
assert.strictEqual(shouldIgnoreHotkey('BUTTON', false), false, 'Must allow hotkeys when focus is on BUTTON');
console.log('✓ Hotkeys safely shielded from intercepting student typing');

// 11. Test Peer Assignment JSON Parsing & Structure Validation
console.log('--- Testing Peer Assignment Response Structure ---');
function validateAssignmentSubmission(parsedObj) {
  if (!parsedObj || typeof parsedObj !== 'object') return false;
  if (!parsedObj.title || typeof parsedObj.title !== 'string') return false;
  if (!Array.isArray(parsedObj.sections) || parsedObj.sections.length === 0) return false;
  return true;
}

const mockAiSubmission = {
  title: 'Research Methodology and Empirical Analysis of Distributed Systems',
  sections: [
    'Section 1: Theoretical foundation and qualitative review...',
    'Section 2: Empirical validation metrics and benchmarking results...',
  ],
  url: 'https://github.com/academic-projects/coursera-final-submission',
};
assert.strictEqual(validateAssignmentSubmission(mockAiSubmission), true);
assert.strictEqual(validateAssignmentSubmission({}), false);
assert.strictEqual(validateAssignmentSubmission({ title: 'T' }), false);
console.log('✓ Peer Assignment JSON structure validated');

// 12. Test Peer Review Loop & Rubric Point Scoring
console.log('--- Testing Auto Peer Review Algorithms ---');
function checkReviewRequirement(bodyText) {
  const t = (bodyText || '').toLowerCase();
  if (
    t.includes("you've finished your peer reviews") ||
    t.includes('you have finished your peer reviews') ||
    t.includes('you have reviewed all ungraded submissions') ||
    t.includes('0 left to complete') ||
    t.includes('0 more to complete')
  ) {
    return true;
  }
  const countMatch =
    t.match(/reviews\s*:\s*(\d+)\s*of\s*(\d+)\s*complete/i) ||
    t.match(/(\d+)\s*of\s*(\d+)\s*(?:reviews?\s*)?complete/i);
  if (countMatch && countMatch[1] && countMatch[2]) {
    const done = parseInt(countMatch[1], 10);
    const required = parseInt(countMatch[2], 10);
    if (done >= required && required > 0) return true;
  }
  return false;
}

function getRemainingReviewsCount(content) {
  if (!content) return null;
  const lower = content.toLowerCase();

  if (
    lower.includes("you've finished your peer reviews") ||
    lower.includes('you have finished your peer reviews') ||
    lower.includes('you have reviewed all ungraded submissions') ||
    lower.includes('all reviews complete') ||
    lower.includes('0 left to complete') ||
    lower.includes('0 more to complete') ||
    lower.includes('đã hoàn thành tất cả các bài chấm') ||
    lower.includes('0 bài cần chấm')
  ) {
    return 0;
  }

  const leftMatch = content.match(/(\d+)\s*(?:left\s*to\s*complete|more\s*to\s*complete)/i);
  if (leftMatch) {
    return parseInt(leftMatch[1], 10);
  }

  const morePeersMatch = content.match(/review\s+(\d+)\s+more\s+peers?/i);
  if (morePeersMatch) {
    return parseInt(morePeersMatch[1], 10);
  }

  const ofMatch =
    content.match(/reviews?\s*:\s*(\d+)\s*of\s*(\d+)\s*complete/i) ||
    content.match(/(\d+)\s*of\s*(\d+)\s*(?:reviews?\s*)?complete/i);
  if (ofMatch) {
    const done = parseInt(ofMatch[1], 10);
    const required = parseInt(ofMatch[2], 10);
    return Math.max(0, required - done);
  }

  const orMoreMatch = content.match(/review\s+(\d+)\s+or\s+more\s+assignment\s+submissions/i);
  if (orMoreMatch) {
    return parseInt(orMoreMatch[1], 10);
  }

  const viMatch =
    content.match(/cần\s*chấm\s*(?:thêm\s*)?(\d+)\s*bài/i) ||
    content.match(/còn\s*lại\s*(\d+)\s*bài/i) ||
    content.match(/(\d+)\s*bài\s*(?:còn\s*lại|cần\s*chấm)/i);
  if (viMatch) {
    return parseInt(viMatch[1], 10);
  }

  return null;
}

assert.strictEqual(getRemainingReviewsCount('Reviews 4 left to complete'), 4);
assert.strictEqual(getRemainingReviewsCount('Reviews\n4 left to complete'), 4);
assert.strictEqual(getRemainingReviewsCount('4 left to complete'), 4);
assert.strictEqual(getRemainingReviewsCount('0 left to complete'), 0);
assert.strictEqual(getRemainingReviewsCount('Reviews: 1 of 4 complete'), 3);
assert.strictEqual(getRemainingReviewsCount('Reviews: 4 of 4 complete'), 0);
assert.strictEqual(getRemainingReviewsCount('Review 2 more peers to get your grade'), 2);
assert.strictEqual(getRemainingReviewsCount('Review 4 or more assignment submissions to receive a grade'), 4);
assert.strictEqual(getRemainingReviewsCount("You've finished your peer reviews. Well done!"), 0);
assert.strictEqual(getRemainingReviewsCount("Cần chấm thêm 3 bài nữa để nhận điểm"), 3);
console.log('✓ getRemainingReviewsCount parses exact remaining reviews count across all variations');

function getCurrentPeerAssignmentPath(url) {
  if (!url) return '';
  const m = String(url).match(/(\/learn\/[^/]+\/peer\/[^/]+\/[^/?#]+)/i);
  return m ? m[1] : '';
}

assert.strictEqual(
  getCurrentPeerAssignmentPath('https://www.coursera.org/learn/engineering-practices-secure-software-quality/peer/fKSZW/static-analysis/give-feedback'),
  '/learn/engineering-practices-secure-software-quality/peer/fKSZW/static-analysis'
);
assert.strictEqual(
  getCurrentPeerAssignmentPath('https://www.coursera.org/learn/engineering-practices-secure-software-quality/peer/fKSZW/static-analysis/review-next'),
  '/learn/engineering-practices-secure-software-quality/peer/fKSZW/static-analysis'
);
console.log('✓ getCurrentPeerAssignmentPath isolates course & peer assignment base path');

function isSameAssignmentLink(href, currentBasePath) {
  if (!href || !currentBasePath) return true;
  if (href.includes('/peer/')) {
    return href.includes(currentBasePath);
  }
  return true;
}

assert.strictEqual(
  isSameAssignmentLink(
    '/learn/engineering-practices-secure-software-quality/peer/fKSZW/static-analysis/review/12345',
    '/learn/engineering-practices-secure-software-quality/peer/fKSZW/static-analysis'
  ),
  true
);
assert.strictEqual(
  isSameAssignmentLink(
    '/learn/engineering-practices-secure-software-quality/peer/r96Hl/assessing-quality-through-scenarios/give-feedback',
    '/learn/engineering-practices-secure-software-quality/peer/fKSZW/static-analysis'
  ),
  false
);
console.log('✓ isSameAssignmentLink prevents navigation to previous assignments');

function isInsideNavigationSidebar(selectorPath) {
  const sidebarIndicators = ['nav', 'aside', '[role="navigation"]', 'navigationdrawer', 'courseoutline', 'sidebar'];
  const lower = selectorPath.toLowerCase();
  return sidebarIndicators.some((ind) => lower.includes(ind));
}

assert.strictEqual(isInsideNavigationSidebar('div.rc-NavigationDrawer > ul > li > a'), true);
assert.strictEqual(isInsideNavigationSidebar('aside.rc-CourseOutline a[href*="give-feedback"]'), true);
assert.strictEqual(isInsideNavigationSidebar('div.rc-GiveFeedbackMainContent button.start-review-button'), false);
console.log('✓ isInsideNavigationSidebar correctly detects and filters out course outline/sidebar');

console.log('\n========================================');
console.log('🎉 ALL 13 LOGIC AND ALGORITHM TESTS PASSED!');
console.log('========================================');



