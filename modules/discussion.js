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
import { getCourseSlug, extractItemId } from '../utils/metadata.js';
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
    '.rc-SubmittedResponse',
    '[data-testid*="user-response" i]',
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
 * Find the active rich text editor or textarea for discussion responses
 * @returns {Element|null}
 */
function findDiscussionEditor() {
  // 1. Direct editable elements
  const directSelectors = [
    '.public-DraftEditor-content[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea[data-testid*="reply" i]',
    'textarea',
    '.ql-editor',
    '.ProseMirror',
    '[data-testid="discussion-reply-text"]',
  ];

  for (const sel of directSelectors) {
    const els = Array.from(document.querySelectorAll(sel));
    for (const el of els) {
      if (el.offsetParent !== null || el.getClientRects().length > 0) {
        return el;
      }
    }
  }

  // 2. DraftEditor or container roots
  const containers = document.querySelectorAll(
    '.DraftEditor-root, div[role="textbox"], [data-testid*="editor" i], .rc-DiscussionForumReplyForm, [data-testid*="reply-form" i]'
  );
  for (const c of containers) {
    const inner = c.querySelector('[contenteditable="true"], textarea');
    if (inner) return inner;
    if (c.getAttribute('contenteditable') === 'true' || c.isContentEditable) return c;
  }

  // 3. Search near placeholder text
  const allNodes = document.querySelectorAll('div, p, span');
  for (const node of allNodes) {
    if (
      node.children.length === 0 &&
      (node.textContent || '').includes('Type your response here')
    ) {
      const parent =
        node.closest('.DraftEditor-root, div[role="textbox"], form, [class*="editor" i]') || node.parentElement;
      if (parent) {
        const inner = parent.querySelector('[contenteditable="true"], textarea');
        if (inner) return inner;
        if (parent.getAttribute('contenteditable') === 'true' || parent.isContentEditable) return parent;
      }
    }
  }

  return document.querySelector('[contenteditable="true"], textarea, div[role="textbox"]');
}

/**
 * Fill response into textarea or contenteditable editor with full React / Draft.js state propagation
 * @param {Element} inputEl
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function fillDiscussionInput(inputEl, text) {
  if (!inputEl || !text) return false;

  let target = inputEl;
  if (target.querySelector) {
    const inner = target.querySelector('[contenteditable="true"], textarea');
    if (inner) target = inner;
  }

  try {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus();
    await sleep(200);

    // Native textarea / input
    if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
      const proto =
        target.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(target, text);
      } else {
        target.value = text;
      }
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
      return true;
    }

    // Contenteditable / Draft.js / ProseMirror Rich Text Editor
    // A. Focus and select contents
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(target);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (_e) {}

    // B. Dispatch ClipboardEvent paste (primary way Draft.js captures multi-paragraph text and updates EditorState)
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      dt.setData('text/html', `<p>${text.replace(/\n\n/g, '</p><p>')}</p>`);
      const pasteEvt = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(pasteEvt);
    } catch (_e) {}

    await sleep(150);

    // C. Check if paste worked; if not, try beforeinput + execCommand
    const currentText = target.textContent?.trim() || '';
    if (!currentText || !currentText.includes(text.substring(0, 10))) {
      try {
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text,
        });
        target.dispatchEvent(beforeInput);
      } catch (_e) {}

      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, text);
      } catch (_e) {}

      await sleep(100);
    }

    // D. Dispatch InputEvent input & change
    try {
      const inputEvt = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text,
      });
      target.dispatchEvent(inputEvt);
    } catch (_e) {
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
    target.dispatchEvent(new Event('change', { bubbles: true }));

    // E. Invoke React internal props on target and ancestors
    let curr = target;
    for (let depth = 0; depth < 5 && curr; depth++) {
      const reactKey = Object.keys(curr).find(
        (k) => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$')
      );
      if (reactKey && curr[reactKey]) {
        const props = curr[reactKey];
        if (typeof props.onInput === 'function') {
          try {
            props.onInput({ target, currentTarget: target, nativeEvent: new Event('input') });
          } catch (_e) {}
        }
        if (typeof props.onChange === 'function') {
          try {
            props.onChange({ target, currentTarget: target, value: text });
          } catch (_e) {}
        }
      }
      curr = curr.parentElement;
    }

    // F. Fallback innerHTML if still empty
    if (!target.textContent || !target.textContent.trim()) {
      target.innerHTML = `<p>${text.replace(/\n\n/g, '</p><p>')}</p>`;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // G. Trigger keystroke & blur/focus toggle to finalize React validation
    target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    target.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }));
    target.dispatchEvent(new Event('blur', { bubbles: true }));
    target.dispatchEvent(new Event('focus', { bubbles: true }));
    await sleep(200);

    return true;
  } catch (err) {
    console.warn('[CourseraPro] fillDiscussionInput error:', err);
    return false;
  }
}

/**
 * Locate the Reply / Submit button on the discussion prompt page
 * @returns {Element|null}
 */
