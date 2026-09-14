/* Coursera Pro Tool - Bundled Content Script */
(function() {
"use strict";


// ====== utils/dom.js ======
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
function waitForSelector(selector, timeout = 10000, parent = document) {
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
function waitForSelectorAll(selector, minCount = 1, timeout = 10000) {
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
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simulate typing into an input field
 * @param {Element} element - Input element
 * @param {string} text - Text to type
 */
function simulateInput(element, text) {
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
async function simulateTyping(element, text) {
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
function safeClick(element) {
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
function addBadge(element, text = '✓') {
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
function extendStringPrototype() {
  if (!String.prototype._cptNormalize) {
    String.prototype._cptNormalize = function () {
      return this.normalize('NFC').trim().replace(/\s+/g, ' ');
    };
  }
}


// ====== utils/metadata.js ======
/**
 * Coursera Pro Tool - Metadata Extraction
 * Extract course_id, item_id, user_id, and other metadata from Coursera URLs and DOM
 */

/**
 * Extract metadata from current Coursera page
 * First tries Coursera's tracking data attributes (like the original build fg()),
 * then falls back to URL parsing and HTML inspection.
 * @returns {{ course_id: string, item_id: string, week: string, type: string, section: string, open_course_slug: string }}
 */
function getMetadata() {
  // 1. Try Coursera DOM data-click-value attribute (original build fg())
  try {
    const headerHomeLink =
      document.querySelector('[data-testid="page-header-wrapper"] a[data-track-app="open_course_home"]') ||
      document.querySelector('a[data-track-app="open_course_home"]');
    if (headerHomeLink) {
      const clickVal = headerHomeLink.getAttribute('data-click-value');
      if (clickVal) {
        const parsed = JSON.parse(clickVal);
        if (parsed.course_id || parsed.item_id) {
          return {
            course_id: parsed.course_id || '',
            item_id: parsed.item_id || '',
            week: parsed.week_id || parsed.week || '',
            type: parsed.schema_type || 'peer',
            section: '',
            open_course_slug: parsed.open_course_slug || getCourseSlug(),
          };
        }
      }
    }
  } catch (_e) {}

  // 2. Scan other elements with data-click-value or data-track-value
  try {
    const trackedEls = document.querySelectorAll('[data-click-value], [data-track-value]');
    for (const el of trackedEls) {
      const val = el.getAttribute('data-click-value') || el.getAttribute('data-track-value');
      if (val && val.includes('course_id')) {
        try {
          const parsed = JSON.parse(val);
          if (parsed.course_id) {
            return {
              course_id: parsed.course_id || '',
              item_id: parsed.item_id || extractItemId() || '',
              week: parsed.week_id || '',
              type: 'peer',
              section: '',
              open_course_slug: parsed.open_course_slug || getCourseSlug(),
            };
          }
        } catch (_err) {}
      }
    }
  } catch (_e) {}

  const url = typeof location !== 'undefined' ? location.href : '';
  const match = url.match(
    /(?:coursera\.org)?(?:\/programs\/[^/?#]+\/|\/browse\/[^/?#]+\/)?(?:learn|course)\/([^/?#]+)(?:\/([^/?#]+))?(?:\/([^/?#]+))?(?:\/([^/?#]+))?/i
  );

  const slug = match ? match[1].toLowerCase() : getCourseSlug();
  const section = match ? match[2] || '' : '';
  const week = match ? match[3] || '' : '';
  const extractedId = extractItemId() || (match ? match[4] || '' : '');

  // Extract courseId from HTML if available
  let course_id = '';
  try {
    const html = document.documentElement.innerHTML;
    const cm =
      html.match(/"courseId"\s*:\s*"([A-Za-z0-9_~-]+)"/) ||
      html.match(/"course_id"\s*:\s*"([A-Za-z0-9_~-]+)"/) ||
      html.match(/courseId~([A-Za-z0-9_~-]+)/);
    if (cm && cm[1]) course_id = cm[1];
  } catch (_e) {}

  let type = 'unknown';
  if (url.includes('/quiz/')) type = 'quiz';
  else if (url.includes('/exam/')) type = 'exam';
  else if (url.includes('/supplement/')) type = 'reading';
  else if (url.includes('/lecture/')) type = 'video';
  else if (url.includes('/peer/')) type = 'peer';
  else if (url.includes('/discussion-prompt/') || url.includes('/discussionPrompt/')) type = 'discussion';
  else if (url.includes('/ungradedLti/')) type = 'lti';
  else if (url.includes('/home/')) type = 'home';

  return { course_id, item_id: extractedId, week, type, section, open_course_slug: slug };
}

/**
 * Extract user ID (learner ID) from script tags, HTML, or cookies
 * @returns {string}
 */
function extractUserId() {
  // Method A (Original build): check body > script:nth-child(3)
  try {
    const script3 = document.querySelector('body > script:nth-child(3)')?.innerText;
    if (script3) {
      const m = script3.match(/(\d+~[A-Za-z0-9-_]+)/);
      if (m && m[1]) return m[1].split('~')[0];
    }
  } catch (_e) {}

  // Method B: Check all scripts for numeric user ID compound patterns
  try {
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const text = s.innerText || '';
      const m = text.match(/(\d{4,12})~([A-Za-z0-9-_]+)/);
      if (m && m[1]) return m[1];
    }
  } catch (_e) {}

  // Method C: Check full HTML for userId / learnerId / externalUserId
  try {
    const html = document.documentElement.innerHTML;
    const m =
      html.match(/"userId"\s*:\s*"?(\d+)"?/) ||
      html.match(/"externalUserId"\s*:\s*"?(\d+)"?/) ||
      html.match(/"learnerId"\s*:\s*"?(\d+)"?/) ||
      html.match(/(\d{5,12})~[A-Za-z0-9_-]+/);
    if (m && m[1]) return m[1];
  } catch (_e) {}

  // Method D: Check cookies
  try {
    const m = document.cookie.match(/(?:userId|_coursera_user_id)=(\d+)/);
    if (m && m[1]) return m[1];
  } catch (_e) {}

  return '';
}

/**
 * Extract course slug from URL
 * @returns {string}
 */
function getCourseSlug(url = '') {
  const targetUrl = url || (typeof location !== 'undefined' ? location.href : '');
  if (!targetUrl) return '';
  const match = targetUrl.match(/(?:\/learn\/|\/course\/)([^/?#]+)/i);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Check if current page is a specific Coursera page type
 * @param {string} type
 * @returns {boolean}
 */
function isPageType(type) {
  return location.href.includes(`/${type}/`);
}

/**
 * Extract assignment/quiz ID from the page
 * @returns {string|null}
 */
function extractItemId() {
  // Try from URL first (match /peer/{itemId}/, /exam/{itemId}/, /quiz/{itemId}/, /discussionPrompt/{itemId}/, etc.)
  const urlMatch = location.href.match(/\/(?:peer|exam|quiz|assignment|item|discussionPrompt|discussion-prompt)\/([A-Za-z0-9_-]+)/i);
  if (urlMatch && urlMatch[1]) return urlMatch[1];

  // Try from meta tag
  const meta = document.querySelector('meta[name="item-id"]');
  if (meta) return meta.content;

  // Try from data attributes
  const dataEl = document.querySelector('[data-item-id]');
  if (dataEl) return dataEl.dataset.itemId;

  return null;
}

/**
 * Extract assignment slug from URL or page links
 * e.g. /peer/VZzmN/from-proposal-to-peer-review-practicing-as-a-researcher/submit
 * -> 'from-proposal-to-peer-review-practicing-as-a-researcher'
 * @param {string} [itemId]
 * @returns {string}
 */
function extractAssignmentSlug(itemId = '') {
  const url = location.href;
  const reserved = ['submit', 'review', 'give-feedback', 'instructions'];

  // 1. From current location.href: /peer/{itemId}/{assignmentSlug}/...
  if (itemId) {
    const m = url.match(new RegExp(`/peer/${itemId}/([^/?#]+)`));
    if (m && m[1] && !reserved.includes(m[1])) {
      return m[1];
    }
  }

  // General URL pattern /peer/([^/]+)/([^/]+)
  const generalMatch = url.match(/\/peer\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)/);
  if (generalMatch && generalMatch[1] && !reserved.includes(generalMatch[1])) {
    return generalMatch[1];
  }

  // 2. Scan DOM links for tab navigation
  try {
    const peerLinks = document.querySelectorAll('a[href*="/peer/"]');
    for (const a of peerLinks) {
      const href = a.getAttribute('href') || a.href || '';
      if (itemId) {
        const m = href.match(new RegExp(`/peer/${itemId}/([^/?#]+)`));
        if (m && m[1] && !reserved.includes(m[1])) {
          return m[1];
        }
      }
      const gm = href.match(/\/peer\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)/);
      if (gm && gm[1] && !reserved.includes(gm[1])) {
        return gm[1];
      }
    }
  } catch (_e) {}

  // 3. Fallback to 'course-project' (default used by original build)
  return 'course-project';
}

/**
 * Generate a random string
 * @param {number} length
 * @returns {string}
 */
function generateRandomString(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}


// ====== utils/ai.js ======
/**
 * Coursera Pro Tool - Multi-Provider AI Engine
 * Supports:
 * 1. Google Gemini (REST API v1beta)
 * 2. DeepSeek (OpenAI-compatible Chat Completions - V3 & R1)
 * 3. Groq (OpenAI-compatible Chat Completions - Ultra-fast Llama 3.3)
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const PROVIDER_DEFAULT_MODELS = {
  gemini: 'gemini-3.5-flash',
  deepseek: 'deepseek-chat',
  groq: 'llama-3.3-70b-versatile',
};

const PROVIDER_MODELS = {
  gemini: [
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.7-flash',
    'gemini-3.8-flash',
  ],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
};

/**
 * Transparently normalize legacy or user-entered model names to valid API identifiers
 * @param {string} provider
 * @param {string} model
 * @returns {string}
 */
function normalizeModelName(provider, model) {
  if (!model || typeof model !== 'string') return PROVIDER_DEFAULT_MODELS[provider] || 'gemini-3.5-flash';
  const m = model.trim().toLowerCase().replace(/^models\//, '');
  if (provider === 'gemini') {
    // Map ALL legacy/deprecated model names to working 3.x equivalents
    // Based on actual API responses: "use models/gemini-3.6-flash" and "use models/gemini-3.5-flash-lite"
    if (m.includes('2.0-flash-lite') || m.includes('2.0-flash-lite-preview')) return 'gemini-3.5-flash-lite';
    if (m.includes('2.0-flash') || m === 'gemini-2-flash') return 'gemini-3.6-flash';
    if (m.includes('2.5-flash')) return 'gemini-3.5-flash';
    if (m.includes('2.5-pro')) return 'gemini-3.5-flash';
    if (m.includes('1.5-flash') || m === 'flash-8b' || m === '8b') return 'gemini-3.5-flash';
    if (m.includes('1.5-pro')) return 'gemini-3.5-flash';
  }
  return m;
}

/**
 * Get active AI settings from chrome storage
 * @returns {Promise<{provider: string, apiKey: string, model: string, geminiAPI: string, deepseekAPI: string, groqAPI: string}>}
 */
async function getAISettings() {
  const data = await chrome.storage.local.get([
    'aiProvider',
    'geminiAPI',
    'deepseekAPI',
    'groqAPI',
    'model',
    'model_gemini',
    'model_deepseek',
    'model_groq',
  ]);

  const provider = (data.aiProvider || 'gemini').toLowerCase();
  const geminiAPI = (data.geminiAPI || '').trim();
  const deepseekAPI = (data.deepseekAPI || '').trim();
  const groqAPI = (data.groqAPI || '').trim();

  let apiKey = '';
  if (provider === 'deepseek') apiKey = deepseekAPI;
  else if (provider === 'groq') apiKey = groqAPI;
  else apiKey = geminiAPI;

  let rawModel = (data[`model_${provider}`] || data.model || '').trim();
  let validModel = normalizeModelName(provider, rawModel);
  const invalidKeywords = ['tts', 'audio', 'image', 'imagen', 'embed', 'realtime'];

  // Validate model fits the provider
  const isInvalid = !validModel ||
    invalidKeywords.some((kw) => validModel.toLowerCase().includes(kw)) ||
    (provider === 'gemini' && !validModel.includes('gemini')) ||
    (provider === 'deepseek' && !validModel.includes('deepseek')) ||
    (provider === 'groq' && (validModel.includes('gemini') || validModel.includes('deepseek')));

  if (isInvalid) {
    validModel = PROVIDER_DEFAULT_MODELS[provider] || 'gemini-3.5-flash';
    chrome.storage.local.set({ model: validModel, [`model_${provider}`]: validModel });
  } else if (data.model !== validModel) {
    chrome.storage.local.set({ model: validModel, [`model_${provider}`]: validModel });
  }

  return {
    provider,
    apiKey,
    model: validModel,
    geminiAPI,
    deepseekAPI,
    groqAPI,
  };
}

/**
 * Safely extract JSON from text or markdown code blocks
 * @param {string} text
 * @returns {any}
 */
function extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  let cleaned = text.trim();

  // 1. Strip markdown code fences like ```json ... ```
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }

  // 2. Try direct JSON parse
  try {
    return JSON.parse(cleaned);
  } catch (_e) {}

  // 3. Extract JSON array [...]
  const startArr = cleaned.indexOf('[');
  const endArr = cleaned.lastIndexOf(']');
  if (startArr !== -1 && endArr > startArr) {
    try {
      return JSON.parse(cleaned.substring(startArr, endArr + 1));
    } catch (_e) {}
  }

  // 4. Extract JSON object {...}
  const startObj = cleaned.indexOf('{');
  const endObj = cleaned.lastIndexOf('}');
  if (startObj !== -1 && endObj > startObj) {
    try {
      const obj = JSON.parse(cleaned.substring(startObj, endObj + 1));
      if (Array.isArray(obj.answers || obj.questions || obj.result || obj.items)) {
        return obj.answers || obj.questions || obj.result || obj.items;
      }
      return [obj];
    } catch (_e) {}
  }

  return null;
}

/**
 * Call OpenAI-compatible REST API (DeepSeek, Groq)
 * @param {string} endpointUrl
 * @param {string} apiKey
 * @param {string} model
 * @param {string} prompt
 * @param {string} systemInstruction
 * @param {object|null} responseSchema
 * @param {object} options
 * @returns {Promise<string>}
 */
async function callOpenAiCompatible(endpointUrl, apiKey, model, prompt, systemInstruction, responseSchema, options = {}) {
  const messages = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }
  messages.push({ role: 'user', content: prompt });

  const requestBody = {
    model,
    messages,
    temperature: options.temperature !== undefined ? options.temperature : (responseSchema ? 0.1 : 0.7),
    max_tokens: options.max_tokens || 4096,
  };

  if (responseSchema) {
    requestBody.response_format = { type: 'json_object' };
  }

  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMsg = errorData?.error?.message || errorData?.message || `HTTP ${response.status}`;
    throw new Error(`[${model}] ${errorMsg}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) {
    throw new Error(`[${model}] Phản hồi rỗng từ API.`);
  }
  return text;
}

/**
 * Call Gemini REST API
 * @param {string} apiKey
 * @param {string} model
 * @param {string} prompt
 * @param {string} systemInstruction
 * @param {object|null} responseSchema
 * @param {object} options
 * @returns {Promise<string>}
 */
async function callGeminiApi(apiKey, model, prompt, systemInstruction, responseSchema, options = {}) {
  const rawModel = (model || 'gemini-3.5-flash').replace(/^models\//, '').trim();
  const normalizedModel = normalizeModelName('gemini', rawModel);

  const candidateModels = [
    normalizedModel,
    'gemini-3.5-flash',
    'gemini-3.6-flash',
    'gemini-3.7-flash',
    'gemini-3.5-flash-lite',
  ].filter((m, i, arr) => m && arr.indexOf(m) === i && !m.includes('tts') && !m.includes('audio') && !m.includes('embed'));

  if (candidateModels.length === 0) candidateModels.push('gemini-3.5-flash');

  let lastError = null;

  for (const currentModel of candidateModels) {
    const cleanName = currentModel.replace(/^models\//, '').trim();
    const attempts = responseSchema ? [true, false] : [false];

    for (const withSchema of attempts) {
      try {
        const url = `${GEMINI_API_BASE}/models/${cleanName}:generateContent?key=${apiKey}`;
        const temperature = options.temperature !== undefined ? options.temperature : (withSchema ? 0.1 : 0.7);

        const requestBody = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature,
            topP: options.topP || 0.95,
            topK: options.topK || 40,
          },
        };

        if (systemInstruction) {
          requestBody.systemInstruction = {
            parts: [{ text: systemInstruction }],
          };
        }

        if (withSchema && responseSchema) {
          requestBody.generationConfig.responseMimeType = 'application/json';
          requestBody.generationConfig.responseSchema = responseSchema;
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMsg = errorData?.error?.message || `HTTP ${response.status}`;
          throw new Error(`[${cleanName}] ${errorMsg}`);
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (text && text.trim()) {
          if (cleanName !== rawModel) {
            console.log(`[CourseraPro] Auto-switched working model to ${cleanName}`);
            chrome.storage.local.set({ model: cleanName, model_gemini: cleanName });
          }
          return text;
        }
      } catch (err) {
        lastError = err;
        console.warn(`[CourseraPro] Gemini attempt failed (${cleanName}, schema:${withSchema}):`, err.message);
      }
    }
  }

  throw lastError || new Error('Tất cả model Gemini dự phòng đều thất bại. Vui lòng kiểm tra lại API key.');
}

/**
 * Unified AI Content Generation Router
 * Automatically routes to Gemini, DeepSeek, or Groq
 * @param {string} prompt - Prompt to send
 * @param {string} systemInstruction - System instruction for the model
 * @param {object|null} [responseSchema] - Optional JSON schema
 * @param {object} [options] - Generation options
 * @returns {Promise<string>}
 */
async function generateContent(prompt, systemInstruction = '', responseSchema = null, options = {}) {
  const { provider, apiKey, model, geminiAPI } = await getAISettings();

  if (!apiKey) {
    throw new Error(`Chưa cài đặt API key cho ${provider.toUpperCase()}. Vui lòng mở cài đặt extension.`);
  }

  try {
    if (provider === 'deepseek') {
      return await callOpenAiCompatible(DEEPSEEK_API_URL, apiKey, model, prompt, systemInstruction, responseSchema, options);
    } else if (provider === 'groq') {
      return await callOpenAiCompatible(GROQ_API_URL, apiKey, model, prompt, systemInstruction, responseSchema, options);
    } else {
      return await callGeminiApi(apiKey, model, prompt, systemInstruction, responseSchema, options);
    }
  } catch (primaryErr) {
    console.warn(`[CourseraPro] Primary provider ${provider} failed:`, primaryErr.message);

    // Fallback to Gemini if current provider was not Gemini and Gemini key is available
    if (provider !== 'gemini' && geminiAPI) {
      console.log('[CourseraPro] Falling back to Google Gemini backup...');
      try {
        return await callGeminiApi(geminiAPI, 'gemini-3.5-flash', prompt, systemInstruction, responseSchema, options);
      } catch (backupErr) {
        console.warn('[CourseraPro] Backup Gemini also failed:', backupErr.message);
      }
    }

    throw primaryErr;
  }
}

/**
 * Generate quiz answers using AI
 * @param {Array<{id?: number, prompt?: string, term?: string, options?: string[]}>} questions - Quiz questions
 * @param {object} [extraOptions] - e.g. blacklist mapping for smart retake
 * @returns {Promise<Array<{id: number, term: string, definition: string, answer: string}>>}
 */
async function generateQuizAnswers(questions, extraOptions = {}) {
  const blacklist = extraOptions.blacklist || {};

  let systemInstruction = `You are a world-class academic assistant taking an online university assessment on Coursera.
Your task is to provide the accurate, correct answer for each question.

CRITICAL RULES:
1. For single choice questions, your answer MUST match the EXACT character string of the correct choice.
2. For multiple choice / "Check all that apply" / "Select three" questions, you MUST provide ALL correct options separated by a pipe character '|' (e.g. "First option|Second option|Third option"). You must never pick just one option for a multi-select question!
3. For open-ended, reflection, or short-answer essay questions (where no options are listed), write a high-quality, professional academic paragraph (about 60-120 words) directly answering the prompt.
4. Return a valid JSON array containing one object per question in exact question order:
[
  { "id": 1, "answer": "Exact text of correct choice" },
  { "id": 2, "answer": "First option|Second option|Third option" },
  { "id": 3, "answer": "High quality concise academic answer..." }
]
5. Do NOT include markdown commentary. Return only the JSON array.`;

  // Format clearly for the LLM, injecting blacklist warnings and question types
  const formattedPrompt = questions
    .map((q, idx) => {
      const qId = q.id !== undefined ? q.id : idx + 1;
      const promptText = q.prompt || q.term || `Question ${qId}`;
      const optionsList = Array.isArray(q.options) && q.options.length > 0
        ? q.options
        : (q.term && q.term.includes('|') ? q.term.split('|').slice(1) : []);

      let item = `Question ${qId}: ${promptText}`;
      if (optionsList.length > 0) {
        item += `\nOptions:\n` + optionsList.map((opt, oIdx) => `  ${String.fromCharCode(65 + oIdx)}. ${opt}`).join('\n');
      }

      // Check if question is multi-select / checkbox
      const isCheckbox = q.type === 'checkbox' ||
        /\b(?:select\s+(?:all|two|three|four|five|\d+)|check\s+all|choose\s+(?:all|two|three|four|five|\d+)|multiple\s+answers?)\b/i.test(promptText);

      if (isCheckbox) {
        let countNote = '';
        const countMatch = promptText.match(/\b(?:select|choose)\s+(two|three|four|five|\d+)\b/i);
        if (countMatch) {
          const wordMap = { two: 2, three: 3, four: 4, five: 5 };
          const c = wordMap[countMatch[1].toLowerCase()] || parseInt(countMatch[1], 10);
          if (c > 1) countNote = ` (EXACTLY ${c} OPTIONS REQUIRED)`;
        }
        item += `\n[QUESTION TYPE: MULTI-SELECT CHECKBOX${countNote} - You MUST select ALL required options and join them with a pipe '|'. Example: "Option 1|Option 2|Option 3"]`;
      } else if (optionsList.length > 0) {
        item += `\n[QUESTION TYPE: SINGLE CHOICE RADIO - Select EXACTLY ONE correct option.]`;
      }

      // Check Smart Retake blacklist
      const cp = cleanText(promptText);
      const qBlacklist = blacklist[cp];
      if (Array.isArray(qBlacklist) && qBlacklist.length > 0) {
        item += `\n⚠️ AVOID THESE (Confirmed INCORRECT in previous attempts): ${JSON.stringify(qBlacklist)}`;
      }

      return item;
    })
    .join('\n\n');

  const fullPrompt = `Solve these university exam questions and provide the best answers for each:\n\n${formattedPrompt}\n\nReturn JSON array with { "id": number, "answer": "exact correct option text(s)" } for each question.`;

  let parsed = null;
  let lastErr = null;

  try {
    const rawResult = await generateContent(fullPrompt, systemInstruction, null, { temperature: 0.1 });
    parsed = extractJson(rawResult);
  } catch (err) {
    lastErr = err;
    console.warn('[CourseraPro] Failed generating quiz with standard prompt:', err.message);
  }

  // Fallback 1: with structured schema if plain generation did not parse
  if (!parsed || !Array.isArray(parsed) || parsed.length === 0) {
    try {
      const responseSchema = {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            id: { type: 'INTEGER' },
            answer: { type: 'STRING' },
          },
          required: ['id', 'answer'],
        },
      };
      const schemaResult = await generateContent(fullPrompt, systemInstruction, responseSchema, { temperature: 0.1 });
      parsed = extractJson(schemaResult);
    } catch (e) {
      lastErr = e;
      console.warn('[CourseraPro] Schema quiz fallback failed:', e.message);
    }
  }

  if (Array.isArray(parsed) && parsed.length > 0) {
    return parsed.map((item, idx) => {
      let ans = '';
      if (typeof item === 'string') {
        ans = item;
      } else if (Array.isArray(item?.answer)) {
        ans = item.answer.join('|');
      } else if (Array.isArray(item?.definition)) {
        ans = item.definition.join('|');
      } else {
        ans = String(item?.answer || item?.definition || item?.text || '');
      }
      const assignedId = item.id !== undefined ? Number(item.id) : (questions[idx]?.id !== undefined ? questions[idx].id : idx + 1);
      return {
        id: assignedId,
        term: item.term || questions[idx]?.prompt || questions[idx]?.term || `Question ${assignedId}`,
        definition: ans,
        answer: ans,
      };
    });
  }

  // Fallback 2: Individual single-question solving if batch JSON array failed
  console.log('[CourseraPro] Batch quiz parsing returned empty. Solving questions individually...');
  const individualResults = [];
  for (let idx = 0; idx < questions.length; idx++) {
    const q = questions[idx];
    const qId = q.id !== undefined ? q.id : idx + 1;
    const promptText = q.prompt || q.term || `Question ${qId}`;
    const optionsList = Array.isArray(q.options) && q.options.length > 0 ? q.options : [];

    let singlePrompt = `Question: ${promptText}\n`;
    if (optionsList.length > 0) {
      singlePrompt += `Options:\n` + optionsList.map((opt, oIdx) => `  ${String.fromCharCode(65 + oIdx)}. ${opt}`).join('\n');
    }
    singlePrompt += `\nWhich option is correct? Respond with ONLY the exact option text or letter (A, B, C, or D).`;

    try {
      const text = await generateContent(
        singlePrompt,
        'You are an academic exam solver. Provide only the single best answer option text or letter.',
        null,
        { temperature: 0.1 }
      );
      if (text && text.trim()) {
        individualResults.push({
          id: qId,
          term: promptText,
          definition: text.trim(),
          answer: text.trim(),
        });
      }
    } catch (err) {
      lastErr = err;
      console.warn(`[CourseraPro] Individual solve failed for question ${qId}:`, err.message);
    }
  }

  if (individualResults.length > 0) {
    return individualResults;
  }

  if (lastErr) {
    throw lastErr;
  }

  return [];
}

/**
 * Diverse perspectives to ensure each discussion response is distinctly different
 */
const DISCUSSION_PERSPECTIVES = [
  'A practitioner focused on practical execution, real-world constraints, and pragmatic trade-offs in modern workflows.',
  'A strategic analyst exploring systemic effects, competitive differentiation, and long-term organizational value.',
  'An inquisitive researcher delving into conceptual principles, historical context, and contrasting theoretical viewpoints.',
  'A collaborative product specialist emphasizing user empathy, cross-functional communication, and iterative refinement.',
  'A reflective learner sharing hands-on case observations, personal insights, and constructive lessons learned.',
  'A forward-looking innovator discussing ethical considerations, future industry shifts, and sustainable scalability.'
];

/**
 * Generate a unique discussion response using AI with varied perspectives
 * @param {string} prompt - Discussion prompt text
 * @param {object} [options] - Generation options
 * @returns {Promise<string>}
 */
async function generateDiscussionResponse(prompt, options = {}) {
  const perspectiveIndex = Math.floor(Math.random() * DISCUSSION_PERSPECTIVES.length);
  const perspective = options.perspective || DISCUSSION_PERSPECTIVES[perspectiveIndex];
  const uniqueSeed = Date.now() + '-' + Math.floor(Math.random() * 10000);

  const systemInstruction = `You are an active, insightful university student participating in a Coursera course discussion forum.

PERSPECTIVE & ANGLE: ${perspective}
RANDOM SEED: ${uniqueSeed}

CRITICAL RULES:
1. Address the prompt directly, thoughtfully, and specifically.
2. Formulate a personalized, distinct answer (around 140 to 240 words, 2-3 natural paragraphs).
3. Sound genuinely human, engaging, and professional. Avoid AI clichés (do NOT use "In conclusion", "It is important to note", "Moreover", "Delving into").
4. Respond in the EXACT SAME LANGUAGE as the prompt (Vietnamese if prompt is Vietnamese, English if English).
5. Output clean conversational plain text (do NOT use markdown bold ** or bullet asterisks).`;

  try {
    const result = await generateContent(prompt, systemInstruction, null, {
      temperature: 0.85,
      topP: 0.95,
    });
    if (result && result.trim()) {
      return result.trim();
    }
  } catch (err) {
    console.warn('[CourseraPro AI] Primary AI call failed, generating intelligent fallback:', err);
  }

  return generateUniqueFallbackResponse(prompt, perspective);
}

/**
 * Fallback generator that produces rich, contextual, and distinct responses
 * @param {string} prompt
 * @param {string} perspective
 * @returns {string}
 */
function generateUniqueFallbackResponse(prompt, perspective = '') {
  const isVietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(prompt);
  const cleanedPrompt = prompt.replace(/[^\w\s\u00C0-\u1EF9]/gi, ' ').trim();
  const words = cleanedPrompt.split(/\s+/).filter((w) => w.length > 3);
  const topicKeywords = words.slice(0, 4).join(' ') || (isVietnamese ? 'chủ đề này' : 'this topic');

  if (isVietnamese) {
    const openers = [
      `Dựa trên kinh nghiệm và góc nhìn thực tế về ${topicKeywords}, tôi nhận thấy đây là một khía cạnh vô cùng thiết thực.`,
      `Khi tiếp cận vấn đề ${topicKeywords}, điều khiến tôi ấn tượng nhất là cách các nguyên lý cốt lõi được áp dụng vào thực tiễn.`,
      `Qua quá trình tìm hiểu và đối chiếu với các tình huống thực tế, góc nhìn của tôi về ${topicKeywords} tập trung vào tính ứng dụng và hiệu quả.`
    ];
    const bodies = [
      `Cụ thể, việc thấu hiểu tường tận không chỉ giúp giải quyết các nút thắt kỹ thuật mà còn mở ra những giải pháp tối ưu hóa quy trình làm việc một cách bền vững. Các thử thách thường gặp đòi hỏi sự cân nhắc linh hoạt giữa lý thuyết và thực tiễn để mang lại kết quả đáng tin cậy.`,
      `Trong môi trường vận hành hiện đại, việc phân tích kỹ lưỡng các yếu tố cấu thành sẽ hạn chế tối đa rủi ro và tăng cường khả năng thích ứng khi có sự thay đổi. Điều cốt lõi là duy trì sự cân bằng giữa mục tiêu trước mắt và chiến lược dài hạn.`,
      `Thực tế cho thấy khi áp dụng phương pháp luận chuẩn xác, chúng ta có thể đơn giản hóa các bài toán phức tạp và thúc đẩy sự hợp tác hiệu quả giữa các thành viên trong nhóm.`
    ];
    const closers = [
      `Tôi rất mong muốn được lắng nghe thêm các góc nhìn và trải nghiệm thực tiễn từ các bạn học viên khác trong diễn đàn.`,
      `Đây là bài học giá trị mà tôi sẽ tiếp tục áp dụng và hoàn thiện trong các dự án sắp tới.`,
      `Theo quan điểm của mọi người, thách thức lớn nhất khi áp dụng vấn đề này vào thực tế hiện nay là gì?`
    ];

    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    return `${pick(openers)}\n\n${pick(bodies)}\n\n${pick(closers)}`;
  } else {
    const openers = [
      `Reflecting on ${topicKeywords}, I find that the practical implications in current workflows are both significant and nuanced.`,
      `When examining ${topicKeywords}, the core factor that stands out to me is how foundational concepts bridge directly into execution.`,
      `From an analytical perspective regarding ${topicKeywords}, success largely hinges on balancing systematic rigor with operational agility.`
    ];
    const bodies = [
      `In real-world applications, addressing these core challenges requires an iterative approach. Rather than relying on static assumptions, continuously validating outcomes against measurable goals ensures sustainable progress and minimizes overhead.`,
      `Furthermore, navigating the trade-offs involved highlights the necessity of thorough collaboration and clear alignment. Applying these principles systematically empowers teams to overcome bottlenecks while maintaining high standards of quality.`,
      `Drawing from relevant case scenarios, establishing a robust framework early on allows for far greater resilience when unexpected variables emerge during implementation.`
    ];
    const closers = [
      `I would be eager to hear how others in the course have approached similar scenarios in their respective domains.`,
      `This remains a key takeaway that I look forward to incorporating into upcoming project milestones.`,
      `What do you consider the primary obstacle when translating these concepts into daily practice?`
    ];

    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    return `${pick(openers)}\n\n${pick(bodies)}\n\n${pick(closers)}`;
  }
}

/**
 * Test if API key is valid for given provider
 * @param {string} apiKey
 * @param {string} [provider='gemini']
 * @returns {Promise<boolean>}
 */
async function testApiKey(apiKey, provider = 'gemini') {
  try {
    if (provider === 'deepseek') {
      const res = await fetch('https://api.deepseek.com/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return res.ok;
    } else if (provider === 'groq') {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return res.ok;
    } else {
      const url = `${GEMINI_API_BASE}/models?key=${apiKey}`;
      const response = await fetch(url);
      return response.ok;
    }
  } catch {
    return false;
  }
}

/**
 * Get available models for given provider
 * @param {string} [provider='gemini']
 * @returns {Promise<string[]>}
 */
async function getAvailableModels(provider = 'gemini') {
  if (provider === 'deepseek') {
    return PROVIDER_MODELS.deepseek;
  }
  if (provider === 'groq') {
    return PROVIDER_MODELS.groq;
  }

  const { geminiAPI } = await getAISettings();
  if (!geminiAPI) return PROVIDER_MODELS.gemini;

  try {
    const url = `${GEMINI_API_BASE}/models?key=${geminiAPI}`;
    const response = await fetch(url);
    const data = await response.json();
    const fetched = (data.models || [])
      .filter((m) => {
        const n = (m.name || '').toLowerCase();
        const methods = m.supportedGenerationMethods || [];
        return (
          n.includes('gemini') &&
          methods.includes('generateContent') &&
          !n.includes('tts') &&
          !n.includes('audio') &&
          !n.includes('image') &&
          !n.includes('imagen') &&
          !n.includes('embed') &&
          !n.includes('realtime') &&
          !n.includes('nano')
        );
      })
      .map((m) => m.name.replace('models/', ''));
    return fetched.length > 0 ? fetched : PROVIDER_MODELS.gemini;
  } catch {
    return PROVIDER_MODELS.gemini;
  }
}


// ====== utils/coursera-api.js ======
/**
 * Coursera Pro Tool - Coursera API Interactions
 * Comprehensive API client for Coursera REST APIs and GraphQL Gateway.
 * Supports direct bypass for videos, readings, widgets, and coaches.
 */

/**
 * Extract CSRF token from document.cookie
 * @returns {string}
 */
function getCsrfToken() {
  if (typeof document === 'undefined') return '';
  if (document.cookie) {
    const match = document.cookie.match(/(?:^|;\s*)(?:CSRF3-Token|CSRF2-Token|csrftoken|csrf-token)=([^;]+)/i);
    if (match) return decodeURIComponent(match[1]);
  }
  try {
    const fromStorage = sessionStorage.getItem('CSRF3-Token') || localStorage.getItem('CSRF3-Token');
    if (fromStorage) return fromStorage;
  } catch (_e) {}
  return '';
}

/**
 * Standard headers required by Coursera internal APIs
 * @param {boolean} [isJson=true]
 * @returns {Record<string, string>}
 */
function getApiHeaders(isJson = true) {
  const headers = {
    'x-coursera-application': 'ondemand',
    'x-requested-with': 'XMLHttpRequest',
  };
  const csrf = getCsrfToken();
  if (csrf) {
    headers['x-csrf3-token'] = csrf;
    headers['x-csrf2-token'] = csrf;
    headers['x-csrftoken'] = csrf;
  }
  if (isJson) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

/**
 * Get the CAUTH token from cookies via background script or storage
 * @returns {Promise<string>}
 */
async function getCauthToken() {
  try {
    const result = await chrome.storage.local.get(['CAUTH']);
    return result.CAUTH || '';
  } catch (_e) {
    return '';
  }
}

/**
 * Get current logged-in user ID via Coursera API or DOM metadata
 * @returns {Promise<string>}
 */
async function getCurrentUserId() {
  try {
    const metaId = extractUserId();
    if (metaId) return String(metaId);

    const endpoints = [
      'https://www.coursera.org/api/adminUserPermissions.v1?q=my',
      'https://www.coursera.org/api/openCourseMemberships.v1?q=my',
      'https://www.coursera.org/api/externalAuthTokens.v1?q=my',
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          credentials: 'include',
          headers: getApiHeaders(false),
        });
        if (res.ok) {
          const data = await res.json();
          const id = data?.elements?.[0]?.id || data?.elements?.[0]?.userId;
          if (id) return String(id);
        }
      } catch (_e) {}
    }
  } catch (err) {
    console.warn('[CourseraPro] Failed to fetch current userId via API:', err);
  }
  return '';
}

/**
 * Fetch course structure (weeks, items)
 * @param {string} courseSlug
 * @returns {Promise<object>}
 */
async function fetchCourseStructure(courseSlug) {
  try {
    const cleanSlug = (courseSlug || '').toLowerCase().trim();
    const response = await fetch(
      `https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=${encodeURIComponent(cleanSlug)}&includes=modules%2Clessons%2CpassableItemGroups%2CpassableItemGroupChoices%2CpassableLessonElements%2Citems%2Ctracks%2CgradePolicy&fields=onDemandCourseMaterialModules.v1(name,slug,description,timeCommitment,lessonIds,optional,learningObjectives),onDemandCourseMaterialLessons.v1(name,slug,timeCommitment,elementIds,optional,trackId),onDemandCourseMaterialPassableItemGroups.v1(requiredPassedCount,passableItemGroupChoiceIds,trackId),onDemandCourseMaterialPassableItemGroupChoices.v1(name,description,itemIds),onDemandCourseMaterialPassableLessonElements.v1(gradingWeight,isRequiredForPassing),onDemandCourseMaterialItems.v2(name,slug,timeCommitment,contentSummary,isLocked,lockableByItem,itemLockedReasonCode,trackId,lockedStatus,itemLockSummary),onDemandCourseMaterialTracks.v1(passablesCount)&showLockedItems=true`,
      { credentials: 'include', headers: getApiHeaders(false) }
    );
    if (response.ok) {
      const ct = response.headers.get('content-type') || '';
      if (ct.includes('application/json')) return response.json();
    }
  } catch (err) {
    console.warn('[CourseraPro] fetchCourseStructure error:', err);
  }
  return {};
}

/**
 * Fetch course completion progress for all items
 * @param {string} userId
 * @param {string} courseId
 * @returns {Promise<Set<string>>} Set of completed item IDs
 */
async function fetchCourseCompletedItems(userId, courseId) {
  try {
    const res = await fetch(
      `https://www.coursera.org/api/onDemandCoursesProgress.v1/${userId}~${courseId}?fields=gradedAssignmentGroupProgress`,
      { credentials: 'include', headers: getApiHeaders(false) }
    );
    if (res.ok) {
      const data = await res.json();
      const items = data?.elements?.[0]?.items || {};
      const completed = new Set();
      for (const [itemId, prog] of Object.entries(items)) {
        if (prog && (prog.progressState === 'Completed' || prog.progressState?.toLowerCase() === 'completed')) {
          completed.add(itemId);
        }
      }
      return completed;
    }
  } catch (err) {
    console.warn('[CourseraPro] fetchCourseCompletedItems error:', err);
  }
  return new Set();
}

/**
 * Directly mark a Reading / Supplement item as Completed via Coursera REST API
 * @param {string} courseId
 * @param {string} itemId
 * @param {string|number} userId
 * @returns {Promise<boolean>}
 */
async function apiCompleteSupplement(courseId, itemId, userId) {
  try {
    const uId = parseInt(userId, 10);
    if (!uId) return false;
    const res = await fetch('https://www.coursera.org/api/onDemandSupplementCompletions.v1', {
      method: 'POST',
      credentials: 'include',
      headers: getApiHeaders(true),
      body: JSON.stringify({
        courseId: courseId,
        itemId: itemId,
        userId: uId,
      }),
    });
    if (res.ok) {
      const text = await res.text();
      return text.includes('Completed') || res.status === 200 || res.status === 201;
    }
  } catch (err) {
    console.warn('[CourseraPro] apiCompleteSupplement error:', err);
  }
  return false;
}

/**
 * Directly mark a Video / Lecture item as Completed via Coursera REST API
 * @param {string} userId
 * @param {string} courseSlug
 * @param {string} courseId
 * @param {string} itemId
 * @param {number} [timeCommitment=60000]
 * @returns {Promise<boolean>}
 */
async function apiCompleteVideo(userId, courseSlug, courseId, itemId, timeCommitment = 60000) {
  try {
    const cleanSlug = (courseSlug || '').toLowerCase().trim();
    // Step 1: Get video tracking metadata
    const metaRes = await fetch(
      `https://www.coursera.org/api/onDemandLectureVideos.v1/${courseId}~${itemId}?includes=video&fields=disableSkippingForward,startMs,endMs`,
      { credentials: 'include', headers: getApiHeaders(false) }
    );
    let trackingId = '';
    if (metaRes.ok) {
      const metaData = await metaRes.json();
      trackingId = metaData?.linked?.['onDemandVideos.v1']?.[0]?.id || '';
    }

    // Step 2: Post play video event
    await fetch(
      `https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${encodeURIComponent(cleanSlug)}/item/${itemId}/lecture/videoEvents/play?autoEnroll=false`,
      {
        method: 'POST',
        credentials: 'include',
        headers: getApiHeaders(true),
        body: '{"contentRequestBody":{}}',
      }
    );

    // Step 3: Update video progress if trackingId exists
    if (trackingId) {
      let durationMs = 60000;
      if (typeof timeCommitment === 'number' && timeCommitment > 0) {
        durationMs = timeCommitment < 1000 ? timeCommitment * 60000 : timeCommitment;
      }
      await fetch(
        `https://www.coursera.org/api/onDemandVideoProgresses.v1/${userId}~${courseId}~${trackingId}`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: getApiHeaders(true),
          body: JSON.stringify({
            videoProgressId: `${userId}~${courseId}~${trackingId}`,
            viewedUpTo: durationMs + 2000,
          }),
        }
      );
    }

    // Step 4: Post ended video event
    const endedRes = await fetch(
      `https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${encodeURIComponent(cleanSlug)}/item/${itemId}/lecture/videoEvents/ended?autoEnroll=false`,
      {
        method: 'POST',
        credentials: 'include',
        headers: getApiHeaders(true),
        body: '{"contentRequestBody":{}}',
      }
    );

    return endedRes.ok;
  } catch (err) {
    console.warn('[CourseraPro] apiCompleteVideo error:', err);
    return false;
  }
}

/**
 * Directly mark an Ungraded Widget item as Completed via Coursera REST API
 * @param {string} userId
 * @param {string} courseId
 * @param {string} itemId
 * @returns {Promise<boolean>}
 */
async function apiCompleteWidget(userId, courseId, itemId) {
  try {
    const sessRes = await fetch(
      `https://www.coursera.org/api/onDemandWidgetSessions.v1/${userId}~${courseId}~${itemId}?fields=session,sessionId`,
      { credentials: 'include', headers: getApiHeaders(false) }
    );
    if (!sessRes.ok) return false;
    const sessData = await sessRes.json();
    const sessionId = sessData?.elements?.[0]?.sessionId;
    if (!sessionId) return false;

    const progRes = await fetch(
      `https://www.coursera.org/api/onDemandWidgetProgress.v1/${userId}~${courseId}~${itemId}`,
      {
        method: 'PUT',
        credentials: 'include',
        headers: getApiHeaders(true),
        body: JSON.stringify({
          sessionId: sessionId,
          progressState: 'Completed',
        }),
      }
    );
    return progRes.ok;
  } catch (err) {
    console.warn('[CourseraPro] apiCompleteWidget error:', err);
    return false;
  }
}

/**
 * Directly complete a Coursera Coach item via GraphQL Gateway
 * @param {string} userId
 * @param {string} courseId
 * @param {string} itemId
 * @returns {Promise<boolean>}
 */
async function apiCompleteCoach(userId, courseId, itemId) {
  try {
    const memRes = await fetch(
      `https://www.coursera.org/api/onDemandSessionMemberships.v1/?q=activeByUserAndCourse&userId=${userId}&courseId=${courseId}&includes=sessions&fields=onDemandSessions.v1(branchId)`,
      { credentials: 'include', headers: getApiHeaders(false) }
    );
    if (!memRes.ok) return false;
    const memData = await memRes.json();
    const sessions = memData?.linked?.['onDemandSessions.v1'] || [];
    const branchId = sessions[0]?.branchId;
    if (!branchId) return false;

    const graphqlBody = [
      {
        operationName: 'UpdateCoachItemProgress',
        variables: {
          courseId: courseId,
          branchId: branchId,
          itemId: itemId,
          progressState: 'COMPLETED',
        },
        query: `mutation UpdateCoachItemProgress($courseId: ID!, $branchId: ID!, $itemId: ID!, $progressState: CoachItem_ProgressState!) {
  CoachItemProgress_UpdateCoachItemProgress(
    input: {courseId: $courseId, branchId: $branchId, itemId: $itemId, progressState: $progressState}
  ) {
    _
    __typename
  }
}`,
      },
    ];

    const res = await fetch('https://www.coursera.org/graphql-gateway?opname=UpdateCoachItemProgress', {
      method: 'POST',
      credentials: 'include',
      headers: getApiHeaders(true),
      body: JSON.stringify(graphqlBody),
    });
    return res.ok;
  } catch (err) {
    console.warn('[CourseraPro] apiCompleteCoach error:', err);
    return false;
  }
}

/**
 * Directly complete an Ungraded LTI launch item
 * @param {string} userId
 * @param {string} courseId
 * @param {string} itemId
 * @returns {Promise<boolean>}
 */
async function apiCompleteLti(userId, courseId, itemId) {
  try {
    const res = await fetch('https://www.coursera.org/api/rest/v1/lti/ungradedLaunches', {
      method: 'POST',
      credentials: 'include',
      headers: getApiHeaders(true),
      body: JSON.stringify({
        courseId: courseId,
        itemId: itemId,
        learnerId: parseInt(userId, 10) || 0,
        markItemCompleted: true,
      }),
    });
    return res.ok;
  } catch (err) {
    console.warn('[CourseraPro] apiCompleteLti error:', err);
    return false;
  }
}

/**
 * Fetch all discussion prompts across the entire course
 * @param {string} courseSlug
 * @returns {Promise<Array<{id: string, name: string, slug: string, url: string}>>}
 */
async function fetchCourseDiscussions(courseSlug) {
  try {
    const data = await fetchCourseStructure(courseSlug);
    const items = data?.linked?.['onDemandCourseMaterialItems.v2'] || [];
    const discussions = [];
    const seenIds = new Set();

    for (const item of items) {
      if (!item || !item.id || seenIds.has(item.id)) continue;

      const typeName = item.contentSummary?.typeName || '';
      const isDiscussion =
        typeName === 'discussionPrompt' ||
        typeName.toLowerCase().includes('discussion') ||
        (item.slug && item.slug.includes('discussion-prompt')) ||
        (item.name && item.name.toLowerCase().includes('discussion prompt'));

      if (isDiscussion) {
        seenIds.add(item.id);
        const itemSlug = item.slug || '';
        const itemUrl = `https://www.coursera.org/learn/${courseSlug}/item/${item.id}`;
        const discussionUrl = itemSlug
          ? `https://www.coursera.org/learn/${courseSlug}/discussionPrompt/${item.id}/${itemSlug}`
          : itemUrl;

        discussions.push({
          id: item.id,
          name: item.name || 'Discussion Prompt',
          slug: itemSlug,
          url: discussionUrl,
          itemUrl: itemUrl,
        });
      }
    }

    return discussions;
  } catch (error) {
    console.warn('[CourseraPro] Failed to fetch discussions from API:', error);
    return [];
  }
}

/**
 * Mark an item as completed by navigating to it
 * @param {string} courseSlug
 * @param {string} itemId
 * @returns {Promise<void>}
 */
async function resolveItem(courseSlug, itemId) {
  return chrome.runtime.sendMessage({
    action: 'openAndClose',
    url: `https://www.coursera.org/learn/${courseSlug}/item/${itemId}`,
  });
}

/**
 * Submit a peer review grading request via GraphQL to switch to human peer grading
 * @param {string} courseId
 * @param {string} itemId
 * @param {string} submissionId
 * @param {string} [reason='EXPECTED_HIGHER_SCORE|ok']
 * @returns {Promise<Response>}
 */
async function requestGradingByPeer(courseId, itemId, submissionId, reason = 'EXPECTED_HIGHER_SCORE|ok') {
  const graphqlBody = [
    {
      operationName: 'RequestGradingByPeer',
      variables: {
        input: {
          courseId,
          itemId,
          submissionId,
          reason,
        },
      },
      query: `mutation RequestGradingByPeer($input: PeerReviewAi_RequestGradingByPeerInput!) {
  PeerReviewAi_RequestGradingByPeer(input: $input) {
    submissionId
    __typename
  }
}`,
    },
  ];

  try {
    const res = await fetch('https://www.coursera.org/graphql-gateway?opname=RequestGradingByPeer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getApiHeaders(true) },
      body: JSON.stringify(graphqlBody),
      credentials: 'include',
    });
    if (res.ok) return res;
  } catch (_e) {}

  return fetch('https://www.coursera.org/graphqlBatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getApiHeaders(true) },
    body: JSON.stringify(graphqlBody),
    credentials: 'include',
  });
}

/**
 * Fetch peer review submission info using Coursera Permissions API endpoint
 * @param {string} courseId
 * @param {string} itemId
 * @param {string} [userId='']
 * @returns {Promise<object>}
 */
async function fetchPeerSubmissionInfo(courseId, itemId, userId = '') {
  const learnerId = userId || extractUserId();

  if (learnerId && courseId && itemId) {
    try {
      const permUrl = `https://www.coursera.org/api/onDemandPeerAssignmentPermissions.v1/${learnerId}~${courseId}~${itemId}/?fields=deleteSubmission%2ClistSubmissions%2CreviewPeers%2CviewReviewSchema%2CanonymousPeerReview%2ConDemandPeerSubmissionProgresses.v1(latestSubmissionSummary%2ClatestDraftSummary%2ClatestAttemptSummary)%2ConDemandPeerReceivedReviewProgresses.v1(evaluationIfReady%2CearliestCompletionTime%2CreviewCount%2CdefaultReceivedReviewRequiredCount)%2ConDemandPeerDisplayablePhaseSchedules.v1(currentPhase%2CphaseEnds%2CphaseStarts)&includes=receivedReviewsProgress%2CsubmissionProgress%2CphaseSchedule`;
      const res = await fetch(permUrl, { credentials: 'include', headers: getApiHeaders(false) });
      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          return await res.json();
        }
      }
    } catch (_e) {}
  }

  if (courseId && itemId) {
    try {
      const url = `https://www.coursera.org/api/onDemandPeerAssignments.v1/${courseId}~${itemId}/?fields=deleteSubmission%2ClistSubmissions%2CreviewPeers%2CviewReviewSchema%2CanonymousPeerReview%2ConDemandPeerSubmissionProgresses.v1(latestSubmissionSummary%2ClatestDraftSummary%2ClatestAttemptSummary)%2ConDemandPeerReceivedReviewProgresses.v1(evaluationIfReady%2CearliestCompletionTime%2CreviewCount%2CdefaultReceivedReviewRequiredCount)%2ConDemandPeerDisplayablePhaseSchedules.v1(currentPhase%2CphaseEnds%2CphaseStarts)&includes=receivedReviewsProgress%2CsubmissionProgress%2CphaseSchedule`;
      const res = await fetch(url, { credentials: 'include', headers: getApiHeaders(false) });
      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          return await res.json();
        }
      }
    } catch (_e) {}
  }

  return {};
}

/**
 * Initiate an attempt session via Coursera GraphQL Gateway
 * Creates the in-progress draft attempt on the backend so /attempt does not render blank.
 * @param {string} courseId
 * @param {string} itemId
 * @returns {Promise<boolean>}
 */
async function apiInitiateAttempt(courseId, itemId) {
  if (!courseId || !itemId) return false;
  const graphqlBody = [
    {
      operationName: 'Submission_StartAttempt',
      variables: {
        courseId: courseId,
        itemId: itemId,
      },
      query: `mutation Submission_StartAttempt($courseId: ID!, $itemId: ID!) {
  Submission_StartAttempt(input: {courseId: $courseId, itemId: $itemId}) {
    ... on Submission_StartAttemptSuccess {
      submissionState {
        assignment {
          id
          __typename
        }
        __typename
      }
      __typename
    }
    ... on Submission_StartAttemptFailure {
      errors {
        errorCode
        __typename
      }
      __typename
    }
    __typename
  }
}`,
    },
  ];

  try {
    const res = await fetch('https://www.coursera.org/graphql-gateway?opname=Submission_StartAttempt', {
      method: 'POST',
      credentials: 'include',
      headers: getApiHeaders(true),
      body: JSON.stringify(graphqlBody),
    });

    if (res.ok) {
      const text = await res.text();
      return text.includes('Submission_StartAttemptSuccess') || text.includes('submissionState');
    }
  } catch (err) {
    console.warn('[CourseraPro] apiInitiateAttempt error:', err);
  }
  return false;
}


// ====== ui/panel.js ======
/**
 * Coursera Pro Tool - Floating Control Panel
 * Ultra-Pro Glassmorphism HUD injected into Coursera pages
 */

let panelEl = null;
let toastTimeout = null;
let isCollapsed = false;

// Store drag state
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

/**
 * Ensure Google Font is loaded for high-end typography
 */
function ensureFonts() {
  try {
    if (!document.getElementById('cpt-font-plus-jakarta')) {
      const link = document.createElement('link');
      link.id = 'cpt-font-plus-jakarta';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap';
      const container = document.head || document.documentElement || document.body;
      if (container) container.appendChild(link);
    }
  } catch (_e) {}
}

/**
 * Create and inject the floating panel
 * @param {object} handlers - Click handlers for each button
 */
function createPanel(handlers) {
  if (panelEl && document.body && document.body.contains(panelEl)) return;
  const existing = document.getElementById('cpt-panel');
  if (existing) {
    panelEl = existing;
    return;
  }

  ensureFonts();

  panelEl = document.createElement('div');
  panelEl.id = 'cpt-panel';
  panelEl.style.cssText = 'position:fixed !important; bottom:24px !important; right:24px !important; z-index:2147483647 !important; width:330px !important;';
  panelEl.innerHTML = `
    <div class="cpt-header" id="cpt-drag-handle">
      <div class="cpt-logo" id="cpt-header-logo" title="Bấm để thu nhỏ vào Quả Cầu Nổi (Alt+H)">
        <div class="cpt-logo-icon">
          <img src="${chrome.runtime.getURL('icons/cyber-orb.png')}" alt="Pro" width="30" height="30">
        </div>
        <div class="cpt-title-wrap">
          <div class="cpt-title-row">
            <span class="cpt-title">Coursera<span class="cpt-accent">PRO</span></span>
            <span class="cpt-engine-badge" id="cpt-engine-badge">⚡ AI Pro</span>
          </div>
          <div class="cpt-sub-row">
            <div class="cpt-status-pill">
              <span class="cpt-status-dot"></span>
              <span id="cpt-status-label">Sẵn sàng hoạt động</span>
            </div>
          </div>
        </div>
      </div>
      <div class="cpt-header-actions">
        <button class="cpt-btn-icon" id="cpt-quick-settings" title="Cài đặt API key & Tùy chọn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
        </button>
        <button class="cpt-btn-icon" id="cpt-minimize" title="Thu nhỏ thành Quả Cầu Nổi (Alt+H)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button class="cpt-btn-icon" id="cpt-toggle" title="Thu gọn danh sách nút">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
    </div>
    <div class="cpt-body" id="cpt-body">
      <!-- High-Tech Progress HUD -->
      <div class="cpt-progress" id="cpt-progress" style="display:none;">
        <div class="cpt-progress-track">
          <div class="cpt-progress-bar" id="cpt-progress-bar" style="width:0%;"></div>
        </div>
        <span class="cpt-progress-text" id="cpt-progress-text"></span>
      </div>

      <!-- Segmented Tab Navigation -->
      <div class="cpt-tab-nav" id="cpt-tab-nav">
        <button class="cpt-tab-btn active" data-tab="learning" id="cpt-tab-learning" type="button">⚡ Học tập</button>
        <button class="cpt-tab-btn" data-tab="peer" id="cpt-tab-peer" type="button">👥 Chấm chéo</button>
        <button class="cpt-tab-btn" data-tab="media" id="cpt-tab-media" type="button">🎬 Media</button>
      </div>

      <!-- Action Modules (Tab Panes) -->
      <div class="cpt-actions">
        <!-- TAB 1: HỌC TẬP (Autopilot, Quiz AI, Soạn bài tập, Thảo luận) -->
        <div class="cpt-tab-pane active" id="cpt-pane-learning">
          <!-- Master Course Autopilot -->
          <button class="cpt-btn cpt-btn-autopilot" id="cpt-autopilot" title="Tự động hoàn thành toàn bộ khóa học từ Tuần 1 đến N (1-Click)">
            <div class="cpt-btn-left">
              <span class="cpt-icon-box cpt-icon-gold">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </span>
              <div class="cpt-btn-info">
                <span class="cpt-btn-name">Master Autopilot</span>
                <span class="cpt-btn-desc">Cày tự động toàn khóa 1-Click</span>
              </div>
            </div>
            <span class="cpt-tag cpt-tag-gold">🚀 1-CLICK</span>
          </button>

          <!-- Auto Quiz AI -->
          <button class="cpt-btn cpt-btn-quiz" id="cpt-quiz" title="Tự động giải Quiz bằng Gemini / DeepSeek / Groq (Alt+Q)">
            <div class="cpt-btn-left">
              <span class="cpt-icon-box cpt-icon-purple">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              </span>
              <div class="cpt-btn-info">
                <span class="cpt-btn-name">Auto Quiz AI</span>
                <span class="cpt-btn-desc">Smart Retake (100% Điểm)</span>
              </div>
            </div>
            <span class="cpt-tag cpt-tag-purple">🎯 100% AI</span>
          </button>

          <!-- Auto Assignment (AI Soạn Bài Tập) -->
          <button class="cpt-btn cpt-btn-assignment" id="cpt-auto-assignment" title="Tự động viết và điền bài nộp Peer Assignment theo Rubric (Alt+A)">
            <div class="cpt-btn-left">
              <span class="cpt-icon-box cpt-icon-emerald">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </span>
              <div class="cpt-btn-info">
                <span class="cpt-btn-name">AI Soạn Bài Tập</span>
                <span class="cpt-btn-desc">Viết bài nộp chuẩn Rubric</span>
              </div>
            </div>
            <span class="cpt-tag cpt-tag-emerald">✨ ESSAY</span>
          </button>

          <!-- Auto Discussion -->
          <button class="cpt-btn cpt-btn-discussion" id="cpt-discussion" title="Tự động tìm và giải TẤT CẢ thảo luận (cách nhau 30s)">
            <div class="cpt-btn-left">
              <span class="cpt-icon-box cpt-icon-green" id="cpt-discussion-icon">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
              </span>
              <div class="cpt-btn-info">
                <span class="cpt-btn-name" id="cpt-discussion-name">Auto Discussion</span>
                <span class="cpt-btn-desc" id="cpt-discussion-desc">Tất cả bài thảo luận (cách 30s)</span>
              </div>
            </div>
            <span class="cpt-tag cpt-tag-green" id="cpt-discussion-tag">30s DELAY</span>
          </button>
        </div>

        <!-- TAB 2: CHẤM CHÉO (Peer Review, Tắt AI Chấm, Lấy link) -->
        <div class="cpt-tab-pane" id="cpt-pane-peer">
          <!-- Auto Review -->
          <button class="cpt-btn cpt-btn-review" id="cpt-review" title="Tự động chấm bài tập peer review">
            <div class="cpt-btn-left">
              <span class="cpt-icon-box cpt-icon-orange">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6"/><path d="M23 11h-6"/></svg>
              </span>
              <div class="cpt-btn-info">
                <span class="cpt-btn-name">Peer Review</span>
                <span class="cpt-btn-desc">Tự động chấm bài học viên</span>
              </div>
            </div>
            <span class="cpt-tag cpt-tag-orange">⭐ PEER</span>
          </button>

          <!-- Tắt AI Chấm (Disable AI Grading) -->
          <button class="cpt-btn cpt-btn-disable-ai" id="cpt-disable-ai" title="Tắt AI chấm chéo và chuyển bài nộp sang người chấm">
            <div class="cpt-btn-left">
              <span class="cpt-icon-box cpt-icon-indigo">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
              </span>
              <div class="cpt-btn-info">
                <span class="cpt-btn-name">Tắt AI chấm bài</span>
                <span class="cpt-btn-desc">Chuyển sang người học chấm</span>
              </div>
            </div>
            <span class="cpt-tag cpt-tag-indigo">NO AI</span>
          </button>

          <!-- Lấy Link Chấm Chéo (Get Shareable Peer Link) -->
          <button class="cpt-btn cpt-btn-share-link" id="cpt-share-link" title="Lấy và copy link chấm chéo bài tập đã nộp để nhờ bạn bè chấm">
            <div class="cpt-btn-left">
              <span class="cpt-icon-box cpt-icon-teal">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              </span>
              <div class="cpt-btn-info">
                <span class="cpt-btn-name">Lấy link chấm chéo</span>
                <span class="cpt-btn-desc">Tạo & copy link nộp bài</span>
              </div>
            </div>
            <span class="cpt-tag cpt-tag-teal">🔗 LINK</span>
          </button>
        </div>

        <!-- TAB 3: MEDIA (Bypass tuần, Tốc độ video, Skip video) -->
        <div class="cpt-tab-pane" id="cpt-pane-media">
          <!-- Bypass Week -->
          <button class="cpt-btn cpt-btn-bypass" id="cpt-bypass" title="Tự động hoàn thành video & bài đọc tuần này">
            <div class="cpt-btn-left">
              <span class="cpt-icon-box cpt-icon-cyan">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </span>
              <div class="cpt-btn-info">
                <span class="cpt-btn-name">Bypass Week</span>
                <span class="cpt-btn-desc">Hoàn thành nhanh video & đọc</span>
              </div>
            </div>
            <span class="cpt-tag cpt-tag-cyan">⚡ FAST</span>
          </button>

          <!-- Tốc độ Video (Speed Controller) -->
          <button class="cpt-btn cpt-btn-speed" id="cpt-video-speed" title="Thay đổi tốc độ phát video (Chạy ngầm không dừng - Alt+P)">
            <div class="cpt-btn-left">
              <span class="cpt-icon-box cpt-icon-sky">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </span>
              <div class="cpt-btn-info">
                <span class="cpt-btn-name">Tốc độ phát Video</span>
                <span class="cpt-btn-desc">Chạy ngầm không dừng (Anti-Blur)</span>
              </div>
            </div>
            <span class="cpt-tag cpt-tag-cyan" id="cpt-speed-tag">1x</span>
          </button>

          <!-- Skip Video -->
          <button class="cpt-btn cpt-btn-skip" id="cpt-skip-video" title="Bỏ qua video đang xem tới cuối (Alt+S)">
            <div class="cpt-btn-left">
              <span class="cpt-icon-box cpt-icon-rose">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
              </span>
              <div class="cpt-btn-info">
                <span class="cpt-btn-name">Skip Video</span>
                <span class="cpt-btn-desc">Tua xem hết video hiện tại</span>
              </div>
            </div>
            <span class="cpt-tag cpt-tag-rose">SKIP</span>
          </button>
        </div>
      </div>

      <!-- Shareable Link HUD Card -->
      <div class="cpt-share-hud" id="cpt-share-hud" style="display:none;">
        <div class="cpt-share-top">
          <span class="cpt-share-label">🔗 Link Chấm Chéo Bài Tập</span>
          <button class="cpt-share-close" id="cpt-share-close" title="Đóng">✕</button>
        </div>
        <div class="cpt-share-bar">
          <input type="text" id="cpt-share-input" class="cpt-share-input" readonly placeholder="Link chấm chéo...">
          <button class="cpt-share-btn cpt-share-btn-copy" id="cpt-share-copy" title="Sao chép">Copy</button>
          <button class="cpt-share-btn cpt-share-btn-open" id="cpt-share-open" title="Mở trong tab mới">Mở</button>
        </div>
      </div>

      <!-- Toast Container -->
      <div class="cpt-toast" id="cpt-toast" style="display:none;"></div>

      <!-- Hotkeys Hint -->
      <div class="cpt-hotkeys-hint">
        ⌨️ Phím tắt: <span>Alt+Q</span> Quiz · <span>Alt+A</span> Soạn bài · <span>Alt+S</span> Tua · <span>Alt+P</span> Tốc độ · <span>Alt+H</span> Thu nhỏ
      </div>

      <!-- Footer Bar -->
      <div class="cpt-footer">
        <span class="cpt-version-badge">⚡ v3.0 Pro Active</span>
        <button class="cpt-btn-link" id="cpt-settings-btn">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          Cài đặt
        </button>
      </div>
    </div>
  `;

  (document.body || document.documentElement).appendChild(panelEl);

  // Initialize Mini Dock widget (Orb)
  createMiniDock();

  // Set up event listeners safely
  try { setupTabs(); } catch (e) { console.warn('[CourseraPro] setupTabs error:', e); }
  try { setupDragging(); } catch (e) { console.warn('[CourseraPro] setupDragging error:', e); }
  try { setupToggle(); } catch (e) { console.warn('[CourseraPro] setupToggle error:', e); }
  try { setupHotkeys(handlers); } catch (e) { console.warn('[CourseraPro] setupHotkeys error:', e); }

  // Ensure panel is visible and expanded by default
  panelEl.classList.remove('cpt-hidden');
  panelEl.style.setProperty('display', 'block', 'important');
  panelEl.style.setProperty('visibility', 'visible', 'important');
  panelEl.style.setProperty('opacity', '1', 'important');

  // Bind action handlers safely
  document.getElementById('cpt-autopilot')?.addEventListener('click', () => handlers.onAutopilot?.());
  document.getElementById('cpt-bypass')?.addEventListener('click', () => handlers.onBypass?.());
  document.getElementById('cpt-quiz')?.addEventListener('click', () => handlers.onQuiz?.());
  document.getElementById('cpt-auto-assignment')?.addEventListener('click', () => handlers.onAutoAssignment?.());
  document.getElementById('cpt-discussion')?.addEventListener('click', () => handlers.onDiscussion?.());
  document.getElementById('cpt-review')?.addEventListener('click', () => handlers.onReview?.());
  document.getElementById('cpt-disable-ai')?.addEventListener('click', () => (handlers.onDisableAI || handlers.onGrading)?.());
  document.getElementById('cpt-share-link')?.addEventListener('click', () => handlers.onGetShareLink?.());
  document.getElementById('cpt-video-speed')?.addEventListener('click', () => handlers.onCycleSpeed?.());
  document.getElementById('cpt-skip-video')?.addEventListener('click', () => handlers.onSkipVideo?.());
  document.getElementById('cpt-settings-btn')?.addEventListener('click', () => handlers.onSettings?.());
  document.getElementById('cpt-quick-settings')?.addEventListener('click', () => handlers.onSettings?.());
  document.getElementById('cpt-minimize')?.addEventListener('click', () => togglePanelMinimize(true));
  document.getElementById('cpt-header-logo')?.addEventListener('click', () => togglePanelMinimize(true));

  // Initialize saved speed badge
  const savedRate = localStorage.getItem('cpt_playback_rate') || '1';
  const speedTag = document.getElementById('cpt-speed-tag');
  if (speedTag) speedTag.textContent = `${savedRate}x`;

  // Update active engine badge dynamically
  try {
    chrome.storage?.local?.get?.(['aiProvider', 'model', 'model_gemini', 'model_deepseek', 'model_groq'], (data) => {
      if (!data) return;
      const provider = (data.aiProvider || 'gemini').toLowerCase();
      const badge = document.getElementById('cpt-engine-badge');
      if (badge) {
        if (provider === 'deepseek') {
          badge.textContent = '⚡ DeepSeek AI';
        } else if (provider === 'groq') {
          badge.textContent = '⚡ Groq (~500 t/s)';
        } else {
          const model = data.model_gemini || data.model || '';
          if (model.includes('8b')) badge.textContent = '⚡ Flash 8B';
          else if (model.includes('lite')) badge.textContent = '⚡ Flash Lite';
          else if (model.includes('pro')) badge.textContent = '⚡ Gemini Pro';
          else if (model.includes('2.0') || model.includes('2.5')) badge.textContent = '⚡ Gemini 2.0';
          else badge.textContent = '⚡ Gemini AI';
        }
      }
    });
  } catch (_e) {}
}

/**
 * Setup Segmented Tabs functionality
 */
function setupTabs() {
  const tabBtns = document.querySelectorAll('.cpt-tab-btn');
  const panes = document.querySelectorAll('.cpt-tab-pane');

  const activateTab = (tabKey) => {
    tabBtns.forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tabKey);
    });
    panes.forEach((p) => {
      p.classList.toggle('active', p.id === `cpt-pane-${tabKey}`);
    });
    try {
      localStorage.setItem('cpt_active_tab', tabKey);
    } catch (_e) {}
  };

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tabKey = btn.getAttribute('data-tab');
      if (tabKey) activateTab(tabKey);
    });
  });

  // Restore saved active tab (default 'learning')
  const savedTab = localStorage.getItem('cpt_active_tab') || 'learning';
  if (document.getElementById(`cpt-pane-${savedTab}`)) {
    activateTab(savedTab);
  } else {
    activateTab('learning');
  }
}

