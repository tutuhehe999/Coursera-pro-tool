/**
 * Coursera Pro Tool - Auto Peer Review Module
 * Automates peer review submission, grading, and multi-review loop until requirement is met
 */

import { waitForSelector, sleep, safeClick, simulateInput, simulateTyping, selectOptionElement } from '../utils/dom.js';
import { showToast, updateProgress } from '../ui/panel.js';

const SAMPLE_REVIEWS = [
  'Excellent work on this research assignment. The primary research question is well-defined, focused, and directly addresses a meaningful gap in the literature. The proposed methodology is practical, logically structured, and demonstrates a thorough understanding of the relevant academic frameworks.',
  'This is a comprehensive and well-articulated submission. The author provides clear background rationale, supports key claims with relevant context, and outlines a sound research approach. The ethical considerations are thoughtfully addressed, ensuring strong academic rigor throughout.',
  'Very impressive research proposal. The problem statement is stated with exceptional clarity, and the transition from theoretical background to practical research methods is coherent and seamless. All rubric criteria have been fully satisfied with impressive detail.',
  'Great effort and solid execution. The presentation is clear, easy to follow, and directly addresses every aspect of the project guidelines. The methodology aligns well with the stated objectives, and the overall narrative is persuasive and academically sound.',
  'The submission clearly demonstrates a strong grasp of the fundamental concepts. The work is well-structured, coherent, and meets all rubric requirements thoroughly. The proposed approach is innovative yet feasible within realistic research constraints.',
  'Outstanding submission. The argument is developed logically, with appropriate references to current research. The design of the methodology is robust and the potential limitations have been considered and mitigated appropriately.'
];

const STORAGE_KEY_ACTIVE = 'cpt_auto_review_active';
const STORAGE_KEY_COUNT = 'cpt_auto_review_count';
const MAX_CONSECUTIVE_REVIEWS = 10;

/**
 * Check if the auto review loop is currently active in session
 * @returns {boolean}
 */
export function isAutoReviewActive() {
  return sessionStorage.getItem(STORAGE_KEY_ACTIVE) === 'true';
}

/**
 * Stop the auto review loop and clean up state
 * @param {string} [msg]
 * @param {string} [type='info']
 */
export function stopAutoReview(msg, type = 'info') {
  sessionStorage.removeItem(STORAGE_KEY_ACTIVE);
  sessionStorage.removeItem(STORAGE_KEY_COUNT);
  if (msg) showToast(msg, type);
}

/**
 * Handle user clicking the "Peer Review" button in panel
 * Toggles the automated review loop
 */
export async function handleReview() {
  try {
    if (!location.href.includes('coursera.org')) {
      showToast('Vui lòng mở trang khóa học Coursera.', 'warning');
      return;
    }

    // Toggle: if already running, stop it
    if (isAutoReviewActive()) {
      stopAutoReview('⏹️ Đã dừng tự động chấm bài Peer Review.', 'warning');
      return;
    }

    showToast('🚀 Khởi động tự động chấm chéo Peer Review...', 'info');
    sessionStorage.setItem(STORAGE_KEY_ACTIVE, 'true');
    sessionStorage.setItem(STORAGE_KEY_COUNT, '0');

    await executeReviewStep();
  } catch (error) {
    console.error('[CourseraPro] Error starting peer review:', error);
    stopAutoReview('Lỗi khởi động: ' + error.message, 'error');
  }
}

/**
 * Check if auto review should resume after navigation / page load
 */
export async function checkAndResumeAutoReview() {
  if (!isAutoReviewActive()) return;

  console.log('[CourseraPro] Resuming active Auto Peer Review loop on:', location.href);
  await sleep(1500);
  await executeReviewStep();
}

/**
 * Detect whether the current page is an active peer review grading / submission page
 * (Matches /review-next, /review/:id, or any page containing active rubric radio buttons)
 * @returns {boolean}
 */
