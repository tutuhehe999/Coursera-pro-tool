/**
 * Coursera Pro Tool - Auto Discussion Module
 * 1-Click Auto All Discussions across the entire course with:
 * - Smart AI with dynamic personas for unique responses
 * - Enforced 30-second delay between discussion posts
 * - Real-time countdown and progress updates
 * - Resume across page navigations via chrome.storage.local
 */

import { waitForSelector, sleep, simulateTyping } from '../utils/dom.js';
import { generateDiscussionResponse } from '../utils/ai.js';
import { fetchCourseDiscussions } from '../utils/coursera-api.js';
import { getCourseSlug } from '../utils/metadata.js';
import { showToast, updateProgress, setDiscussionActive } from '../ui/panel.js';

const STORAGE_KEY = 'cpt_auto_discussion';
const DISCUSSION_DELAY_SECONDS = 30;

/**
 * Get a valid navigation URL for a discussion item
 * Coursera uses /discussionPrompt/:id/:slug or universal /item/:id
 * NEVER /discussion-prompt/:id (which Coursera 404s)
 * @param {object} item
 * @param {string} courseSlug
 * @returns {string}
 */
function getValidDiscussionUrl(item, courseSlug) {
  if (!item) return '';
  const slug = courseSlug || getCourseSlug();
  if (item.url && !item.url.includes('/discussion-prompt/')) {
    return item.url;
  }
  if (item.slug && slug) {
    return `https://www.coursera.org/learn/${slug}/discussionPrompt/${item.id}/${item.slug}`;
  }
  if (item.itemUrl) return item.itemUrl;
  return `https://www.coursera.org/learn/${slug}/item/${item.id}`;
}

/**
 * Smoothly navigate to a target discussion item.
 * Tries client-side SPA navigation via sidebar link click first (smooth transition, no full page reload).
 * Falls back to window.location.href if link is not in current DOM view.
 * @param {object} targetItem
 * @param {string} courseSlug
 */
async function navigateToDiscussion(targetItem, courseSlug) {
  if (!targetItem) return;
  const targetUrl = getValidDiscussionUrl(targetItem, courseSlug);

  // 1. Try finding matching link in the sidebar or document
  const matchingLinks = Array.from(
    document.querySelectorAll(`a[href*="${targetItem.id}"]`)
  );

  if (matchingLinks.length > 0) {
    const link = matchingLinks.find((el) => el.offsetParent !== null) || matchingLinks[0];
    if (link) {
      console.log('[CourseraPro] Smooth SPA navigating to item:', targetItem.id);
      link.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      link.click();

      // Wait to see if Coursera SPA router loads the new route
      await sleep(1800);
      if (location.href.includes(targetItem.id)) {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        const state = result[STORAGE_KEY];
        if (state && state.active) {
          processCurrentDiscussion(state);
        }
        return;
      }
    }
  }

  // 2. Fallback to direct navigation
  console.log('[CourseraPro] Direct URL navigation to:', targetUrl);
  window.location.href = targetUrl;
}

/**
 * Find all discussion prompts across course API and page DOM
 * @param {string} courseSlug
 * @returns {Promise<Array<{id: string, name: string, url: string}>>}
 */
async function findAllDiscussions(courseSlug) {
  const discussions = [];
  const seenIds = new Set();

  // 1. Fetch via Coursera API
  try {
    const apiItems = await fetchCourseDiscussions(courseSlug);
    for (const item of apiItems) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        discussions.push({
          id: item.id,
          name: item.name,
          slug: item.slug || '',
          url: getValidDiscussionUrl(item, courseSlug),
          itemUrl: `https://www.coursera.org/learn/${courseSlug}/item/${item.id}`,
        });
      }
    }
  } catch (err) {
    console.warn('[CourseraPro] API discussion fetch warning:', err);
  }

  // 2. Fallback / supplement: DOM links matching discussion prompt
  const domLinks = document.querySelectorAll(
    'a[href*="/discussionPrompt/"], a[href*="/discussion-prompt/"], a[href*="/item/"]'
  );
  for (const link of domLinks) {
    const href = link.href || '';
    const match =
      href.match(/\/discussionPrompt\/([A-Za-z0-9_-]+)/i) ||
      href.match(/\/discussion-prompt\/([A-Za-z0-9_-]+)/i);
    const id = match ? match[1] : '';
    if (id && !seenIds.has(id)) {
      seenIds.add(id);
      const cleanUrl = href.includes('/discussion-prompt/')
        ? href.replace('/discussion-prompt/', '/item/')
        : href;
      discussions.push({
        id,
        name: link.textContent?.trim() || 'Discussion Prompt',
        url: cleanUrl,
        itemUrl: `https://www.coursera.org/learn/${courseSlug}/item/${id}`,
      });
    }
  }

  return discussions;
}