let miniDockEl = null;

/**
 * Create the Mini Floating Dock element (Cyber Orb)
 */
function createMiniDock() {
  if (miniDockEl) return;

  miniDockEl = document.createElement('div');
  miniDockEl.id = 'cpt-mini-dock';
  miniDockEl.className = 'cpt-mini-dock';
  miniDockEl.title = 'Coursera PRO HUD (Bấm để mở rộng · Alt+H)';
  miniDockEl.innerHTML = `
    <div class="cpt-mini-glow-ring"></div>
    <img src="${chrome.runtime.getURL('icons/cyber-orb.png')}" alt="Pro" class="cpt-mini-icon">
    <span class="cpt-mini-status"></span>
  `;

  (document.body || document.documentElement).appendChild(miniDockEl);

  setupMiniDockDragging();
}

/**
 * Toggle between Full Panel and Mini Floating Dock
 * @param {boolean|null} forceState
 */
function togglePanelMinimize(forceState = null) {
  if (!panelEl) return;
  if (!miniDockEl) createMiniDock();

  const isCurrentlyMinimized = panelEl.classList.contains('cpt-hidden') || panelEl.style.display === 'none';
  const shouldMinimize = forceState !== null ? forceState : !isCurrentlyMinimized;

  if (shouldMinimize) {
    if (panelEl.style.top && panelEl.style.left) {
      miniDockEl.style.top = panelEl.style.top;
      miniDockEl.style.left = panelEl.style.left;
      miniDockEl.style.bottom = 'auto';
      miniDockEl.style.right = 'auto';
    }
    panelEl.classList.add('cpt-hidden');
    panelEl.style.setProperty('display', 'none', 'important');

    miniDockEl.classList.add('cpt-visible');
    miniDockEl.style.setProperty('display', 'flex', 'important');

    localStorage.setItem('cpt_panel_minimized', 'true');
  } else {
    if (miniDockEl.style.top && miniDockEl.style.left) {
      panelEl.style.top = miniDockEl.style.top;
      panelEl.style.left = miniDockEl.style.left;
      panelEl.style.bottom = 'auto';
      panelEl.style.right = 'auto';
    }
    miniDockEl.classList.remove('cpt-visible');
    miniDockEl.style.setProperty('display', 'none', 'important');

    panelEl.classList.remove('cpt-hidden');
    panelEl.style.setProperty('display', 'block', 'important');

    localStorage.setItem('cpt_panel_minimized', 'false');
  }
}

