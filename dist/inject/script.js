/**
 * Coursera Pro Tool - Page Context Injection Script
 * Runs in the page's JS context (not extension context)
 * Handles:
 * 1. Lockdown browser bypass & URL interception
 * 2. Anti-Blur & Background Video Playback (prevents Coursera from pausing video on tab switch)
 * 3. Video speed synchronization
 */
(function () {
  'use strict';

  // 1. Spoof user agent to bypass Coursera lockdown browser check
  const LOCKDOWN_UA = 'coursera-locking-browser/0.6.3';
  try {
    Object.defineProperty(navigator, 'userAgent', {
      get: () => LOCKDOWN_UA,
      configurable: true,
    });
  } catch (_e) {}

  // 2. Anti-Blur & Background Playback: Always report document as visible and focused
  try {
    Object.defineProperty(document, 'hidden', {
      get: () => false,
      configurable: true,
    });
    Object.defineProperty(document, 'visibilityState', {
      get: () => 'visible',
      configurable: true,
    });
    Object.defineProperty(document, 'webkitVisibilityState', {
      get: () => 'visible',
      configurable: true,
    });
    Object.defineProperty(document, 'hasFocus', {
      value: () => true,
      configurable: true,
    });
  } catch (_e) {}

  // Block blur and visibilitychange from causing video pause
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (type === 'visibilitychange' || type === 'webkitvisibilitychange') {
      const wrappedListener = function (event) {
        // Suppress visibility changes reporting hidden
        if (document.visibilityState === 'visible') {
          return;
        }
        if (typeof listener === 'function') {
          return listener.call(this, event);
        }
      };
      return originalAddEventListener.call(this, type, wrappedListener, options);
    }

    if (type === 'blur' && (this === window || this === document)) {
      // Coursera window blur handler pauses videos - suppress window blur events
      return;
    }

    return originalAddEventListener.call(this, type, listener, options);
  };

  // Video Speed Controller: Keep desired speed applied to all video elements
  let currentPlaybackRate = parseFloat(localStorage.getItem('cpt_playback_rate') || '1.0');

  function applySpeedToVideos(speed) {
    if (isNaN(speed) || speed <= 0) return;
    currentPlaybackRate = speed;
    localStorage.setItem('cpt_playback_rate', String(speed));

    document.querySelectorAll('video').forEach((vid) => {
      try {
        vid.playbackRate = speed;
      } catch (_e) {}
    });
  }

  // Observe newly mounted videos to maintain speed
  const observer = new MutationObserver(() => {
    if (currentPlaybackRate !== 1.0) {
      document.querySelectorAll('video').forEach((vid) => {
        if (vid.playbackRate !== currentPlaybackRate) {
          vid.playbackRate = currentPlaybackRate;
        }
      });
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Listen for speed changes from content script
  window.addEventListener('CourseraProTool_SetSpeed', (e) => {
    const speed = e.detail?.speed;
    if (speed) {
      applySpeedToVideos(Number(speed));
    }
  });

  // Initialize coursera namespace
  window.coursera = window.coursera || {};

  /**
   * Check if a URL should be intercepted (coursera-lock:// protocol)
   */
  const shouldIntercept = (url) =>
    typeof url === 'string' && url.startsWith('coursera-lock://');

  /**
   * Check if a URL should be blocked (submission start/complete)
   */
  const shouldBlock = (url) =>
    typeof url === 'string' &&
    (url.includes('submission-start') || url.includes('submission-complete'));

  /**
   * Dispatch intercept event to content script
   */
  const intercept = (url) => {
    window.dispatchEvent(
      new CustomEvent('CourseraProTool_Intercept', { detail: url })
    );
  };

  // Override window.open to intercept/block specific URLs
  const originalOpen = window.open;
  window.open = function (url, ...args) {
    if (shouldBlock(url)) {
      return null;
    }

    if (shouldIntercept(url)) {
      intercept(url);
      return { closed: false, focus: () => {}, close: () => {} };
    }

    return originalOpen.apply(this, [url, ...args]);
  };
})();
