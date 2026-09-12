/**
 * Coursera Pro Tool - Popup Script
 * Handles settings management in the popup
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const PROVIDER_CONFIG = {
  gemini: {
    label: 'Gemini API Key',
    placeholder: 'AIzaSy...',
    helpText: 'Lấy Gemini API key miễn phí →',
    helpUrl: 'https://aistudio.google.com/app/apikey',
    models: [
      { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (Khuyên dùng - Ổn định)' },
      { value: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite (Siêu tốc & Tiết kiệm)' },
      { value: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (Nhanh)' },
      { value: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash (Thông minh)' },
      { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (Mới nhất)' },
    ],
    defaultModel: 'gemini-3.5-flash',
    storageKey: 'geminiAPI',
  },
  deepseek: {
    label: 'DeepSeek API Key',
    placeholder: 'sk-...',
    helpText: 'Lấy DeepSeek API key →',
    helpUrl: 'https://platform.deepseek.com/api_keys',
    models: [
      { value: 'deepseek-chat', label: 'DeepSeek-V3 Chat (Khuyên dùng)' },
      { value: 'deepseek-reasoner', label: 'DeepSeek-R1 (Suy luận sâu)' },
    ],
    defaultModel: 'deepseek-chat',
    storageKey: 'deepseekAPI',
  },
  groq: {
    label: 'Groq API Key',
    placeholder: 'gsk_...',
    helpText: 'Lấy Groq API key miễn phí (Siêu tốc) →',
    helpUrl: 'https://console.groq.com/keys',
    models: [
      { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile (~500 t/s)' },
      { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
      { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B 32k' },
    ],
    defaultModel: 'llama-3.3-70b-versatile',
    storageKey: 'groqAPI',
  },
};

// DOM elements
const aiProviderSelect = document.getElementById('aiProvider');
const apiKeyLabel = document.getElementById('apiKeyLabel');
const apiKeyInput = document.getElementById('apiKey');
const helpLink = document.getElementById('helpLink');
const modelSelect = document.getElementById('model');
const autoSubmitCheckbox = document.getElementById('autoSubmitQuiz');
const saveBtn = document.getElementById('saveBtn');
const toggleKeyBtn = document.getElementById('toggleKey');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

function normalizeModel(provider, m) {
  if (!m || typeof m !== 'string') return PROVIDER_CONFIG[provider]?.defaultModel || 'gemini-3.5-flash';
  const lower = m.toLowerCase().replace(/^models\//, '').trim();
  if (provider === 'gemini') {
    // Map ALL legacy/deprecated model names to working 3.x equivalents
    if (lower.includes('2.0-flash-lite') || lower.includes('2.0-flash-lite-preview')) return 'gemini-3.5-flash-lite';
    if (lower.includes('2.0-flash') || lower === 'gemini-2-flash') return 'gemini-3.6-flash';
    if (lower.includes('2.5-flash')) return 'gemini-3.5-flash';
    if (lower.includes('2.5-pro')) return 'gemini-3.5-flash';
    if (lower.includes('1.5-flash') || lower === 'flash-8b' || lower === '8b') return 'gemini-3.5-flash';
    if (lower.includes('1.5-pro')) return 'gemini-3.5-flash';
  }
  return lower;
}

// Switch provider UI & preserve selected model
function switchProviderUI(provider, targetModel = null) {
  const conf = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.gemini;
  if (apiKeyLabel) apiKeyLabel.textContent = conf.label;
  if (apiKeyInput) apiKeyInput.placeholder = conf.placeholder;
  if (helpLink) {
    helpLink.textContent = conf.helpText;
    helpLink.href = conf.helpUrl;
  }

  // Populate models
  if (modelSelect) {
    modelSelect.innerHTML = '';
    const normalizedTarget = normalizeModel(provider, targetModel);
    const effectiveModel = normalizedTarget || conf.defaultModel;
    let matched = false;

    conf.models.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.value;
      opt.textContent = m.label;
      if (m.value === effectiveModel) {
        opt.selected = true;
        matched = true;
      }
      modelSelect.appendChild(opt);
    });

    // If targetModel is a dynamic model returned by API not in static list, preserve it!
    if (effectiveModel && !matched) {
      const customOpt = document.createElement('option');
      customOpt.value = effectiveModel;
      customOpt.textContent = effectiveModel;
      customOpt.selected = true;
      modelSelect.insertBefore(customOpt, modelSelect.firstChild);
    }
  }
}

// Load saved settings
async function loadSettings() {
  const data = await chrome.storage.local.get([
    'aiProvider',
    'geminiAPI',
    'deepseekAPI',
    'groqAPI',
    'model',
    'model_gemini',
    'model_deepseek',
    'model_groq',
    'isAutoSubmitQuiz',
  ]);

  const provider = (data.aiProvider || 'gemini').toLowerCase();
  const conf = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.gemini;
  if (aiProviderSelect) aiProviderSelect.value = provider;

  const rawModel = data[`model_${provider}`] || data.model || conf.defaultModel;
  const savedModel = normalizeModel(provider, rawModel);

  switchProviderUI(provider, savedModel);

  const activeKey = data[conf.storageKey] || '';
  if (apiKeyInput) apiKeyInput.value = activeKey;

  autoSubmitCheckbox.checked = data.isAutoSubmitQuiz !== false;

  if (activeKey) {
    await checkApiKey(activeKey, provider, savedModel);
  } else {
    setStatus('warning', `${provider.toUpperCase()} API key chưa cài đặt`);
  }
}

// On provider dropdown change
if (aiProviderSelect) {
  aiProviderSelect.addEventListener('change', async () => {
    const provider = aiProviderSelect.value;
    const conf = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.gemini;
    const data = await chrome.storage.local.get([conf.storageKey, `model_${provider}`, 'model']);
    const savedKey = data[conf.storageKey] || '';
    const rawModel = data[`model_${provider}`] || conf.defaultModel;
    const savedModel = normalizeModel(provider, rawModel);

    switchProviderUI(provider, savedModel);
    apiKeyInput.value = savedKey;

    if (savedKey) {
      await checkApiKey(savedKey, provider, savedModel);
    } else {
      setStatus('warning', `${provider.toUpperCase()} API key chưa cài đặt`);
    }
  });
}

// Save settings
async function saveSettings() {
  const provider = aiProviderSelect ? aiProviderSelect.value : 'gemini';
  const conf = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.gemini;
  const apiKey = apiKeyInput.value.trim();
  const rawModel = modelSelect ? modelSelect.value : conf.defaultModel;
  const model = normalizeModel(provider, rawModel);
  const isAutoSubmitQuiz = autoSubmitCheckbox.checked;

  const toSave = {
    aiProvider: provider,
    model: model,
    [`model_${provider}`]: model,
    isAutoSubmitQuiz: isAutoSubmitQuiz,
    [conf.storageKey]: apiKey,
  };

  await chrome.storage.local.set(toSave);

  if (apiKey) {
    saveBtn.textContent = 'Đang kiểm tra...';
    saveBtn.disabled = true;
    await checkApiKey(apiKey, provider, model);
    saveBtn.textContent = 'Đã lưu ✓';
    saveBtn.disabled = false;
    setTimeout(() => {
      saveBtn.textContent = 'Save Settings';
    }, 2000);
  } else {
    setStatus('warning', `${provider.toUpperCase()} API key chưa cài đặt`);
    saveBtn.textContent = 'Đã lưu ✓';
    setTimeout(() => {
      saveBtn.textContent = 'Save Settings';
    }, 2000);
  }
}

// Check if API key is valid for current provider
async function checkApiKey(apiKey, provider = 'gemini', preferredModel = null) {
  setStatus('info', 'Đang kiểm tra kết nối...');
  try {
    if (provider === 'deepseek') {
      const res = await fetch('https://api.deepseek.com/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        setStatus('connected', 'Đã kết nối DeepSeek API');
      } else {
        setStatus('error', 'API key DeepSeek không hợp lệ');
      }
    } else if (provider === 'groq') {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        setStatus('connected', 'Đã kết nối Groq API (~500 tok/s)');
      } else {
        setStatus('error', 'API key Groq không hợp lệ');
      }
    } else {
      const response = await fetch(`${GEMINI_API_BASE}/models?key=${apiKey}`);
      if (response.ok) {
        const data = await response.json();
        await validateAndUpdateGeminiModels(apiKey, data.models || [], preferredModel);
      } else {
        setStatus('error', 'API key Gemini không hợp lệ');
      }
    }
  } catch (_err) {
    setStatus('error', 'Không thể kết nối API. Kiểm tra mạng.');
  }
}

/**
 * Test a single model with a minimal generateContent request
 * Uses maxOutputTokens:10 to avoid false negatives from empty 1-token responses.
 * @param {string} apiKey
 * @param {string} modelName
 * @returns {Promise<boolean>}
 */
