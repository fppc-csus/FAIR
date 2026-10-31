import { detectConflictsForAgendaItems } from './detectConflicts.js';

const OFFICIAL_SLUG = 'fair-demo-fictional-official-001';
const VENDOR = 'FAIR SYNTHETIC VENDOR ALPHA 001';
const MATCH_ID = 'fair-demo:matching-agenda-001';
const CONTROL_ID = 'fair-demo:control-agenda-001';

export async function getSyntheticConflictStatus(prisma) {
  const politician = await prisma.politician.findUnique({ where: { slug: OFFICIAL_SLUG } });
  if (!politician?.isDemo) return { exists: false, passed: false };
  const items = await prisma.agendaItem.findMany({
    where: { isDemo: true, legistarItemId: { in: [MATCH_ID, CONTROL_ID] } },
  });
  const matching = items.find((item) => item.legistarItemId === MATCH_ID);
  const control = items.find((item) => item.legistarItemId === CONTROL_ID);
  const conflicts = await prisma.conflict.findMany({
    where: { politicianId: politician.id, agendaItemId: { in: items.map((item) => item.id) } },
  });
  const expected = conflicts.filter((conflict) => conflict.agendaItemId === matching?.id
    && conflict.conflictType === 'INCOME' && conflict.entityName === VENDOR);
  const controlConflicts = conflicts.filter((conflict) => conflict.agendaItemId === control?.id);
  return {
    exists: true,
    passed: Boolean(matching && control && expected.length === 1 && controlConflicts.length === 0),
    official: politician.fullName,
    vendor: VENDOR,
    disclosureAmount: '$5,000',
    matchingAgendaId: matching?.id ?? null,
    controlAgendaId: control?.id ?? null,
    conflictIds: expected.map((conflict) => conflict.id),
    controlConflictCount: controlConflicts.length,
  };
}

export async function runSyntheticConflictCheck(prisma) {
  const items = await prisma.$transaction(async (tx) => {
    const existingOfficial = await tx.politician.findUnique({ where: { slug: OFFICIAL_SLUG } });
    const existingItems = await tx.agendaItem.findMany({
      where: { legistarItemId: { in: [MATCH_ID, CONTROL_ID] } },
    });
    if ((existingOfficial && !existingOfficial.isDemo) || existingItems.some((item) => !item.isDemo)) {
      throw new Error('Refusing to overwrite non-demo records with reserved fixture identities');
    }
    const politician = await tx.politician.upsert({
      where: { slug: OFFICIAL_SLUG },
      create: { slug: OFFICIAL_SLUG, fullName: 'FAIR TEST OFFICIAL 001 — NOT A REAL PERSON',
        officeTitle: 'Fictional demo official', district: 'FAIR DEMO — Fictional County', isDemo: true },
      update: { isDemo: true },
    });
    const filing = await tx.form700Filing.upsert({
      where: { politicianId_filingYear: { politicianId: politician.id, filingYear: 2025 } },
      create: { politicianId: politician.id, filingYear: 2025, filerName: politician.fullName,
        originalFilename: 'SYNTHETIC-DATABASE-FIXTURE-NOT-AN-UPLOADED-FORM.xlsx' },
      update: {},
    });
    // This fixture owns this filing; replace its schedule to keep reruns deterministic.
    await tx.scheduleCdeIncome.deleteMany({ where: { filingId: filing.id } });
    await tx.scheduleCdeIncome.create({ data: { filingId: filing.id, politicianId: politician.id,
      scheduleType: 'C', sourceName: VENDOR, amount: '$5,000' } });
    const rows = [];
    for (const [key, title] of [
      [MATCH_ID, `SYNTHETIC TEST ONLY: Approve a service agreement with ${VENDOR}.`],
      [CONTROL_ID, 'SYNTHETIC TEST ONLY: Approve the fictional county meeting calendar.'],
    ]) {
      const row = { title, itemText: title, isDemo: true, sourceType: 'demo',
        cityName: 'FAIR DEMO — Fictional County', meetingDate: new Date('2025-11-04T00:00:00Z') };
      rows.push(await tx.agendaItem.upsert({
        where: { legistarItemId: key }, create: { ...row, legistarItemId: key }, update: row,
      }));
    }
    return rows;
  });
  const ids = items.map((item) => item.id);
  const firstRun = await detectConflictsForAgendaItems(ids, { prisma });
  const secondRun = await detectConflictsForAgendaItems(ids, { prisma });
  const status = await getSyntheticConflictStatus(prisma);
  if (!status.passed || secondRun.inserted !== 0) throw new Error('Synthetic conflict assertion failed');
  return { ...status, firstRun, secondRun };
}

export async function removeSyntheticConflictCheck(prisma) {
  await prisma.$transaction(async (tx) => {
    await tx.agendaItem.deleteMany({
      where: { isDemo: true, legistarItemId: { in: [MATCH_ID, CONTROL_ID] } },
    });
    await tx.politician.deleteMany({ where: { slug: OFFICIAL_SLUG, isDemo: true } });
  });
}