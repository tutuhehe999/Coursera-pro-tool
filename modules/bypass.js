/**
 * Coursera Pro Tool - Video/Reading Bypass Module
 * Automatically marks videos and readings as completed using Native REST API
 * with graceful fallback to background worker tab.
 */

import { waitForSelector, sleep, safeClick } from '../utils/dom.js';
import { showToast, updateProgress } from '../ui/panel.js';
import { getMetadata, getCourseSlug } from '../utils/metadata.js';
import {
  getCurrentUserId,
  apiCompleteSupplement,
  apiCompleteVideo,
  apiCompleteWidget,
  apiCompleteCoach,
  apiCompleteLti,
} from '../utils/coursera-api.js';

let isBypassRunning = false;

/**
 * Cancel active bypass process
 */
export async function cancelBypass() {
  isBypassRunning = false;
  try {
    await chrome.runtime.sendMessage({ action: 'cancelBypass' });
  } catch (_e) {}
  updateProgress(0, 0, '');
  showToast('Đã dừng Bypass Week.', 'info');
}

/**
 * Automatically resolve all video and reading items in current week
 * Hybrid engine: attempts ultra-fast Native REST API first, then falls back to background worker
 */
export async function resolveWeekMaterial() {
  if (isBypassRunning) {
    await cancelBypass();
    return;
  }

  try {
    showToast('Đang quét bài học chưa hoàn thành trong tuần...', 'info');

    // Wait for week items to load if not already visible
    const itemSelector = '.rc-WeekItemList, [data-track-component="item_link"], .css-7jkbgo, [data-testid="item-link"]';
    try {
      await waitForSelector(itemSelector, 6000);
    } catch {
      // Continue to query
    }

    const rawElements = document.querySelectorAll(
      '.rc-WeekItemList a, [data-track-component="item_link"], .css-7jkbgo a, [data-testid="item-link"], a[href*="/lecture/"], a[href*="/supplement/"], a[href*="/item/"]'
    );

    if (rawElements.length === 0) {
      showToast('Không tìm thấy bài học nào trên trang hiện tại.', 'warning');
      return;
    }

    // Filter and deduplicate URLs
    const itemsToProcess = [];
    const seenUrls = new Set();

    for (const el of rawElements) {
      const url = el.href;
      if (!url || !url.includes('/learn/') || seenUrls.has(url)) continue;

      // Skip quiz, exam, or discussion items during video/reading bypass
      if (
        url.includes('/quiz/') ||
        url.includes('/exam/') ||
        url.includes('/discussion-prompt/') ||
        url.includes('/discussionPrompt/') ||
        url.includes('/peer/')
      ) {
        continue;
      }

      // Skip already completed items
      const isCompleted =
        el.querySelector('[aria-label="Completed"]') ||
        el.querySelector('.css-1wj6obr') ||
        el.closest('[class*="completed"]');

      if (isCompleted) continue;

      // Extract itemId and itemType
      let itemId = '';
      let itemType = 'unknown';

      const lectureMatch = url.match(/\/lecture\/([A-Za-z0-9_-]+)/);
      const supplementMatch = url.match(/\/supplement\/([A-Za-z0-9_-]+)/);
      const itemMatch = url.match(/\/item\/([A-Za-z0-9_-]+)/);

      if (lectureMatch) {
        itemId = lectureMatch[1];
        itemType = 'lecture';
      } else if (supplementMatch) {
        itemId = supplementMatch[1];
        itemType = 'supplement';
      } else if (itemMatch) {
        itemId = itemMatch[1];
        itemType = 'item';
      }

      seenUrls.add(url);
      itemsToProcess.push({
        url,
        itemId,
        itemType,
        title: el.textContent?.trim() || 'Item',
      });
    }

    if (itemsToProcess.length === 0) {
      showToast('Tất cả video và bài đọc tuần này đã hoàn thành!', 'success');
      return;
    }

    const total = itemsToProcess.length;
    let completed = 0;
    isBypassRunning = true;

    // Retrieve context for Native REST API
    const meta = getMetadata();
    const courseSlug = meta.open_course_slug || getCourseSlug();
    const courseId = meta.course_id;
    const userId = await getCurrentUserId();

    const canUseApi = Boolean(userId && courseId && courseSlug);
    if (canUseApi) {
      showToast(`⚡ Kích hoạt Động cơ Native API: Xử lý siêu tốc ${total} bài học...`, 'info');
    } else {
      showToast(`Tìm thấy ${total} bài học chưa hoàn thành! Đang xử lý ngầm tuần tự...`, 'info');
    }

    for (let i = 0; i < total; i++) {
      if (!isBypassRunning) {
        showToast('Đã dừng Bypass.', 'info');
        break;
      }

      const item = itemsToProcess[i];
      updateProgress(i + 1, total, `Đang xử lý ${i + 1}/${total}: ${item.title}`);

      let success = false;

      // --- STRATEGY 1: Native REST API (Super Fast & Zero-Tab) ---
      if (canUseApi && item.itemId) {
        try {
          if (item.itemType === 'supplement') {
            success = await apiCompleteSupplement(courseId, item.itemId, userId);
          } else if (item.itemType === 'lecture') {
            success = await apiCompleteVideo(userId, courseSlug, courseId, item.itemId);
          } else {
            // Try supplement first, then video
            success = await apiCompleteSupplement(courseId, item.itemId, userId);
            if (!success) {
              success = await apiCompleteVideo(userId, courseSlug, courseId, item.itemId);
            }
          }
        } catch (apiErr) {
          console.warn('[CourseraPro] Native API attempt error:', apiErr);
        }
      }

      // --- STRATEGY 2: Background Worker Fallback ---
      if (!success) {
        try {
          const isLast = (i === total - 1);
          const workerUrl = item.url.includes('#')
            ? `${item.url.split('#')[0]}#cpt_bypass=1`
            : `${item.url}#cpt_bypass=1`;

          const res = await chrome.runtime.sendMessage({
            action: 'bypassItemSingleWorker',
            url: workerUrl,
            isLast,
          });

          if (res?.success) {
            success = true;
          }
        } catch (workerErr) {
          console.warn('[CourseraPro] Worker fallback error:', item.url, workerErr);
        }
      }

      if (success) {
        completed++;
      }

      // Small jitter delay between items to respect rate limits
      await sleep(canUseApi ? 300 : 800);
    }

    if (isBypassRunning) {
      showToast(`🎉 Đã xử lý xong ${completed}/${total} bài học tuần này! Đang tải lại trang...`, 'success');
      updateProgress(total, total, 'Hoàn thành 100%!');
      await sleep(2200);
      location.reload();
    }
  } catch (error) {
    console.error('Bypass error:', error);
    showToast('Lỗi Bypass: ' + error.message, 'error');
    updateProgress(0, 0, '');
  } finally {
    isBypassRunning = false;
  }
}

