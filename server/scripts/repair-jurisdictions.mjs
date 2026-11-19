// Repairs jurisdiction links so agenda items and Form 700 filers meet.
//
//   node scripts/repair-jurisdictions.mjs           # dry run: prints the plan
//   node scripts/repair-jurisdictions.mjs --apply   # performs it in one transaction
//
// 1. Merges jurisdictions that are the same government spelled differently
//    ("Fresno" / "City of Fresno"), keeping the record with the most filers.
// 2. Links every data source to its jurisdiction (creating one if missing).
// 3. Deletes Apify sources whose start URL is a Legistar address (they can
//    never work; the Legistar source type is the correct one).
import { pathToFileURL } from 'node:url';
import { jurisdictionKey } from '../src/utils/jurisdictionName.js';

export function planJurisdictionRepair({ jurisdictions, dataSources }) {
  const groups = new Map();
  for (const row of jurisdictions) {
    const key = jurisdictionKey(row.name);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const merges = [];
  const keeperByKey = new Map();
  for (const [key, rows] of groups) {
    const ranked = [...rows].sort((a, b) => (b.politicianCount - a.politicianCount)
      || (new Date(a.createdAt) - new Date(b.createdAt)));
    keeperByKey.set(key, ranked[0]);
    for (const duplicate of ranked.slice(1)) merges.push({ keep: ranked[0], remove: duplicate });
  }
  const brokenSources = dataSources.filter((source) => source.sourceType === 'apify'
    && /(^|\.)legistar1?\.com$/i.test(safeHost(source.startUrl)));
  const brokenIds = new Set(brokenSources.map((source) => source.id));
  const removedIds = new Set(merges.map(({ remove }) => remove.id));
  const links = [];
  const creates = [];
  for (const source of dataSources) {
    if (brokenIds.has(source.id)) continue;
    const keeper = keeperByKey.get(jurisdictionKey(source.cityName));
    if (!keeper) {
      creates.push(source);
    } else if (source.jurisdictionId !== keeper.id || removedIds.has(source.jurisdictionId)) {
      links.push({ source, jurisdiction: keeper });
    }
  }
  return { merges, links, creates, brokenSources };
}

function safeHost(value) {
  try { return new URL(value).hostname; } catch { return ''; }
}

export async function applyJurisdictionRepair(prisma, plan) {
  return prisma.$transaction(async (tx) => {
    for (const { keep, remove } of plan.merges) {
      const move = { where: { jurisdictionId: remove.id }, data: { jurisdictionId: keep.id } };
      await tx.politician.updateMany(move);
      await tx.meeting.updateMany(move);
      await tx.dataSource.updateMany(move);
      await tx.detectionRun.updateMany(move);
      await tx.conflict.updateMany(move);
      if (remove.legistarClientId && !keep.legistarClientId) {
        await tx.jurisdiction.update({ where: { id: remove.id }, data: { legistarClientId: null } });
        await tx.jurisdiction.update({ where: { id: keep.id }, data: { legistarClientId: remove.legistarClientId } });
      }
      await tx.jurisdiction.delete({ where: { id: remove.id } });
    }
    for (const { source, jurisdiction } of plan.links) {
      await tx.dataSource.update({ where: { id: source.id }, data: { jurisdictionId: jurisdiction.id } });
    }
    for (const source of plan.creates) {
      const created = await tx.jurisdiction.create({
        data: { name: source.cityName, type: jurisdictionKey(source.cityName).split(':')[0] },
      });
      await tx.dataSource.update({ where: { id: source.id }, data: { jurisdictionId: created.id } });
    }
    for (const source of plan.brokenSources) {
      await tx.dataSource.delete({ where: { id: source.id } });
    }
  }, { timeout: 60000 });
}

function describePlan(plan) {
  const lines = [];
  for (const { keep, remove } of plan.merges) lines.push(`MERGE  "${remove.name}" (${remove.politicianCount} filers) -> "${keep.name}" (${keep.politicianCount} filers)`);
  for (const { source, jurisdiction } of plan.links) lines.push(`LINK   source "${source.cityName}" (${source.sourceType}) -> jurisdiction "${jurisdiction.name}"`);
  for (const source of plan.creates) lines.push(`CREATE jurisdiction "${source.cityName}" for source ${source.id}`);
  for (const source of plan.brokenSources) lines.push(`DELETE Apify source "${source.cityName}" with Legistar start URL ${source.startUrl}`);
  return lines.length ? lines.join('\n') : 'Nothing to repair.';
}

async function main() {
  await import('../src/lib/env.js');
  const { prisma } = await import('../src/lib/prisma.js');
  try {
    const [jurisdictions, dataSources] = await Promise.all([
      prisma.jurisdiction.findMany({ include: { _count: { select: { politicians: true } } } }),
      prisma.dataSource.findMany(),
    ]);
    const plan = planJurisdictionRepair({
      jurisdictions: jurisdictions.map((row) => ({ ...row, politicianCount: row._count.politicians })),
      dataSources,
    });
    console.log(describePlan(plan));
    if (process.argv.includes('--apply')) {
      await applyJurisdictionRepair(prisma, plan);
      console.log('Applied.');
    } else {
      console.log('\nDry run only. Re-run with --apply to make these changes.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