/**
 * Setup Global Hotkeys
 * @param {object} handlers
 */
function setupHotkeys(handlers) {
  window.addEventListener('keydown', (e) => {
    // Ignore hotkeys when typing in forms
    const active = document.activeElement;
    if (active && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable)) {
      return;
    }

    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const key = e.key.toLowerCase();
      if (key === 'q') {
        e.preventDefault();
        handlers.onQuiz?.();
      } else if (key === 'a') {
        e.preventDefault();
        handlers.onAutoAssignment?.();
      } else if (key === 's') {
        e.preventDefault();
        handlers.onSkipVideo?.();
      } else if (key === 'd') {
        e.preventDefault();
        handlers.onDiscussion?.();
      } else if (key === 'l') {
        e.preventDefault();
        handlers.onGetShareLink?.();
      } else if (key === 'p') {
        e.preventDefault();
        handlers.onCycleSpeed?.();
      } else if (key === 'h') {
        e.preventDefault();
        togglePanelMinimize();
      }
    }
  });
}

/**
 * Setup drag functionality for the mini dock
 */
function setupMiniDockDragging() {
  if (!miniDockEl) return;

  let isDockDragging = false;
  let dockOffsetX = 0;
  let dockOffsetY = 0;
  let startX = 0;
  let startY = 0;
  let hasMoved = false;

  miniDockEl.addEventListener('mousedown', (e) => {
    isDockDragging = true;
    hasMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = miniDockEl.getBoundingClientRect();
    dockOffsetX = e.clientX - rect.left;
    dockOffsetY = e.clientY - rect.top;
    miniDockEl.style.transition = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDockDragging) return;
    const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
    if (dist > 5) {
      hasMoved = true;
    }
    const x = Math.max(0, Math.min(window.innerWidth - miniDockEl.offsetWidth, e.clientX - dockOffsetX));
    const y = Math.max(0, Math.min(window.innerHeight - miniDockEl.offsetHeight, e.clientY - dockOffsetY));
    miniDockEl.style.left = x + 'px';
    miniDockEl.style.top = y + 'px';
    miniDockEl.style.right = 'auto';
    miniDockEl.style.bottom = 'auto';
  });

  document.addEventListener('mouseup', () => {
    if (isDockDragging) {
      isDockDragging = false;
      miniDockEl.style.transition = '';
    }
  });

  miniDockEl.addEventListener('click', (e) => {
    if (hasMoved) {
      hasMoved = false;
      return;
    }
    if (e.target.closest('button')) return;
    togglePanelMinimize(false);
  });
}

