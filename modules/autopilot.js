/**
 * Coursera Pro Tool - Master Course Autopilot Module
 * End-to-end 1-Click Course Automation:
 * 1. Crawls entire course syllabus (Weeks 1 to N)
 * 2. Multi-Pass Material Bypass Engine: Unlocks progressive modules automatically
 * 3. Stage 1: High-Speed Native API Bypass (videos, readings, widgets, coach, lti)
 * 4. Stage 2: Anti-Ban Forum Auto-Discussion Solver
 * 5. Stage 3: Sequential AI Quiz Runner with Smart Retake & State Persistence
 * 6. Stage 4: Fail-Safe 100% Completion Auditor
 */

import { sleep } from '../utils/dom.js';
import { showToast, updateProgress } from '../ui/panel.js';
import { getMetadata, getCourseSlug } from '../utils/metadata.js';
import {
  getCurrentUserId,
  fetchCourseStructure,
  fetchCourseCompletedItems,
  apiCompleteSupplement,
  apiCompleteVideo,
  apiCompleteWidget,
  apiCompleteCoach,
  apiCompleteLti,
} from '../utils/coursera-api.js';
import { startAutoAllDiscussions, cancelAutoDiscussion } from './discussion.js';

export const STORAGE_KEY_AUTOPILOT_QUEUE = 'cpt_master_autopilot_queue';

let isAutopilotRunning = false;
let isAutopilotPaused = false;

/**
 * Check if Autopilot is currently active
 * @returns {{ isRunning: boolean, isPaused: boolean }}
 */
export function getAutopilotState() {
  return {
    isRunning: isAutopilotRunning,
    isPaused: isAutopilotPaused,
  };
}

/**
 * Stop the course autopilot process and clear any pending queues
 */
export async function stopCourseAutopilot() {
  isAutopilotRunning = false;
  isAutopilotPaused = false;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.remove([STORAGE_KEY_AUTOPILOT_QUEUE]);
    }
    await cancelAutoDiscussion();
  } catch (_e) {}
  updateProgress(0, 0, '');
  showToast('Đã dừng Master Course Autopilot.', 'info');
}

/**
 * Pause the course autopilot process
 */
export function pauseCourseAutopilot() {
  if (isAutopilotRunning) {
    isAutopilotPaused = true;
    showToast('⏸️ Đã tạm dừng Autopilot.', 'warning');
  }
}

/**
 * Resume the course autopilot process
 */
export function resumeCourseAutopilot() {
  if (isAutopilotRunning && isAutopilotPaused) {
    isAutopilotPaused = false;
    showToast('▶️ Đang tiếp tục Autopilot...', 'info');
  }
}

/**
 * Pure function to classify course items by status and category
 * @param {Array<object>} allItems
 * @param {Set<string>} completedIds
 * @returns {object}
 */
export function categorizeCourseItems(allItems = [], completedIds = new Set()) {
  const pendingMaterials = [];
  const pendingDiscussions = [];
  const pendingQuizzes = [];
  const pendingAssignments = [];
  const lockedItems = [];
  let completedCount = 0;

  for (const item of allItems) {
    if (!item || !item.id) continue;

    if (completedIds.has(item.id)) {
      completedCount++;
      continue;
    }

    if (item.isLocked) {
      lockedItems.push(item);
      continue;
    }

    const type = (item.contentSummary?.typeName || '').toLowerCase();
    const slug = (item.slug || '').toLowerCase();
    const name = (item.name || '').toLowerCase();

    if (type === 'lecture' || type === 'supplement' || type === 'coach' || type === 'ungradedwidget' || type === 'ungradedlti') {
      pendingMaterials.push(item);
    } else if (type === 'discussionprompt' || slug.includes('discussion-prompt') || name.includes('discussion prompt')) {
      pendingDiscussions.push(item);
    } else if (
      type === 'quiz' ||
      type === 'exam' ||
      type === 'ungradedassignment' ||
      type === 'staffgraded' ||
      type === 'gradedassignment' ||
      slug.includes('quiz') ||
      slug.includes('exam')
    ) {
      pendingQuizzes.push(item);
    } else if (type === 'peer' || type === 'phasedpeer' || slug.includes('peer')) {
      pendingAssignments.push(item);
    } else {
      pendingMaterials.push(item);
    }
  }

  const totalCount = allItems.length;
  const completionPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return {
    pendingMaterials,
    pendingDiscussions,
    pendingQuizzes,
    pendingAssignments,
    lockedItems,
    completedCount,
    totalCount,
    completionPercent,
  };
}

