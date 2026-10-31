import { getAgendaItems, getMeetings } from "./legistarApi.js";

function sourceBaseUrl(source = {}) {
  return source.legistar_base_url ?? source.legistarBaseUrl ?? source.baseUrl ?? null;
}

function eventId(meeting = {}) {
  return meeting.EventId ?? meeting.event_id ?? meeting.id ?? null;
}

function dateWindow(options) {
  if (typeof options === 'number') return { lookbackDays: options };
  return options ?? {};
}

function isPublishedMeeting(meeting = {}) {
  const status = String(meeting.EventAgendaStatusName ?? meeting.agendaStatusName ?? '').trim().toLowerCase();
  const comment = String(meeting.EventComment ?? meeting.comment ?? '').trim().toLowerCase();
  return status !== 'hidden' && !/^test(?:\b|$)/.test(comment);
}

/**
 * Fetch Legistar meetings and their agenda items in the normalized shape used by
 * the schema-v2 nightly sync. Network work stays here; persistence is owned by
 * jobs/nightlySync.js.
 */
export async function fetchLegistarAgendaItemsForDataSource(source, options = {}) {
  const baseUrl = sourceBaseUrl(source);
  if (!baseUrl) {
    throw new Error("Legistar data source is missing legistar_base_url");
  }

  const window = dateWindow(options);
  const now = window.now instanceof Date ? window.now : new Date(window.now ?? Date.now());
  const lookbackDays = window.lookbackDays ?? 30;
  const startDate = window.startDate ?? new Date(now.getTime() - lookbackDays * 86400000);
  const meetings = await getMeetings(baseUrl, {
    startDate,
    endDate: window.endDate,
    pageSize: window.pageSize,
    maxResults: window.maxMeetings,
    timeoutMs: window.timeoutMs,
  });
  const includedMeetings = window.includeUnpublished
    ? meetings
    : meetings.filter(isPublishedMeeting);

  const itemGroups = [];
  const concurrency = Math.max(1, Math.min(window.concurrency ?? 5, 20));
  for (let index = 0; index < includedMeetings.length; index += concurrency) {
    const group = includedMeetings.slice(index, index + concurrency);
    const results = await Promise.all(group.map(async (meeting) => {
      const meetingId = eventId(meeting);
      if (meetingId == null) return [];
      const items = await getAgendaItems(baseUrl, meetingId);
      return items.map((item) => ({ item, meeting, meetingId }));
    }));
    itemGroups.push(...results);
  }

  return {
    baseUrl,
    meetings: includedMeetings,
    allItems: itemGroups.flat(),
  };
}

/**
 * Backwards-compatible entry point for older callers. The canonical pipeline is
 * now runNightlyLegistarSync, which uses the schema-v2 tables, detects only new
 * agenda items, and records per-source sync logs.
 */
export async function runLegistarIngestion(options = {}) {
  const { runNightlyLegistarSync } = await import("../jobs/nightlySync.js");
  return runNightlyLegistarSync(options);
}
