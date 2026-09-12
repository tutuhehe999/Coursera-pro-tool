/**
 * Coursera Pro Tool - DOM Utilities
 * Helper functions for DOM manipulation and waiting
 */

/**
 * Wait for a DOM element to appear
 * @param {string} selector - CSS selector
 * @param {number} timeout - Max wait time in ms
 * @param {Element} parent - Parent element to search in
 * @returns {Promise<Element>}
 */
export function waitForSelector(selector, timeout = 10000, parent = document) {
  return new Promise((resolve, reject) => {
    const el = parent.querySelector(selector);
    if (el) return resolve(el);

    const observer = new MutationObserver(() => {
      const el = parent.querySelector(selector);
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for: ${selector}`));
    }, timeout);

    observer.observe(parent === document ? (document.body || document.documentElement) : parent, {
      childList: true,
      subtree: true,
    });
  });
}

/**
 * Wait for all matching elements to appear
 * @param {string} selector - CSS selector
 * @param {number} minCount - Minimum number of elements
 * @param {number} timeout - Max wait time in ms
 * @returns {Promise<NodeList>}
 */
export function waitForSelectorAll(selector, minCount = 1, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const els = document.querySelectorAll(selector);
    if (els.length >= minCount) return resolve(els);

    const observer = new MutationObserver(() => {
      const els = document.querySelectorAll(selector);
      if (els.length >= minCount) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(els);
      }
    });

    const timer = setTimeout(() => {
      observer.disconnect();
      const els = document.querySelectorAll(selector);
      els.length > 0 ? resolve(els) : reject(new Error(`Timeout waiting for: ${selector}`));
    }, timeout);

    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  });
}

/**
 * Sleep for a given duration
 * @param {number} ms - Milliseconds
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simulate typing into an input field
 * @param {Element} element - Input element
 * @param {string} text - Text to type
 */
export function simulateInput(element, text) {
  if (!element) return;
  element.focus();

  // Support React controlled components via native property setter
  try {
    const proto =
      element.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(element, text);
    } else {
      element.value = text;
    }
  } catch (_e) {
    element.value = text;
  }

  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
}

/**
 * Simulate typing using document.execCommand (for contenteditable)
 * @param {Element} element - Editable element
 * @param {string} text - Text to insert
 */
export async function simulateTyping(element, text) {
  if (!element) return;
  element.focus();

  // 1. Try paste event (Most reliable for Draft.js / ProseMirror)
  try {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', text);
    // Draft.js intercepts paste events to update its internal EditorState
    const pasteEvent = new ClipboardEvent('paste', {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true
    });
    element.dispatchEvent(pasteEvent);
  } catch (e) {
    console.warn('[CourseraPro] Paste event failed', e);
  }

  // Wait a tick for React to process the paste
  await new Promise(r => setTimeout(r, 100));

  // 2. Check if text was inserted successfully
  if (!element.textContent || !element.textContent.trim() || !element.textContent.includes(text.substring(0, 5))) {
    element.focus();
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('insertText', false, text);
    } catch (_e) {}

    // 3. Fallback: Force React internal event handlers if present
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Find React internal instance
    const reactKey = Object.keys(element).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$'));
    if (reactKey && element[reactKey] && typeof element[reactKey].onInput === 'function') {
      try {
        element[reactKey].onInput({ target: element, currentTarget: element, nativeEvent: new Event('input') });
      } catch (e) {}
    }

    if (!element.textContent || !element.textContent.trim()) {
      element.innerHTML = `<p>${text.replace(/\n\n/g, '</p><p>')}</p>`;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}

/**
 * Click an element safely
 * @param {Element} element
 */
export function safeClick(element) {
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element.click();
  }
}

/**
 * Add a label/badge to an element
 * @param {Element} element
 * @param {string} text
 */
export function addBadge(element, text = '✓') {
  if (!element) return;
  const badge = document.createElement('span');
  badge.textContent = ` ${text}`;
  badge.style.cssText = 'color: #22c55e; font-weight: bold; font-size: 12px; margin-left: 4px;';
  badge.classList.add('cpt-badge');
  // Don't add duplicate badges
  if (!element.querySelector('.cpt-badge')) {
    element.appendChild(badge);
  }
}

/**
 * Extend String prototype with normalize helper
 */
export function extendStringPrototype() {
  if (!String.prototype._cptNormalize) {
    String.prototype._cptNormalize = function () {
      return this.normalize('NFC').trim().replace(/\s+/g, ' ');
    };
  }
}
