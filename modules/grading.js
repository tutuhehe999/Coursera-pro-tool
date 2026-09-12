/**
 * Coursera Pro Tool - Peer Assignment & Grading Module
 * Features:
 * 1. Tắt AI chấm bài (Disable AI Grading / Switch to Human Peer Review)
 * 2. Hỗ trợ lấy link chấm chéo (Get Shareable Peer Review Link)
 */

import { waitForSelector, sleep, safeClick } from '../utils/dom.js';
import { requestGradingByPeer, fetchPeerSubmissionInfo } from '../utils/coursera-api.js';
import { getMetadata, getCourseSlug, extractItemId, extractUserId, extractAssignmentSlug } from '../utils/metadata.js';
import { showToast, displayShareLink } from '../ui/panel.js';

/**
 * Extract course ID from DOM state, metadata, scripts, or Coursera API
 * @param {string} courseSlug
 * @returns {Promise<string>}
 */
export async function resolveCourseId(courseSlug) {
  // 1. First priority: from DOM tracking data (fg())
  const meta = getMetadata();
  if (meta && meta.course_id) {
    return meta.course_id;
  }

  // 2. Second priority: regex on DOM HTML
  try {
    const html = document.documentElement.innerHTML;
    const match =
      html.match(/"courseId"\s*:\s*"([A-Za-z0-9_~-]+)"/) ||
      html.match(/"course_id"\s*:\s*"([A-Za-z0-9_~-]+)"/) ||
      html.match(/courseId~([A-Za-z0-9_~-]+)/) ||
      html.match(/course~([A-Za-z0-9_~-]+)/);

    if (match && match[1]) {
      return match[1];
    }
  } catch (_e) {}

  // 3. Third priority: Coursera API (safely handled without throwing on HTML)
  if (courseSlug) {
    try {
      const res = await fetch(
        `https://www.coursera.org/api/onDemandCourses.v1?q=slug&slug=${courseSlug}&fields=id`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          const id = data?.elements?.[0]?.id;
          if (id) return id;
        }
      }
    } catch (e) {
      console.warn('[CourseraPro] Failed to fetch courseId from API:', e);
    }
  }

  return '';
}

/**
 * Helper to extract submissionId from API info or page HTML
 * @param {object} submissionInfo
 * @param {string} courseId
 * @param {string} itemId
 * @param {string} [userId]
 * @returns {string|null}
 */
function extractSubmissionId(submissionInfo, courseId, itemId, userId = '') {
  // 1. From API response: check .computed.id (exact original schema)
  let subId =
    submissionInfo?.linked?.['onDemandPeerSubmissionProgresses.v1']?.[0]?.latestSubmissionSummary?.computed?.id ||
    submissionInfo?.linked?.['onDemandPeerSubmissionProgresses.v1']?.[0]?.latestSubmissionSummary?.id ||
    submissionInfo?.linked?.['onDemandPeerSubmissionProgresses.v1']?.[0]?.latestSubmissionSummary?.definition?.id ||
    submissionInfo?.elements?.[0]?.submissionProgress?.latestSubmissionSummary?.computed?.id ||
    submissionInfo?.elements?.[0]?.submissionProgress?.latestSubmissionSummary?.id;

  if (subId) return subId;

  // 2. Scan DOM HTML
  try {
    const html = document.documentElement.innerHTML;

    // Pattern A: latestSubmissionSummary with id
    const summaryMatch =
      html.match(/"latestSubmissionSummary"\s*:\s*\{[^}]*"id"\s*:\s*"([A-Za-z0-9_~.-]+)"/) ||
      html.match(/"computed"\s*:\s*\{[^}]*"id"\s*:\s*"([A-Za-z0-9_~.-]+)"/);
    if (summaryMatch && summaryMatch[1]) return summaryMatch[1];

    // Pattern B: PeerSubmission Apollo cache key
    if (itemId) {
      const peerMatch = html.match(new RegExp(`"PeerSubmission:([^"]+~${itemId})"`));
      if (peerMatch && peerMatch[1]) return peerMatch[1];
    }

    // Pattern C: Generic submissionId
    const subMatch = html.match(/"submissionId"\s*:\s*"([A-Za-z0-9_~.-]+)"/);
    if (subMatch && subMatch[1]) return subMatch[1];

    // Pattern D: Compound pattern userId~courseId~itemId
    if (itemId) {
      const compoundMatch =
        (courseId ? html.match(new RegExp(`"(\\d+~${courseId}~${itemId})"`)) : null) ||
        html.match(new RegExp(`"(\\d+~[A-Za-z0-9_-]+~${itemId})"`));
      if (compoundMatch && compoundMatch[1]) return compoundMatch[1];
    }
  } catch (_e) {}

  return null;
}