function findSubmitButton() {
  // 1. Selector-based match
  const submitSelectors = [
    'button[data-testid="discussion-reply-submit"]',
    'button[data-testid="submit-button"]',
    'button[data-testid*="reply" i]',
    'button[data-testid*="submit" i]',
    'button.rc-DiscussionForumReplyForm__submit-btn',
    'button[type="submit"]',
    'button[aria-label*="reply" i]',
    'button[aria-label*="submit" i]',
  ];

  for (const sel of submitSelectors) {
    const btns = Array.from(document.querySelectorAll(sel));
    for (const btn of btns) {
      if (btn.offsetParent !== null || btn.getClientRects().length > 0) {
        const txt = (btn.textContent || '').trim().toLowerCase();
        if (txt !== 'cancel' && txt !== 'hủy' && txt !== 'close' && txt !== 'đóng') {
          return btn;
        }
      }
    }
  }

  // 2. Text-based match
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

  const allButtons = Array.from(document.querySelectorAll('button, a[role="button"], div[role="button"]'));
  for (const btn of allButtons) {
    const txt = (btn.textContent || '').trim().toLowerCase();
    if (
      validButtonTexts.includes(txt) ||
      (txt.startsWith('reply') && txt.length <= 15 && !txt.includes('to prompt'))
    ) {
      return btn;
    }
  }

  return null;
}

/**
 * Find and click the Submit / Post / Reply response button with polling
 * @returns {Promise<boolean>}
 */
async function submitDiscussion() {
  console.log('[CourseraPro] Waiting for enabled submit/reply button...');

  const startTime = Date.now();
  let candidateBtn = null;

  // Poll up to 6 seconds for the button to become enabled
  while (Date.now() - startTime < 6000) {
    candidateBtn = findSubmitButton();
    if (candidateBtn) {
      const isDisabled =
        candidateBtn.disabled === true ||
        candidateBtn.getAttribute('aria-disabled') === 'true' ||
        candidateBtn.classList.contains('disabled') ||
        candidateBtn.hasAttribute('disabled');

      if (!isDisabled) {
        console.log('[CourseraPro] Clicking enabled submit button:', candidateBtn.textContent?.trim());
        candidateBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);
        candidateBtn.click();
        return true;
      }
    }
    await sleep(350);
  }

  // Fallback: If button was found but still has disabled attribute, force remove and click
  if (candidateBtn) {
    console.warn('[CourseraPro] Submit button still disabled, attempting force-enable click');
    try {
      candidateBtn.disabled = false;
      candidateBtn.removeAttribute('disabled');
      candidateBtn.setAttribute('aria-disabled', 'false');
      candidateBtn.classList.remove('disabled');
      candidateBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(200);
      candidateBtn.click();
      return true;
    } catch (e) {
      console.warn('[CourseraPro] Force click failed:', e);
    }
  }

  return false;
}

