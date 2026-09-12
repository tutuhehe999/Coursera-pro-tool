/**
 * Coursera Pro Tool - Coursera API Interactions
 * Helper functions for interacting with Coursera's internal APIs
 */

import { getMetadata, extractUserId } from './metadata.js';

/**
 * Get the CAUTH token from cookies via background script
 * @returns {Promise<string>}
 */
export async function getCauthToken() {
  const result = await chrome.storage.local.get(['CAUTH']);
  return result.CAUTH || '';
}

/**
 * Fetch course structure (weeks, items)
 * @param {string} courseSlug
 * @returns {Promise<object>}
 */
export async function fetchCourseStructure(courseSlug) {
  const response = await fetch(
    `https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=${courseSlug}&includes=modules%2Clessons%2CpassableItemGroups%2CpassableItemGroupChoices%2CpassableLessonElements%2Citems%2Ctracks%2CgradePolicy&fields=onDemandCourseMaterialModules.v1(name,slug,description,timeCommitment,lessonIds,optional,learningObjectives),onDemandCourseMaterialLessons.v1(name,slug,timeCommitment,elementIds,optional,trackId),onDemandCourseMaterialPassableItemGroups.v1(requiredPassedCount,passableItemGroupChoiceIds,trackId),onDemandCourseMaterialPassableItemGroupChoices.v1(name,description,itemIds),onDemandCourseMaterialPassableLessonElements.v1(gradingWeight,isRequiredForPassing),onDemandCourseMaterialItems.v2(name,slug,timeCommitment,contentSummary,isLocked,lockableByItem,itemLockedReasonCode,trackId,lockedStatus,itemLockSummary),onDemandCourseMaterialTracks.v1(passablesCount)`,
    { credentials: 'include' }
  );
  if (response.ok) {
    const ct = response.headers.get('content-type') || '';
    if (ct.includes('application/json')) return response.json();
  }
  return {};
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(graphqlBody),
      credentials: 'include',
    });
    if (res.ok) return res;
  } catch (_e) {}

  return fetch('https://www.coursera.org/graphqlBatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

  // Strategy 1: onDemandPeerAssignmentPermissions.v1 with userId~courseId~itemId (exact original build engine)
  if (learnerId && courseId && itemId) {
    try {
      const permUrl = `https://www.coursera.org/api/onDemandPeerAssignmentPermissions.v1/${learnerId}~${courseId}~${itemId}/?fields=deleteSubmission%2ClistSubmissions%2CreviewPeers%2CviewReviewSchema%2CanonymousPeerReview%2ConDemandPeerSubmissionProgresses.v1(latestSubmissionSummary%2ClatestDraftSummary%2ClatestAttemptSummary)%2ConDemandPeerReceivedReviewProgresses.v1(evaluationIfReady%2CearliestCompletionTime%2CreviewCount%2CdefaultReceivedReviewRequiredCount)%2ConDemandPeerDisplayablePhaseSchedules.v1(currentPhase%2CphaseEnds%2CphaseStarts)&includes=receivedReviewsProgress%2CsubmissionProgress%2CphaseSchedule`;
      const res = await fetch(permUrl, { credentials: 'include' });
      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          return await res.json();
        }
      }
    } catch (_e) {}
  }

  // Strategy 2: onDemandPeerAssignments.v1 with courseId~itemId
  if (courseId && itemId) {
    try {
      const url = `https://www.coursera.org/api/onDemandPeerAssignments.v1/${courseId}~${itemId}/?fields=deleteSubmission%2ClistSubmissions%2CreviewPeers%2CviewReviewSchema%2CanonymousPeerReview%2ConDemandPeerSubmissionProgresses.v1(latestSubmissionSummary%2ClatestDraftSummary%2ClatestAttemptSummary)%2ConDemandPeerReceivedReviewProgresses.v1(evaluationIfReady%2CearliestCompletionTime%2CreviewCount%2CdefaultReceivedReviewRequiredCount)%2ConDemandPeerDisplayablePhaseSchedules.v1(currentPhase%2CphaseEnds%2CphaseStarts)&includes=receivedReviewsProgress%2CsubmissionProgress%2CphaseSchedule`;
      const res = await fetch(url, { credentials: 'include' });
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
