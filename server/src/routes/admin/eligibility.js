import express from 'express';
import { prisma } from '../../lib/prisma.js';
import { verifyEligibilityMetadata } from '../../detection/verifyEligibility.js';
import { scheduleEligibilityReprocessing, dispatchEligibilityReprocessing } from '../../detection/scheduleEligibilityReprocessing.js';

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseValue(kind, value) {
  if (value === null) return null;
  if (kind === 'politician') return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : undefined;
  if (kind === 'filing') return Number.isInteger(value) && value >= 1900 && value <= 9999 ? value : undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1900 || date.getUTCFullYear() > 9999) return undefined;
  return date.toISOString();
}

router.post('/:kind/:id/correct', async (req, res, next) => {
  try {
    const { kind, id } = req.params;
    if (!['politician', 'filing', 'agenda'].includes(kind) || !UUID.test(id)) return res.status(400).json({ error: 'Invalid record.' });
    if (!req.user?.id) return res.status(403).json({ error: 'Authenticated administrator identity required.' });
    const { expectedValue, correctedValue } = req.body ?? {};
    const expected = parseValue(kind, expectedValue);
    const corrected = parseValue(kind, correctedValue);
    if (expected === undefined || corrected == null) return res.status(400).json({ error: 'Supply a valid reviewed value and a non-empty correction.' });
    const result = await prisma.$transaction(async (tx) => {
      const before = kind === 'agenda' ? await tx.agendaItem.findUnique({ where: { id }, select: { meetingId: true } }) : null;
      if (kind === 'agenda' && !before) return { error: 'NOT_FOUND' };
      // Match confirmation's meeting -> agenda lock order to prevent deadlocks.
      if (before?.meetingId) await tx.$queryRaw`SELECT id FROM meetings WHERE id = ${before.meetingId}::uuid FOR UPDATE`;
      const table = kind === 'politician' ? 'politicians' : kind === 'filing' ? 'form700_filings' : 'agenda_items';
      await tx.$queryRawUnsafe(`SELECT id FROM ${table} WHERE id = $1::uuid FOR UPDATE`, id);
      const model = kind === 'politician' ? tx.politician : kind === 'filing' ? tx.form700Filing : tx.agendaItem;
      const row = await model.findUnique({ where: { id }, ...(kind === 'agenda' ? { include: { meeting: true } } : {}) });
      if (!row) return { error: 'NOT_FOUND' };
      if (kind === 'agenda' && before.meetingId !== row.meetingId) return { error: 'STALE_VALUE' };
      const current = kind === 'politician' ? row.jurisdictionId : kind === 'filing' ? row.filingYear : row.meetingDate ?? row.meeting?.meetingDate ?? null;
      const observed = current instanceof Date ? current.toISOString() : current ?? null;
      if (observed !== expected) return { error: 'STALE_VALUE' };
      if (observed === corrected) return { error: 'UNCHANGED_VALUE' };
      if (kind === 'politician' && !await tx.jurisdiction.findUnique({ where: { id: corrected }, select: { id: true } })) return { error: 'INVALID_JURISDICTION' };
      if (kind === 'filing' && await tx.form700Filing.findFirst({ where: { politicianId: row.politicianId, filingYear: corrected, NOT: { id } }, select: { id: true } })) return { error: 'DUPLICATE_FILING_YEAR' };
      if (kind === 'politician') await tx.politician.update({ where: { id }, data: { jurisdictionId: corrected } });
      if (kind === 'filing') await tx.form700Filing.update({ where: { id }, data: { filingYear: corrected } });
      if (kind === 'agenda') {
        if (row.meetingId) await tx.meeting.update({ where: { id: row.meetingId }, data: { meetingDate: new Date(corrected) } });
        await tx.agendaItem.update({ where: { id }, data: { meetingDate: new Date(corrected) } });
      }
      await tx.eligibilityVerificationEvent.create({ data: {
        recordType: kind, recordId: id, action: 'corrected', value: `${observed ?? 'null'} -> ${corrected}`, actorId: req.user.id,
      } });
      const agendaItemIds = kind === 'agenda' && row.meetingId
        ? (await tx.agendaItem.findMany({ where: { meetingId: row.meetingId }, select: { id: true } })).map(item => item.id)
        : undefined;
      const detectionRunIds = await scheduleEligibilityReprocessing(tx, {
        kind, id, row, correctedFilingYear: kind === 'filing' ? corrected : undefined, agendaItemIds,
      });
      return { corrected: true, value: corrected, verified: false, detectionRunIds };
    });
    if (result.error) return res.status(result.error === 'NOT_FOUND' ? 404 : result.error === 'STALE_VALUE' || result.error === 'DUPLICATE_FILING_YEAR' ? 409 : 400).json({ error: result.error });
    dispatchEligibilityReprocessing(result.detectionRunIds);
    return res.json({ data: result });
  } catch (error) {
    if (error?.code === 'P2002') return res.status(409).json({ error: 'DUPLICATE_FILING_YEAR' });
    return next(error);
  }
});

router.post('/:kind/:id/verify', async (req, res, next) => {
  try {
    if (!['politician', 'filing', 'agenda'].includes(req.params.kind) || !UUID.test(req.params.id)) {
      return res.status(400).json({ error: 'Expected politician, filing, or agenda and a UUID.' });
    }
    if (!req.user?.id) return res.status(403).json({ error: 'Authenticated administrator identity required.' });
    const result = await verifyEligibilityMetadata({
      prisma, kind: req.params.kind, id: req.params.id,
      expectedValue: req.body?.expectedValue,
      adminUserId: req.user.id,
    });
    if (result.error) return res.status(result.error === 'NOT_FOUND' ? 404
      : ['INVALID_EXPECTED_VALUE', 'ADMIN_IDENTITY_REQUIRED'].includes(result.error) ? 400 : 409).json({ error: result.error });
    return res.json({ data: result });
  } catch (error) { return next(error); }
});

export default router;