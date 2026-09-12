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
export function createPanel(handlers) {
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
export function togglePanelMinimize(forceState = null) {
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
export function showToast(message, type = 'info') {
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
export function updateProgress(current, total, text = '') {
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
export function setDiscussionActive(isActive, text = '') {
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
export function displayShareLink(url) {
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
export function removePanel() {
  if (panelEl) {
    panelEl.remove();
    panelEl = null;
  }
}