export function isSubmissionGradingPage() {
  const url = location.href.toLowerCase();

  // Explicit review URLs (modern & classic layouts)
  if (
    url.includes('/review-next') ||
    url.includes('/review_next') ||
    url.includes('/review/') ||
    (url.includes('/peer/') && url.includes('/review') && !url.includes('/my-submission'))
  ) {
    return true;
  }

  // DOM heuristics: check for rubric criteria and rating radios
  if (!url.includes('/submit')) {
    const hasRubricCriteria = Boolean(
      document.querySelector(
        '.rc-FormPartsQuestion, [role="radiogroup"], fieldset, .c-peer-review-rubric-item, [class*="rubric" i], [class*="Rubric" i], [data-testid*="rubric" i]'
      ) ||
      (document.body && (document.body.innerText.includes('RUBRIC') || document.body.innerText.includes('Rubric')))
    );
    const hasRadios = Boolean(document.querySelector('input[type="radio"], [role="radio"]'));
    if (hasRubricCriteria && hasRadios) {
      return true;
    }
  }

  return false;
}

/**
 * Main execution step in the auto peer review loop
 */
async function executeReviewStep() {
  if (!isAutoReviewActive()) return;

  const count = parseInt(sessionStorage.getItem(STORAGE_KEY_COUNT) || '0', 10);
  if (count >= MAX_CONSECUTIVE_REVIEWS) {
    stopAutoReview(`🎉 Đã hoàn thành liên tiếp ${count} bài chấm chéo. Tạm dừng an toàn!`, 'success');
    return;
  }

  const url = location.href;

  // Check if review requirement is already satisfied
  if (isReviewRequirementSatisfied()) {
    stopAutoReview('🎉 Đã hoàn thành đủ số lượng bài chấm chéo theo yêu cầu!', 'success');
    return;
  }

  // CASE 1: Currently on an individual submission review / grading page (.../review-next, .../review/:id, or has Rubric)
  if (isSubmissionGradingPage()) {
    showToast(`📝 Đang tự động chấm bài học viên (Bài ${count + 1})...`, 'info');
    const success = await fillRubricAndSubmit();

    if (success) {
      const newCount = count + 1;
      sessionStorage.setItem(STORAGE_KEY_COUNT, String(newCount));
      showToast(`✅ Đã nộp bài chấm ${newCount} thành công! Đang chuyển tiếp...`, 'success');
      await sleep(2500);

      // Check if finished requirement after this review
      if (isReviewRequirementSatisfied()) {
        stopAutoReview('🎉 Đã hoàn thành đủ số lượng bài chấm chéo theo yêu cầu!', 'success');
        return;
      }

      // 1. Look for next action button on the post-submit page
      const nextActionBtn = Array.from(document.querySelectorAll('button, a')).find((el) => {
        if (el.closest('#cpt-panel') || el.disabled) return false;
        const txt = (el.textContent || '').trim().toLowerCase();
        return (
          txt.includes('review another') ||
          txt.includes('review next') ||
          txt.includes('start reviewing') ||
          txt.includes('chấm bài khác') ||
          txt.includes('tiếp tục chấm') ||
          txt.includes('back to peers') ||
          txt.includes('view peers')
        );
      });

      if (nextActionBtn) {
        showToast('👉 Đang bấm chuyển sang bài tiếp theo...', 'info');
        safeClick(nextActionBtn);
        await sleep(2500);
        await executeReviewStep();
        return;
      }

      // 2. If a new submission loaded in-place (still on grading page with unsubmitted rubric)
      if (isSubmissionGradingPage()) {
        console.log('[CourseraPro] New peer review submission loaded in-place.');
        await sleep(1500);
        await executeReviewStep();
        return;
      }

      // 3. Fallback: navigate back to give-feedback to continue from list
      navigateToGiveFeedback();
    } else {
      console.warn('[CourseraPro] Could not submit review form on current page.');
    }
    return;
  }

  // CASE 2: Currently on the "Peers to review" overview page (.../give-feedback)
  if (url.includes('/give-feedback')) {
    showToast('🔍 Đang kiểm tra chỉ tiêu bài cần chấm...', 'info');
    await sleep(1200);

    if (isReviewRequirementSatisfied()) {
      stopAutoReview('🎉 Đã hoàn thành đủ số lượng bài chấm chéo theo yêu cầu!', 'success');
      return;
    }

    showToast('👉 Đang bấm vào bài nộp để chấm (Start Reviewing)...', 'info');
    const opened = await pickAndOpenNextPeerCard();

    if (opened) {
      showToast('🚀 Đang mở bài nộp...', 'info');
      await sleep(2500);
      if (isSubmissionGradingPage()) {
        await executeReviewStep();
      }
    } else {
      if (document.body.innerText.includes('reviewed all ungraded submissions')) {
        stopAutoReview('🎉 Bạn đã hoàn thành chấm tất cả bài nộp hiện có!', 'success');
      } else {
        stopAutoReview('Không tìm thấy bài nộp nào khả dụng để chấm tiếp.', 'info');
      }
    }
    return;
  }

  // CASE 3: On any other assignment tab (e.g. /submit, /instructions, or peer home)
  if (url.includes('/peer/')) {
    showToast('Chuyển sang tab "Peers to review"...', 'info');
    const tabSwitched = await goToPeersToReviewTab();
    if (!tabSwitched) {
      navigateToGiveFeedback();
    }
    return;
  }

  // CASE 4: Not on a peer assignment page at all
  stopAutoReview('Vui lòng mở trang bài tập Peer Review để sử dụng tính năng này.', 'warning');
}