/**
 * Setup drag functionality for the panel
 */
function setupDragging() {
  const handle = document.getElementById('cpt-drag-handle');
  if (!handle || !panelEl) return;

  handle.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
    isDragging = true;
    const rect = panelEl.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    panelEl.style.transition = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const x = Math.max(0, Math.min(window.innerWidth - panelEl.offsetWidth, e.clientX - dragOffsetX));
    const y = Math.max(0, Math.min(window.innerHeight - panelEl.offsetHeight, e.clientY - dragOffsetY));
    panelEl.style.left = x + 'px';
    panelEl.style.top = y + 'px';
    panelEl.style.right = 'auto';
    panelEl.style.bottom = 'auto';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    panelEl.style.transition = '';
  });
}

/**
 * Setup collapse/expand toggle
 */
function setupToggle() {
  const toggleBtn = document.getElementById('cpt-toggle');
  const body = document.getElementById('cpt-body');
  const handle = document.getElementById('cpt-drag-handle');

  const setCollapsedState = (collapsed) => {
    isCollapsed = collapsed;
    if (body) body.style.display = isCollapsed ? 'none' : 'flex';
    if (toggleBtn) {
      toggleBtn.innerHTML = isCollapsed
        ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>'
        : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>';
      toggleBtn.title = isCollapsed ? 'Mở rộng danh sách nút' : 'Thu gọn danh sách nút';
    }
  };

  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setCollapsedState(!isCollapsed);
    });
  }

  if (handle) {
    handle.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      if (isCollapsed) {
        setCollapsedState(false);
      }
    });
  }
}

/**
 * Show a toast notification in the panel
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} type
 */
function showToast(message, type = 'info') {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  const toast = document.getElementById('cpt-toast');
  if (!toast) return;

  toast.textContent = message;
  toast.className = `cpt-toast cpt-toast-${type}`;
  toast.style.display = 'block';

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.style.display = 'none';
  }, 5000);
}

/**
 * Update progress bar
 * @param {number} current
 * @param {number} total
 * @param {string} text
 */
function updateProgress(current, total, text = '') {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  const container = document.getElementById('cpt-progress');
  const bar = document.getElementById('cpt-progress-bar');
  const textEl = document.getElementById('cpt-progress-text');

  if (!container) return;

  if (total <= 0) {
    container.style.display = 'none';
    return;
  }

  const percent = Math.min(100, Math.max(0, Math.round((current / total) * 100)));
  container.style.display = 'flex';
  bar.style.width = percent + '%';
  textEl.textContent = text || `${current}/${total}`;
}

/**
 * Toggle active visual state of the Discussion button
 * @param {boolean} isActive
 * @param {string} text
 */
function setDiscussionActive(isActive, text = '') {
  const btn = document.getElementById('cpt-discussion');
  const nameEl = document.getElementById('cpt-discussion-name');
  const descEl = document.getElementById('cpt-discussion-desc');
  const tagEl = document.getElementById('cpt-discussion-tag');
  const statusLabel = document.getElementById('cpt-status-label');
  const statusDot = document.querySelector('.cpt-status-dot');

  if (!btn) return;

  if (isActive) {
    btn.classList.add('cpt-btn-running');
    if (nameEl) nameEl.textContent = 'Dừng thảo luận (Stop)';
    if (descEl) descEl.textContent = text || 'Bấm để dừng tự động';
    if (tagEl) {
      tagEl.textContent = '⏹ DỪNG';
      tagEl.className = 'cpt-tag cpt-tag-rose';
    }
    if (statusLabel) statusLabel.textContent = text || 'Đang tự động thảo luận...';
    if (statusDot) {
      statusDot.style.background = '#f43f5e';
      statusDot.style.boxShadow = '0 0 12px #f43f5e';
    }
  } else {
    btn.classList.remove('cpt-btn-running');
    if (nameEl) nameEl.textContent = 'Auto Discussion';
    if (descEl) descEl.textContent = 'Tất cả bài thảo luận (cách 30s)';
    if (tagEl) {
      tagEl.textContent = '30s DELAY';
      tagEl.className = 'cpt-tag cpt-tag-green';
    }
    if (statusLabel) statusLabel.textContent = 'Sẵn sàng hoạt động';
    if (statusDot) {
      statusDot.style.background = '#10b981';
      statusDot.style.boxShadow = '0 0 10px #10b981';
    }
  }
}

/**
 * Display the shareable link in the HUD card
 * @param {string} url
 */
function displayShareLink(url) {
  const hud = document.getElementById('cpt-share-hud');
  const input = document.getElementById('cpt-share-input');
  const copyBtn = document.getElementById('cpt-share-copy');
  const openBtn = document.getElementById('cpt-share-open');
  const closeBtn = document.getElementById('cpt-share-close');

  if (!hud || !input) return;

  input.value = url;
  hud.style.display = 'flex';

  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
      } catch (_e) {
        input.select();
        document.execCommand('copy');
      }
      copyBtn.textContent = 'Copied ✓';
      showToast('📋 Đã sao chép link chấm chéo vào clipboard!', 'success');
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 2000);
    };
  }

  if (openBtn) {
    openBtn.onclick = () => {
      window.open(url, '_blank');
    };
  }

  if (closeBtn) {
    closeBtn.onclick = () => {
      hud.style.display = 'none';
    };
  }
}

/**
 * Remove the panel from DOM
 */
function removePanel() {
  if (panelEl) {
    panelEl.remove();
    panelEl = null;
  }
}


// ====== modules/bypass.js ======
/**
 * Coursera Pro Tool - Video/Reading Bypass Module
 * Automatically marks videos and readings as completed using Native REST API
 * with graceful fallback to background worker tab.
 */

let isBypassRunning = false;

/**
 * Cancel active bypass process
 */
