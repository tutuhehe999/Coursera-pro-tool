/**
 * Coursera Pro Tool - Service Worker (Background)
 * Handles: tab management, cookie handling, message routing
 */

let activeDiscussionWorkerTabId = null;
let activeBypassWorkerTabId = null;

// On install: open welcome page
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') });
  }
});

// Save cookies on tab update
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && !tab.url) return;

  const url = changeInfo.url || tab.url;
  if (!url || !url.includes('coursera.org')) return;

  // Save CAUTH cookie
  try {
    await saveCookie('profileconsent', 'profileconsent');
    await saveCookie('CAUTH', 'CAUTH');
  } catch (e) {
    console.warn('Cookie save error:', e);
  }
});

/**
 * Save a Coursera cookie to storage
 */
async function saveCookie(cookieName, storageKey) {
  chrome.cookies.get(
    { url: 'https://www.coursera.org', name: cookieName },
    async (cookie) => {
      if (cookie) {
        await chrome.storage.local.set({ [storageKey]: cookie.value });
      }
    }
  );
}

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Open URL and mark as completed
  if (request.action === 'openAndClose' && request.url) {
    chrome.tabs.create({ url: request.url, active: false }, (tab) => {
      // Close after a delay to let it register
      setTimeout(() => {
        if (tab?.id) {
          chrome.tabs.remove(tab.id).catch(() => {});
        }
      }, 3000);
    });
    return false;
  }

  // Close current tab
  if (request.action === 'closeCurrentTab' && sender?.tab?.id) {
    chrome.tabs.remove(sender.tab.id);
    return false;
  }

  // Open URL only (don't close)
  if (request.action === 'openOnly') {
    chrome.tabs.create({ url: request.url, active: false });
    return false;
  }

  // Refresh cookies
  if (request.action === 'refreshCookies') {
    (async () => {
      await saveCookie('profileconsent', 'profileconsent');
      await saveCookie('CAUTH', 'CAUTH');
      sendResponse({ status: 'ok' });
    })();
    return true; // Keep channel open for async response
  }

  // Handle redirect with token extraction
  if (request.action === 'redirect') {
    (async () => {
      try {
        const url = new URL(request.redirectUrl || request.url);
        const token = url.searchParams.get('token');

        if (token) {
          url.searchParams.delete('token');
          await chrome.cookies.set({
            url: 'https://www.coursera.org',
            name: 'CAUTH',
            value: token,
            secure: true,
            sameSite: 'no_restriction',
          });
        }

        chrome.tabs.create({ url: url.toString() });
        sendResponse({ success: true });
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : 'Unknown error';
        chrome.tabs.create({ url: request.redirectUrl || request.url });
        sendResponse({ success: false, error: errorMsg });
      }
    })();
    return true;
  }

  // Cancel active discussion worker tab if requested
  if (request.action === 'cancelDiscussionWorker') {
    if (activeDiscussionWorkerTabId) {
      chrome.tabs.remove(activeDiscussionWorkerTabId).catch(() => {});
      activeDiscussionWorkerTabId = null;
    }
    sendResponse({ status: 'cancelled' });
    return false;
  }

  // Auto discussion background worker
  if (request.action === 'autoDiscussionBackground' && request.url) {
    if (activeDiscussionWorkerTabId) {
      chrome.tabs.remove(activeDiscussionWorkerTabId).catch(() => {});
      activeDiscussionWorkerTabId = null;
    }

    let finished = false;

    chrome.tabs.create({ url: request.url, active: false }, (tab) => {
      activeDiscussionWorkerTabId = tab?.id;
      if (!activeDiscussionWorkerTabId) {
        sendResponse({ success: false, error: 'Cannot create background tab' });
        return;
      }

      // Safeguard timeout (50s max per discussion item)
      const timeoutId = setTimeout(() => {
        if (!finished) {
          finished = true;
          chrome.runtime.onMessage.removeListener(workerListener);
          if (activeDiscussionWorkerTabId) {
            chrome.tabs.remove(activeDiscussionWorkerTabId).catch(() => {});
            activeDiscussionWorkerTabId = null;
          }
          sendResponse({ success: false, timeout: true });
        }
      }, 50000);

      const workerListener = (msg, sender) => {
        if (sender.tab?.id === activeDiscussionWorkerTabId && msg.action === 'discussionWorkerFinished') {
          if (!finished) {
            finished = true;
            clearTimeout(timeoutId);
            chrome.runtime.onMessage.removeListener(workerListener);
            if (activeDiscussionWorkerTabId) {
              chrome.tabs.remove(activeDiscussionWorkerTabId).catch(() => {});
              activeDiscussionWorkerTabId = null;
            }
            sendResponse({
              success: msg.success === true,
              alreadySubmitted: !!msg.alreadySubmitted,
              error: msg.error || null,
            });
          }
        }
      };

      chrome.runtime.onMessage.addListener(workerListener);
    });

    return true; // Keep channel open for async response
  }

  // Cancel active bypass sequence
  if (request.action === 'cancelBypass') {
    if (activeBypassWorkerTabId) {
      chrome.tabs.remove(activeBypassWorkerTabId).catch(() => {});
      activeBypassWorkerTabId = null;
    }
    sendResponse({ status: 'cancelled' });
    return false;
  }

  // Sequential Single Worker Tab for Bypass (No Tab Spam)
  if (request.action === 'bypassItemSingleWorker' && request.url) {
    (async () => {
      try {
        let tabExists = false;
        if (activeBypassWorkerTabId) {
          try {
            const existingTab = await chrome.tabs.get(activeBypassWorkerTabId);
            if (existingTab && !existingTab.discarded) {
              tabExists = true;
            }
          } catch (_e) {
            tabExists = false;
          }
        }

        if (tabExists) {
          // Reuse existing worker tab - zero new tabs on tab strip!
          await chrome.tabs.update(activeBypassWorkerTabId, { url: request.url });
        } else {
          // Create the single worker tab
          const newTab = await chrome.tabs.create({ url: request.url, active: false });
          activeBypassWorkerTabId = newTab.id;
        }

        // Wait 2200ms for Coursera client-side React tracking to record completion
        await new Promise((r) => setTimeout(r, 2200));

        // If this was the last item, clean up and close the single worker tab
        if (request.isLast && activeBypassWorkerTabId) {
          chrome.tabs.remove(activeBypassWorkerTabId).catch(() => {});
          activeBypassWorkerTabId = null;
        }

        sendResponse({ success: true });
      } catch (err) {
        console.warn('[CourseraPro] Single worker bypass error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  return false;
});