/**
 * Check if the requirement for peer reviews has been reached on the /give-feedback page
 * @returns {boolean}
 */
export function isReviewRequirementSatisfied() {
  const bodyText = (document.body?.innerText || '').toLowerCase();

  // Pattern 1: Coursera finished message (as seen in Screenshot 2)
  if (
    bodyText.includes("you've finished your peer reviews") ||
    bodyText.includes('you have finished your peer reviews') ||
    bodyText.includes('you have reviewed all ungraded submissions')
  ) {
    return true;
  }

  // Pattern 2: Specific review counter indicating 0 left
  if (bodyText.includes('0 left to complete') || bodyText.includes('0 more to complete')) {
    return true;
  }

  // Pattern 3: Review count comparison: "Reviews X complete" or "X of Y complete"
  const countMatch =
    bodyText.match(/reviews\s*:\s*(\d+)\s*of\s*(\d+)\s*complete/i) ||
    bodyText.match(/(\d+)\s*of\s*(\d+)\s*(?:reviews?\s*)?complete/i);

  if (countMatch && countMatch[1] && countMatch[2]) {
    const done = parseInt(countMatch[1], 10);
    const required = parseInt(countMatch[2], 10);
    if (done >= required && required > 0) return true;
  }

  return false;
}

/**
 * Navigate to the "Peers to review" tab by clicking tab link or redirecting
 * @returns {Promise<boolean>}
 */
async function goToPeersToReviewTab() {
  try {
    // Look for tab with text "Peers to review"
    const allTabs = Array.from(document.querySelectorAll('a, button, [role="tab"]'));
    const peersTab = allTabs.find((el) => {
      if (el.closest('#cpt-panel')) return false;
      const txt = (el.textContent || '').trim().toLowerCase();
      return txt === 'peers to review' || txt.includes('peers to review');
    });

    if (peersTab) {
      safeClick(peersTab);
      await sleep(1500);
      return true;
    }

    // Look for link with href containing /give-feedback
    const gfLink = document.querySelector('a[href*="/give-feedback"]');
    if (gfLink) {
      safeClick(gfLink);
      await sleep(1500);
      return true;
    }
  } catch (_e) {}

  return false;
}

/**
 * Fallback navigation to /give-feedback URL
 */
function navigateToGiveFeedback() {
  const current = location.href;
  const gfUrl = current.replace(/\/(?:submit|instructions|review.*)?$/, '/give-feedback');
  if (gfUrl !== current) {
    location.href = gfUrl;
  }
}

