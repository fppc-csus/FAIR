import { getAgendaItems, getMatterText, getMatterVersions, getMeetings } from "./legistarApi.js";

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

  const allItems = itemGroups.flat();
  const matterText = window.includeMatterText === false
    ? { texts: new Map(), failures: 0 }
    : await fetchMatterTexts(baseUrl, allItems.map(({ item }) => item.EventItemMatterId ?? item.MatterId), {
      concurrency,
      getVersions: window.getMatterVersions ?? getMatterVersions,
      getText: window.getMatterText ?? getMatterText,
    });

  return {
    baseUrl,
    meetings: includedMeetings,
    allItems: allItems.map((entry) => ({
      ...entry,
      matterText: matterText.texts.get(String(entry.item.EventItemMatterId ?? entry.item.MatterId)) ?? null,
    })),
    matterTextFailures: matterText.failures,
  };
}

/**
 * Fetch the latest MatterTextPlain for each distinct matter. A failed lookup
 * is counted but never fails the sync: the item is still stored with its title.
 * Versions returns [{ Key: MatterTextId, Value: MatterVersion }].
 */
export async function fetchMatterTexts(baseUrl, matterIds, { concurrency = 5, getVersions = getMatterVersions, getText = getMatterText } = {}) {
  const ids = [...new Set(matterIds.filter((id) => id != null && String(id).trim() !== "").map(String))];
  const texts = new Map();
  let failures = 0;
  for (let index = 0; index < ids.length; index += concurrency) {
    await Promise.all(ids.slice(index, index + concurrency).map(async (matterId) => {
      try {
        const versions = await getVersions(baseUrl, matterId);
        const latest = [...versions].sort((a, b) => Number(b.Value) - Number(a.Value) || Number(b.Key) - Number(a.Key))[0];
        if (!latest?.Key) return;
        const text = await getText(baseUrl, matterId, latest.Key);
        if (text?.MatterTextPlain) texts.set(matterId, text.MatterTextPlain);
      } catch {
        failures += 1;
      }
    }));
  }
  return { texts, failures };
}