/**
 * Run final audit comparing course syllabus against completed items
 * @param {string} userId
 * @param {string} courseId
 * @param {string} courseSlug
 * @returns {Promise<{ isComplete: boolean, completedCount: number, totalCount: number, remaining: Array }>}
 */
export async function runFinalAudit(userId, courseId, courseSlug) {
  showToast('🔍 Đang kiểm toán lại tiến độ hoàn thành toàn bộ khóa học...', 'info');
  await sleep(1800);

  const [structureData, finalCompleted] = await Promise.all([
    fetchCourseStructure(courseSlug),
    fetchCourseCompletedItems(userId, courseId),
  ]);

  const allItems = structureData?.linked?.['onDemandCourseMaterialItems.v2'] || [];
  const { completedCount, totalCount, pendingMaterials, pendingQuizzes, pendingDiscussions, pendingAssignments } =
    categorizeCourseItems(allItems, finalCompleted);

  const remainingTotal = pendingMaterials.length + pendingQuizzes.length + pendingDiscussions.length + pendingAssignments.length;

  if (remainingTotal === 0 && totalCount > 0) {
    showToast('🏆 XUẤT SẮC! Toàn bộ khóa học đã đạt 100% tích xanh, chứng chỉ đã sẵn sàng!', 'success');
    updateProgress(100, 100, 'Khóa học hoàn thành 100%!');
    return { isComplete: true, completedCount: totalCount, totalCount, remaining: [] };
  } else {
    showToast(
      `✨ Hoàn thành ${completedCount}/${totalCount} bài (${Math.round((completedCount / totalCount) * 100)}%)! Còn ${remainingTotal} bài chưa đạt yêu cầu.`,
      'info'
    );
    updateProgress(completedCount, totalCount, `Tiến độ: ${completedCount}/${totalCount} (${Math.round((completedCount / totalCount) * 100)}%)`);
    return { isComplete: false, completedCount, totalCount, remaining: [...pendingMaterials, ...pendingQuizzes] };
  }
}

/**
 * Advance the Autopilot Quiz Queue to the next quiz
 * @param {object} queue
 */
export async function advanceAutopilotQuizQueue(queue) {
  if (!queue || !Array.isArray(queue.quizzes)) return;

  queue.currentIndex++;
  if (queue.currentIndex >= queue.quizzes.length) {
    // All quizzes completed!
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.remove([STORAGE_KEY_AUTOPILOT_QUEUE]);
    }
    showToast('🏆 Đã hoàn thành tất cả bài Quiz trong khóa học!', 'success');
    await sleep(2000);
    const welcomeUrl = `https://www.coursera.org/learn/${queue.courseSlug}/home/welcome`;
    window.location.href = welcomeUrl;
  } else {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY_AUTOPILOT_QUEUE]: queue });
    }
    const nextQuiz = queue.quizzes[queue.currentIndex];
    const nextUrl = nextQuiz.slug
      ? `https://www.coursera.org/learn/${queue.courseSlug}/exam/${nextQuiz.id}/${nextQuiz.slug}`
      : `https://www.coursera.org/learn/${queue.courseSlug}/item/${nextQuiz.id}`;

    showToast(`➡️ Đang chuyển sang Quiz tiếp theo (${queue.currentIndex + 1}/${queue.quizzes.length}): "${nextQuiz.name}"...`, 'info');
    await sleep(2000);
    window.location.href = nextUrl;
  }
}

