/**
 * Coursera Pro Tool - Content Script Entry Point
 * Injects the floating panel and sets up all module handlers
 */

import { createPanel, showToast, togglePanelMinimize } from '../ui/panel.js';
import { resolveWeekMaterial, skipVideo, cycleVideoSpeed, runBypassWorker } from '../modules/bypass.js';
import { handleAutoQuiz, checkAndResumeAutoQuiz, recordQuizReviewFeedback } from '../modules/quiz.js';
import { handleDiscussionPrompt, toggleAutoDiscussions, checkAndResumeDiscussionAutomation, runDiscussionWorker } from '../modules/discussion.js';
import { handleReview, handlePeerGradedAssignment, checkAndResumeAutoReview } from '../modules/review.js';
import { handleDisableAiGrading, handleGetShareableLink, handleRequestGrading } from '../modules/grading.js';
import { handleAutoAssignment } from '../modules/assignment.js';
import { startCourseAutopilot, checkAndResumeCourseAutopilot } from '../modules/autopilot.js';
import { waitForSelector } from '../utils/dom.js';

/**
 * Inject the page-context script for lockdown browser bypass
 */
function injectPageScript() {
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = chrome.runtime.getURL('inject/script.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

/**
 * Set up lockdown browser bypass listeners
 */
function setupLockdownBypass() {
  // Handle coursera-lock:// URLs intercepted by inject script
  const handleLockUrl = (url) => {
    const cleanUrl = url.replace('coursera-lock://', 'https://');
    const parsed = new URL(cleanUrl);
    const token = parsed.searchParams.get('token');
    parsed.searchParams.delete('token');
    const finalUrl = parsed.toString();

    if (token) {
      chrome.runtime.sendMessage({
        action: 'redirect',
        token: token,
        redirectUrl: finalUrl,
      });
      return;
    }

    chrome.runtime.sendMessage({ action: 'openOnly', url: finalUrl });
  };

  // Listen for click events on coursera-lock:// links
  document.addEventListener(
    'click',
    (e) => {
      let target = e.target;
      while (target && target !== document.body) {
        const href = target.href || target.getAttribute?.('href');
        if (href && href.startsWith('coursera-lock://')) {
          e.preventDefault();
          e.stopPropagation();
          handleLockUrl(href);
          return;
        }
        target = target.parentNode;
      }
    },
    true
  );

  // Listen for mutations to catch dynamically added lock links
  new MutationObserver(() => {
    const lockLinks = document.querySelectorAll('a[href^="coursera-lock://"]');
    for (const link of lockLinks) {
      if (link.dataset.bypassed) continue;
      link.dataset.bypassed = 'true';
      link.addEventListener(
        'click',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleLockUrl(link.getAttribute('href') || link.href);
        },
        true
      );
    }
  }).observe(document.body, { childList: true, subtree: true });

  // Listen for intercept events from inject script
  window.addEventListener('CourseraProTool_Intercept', (e) => {
    if (e.detail) handleLockUrl(e.detail);
  });

  // Handle page that loads with lock URL in body
  if (document.readyState === 'complete') {
    checkForLockUrls();
  } else {
    document.addEventListener('DOMContentLoaded', checkForLockUrls);
  }
}

/**
 * Check body HTML for coursera-lock:// URLs
 */
function checkForLockUrls() {
  if (!window.location.href.includes('coursera.org')) return;

  const bodyHtml = document.body?.innerHTML || '';
  const match = bodyHtml.match(/coursera-lock:\/\/[^"']+/);
  if (match) {
    const url = match[0].replace('coursera-lock://', 'https://');
    chrome.runtime.sendMessage({ action: 'openOnly', url });
  }
}

/**
 * Ensure floating panel is injected
 */
function ensurePanel() {
  if (!location.href.includes('coursera.org')) return;
  if (document.getElementById('cpt-panel')) return;

  const target = document.body || document.documentElement;
  if (!target) return;

  try {
    createPanel({
      onAutopilot: () => startCourseAutopilot(),
      onBypass: () => resolveWeekMaterial(),
      onQuiz: () => handleAutoQuiz(),
      onAutoAssignment: () => handleAutoAssignment(),
      onDiscussion: () => toggleAutoDiscussions(),
      onReview: () => handleReview(),
      onDisableAI: () => handleDisableAiGrading(),
      onGetShareLink: () => handleGetShareableLink(),
      onGrading: () => handleDisableAiGrading(),
      onCycleSpeed: () => cycleVideoSpeed(),
      onSkipVideo: () => skipVideo(),
      onSettings: () => {
        chrome.runtime.sendMessage({ action: 'openOnly', url: chrome.runtime.getURL('popup/popup.html') });
      },
    });
    console.log('[CourseraPro] Floating panel mounted successfully');
  } catch (e) {
    console.error('[CourseraPro] Panel injection error:', e);
  }
}

let lastMonitoredUrl = location.href;
let lastRecordedReviewUrl = '';

/**
 * Passively monitor for quiz review pages and record feedback in the background
 */
function checkAndRecordReviewFeedback() {
  const isReviewPage = location.href.includes('/review') || Boolean(document.querySelector('.rc-FormPartsQuestion__error, [data-testid="test-feedback-incorrect"]'));
  if (isReviewPage && location.href !== lastRecordedReviewUrl) {
    lastRecordedReviewUrl = location.href;
    console.log('[CourseraPro] Auto-detect review page. Passively recording feedback...');
    // Give DOM a moment to fully render
    setTimeout(() => {
      recordQuizReviewFeedback().catch(e => console.warn('[CourseraPro] Passive record error:', e));
    }, 1500);
  }
}

/**
 * Initialize the extension
 */
function init() {
  if (!location.href.includes('coursera.org')) return;

  // If this tab was opened as a background discussion worker, run worker mode silently and exit
  if ((location.hash || '').includes('cpt_worker=1')) {
    console.log('[CourseraPro] Background discussion worker active on:', location.href);
    runDiscussionWorker();
    return;
  }

  // If this tab was opened as a background bypass worker, run video/reading auto-completion and exit
  if ((location.hash || '').includes('cpt_bypass=1')) {
    console.log('[CourseraPro] Background bypass worker active on:', location.href);
    runBypassWorker();
    return;
  }

  console.log('[CourseraPro v2.0.0] Content script initialized on:', location.href);

  // Inject page-context script for lockdown bypass
  injectPageScript();

  // Setup lockdown bypass listeners
  setupLockdownBypass();

  // Inject panel immediately
  ensurePanel();

  // Check if there is an active auto-discussion, auto-quiz, auto-autopilot, or auto-review process to resume
  checkAndResumeDiscussionAutomation();
  checkAndResumeAutoQuiz();
  checkAndResumeCourseAutopilot();
  checkAndResumeAutoReview();
  checkAndRecordReviewFeedback();

  // Listen for browser navigation / history popstate
  window.addEventListener('popstate', () => {
    setTimeout(() => {
      checkAndResumeDiscussionAutomation();
      checkAndResumeAutoQuiz();
      checkAndResumeCourseAutopilot();
      checkAndResumeAutoReview();
      checkAndRecordReviewFeedback();
    }, 1200);
  });

  // Watch for DOM / SPA changes to ensure panel stays present and route transitions are handled
  setInterval(() => {
    ensurePanel();

    if (location.href !== lastMonitoredUrl) {
      lastMonitoredUrl = location.href;
      console.log('[CourseraPro] SPA route change detected:', lastMonitoredUrl);
      checkAndResumeDiscussionAutomation();
      checkAndResumeAutoQuiz();
      checkAndResumeCourseAutopilot();
      checkAndResumeAutoReview();
    }
    
    checkAndRecordReviewFeedback();
  }, 1500);
}

// Run initialization
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

