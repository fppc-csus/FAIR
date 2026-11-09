import { scheduleEligibilityReprocessing, dispatchEligibilityReprocessing } from './scheduleEligibilityReprocessing.js';

const FIELDS = {
  politician: { model: 'politician', field: 'jurisdictionId', verified: 'jurisdictionVerifiedId', at: 'jurisdictionVerifiedAt', by: 'jurisdictionVerifiedBy' },
  filing: { model: 'form700Filing', field: 'filingYear', verified: 'filingYearVerifiedValue', at: 'filingYearVerifiedAt', by: 'filingYearVerifiedBy' },
  agenda: { model: 'agendaItem', field: 'meetingDate', verified: 'meetingDateVerifiedValue', at: 'meetingDateVerifiedAt', by: 'meetingDateVerifiedBy' },
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function observedValue(kind, row) {
  return kind === 'agenda' ? row.meetingDate ?? row.meeting?.meetingDate ?? null : row[FIELDS[kind].field];
}

function normalizedValue(kind, value) {
  if (kind === 'filing') return Number.isInteger(value) && value >= 1900 && value <= 9999 ? value : null;
  if (kind === 'politician') return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  // Reject ambiguous date-only or locale-dependent text; the API sends ISO UTC.
  if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1900 || date.getUTCFullYear() > 9999) return null;
  if (typeof value === 'string') {
    const canonical = value.replace(/(\.\d{1,3})?Z$/, (_match, fraction = '') => `${(fraction || '.').padEnd(4, '0')}Z`);
    if (date.toISOString() !== canonical) return null;
  }
  return date.toISOString();
}

function invalidReason(kind, row, value) {
  if (kind === 'politician') return !row.jurisdictionId ? 'UNRESOLVED_POLITICIAN_JURISDICTION'
    : row.needsReview ? 'POLITICIAN_IDENTITY_REVIEW' : !value ? 'INVALID_POLITICIAN_JURISDICTION' : null;
  if (kind === 'filing') return value ? null : row.filingYear == null ? 'MISSING_FILING_YEAR' : 'INVALID_FILING_YEAR';
  if (!value) return row.meetingDate == null && row.meeting?.meetingDate == null ? 'MISSING_MEETING_DATE' : 'INVALID_MEETING_DATE';
  if (row.meetingDate && row.meeting?.meetingDate
    && normalizedValue('agenda', row.meetingDate) !== normalizedValue('agenda', row.meeting.meetingDate)) return 'AMBIGUOUS_MEETING_DATE';
  return null;
}

async function lockRecord(tx, kind, id, meetingId) {
  // Lock meeting before agenda item, matching the meeting-date trigger lock order.
  if (kind === 'agenda' && meetingId) await tx.$queryRaw`SELECT id FROM meetings WHERE id = ${meetingId}::uuid FOR UPDATE`;
  if (kind === 'politician') await tx.$queryRaw`SELECT id FROM politicians WHERE id = ${id}::uuid FOR UPDATE`;
  if (kind === 'filing') await tx.$queryRaw`SELECT id FROM form700_filings WHERE id = ${id}::uuid FOR UPDATE`;
  if (kind === 'agenda') await tx.$queryRaw`SELECT id FROM agenda_items WHERE id = ${id}::uuid FOR UPDATE`;
}

/** Confirm exactly the value an authenticated administrator inspected. */
export async function verifyEligibilityMetadata({ prisma, kind, id, expectedValue, adminUserId,
  queue }) {
  if (!FIELDS[kind]) throw new Error('Unknown eligibility metadata kind');
  if (!adminUserId || typeof adminUserId !== 'string' || !adminUserId.trim()) return { error: 'ADMIN_IDENTITY_REQUIRED' };
  const expected = normalizedValue(kind, expectedValue);
  if (expected === null) return { error: 'INVALID_EXPECTED_VALUE' };
  const { model, verified, at, by } = FIELDS[kind];

  const result = await prisma.$transaction(async (tx) => {
    // Read meetingId to establish lock order, then recheck it under the lock.
    const before = kind === 'agenda' ? await tx.agendaItem.findUnique({ where: { id }, select: { meetingId: true } }) : null;
    if (kind === 'agenda' && !before) return { error: 'NOT_FOUND' };
    await lockRecord(tx, kind, id, before?.meetingId);
    const row = await tx[model].findUnique({ where: { id }, ...(kind === 'agenda' ? { include: { meeting: true } } : {}) });
    if (!row) return { error: 'NOT_FOUND' };
    if (kind === 'agenda' && (row.meetingId ?? null) !== (before.meetingId ?? null)) return { error: 'STALE_VALUE' };
    const observed = normalizedValue(kind, observedValue(kind, row));
    const reason = invalidReason(kind, row, observed);
    if (reason) return { error: reason };
    if (kind === 'politician' && !await tx.jurisdiction.findUnique({ where: { id: row.jurisdictionId }, select: { id: true } })) {
      return { error: 'INVALID_POLITICIAN_JURISDICTION' };
    }
    if (observed !== expected) return { error: 'STALE_VALUE' };
    if (normalizedValue(kind, row[verified]) === observed && row[at] && row[by]) return { alreadyVerified: true };

    await tx[model].update({ where: { id }, data: {
      [verified]: observedValue(kind, row), [at]: new Date(), [by]: adminUserId,
    } });
    await tx.eligibilityVerificationEvent.create({ data: {
      recordType: kind, recordId: id, action: 'verified', value: String(observed), actorId: adminUserId,
    } });
    const detectionRunIds = await scheduleEligibilityReprocessing(tx, { kind, id, row });
    return { verified: true, detectionRunIds, detectionRunId: detectionRunIds[0] ?? null };
  });

  if (result.detectionRunIds) dispatchEligibilityReprocessing(result.detectionRunIds, queue);
  return result;
}