/**
 * Run inside background worker tab for video/reading bypass
 * Automatically seeks and completes videos silently with audio muted
 */
export async function runBypassWorker() {
  try {
    if (location.href.includes('/lecture/')) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const video =
          document.querySelector('video') ||
          document.querySelector('iframe')?.contentDocument?.querySelector('video');
        if (video && !isNaN(video.duration) && video.duration > 0) {
          video.muted = true; // Mute in background
          video.currentTime = Math.max(0, video.duration - 0.5);
          video.play().catch(() => {});
          console.log('[CourseraPro] Worker auto-skipped video to completion.');
          break;
        }
        await sleep(400);
      }
    }
  } catch (e) {
    console.warn('[CourseraPro] Worker bypass error:', e);
  }
}

/**
 * Skip to end of current video
 */
export function skipVideo() {
  try {
    let video = document.querySelector('video');

    // Try finding inside iframe if embedded
    if (!video) {
      const iframes = document.querySelectorAll('iframe');
      for (const f of iframes) {
        try {
          video = f.contentDocument?.querySelector('video');
          if (video) break;
        } catch {
          // Cross-origin iframe
        }
      }
    }

    if (video) {
      if (isNaN(video.duration) || video.duration <= 0) {
        showToast('Video đang tải hoặc chưa sẵn sàng, vui lòng thử lại sau 1s.', 'warning');
        return;
      }
      video.currentTime = Math.max(0, video.duration - 0.5);
      video.play().catch(() => {});
      showToast('⚡ Đã tua xem hết video hiện tại!', 'success');
    } else {
      showToast('Không tìm thấy video trên trang này.', 'warning');
    }
  } catch (e) {
    console.error('Skip video error:', e);
    showToast('Lỗi tua video: ' + e.message, 'error');
  }
}

const SPEED_PRESETS = [1, 1.25, 1.5, 2, 2.5, 3, 4];

/**
 * Set video playback speed
 * @param {number} speed - Playback rate (e.g. 1.5, 2, 3)
 */
export function setVideoSpeed(speed = 2) {
  try {
    const video = document.querySelector('video');
    if (video) {
      video.playbackRate = speed;
    }
    localStorage.setItem('cpt_playback_rate', String(speed));

    // Notify inject/script.js in page context
    window.dispatchEvent(
      new CustomEvent('CourseraProTool_SetSpeed', { detail: { speed } })
    );

    // Update speed badge in panel if exists
    const speedBadge = document.getElementById('cpt-speed-tag');
    if (speedBadge) {
      speedBadge.textContent = `${speed}x`;
    }

    showToast(`⏩ Tốc độ phát video: ${speed}x`, 'info');
  } catch (e) {
    console.error('[CourseraPro] Set video speed error:', e);
  }
}

/**
 * Cycle through video playback speed presets
 * @returns {number} new speed
 */
export function cycleVideoSpeed() {
  const current = parseFloat(localStorage.getItem('cpt_playback_rate') || '1.0');
  const currentIndex = SPEED_PRESETS.findIndex((s) => Math.abs(s - current) < 0.05);
  const nextIndex = currentIndex === -1 || currentIndex >= SPEED_PRESETS.length - 1 ? 0 : currentIndex + 1;
  const nextSpeed = SPEED_PRESETS[nextIndex];

  setVideoSpeed(nextSpeed);
  return nextSpeed;
}
