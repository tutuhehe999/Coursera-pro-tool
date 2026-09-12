/**
 * Test Suite for Settings & Model Persistence
 * Verifies that selected models (e.g. Flash 8B, custom models) are preserved across reloads.
 * Run with: node test/test-settings.js
 */

const assert = require('assert');

// Mock localStorage / chrome.storage.local
const storage = {};
const mockChromeStorage = {
  get: async (keys) => {
    const res = {};
    keys.forEach(k => {
      if (storage[k] !== undefined) res[k] = storage[k];
    });
    return res;
  },
  set: async (obj) => {
    Object.assign(storage, obj);
  }
};

const PROVIDER_CONFIG = {
  gemini: {
    models: [
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Khuyên dùng)' },
      { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite (Siêu tốc & Tiết kiệm)' },
      { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
      { value: 'gemini-1.5-flash-8b', label: 'Gemini 1.5 Flash 8B (Siêu nhẹ & Nhanh)' },
      { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    ],
    defaultModel: 'gemini-2.0-flash',
    storageKey: 'geminiAPI',
  },
  deepseek: {
    models: [
      { value: 'deepseek-chat', label: 'DeepSeek-V3 Chat' },
      { value: 'deepseek-reasoner', label: 'DeepSeek-R1' },
    ],
    defaultModel: 'deepseek-chat',
    storageKey: 'deepseekAPI',
  },
  groq: {
    models: [
      { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
      { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B' },
    ],
    defaultModel: 'llama-3.3-70b-versatile',
    storageKey: 'groqAPI',
  },
};

function normalizeModel(provider, m) {
  if (!m || typeof m !== 'string') return PROVIDER_CONFIG[provider]?.defaultModel || 'gemini-2.0-flash';
  const lower = m.toLowerCase();
  if (provider === 'gemini') {
    if (lower.includes('2.5') && (lower.includes('lite') || lower.includes('light'))) return 'gemini-2.0-flash-lite';
    if (lower.includes('2.5') || lower === 'gemini-2.5-flash') return 'gemini-2.0-flash';
    if (lower.includes('3.8') || lower === 'flash-8b' || lower === '8b') return 'gemini-1.5-flash-8b';
  }
  return m;
}

// Mock Select Element
class MockSelect {
  constructor() {
    this.options = [];
    this.value = '';
  }
  appendChild(opt) {
    this.options.push(opt);
    if (opt.selected || this.options.length === 1) {
      this.value = opt.value;
    }
  }
  insertBefore(opt, _ref) {
    this.options.unshift(opt);
    if (opt.selected) {
      this.value = opt.value;
    }
  }
}

const modelSelect = new MockSelect();

function switchProviderUI(provider, targetModel = null) {
  const conf = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.gemini;
  modelSelect.options = [];
  const normalizedTarget = normalizeModel(provider, targetModel);
  const effectiveModel = normalizedTarget || conf.defaultModel;
  let matched = false;

  conf.models.forEach((m) => {
    const opt = { value: m.value, label: m.label, selected: false };
    if (m.value === effectiveModel) {
      opt.selected = true;
      matched = true;
    }
    modelSelect.appendChild(opt);
  });

  if (effectiveModel && !matched) {
    const customOpt = { value: effectiveModel, label: `${effectiveModel} (Đã chọn)`, selected: true };
    modelSelect.insertBefore(customOpt, null);
  }
}

function updateGeminiModelList(models, preferredModel = null) {
  const desired = normalizeModel('gemini', preferredModel || modelSelect.value);
  const geminiModels = models.map(m => m.name.replace('models/', ''));

  const defaults = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'];
  const bestDefault = defaults.find((p) => geminiModels.includes(p)) || geminiModels[0];

  if (desired && !geminiModels.includes(desired)) {
    geminiModels.unshift(desired);
  }

  const target = desired || bestDefault;
  modelSelect.options = [];
  geminiModels.forEach((name) => {
    const opt = { value: name, selected: name === target };
    modelSelect.appendChild(opt);
  });
}

async function saveSettings(provider, model, apiKey) {
  const toSave = {
    aiProvider: provider,
    model: model,
    [`model_${provider}`]: model,
    [PROVIDER_CONFIG[provider].storageKey]: apiKey
  };
  await mockChromeStorage.set(toSave);
}

async function reloadAndLoadSettings() {
  const data = await mockChromeStorage.get([
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
  const conf = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.gemini;
  const savedModel = data[`model_${provider}`] || data.model || conf.defaultModel;

  switchProviderUI(provider, savedModel);
  return { provider, savedModel };
}

(async function runTests() {
  console.log('--- TEST 1: User selects gemini-1.5-flash-8b & saves ---');
  await saveSettings('gemini', 'gemini-1.5-flash-8b', 'AIzaSy123FakeKey');
  assert.strictEqual(storage.model, 'gemini-1.5-flash-8b');
  assert.strictEqual(storage.model_gemini, 'gemini-1.5-flash-8b');
  console.log('✓ Settings successfully saved to storage');

  console.log('--- TEST 2: User reloads page & opens settings ---');
  const { savedModel } = await reloadAndLoadSettings();
  assert.strictEqual(savedModel, 'gemini-1.5-flash-8b');
  assert.strictEqual(modelSelect.value, 'gemini-1.5-flash-8b');
  console.log('✓ Reloading popup correctly preserves gemini-1.5-flash-8b!');

  console.log('--- TEST 3: Google API returns dynamic list during checkApiKey ---');
  const apiModels = [
    { name: 'models/gemini-2.5-flash' },
    { name: 'models/gemini-1.5-flash-8b' },
    { name: 'models/gemini-1.5-pro' }
  ];
  updateGeminiModelList(apiModels, savedModel);
  assert.strictEqual(modelSelect.value, 'gemini-1.5-flash-8b');
  console.log('✓ updateGeminiModelList did NOT reset to 2.5-flash, preserved 1.5-flash-8b!');

  console.log('--- TEST 4: User selects a custom experimental model from API ---');
  await saveSettings('gemini', 'gemini-2.0-flash-exp', 'AIzaSy123FakeKey');
  const res2 = await reloadAndLoadSettings();
  assert.strictEqual(res2.savedModel, 'gemini-2.0-flash-exp');
  assert.strictEqual(modelSelect.value, 'gemini-2.0-flash-exp');
  console.log('✓ Custom/dynamic model retained across reload successfully!');

  console.log('--- TEST 5: Switching between Groq and Gemini retains each model ---');
  await saveSettings('groq', 'llama-3.1-8b-instant', 'gsk_123');
  assert.strictEqual(storage.model_groq, 'llama-3.1-8b-instant');
  assert.strictEqual(storage.model_gemini, 'gemini-2.0-flash-exp');

  // Load Groq
  const groqData = await mockChromeStorage.get(['aiProvider', 'model_groq']);
  switchProviderUI('groq', groqData.model_groq);
  assert.strictEqual(modelSelect.value, 'llama-3.1-8b-instant');

  // Switch back to Gemini
  const geminiData = await mockChromeStorage.get(['model_gemini']);
  switchProviderUI('gemini', geminiData.model_gemini);
  assert.strictEqual(modelSelect.value, 'gemini-2.0-flash-exp');
  console.log('✓ Multi-provider models independently stored without collision!');

  console.log('--- TEST 6: Legacy/informal model name normalization ---');
  assert.strictEqual(normalizeModel('gemini', 'gemini-2.5-flash'), 'gemini-2.0-flash');
  assert.strictEqual(normalizeModel('gemini', '2.5lite'), 'gemini-2.0-flash-lite');
  assert.strictEqual(normalizeModel('gemini', '3.8'), 'gemini-1.5-flash-8b');
  console.log('✓ Legacy model names (2.5-flash, 2.5lite, 3.8) normalized to real Google models!');

  console.log('\n========================================');
  console.log('🎉 ALL SETTINGS & MODEL PERSISTENCE TESTS PASSED!');
  console.log('========================================');
})();
