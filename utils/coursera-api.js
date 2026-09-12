/**
 * Coursera Pro Tool - Coursera API Interactions
 * Comprehensive API client for Coursera REST APIs and GraphQL Gateway.
 * Supports direct bypass for videos, readings, widgets, and coaches.
 */

import { getMetadata, extractUserId } from './metadata.js';

/**
 * Extract CSRF token from document.cookie
 * @returns {string}
 */
export function getCsrfToken() {
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
export function getApiHeaders(isJson = true) {
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
export async function getCauthToken() {
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
export async function getCurrentUserId() {
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
export async function fetchCourseStructure(courseSlug) {
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
export async function fetchCourseCompletedItems(userId, courseId) {
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
export async function apiCompleteSupplement(courseId, itemId, userId) {
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
export async function apiCompleteVideo(userId, courseSlug, courseId, itemId, timeCommitment = 60000) {
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
export async function apiCompleteWidget(userId, courseId, itemId) {
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
export async function apiCompleteCoach(userId, courseId, itemId) {
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
export async function apiCompleteLti(userId, courseId, itemId) {
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
export async function fetchCourseDiscussions(courseSlug) {
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
export async function resolveItem(courseSlug, itemId) {
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
export async function requestGradingByPeer(courseId, itemId, submissionId, reason = 'EXPECTED_HIGHER_SCORE|ok') {
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
export async function fetchPeerSubmissionInfo(courseId, itemId, userId = '') {
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
export async function apiInitiateAttempt(courseId, itemId) {
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