/**
 * Pick an unreviewed peer card from the grid on /give-feedback and click it
 * @returns {Promise<boolean>}
 */
async function pickAndOpenNextPeerCard() {
  await sleep(1500);

  // Strategy 0: Check for prominent "Start Reviewing" / "Start Review" button (as shown in user screenshot)
  const allButtons = Array.from(document.querySelectorAll('button, a[role="button"], a.cds-button, a'));
  const startReviewBtn = allButtons.find((btn) => {
    if (btn.closest('#cpt-panel') || btn.disabled) return false;
    const txt = (btn.textContent || '').trim().toLowerCase();
    const href = btn.getAttribute('href') || '';
    return (
      txt === 'start reviewing' ||
      txt.includes('start reviewing') ||
      txt === 'start review' ||
      txt.includes('start review') ||
      txt.includes('bắt đầu chấm') ||
      txt.includes('review another') ||
      href.includes('/review-next') ||
      btn.getAttribute('data-testid') === 'start-review-button' ||
      btn.getAttribute('data-track-component') === 'start_review_button'
    );
  });

  if (startReviewBtn) {
    startReviewBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(400);
    safeClick(startReviewBtn);
    return true;
  }

  // Strategy 1: Find review links on page
  const reviewLinks = Array.from(document.querySelectorAll('a[href*="/review/"]')).filter((a) => {
    if (a.closest('#cpt-panel')) return false;
    const href = a.getAttribute('href') || a.href || '';
    return href.includes('/review/') && !href.includes('/my-submission');
  });

  if (reviewLinks.length > 0) {
    // Pick the first available card
    const targetLink = reviewLinks[0];
    targetLink.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(400);
    safeClick(targetLink);
    return true;
  }

  // Strategy 2: Look for clickable submission cards in the grid
  const cardElements = Array.from(
    document.querySelectorAll('[data-testid*="peer" i], .cds-card, .rc-PeerReviewCard, [role="button"]')
  ).filter((el) => {
    if (el.closest('#cpt-panel')) return false;
    const txt = el.textContent || '';
    return (txt.includes('ago') || txt.includes('Study') || txt.includes('Generative')) && !txt.includes('Your submission');
  });

  if (cardElements.length > 0) {
    const card = cardElements[0];
    const clickableInside = card.querySelector('a, button') || card;
    clickableInside.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(400);
    safeClick(clickableInside);
    return true;
  }

  return false;
}

/**
 * Fill Rubric with highest points, write constructive comments, and click Submit Review
 * @returns {Promise<boolean>}
 */