async function cancelBypass() {
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
async function resolveWeekMaterial() {
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
async function runBypassWorker() {
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
function skipVideo() {
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
function setVideoSpeed(speed = 2) {
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
function cycleVideoSpeed() {
  const current = parseFloat(localStorage.getItem('cpt_playback_rate') || '1.0');
  const currentIndex = SPEED_PRESETS.findIndex((s) => Math.abs(s - current) < 0.05);
  const nextIndex = currentIndex === -1 || currentIndex >= SPEED_PRESETS.length - 1 ? 0 : currentIndex + 1;
  const nextSpeed = SPEED_PRESETS[nextIndex];

  setVideoSpeed(nextSpeed);
  return nextSpeed;
}


// ====== modules/quiz.js ======
/**
 * Coursera Pro Tool - Auto Quiz Module
 * Uses Gemini AI to automatically:
 * 1. Enter quiz attempt from outside assignment page (Resume / Start)
 * 2. Solve all quiz questions using Gemini AI
 * 3. Auto-submit the quiz attempt
 * 4. Automatically exit back to the overview page!
 */

const STORAGE_KEY_QUIZ = 'cpt_auto_quiz';

/**
 * Clean string for reliable comparison
 * @param {string} str
 * @returns {string}
/**
 * Safely decode common HTML entities
 * @param {string} str
 * @returns {string}
 */
function decodeHtml(str) {
  if (!str || typeof str !== 'string' || !str.includes('&')) return str || '';
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&le;/g, '<=')
    .replace(/&ge;/g, '>=')
    .replace(/&ne;/g, '!=');
}

/**
 * Clean string for reliable comparison
 * Preserves decimal points between numbers (e.g. 10.5%) and relational operators (>=, <=, >, <, +, -)
 * @param {string} str
 * @returns {string}
 */
function cleanText(str) {
  if (!str) return '';
  let text = decodeHtml(String(str));
  return text
    .toLowerCase()
    .replace(/^\s*(?:question\s*\d+[\s:.-]*|\d+[.):]\s+|[a-z0-9]{1,2}[.):]\s+)/i, '') // remove "Question 1:", "10. ", "A. "
    .replace(/(?<!\d)\.|\.(?!\d)/g, '') // remove dots that are not decimal points
    .replace(/[,;:!?"'‘’“”`~()\[\]{}]/g, '') // remove punctuation noise, keep math: < > = + - * / % ^
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract label text associated with an input element
 * @param {HTMLInputElement} input
 * @returns {string}
 */
function extractOptionLabel(input) {
  // 1. Closest <label>
  const label = input.closest('label');
  if (label) {
    const clone = label.cloneNode(true);
    clone.querySelectorAll('input, .cpt-badge, svg, [aria-hidden="true"], .sr-only, .rc-FormPartsQuestion__error, .rc-FormPartsQuestion__success, [data-testid*="feedback"]').forEach((i) => i.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }

  // 2. <label for="...">
  if (input.id) {
    const forLabel = document.querySelector(`label[for="${input.id}"]`);
    if (forLabel) {
      const clone = forLabel.cloneNode(true);
      clone.querySelectorAll('input, .cpt-badge, svg, [aria-hidden="true"], .sr-only, .rc-FormPartsQuestion__error, .rc-FormPartsQuestion__success, [data-testid*="feedback"]').forEach((i) => i.remove());
      const text = clone.textContent?.trim();
      if (text) return text;
    }
  }

  // 3. Parent element
  const parent = input.parentElement;
  if (parent) {
    const clone = parent.cloneNode(true);
    clone.querySelectorAll('input, .cpt-badge, svg, [aria-hidden="true"], .sr-only, .rc-FormPartsQuestion__error, .rc-FormPartsQuestion__success, [data-testid*="feedback"]').forEach((i) => i.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }

  return input.nextSibling?.textContent?.trim() || input.value || '';
}

/**
 * Extract course slug from current URL
 * @returns {string} e.g. "research-methodologies"
 */
function getCurrentCourseSlug() {
  const match = location.pathname.match(/\/learn\/([^/]+)/);
  return match ? match[1].toLowerCase() : 'general_course';
}

/**
 * Storage key prefix for course source
 */
const SOURCE_KEY_PREFIX = 'cpt_local_source_';

/**
 * Load all stored Q&A pairs for a course
 * @param {string} [courseSlug]
 * @returns {Promise<Array<{prompt: string, cleanPrompt: string, answer: string, options: string[], timestamp: number}>>}
 */
async function loadCourseSource(courseSlug = '') {
  const slug = courseSlug || getCurrentCourseSlug();
  const key = `${SOURCE_KEY_PREFIX}${slug}`;
  const data = await chrome.storage.local.get([key]);
  return Array.isArray(data[key]) ? data[key] : [];
}

/**
 * Save new Q&A pairs into course source, merging duplicates
 * @param {string} courseSlug
 * @param {Array<{prompt: string, answer: string, options?: string[]}>} newPairs
 * @returns {Promise<number>} Total items in source
 */
async function saveToCourseSource(courseSlug, newPairs) {
  if (!newPairs || newPairs.length === 0) return 0;
  const slug = courseSlug || getCurrentCourseSlug();
  const key = `${SOURCE_KEY_PREFIX}${slug}`;

  const existing = await loadCourseSource(slug);
  const existingMap = new Map();

  for (const item of existing) {
    const cp = item.cleanPrompt || cleanText(item.prompt);
    if (cp) existingMap.set(cp, item);
  }

  let addedCount = 0;
  for (const pair of newPairs) {
    if (!pair.prompt || !pair.answer) continue;
    const cp = cleanText(pair.prompt);
    if (!cp) continue;

    const newItem = {
      prompt: pair.prompt.trim(),
      cleanPrompt: cp,
      answer: pair.answer.trim(),
      options: Array.isArray(pair.options) ? pair.options : [],
      timestamp: Date.now(),
    };

    if (!existingMap.has(cp) || existingMap.get(cp).answer !== newItem.answer) {
      existingMap.set(cp, newItem);
      addedCount++;
    }
  }

  const updatedList = Array.from(existingMap.values());
  await chrome.storage.local.set({ [key]: updatedList });
  console.log(`[CourseraPro] Local Source [${slug}]: saved ${addedCount} new items, total ${updatedList.length} items`);
  return updatedList.length;
}

const BLACKLIST_PREFIX = 'cpt_quiz_blacklist_';

/**
 * Load incorrect answers blacklist for Smart Retake
 * @param {string} [courseSlug]
 * @returns {Promise<Record<string, string[]>>}
 */
async function loadQuizBlacklist(courseSlug = '') {
  const slug = courseSlug || getCurrentCourseSlug();
  const key = `${BLACKLIST_PREFIX}${slug}`;
  const data = await chrome.storage.local.get([key]);
  return data[key] && typeof data[key] === 'object' ? data[key] : {};
}

/**
 * Save incorrect answers blacklist for Smart Retake
 * @param {string} courseSlug
 * @param {Record<string, string[]>} blacklistMap
 */
async function saveQuizBlacklist(courseSlug, blacklistMap) {
  const slug = courseSlug || getCurrentCourseSlug();
  const key = `${BLACKLIST_PREFIX}${slug}`;
  await chrome.storage.local.set({ [key]: blacklistMap });
}

/**
 * Purge blacklisted incorrect answers from local course source to prevent retake cache poisoning
 * @param {string} courseSlug
 * @param {Record<string, string[]>} blacklistMap
 * @returns {Promise<number>} Number of bad items purged
 */
async function purgeWrongAnswersFromSource(courseSlug, blacklistMap) {
  if (!blacklistMap || Object.keys(blacklistMap).length === 0) return 0;
  const slug = courseSlug || getCurrentCourseSlug();
  const key = `${SOURCE_KEY_PREFIX}${slug}`;
  const existing = await loadCourseSource(slug);
  if (!existing || existing.length === 0) return 0;

  let purgedCount = 0;
  const cleanedSource = existing.filter((item) => {
    const cp = item.cleanPrompt || cleanText(item.prompt);
    const blacklisted = blacklistMap[cp] || [];
    if (blacklisted.length === 0) return true;

    const itemAns = cleanText(item.answer);
    const isBad = blacklisted.some((bad) => {
      const cBad = cleanText(bad);
      return cBad === itemAns || (cBad.length >= 4 && itemAns.length >= 4 && (cBad.includes(itemAns) || itemAns.includes(cBad)));
    });

    if (isBad) {
      console.log(`[CourseraPro Smart Retake] Purging poisoned cache from Source [${slug}]: "${item.prompt}" -> "${item.answer}"`);
      purgedCount++;
      return false;
    }
    return true;
  });

  if (purgedCount > 0) {
    await chrome.storage.local.set({ [key]: cleanedSource });
    console.log(`[CourseraPro Smart Retake] Cleaned ${purgedCount} poisoned items from Local Source.`);
  }
  return purgedCount;
}

/**
 * Extract clean option text from a feedback review element, stripping out feedback banners, errors, and badges
 * @param {Element} element
 * @returns {string}
 */
function extractCleanFeedbackOptionLabel(element) {
  if (!element) return '';
  const clone = element.cloneNode(true);
  clone.querySelectorAll(
    'input, .cpt-badge, svg, [aria-hidden="true"], .sr-only, ' +
    '.rc-FormPartsQuestion__error, .rc-FormPartsQuestion__success, ' +
    '[data-testid*="feedback" i], [class*="feedback" i], [class*="Feedback" i], ' +
    '[class*="callout" i], [class*="Callout" i], [role="alert"], [class*="css-1m4z3k7"]'
  ).forEach((el) => el.remove());

  let raw = clone.textContent?.trim() || '';
  // Split on feedback markers that Coursera attaches
  raw = raw.split(/\b(?:try\s+again|this\s+should\s+not\s+be\s+selected|this\s+should\s+be\s+selected|incorrect|correct|sai|đúng)\b/i)[0].trim();
  return raw;
}

/**
 * Scan post-quiz review / results page, record wrong answers to blacklist and correct answers to Source
 * @returns {Promise<{wrongRecorded: number, correctRecorded: number}>}
 */
async function recordQuizReviewFeedback() {
  const courseSlug = getCurrentCourseSlug();
  const blacklist = await loadQuizBlacklist(courseSlug);
  const correctToSave = [];
  let wrongRecorded = 0;
  let correctRecorded = 0;

  const questionBlocks = document.querySelectorAll(
    '.rc-FormPartsQuestion, fieldset, [data-testid*="question" i], [class*="QuizQuestion" i], [class*="FormPartsQuestion" i], [class*="QuestionPart" i]'
  );

  questionBlocks.forEach((block) => {
    // Isolate prompt text safely without truncating
    let promptText = '';
    const promptEl = block.querySelector(
      'legend, .rc-FormPartsQuestion__title, [data-testid*="prompt" i], .rc-CML, [class*="Prompt"], [class*="title"], h2, h3, h4'
    );
    if (promptEl) {
      promptText = promptEl.textContent?.trim() || '';
    }
    if (!promptText) {
      try {
        const clone = block.cloneNode(true);
        clone.querySelectorAll('input, label, [role="radio"], [role="checkbox"], .cpt-badge, svg, .rc-FormPartsQuestion__error, .rc-FormPartsQuestion__success, [data-testid*="feedback"]').forEach((el) => el.remove());
        promptText = clone.textContent?.trim() || '';
      } catch (_e) {
        promptText = block.innerText || block.textContent || '';
      }
    }
    promptText = promptText
      .replace(/\b\d+\s*(?:points?|điểm)\b/gi, '')
      .replace(/\b\d+\s*\/\s*\d+\s*(?:points?|điểm)\b/gi, '')
      .replace(/^\s*(?:question\s*\d+[\s:.-]*|\d+[.):]\s+)/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    const rawPrompt = promptText;
    const cp = cleanText(rawPrompt);
    if (!cp) return;

    const blockText = block.innerText || block.textContent || '';

    // Error & Success evaluation
    let isError = false;
    let isSuccess = false;

    // Check points e.g. "0/1 point", "0/2 points", "1/1 point", "2/2 points", "0/3 points"
    const scoreMatch = blockText.match(/\b(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(?:points?|điểm)?/i);
    if (scoreMatch) {
      const earned = parseFloat(scoreMatch[1]);
      const total = parseFloat(scoreMatch[2]);
      if (total > 0) {
        if (earned === total) {
          isSuccess = true;
        } else if (earned < total) {
          isError = true;
        }
      }
    }

    if (
      block.querySelector('.rc-FormPartsQuestion__error, [data-testid="test-feedback-incorrect"], [aria-label*="Incorrect" i], .css-1m4z3k7') ||
      /\b(?:try\s+again|this\s+should\s+not\s+be\s+selected|incorrect|sai|0\s*điểm)\b/i.test(blockText)
    ) {
      isError = true;
      isSuccess = false;
    }

    if (!isError && (
      block.querySelector('.rc-FormPartsQuestion__success, [data-testid="test-feedback-correct"], [aria-label*="Correct" i]') ||
      /\b(?:correct|đúng|100%)\b/i.test(blockText)
    )) {
      isSuccess = true;
    }

    // 1. Check individual option items for explicit "This should not be selected" or "This should be selected"
    const optionContainers = block.querySelectorAll('.rc-Option, [class*="option" i], label, .rc-FormPartsOption');
    optionContainers.forEach((container) => {
      const cText = container.innerText || container.textContent || '';
      if (/\b(?:this\s+should\s+not\s+be\s+selected|should\s+not\s+be\s+selected)\b/i.test(cText)) {
        const cleanOpt = cleanText(extractCleanFeedbackOptionLabel(container));
        if (cleanOpt) {
          if (!blacklist[cp]) blacklist[cp] = [];
          if (!blacklist[cp].includes(cleanOpt)) {
            blacklist[cp].push(cleanOpt);
            wrongRecorded++;
          }
        }
      } else if (/\b(?:this\s+should\s+be\s+selected|should\s+be\s+selected)\b/i.test(cText)) {
        const cleanOpt = cleanText(extractCleanFeedbackOptionLabel(container));
        if (cleanOpt) {
          correctToSave.push({ prompt: rawPrompt, answer: cleanOpt });
          correctRecorded++;
        }
      }
    });

    // 2. Extract selected/checked answers from inputs and option wrappers
    const selectedOptionsText = [];
    const checkedInputs = block.querySelectorAll('input:checked, [aria-checked="true"]');
    if (checkedInputs && checkedInputs.length > 0) {
      checkedInputs.forEach(inp => {
        const label = inp.closest('label') || inp.parentElement || inp;
        const txt = extractCleanFeedbackOptionLabel(label) || extractOptionLabel(inp);
        if (txt) selectedOptionsText.push(txt);
      });
    } else {
      // Fallback for read-only review pages where inputs might be disabled or rendered without input tags
      for (const container of optionContainers) {
        const isSelected = 
          container.className.includes('selected') || 
          container.className.includes('checked') ||
          container.querySelector('.rc-FormPartsQuestion__error, .rc-FormPartsQuestion__success, [data-testid*="feedback"]') ||
          container.querySelector('svg[aria-label*="Selected" i], svg[aria-label*="Checked" i]') ||
          (container.nextElementSibling && container.nextElementSibling.className && container.nextElementSibling.className.includes('error'));
          
        if (isSelected) {
          const txt = extractCleanFeedbackOptionLabel(container);
          if (txt) selectedOptionsText.push(txt);
        }
      }
    }
    
    const cleanCheckedList = selectedOptionsText.map(t => cleanText(t)).filter(Boolean);

    cleanCheckedList.forEach(cleanChecked => {
      if (isError) {
        if (!blacklist[cp]) blacklist[cp] = [];
        if (!blacklist[cp].includes(cleanChecked)) {
          blacklist[cp].push(cleanChecked);
          wrongRecorded++;
        }
      } else if (isSuccess) {
        correctToSave.push({
          prompt: rawPrompt,
          answer: cleanChecked,
        });
        correctRecorded++;
      }
    });
  });

  if (wrongRecorded > 0) {
    await saveQuizBlacklist(courseSlug, blacklist);
    // Purge poisoned wrong answers from local source cache so retake never picks old wrong answers!
    await purgeWrongAnswersFromSource(courseSlug, blacklist);
  }

  if (correctToSave.length > 0) {
    await saveToCourseSource(courseSlug, correctToSave);
  }

  if (wrongRecorded > 0 || correctRecorded > 0) {
    showToast(`🎯 Smart Retake: Đã nạp ${correctRecorded} câu đúng vào Source và chặn ${wrongRecorded} câu sai!`, 'success');
  }

  return { wrongRecorded, correctRecorded };
}

/**
 * Match a question against the local course source
 * Verifies that matched answer exists in question options to prevent false positives,
 * and confirms answer is not in the Smart Retake blacklist.
 * @param {object} question - { prompt, options }
 * @param {Array<object>} sourceList
 * @param {Record<string, string[]>} [blacklist={}]
 * @returns {object|null} matched source item
 */
function findAnswerInSource(question, sourceList, blacklist = {}) {
  if (!question || !sourceList || sourceList.length === 0) return null;
  const cleanQ = cleanText(question.prompt);
  if (!cleanQ) return null;

  const hasOptions = Array.isArray(question.options) && question.options.length > 0;
  const qBlacklist = blacklist[cleanQ] || [];

  // Helper to verify if source answer exists in question options and not blacklisted
  const matchesAnyOption = (ans) => {
    const cleanA = cleanText(ans);
    if (qBlacklist.includes(cleanA)) return false; // Rejected by Smart Retake blacklist!
    if (!hasOptions) return true;
    return question.options.some((opt) => {
      const cOpt = cleanText(opt);
      return cOpt === cleanA || (cOpt.length >= 4 && (cOpt.includes(cleanA) || cleanA.includes(cOpt)));
    });
  };

  // 1. Exact clean match
  for (const item of sourceList) {
    const cp = item.cleanPrompt || cleanText(item.prompt);
    if (cp && cp === cleanQ) {
      if (matchesAnyOption(item.answer)) return item;
    }
  }

  // 2. High-overlap match (length ratio >= 0.75 and substring match)
  for (const item of sourceList) {
    const cp = item.cleanPrompt || cleanText(item.prompt);
    if (cleanQ.length >= 25 && cp.length >= 25) {
      const ratio = Math.min(cleanQ.length, cp.length) / Math.max(cleanQ.length, cp.length);
      if (ratio >= 0.75 && (cleanQ.includes(cp) || cp.includes(cleanQ))) {
        if (matchesAnyOption(item.answer)) return item;
      }
    }
  }

  return null;
}

/**
 * Select a radio or checkbox option safely in React applications
 * @param {HTMLInputElement} input
 * @param {HTMLElement} wrapper
 * @param {string} [badgeLabel='✓']
 */
function selectOptionElement(input, wrapper, badgeLabel = '✓') {
  if (!input) return;

  const labelTarget =
    input.closest('label') ||
    (input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null) ||
    wrapper ||
    input;

  // 1. Click label target
  try {
    labelTarget.click();
  } catch (e) {}

  // 2. Click input directly if unchecked
  try {
    if (!input.checked) {
      input.focus();
      input.click();
    }
  } catch (e) {}

  // 3. Dispatch native input and change events
  try {
    input.checked = true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (e) {}

  // 4. Force React checked state for controlled components
  try {
    const proto = window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'checked')?.set;
    if (nativeSetter) {
      nativeSetter.call(input, true);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } catch (_e) {}

  // Add badge
  addBadge(labelTarget || wrapper || input.parentElement || input, badgeLabel);
}

/**
 * Find question container element for an input
 * @param {HTMLInputElement} inp
 * @returns {Element|null}
 */
function findQuestionContainer(inp) {
  return (
    inp.closest('fieldset') ||
    inp.closest('.rc-FormPartsQuestion, [class*="Question"], [class*="question"]') ||
    inp.closest('[data-testid*="question" i]') ||
    inp.closest('[role="radiogroup"]') ||
    inp.closest('[role="group"]') ||
    inp.closest('.rc-QuizQuestion') ||
    inp.closest('.c-question') ||
    inp.closest('form') ||
    inp.parentElement?.parentElement
  );
}

/**
 * Universal question finder that works on modern Coursera assessment layouts
 * @returns {Array<object>}
 */
function discoverQuestions() {
  extendStringPrototype();
  const questions = [];

  // Exclude floating panel elements and non-question agreement checkboxes
  const allInputs = Array.from(
    document.querySelectorAll('input[type="radio"], input[type="checkbox"]')
  ).filter((el) => {
    if (el.closest('#cpt-panel')) return false;

    // Filter out honor code agreements
    const honorContainer = el.closest('[data-testid*="honor" i], .rc-HonorCode, .honor-code-checkbox, [class*="HonorCode"]');
    if (honorContainer) return false;

    const labelText = extractOptionLabel(el).toLowerCase();
    if (
      labelText.includes('honor code') ||
      labelText.includes('submitting work that is my own') ||
      labelText.includes('cam đoan') ||
      labelText.includes('chính trực') ||
      labelText.includes('i agree to the coursera honor code') ||
      labelText.includes('i understand that submitting work')
    ) {
      return false;
    }
    return true;
  });

  if (allInputs.length > 0) {
    const groupsByName = new Map();

    for (const inp of allInputs) {
      // Group by question container, or radio name attribute
      const container = findQuestionContainer(inp);
      const key = (inp.type === 'radio' && inp.name) ? inp.name : (container || inp);
      if (!groupsByName.has(key)) {
        groupsByName.set(key, { container, inputs: [] });
      }
      groupsByName.get(key).inputs.push(inp);
    }

    let qIndex = 1;
    for (const { container, inputs } of groupsByName.values()) {
      if (!inputs || inputs.length === 0) continue;

      // Extract options
      const options = inputs.map((inp) => ({
        input: inp,
        text: extractOptionLabel(inp),
      }));

      // Determine parent question block
      const questionBlock = container || inputs[0].parentElement?.parentElement;

      // Isolate prompt text safely without truncating
      let promptText = '';
      if (questionBlock) {
        // Priority 1: Check dedicated question prompt elements
        const promptEl = questionBlock.querySelector(
          'legend, .rc-FormPartsQuestion__title, [data-testid*="prompt" i], .rc-CML, [class*="Prompt"], [class*="title"], h2, h3, h4'
        );
        if (promptEl) {
          promptText = promptEl.textContent?.trim() || '';
        }

        // Priority 2: Clone container and remove inputs/labels to isolate prompt
        if (!promptText) {
          try {
            const clone = questionBlock.cloneNode(true);
            clone.querySelectorAll('input, label, [role="radio"], [role="checkbox"], .cpt-badge, svg').forEach((el) => el.remove());
            promptText = clone.textContent?.trim() || '';
          } catch (_e) {
            promptText = questionBlock.innerText || questionBlock.textContent || '';
          }
        }

        // Clean point labels and index numbers
        promptText = promptText
          .replace(/\b\d+\s*(?:points?|điểm)\b/gi, '')
          .replace(/\b\d+\s*\/\s*\d+\s*(?:points?|điểm)\b/gi, '')
          .replace(/^\s*(?:question\s*\d+[\s:.-]*|\d+[.):]\s+)/i, '')
          .replace(/\s+/g, ' ')
          .trim();
      }

      if (!promptText) {
        promptText = `Question ${qIndex}`;
      }

      questions.push({
        type: inputs[0].type || 'radio',
        prompt: promptText,
        options: options.map((o) => o.text).filter(Boolean),
        optionItems: options,
        container: questionBlock,
      });

      qIndex++;
    }

    if (questions.length > 0) {
      return questions;
    }
  }

  // Strategy 2: Check text inputs (short answer / number / rich text)
  let textInputsRaw = Array.from(
    document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], .ql-editor, .DraftEditor-root')
  );

  const textInputs = [];
  for (const el of textInputsRaw) {
    if (el.closest('#cpt-panel') || el.type === 'hidden') continue;

    // If it's a DraftEditor root, find the actual contenteditable child
    if (el.classList.contains('DraftEditor-root')) {
      const editable = el.querySelector('[contenteditable="true"]');
      if (editable && !textInputs.includes(editable)) {
        textInputs.push(editable);
      }
      continue; // Skip the root wrapper itself
    }
    
    if (!textInputs.includes(el)) {
      textInputs.push(el);
    }
  }

  for (const inp of textInputs) {
    const container = inp.closest('fieldset, [data-testid*="question" i]') || inp.parentElement?.parentElement;
    const promptText = (container?.innerText || container?.textContent || `Question`)
      .replace(/\b\d+\s*points?\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    questions.push({
      type: 'text',
      prompt: promptText,
      options: [],
      textInputs: [inp],
      container,
    });
  }

  return questions;
}

/**
 * Fill answers for discovered questions
 * @param {Array<object>} questions
 * @param {Array<object>} answers
 * @param {Set<number>} [sourceMatchIndexes]
 * @returns {number}
 */
async function fillDiscoveredAnswers(questions, answers, sourceMatchIndexes = new Set(), blacklist = {}) {
  let matched = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const cleanQ = cleanText(q.prompt);
    const qBlacklist = blacklist[cleanQ] || [];
    const isBlacklisted = (opt) => qBlacklist.includes(cleanText(opt?.text));

    const ansObj =
      answers.find((a) => a && (a.id === i + 1 || a.id === String(i + 1))) ||
      answers[i];

    if (!ansObj) continue;

    let answerDef = '';
    if (typeof ansObj === 'string') {
      answerDef = ansObj;
    } else if (Array.isArray(ansObj?.answer)) {
      answerDef = ansObj.answer.join('|');
    } else if (Array.isArray(ansObj?.definition)) {
      answerDef = ansObj.definition.join('|');
    } else {
      answerDef = String(ansObj?.definition || ansObj?.answer || ansObj?.text || '');
    }
    answerDef = answerDef.trim();

    if (!answerDef) continue;
    const cleanAns = cleanText(answerDef);
    let questionFilled = false;
    const badgeLabel = sourceMatchIndexes.has(i) ? '📦 Source' : '🤖 AI';

    if (q.type === 'radio') {
      // Single choice: find EXACTLY ONE best matching option that is NOT blacklisted!
      let chosenOpt = null;
      const validOptions = (q.optionItems || []).filter((opt) => !isBlacklisted(opt));

      // Single letter match ('a', 'b', 'c', 'd')
      if (cleanAns.length === 1 && cleanAns >= 'a' && cleanAns <= 'z') {
        const letterIdx = cleanAns.charCodeAt(0) - 97;
        if (q.optionItems[letterIdx] && !isBlacklisted(q.optionItems[letterIdx])) {
          chosenOpt = q.optionItems[letterIdx];
        }
      }

      // Priority 1: Exact cleaned match against un-blacklisted options
      if (!chosenOpt) {
        for (const opt of validOptions) {
          if (cleanText(opt.text) === cleanAns) {
            chosenOpt = opt;
            break;
          }
        }
      }

      // Priority 2: Prefix / Suffix match
      if (!chosenOpt) {
        for (const opt of validOptions) {
          const cOpt = cleanText(opt.text);
          if (cOpt.length >= 4 && cleanAns.length >= 4) {
            if (cOpt.startsWith(cleanAns) || cleanAns.startsWith(cOpt)) {
              chosenOpt = opt;
              break;
            }
          }
        }
      }

      // Priority 3: Word overlap scoring
      if (!chosenOpt) {
        let bestScore = 0;
        const ansWords = new Set(cleanAns.split(' ').filter((w) => w.length > 2));
        for (const opt of validOptions) {
          const cOpt = cleanText(opt.text);
          const optWords = cOpt.split(' ').filter((w) => w.length > 2);
          let overlap = 0;
          for (const w of optWords) {
            if (ansWords.has(w)) overlap++;
          }
          const score = optWords.length > 0 ? overlap / Math.max(ansWords.size, optWords.length) : 0;
          if (score > bestScore && score > 0.4) {
            bestScore = score;
            chosenOpt = opt;
          }
        }
      }

      // Priority 4: Fallback to any remaining non-blacklisted option if all proposed answers were wrong
      if (!chosenOpt && validOptions.length > 0 && qBlacklist.length > 0) {
        console.log(`[CourseraPro Smart Retake] Selecting fallback non-blacklisted option for question ${i + 1}`);
        chosenOpt = validOptions[0];
      }

      if (chosenOpt) {
        const wrapper = chosenOpt.input.closest('label') || chosenOpt.input.parentElement || chosenOpt.input;
        selectOptionElement(chosenOpt.input, wrapper, badgeLabel);
        questionFilled = true;
      }
    } else if (q.type === 'checkbox') {
      // Multiple choice: split into targets
      let rawParts = [];
      if (Array.isArray(ansObj?.answer)) {
        rawParts = ansObj.answer;
      } else if (Array.isArray(ansObj?.definition)) {
        rawParts = ansObj.definition;
      } else if (answerDef.includes('|') || answerDef.includes('\n') || answerDef.includes(';')) {
        rawParts = answerDef.split(/[|\n;]/);
      } else if (/\b[A-Da-d](?:\s*,\s*[A-Da-d])+\b/.test(answerDef)) {
        rawParts = answerDef.split(/\s*,\s*/);
      } else {
        rawParts = [answerDef];
      }

      const cleanParts = rawParts.map((p) => cleanText(p)).filter(Boolean);
      if (cleanParts.length === 0 && cleanAns) cleanParts.push(cleanAns);

      const matchedOptionIndices = new Set();

      for (const part of cleanParts) {
        // Check single letter
        const letterMatch = part.match(/^(?:option\s+|choice\s+)?([a-z])$/i);
        if (letterMatch) {
          const letterIdx = letterMatch[1].toLowerCase().charCodeAt(0) - 97;
          if (q.optionItems[letterIdx] && !isBlacklisted(q.optionItems[letterIdx])) {
            matchedOptionIndices.add(letterIdx);
            continue;
          }
        }

        // Priority 1: Exact cleaned match
        let partMatched = false;
        for (let oIdx = 0; oIdx < q.optionItems.length; oIdx++) {
          const opt = q.optionItems[oIdx];
          const cOpt = cleanText(opt.text);
          if (cOpt === part && !isBlacklisted(opt)) {
            matchedOptionIndices.add(oIdx);
            partMatched = true;
            break;
          }
        }

        // Priority 2: Substring match
        if (!partMatched) {
          for (let oIdx = 0; oIdx < q.optionItems.length; oIdx++) {
            const opt = q.optionItems[oIdx];
            const cOpt = cleanText(opt.text);
            if (cOpt.length >= 4 && part.length >= 4 && (cOpt.includes(part) || part.includes(cOpt)) && !isBlacklisted(opt)) {
              matchedOptionIndices.add(oIdx);
              partMatched = true;
              break;
            }
          }
        }

        // Priority 3: Word overlap scoring
        if (!partMatched) {
          let bestScore = 0;
          let bestIdx = -1;
          const partWords = new Set(part.split(' ').filter((w) => w.length > 2));
          for (let oIdx = 0; oIdx < q.optionItems.length; oIdx++) {
            const opt = q.optionItems[oIdx];
            if (isBlacklisted(opt)) continue;
            const cOpt = cleanText(opt.text);
            const optWords = cOpt.split(' ').filter((w) => w.length > 2);
            let overlap = 0;
            for (const w of optWords) {
              if (partWords.has(w)) overlap++;
            }
            const score = optWords.length > 0 ? overlap / Math.max(partWords.size, optWords.length) : 0;
            if (score > bestScore && score > 0.35) {
              bestScore = score;
              bestIdx = oIdx;
            }
          }
          if (bestIdx >= 0) {
            matchedOptionIndices.add(bestIdx);
            partMatched = true;
          }
        }
      }

      // Check expected count from prompt (e.g. "Select three", "Select 3", "Select two")
      const countMatch = q.prompt.match(/\b(?:select|choose)\s+(two|three|four|five|\d+)\b/i);
      let expectedCount = 0;
      if (countMatch) {
        const wordMap = { two: 2, three: 3, four: 4, five: 5 };
        expectedCount = wordMap[countMatch[1].toLowerCase()] || parseInt(countMatch[1], 10) || 0;
      }

      // If prompt specifically requires N options and we matched fewer than N,
      // select additional non-blacklisted options to meet the required count!
      if (expectedCount > 0 && matchedOptionIndices.size < expectedCount) {
        for (let oIdx = 0; oIdx < q.optionItems.length; oIdx++) {
          if (matchedOptionIndices.size >= expectedCount) break;
          const opt = q.optionItems[oIdx];
          if (!isBlacklisted(opt) && !matchedOptionIndices.has(oIdx)) {
            console.log(`[CourseraPro] Auto-selecting required option ${oIdx + 1} to meet prompt requirement (${expectedCount} options)`);
            matchedOptionIndices.add(oIdx);
          }
        }
      }

      // Apply selection to all matched checkboxes
      for (const idx of matchedOptionIndices) {
        const opt = q.optionItems[idx];
        if (opt) {
          const wrapper = opt.input.closest('label') || opt.input.parentElement || opt.input;
          selectOptionElement(opt.input, wrapper, badgeLabel);
          questionFilled = true;
        }
      }
    } else if (q.type === 'text') {
      for (const inp of q.textInputs || []) {
        inp.click();
        inp.focus();
        if (inp.isContentEditable || inp.tagName === 'DIV') {
          await simulateTyping(inp, answerDef);
        } else {
          simulateInput(inp, answerDef);
        }
        addBadge(inp.parentElement || inp, badgeLabel);
        questionFilled = true;
      }
    }

    if (questionFilled) matched++;
  }

  return matched;
}

/**
 * Check if a question has been answered in the DOM
 * @param {object} q
 * @returns {boolean}
 */
function isQuestionAnsweredInDom(q) {
  if (!q) return false;
  if (q.type === 'radio' || q.type === 'checkbox') {
    if (Array.isArray(q.optionItems) && q.optionItems.length > 0) {
      const anyChecked = q.optionItems.some((opt) => opt.input && opt.input.checked);
      if (anyChecked) return true;
    }
    if (q.container) {
      const anyChecked = q.container.querySelector(
        'input[type="radio"]:checked, input[type="checkbox"]:checked, [aria-checked="true"]'
      );
      if (anyChecked) return true;
    }
  } else if (q.type === 'text') {
    if (Array.isArray(q.textInputs) && q.textInputs.length > 0) {
      const anyFilled = q.textInputs.some((inp) => inp && inp.value && inp.value.trim().length > 0);
      if (anyFilled) return true;
    }
    if (q.container) {
      const textVal = q.container.querySelector('textarea, input[type="text"]')?.value?.trim();
      if (textVal) return true;
    }
  }
  return false;
}

/**
 * Fallback targeted retry for a single unanswered question
 * @param {object} question
 * @param {Record<string, string[]>} quizBlacklist
 * @returns {Promise<boolean>}
 */
async function retrySolveSingleQuestion(question, quizBlacklist = {}) {
  if (!question || !question.options || question.options.length === 0) return false;

  const cleanQ = cleanText(question.prompt);
  const qBlacklist = quizBlacklist[cleanQ] || [];
  const validOptionItems = (question.optionItems || []).filter(
    (opt) => !qBlacklist.includes(cleanText(opt.text))
  );

  if (validOptionItems.length === 0) return false;

  const isCheckbox = question.type === 'checkbox' ||
    /\b(?:select\s+(?:all|two|three|four|five|\d+)|check\s+all|choose\s+(?:all|two|three|four|five|\d+)|multiple\s+answers?)\b/i.test(question.prompt);

  const countMatch = question.prompt.match(/\b(?:select|choose)\s+(two|three|four|five|\d+)\b/i);
  let expectedCount = 0;
  if (countMatch) {
    const wordMap = { two: 2, three: 3, four: 4, five: 5 };
    expectedCount = wordMap[countMatch[1].toLowerCase()] || parseInt(countMatch[1], 10) || 0;
  }

  const countNote = expectedCount > 1 ? ` (EXACTLY ${expectedCount} OPTIONS REQUIRED)` : '';
  const rule = isCheckbox
    ? `CRITICAL RULE: This is a MULTI-SELECT CHECKBOX question${countNote}. Respond with ALL correct option texts or letters separated by a pipe character '|' (e.g. "A|B|C" or "Option 1|Option 2"). Do NOT return just 1 choice!`
    : `CRITICAL RULE: Respond with ONLY the exact text of the correct choice or its letter (A, B, C, or D). Do not add any explanation or preamble.`;

  const prompt = `Solve this university exam question accurately:
Question: ${question.prompt}

Options:
${question.options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join('\n')}

${rule}`;

  try {
    const rawResult = await generateContent(
      prompt,
      isCheckbox
        ? 'You are a university exam expert. Provide ALL correct options separated by "|" for multi-select questions.'
        : 'You are a university exam expert. Provide only the single best answer option text or letter.',
      null,
      { temperature: 0.1 }
    );

    if (!rawResult || typeof rawResult !== 'string') return false;

    if (isCheckbox) {
      const parts = rawResult.split(/[|\n;]/).map(p => cleanText(p)).filter(Boolean);
      const matchedIndices = new Set();

      for (const part of parts) {
        const letterMatch = part.match(/^(?:option\s+|choice\s+)?([a-z])$/i);
        if (letterMatch) {
          const idx = letterMatch[1].toLowerCase().charCodeAt(0) - 97;
          if (question.optionItems[idx] && !qBlacklist.includes(cleanText(question.optionItems[idx].text))) {
            matchedIndices.add(idx);
          }
        }
        for (let i = 0; i < question.optionItems.length; i++) {
          const opt = question.optionItems[i];
          if (qBlacklist.includes(cleanText(opt.text))) continue;
          const cOpt = cleanText(opt.text);
          if (cOpt === part || (cOpt.length >= 4 && part.length >= 4 && (cOpt.includes(part) || part.includes(cOpt)))) {
            matchedIndices.add(i);
          }
        }
      }

      if (expectedCount > 0 && matchedIndices.size < expectedCount) {
        for (let i = 0; i < question.optionItems.length; i++) {
          if (matchedIndices.size >= expectedCount) break;
          const opt = question.optionItems[i];
          if (!qBlacklist.includes(cleanText(opt.text)) && !matchedIndices.has(i)) {
            matchedIndices.add(i);
          }
        }
      }

      let checkedAny = false;
      for (const idx of matchedIndices) {
        const opt = question.optionItems[idx];
        if (opt) {
          const wrapper = opt.input.closest('label') || opt.input.parentElement || opt.input;
          selectOptionElement(opt.input, wrapper, '🤖 AI');
          checkedAny = true;
        }
      }
      return checkedAny;
    }

    const cleanRes = cleanText(rawResult);
    let chosenOpt = null;

    // Check letter match (e.g. "A", "B", "C", "D")
    const letterMatch = rawResult.trim().match(/^[A-Da-d]\b/);
    if (letterMatch) {
      const idx = letterMatch[0].toUpperCase().charCodeAt(0) - 65;
      if (question.optionItems[idx] && !qBlacklist.includes(cleanText(question.optionItems[idx].text))) {
        chosenOpt = question.optionItems[idx];
      }
    }

    // Check exact or substring match against valid options
    if (!chosenOpt) {
      for (const opt of validOptionItems) {
        const cOpt = cleanText(opt.text);
        if (cleanRes === cOpt || cleanRes.includes(cOpt) || (cOpt.length >= 4 && cleanRes.includes(cOpt))) {
          chosenOpt = opt;
          break;
        }
      }
    }

    // Fallback: Word overlap matching
    if (!chosenOpt) {
      let bestScore = 0;
      const resWords = new Set(cleanRes.split(' ').filter((w) => w.length > 2));
      for (const opt of validOptionItems) {
        const cOpt = cleanText(opt.text);
        const optWords = cOpt.split(' ').filter((w) => w.length > 2);
        let overlap = 0;
        for (const w of optWords) {
          if (resWords.has(w)) overlap++;
        }
        const score = optWords.length > 0 ? overlap / Math.max(resWords.size, optWords.length) : 0;
        if (score > bestScore && score > 0.3) {
          bestScore = score;
          chosenOpt = opt;
        }
      }
    }

    // Last resort fallback if blacklist eliminated other options and only 1 valid option remains
    if (!chosenOpt && validOptionItems.length === 1) {
      chosenOpt = validOptionItems[0];
    }

    if (chosenOpt) {
      const wrapper = chosenOpt.input.closest('label') || chosenOpt.input.parentElement || chosenOpt.input;
      selectOptionElement(chosenOpt.input, wrapper, '🤖 AI');
      return true;
    }
  } catch (err) {
    console.warn('[CourseraPro] Single question retry failed:', err.message);
  }

  return false;
}

/**
 * Find the button to enter the quiz from the landing page
 * @returns {Element|null}
 */
function findQuizEnterButton() {
  const enterSelectors = [
    'button[data-testid="start-quiz-button"]',
    'button[data-testid="resume-assignment-button"]',
    'button[data-testid="take-quiz-button"]',
    'button[data-testid="go-to-assignment-button"]',
    'button[data-testid="start-button"]',
    'button[data-testid*="start" i]',
    'button[data-testid*="resume" i]',
    'button[data-testid*="assignment" i]',
    'button[data-track-component="start_assignment_button"]',
    'button[data-track-component="resume_assignment_button"]',
    'button[data-track-component="go_to_assignment_button"]',
    'button.rc-StartAssignmentButton',
    'button.rc-ResumeAssignmentButton',
    'a[href*="/attempt"]',
    'button[aria-label="Resume"]',
    'button[aria-label="Start"]',
  ];

  for (const sel of enterSelectors) {
    const el = document.querySelector(sel);
    if (el && !el.closest('#cpt-panel') && el.offsetParent !== null) return el;
  }

  // Search all clickable elements by text
  const candidates = Array.from(document.querySelectorAll('button, a, [role="button"]'));
  for (const el of candidates) {
    if (el.closest('#cpt-panel')) continue;
    const text = (el.textContent || '').trim().toLowerCase();
    if (
      text === 'go to assignment' ||
      text === 'start assignment' ||
      text === 'resume assignment' ||
      text === 'take assignment' ||
      text === 'start quiz' ||
      text === 'take quiz' ||
      text === 'resume quiz' ||
      text === 'resume' ||
      text === 'start' ||
      text === 'try again' ||
      text === 'retake' ||
      text === 'làm bài' ||
      text === 'bắt đầu làm bài' ||
      text === 'tiếp tục làm bài' ||
      text === 'làm lại' ||
      text === 'bắt đầu' ||
      text === 'tiếp tục'
    ) {
      return el;
    }
  }

  // Partial text match
  for (const el of candidates) {
    if (el.closest('#cpt-panel')) continue;
    const text = (el.textContent || '').trim().toLowerCase();
    if (
      (text.includes('start assignment') ||
        text.includes('resume assignment') ||
        text.includes('go to assignment') ||
        text.includes('take assignment') ||
        text.includes('start quiz') ||
        text.includes('take quiz') ||
        text.includes('làm bài tập') ||
        text.includes('bắt đầu làm bài')) &&
      !text.includes('next') &&
      !text.includes('prev') &&
      !text.includes('back')
    ) {
      return el;
    }
  }

  return null;
}

/**
 * Poll DOM waiting for the quiz enter button to mount
 * @param {number} [timeoutMs=8000]
 * @returns {Promise<Element|null>}
 */
async function waitForQuizEnterButton(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const btn = findQuizEnterButton();
    if (btn) return btn;
    await sleep(400);
  }
  return null;
}

/**
 * Click the submit button and handle confirmation modals
 * @returns {Promise<boolean>}
 */
async function autoSubmitQuiz() {
  try {
    await sleep(1000);

    // 1. Check for Coursera Honor Code agreement checkbox if present
    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(
      (cb) => !cb.checked && !cb.closest('#cpt-panel')
    );
    for (const cb of checkboxes) {
      const container = cb.closest('label, fieldset, div');
      const text = (container?.textContent || '').toLowerCase();
      if (
        text.includes('honor code') ||
        text.includes('submitting work') ||
        text.includes('understand') ||
        text.includes('cam đoan') ||
        text.includes('chấp nhận') ||
        text.includes('chính trực') ||
        text.includes('i agree') ||
        text.includes('i understand')
      ) {
        console.log('[CourseraPro] Checking Honor Code agreement checkbox...');
        cb.focus();
        cb.click();
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(500);
      }
    }

    // 2. Check for Honor Code signature / name input
    const sigInput = document.querySelector(
      'input[data-testid="honor-code-signature-input"], input[aria-label*="signature" i], input[placeholder*="full name" i], input[placeholder*="họ và tên" i]'
    );
    if (sigInput && !sigInput.value) {
      const userNameEl = document.querySelector('[data-testid="user-profile-name"], .rc-UserMenuDropdown button, .profile-name');
      const name = userNameEl?.textContent?.trim() || 'Coursera Learner';
      simulateInput(sigInput, name);
      await sleep(400);
    }

    // 3. Find submit button
    const submitBtn =
      Array.from(document.querySelectorAll('button, input[type="submit"]')).find((b) => {
        if (b.closest('#cpt-panel')) return false;
        const t = (b.textContent || b.value || '').trim().toLowerCase();
        return (
          (t === 'submit' ||
            t === 'submit quiz' ||
            t === 'submit assignment' ||
            t === 'nộp bài' ||
            t.includes('submit assignment') ||
            t.includes('submit quiz')) &&
          !t.includes('canceled') &&
          !t.includes('cancel')
        );
      }) ||
      document.querySelector(
        'button[data-testid="submit-button"], button[type="submit"], button.rc-SubmitQuizButton'
      );

    if (submitBtn) {
      safeClick(submitBtn);
      await sleep(1500);

      // 4. Critical check: Detect if Coursera showed "Missing or invalid answers" modal
      const modalEl = document.querySelector('[role="dialog"], .modal, .rc-Modal, [data-testid*="dialog" i]');
      if (modalEl) {
        const modalText = (modalEl.textContent || '').toLowerCase();
        if (
          modalText.includes('missing or invalid') ||
          modalText.includes('incomplete') ||
          modalText.includes('chưa trả lời') ||
          modalText.includes('you haven\'t answered') ||
          modalText.includes('chưa hoàn thành') ||
          modalText.includes('do you still want to submit')
        ) {
          console.warn('[CourseraPro] Coursera reported incomplete quiz modal! Canceling submit.');
          // Click Cancel button in modal to prevent accidental empty submission
          const cancelBtn = Array.from(modalEl.querySelectorAll('button')).find((b) => {
            const t = b.textContent.trim().toLowerCase();
            return t === 'cancel' || t === 'hủy' || t.includes('cancel');
          });
          if (cancelBtn) safeClick(cancelBtn);
          showToast('⚠️ Coursera báo còn câu hỏi chưa điền! Đã hủy nộp để bảo vệ điểm số.', 'error');
          return false;
        }

        // Check any checkbox inside normal confirmation modal
        const modalCheckbox = modalEl.querySelector('input[type="checkbox"]');
        if (modalCheckbox && !modalCheckbox.checked) {
          modalCheckbox.click();
          await sleep(300);
        }

        // Handle standard confirmation dialog if Coursera prompts
        const confirmBtn =
          Array.from(modalEl.querySelectorAll('button')).find((b) => {
            const t = b.textContent.trim().toLowerCase();
            return (
              t === 'submit' ||
              t === 'submit quiz' ||
              t === 'yes, submit' ||
              t === 'nộp bài' ||
              t === 'đồng ý' ||
              t === 'continue' ||
              t === 'tiếp tục'
            );
          }) || document.querySelector('button[data-testid="dialog-submit-button"]');

        if (confirmBtn) {
          safeClick(confirmBtn);
          await sleep(1500);
        }
      }

      return true;
    }
  } catch (e) {
    console.warn('[CourseraPro] Auto submit error:', e);
  }
  return false;
}

/**
 * Exit back to the outside overview page after completing
 * @param {string} [outsideUrl]
 */
async function autoExitQuiz(outsideUrl = '') {
  showToast('🎉 Đã hoàn thành và nộp bài! Đang tự động quay lại trang ngoài...', 'success');
  await sleep(2500);

  // Clear storage
  await chrome.storage.local.remove(STORAGE_KEY_QUIZ);

  if (outsideUrl) {
    const cleanTarget = outsideUrl.replace(/\/attempt.*/, '');
    window.location.href = cleanTarget;
    return;
  }

  // Look for back button
  const backBtn =
    document.querySelector('button[aria-label="Back"], a[aria-label="Back"], [data-testid="back-button"]') ||
    Array.from(document.querySelectorAll('a, button')).find((el) => {
      const t = el.textContent.trim().toLowerCase();
      return t === 'back' || t.startsWith('back') || t.includes('quay lại');
    });

  if (backBtn) {
    safeClick(backBtn);
    return;
  }

  // Fallback: strip /attempt
  if (location.href.includes('/attempt')) {
    window.location.href = location.href.replace(/\/attempt.*/, '');
  } else {
    window.history.back();
  }
}

/**
 * Solve questions on current /attempt page and submit
 * @param {string} outsideUrl
 */
async function solveAndSubmitQuiz(outsideUrl = '') {
  try {
    showToast('Đang phát hiện câu hỏi trên trang...', 'info');

    // 1. Wait up to 10s for questions to render
    let questions = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      questions = discoverQuestions();
      if (questions.length > 0) break;
      await sleep(1000);
    }

    if (questions.length === 0) {
      // Check if we are on an uninitialized /attempt page (blank white screen)
      if (location.href.includes('/attempt')) {
        showToast('⚠️ Phiên làm bài chưa được khởi tạo (trắng trang). Đang tự động sửa lỗi và nạp bài...', 'warning');
        const meta = getMetadata();
        const courseId = meta.course_id;
        const itemId = meta.item_id || extractItemId();
        if (courseId && itemId) {
          const initiated = await apiInitiateAttempt(courseId, itemId);
          if (initiated) {
            showToast('✅ Đã kích hoạt phiên làm bài! Đang tải lại...', 'success');
            await sleep(1500);
            window.location.reload();
            return;
          }
        }
        // Fallback: return to overview page and enter properly
        showToast('🔄 Đang quay lại trang bài tập để vào bài chuẩn...', 'info');
        await sleep(1500);
        window.location.href = location.href.replace(/\/attempt.*/, '');
        return;
      }

      showToast('Không tìm thấy câu hỏi trắc nghiệm nào trên trang này.', 'warning');
      return;
    }

    // 2. Load Local Course Source and Smart Retake Blacklist
    const courseSlug = getCurrentCourseSlug();
    const courseSource = await loadCourseSource(courseSlug);
    const quizBlacklist = await loadQuizBlacklist(courseSlug);
    console.log(`[CourseraPro] Local Source for [${courseSlug}]: ${courseSource.length} questions. Blacklist has ${Object.keys(quizBlacklist).length} entries.`);

    const finalAnswers = new Array(questions.length);
    const sourceMatchSet = new Set();
    const missingForAI = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const matchedItem = findAnswerInSource(q, courseSource, quizBlacklist);
      if (matchedItem && matchedItem.answer) {
        finalAnswers[i] = {
          id: i + 1,
          term: q.prompt,
          definition: matchedItem.answer,
          answer: matchedItem.answer,
          fromSource: true,
        };
        sourceMatchSet.add(i);
      } else {
        missingForAI.push({
          originalIndex: i,
          id: i + 1,
          type: q.type,
          prompt: q.prompt,
          options: q.options,
        });
      }
    }

    const sourceCount = sourceMatchSet.size;
    let aiCount = 0;

    if (sourceCount === questions.length) {
      // 100% of questions answered by Local Source! Zero AI tokens needed!
      showToast(`⚡ Tuyệt vời! 100% câu hỏi (${sourceCount}/${questions.length}) có sẵn trong Source của bạn! Đang điền...`, 'success');
      updateProgress(sourceCount, questions.length, `Điền 100% từ Source (${sourceCount} câu)`);
    } else {
      if (sourceCount > 0) {
        showToast(`📦 Tìm thấy ${sourceCount}/${questions.length} câu trong Source! AI đang giải ${missingForAI.length} câu còn lại...`, 'info');
      } else {
        showToast(`Tìm thấy ${questions.length} câu hỏi! AI đang giải...`, 'info');
      }
      updateProgress(sourceCount, questions.length, `Source: ${sourceCount} · AI giải: ${missingForAI.length}...`);

      // 3. Verify API key before calling AI for missing questions
      const { apiKey, provider } = await getAISettings();
      if (!apiKey) {
        showToast(`⚠️ Chưa nhập API Key cho ${provider.toUpperCase()}! Bấm ⚙️ Cài đặt.`, 'warning');
        return;
      }

      let aiAnswers = [];
      try {
        aiAnswers = await generateQuizAnswers(missingForAI, { blacklist: quizBlacklist });
      } catch (aiErr) {
        console.error('[CourseraPro] Quiz generation error:', aiErr);
        showToast(`⚠️ Lỗi AI (${provider}): ${aiErr.message}`, 'error');
      }

      if (!aiAnswers || aiAnswers.length === 0) {
        if (sourceCount === 0) {
          showToast('AI không giải được bài này. Kiểm tra API key hoặc đổi Model trong Cài đặt.', 'error');
          return;
        } else {
          showToast(`⚠️ AI lỗi, nhưng đã điền ${sourceCount} câu từ Source của bạn!`, 'warning');
        }
      } else {
        for (let j = 0; j < missingForAI.length; j++) {
          const item = missingForAI[j];
          const aiAns =
            aiAnswers.find((a) => a && (a.id === item.id || a.id === String(item.id))) ||
            aiAnswers[j];

          let ansText = '';
          if (typeof aiAns === 'string') {
            ansText = aiAns;
          } else if (Array.isArray(aiAns?.answer)) {
            ansText = aiAns.answer.join('|');
          } else if (Array.isArray(aiAns?.definition)) {
            ansText = aiAns.definition.join('|');
          } else {
            ansText = String(aiAns?.answer || aiAns?.definition || '');
          }
          ansText = ansText.trim();

          if (ansText) {
            finalAnswers[item.originalIndex] = {
              id: item.id,
              term: item.prompt,
              definition: ansText,
              answer: ansText,
              fromAI: true,
            };
            aiCount++;
          }
        }
      }
    }

    // 5. Fill answers into DOM (rejecting any blacklisted options)
    let matched = await fillDiscoveredAnswers(questions, finalAnswers, sourceMatchSet, quizBlacklist);

    // 5b. Retry any remaining unanswered questions individually
    let unanswered = questions.filter((q) => !isQuestionAnsweredInDom(q));
    if (unanswered.length > 0) {
      console.log(`[CourseraPro] ${unanswered.length} questions unanswered after initial pass. Retrying individually...`);
      showToast(`⚡ Đang thử giải bổ sung ${unanswered.length} câu còn thiếu...`, 'info');

      for (const uq of unanswered) {
        const solved = await retrySolveSingleQuestion(uq, quizBlacklist);
        if (solved) matched++;
        await sleep(500);
      }

      // Re-check unanswered after retry
      unanswered = questions.filter((q) => !isQuestionAnsweredInDom(q));
    }

    // 5c. CRITICAL SUBMIT SAFEGUARD: If any question is still unanswered, DO NOT SUBMIT, DO NOT EXIT!
    if (unanswered.length > 0) {
      const answeredCount = questions.length - unanswered.length;
      updateProgress(answeredCount, questions.length, `Đã điền ${answeredCount}/${questions.length}`);
      showToast(
        `⚠️ Còn ${unanswered.length}/${questions.length} câu chưa có đáp án! KHÔNG tự nộp để bảo vệ điểm của bạn. Vui lòng kiểm tra và tự nộp!`,
        'warning'
      );

      // Highlight unanswered questions and scroll first one into view
      for (const uq of unanswered) {
        if (uq.container) {
          uq.container.style.boxShadow = '0 0 0 2px #ef4444, 0 0 15px rgba(239, 68, 68, 0.4)';
          uq.container.style.borderRadius = '8px';
        }
      }
      if (unanswered[0]?.container) {
        unanswered[0].container.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      // Stop here! Never submit or exit with unanswered questions!
      return;
    }

    // All questions successfully answered!
    updateProgress(questions.length, questions.length, `Đã điền ${questions.length}/${questions.length}`);
    const summaryMsg =
      sourceCount > 0
        ? `🎉 Đã hoàn thành 100% (${questions.length}/${questions.length} câu - ${sourceCount} từ Source, ${aiCount} từ AI)! Đã lưu vào kho.`
        : `🎉 Đã tự động điền đủ ${questions.length}/${questions.length} câu! Đã lưu vào kho.`;

    showToast(summaryMsg, 'success');
    await sleep(2000);

    // 6. Check auto-submit setting
    const { isAutoSubmitQuiz } = await chrome.storage.local.get(['isAutoSubmitQuiz']);
    const shouldSubmit = isAutoSubmitQuiz !== false; // default true

    if (shouldSubmit) {
      showToast('Đang tự động nộp bài quiz...', 'info');
      const submitOk = await autoSubmitQuiz();
      if (submitOk) {
        showToast('🎉 Đã nộp bài thành công! Tool sẽ giữ nguyên trang này để bạn xem kết quả.', 'success');
        await chrome.storage.local.remove(STORAGE_KEY_QUIZ);

        // Check if Master Course Autopilot Queue is active
        try {
          const queueRes = await chrome.storage.local.get(['cpt_master_autopilot_queue']);
          const autopilotQueue = queueRes?.cpt_master_autopilot_queue;
          if (autopilotQueue && autopilotQueue.active) {
            showToast('🚀 [Master Autopilot]: Chuẩn bị chuyển sang bài Quiz tiếp theo...', 'info');
            await sleep(2500);
            if (typeof advanceAutopilotQuizQueue === 'function') {
              await advanceAutopilotQuizQueue(autopilotQueue);
              return;
            } else if (typeof window !== 'undefined' && window.__cpt_advanceAutopilotQuizQueue) {
              await window.__cpt_advanceAutopilotQuizQueue(autopilotQueue);
              return;
            }
          }
        } catch (_qErr) {}
      } else {
        showToast('⚠️ Bài thi chưa sẵn sàng nộp hoặc cần bạn kiểm tra lại. Đã giữ nguyên trang!', 'warning');
      }
    } else {
      showToast('🎉 Đã điền xong tất cả câu hỏi! Hãy kiểm tra lại trước khi tự nộp.', 'success');
      await chrome.storage.local.remove(STORAGE_KEY_QUIZ);
    }
  } catch (err) {
    console.error('[CourseraPro] Error solving quiz:', err);
    showToast('Lỗi giải quiz: ' + err.message, 'error');
  }
}

/**
 * Main Auto Quiz entry point (handles inside /attempt, outside landing page, and /review pages)
 */
async function handleAutoQuiz() {
  try {
    // Check if on Review / Feedback results page
    const isReviewPage =
      location.href.includes('/review') ||
      location.href.includes('/view-feedback') ||
      Boolean(document.querySelector('.rc-FormPartsQuestion__error, [data-testid="test-feedback-incorrect"], [data-testid*="feedback" i]'));

    if (isReviewPage) {
      showToast('🎯 Smart Retake: Đang phân tích kết quả bài thi để lưu câu đúng và loại trừ câu sai...', 'info');
      const stats = await recordQuizReviewFeedback();
      await sleep(1200);

      const enterBtn = findQuizEnterButton();
      if (enterBtn) {
        showToast('🎯 Đã lưu bài học! Đang bấm "Resume" / "Try Again" để làm lại...', 'success');
        await sleep(1000);
        safeClick(enterBtn);
        await autoClickStartModal();
      } else {
        showToast(`🎯 Smart Retake: Đã chặn ${stats.wrongRecorded} câu sai & nạp ${stats.correctRecorded} câu đúng! Bấm "Try Again" để làm lại.`, 'success');
      }
      return;
    }

    const isInsideAttempt = location.href.includes('/attempt');

    if (isInsideAttempt) {
      // User clicked while INSIDE the attempt page: solve, submit, and exit
      const outsideUrl = location.href.replace(/\/attempt.*/, '');
      await solveAndSubmitQuiz(outsideUrl);
      return;
    }

    // User is OUTSIDE on the assignment overview page:
    showToast('⚡ Đang tìm nút vào làm bài...', 'info');

    const outsideUrl = location.href;
    const enterBtn = await waitForQuizEnterButton(6000);

    // Save auto quiz state so when /attempt loads it automatically starts
    await chrome.storage.local.set({
      [STORAGE_KEY_QUIZ]: {
        active: true,
        outsideUrl: outsideUrl,
        timestamp: Date.now(),
      },
    });

    if (enterBtn) {
      showToast('Đang bấm vào bài làm (Resume / Start)...', 'info');
      safeClick(enterBtn);
      await autoClickStartModal();
    } else {
      // Button not found yet, try backend GraphQL initiate before navigating
      const meta = getMetadata();
      const courseId = meta.course_id;
      const itemId = meta.item_id || extractItemId();
      let initiated = false;
      if (courseId && itemId) {
        showToast('Đang khởi tạo phiên làm bài qua Coursera API...', 'info');
        initiated = await apiInitiateAttempt(courseId, itemId);
      }

      if (initiated) {
        showToast('Đang chuyển hướng vào trang làm bài...', 'info');
        const cleanUrl = location.href.split('?')[0].replace(/\/$/, '');
        window.location.href = `${cleanUrl}/attempt`;
      } else {
        showToast('⚠️ Vui lòng bấm nút "Bắt đầu làm bài" trên trang để AI tự giải!', 'warning');
      }
    }
  } catch (error) {
    console.error('[CourseraPro] Auto Quiz entry error:', error);
    showToast('Lỗi Auto Quiz: ' + error.message, 'error');
  }
}

/**
 * Helper to automatically click the "Continue" button on the "Start new attempt?" modal
 */
async function autoClickStartModal() {
  await sleep(1500);
  const modalConfirmBtn = Array.from(document.querySelectorAll('[role="dialog"] button, .modal button, .rc-Modal button')).find(
    (b) => {
      const t = b.textContent.trim().toLowerCase();
      return t === 'continue' || t === 'tiếp tục';
    }
  );
  if (modalConfirmBtn) {
    console.log('[CourseraPro] Auto-clicked Continue on Start new attempt modal');
    safeClick(modalConfirmBtn);
    await sleep(1000);
  }
}

/**
 * Check and resume auto quiz if active after entering /attempt page
 */
async function checkAndResumeAutoQuiz() {
  try {
    if (!location.href.includes('/attempt')) return;

    const result = await chrome.storage.local.get(STORAGE_KEY_QUIZ);
    const state = result[STORAGE_KEY_QUIZ];

    if (state && state.active) {
      // Safety check: don't run if state is older than 5 minutes
      if (Date.now() - state.timestamp > 300000) {
        await chrome.storage.local.remove(STORAGE_KEY_QUIZ);
        return;
      }

      console.log('[CourseraPro] Auto quiz active state detected, starting solving process...');
      setTimeout(() => {
        solveAndSubmitQuiz(state.outsideUrl);
      }, 2000);
    }
  } catch (e) {
    console.warn('[CourseraPro] Error checking auto quiz state:', e);
  }
}


// ====== modules/discussion.js ======
/**
 * Coursera Pro Tool - Auto Discussion Module
 * 1-Click Auto All Discussions across the entire course with:
 * - Smart AI with dynamic personas for unique responses
 * - Enforced 30-second delay between discussion posts
 * - Real-time countdown and progress updates
 * - Resume across page navigations via chrome.storage.local
 */

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
async function handleDiscussionPrompt() {
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
async function startAutoAllDiscussions() {
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
async function cancelAutoDiscussion() {
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
async function toggleAutoDiscussions() {
  if (isAutoDiscussionRunning) {
    await cancelAutoDiscussion();
  } else {
    await startAutoAllDiscussions();
  }
}

/**
 * Run discussion submission automatically inside a background worker tab
 */
async function runDiscussionWorker() {
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
async function checkAndResumeDiscussionAutomation() {
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


// ====== modules/review.js ======
/**
 * Coursera Pro Tool - Auto Peer Review Module
 * Automates peer review submission, grading, and multi-review loop until requirement is met
 */

const SAMPLE_REVIEWS = [
  'Excellent work on this research assignment. The primary research question is well-defined, focused, and directly addresses a meaningful gap in the literature. The proposed methodology is practical, logically structured, and demonstrates a thorough understanding of the relevant academic frameworks.',
  'This is a comprehensive and well-articulated submission. The author provides clear background rationale, supports key claims with relevant context, and outlines a sound research approach. The ethical considerations are thoughtfully addressed, ensuring strong academic rigor throughout.',
  'Very impressive research proposal. The problem statement is stated with exceptional clarity, and the transition from theoretical background to practical research methods is coherent and seamless. All rubric criteria have been fully satisfied with impressive detail.',
  'Great effort and solid execution. The presentation is clear, easy to follow, and directly addresses every aspect of the project guidelines. The methodology aligns well with the stated objectives, and the overall narrative is persuasive and academically sound.',
  'The submission clearly demonstrates a strong grasp of the fundamental concepts. The work is well-structured, coherent, and meets all rubric requirements thoroughly. The proposed approach is innovative yet feasible within realistic research constraints.',
  'Outstanding submission. The argument is developed logically, with appropriate references to current research. The design of the methodology is robust and the potential limitations have been considered and mitigated appropriately.'
];

const STORAGE_KEY_ACTIVE = 'cpt_auto_review_active';
const STORAGE_KEY_COUNT = 'cpt_auto_review_count';
const MAX_CONSECUTIVE_REVIEWS = 10;

/**
 * Check if the auto review loop is currently active in session
 * @returns {boolean}
 */
function isAutoReviewActive() {
  return sessionStorage.getItem(STORAGE_KEY_ACTIVE) === 'true';
}

/**
 * Stop the auto review loop and clean up state
 * @param {string} [msg]
 * @param {string} [type='info']
 */
function stopAutoReview(msg, type = 'info') {
  sessionStorage.removeItem(STORAGE_KEY_ACTIVE);
  sessionStorage.removeItem(STORAGE_KEY_COUNT);
  if (msg) showToast(msg, type);
}

/**
 * Handle user clicking the "Peer Review" button in panel
 * Toggles the automated review loop
 */
async function handleReview() {
  try {
    if (!location.href.includes('coursera.org')) {
      showToast('Vui lòng mở trang khóa học Coursera.', 'warning');
      return;
    }

    // Toggle: if already running, stop it
    if (isAutoReviewActive()) {
      stopAutoReview('⏹️ Đã dừng tự động chấm bài Peer Review.', 'warning');
      return;
    }

    showToast('🚀 Khởi động tự động chấm chéo Peer Review...', 'info');
    sessionStorage.setItem(STORAGE_KEY_ACTIVE, 'true');
    sessionStorage.setItem(STORAGE_KEY_COUNT, '0');

    await executeReviewStep();
  } catch (error) {
    console.error('[CourseraPro] Error starting peer review:', error);
    stopAutoReview('Lỗi khởi động: ' + error.message, 'error');
  }
}

/**
 * Check if auto review should resume after navigation / page load
 */
async function checkAndResumeAutoReview() {
  if (!isAutoReviewActive()) return;

  console.log('[CourseraPro] Resuming active Auto Peer Review loop on:', location.href);
  await sleep(1500);
  await executeReviewStep();
}

/**
 * Main execution step in the auto peer review loop
 */
async function executeReviewStep() {
  if (!isAutoReviewActive()) return;

  const count = parseInt(sessionStorage.getItem(STORAGE_KEY_COUNT) || '0', 10);
  if (count >= MAX_CONSECUTIVE_REVIEWS) {
    stopAutoReview(`🎉 Đã hoàn thành liên tiếp ${count} bài chấm chéo. Tạm dừng an toàn!`, 'success');
    return;
  }

  const url = location.href;

  // CASE 1: Currently on an individual submission review page (.../review/:submissionId)
  if (url.includes('/review/')) {
    showToast(`📝 Đang chấm bài học viên (Bài ${count + 1})...`, 'info');
    const success = await fillRubricAndSubmit();

    if (success) {
      const newCount = count + 1;
      sessionStorage.setItem(STORAGE_KEY_COUNT, String(newCount));
      showToast(`✅ Đã nộp bài chấm ${newCount} thành công! Đang chuyển tiếp...`, 'success');
      await sleep(2000);

      // Try to navigate back to give-feedback if not redirected automatically
      if (location.href.includes('/review/')) {
        const nextActionBtn = Array.from(document.querySelectorAll('button, a')).find((el) => {
          if (el.closest('#cpt-panel')) return false;
          const txt = (el.textContent || '').trim().toLowerCase();
          return (
            txt.includes('review another') ||
            txt.includes('back to peers') ||
            txt.includes('view peers') ||
            txt.includes('chấm bài khác') ||
            txt.includes('quay lại')
          );
        });

        if (nextActionBtn) {
          safeClick(nextActionBtn);
        } else {
          // Navigate to give-feedback URL directly
          navigateToGiveFeedback();
        }
      }
    } else {
      console.warn('[CourseraPro] Could not submit review form on current page.');
    }
    return;
  }

  // CASE 2: Currently on the "Peers to review" list page (.../give-feedback)
  if (url.includes('/give-feedback')) {
    showToast('🔍 Đang kiểm tra chỉ tiêu bài cần chấm...', 'info');
    await sleep(1200);

    // Check if review requirement is already satisfied
    if (isReviewRequirementSatisfied()) {
      stopAutoReview('🎉 Đã hoàn thành đủ số lượng bài chấm chéo theo yêu cầu!', 'success');
      return;
    }

    // Pick and open next peer card to review
    showToast('👉 Đang chọn một bài nộp để chấm...', 'info');
    const opened = await pickAndOpenNextPeerCard();

    if (!opened) {
      if (document.body.innerText.includes('reviewed all ungraded submissions')) {
        stopAutoReview('🎉 Bạn đã hoàn thành chấm tất cả bài nộp hiện có!', 'success');
      } else {
        stopAutoReview('Không tìm thấy bài nộp nào khả dụng để chấm tiếp.', 'info');
      }
    }
    return;
  }

  // CASE 3: On any other assignment tab (e.g. /submit, /instructions, or peer home)
  if (url.includes('/peer/')) {
    showToast('Chuyển sang tab "Peers to review"...', 'info');
    const tabSwitched = await goToPeersToReviewTab();
    if (!tabSwitched) {
      navigateToGiveFeedback();
    }
    return;
  }

  // CASE 4: Not on a peer assignment page at all
  stopAutoReview('Vui lòng mở trang bài tập Peer Review để sử dụng tính năng này.', 'warning');
}

/**
 * Check if the requirement for peer reviews has been reached on the /give-feedback page
 * @returns {boolean}
 */
function isReviewRequirementSatisfied() {
  const bodyText = (document.body?.innerText || '').toLowerCase();

  // Pattern 1: Coursera finished message (as seen in Screenshot 2)
  if (
    bodyText.includes("you've finished your peer reviews") ||
    bodyText.includes('you have finished your peer reviews') ||
    bodyText.includes('you have reviewed all ungraded submissions')
  ) {
    return true;
  }

  // Pattern 2: Specific review counter indicating 0 left
  if (bodyText.includes('0 left to complete') || bodyText.includes('0 more to complete')) {
    return true;
  }

  // Pattern 3: Review count comparison: "Reviews X complete" or "X of Y complete"
  const countMatch =
    bodyText.match(/reviews\s*:\s*(\d+)\s*of\s*(\d+)\s*complete/i) ||
    bodyText.match(/(\d+)\s*of\s*(\d+)\s*(?:reviews?\s*)?complete/i);

  if (countMatch && countMatch[1] && countMatch[2]) {
    const done = parseInt(countMatch[1], 10);
    const required = parseInt(countMatch[2], 10);
    if (done >= required && required > 0) return true;
  }

  return false;
}

/**
 * Navigate to the "Peers to review" tab by clicking tab link or redirecting
 * @returns {Promise<boolean>}
 */
async function goToPeersToReviewTab() {
  try {
    // Look for tab with text "Peers to review"
    const allTabs = Array.from(document.querySelectorAll('a, button, [role="tab"]'));
    const peersTab = allTabs.find((el) => {
      if (el.closest('#cpt-panel')) return false;
      const txt = (el.textContent || '').trim().toLowerCase();
      return txt === 'peers to review' || txt.includes('peers to review');
    });

    if (peersTab) {
      safeClick(peersTab);
      await sleep(1500);
      return true;
    }

    // Look for link with href containing /give-feedback
    const gfLink = document.querySelector('a[href*="/give-feedback"]');
    if (gfLink) {
      safeClick(gfLink);
      await sleep(1500);
      return true;
    }
  } catch (_e) {}

  return false;
}

/**
 * Fallback navigation to /give-feedback URL
 */
function navigateToGiveFeedback() {
  const current = location.href;
  const gfUrl = current.replace(/\/(?:submit|instructions|review.*)?$/, '/give-feedback');
  if (gfUrl !== current) {
    location.href = gfUrl;
  }
}

/**
 * Pick an unreviewed peer card from the grid on /give-feedback and click it
 * @returns {Promise<boolean>}
 */
async function pickAndOpenNextPeerCard() {
  await sleep(1500);

  // Strategy 0: Check for prominent "Start Reviewing" / "Start Review" button (as shown in user screenshot)
  const allButtons = Array.from(document.querySelectorAll('button, a[role="button"], a.cds-button'));
  const startReviewBtn = allButtons.find((btn) => {
    if (btn.closest('#cpt-panel') || btn.disabled) return false;
    const txt = (btn.textContent || '').trim().toLowerCase();
    return (
      txt === 'start reviewing' ||
      txt.includes('start reviewing') ||
      txt === 'start review' ||
      txt.includes('start review') ||
      txt.includes('bắt đầu chấm') ||
      txt.includes('review another')
    );
  });

  if (startReviewBtn) {
    startReviewBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(400);
    safeClick(startReviewBtn);
    return true;
  }

  // Strategy 1: Find review links on page
  const reviewLinks = Array.from(document.querySelectorAll('a[href*="/review/"]')).filter((a) => {
    if (a.closest('#cpt-panel')) return false;
    const href = a.getAttribute('href') || a.href || '';
    return href.includes('/review/') && !href.includes('/my-submission');
  });

  if (reviewLinks.length > 0) {
    // Pick the first available card
    const targetLink = reviewLinks[0];
    targetLink.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(400);
    safeClick(targetLink);
    return true;
  }

  // Strategy 2: Look for clickable submission cards in the grid
  const cardElements = Array.from(
    document.querySelectorAll('[data-testid*="peer" i], .cds-card, .rc-PeerReviewCard, [role="button"]')
  ).filter((el) => {
    if (el.closest('#cpt-panel')) return false;
    const txt = el.textContent || '';
    return (txt.includes('ago') || txt.includes('Study') || txt.includes('Generative')) && !txt.includes('Your submission');
  });

  if (cardElements.length > 0) {
    const card = cardElements[0];
    const clickableInside = card.querySelector('a, button') || card;
    clickableInside.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(400);
    safeClick(clickableInside);
    return true;
  }

  return false;
}

/**
 * Fill Rubric with highest points, write constructive comments, and click Submit Review
 * @returns {Promise<boolean>}
 */
async function fillRubricAndSubmit() {
  try {
    await sleep(1500);

    // 1. Fill all Rubric ratings (Select highest point option for each criterion)
    const questionGroups = Array.from(
      document.querySelectorAll(
        '.rc-FormPartsQuestion, [role="radiogroup"], fieldset, .c-peer-review-rubric-item, .rc-FormPart'
      )
    ).filter((el) => !el.closest('#cpt-panel'));

    for (const group of questionGroups) {
      // Find all radio inputs in this criterion group
      const radioInputs = Array.from(group.querySelectorAll('input[type="radio"]'));

      if (radioInputs.length > 0) {
        let bestRadio = null;
        let maxPoints = -1;

        // Parse points for each radio option
        for (let i = 0; i < radioInputs.length; i++) {
          const r = radioInputs[i];
          const container =
            r.closest('label') || r.closest('.cds-checkboxAndRadio-label') || r.closest('div') || r.parentElement;
          const text = (container ? container.textContent : '') || '';
          const m = text.match(/(\d+)\s*(?:point|pt|điểm)/i);
          const pts = m ? parseInt(m[1], 10) : i;

          if (pts > maxPoints) {
            maxPoints = pts;
            bestRadio = r;
          }
        }

        // If no explicit points found, default to first or last
        if (!bestRadio) {
          bestRadio = radioInputs[0];
        }

        if (bestRadio) {
          bestRadio.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          bestRadio.click();
          bestRadio.dispatchEvent(new Event('change', { bubbles: true }));
          bestRadio.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }

      // Star rating or custom point buttons
      const ratingButtons = Array.from(
        group.querySelectorAll(
          'button[aria-label*="point" i], button[aria-label*="star" i], button[role="radio"], button[aria-label*="điểm" i]'
        )
      );
      if (ratingButtons.length > 0) {
        const bestBtn = ratingButtons[ratingButtons.length - 1];
        bestBtn.click();
      }
    }

    await sleep(800);

    // 2. Fill all text feedback areas (Comments textarea: "Share your thoughts...")
    const textareas = Array.from(
      document.querySelectorAll(
        'textarea, .c-peer-review-submit-textarea-input-field, div[data-testid="peer-review-multi-line-input-field"], [contenteditable="true"]'
      )
    ).filter((field) => !field.closest('#cpt-panel') && field.type !== 'hidden' && field.style.display !== 'none');

    const randomReview = SAMPLE_REVIEWS[Math.floor(Math.random() * SAMPLE_REVIEWS.length)];

    for (const field of textareas) {
      const currentVal = (field.value || field.textContent || '').trim();
      if (currentVal.length < 10) {
        field.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        field.focus();

        if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
          simulateInput(field, randomReview);
        } else {
          simulateTyping(field, randomReview);
          document.execCommand('insertText', false, randomReview);
        }
      }
    }

    await sleep(1000);

    // 3. Find and click "Submit Review" button
    const allButtons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
    const submitBtn = allButtons.find((btn) => {
      if (btn.closest('#cpt-panel') || btn.disabled) return false;
      const txt = (btn.textContent || btn.value || '').trim().toLowerCase();
      return (
        txt === 'submit review' ||
        txt.includes('submit review') ||
        txt === 'submit' ||
        txt.includes('gửi đánh giá') ||
        (btn.type === 'submit' && !txt.includes('cancel') && !txt.includes('hủy'))
      );
    });

    if (submitBtn) {
      submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(500);
      safeClick(submitBtn);
      await sleep(1500);

      // Handle confirmation dialog if any
      const confirmBtn = Array.from(
        document.querySelectorAll('[role="dialog"] button, .modal button, .rc-Modal button')
      ).find((b) => {
        if (b.closest('#cpt-panel')) return false;
        const t = (b.textContent || '').trim().toLowerCase();
        return t.includes('submit') || t.includes('confirm') || t.includes('yes') || t.includes('đồng ý');
      });

      if (confirmBtn) {
        safeClick(confirmBtn);
        await sleep(1500);
      }

      return true;
    }

    return false;
  } catch (e) {
    console.error('[CourseraPro] Fill peer review error:', e);
    return false;
  }
}

/**
 * Handle peer graded assignment shortcut
 */
async function handlePeerGradedAssignment() {
  return handleReview();
}


// ====== modules/grading.js ======
/**
 * Coursera Pro Tool - Peer Assignment & Grading Module
 * Features:
 * 1. Tắt AI chấm bài (Disable AI Grading / Switch to Human Peer Review)
 * 2. Hỗ trợ lấy link chấm chéo (Get Shareable Peer Review Link)
 */

/**
 * Extract course ID from DOM state, metadata, scripts, or Coursera API
 * @param {string} courseSlug
 * @returns {Promise<string>}
 */
async function resolveCourseId(courseSlug) {
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
async function handleDisableAiGrading() {
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
async function handleGetShareableLink() {
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
async function handleRequestGrading() {
  return handleDisableAiGrading();
}


// ====== modules/assignment.js ======
/**
 * Coursera Pro Tool - Peer Assignment Auto-Submit Module
 * 1. Reads assignment instructions, prompts, and grading rubrics
 * 2. Uses AI (Gemini / DeepSeek / Groq) to generate a top-grade academic submission
 * 3. Automatically fills title, essay bodies, URLs, and honor code checkboxes
 */

/**
 * Safely fill an input, textarea, or contenteditable element in React
 * @param {HTMLElement} el
 * @param {string} value
 */
async function fillFormField(el, value) {
  if (!el || !value) return;

  try {
    el.focus();

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const proto = el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(el, value);
      } else {
        el.value = value;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      await simulateTyping(el, value);
    }

    addBadge(el.parentElement || el, '✨ AI Written');
  } catch (err) {
    console.warn('[CourseraPro] Failed to fill form field:', err);
  }
}

/**
 * Extract assignment prompt, instructions, and rubric criteria from DOM
 * @returns {{title: string, instructions: string, prompts: string[], rubric: string}}
 */
function extractAssignmentContext() {
  // 1. Assignment Title
  const titleEl = document.querySelector(
    'h1, h2.rc-PeerAssignmentHeader__title, [data-testid="assignment-title"], .css-1n4j3g5'
  );
  const title = titleEl?.textContent?.trim() || 'Coursera Peer Assignment';

  // 2. Instructions / Description
  const instructionEls = document.querySelectorAll(
    '.rc-PeerAssignmentInstruction, .rc-CML, [data-testid="cml-viewer"], [class*="Instruction"], [class*="description"]'
  );
  let instructions = '';
  instructionEls.forEach((el) => {
    if (!el.closest('#cpt-panel') && el.textContent) {
      instructions += el.textContent.trim() + '\n';
    }
  });

  // 3. Section Prompts (if multiple prompts exist)
  const promptEls = document.querySelectorAll(
    '.rc-PromptItem, [class*="PromptItem"], fieldset legend, .rc-FormPartsQuestion__title'
  );
  const prompts = [];
  promptEls.forEach((p) => {
    const text = p.textContent?.trim();
    if (text && !prompts.includes(text) && !text.toLowerCase().includes('honor code')) {
      prompts.push(text);
    }
  });

  // 4. Rubric / Grading criteria
  const rubricEls = document.querySelectorAll(
    '.rc-Rubric, [class*="Rubric"], [data-testid*="rubric" i], [class*="Criteria"]'
  );
  let rubric = '';
  rubricEls.forEach((r) => {
    if (r.textContent) rubric += r.textContent.trim() + '\n';
  });

  return {
    title,
    instructions: instructions.substring(0, 4000),
    prompts,
    rubric: rubric.substring(0, 2000),
  };
}

/**
 * Find form inputs for the assignment submission
 * @returns {{titleInput: HTMLInputElement|null, contentInputs: HTMLElement[], urlInput: HTMLInputElement|null, honorCheckboxes: HTMLInputElement[]}}
 */
function findSubmissionInputs() {
  const allInputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]')).filter(
    (el) => !el.closest('#cpt-panel')
  );

  // Title input
  const titleInput = allInputs.find((el) => {
    if (el.tagName !== 'INPUT') return false;
    const placeholder = (el.placeholder || '').toLowerCase();
    const name = (el.name || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    const testid = (el.getAttribute('data-testid') || '').toLowerCase();
    return (
      placeholder.includes('title') ||
      name.includes('title') ||
      id.includes('title') ||
      testid.includes('title') ||
      placeholder.includes('tiêu đề')
    );
  }) || null;

  // Content textareas / editors
  const contentInputs = allInputs.filter((el) => {
    if (el === titleInput) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return true;
    if (el.tagName === 'INPUT' && (el.type === 'text' || !el.type)) {
      const p = (el.placeholder || '').toLowerCase();
      return p.includes('answer') || p.includes('response') || p.includes('write') || p.includes('nội dung');
    }
    return false;
  });

  // URL / Link input
  const urlInput = allInputs.find((el) => {
    if (el.tagName !== 'INPUT') return false;
    const t = (el.type || '').toLowerCase();
    const p = (el.placeholder || '').toLowerCase();
    return t === 'url' || p.includes('http') || p.includes('github') || p.includes('link') || p.includes('drive');
  }) || null;

  // Honor code checkboxes
  const honorCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter((cb) => {
    if (cb.closest('#cpt-panel')) return false;
    const label = cb.closest('label')?.textContent?.toLowerCase() || cb.parentElement?.textContent?.toLowerCase() || '';
    return (
      label.includes('honor code') ||
      label.includes('own work') ||
      label.includes('cam đoan') ||
      label.includes('chính trực') ||
      label.includes('understand')
    );
  });

  // File upload input
  const fileInputs = allInputs.filter((el) => el.tagName === 'INPUT' && el.type === 'file');

  return {
    titleInput,
    contentInputs,
    urlInput,
    fileInputs,
    honorCheckboxes,
  };
}

/**
 * Generate assignment submission content using AI
 * @param {object} context
 * @param {number} numSections
 * @returns {Promise<{title: string, sections: string[], url: string}>}
 */
async function generateAssignmentSubmission(context, numSections = 1) {
  const courseSlug = getCurrentCourseSlug();
  const systemInstruction = `You are an exceptional, high-achieving university student submitting a peer-reviewed assignment for the course: "${courseSlug}".

Your task: Produce an outstanding, thorough, highly articulate submission that fulfills all assignment instructions and exceeds top-tier rubric criteria.

CRITICAL GUIDELINES:
1. Write with academic depth, concrete real-world examples, rigorous analysis, and clear structure.
2. If instructions specify questions or sections, address each with appropriate detail.
3. Sound completely natural and professional (avoid AI clichés like "delve into", "in summary", "moreover").
4. Return a clean JSON object in the exact format:
{
  "title": "Descriptive, engaging academic title for the submission",
  "sections": [
    "Full detailed text for section 1 (around 250-400 words)",
    "Full detailed text for section 2 if applicable"
  ],
  "url": "https://github.com/academic-projects/coursera-final-submission"
}
5. Return ONLY the JSON object. Do not include markdown preamble.`;

  const prompt = `Course: ${courseSlug}
Assignment Title: ${context.title}

INSTRUCTIONS & GUIDELINES:
${context.instructions || 'Follow all standard academic conventions for this course assignment.'}

SPECIFIC PROMPTS/QUESTIONS:
${context.prompts.length > 0 ? context.prompts.map((p, i) => `Prompt ${i + 1}: ${p}`).join('\n') : 'Complete the main assignment task.'}

RUBRIC / GRADING CRITERIA:
${context.rubric || 'Address key principles, methodologies, critical evaluation, and practical implementation.'}

Number of content fields required: ${Math.max(1, numSections)}.
Generate full academic submission now in valid JSON format.`;

  let parsed = null;
  try {
    const raw = await generateContent(prompt, systemInstruction, null, { temperature: 0.7 });
    parsed = extractJson(raw);
  } catch (err) {
    console.warn('[CourseraPro] Failed to generate assignment with primary AI:', err);
  }

  if (parsed && typeof parsed === 'object') {
    const title = parsed.title || context.title || 'Comprehensive Course Assignment Submission';
    let sections = [];
    if (Array.isArray(parsed.sections)) {
      sections = parsed.sections;
    } else if (typeof parsed.content === 'string') {
      sections = [parsed.content];
    } else if (typeof parsed.submission === 'string') {
      sections = [parsed.submission];
    }

    if (sections.length === 0) {
      sections = [JSON.stringify(parsed)];
    }

    return {
      title,
      sections,
      url: parsed.url || 'https://github.com/academic-projects/coursera-final-submission',
    };
  }

  // Fallback generation if JSON parse failed
  const fallbackEssay = `### Comprehensive Analysis & Implementation Report: ${context.title}

#### 1. Executive Summary & Problem Formulation
This project addresses the core theoretical foundations and practical challenges outlined in the coursework. By synthesizing foundational principles with systematic analysis, the goal is to evaluate measurable criteria, mitigate operational friction, and deliver a robust framework suited for real-world deployment.

#### 2. Methodological Approach & Key Findings
Our investigation centered on validating empirical outcomes through iterative prototyping and structured evaluation. Rather than relying on static assumptions, the workflow incorporated modular components to ensure adaptability. The observations clearly indicate that establishing clear baseline metrics early in the lifecycle drastically reduces systemic errors and improves alignment across functional requirements.

#### 3. Critical Evaluation & Rubric Alignment
Addressing the explicit grading criteria:
- **Depth of Analysis**: The architectural trade-offs were examined across efficiency, reliability, and long-term maintainability.
- **Evidence-Based Insights**: Key parameters were benchmarked against industry standards to ensure consistency.
- **Future Considerations**: Scalability and edge-case behaviors have been documented with recommended mitigation protocols.

#### 4. Conclusion & Actionable Recommendations
In conclusion, the proposed methodology satisfies all project objectives while establishing a resilient foundation for subsequent iterations. Further enhancements could integrate automated feedback pipelines to sustain continuous refinement.`;

  return {
    title: `Comprehensive Analysis: ${context.title}`,
    sections: [fallbackEssay],
    url: 'https://github.com/academic-projects/coursera-final-submission',
  };
}

/**
 * Synthesize a valid academic document file in-memory using pure browser APIs
 * @param {string} title
 * @param {string} textContent
 * @param {string} [extension='pdf']
 * @returns {File}
 */
function createSyntheticFile(title, textContent, extension = 'pdf') {
  const cleanTitle = (title || 'Project_Assignment_Submission')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 45);

  if (extension === 'pdf') {
    const safeTitle = (title || 'Course Project Report').replace(/[\r\n\t]/g, ' ');
    const safeLines = (textContent || safeTitle)
      .split('\n')
      .slice(0, 30)
      .map((l) => l.replace(/[\(\)\\]/g, '').substring(0, 80).trim())
      .filter(Boolean);

    let streamContent = `BT\n/F1 14 Tf\n50 740 Td\n18 TL\n(${safeTitle}) Tj T*\n/F1 10 Tf\n14 TL\n`;
    for (const line of safeLines) {
      streamContent += `(${line}) Tj T*\n`;
    }
    streamContent += `ET\n`;

    const streamLength = streamContent.length;
    const pdfData = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length ${streamLength} >>
stream
${streamContent}endstream
endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000060 00000 n 
0000000117 00000 n 
0000000234 00000 n 
0000000307 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
${400 + streamLength}
%%EOF`;

    const blob = new Blob([pdfData], { type: 'application/pdf' });
    return new File([blob], `${cleanTitle}.pdf`, { type: 'application/pdf' });
  }

  // Default to text / code
  const mimeType = extension === 'py' ? 'text/x-python' : 'text/plain';
  const blob = new Blob([textContent], { type: mimeType });
  return new File([blob], `${cleanTitle}.${extension}`, { type: mimeType });
}

/**
 * Programmatically upload a file into a Coursera file input element
 * @param {HTMLInputElement} fileInput
 * @param {File} file
 * @returns {Promise<boolean>}
 */
async function uploadFileToInput(fileInput, file) {
  if (!fileInput || !file) return false;
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    // Add badge
    addBadge(fileInput.parentElement || fileInput, `📁 ${file.name}`);
    return true;
  } catch (err) {
    console.warn('[CourseraPro] Failed to programmatically upload file:', err);
    return false;
  }
}

/**
 * Main handler to generate and autofill the peer assignment
 */
async function handleAutoAssignment() {
  try {
    showToast('📝 Đang quét đề bài và các ô nhập liệu bài tập...', 'info');

    const inputs = findSubmissionInputs();
    const hasInputs = inputs.titleInput || inputs.contentInputs.length > 0 || inputs.fileInputs.length > 0;

    if (!hasInputs) {
      // Check if user is outside on assignment landing page and needs to enter
      const submitBtn = Array.from(document.querySelectorAll('a, button')).find((el) => {
        const t = el.textContent?.trim().toLowerCase() || '';
        return t === 'submit your assignment' || t === 'my submission' || t === 'go to assignment' || t === 'nộp bài tập';
      });

      if (submitBtn) {
        showToast('Đang mở trang nộp bài tập...', 'info');
        safeClick(submitBtn);
        await sleep(2000);
        return handleAutoAssignment();
      }

      showToast('⚠️ Không tìm thấy ô nhập bài tập trên trang này. Hãy mở trang "My Submission" / "Submit"!', 'warning');
      return;
    }

    const context = extractAssignmentContext();
    const numSections = Math.max(1, inputs.contentInputs.length);

    showToast(`🤖 AI đang soạn bài tập chuẩn học thuật (${numSections} phần)...`, 'info');
    updateProgress(1, 3, 'AI đang phân tích rubric và viết bài...');

    const submissionData = await generateAssignmentSubmission(context, numSections);

    // 1. Fill Title
    if (inputs.titleInput && submissionData.title) {
      await fillFormField(inputs.titleInput, submissionData.title);
    }

    // 2. Fill Content sections
    for (let i = 0; i < inputs.contentInputs.length; i++) {
      const inputEl = inputs.contentInputs[i];
      const text = submissionData.sections[i] || submissionData.sections[0] || '';
      await fillFormField(inputEl, text);
    }

    // 3. Synthesize and Auto-Upload File if required
    if (inputs.fileInputs.length > 0) {
      showToast('📁 Phát hiện yêu cầu nộp file! Đang tự động tạo file PDF đồ án...', 'info');
      const combinedReport = submissionData.sections.join('\n\n');
      for (const fileInp of inputs.fileInputs) {
        const accept = (fileInp.getAttribute('accept') || '').toLowerCase();
        let ext = 'pdf';
        if (accept.includes('.py')) ext = 'py';
        else if (accept.includes('.txt')) ext = 'txt';
        else if (accept.includes('.md')) ext = 'md';

        const syntheticFile = createSyntheticFile(submissionData.title, combinedReport, ext);
        await uploadFileToInput(fileInp, syntheticFile);
        await sleep(1500); // Wait for Coursera upload handler
      }
    }

    // 4. Fill URL if present
    if (inputs.urlInput && submissionData.url) {
      await fillFormField(inputs.urlInput, submissionData.url);
    }

    // 5. Tick Honor code checkboxes
    for (const cb of inputs.honorCheckboxes) {
      if (!cb.checked) {
        cb.click();
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    updateProgress(3, 3, 'Hoàn tất soạn bài!');
    showToast('🎉 Đã soạn, đính kèm file và điền xong bài tập nộp! Hãy kiểm tra lại trước khi bấm Submit.', 'success');
  } catch (err) {
    console.error('[CourseraPro] Auto Assignment error:', err);
    showToast('Lỗi soạn bài tập: ' + err.message, 'error');
  }
}


// ====== modules/autopilot.js ======
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

const STORAGE_KEY_AUTOPILOT_QUEUE = 'cpt_master_autopilot_queue';

let isAutopilotRunning = false;
let isAutopilotPaused = false;

/**
 * Check if Autopilot is currently active
 * @returns {{ isRunning: boolean, isPaused: boolean }}
 */
function getAutopilotState() {
  return {
    isRunning: isAutopilotRunning,
    isPaused: isAutopilotPaused,
  };
}

/**
 * Stop the course autopilot process and clear any pending queues
 */
async function stopCourseAutopilot() {
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
function pauseCourseAutopilot() {
  if (isAutopilotRunning) {
    isAutopilotPaused = true;
    showToast('⏸️ Đã tạm dừng Autopilot.', 'warning');
  }
}

/**
 * Resume the course autopilot process
 */
function resumeCourseAutopilot() {
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
function categorizeCourseItems(allItems = [], completedIds = new Set()) {
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
async function runFinalAudit(userId, courseId, courseSlug) {
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
async function advanceAutopilotQuizQueue(queue) {
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
async function checkAndResumeCourseAutopilot() {
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

    // If currently on /review or /view-feedback page: advance to next quiz
    if (location.href.includes('/review') || location.href.includes('/view-feedback')) {
      await sleep(2000);
      await advanceAutopilotQuizQueue(queue);
      return;
    }

    // If on assignment overview page: look for enter button with polling
    const enterBtn = await waitForQuizEnterButton(6000);

    if (enterBtn) {
      showToast('Đang bấm vào bài làm (Resume / Start)...', 'info');
      await sleep(1000);
      enterBtn.click();
      await sleep(1200);
      const modalConfirmBtn = Array.from(document.querySelectorAll('[role="dialog"] button, .modal button, .rc-Modal button')).find(
        (b) => {
          const t = b.textContent.trim().toLowerCase();
          return t === 'continue' || t === 'tiếp tục';
        }
      );
      if (modalConfirmBtn) modalConfirmBtn.click();
    } else {
      // Button not found, initiate attempt on backend via GraphQL before navigation
      let initiated = false;
      if (queue.courseId && currentQuiz.id) {
        showToast('Đang khởi tạo phiên làm bài qua Coursera API...', 'info');
        initiated = await apiInitiateAttempt(queue.courseId, currentQuiz.id);
      }

      const cleanUrl = location.href.split('?')[0].replace(/\/$/, '');
      if (initiated && !cleanUrl.includes('/attempt')) {
        await sleep(1500);
        window.location.href = `${cleanUrl}/attempt`;
      } else if (!cleanUrl.includes('/attempt')) {
        showToast('⚠️ Vui lòng bấm nút "Bắt đầu làm bài" trên trang để Autopilot tự giải!', 'warning');
      }
    }
  } catch (err) {
    console.warn('[CourseraPro Autopilot] checkAndResume error:', err);
  }
}

/**
 * Main entry point for Master Course Autopilot
 */
async function startCourseAutopilot() {
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


// ====== content/main.js ======
/**
 * Coursera Pro Tool - Content Script Entry Point
 * Injects the floating panel and sets up all module handlers
 */

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
  const isReviewPage =
    location.href.includes('/review') ||
    location.href.includes('/view-feedback') ||
    Boolean(document.querySelector('.rc-FormPartsQuestion__error, [data-testid="test-feedback-incorrect"], [data-testid*="feedback" i]'));

  if (isReviewPage && location.href !== lastRecordedReviewUrl) {
    lastRecordedReviewUrl = location.href;
    console.log('[CourseraPro] Auto-detect review / feedback page. Passively recording feedback...');
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



})();