/**
 * Check and resume Autopilot Quiz queue across page reloads & SPA transitions
 */
export async function checkAndResumeCourseAutopilot() {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

    const result = await chrome.storage.local.get([STORAGE_KEY_AUTOPILOT_QUEUE]);
    const queue = result[STORAGE_KEY_AUTOPILOT_QUEUE];
    if (!queue || !queue.active) return;

    // Safety expiration: 1 hour
    if (Date.now() - (queue.startTime || 0) > 3600000) {
      await chrome.storage.local.remove([STORAGE_KEY_AUTOPILOT_QUEUE]);
      return;
    }

    const currentQuiz = queue.quizzes?.[queue.currentIndex];
    if (!currentQuiz) {
      await chrome.storage.local.remove([STORAGE_KEY_AUTOPILOT_QUEUE]);
      await runFinalAudit(queue.userId, queue.courseId, queue.courseSlug);
      return;
    }

    console.log(`[CourseraPro Autopilot] Resuming quiz ${queue.currentIndex + 1}/${queue.quizzes.length}: ${currentQuiz.name}`);
    showToast(
      `🚀 [Master Autopilot]: Đang xử lý Quiz ${queue.currentIndex + 1}/${queue.quizzes.length}: "${currentQuiz.name}"...`,
      'info'
    );

    // If currently inside /attempt: auto-solve
    if (location.href.includes('/attempt')) {
      const { solveAndSubmitQuiz } = await import('./quiz.js');
      await sleep(1500);
      await solveAndSubmitQuiz();
      return;
    }

    // If currently on /review feedback page: advance to next quiz
    if (location.href.includes('/review')) {
      await sleep(2000);
      await advanceAutopilotQuizQueue(queue);
      return;
    }

    // If on assignment overview page: look for enter button
    const enterBtn = Array.from(document.querySelectorAll('button, a')).find((el) => {
      const t = el.textContent.trim().toLowerCase();
      return t === 'start' || t === 'resume' || t === 'bắt đầu' || t === 'tiếp tục' || t === 'try again' || t === 'làm lại';
    });

    if (enterBtn) {
      showToast('Đang bấm vào bài làm (Resume / Start)...', 'info');
      await sleep(1200);
      enterBtn.click();
    } else {
      // Direct navigation into /attempt
      const cleanUrl = location.href.split('?')[0].replace(/\/$/, '');
      if (!cleanUrl.includes('/attempt')) {
        await sleep(1500);
        window.location.href = `${cleanUrl}/attempt`;
      }
    }
  } catch (err) {
    console.warn('[CourseraPro Autopilot] checkAndResume error:', err);
  }
}

/**
 * Main entry point for Master Course Autopilot
 */