/**
 * Handle a single discussion prompt on the current page
 * @returns {Promise<boolean>}
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
      return false;
    }

    if (isDiscussionAlreadySubmitted()) {
      showToast('Bài thảo luận này đã được nộp trước đó!', 'info');
      return true;
    }

    showToast('Đang tạo phản hồi độc nhất bằng AI...', 'info');

    // 1. Only open reply form if editor is NOT ALREADY in DOM!
    let editor = findDiscussionEditor();
    if (!editor) {
      const openerBtn = Array.from(document.querySelectorAll('button, a[role="button"]')).find((b) => {
        const t = b.textContent.trim().toLowerCase();
        return (
          t === 'reply to prompt' ||
          t === 'add a response' ||
          t === 'create post' ||
          t === 'tạo phản hồi' ||
          t === 'thêm phản hồi' ||
          t === 'leave a reply'
        );
      });
      if (openerBtn) {
        openerBtn.click();
        await sleep(800);
      }
    }

    // 2. Extract prompt text
    const promptEl = await waitForSelector(
      '.rc-CML, [data-testid="prompt-content"], .css-x3q7o9, [data-testid="discussion-prompt-description"], .rc-ItemContent, [data-testid="discussion-prompt-content"]',
      10000
    );
    const promptText = promptEl?.innerText?.trim() || promptEl?.textContent?.trim() || 'Discussion Prompt';

    // 3. Generate unique response
    const response = await generateDiscussionResponse(promptText);
    if (!response) {
      showToast('AI không tạo được phản hồi.', 'error');
      return false;
    }

    // 4. Find textarea or editor
    editor = findDiscussionEditor() || (await waitForSelector(
      'textarea, [contenteditable="true"], [data-testid="discussion-reply-text"], .ql-editor, div[role="textbox"], .public-DraftEditor-content',
      6000
    ));
    if (!editor) {
      showToast('Không tìm thấy khung nhập phản hồi.', 'error');
      return false;
    }

    await fillDiscussionInput(editor, response);
    showToast('Đã điền thảo luận! Chuẩn bị nộp...', 'info');
    await sleep(1200);

    const submitted = await submitDiscussion();
    if (submitted) {
      // 5. Verify that response was accepted
      let verified = false;
      const verifyStart = Date.now();
      while (Date.now() - verifyStart < 8000) {
        if (isDiscussionAlreadySubmitted()) {
          verified = true;
          break;
        }
        await sleep(500);
      }

      showToast('Đã gửi phản hồi thảo luận thành công!', 'success');
      return true;
    } else {
      showToast('Đã điền câu trả lời. Vui lòng bấm Reply (Nộp).', 'warning');
      return false;
    }
  } catch (error) {
    console.error('[CourseraPro] Discussion prompt error:', error);
    showToast('Lỗi thảo luận: ' + error.message, 'error');
    return false;
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

    // If currently viewing a discussion prompt, ensure current item is first in line
    const currentItemId = extractItemId();
    if (
      currentItemId &&
      (location.href.includes('/discussionPrompt/') ||
        location.href.includes('/discussion-prompt/') ||
        location.href.includes('/item/'))
    ) {
      const existingIdx = discussions.findIndex((d) => d.id === currentItemId);
      if (existingIdx >= 0) {
        const [curr] = discussions.splice(existingIdx, 1);
        discussions.unshift(curr);
      } else {
        discussions.unshift({
          id: currentItemId,
          name: document.querySelector('h1')?.textContent?.trim() || 'Discussion Prompt',
          slug: '',
          url: location.href,
          itemUrl: location.href,
        });
      }
    }

    if (discussions.length === 0) {
      const isDiscussionPage =
        location.href.includes('/discussionPrompt/') ||
        location.href.includes('/discussion-prompt/') ||
        location.href.includes('/item/');
      if (isDiscussionPage) {
        showToast('Đang giải quyết bài thảo luận hiện tại...', 'info');
        const ok = await handleDiscussionPrompt();
        if (ok) {
          updateProgress(1, 1, 'Hoàn thành 100%!');
        }
      } else {
        showToast('Không tìm thấy bài thảo luận nào trong khóa học này.', 'warning');
      }
      setDiscussionActive(false);
      return;
    }

    showToast(`Tìm thấy ${discussions.length} bài thảo luận! Bắt đầu tự động...`, 'success');
    isAutoDiscussionRunning = true;

    const total = discussions.length;
    let successCount = 0;

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
          successCount++;
          showToast(`Bài ${currentNum}/${total} đã làm trước đó.`, 'info');
          await sleep(1500);
        } else {
          showToast(`Đang làm bài hiện tại ${currentNum}/${total}...`, 'info');
          const success = await handleDiscussionPrompt();
          if (success) {
            successCount++;
          }
          await sleep(2500);

          // Safe countdown delay between newly posted discussions (30s - 40s)
          if (i < total - 1 && isAutoDiscussionRunning && success) {
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
            successCount++;
            showToast(`Bài ${currentNum}/${total} đã được nộp trước đó.`, 'info');
            await sleep(1500);
          } else if (res?.success) {
            successCount++;
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
            showToast(`Bài ${currentNum}/${total}: Không thể hoàn thành (${res?.error || 'Lỗi xử lý'}).`, 'warning');
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
      if (successCount === total) {
        updateProgress(total, total, 'Hoàn thành 100%!');
        showToast(`🎉 Chúc mừng! Đã hoàn thành tất cả ${total} bài thảo luận trong khóa học!`, 'success');
      } else {
        updateProgress(successCount, total, `Đã hoàn thành ${successCount}/${total} bài`);
        showToast(`Đã xử lý xong: ${successCount}/${total} bài thảo luận thành công.`, successCount > 0 ? 'info' : 'warning');
      }
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

    // 2. Open reply form only if editor not already present in DOM
    let editor = findDiscussionEditor();
    if (!editor) {
      const openFormBtn = Array.from(document.querySelectorAll('button, a[role="button"]')).find((b) => {
        const t = b.textContent.trim().toLowerCase();
        return (
          t === 'reply to prompt' ||
          t === 'add a response' ||
          t === 'create post' ||
          t === 'tạo phản hồi' ||
          t === 'thêm phản hồi' ||
          t === 'leave a reply'
        );
      });
      if (openFormBtn) {
        openFormBtn.click();
        await sleep(1000);
      }
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
    editor = findDiscussionEditor() || (await waitForSelector(
      'textarea, [contenteditable="true"], [data-testid="discussion-reply-text"], .ql-editor, div[role="textbox"], .public-DraftEditor-content',
      8000
    ));
    if (!editor) {
      throw new Error('Worker: Textarea not found.');
    }

    await fillDiscussionInput(editor, response);
    await sleep(1500);

    // 6. Submit
    const submitted = await submitDiscussion();
    if (!submitted) {
      throw new Error('Worker: Could not submit reply.');
    }
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