async function testSingleModel(apiKey, modelName) {
  try {
    const url = `${GEMINI_API_BASE}/models/${modelName}:generateContent?key=${apiKey}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Say hello' }] }],
        generationConfig: { maxOutputTokens: 10 },
      }),
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const errMsg = errData?.error?.message || `HTTP ${res.status}`;
      // 429 with "limit: 0" means the model requires paid tier - mark as failed for free users
      console.warn(`[CourseraPro] Model test FAILED: ${modelName} → ${errMsg}`);
      return false;
    }

    const data = await res.json();
    // Model is working if it returns candidates (even if text is very short)
    const hasCandidates = data?.candidates && data.candidates.length > 0;
    if (hasCandidates) {
      console.log(`[CourseraPro] Model test PASSED: ${modelName} ✓`);
      return true;
    }
    console.warn(`[CourseraPro] Model test FAILED: ${modelName} → No candidates`);
    return false;
  } catch (err) {
    console.warn(`[CourseraPro] Model test FAILED: ${modelName} →`, err.message);
    return false;
  }
}

function formatGeminiLabel(name) {
  // Primary 3.x models
  if (name === 'gemini-3.5-flash') return 'Gemini 3.5 Flash (Khuyên dùng - Ổn định)';
  if (name === 'gemini-3.5-flash-lite') return 'Gemini 3.5 Flash Lite (Siêu tốc & Tiết kiệm)';
  if (name === 'gemini-3.6-flash') return 'Gemini 3.6 Flash (Nhanh)';
  if (name === 'gemini-3.7-flash') return 'Gemini 3.7 Flash (Thông minh)';
  if (name === 'gemini-3.8-flash') return 'Gemini 3.8 Flash (Mới nhất)';
  if (name.includes('3.1-flash-lite')) return 'Gemini 3.1 Flash Lite';
  // Catch-all for any other dynamically discovered models
  const versionMatch = name.match(/gemini-(\d+\.\d+)-(.+)/);
  if (versionMatch) return `Gemini ${versionMatch[1]} ${versionMatch[2].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`;
  return name;
}

/**
 * Validate models by actually testing them, then update dropdown with ONLY working models.
 * Results are cached for 1 hour to avoid re-testing every popup open.
 * @param {string} apiKey
 * @param {Array} models - raw model objects from /models API
 * @param {string|null} preferredModel
 */
async function validateAndUpdateGeminiModels(apiKey, models, preferredModel = null) {
  const desired = normalizeModel('gemini', preferredModel || modelSelect?.value);

  // Step 1: Filter candidate models from API response
  const candidateModels = models
    .filter((m) => {
      const n = (m.name || '').toLowerCase();
      const methods = m.supportedGenerationMethods || [];
      return (
        methods.includes('generateContent') &&
        n.includes('gemini') &&
        !n.includes('tts') &&
        !n.includes('audio') &&
        !n.includes('image') &&
        !n.includes('imagen') &&
        !n.includes('embed') &&
        !n.includes('aqa') &&
        !n.includes('bison') &&
        !n.includes('realtime') &&
        !n.includes('nano')
      );
    })
    .map((m) => m.name.replace('models/', '').trim());

  if (candidateModels.length === 0) {
    setStatus('warning', 'Không tìm thấy model nào khả dụng.');
    return;
  }

  // Step 2: Check cache - avoid re-testing if results are fresh (< 1 hour)
  const CACHE_KEY = 'cpt_verified_models_cache_v2'; // Bumped version to invalidate stale cache
  const CACHE_TTL = 60 * 60 * 1000; // 1 hour
  const cached = await chrome.storage.local.get([CACHE_KEY]);
  const cacheData = cached[CACHE_KEY];

  if (cacheData && cacheData.timestamp && (Date.now() - cacheData.timestamp < CACHE_TTL) && Array.isArray(cacheData.models) && cacheData.models.length > 0) {
    console.log('[CourseraPro] Using cached verified models:', cacheData.models);
    renderModelDropdown(cacheData.models, desired);
    setStatus('connected', `Đã kết nối Gemini API · ${cacheData.models.length} models hoạt động`);
    return;
  }

  // Step 3: Test each model in parallel with real API calls
  setStatus('info', `Đang kiểm tra ${candidateModels.length} models...`);

  // Show temporary "loading" state in dropdown
  modelSelect.innerHTML = '';
  const loadingOpt = document.createElement('option');
  loadingOpt.textContent = `⏳ Đang test ${candidateModels.length} models...`;
  loadingOpt.disabled = true;
  loadingOpt.selected = true;
  modelSelect.appendChild(loadingOpt);

  // Test all models in parallel (each with 10s timeout)
  const testResults = await Promise.allSettled(
    candidateModels.map(async (name) => {
      const passed = await testSingleModel(apiKey, name);
      return { name, passed };
    })
  );

  const workingModels = testResults
    .filter((r) => r.status === 'fulfilled' && r.value.passed)
    .map((r) => r.value.name)
    // Smart sort: prioritize recommended models
    .sort((a, b) => {
      const priority = [
        'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash',
        'gemini-3.7-flash', 'gemini-3.8-flash',
      ];
      const aIdx = priority.findIndex((p) => a.startsWith(p));
      const bIdx = priority.findIndex((p) => b.startsWith(p));
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return b.localeCompare(a);
    });

  const failedCount = candidateModels.length - workingModels.length;
  console.log(`[CourseraPro] Model validation complete: ${workingModels.length} passed, ${failedCount} failed`);

  if (workingModels.length === 0) {
    setStatus('warning', 'Không có model nào hoạt động. Kiểm tra API key.');
    modelSelect.innerHTML = '';
    const noOpt = document.createElement('option');
    noOpt.textContent = '❌ Không có model nào khả dụng';
    noOpt.disabled = true;
    modelSelect.appendChild(noOpt);
    return;
  }

  // Step 4: Cache results
  await chrome.storage.local.set({
    [CACHE_KEY]: { models: workingModels, timestamp: Date.now() },
    verified_gemini_models: workingModels,
  });

  // Step 5: Render dropdown
  renderModelDropdown(workingModels, desired);
  setStatus('connected', `Đã kết nối Gemini API · ${workingModels.length} models hoạt động`);
}

/**
 * Render model dropdown with verified models
 * @param {string[]} workingModels
 * @param {string} desired
 */
function renderModelDropdown(workingModels, desired) {
  const defaults = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.5-flash-lite'];
  const bestDefault = defaults.find((p) => workingModels.includes(p)) || workingModels[0];
  const target = workingModels.includes(desired) ? desired : bestDefault;

  modelSelect.innerHTML = '';
  workingModels.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = formatGeminiLabel(name);
    if (name === target) {
      option.selected = true;
    }
    modelSelect.appendChild(option);
  });

  // Auto-switch storage if previous model was invalid
  if (desired !== target) {
    chrome.storage.local.set({ model: target, model_gemini: target });
  }
}

// Set status indicator
function setStatus(type, text) {
  statusDot.className = `status-dot ${type}`;
  statusText.textContent = text;
}

// Load and display Local Source Cache statistics
async function updateSourceStats() {
  const sourceStatsEl = document.getElementById('sourceStats');
  const exportBtn = document.getElementById('exportSourceBtn');
  const importBtn = document.getElementById('importSourceBtn');
  const importFileInput = document.getElementById('importFileInput');
  if (!sourceStatsEl) return;

  const allData = await chrome.storage.local.get(null);
  let totalCourses = 0;
  let totalQuestions = 0;
  const allSources = {};

  for (const [key, value] of Object.entries(allData)) {
    if (key.startsWith('cpt_local_source_') && Array.isArray(value)) {
      totalCourses++;
      totalQuestions += value.length;
      const courseSlug = key.replace('cpt_local_source_', '');
      allSources[courseSlug] = value;
    }
  }

  if (totalQuestions === 0) {
    sourceStatsEl.textContent = 'Chưa có câu hỏi nào (Tự lưu khi giải)';
  } else {
    sourceStatsEl.textContent = `📦 ${totalQuestions} câu hỏi (${totalCourses} môn)`;
  }

  if (importBtn && importFileInput) {
    importBtn.onclick = () => importFileInput.click();
    importFileInput.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const json = JSON.parse(text);
        let importedQuestions = 0;
        let importedCourses = 0;

        for (const [key, value] of Object.entries(json)) {
          const storageKey = key.startsWith('cpt_local_source_') ? key : `cpt_local_source_${key}`;
          if (Array.isArray(value) && value.length > 0) {
            const existing = (await chrome.storage.local.get([storageKey]))[storageKey] || [];
            const existingMap = new Map();
            for (const item of existing) {
              const p = item.cleanPrompt || item.prompt;
              if (p) existingMap.set(p, item);
            }
            for (const item of value) {
              const p = item.cleanPrompt || item.prompt;
              if (p && (!existingMap.has(p) || existingMap.get(p).answer !== item.answer)) {
                existingMap.set(p, item);
                importedQuestions++;
              }
            }
            await chrome.storage.local.set({ [storageKey]: Array.from(existingMap.values()) });
            importedCourses++;
          }
        }

        alert(`🎉 Đã nhập thành công ${importedQuestions} câu hỏi vào ${importedCourses} môn học!`);
        updateSourceStats();
      } catch (err) {
        alert('Lỗi đọc file JSON: ' + err.message);
      } finally {
        importFileInput.value = '';
      }
    };
  }

  if (exportBtn) {
    exportBtn.onclick = () => {
      if (totalQuestions === 0) {
        alert('Kho Source hiện tại chưa có câu hỏi nào. Hãy giải ít nhất 1 bài quiz để tự động lưu vào kho!');
        return;
      }
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(allSources, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `coursera_local_source_${Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    };
  }
}

// Toggle password visibility
toggleKeyBtn.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  toggleKeyBtn.textContent = isPassword ? '🔒' : '👁';
});

// Save button click
saveBtn.addEventListener('click', saveSettings);

// Load settings on popup open
loadSettings();
updateSourceStats();
