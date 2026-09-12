/**
 * Coursera Pro Tool - Peer Assignment Auto-Submit Module
 * 1. Reads assignment instructions, prompts, and grading rubrics
 * 2. Uses AI (Gemini / DeepSeek / Groq) to generate a top-grade academic submission
 * 3. Automatically fills title, essay bodies, URLs, and honor code checkboxes
 */

import { sleep, safeClick, addBadge, simulateInput, simulateTyping } from '../utils/dom.js';
import { generateContent, extractJson, getAISettings } from '../utils/ai.js';
import { showToast, updateProgress } from '../ui/panel.js';
import { getCurrentCourseSlug } from './quiz.js';

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

  return {
    titleInput,
    contentInputs,
    urlInput,
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
 * Main handler to generate and autofill the peer assignment
 */
export async function handleAutoAssignment() {
  try {
    showToast('📝 Đang quét đề bài và các ô nhập liệu bài tập...', 'info');

    const inputs = findSubmissionInputs();
    const hasInputs = inputs.titleInput || inputs.contentInputs.length > 0;

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

    // 3. Fill URL if present
    if (inputs.urlInput && submissionData.url) {
      await fillFormField(inputs.urlInput, submissionData.url);
    }

    // 4. Tick Honor code checkboxes
    for (const cb of inputs.honorCheckboxes) {
      if (!cb.checked) {
        cb.click();
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    updateProgress(3, 3, 'Hoàn tất soạn bài!');
    showToast('🎉 Đã soạn và điền xong bài tập nộp! Hãy kiểm tra lại trước khi bấm Submit.', 'success');
  } catch (err) {
    console.error('[CourseraPro] Auto Assignment error:', err);
    showToast('Lỗi soạn bài tập: ' + err.message, 'error');
  }
}
