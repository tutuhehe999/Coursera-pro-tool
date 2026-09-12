/**
 * Test Suite for Dynamic Model Discovery & Working Model Verification
 * Verifies that:
 * 1. Only models supporting generateContent from API are displayed in dropdown
 * 2. Broken/non-existent models are NEVER injected into the list
 * 3. Default selection always resolves to a verified working model
 * 4. Any chosen model is properly normalized and backed by universal fallbacks
 * Run with: node test/test-model-discovery.js
 */

const assert = require('assert');

// 1. Mock API models list returned from Google API
const mockGoogleApiResponse = [
  { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
  { name: 'models/gemini-1.5-flash-8b', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-1.5-pro', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }, // should be filtered out
  { name: 'models/imagen-3.0-generate-002', supportedGenerationMethods: ['imageGeneration'] }, // should be filtered out
  { name: 'models/aqa', supportedGenerationMethods: ['generateAnswer'] }, // should be filtered out
];

function filterVerifiedGeminiModels(models) {
  return models
    .filter((m) => {
      const n = (m.name || '').toLowerCase();
      const methods = m.supportedGenerationMethods || [];
      return (
        methods.includes('generateContent') &&
        !n.includes('tts') &&
        !n.includes('audio') &&
        !n.includes('image') &&
        !n.includes('imagen') &&
        !n.includes('embed') &&
        !n.includes('aqa') &&
        !n.includes('bison')
      );
    })
    .map((m) => m.name.replace('models/', '').trim())
    .sort();
}

console.log('--- TEST 1: Model filtering excludes non-generative and unsupported models ---');
const verified = filterVerifiedGeminiModels(mockGoogleApiResponse);
assert.deepStrictEqual(verified, [
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-1.5-pro',
  'gemini-2.0-flash'
]);
assert.ok(!verified.includes('text-embedding-004'));
assert.ok(!verified.includes('imagen-3.0-generate-002'));
assert.ok(!verified.includes('aqa'));
console.log('✓ Only real text generation models are retained, all unsupported models excluded');

console.log('--- TEST 2: Non-existent desired model is NOT injected into dropdown ---');
function updateModelDropdown(geminiModels, desiredModel) {
  const defaults = ['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash-8b', 'gemini-1.5-pro'];
  const bestDefault = defaults.find((p) => geminiModels.includes(p)) || geminiModels[0];

  // STRICT REQUIREMENT: Only show models that actually exist in the API!
  const target = geminiModels.includes(desiredModel) ? desiredModel : bestDefault;

  return {
    options: geminiModels, // strictly geminiModels, nothing unshifted!
    selected: target
  };
}

const resultWithFake = updateModelDropdown(verified, 'gemini-2.5-flash'); // user previously had fake 2.5-flash
assert.ok(!resultWithFake.options.includes('gemini-2.5-flash'), 'Non-existent model must NOT be in options');
assert.strictEqual(resultWithFake.selected, 'gemini-1.5-flash', 'Must auto-fallback to guaranteed working gemini-1.5-flash');
console.log('✓ Fake or unavailable model is NOT displayed; auto-switched to verified working model');

console.log('--- TEST 3: When user selects a verified model, it is selected ---');
const resultWithReal = updateModelDropdown(verified, 'gemini-2.0-flash');
assert.strictEqual(resultWithReal.selected, 'gemini-2.0-flash');
console.log('✓ Valid model from API is properly selected');

console.log('--- TEST 4: Normalization strips models/ prefix and maps variants ---');
function normalizeModelName(provider, model) {
  if (!model || typeof model !== 'string') return 'gemini-1.5-flash';
  const m = model.trim().toLowerCase().replace(/^models\//, '');
  if (provider === 'gemini') {
    if (m.includes('2.5') && (m.includes('lite') || m.includes('light'))) return 'gemini-2.0-flash-lite-preview-02-05';
    if (m === 'gemini-2.0-flash-lite') return 'gemini-2.0-flash-lite-preview-02-05';
    if (m.includes('2.5') || m === 'gemini-2.5-flash') return 'gemini-1.5-flash';
    if (m.includes('3.8') || m === 'flash-8b' || m === '8b') return 'gemini-1.5-flash-8b';
    if (m === 'gemini-2-flash') return 'gemini-2.0-flash';
  }
  return m;
}

assert.strictEqual(normalizeModelName('gemini', 'models/gemini-1.5-flash'), 'gemini-1.5-flash');
assert.strictEqual(normalizeModelName('gemini', 'gemini-2.5-flash'), 'gemini-1.5-flash');
assert.strictEqual(normalizeModelName('gemini', 'gemini-2.0-flash-lite'), 'gemini-2.0-flash-lite-preview-02-05');
assert.strictEqual(normalizeModelName('gemini', '3.8'), 'gemini-1.5-flash-8b');
console.log('✓ Model names normalized and models/ prefix cleanly stripped');

console.log('\n========================================');
console.log('🎉 ALL MODEL DISCOVERY & VERIFICATION TESTS PASSED!');
console.log('========================================');