export async function startCourseAutopilot() {
  if (isAutopilotRunning) {
    await stopCourseAutopilot();
    return;
  }

  isAutopilotRunning = true;
  isAutopilotPaused = false;

  try {
    const meta = getMetadata();
    const courseSlug = (meta.open_course_slug || getCourseSlug() || '').toLowerCase().trim();
    if (!courseSlug) {
      showToast('⚠️ Không phát hiện được khóa học hiện tại. Hãy mở trang khóa học Coursera!', 'error');
      isAutopilotRunning = false;
      return;
    }

    showToast('🚀 Khởi động Master Course Autopilot: Đang quét cấu trúc toàn bộ khóa học...', 'info');
    updateProgress(0, 100, 'Đang quét toàn khóa...');

    // 1. Fetch Course Structure & User Context
    const [userId, structureData] = await Promise.all([
      getCurrentUserId(),
      fetchCourseStructure(courseSlug),
    ]);

    if (!userId) {
      showToast('⚠️ Chưa lấy được User ID. Vui lòng đảm bảo bạn đã đăng nhập Coursera!', 'error');
      isAutopilotRunning = false;
      return;
    }

    const courseId = structureData?.elements?.[0]?.id || meta.course_id;
    if (!courseId) {
      showToast('⚠️ Không tìm thấy Course ID. Hãy đảm bảo bạn đã ghi danh môn học!', 'error');
      isAutopilotRunning = false;
      return;
    }

    const allItems = structureData?.linked?.['onDemandCourseMaterialItems.v2'] || [];
    const modules = structureData?.linked?.['onDemandCourseMaterialModules.v1'] || [];

    if (allItems.length === 0) {
      showToast('⚠️ Không tìm thấy bài học nào trong cấu trúc khóa học.', 'warning');
      isAutopilotRunning = false;
      return;
    }

    showToast(`📚 Tìm thấy ${modules.length} tuần học với tổng cộng ${allItems.length} bài học! Bắt đầu kiểm toán tiến độ...`, 'info');

    // 2. Fetch Initial Progress
    const initialCompleted = await fetchCourseCompletedItems(userId, courseId);
    let category = categorizeCourseItems(allItems, initialCompleted);

    console.log(`[CourseraPro Autopilot] Initial progress: ${category.completedCount}/${allItems.length} (${category.completionPercent}%)`);

    const totalPending = category.pendingMaterials.length + category.pendingDiscussions.length + category.pendingQuizzes.length + category.pendingAssignments.length;
    if (totalPending === 0) {
      showToast('🎉 Chúc mừng! Toàn bộ khóa học đã hoàn thành 100% tích xanh!', 'success');
      updateProgress(100, 100, 'Đã hoàn thành 100%!');
      isAutopilotRunning = false;
      return;
    }

    showToast(
      `🎯 Cần xử lý ${totalPending} bài: ${category.pendingMaterials.length} video/bài đọc, ${category.pendingDiscussions.length} thảo luận, ${category.pendingQuizzes.length} bài tập trắc nghiệm.`,
      'info'
    );

    // 3. STAGE 1: Dynamic Multi-Pass Fast Material Bypass (Unlocks subsequent weeks automatically!)
    let pass = 1;
    const maxPasses = 8;
    const failedItemIds = new Set();
    let totalMaterialsProcessed = 0;

    while (isAutopilotRunning && pass <= maxPasses) {
      // Refresh completion state & structure to detect newly unlocked modules
      const currentCompleted = await fetchCourseCompletedItems(userId, courseId);
      const freshStructure = pass === 1 ? structureData : await fetchCourseStructure(courseSlug);
      const currentItems = freshStructure?.linked?.['onDemandCourseMaterialItems.v2'] || allItems;

      const currentCategory = categorizeCourseItems(currentItems, currentCompleted);
      const unlockedMaterials = currentCategory.pendingMaterials.filter((it) => !it.isLocked && !failedItemIds.has(it.id));

      if (unlockedMaterials.length === 0) {
        // No more unlocked materials left to bypass in this pass
        break;
      }

      showToast(`⚡ [GIAI ĐOẠN 1 - ĐỢT ${pass}]: Bắt đầu Bypass thần tốc ${unlockedMaterials.length} bài học đã mở khóa...`, 'info');

      for (let i = 0; i < unlockedMaterials.length; i++) {
        if (!isAutopilotRunning) break;
        while (isAutopilotPaused) {
          if (!isAutopilotRunning) break;
          await sleep(500);
        }
        if (!isAutopilotRunning) break;

        const item = unlockedMaterials[i];
        const type = (item.contentSummary?.typeName || '').toLowerCase();
        totalMaterialsProcessed++;

        updateProgress(
          i + 1,
          unlockedMaterials.length,
          `[Giai đoạn 1] (${i + 1}/${unlockedMaterials.length}): ${item.name || 'Bài học'}`
        );

        let success = false;
        try {
          if (type === 'supplement') {
            success = await apiCompleteSupplement(courseId, item.id, userId);
          } else if (type === 'lecture') {
            success = await apiCompleteVideo(userId, courseSlug, courseId, item.id, item.timeCommitment);
          } else if (type === 'coach') {
            success = await apiCompleteCoach(userId, courseId, item.id);
          } else if (type === 'ungradedwidget') {
            success = await apiCompleteWidget(userId, courseId, item.id);
          } else if (type === 'ungradedlti') {
            success = await apiCompleteLti(userId, courseId, item.id);
          } else {
            success = await apiCompleteSupplement(courseId, item.id, userId);
          }
        } catch (err) {
          console.warn('[CourseraPro Autopilot] Material item error:', item.name, err);
        }

        if (!success) {
          failedItemIds.add(item.id);
        }

        await sleep(350); // Small jitter delay to protect account
      }

      pass++;
      await sleep(1000);
    }

    if (!isAutopilotRunning) return;

    if (totalMaterialsProcessed > 0) {
      showToast(`✅ [GIAI ĐOẠN 1 HOÀN TẤT]: Đã xử lý ${totalMaterialsProcessed} bài học video và bài đọc!`, 'success');
      await sleep(1500);
    }

    // 4. STAGE 2: Anti-Ban Forum Auto-Discussions
    if (isAutopilotRunning) {
      const refreshedCompleted = await fetchCourseCompletedItems(userId, courseId);
      const postStage1Category = categorizeCourseItems(allItems, refreshedCompleted);

      if (postStage1Category.pendingDiscussions.length > 0) {
        showToast(`💬 [GIAI ĐOẠN 2/3]: Bắt đầu xử lý ${postStage1Category.pendingDiscussions.length} bài thảo luận diễn đàn...`, 'info');
        await startAutoAllDiscussions();
        await sleep(2000);
      }
    }

    if (!isAutopilotRunning) return;

    // 5. STAGE 3: Sequential AI Quiz Runner with Persistence
    const finalCheckCompleted = await fetchCourseCompletedItems(userId, courseId);
    const postStage2Category = categorizeCourseItems(allItems, finalCheckCompleted);
    const unlockedQuizzes = postStage2Category.pendingQuizzes.filter((q) => !q.isLocked);

    if (isAutopilotRunning && unlockedQuizzes.length > 0) {
      showToast(
        `📝 [GIAI ĐOẠN 3/3]: Phát hiện ${unlockedQuizzes.length} bài Quiz/Exam cần giải! Bắt đầu chuỗi tự động giải AI...`,
        'info'
      );

      const quizQueue = {
        active: true,
        courseSlug,
        userId,
        courseId,
        quizzes: unlockedQuizzes.map((q) => ({
          id: q.id,
          slug: q.slug || '',
          name: q.name || 'Quiz',
          typeName: q.contentSummary?.typeName || 'quiz',
        })),
        currentIndex: 0,
        startTime: Date.now(),
      };

      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({ [STORAGE_KEY_AUTOPILOT_QUEUE]: quizQueue });
      }

      const firstQuiz = quizQueue.quizzes[0];
      const targetUrl = firstQuiz.slug
        ? `https://www.coursera.org/learn/${courseSlug}/exam/${firstQuiz.id}/${firstQuiz.slug}`
        : `https://www.coursera.org/learn/${courseSlug}/item/${firstQuiz.id}`;

      showToast(`🚀 Đang chuyển đến bài Quiz 1/${unlockedQuizzes.length}: "${firstQuiz.name}"...`, 'info');
      await sleep(2000);
      window.location.href = targetUrl;
      return; // Hand-off to checkAndResumeCourseAutopilot on the quiz page!
    }

    // 6. STAGE 4: Final Fail-Safe Audit
    if (isAutopilotRunning) {
      await runFinalAudit(userId, courseId, courseSlug);
    }
  } catch (err) {
    console.error('[CourseraPro] Autopilot error:', err);
    showToast('Lỗi Autopilot: ' + err.message, 'error');
  } finally {
    isAutopilotRunning = false;
    isAutopilotPaused = false;
  }
}
