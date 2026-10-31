//Rhys Honaker, Test 2
/**
 * Legistar API wrapper module
 * Provides clean async functions for fetching meetings, agenda items, and votes
 */

const BASE_API_URL = 'https://webapi.legistar.com/v1';

/**
 * Sleep for a given number of milliseconds
 * @param {number} ms - milliseconds to sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Make a request to the Legistar API with retry on 429
 * @param {string} url - the full URL to request
 * @param {object} options - fetch options
 * @returns {Promise<object>} - the JSON response
 */
async function apiRequest(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30000;
  const { timeoutMs: _timeoutMs, ...requestOptions } = options;
  const defaultOptions = {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'FAIR-Legistar-API/1.0'
    },
    signal: AbortSignal.timeout(timeoutMs),
  };

  const mergedOptions = { ...defaultOptions, ...requestOptions };

  try {
    const response = await fetch(url, mergedOptions);

    if (response.status === 429) {
      // Rate limited, wait 2 seconds and retry once
      await sleep(2000);
      const retryResponse = await fetch(url, mergedOptions);
      if (!retryResponse.ok) {
        throw new Error(`API request failed after retry: ${retryResponse.status} ${retryResponse.statusText}`);
      }
      return await retryResponse.json();
    }

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    if (error.message.includes('API request failed')) {
      throw error;
    }
    throw new Error(`Network error: ${error.message}`);
  }
}

function dateOnly(value, label) {
  if (value == null || value === '') return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`${label} must be a valid date`);
  return parsed.toISOString().slice(0, 10);
}

function addUtcDays(date, days) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function normalizeMeeting(meeting) {
  return {
    id: meeting.EventId,
    date: meeting.EventDate,
    time: meeting.EventTime,
    location: meeting.EventLocation,
    bodyName: meeting.EventBodyName,
    agendaFile: meeting.EventAgendaFile,
    minutesFile: meeting.EventMinutesFile,
    comment: meeting.EventComment,
    ...meeting // include all other fields
  };
}

/**
 * Get meetings from a Legistar jurisdiction. Date ranges are inclusive and
 * results are paginated because many jurisdictions cap a single Events query.
 * Passing a number retains the older "upcoming N meetings" API.
 * @param {string} baseUrl
 * @param {number|object} limitOrOptions
 * @returns {Promise<Array<object>>}
 */
async function getMeetings(baseUrl, limitOrOptions = 50) {
  const legacyLimit = typeof limitOrOptions === 'number' ? limitOrOptions : null;
  const options = legacyLimit == null ? limitOrOptions : {
    startDate: new Date(),
    maxResults: legacyLimit,
    pageSize: legacyLimit,
    order: 'desc',
  };
  const startDate = dateOnly(options.startDate, 'startDate');
  const endDate = dateOnly(options.endDate, 'endDate');
  if (startDate && endDate && startDate > endDate) {
    throw new Error('startDate must be on or before endDate');
  }

  const maxResults = options.maxResults ?? 5000;
  const pageSize = Math.max(1, Math.min(options.pageSize ?? 100, 1000, maxResults));
  const order = options.order === 'desc' ? 'desc' : 'asc';
  const meetings = [];

  for (let skip = 0; meetings.length < maxResults; skip += pageSize) {
    const url = new URL(`${baseUrl}/Events`);
    url.searchParams.set('$top', Math.min(pageSize, maxResults - meetings.length).toString());
    url.searchParams.set('$skip', skip.toString());
    url.searchParams.set('$orderby', `EventDate ${order}, EventId ${order}`);
    const filters = [];
    if (startDate) filters.push(`EventDate ge datetime'${startDate}'`);
    // Legistar timestamps are midnight-based. Using the following day makes the
    // caller-facing end date inclusive without relying on time components.
    if (endDate) filters.push(`EventDate lt datetime'${addUtcDays(endDate, 1)}'`);
    if (filters.length) url.searchParams.set('$filter', filters.join(' and '));

    const page = await apiRequest(url.toString(), { timeoutMs: options.timeoutMs });
    if (!Array.isArray(page)) {
      throw new Error('Unexpected response format: expected array of meetings');
    }
    meetings.push(...page.map(normalizeMeeting));
    if (page.length < pageSize) break;
  }

  return meetings;
}

/**
 * Get agenda items for a specific meeting
 * @param {string} baseUrl - the base URL for the jurisdiction
 * @param {string|number} meetingId - the EventId of the meeting
 * @returns {Promise<Array<object>>} - array of agenda item objects
 */
async function getAgendaItems(baseUrl, meetingId) {
  const url = `${baseUrl}/Events/${meetingId}/EventItems`;

  const data = await apiRequest(url);

  // Normalize to array of objects
  if (!Array.isArray(data)) {
    throw new Error('Unexpected response format: expected array of agenda items');
  }

  return data.map(item => ({
    id: item.EventItemId,
    eventId: item.EventItemEventId ?? item.EventId,
    matterId: item.EventItemMatterId ?? item.MatterId,
    matterName: item.EventItemMatterName ?? item.MatterName,
    matterType: item.EventItemMatterType ?? item.MatterTypeName,
    agendaNumber: item.EventItemAgendaNumber ?? item.AgendaNumber,
    agendaNote: item.EventItemAgendaNote ?? item.AgendaNote,
    minutesNote: item.EventItemMinutesNote ?? item.MinutesNote,
    ...item // include all other fields
  }));
}

/**
 * Get votes for a specific matter (agenda item)
 * @param {string} baseUrl - the base URL for the jurisdiction
 * @param {string|number} matterId - the EventItemId of the matter
 * @returns {Promise<Array<object>>} - array of vote objects
 */
async function getVotes(baseUrl, matterId) {
  const url = `${baseUrl}/EventItems/${matterId}/Votes`;

  const data = await apiRequest(url);

  // Normalize to array of objects
  if (!Array.isArray(data)) {
    throw new Error('Unexpected response format: expected array of votes');
  }

  return data.map(vote => ({
    id: vote.VoteId,
    eventItemId: vote.EventItemId,
    personId: vote.PersonId,
    personName: vote.PersonName,
    voteTypeId: vote.VoteTypeId,
    voteTypeName: vote.VoteTypeName,
    voteValueId: vote.VoteValueId,
    voteValueName: vote.VoteValueName,
    ...vote // include all other fields
  }));
}

export { getMeetings, getAgendaItems, getVotes };