export async function fillRubricAndSubmit() {
  try {
    // Wait up to 6s for rubric elements to appear
    for (let wait = 0; wait < 6; wait++) {
      if (document.querySelector('input[type="radio"], [role="radio"], textarea')) break;
      await sleep(1000);
    }

    // 1. Fill all Rubric ratings (Universal grouping by name or parent container)
    const allRadios = Array.from(
      document.querySelectorAll('input[type="radio"], [role="radio"]')
    ).filter((el) => !el.closest('#cpt-panel'));

    const radioGroups = new Map();
    for (const r of allRadios) {
      const name = r.getAttribute('name');
      const key = (name && name.trim())
        ? name
        : (r.closest('fieldset, [role="radiogroup"], .rc-FormPartsQuestion, tr, [class*="criterion" i], [class*="rubric" i]') || r.parentElement?.parentElement);
      if (!radioGroups.has(key)) {
        radioGroups.set(key, []);
      }
      radioGroups.get(key).push(r);
    }

    let selectedCount = 0;
    for (const [key, radios] of radioGroups.entries()) {
      if (!radios || radios.length === 0) continue;

      let bestRadio = null;
      let maxPoints = -1;

      for (let i = 0; i < radios.length; i++) {
        const r = radios[i];
        const container =
          r.closest('label') || r.closest('.cds-checkboxAndRadio-label') || r.closest('div') || r.parentElement;
        const text = (container ? container.textContent : '') || '';

        // Check for point values like "1 point", "2 points", "1 pt", "1 điểm"
        const m = text.match(/(\d+)\s*(?:points?|pts?|điểm)/i);
        let pts = m ? parseInt(m[1], 10) : -1;

        // Check positive keywords like "yes", "đúng", "pass", "clear", "present", "meets"
        const isPositiveKeyword = /\b(?:yes|đúng|present|clear|excellent|pass|meets|satisfactory)\b/i.test(text);
        if (isPositiveKeyword && pts < 1) {
          pts = 1;
        }

        // Default to index if no points found
        if (pts < 0) {
          pts = i;
        }

        if (pts > maxPoints) {
          maxPoints = pts;
          bestRadio = r;
        }
      }

      if (!bestRadio) {
        bestRadio = radios[radios.length - 1]; // Pick last (usually highest)
      }

      if (bestRadio) {
        bestRadio.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        selectOptionElement(bestRadio);
        selectedCount++;
      }
    }

    // Also check star ratings or custom point buttons if any
    const ratingButtons = Array.from(
      document.querySelectorAll(
        'button[aria-label*="point" i], button[aria-label*="star" i], button[role="radio"], button[aria-label*="điểm" i]'
      )
    ).filter((el) => !el.closest('#cpt-panel'));
    if (ratingButtons.length > 0) {
      const bestBtn = ratingButtons[ratingButtons.length - 1];
      bestBtn.click();
    }

    await sleep(800);

    // 2. Fill all text feedback areas (Comments textarea: "Share your thoughts...")
    const textareas = Array.from(
      document.querySelectorAll(
        'textarea, input[type="text"]:not([readonly]), .c-peer-review-submit-textarea-input-field, div[data-testid="peer-review-multi-line-input-field"], [contenteditable="true"]'
      )
    ).filter((field) => !field.closest('#cpt-panel') && field.type !== 'hidden' && field.style.display !== 'none');

    const randomReview = SAMPLE_REVIEWS[Math.floor(Math.random() * SAMPLE_REVIEWS.length)];

    for (const field of textareas) {
      const currentVal = (field.value || field.textContent || '').trim();
      if (currentVal.length < 10) {
        field.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        field.focus();

        if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
          simulateInput(field, randomReview);
        } else {
          simulateTyping(field, randomReview);
          document.execCommand('insertText', false, randomReview);
        }
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    await sleep(1000);

    // 3. Find and click "Submit Review" button
    const allButtons = Array.from(document.querySelectorAll('button, input[type="submit"], a[role="button"]'));
    const submitBtn = allButtons.find((btn) => {
      if (btn.closest('#cpt-panel') || btn.disabled) return false;
      const txt = (btn.textContent || btn.value || '').trim().toLowerCase();
      return (
        txt === 'submit review' ||
        txt.includes('submit review') ||
        txt === 'submit' ||
        txt.includes('gửi đánh giá') ||
        txt.includes('submit assignment') ||
        (btn.type === 'submit' && !txt.includes('cancel') && !txt.includes('hủy'))
      );
    });

    if (submitBtn) {
      submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(500);
      safeClick(submitBtn);
      await sleep(1500);

      // Handle confirmation dialog if any
      const confirmBtn = Array.from(
        document.querySelectorAll('[role="dialog"] button, .modal button, .rc-Modal button, [data-testid*="dialog" i] button')
      ).find((b) => {
        if (b.closest('#cpt-panel')) return false;
        const t = (b.textContent || '').trim().toLowerCase();
        return t.includes('submit') || t.includes('confirm') || t.includes('yes') || t.includes('đồng ý');
      });

      if (confirmBtn) {
        safeClick(confirmBtn);
        await sleep(1500);
      }

      return true;
    }

    return false;
  } catch (e) {
    console.error('[CourseraPro] Fill peer review error:', e);
    return false;
  }
}

/**
 * Handle peer graded assignment shortcut
 */
export async function handlePeerGradedAssignment() {
  return handleReview();
}
