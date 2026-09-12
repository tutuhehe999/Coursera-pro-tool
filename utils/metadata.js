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
export function getMetadata() {
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

  // 3. URL-based parsing fallback
  const url = location.href;
  const match = url.match(
    /coursera\.org\/learn\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?/
  );

  const slug = match ? match[1] || '' : '';
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
export function extractUserId() {
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
export function getCourseSlug() {
  const match = location.href.match(/\/learn\/([^/]+)/);
  return match ? match[1] : '';
}

/**
 * Check if current page is a specific Coursera page type
 * @param {string} type
 * @returns {boolean}
 */
export function isPageType(type) {
  return location.href.includes(`/${type}/`);
}

/**
 * Extract assignment/quiz ID from the page
 * @returns {string|null}
 */
export function extractItemId() {
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
export function extractAssignmentSlug(itemId = '') {
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
export function generateRandomString(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