/**
 * Tắt AI chấm bài assignment (Disable AI Grading / Switch to Human Peer Review)
 * Switches AI-graded peer assignment to traditional peer review by learners
 */
export async function handleDisableAiGrading() {
  try {
    if (!location.href.includes('coursera.org')) {
      showToast('Vui lòng mở trang khóa học Coursera.', 'warning');
      return;
    }

    showToast('Đang kiểm tra và tắt AI chấm bài...', 'info');

    // 1. First priority: Check if Coursera DOM directly has "Switch to peer grading" button
    const domButtons = Array.from(
      document.querySelectorAll(
        'button[data-testid*="switch" i], button[data-track-component*="switch" i], button[data-e2e*="switch" i], button, a[role="button"]'
      )
    );

    const switchBtn = domButtons.find((b) => {
      if (b.closest('#cpt-panel')) return false;
      const text = (b.textContent || '').trim().toLowerCase();
      return (
        text.includes('switch to peer grading') ||
        text.includes('switch to peer review') ||
        text.includes('opt out of ai') ||
        text.includes('chuyển sang chấm chéo') ||
        text.includes('tắt ai chấm')
      );
    });

    if (switchBtn) {
      safeClick(switchBtn);
      await sleep(1000);

      const modalConfirmBtn = Array.from(
        document.querySelectorAll('[role="dialog"] button, .modal button, .rc-Modal button')
      ).find((b) => {
        const t = (b.textContent || '').trim().toLowerCase();
        return (
          t.includes('switch') ||
          t.includes('confirm') ||
          t.includes('yes') ||
          t.includes('đồng ý') ||
          t.includes('chuyển')
        );
      });

      if (modalConfirmBtn) {
        safeClick(modalConfirmBtn);
        await sleep(1200);
      }

      showToast('🎉 Đã tắt AI chấm thành công! Đang tải lại sau 2s...', 'success');
      setTimeout(() => location.reload(), 2000);
      return;
    }

    // 2. Second priority: Original Build API + GraphQL Mutation
    const meta = getMetadata();
    const courseSlug = meta.open_course_slug || getCourseSlug();
    const itemId = meta.item_id || extractItemId();
    const userId = extractUserId();

    if (!itemId) {
      showToast('Không thể xác định Item ID. Vui lòng mở trang bài tập Peer Review!', 'warning');
      return;
    }

    const courseId = meta.course_id || (await resolveCourseId(courseSlug));
    if (!courseId) {
      showToast('Không thể xác định Course ID.', 'error');
      return;
    }

    showToast('Đang lấy thông tin bài nộp...', 'info');

    let submissionInfo = {};
    try {
      submissionInfo = await fetchPeerSubmissionInfo(courseId, itemId, userId);
    } catch (e) {
      console.warn('[CourseraPro] fetchPeerSubmissionInfo error:', e);
    }

    const submissionId = extractSubmissionId(submissionInfo, courseId, itemId, userId);

    if (!submissionId) {
      showToast('Chưa tìm thấy bài nộp. Bạn cần nộp bài tập trước khi tắt AI chấm bài!', 'warning');
      return;
    }

    showToast('Đang gửi lệnh tắt AI chấm bài qua Coursera API...', 'info');

    const response = await requestGradingByPeer(courseId, itemId, submissionId, 'EXPECTED_HIGHER_SCORE|ok');

    if (response && (response.status === 200 || response.ok)) {
      showToast('🎉 Đã tắt AI chấm bài thành công! Đang tải lại sau 2s...', 'success');
      setTimeout(() => location.reload(), 1800);
    } else {
      const bodyText = await response?.text?.().catch(() => 'N/A');
      console.warn('[CourseraPro] Response body:', bodyText);
      showToast('Yêu cầu tắt AI chấm chưa được chấp nhận. Xem Console (F12) để biết chi tiết.', 'warning');
    }
  } catch (error) {
    console.error('[CourseraPro] Error disabling AI grading:', error);
    showToast('Lỗi tắt AI chấm: ' + error.message, 'error');
  }
}

