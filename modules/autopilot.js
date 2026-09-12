/**
 * Coursera Pro Tool - Master Course Autopilot Module
 * End-to-end 1-Click Course Automation:
 * 1. Crawls entire course syllabus (Weeks 1 to N)
 * 2. Audits completion status via Coursera Progress API
 * 3. Executes Sequential Pipeline: Materials Bypass -> Discussions -> Quizzes
 * 4. Verifies 100% completion with Fail-Safe Auditor
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
import { startAutoAllDiscussions } from './discussion.js';

let isAutopilotRunning = false;
let isAutopilotPaused = false;

/**
 * Check if Autopilot is currently active
 * @returns {boolean}
 */
export function getAutopilotState() {
  return {
    isRunning: isAutopilotRunning,
    isPaused: isAutopilotPaused,
  };
}

/**
 * Stop the course autopilot process
 */
export function stopCourseAutopilot() {
  isAutopilotRunning = false;
  isAutopilotPaused = false;
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
 * Main entry point for Master Course Autopilot
 */
export async function startCourseAutopilot() {
  if (isAutopilotRunning) {
    stopCourseAutopilot();
    return;
  }

  isAutopilotRunning = true;
  isAutopilotPaused = false;

  try {
    const meta = getMetadata();
    const courseSlug = meta.open_course_slug || getCourseSlug();
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

    const courseId = structureData?.elements?.[0]?.id || meta.course_id;
    if (!courseId) {
      showToast('⚠️ Không tìm thấy Course ID. Hãy đảm bảo bạn đã đăng nhập và ghi danh khóa học!', 'error');
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

    showToast(`📚 Tìm thấy ${modules.length} tuần học với tổng cộng ${allItems.length} bài học! Đang kiểm tra tiến độ...`, 'info');

    // 2. Fetch Completed Items
    const completedItems = await fetchCourseCompletedItems(userId, courseId);
    console.log(`[CourseraPro Autopilot] Completed items: ${completedItems.size}/${allItems.length}`);

    // Categorize pending items
    const pendingMaterials = [];
    const pendingDiscussions = [];
    const pendingQuizzes = [];
    const pendingAssignments = [];

    for (const item of allItems) {
      if (completedItems.has(item.id)) continue;
      if (item.isLocked) continue;

      const type = item.contentSummary?.typeName || '';
      const slug = item.slug || '';

      if (type === 'lecture' || type === 'supplement' || type === 'coach' || type === 'ungradedWidget' || type === 'ungradedLti') {
        pendingMaterials.push(item);
      } else if (type === 'discussionPrompt' || slug.includes('discussion-prompt')) {
        pendingDiscussions.push(item);
      } else if (type === 'quiz' || type === 'exam' || type === 'ungradedAssignment' || type === 'staffGraded') {
        pendingQuizzes.push(item);
      } else if (type === 'peer' || type === 'phasedPeer') {
        pendingAssignments.push(item);
      } else {
        pendingMaterials.push(item);
      }
    }

    const totalPending = pendingMaterials.length + pendingDiscussions.length + pendingQuizzes.length + pendingAssignments.length;
    if (totalPending === 0) {
      showToast('🎉 Chúc mừng! Toàn bộ khóa học đã hoàn thành 100% tích xanh!', 'success');
      updateProgress(100, 100, 'Đã hoàn thành 100%!');
      isAutopilotRunning = false;
      return;
    }

    showToast(`🎯 Cần xử lý ${totalPending} bài: ${pendingMaterials.length} video/bài đọc, ${pendingDiscussions.length} thảo luận, ${pendingQuizzes.length} bài tập trắc nghiệm.`, 'info');

    // 3. STAGE 1: Fast Native API Material Bypass
    if (pendingMaterials.length > 0) {
      showToast(`⚡ [GIAI ĐOẠN 1/3]: Bắt đầu Bypass thần tốc ${pendingMaterials.length} video và bài đọc...`, 'info');

      for (let i = 0; i < pendingMaterials.length; i++) {
        if (!isAutopilotRunning) break;
        while (isAutopilotPaused) {
          await sleep(1000);
        }

        const item = pendingMaterials[i];
        const type = item.contentSummary?.typeName || '';
        const progressPercent = Math.round(((i + 1) / pendingMaterials.length) * 40);
        updateProgress(i + 1, pendingMaterials.length, `[Giai đoạn 1] (${i + 1}/${pendingMaterials.length}): ${item.name || 'Bài học'}`);

        try {
          if (type === 'supplement') {
            await apiCompleteSupplement(courseId, item.id, userId);
          } else if (type === 'lecture') {
            await apiCompleteVideo(userId, courseSlug, courseId, item.id, item.timeCommitment);
          } else if (type === 'coach') {
            await apiCompleteCoach(userId, courseId, item.id);
          } else if (type === 'ungradedWidget') {
            await apiCompleteWidget(userId, courseId, item.id);
          } else if (type === 'ungradedLti') {
            await apiCompleteLti(userId, courseId, item.id);
          } else {
            // General attempt
            await apiCompleteSupplement(courseId, item.id, userId);
          }
        } catch (err) {
          console.warn('[CourseraPro Autopilot] Material item error:', item.name, err);
        }

        await sleep(350); // Small jitter delay to protect account
      }

      showToast(`✅ [GIAI ĐOẠN 1/3 HOÀN TẤT]: Đã xử lý xong toàn bộ video và bài đọc của khóa!`, 'success');
      await sleep(1500);
    }

    // 4. STAGE 2: Discussions (Zero-Navigation Background Worker with Anti-Ban Delay)
    if (isAutopilotRunning && pendingDiscussions.length > 0) {
      showToast(`💬 [GIAI ĐOẠN 2/3]: Bắt đầu xử lý ${pendingDiscussions.length} bài thảo luận diễn đàn...`, 'info');
      await startAutoAllDiscussions();
      await sleep(2000);
    }

    // 5. STAGE 3: Quizzes / Exams / Assignments
    if (isAutopilotRunning && pendingQuizzes.length > 0) {
      showToast(
        `📝 [GIAI ĐOẠN 3/3]: Khóa học có ${pendingQuizzes.length} bài quiz/kiểm tra. Bạn chỉ cần click vào từng quiz và bấm "Auto Quiz", AI sẽ giải 100%!`,
        'info'
      );
    }

    // 6. STAGE 4: Final Fail-Safe Audit
    if (isAutopilotRunning) {
      showToast('🔍 Đang kiểm toán lại tiến độ hoàn thành toàn bộ khóa học...', 'info');
      await sleep(2000);

      const finalCompleted = await fetchCourseCompletedItems(userId, courseId);
      const remaining = allItems.filter((it) => !finalCompleted.has(it.id) && !it.isLocked);

      if (remaining.length === 0) {
        showToast('🏆 XUẤT SẮC! Toàn bộ môn học đã đạt 100% tích xanh, chứng chỉ đã sẵn sàng!', 'success');
        updateProgress(100, 100, 'Khóa học hoàn thành 100%!');
      } else {
        showToast(`✨ Đã hoàn thành phần lớn khóa học! Còn ${remaining.length} bài (chủ yếu là Quiz/Peer), hãy bấm giải để nhận chứng chỉ!`, 'success');
        updateProgress(allItems.length - remaining.length, allItems.length, `Tiến độ: ${allItems.length - remaining.length}/${allItems.length}`);
      }
    }
  } catch (err) {
    console.error('[CourseraPro] Autopilot error:', err);
    showToast('Lỗi Autopilot: ' + err.message, 'error');
  } finally {
    isAutopilotRunning = false;
    isAutopilotPaused = false;
  }
}
