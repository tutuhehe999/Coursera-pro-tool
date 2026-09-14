/**
 * Coursera Pro Tool - Multi-Provider AI Engine
 * Supports:
 * 1. Google Gemini (REST API v1beta)
 * 2. DeepSeek (OpenAI-compatible Chat Completions - V3 & R1)
 * 3. Groq (OpenAI-compatible Chat Completions - Ultra-fast Llama 3.3)
 */

import { cleanText, wordOverlapRatio, getBlacklistedAnswersForQuestion, isAnswerBlacklisted } from './dom.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export const PROVIDER_DEFAULT_MODELS = {
  gemini: 'gemini-3.5-flash',
  deepseek: 'deepseek-chat',
  groq: 'llama-3.3-70b-versatile',
};

export const PROVIDER_MODELS = {
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
export function normalizeModelName(provider, model) {
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
export async function getAISettings() {
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
export function extractJson(text) {
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
export async function generateContent(prompt, systemInstruction = '', responseSchema = null, options = {}) {
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
export async function generateQuizAnswers(questions, extraOptions = {}) {
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
      const qBlacklist = getBlacklistedAnswersForQuestion(promptText, blacklist);
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
export async function generateDiscussionResponse(prompt, options = {}) {
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
export function generateUniqueFallbackResponse(prompt, perspective = '') {
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
export async function testApiKey(apiKey, provider = 'gemini') {
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
export async function getAvailableModels(provider = 'gemini') {
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
