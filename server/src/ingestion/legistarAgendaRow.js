import { legistarItemKey } from './legistarIdentity.js';

/** Upper bound on stored matter text so one oversized staff report cannot bloat a row. */
export const MAX_MATTER_TEXT_CHARS = 20000;

function present(value) {
  return value != null && String(value).trim() !== '';
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

/**
 * Legistar matter text uses "..Title" / "..End" style section markers. Drop
 * those markers and blank runs, keep every sentence of the staff report.
 */
export function cleanMatterText(value) {
  if (!present(value)) return null;
  const text = String(value)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !/^\s*\.\.[a-z ]*$/i.test(line))
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return null;
  return text.length > MAX_MATTER_TEXT_CHARS ? text.slice(0, MAX_MATTER_TEXT_CHARS) : text;
}

/**
 * Build the searchable agenda text. The matter text (staff report and
 * recommended action) is included because grantee, vendor and applicant names
 * frequently appear only there — e.g. Sonoma County 2019-1709 lists
 * "LandPaths, $20,000" only in its recommended action, not in the title.
 */
export function buildLegistarItemText({ title, description, item = {}, matterText = null }) {
  return [
    title,
    description,
    item.EventItemMinutesNote ?? item.MinutesNote,
    item.EventItemActionText,
    cleanMatterText(matterText),
  ].filter(present).join('\n') || null;
}

/**
 * Single source of truth for converting a Legistar EventItem into an
 * agenda_items row (camelCase Prisma field names). Used by the nightly sync and
 * the admin "sync now" path so both store identical text.
 */
export function buildLegistarAgendaRow({ source, meeting = {}, meetingId, item, matterText = null }) {
  const baseUrl = source.legistarBaseUrl ?? source.legistar_base_url ?? source.baseUrl;
  const title = item.EventItemTitle ?? item.EventItemMatterName ?? item.MatterName ?? item.Title ?? item.title ?? 'Untitled agenda item';
  const description = item.EventItemAgendaNote ?? item.AgendaNote ?? null;
  const matterId = item.EventItemMatterId ?? item.MatterId;
  return {
    sourceType: 'legistar',
    legistarItemId: legistarItemKey(baseUrl, item.EventItemId ?? item.event_item_id ?? item.id),
    legistarEventId: String(meetingId),
    legistarMatterId: matterId != null ? String(matterId) : null,
    cityName: source.cityName ?? source.city_name ?? source.name ?? 'unknown-city',
    cityId: source.id ?? null,
    title,
    description,
    itemText: buildLegistarItemText({ title, description, item, matterText }),
    sourceUrl: meeting.EventInSiteURL ?? meeting.EventAgendaFile ?? null,
    agendaNumber: item.EventItemAgendaNumber ?? item.AgendaNumber ?? null,
    bodyName: meeting.EventBodyName ?? meeting.bodyName ?? null,
    meetingDate: parseDate(meeting.EventDate ?? meeting.event_date ?? meeting.date),
    eventItemPassedFlag: item.EventItemPassedFlag == null ? null : Boolean(item.EventItemPassedFlag),
    legistarItemPayload: item,
  };
}