/**
 * Hỗ trợ lấy link chấm chéo (Get Shareable Peer Review Link)
 * Automatically finds, formats, copies to clipboard, and displays the shareable peer review link
 * @returns {Promise<string|null>}
 */
export async function handleGetShareableLink() {
  try {
    if (!location.href.includes('coursera.org')) {
      showToast('Vui lòng mở trang Coursera.', 'warning');
      return null;
    }

    showToast('Đang tìm và tạo link chấm chéo của bài nộp...', 'info');

    const meta = getMetadata();
    const courseSlug = meta.open_course_slug || getCourseSlug();
    const itemId = meta.item_id || extractItemId();
    const userId = extractUserId();

    if (!courseSlug) {
      showToast('Vui lòng mở một trang khóa học Coursera!', 'warning');
      return null;
    }

    let shareLink = '';

    // 1. Strategy A: Check DOM for existing share link or input
    const domLinkEl = document.querySelector(
      'input[value*="/peer/"][value*="/review/"], .rc-ShareSubmissionLink input, [data-testid*="share" i] input, a[href*="/peer/"][href*="/review/"]'
    );

    if (domLinkEl) {
      const val = domLinkEl.value || domLinkEl.href || '';
      if (val && val.includes('/review/')) {
        shareLink = val.startsWith('http') ? val : `https://${val.replace(/^\/+/, '')}`;
      }
    }

    // 2. Strategy B: Using submissionId from API or HTML
    if (!shareLink && itemId) {
      const courseId = meta.course_id || (await resolveCourseId(courseSlug));
      let submissionInfo = {};
      try {
        submissionInfo = await fetchPeerSubmissionInfo(courseId, itemId, userId);
      } catch (_e) {}

      const submissionId = extractSubmissionId(submissionInfo, courseId, itemId, userId);

      if (submissionId) {
        const assignmentSlug = extractAssignmentSlug(itemId);
        shareLink = `https://www.coursera.org/learn/${courseSlug}/peer/${itemId}/${assignmentSlug}/review/${submissionId}`;
      }
    }

    // 3. Fallback: If on review page already
    if (!shareLink && location.href.includes('/review/')) {
      shareLink = location.href.split('?')[0];
    }

    if (!shareLink) {
      showToast('Chưa tìm thấy bài nộp của bạn. Bạn cần nộp bài tập trước khi lấy link chấm chéo!', 'warning');
      return null;
    }

    // Copy to clipboard
    try {
      await navigator.clipboard.writeText(shareLink);
    } catch (_e) {
      const ta = document.createElement('textarea');
      ta.value = shareLink;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }

    // Display in panel HUD and toast
    displayShareLink(shareLink);
    showToast('📋 Đã sao chép link chấm chéo vào bộ nhớ tạm (Clipboard)!', 'success');

    console.log('[CourseraPro] Shareable Peer Review Link:', shareLink);
    return shareLink;
  } catch (err) {
    console.error('[CourseraPro] Error getting shareable review link:', err);
    showToast('Lỗi lấy link chấm chéo: ' + err.message, 'error');
    return null;
  }
}

/**
 * Backward compatibility alias for handleDisableAiGrading
 */
export async function handleRequestGrading() {
  return handleDisableAiGrading();
}