/**
 * Check if the current discussion prompt has already been submitted
 * @returns {boolean}
 */
function isDiscussionAlreadySubmitted() {
  const submittedSelectors = [
    '[data-testid="submitted-response"]',
    '.rc-MySubmission',
    '[data-testid="my-submission"]',
    '.rc-DiscussionPromptResponseCard',
    '[data-testid="discussion-prompt-response"]',
  ];

  for (const sel of submittedSelectors) {
    if (document.querySelector(sel)) return true;
  }

  const pageText = document.body?.innerText || '';
  if (
    pageText.includes('You have submitted a response') ||
    pageText.includes('You submitted this response') ||
    pageText.includes('Your response has been submitted') ||
    pageText.includes('Đã gửi phản hồi')
  ) {
    return true;
  }

  const buttons = Array.from(document.querySelectorAll('button'));
  for (const btn of buttons) {
    const txt = btn.textContent.trim().toLowerCase();
    if (
      txt === 'edit response' ||
      txt === 'chỉnh sửa phản hồi' ||
      txt === 'edit reply' ||
      txt === 'view my response'
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Fill response into textarea or contenteditable editor
 * @param {Element} inputEl
 * @param {string} text
 */
async function fillDiscussionInput(inputEl, text) {
  if (!inputEl) return false;
  inputEl.focus();
  await sleep(250);

  if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
    inputEl.value = text;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
  } else {
    // Rich text / Contenteditable / Draft.js / Quill
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
    } catch (e) {}

    if (!inputEl.textContent || inputEl.textContent.trim().length === 0) {
      inputEl.innerHTML = `<p>${text.replace(/\n\n/g, '</p><p>')}</p>`;
    }
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}

/**
 * Find and click the Submit / Post response button
 * @returns {Promise<boolean>}
 */
async function submitDiscussion() {
  const submitSelectors = [
    'button[data-testid="discussion-reply-submit"]',
    'button[data-testid="submit-button"]',
    'button.rc-DiscussionForumReplyForm__submit-btn',
    'button[type="submit"]',
  ];

  for (const selector of submitSelectors) {
    const btn = document.querySelector(selector);
    if (btn && !btn.disabled) {
      btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      btn.click();
      return true;
    }
  }

  // Find by button text
  const buttons = Array.from(document.querySelectorAll('button'));
  for (const btn of buttons) {
    const txt = btn.textContent.trim().toLowerCase();
    if (
      (txt === 'submit' ||
        txt === 'post' ||
        txt === 'post response' ||
        txt === 'submit response' ||
        txt === 'gửi phản hồi' ||
        txt === 'đăng phản hồi' ||
        txt === 'gửi') &&
      !btn.disabled
    ) {
      btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      btn.click();
      return true;
    }
  }

  return false;
}

/**
 * Handle a single discussion prompt on the current page
 */
export async function handleDiscussionPrompt() {
  try {
    const isDiscussionPage =
      location.href.includes('/discussionPrompt/') ||
      location.href.includes('/discussion-prompt/') ||
      location.href.includes('/item/') ||
      document.querySelector(
        '.rc-CML, [data-testid="prompt-content"], button[data-testid="reply-button"], [data-testid="discussion-prompt-description"]'
      );

    if (!isDiscussionPage) {
      showToast('Không ở trang thảo luận (Discussion Prompt).', 'warning');
      return;
    }

    if (isDiscussionAlreadySubmitted()) {
      showToast('Bài thảo luận này đã được nộp trước đó!', 'info');
      return;
    }

    showToast('Đang tạo phản hồi độc nhất bằng AI...', 'info');

    // Open reply form if needed
    const replyBtn =
      document.querySelector(
        'button[data-testid="reply-button"], button[data-testid="create-response-button"], [data-track-component="reply_button"]'
      ) ||
      Array.from(document.querySelectorAll('button')).find((b) => {
        const t = b.textContent.trim().toLowerCase();
        return (
          t === 'reply to prompt' ||
          t === 'add a response' ||
          t === 'reply' ||
          t === 'trả lời' ||
          t === 'create post' ||
          t === 'tạo phản hồi' ||
          t === 'thêm phản hồi'
        );
      });
    if (replyBtn) {
      replyBtn.click();
      await sleep(800);
    }

    // Get prompt text
    const promptEl = await waitForSelector(
      '.rc-CML, [data-testid="prompt-content"], .css-x3q7o9, [data-testid="discussion-prompt-description"], .rc-ItemContent, [data-testid="discussion-prompt-content"]',
      10000
    );
    const promptText = promptEl?.innerText?.trim() || promptEl?.textContent?.trim() || 'Discussion Prompt';

    // Generate unique response
    const response = await generateDiscussionResponse(promptText);
    if (!response) {
      showToast('AI không tạo được phản hồi.', 'error');
      return;
    }

    // Find textarea or editor
    const textarea = await waitForSelector(
      'textarea, [contenteditable="true"], [data-testid="discussion-reply-text"], .ql-editor, div[role="textbox"], .public-DraftEditor-content',
      6000
    );
    if (!textarea) {
      showToast('Không tìm thấy khung nhập phản hồi.', 'error');
      return;
    }

    await fillDiscussionInput(textarea, response);
    showToast('Đã điền thảo luận! Chuẩn bị nộp...', 'info');
    await sleep(1200);

    const submitted = await submitDiscussion();
    if (submitted) {
      showToast('Đã gửi phản hồi thảo luận thành công!', 'success');
    } else {
      showToast('Đã điền câu trả lời. Vui lòng bấm Nộp (Submit).', 'warning');
    }
  } catch (error) {
    console.error('[CourseraPro] Discussion prompt error:', error);
    showToast('Lỗi thảo luận: ' + error.message, 'error');
  }
}

/**
 * Start Auto All Discussions across the entire course
 */
export async function startAutoAllDiscussions() {
  try {
    const courseSlug = getCourseSlug();
    if (!courseSlug) {
      showToast('Vui lòng mở một trang khóa học Coursera!', 'warning');
      return;
    }

    showToast('Đang quét tất cả bài thảo luận trong khóa học...', 'info');
    setDiscussionActive(true, 'Đang quét...');

    const discussions = await findAllDiscussions(courseSlug);

    if (discussions.length === 0) {
      // If currently on a discussion page, just do this one
      const isDiscussionPage =
        location.href.includes('/discussionPrompt/') ||
        location.href.includes('/discussion-prompt/') ||
        location.href.includes('/item/');
      if (isDiscussionPage) {
        showToast('Chỉ tìm thấy bài hiện tại. Đang giải quyết...', 'info');
        await handleDiscussionPrompt();
      } else {
        showToast('Không tìm thấy bài thảo luận nào trong khóa học này.', 'warning');
      }
      setDiscussionActive(false);
      return;
    }

    showToast(`Tìm thấy ${discussions.length} bài thảo luận! Bắt đầu tự động...`, 'success');
    isAutoDiscussionRunning = true;

    const total = discussions.length;

    for (let i = 0; i < total; i++) {
      if (!isAutoDiscussionRunning) {
        showToast('Đã dừng tự động thảo luận.', 'info');
        break;
      }

      const item = discussions[i];
      const currentNum = i + 1;

      updateProgress(currentNum, total, `Bài ${currentNum}/${total}: ${item.name}`);
      setDiscussionActive(true, `Bài ${currentNum}/${total}`);
      showToast(`Đang xử lý bài ${currentNum}/${total}: "${item.name}"...`, 'info');

      // If current page is already on this item, handle it directly on current page
      if (location.href.includes(item.id)) {
        if (isDiscussionAlreadySubmitted()) {
          showToast(`Bài ${currentNum}/${total} đã làm trước đó.`, 'info');
          await sleep(1500);
        } else {
          showToast(`Đang làm bài hiện tại ${currentNum}/${total}...`, 'info');
          await handleDiscussionPrompt();
          await sleep(2500);

          // Safe countdown delay between newly posted discussions (30s - 40s)
          if (i < total - 1 && isAutoDiscussionRunning) {
            let delaySec = Math.floor(Math.random() * 11) + 30; // 30s - 40s
            showToast(`Đã nộp bài ${currentNum}/${total}! Nghỉ ${delaySec}s trước bài tiếp theo để bảo vệ tài khoản...`, 'success');
            while (delaySec > 0 && isAutoDiscussionRunning) {
              setDiscussionActive(true, `Chờ ${delaySec}s...`);
              updateProgress(currentNum, total, `Xong ${currentNum}/${total} | Tiếp sau ${delaySec}s...`);
              await sleep(1000);
              delaySec--;
            }
          }
        }
      } else {
        // Run in background worker tab WITHOUT changing active tab URL!
        const targetUrl = getValidDiscussionUrl(item, courseSlug);
        const workerUrl = `${targetUrl}#cpt_worker=1`;

        try {
          const res = await chrome.runtime.sendMessage({
            action: 'autoDiscussionBackground',
            url: workerUrl,
          });

          if (!isAutoDiscussionRunning) break;

          if (res?.alreadySubmitted) {
            showToast(`Bài ${currentNum}/${total} đã được nộp trước đó.`, 'info');
            await sleep(1500);
          } else if (res?.success) {
            showToast(`Đã nộp bài ${currentNum}/${total} thành công!`, 'success');

            // Safe countdown delay between newly posted discussions (30s - 40s)
            if (i < total - 1 && isAutoDiscussionRunning) {
              let delaySec = Math.floor(Math.random() * 11) + 30; // 30s - 40s
              showToast(`Nghỉ ${delaySec}s trước bài tiếp theo để bảo vệ tài khoản...`, 'info');
              while (delaySec > 0 && isAutoDiscussionRunning) {
                setDiscussionActive(true, `Chờ ${delaySec}s...`);
                updateProgress(currentNum, total, `Xong ${currentNum}/${total} | Tiếp sau ${delaySec}s...`);
                await sleep(1000);
                delaySec--;
              }
            }
          } else {
            console.warn('[CourseraPro] Background worker result:', res);
            showToast(`Bài ${currentNum}/${total} đã xử lý xong.`, 'info');
            await sleep(1500);
          }
        } catch (bgErr) {
          console.error('[CourseraPro] Background discussion error:', bgErr);
          showToast(`Bài ${currentNum}/${total}: Đã chuyển tiếp.`, 'warning');
          await sleep(1500);
        }
      }
    }

    if (isAutoDiscussionRunning) {
      updateProgress(total, total, 'Hoàn thành 100%!');
      showToast(`🎉 Chúc mừng! Đã hoàn thành tất cả ${total} bài thảo luận trong khóa học!`, 'success');
    }
  } catch (error) {
    console.error('[CourseraPro] Start auto discussions error:', error);
    showToast('Lỗi khởi chạy thảo luận: ' + error.message, 'error');
  } finally {
    isAutoDiscussionRunning = false;
    setDiscussionActive(false);
  }
}

let isAutoDiscussionRunning = false;

/**
 * Cancel the active auto discussion queue
 */
export async function cancelAutoDiscussion() {
  isAutoDiscussionRunning = false;
  try {
    await chrome.runtime.sendMessage({ action: 'cancelDiscussionWorker' });
  } catch (_e) {}
  setDiscussionActive(false);
  updateProgress(0, 0, '');
  showToast('Đã dừng tự động thảo luận.', 'info');
}

/**
 * Toggle auto discussion (start if idle, stop if running)
 */
export async function toggleAutoDiscussions() {
  if (isAutoDiscussionRunning) {
    await cancelAutoDiscussion();
  } else {
    await startAutoAllDiscussions();
  }
}

/**
 * Run discussion submission automatically inside a background worker tab
 */
export async function runDiscussionWorker() {
  try {
    console.log('[CourseraPro] Worker started for URL:', location.href);
    await sleep(2500);

    // 1. Check if already submitted
    if (isDiscussionAlreadySubmitted()) {
      console.log('[CourseraPro] Worker: Already submitted previously.');
      chrome.runtime.sendMessage({
        action: 'discussionWorkerFinished',
        success: true,
        alreadySubmitted: true,
      });
      return;
    }

    // 2. Open reply form if collapsed
    const replyBtn =
      document.querySelector(
        'button[data-testid="reply-button"], button[data-testid="create-response-button"], [data-track-component="reply_button"]'
      ) ||
      Array.from(document.querySelectorAll('button')).find((b) => {
        const t = b.textContent.trim().toLowerCase();
        return (
          t === 'reply to prompt' ||
          t === 'add a response' ||
          t === 'reply' ||
          t === 'trả lời' ||
          t === 'create post' ||
          t === 'tạo phản hồi' ||
          t === 'thêm phản hồi'
        );
      });
    if (replyBtn) {
      replyBtn.click();
      await sleep(1000);
    }

    // 3. Extract prompt text
    let promptText = '';
    try {
      const promptEl = await waitForSelector(
        '.rc-CML, [data-testid="prompt-content"], .css-x3q7o9, [data-testid="discussion-prompt-description"], .rc-ItemContent, [data-testid="discussion-prompt-content"]',
        8000
      );
      promptText = promptEl?.innerText?.trim() || promptEl?.textContent?.trim() || '';
    } catch (e) {
      console.warn('[CourseraPro] Worker: Prompt selector timeout:', e);
    }

    if (!promptText) promptText = document.title || 'Discussion Prompt';

    // 4. Generate unique response with AI
    const response = await generateDiscussionResponse(promptText);
    if (!response) {
      throw new Error('AI could not generate response in worker.');
    }

    // 5. Find editor and fill
    const textarea = await waitForSelector(
      'textarea, [contenteditable="true"], [data-testid="discussion-reply-text"], .ql-editor, div[role="textbox"], .public-DraftEditor-content',
      8000
    );
    if (!textarea) {
      throw new Error('Worker: Textarea not found.');
    }

    await fillDiscussionInput(textarea, response);
    await sleep(1500);

    // 6. Submit
    await submitDiscussion();
    await sleep(3000);

    console.log('[CourseraPro] Worker: Discussion submitted successfully!');
    chrome.runtime.sendMessage({
      action: 'discussionWorkerFinished',
      success: true,
    });
  } catch (err) {
    console.error('[CourseraPro] Worker error:', err);
    chrome.runtime.sendMessage({
      action: 'discussionWorkerFinished',
      success: false,
      error: err.message,
    });
  }
}

/**
 * Resume / auto-heal legacy URLs
 */
export async function checkAndResumeDiscussionAutomation() {
  try {
    // Auto-healing: If user or browser landed on a legacy broken /discussion-prompt/ URL, auto-redirect to /item/
    if (location.href.includes('/discussion-prompt/')) {
      const fixedUrl = location.href.replace('/discussion-prompt/', '/item/');
      console.log('[CourseraPro] Auto-healing legacy URL to:', fixedUrl);
      location.replace(fixedUrl);
    }
  } catch (err) {
    console.warn('[CourseraPro] Error in discussion check:', err);
  }
}
