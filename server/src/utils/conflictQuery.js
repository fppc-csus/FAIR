import { Prisma } from '@prisma/client';
import { parseExportFilters } from './conflictExport.js';

export const TYPES = ['INVESTMENT', 'REAL_ESTATE', 'BUSINESS_POSITION', 'INCOME', 'GIFT', 'TRAVEL'];
export const SEVERITIES = ['HIGH', 'MEDIUM', 'LOW'];
export const REVIEW_STATES = ['pending', 'confirmed_conflict', 'not_applicable'];
export function badRequest(message) {
  return Object.assign(new Error(message), { status: 400, publicMessage: message });
}
export function parseConflictQuery(query) {
  let filters;
  try { filters = parseExportFilters(query); } catch (error) { throw badRequest(error.message); }
  const scalar = (key, fallback) => {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== 'string' || !query[key]) throw badRequest(`Invalid ${key}`);
    return query[key];
  };
  const integer = (key, fallback, max) => {
    const value = scalar(key, String(fallback));
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw badRequest(`Invalid ${key}`);
    return Number(value);
  };
  if (filters.city.length > 200) throw badRequest('Invalid city');
  if (filters.politicianId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(filters.politicianId)) throw badRequest('Invalid politicianId');
  if (filters.types.some(value => !TYPES.includes(value))) throw badRequest('Invalid types');
  if (filters.severities.some(value => !SEVERITIES.includes(value))) throw badRequest('Invalid severities');
  const reviewStatus = scalar('reviewStatus', '');
  if (reviewStatus && !REVIEW_STATES.includes(reviewStatus)) throw badRequest('Invalid reviewStatus');
  const sort = scalar('sort', 'detectedAt');
  if (!['detectedAt', 'oldest', 'severity'].includes(sort)) throw badRequest('Invalid sort');
  const page = integer('page', 1, 1000000);
  const pageSize = integer('pageSize', query.limit === undefined ? 20 : integer('limit', 20, 100), 100);
  if (query.limit !== undefined) integer('limit', 20, 100);
  return { ...filters, reviewStatus, sort, page, pageSize };
}

// All user values are SQL parameters. Only fixed sort expressions are SQL text.
export function conflictSql(filters) {
  const terms = [Prisma.sql`p.is_demo = false AND a.is_demo = false AND (c.eligibility_status IS NULL OR c.eligibility_status = 'active')`];
  if (filters.politicianId) terms.push(Prisma.sql`c.politician_id = ${filters.politicianId}::uuid`);
  if (filters.city) terms.push(Prisma.sql`COALESCE(a.city_name, j.name, 'Unknown') = ${filters.city}`);
  if (filters.types.length) terms.push(Prisma.sql`c.conflict_type IN (${Prisma.join(filters.types)})`);
  if (filters.severities.length) terms.push(Prisma.sql`UPPER(c.severity) IN (${Prisma.join(filters.severities)})`);
  if (filters.reviewStatus) terms.push(Prisma.sql`c.review_status = ${filters.reviewStatus}`);
  if (filters.fromDate) terms.push(Prisma.sql`c.detected_at >= ${new Date(filters.fromDate)}`);
  if (filters.toDate) terms.push(Prisma.sql`c.detected_at < ${new Date(new Date(filters.toDate).getTime() + 86400000)}`);
  const from = Prisma.sql`FROM conflicts c JOIN agenda_items a ON a.id = c.agenda_item_id JOIN politicians p ON p.id = c.politician_id LEFT JOIN jurisdictions j ON j.id = p.jurisdiction_id WHERE ${Prisma.join(terms, ' AND ')}`;
  const order = filters.sort === 'severity'
    ? Prisma.sql`CASE UPPER(c.severity) WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END DESC, c.detected_at DESC, c.id ASC`
    : filters.sort === 'oldest' ? Prisma.sql`c.detected_at ASC, c.id ASC` : Prisma.sql`c.detected_at DESC, c.id ASC`;
  return { from, order };
}

const SEVERITY_RANK_SQL = Prisma.sql`MAX(CASE UPPER(c.severity) WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END)`;
const RANKED_SEVERITY = { 3: 'HIGH', 2: 'MEDIUM', 1: 'LOW' };

/**
 * One row per official under the same filters as the flag list: how many
 * flags, distinct agenda items and meetings they are flagged on, how many are
 * still awaiting review, and which entities the flags name.
 */
export async function conflictsByOfficial(client, filters, { limit = 500 } = {}) {
  const { from } = conflictSql(filters);
  const officials = await client.$queryRaw(Prisma.sql`
    SELECT p.id AS "politicianId", p.full_name AS name, p.slug, p.needs_review AS "needsReview",
      COALESCE(MAX(a.city_name), MAX(j.name), 'Unknown') AS city,
      COUNT(*)::int AS flags,
      COUNT(DISTINCT c.agenda_item_id)::int AS "agendaItems",
      COUNT(DISTINCT a.meeting_date::date)::int AS meetings,
      (COUNT(*) FILTER (WHERE c.review_status = 'pending'))::int AS pending,
      ${SEVERITY_RANK_SQL}::int AS "severityRank",
      MIN(a.meeting_date) AS "firstMeeting", MAX(a.meeting_date) AS "lastMeeting"
    ${from}
    GROUP BY p.id, p.full_name, p.slug, p.needs_review
    ORDER BY "severityRank" DESC, flags DESC, p.full_name ASC
    LIMIT ${limit}`);
  if (!officials.length) return [];
  const entities = await client.$queryRaw(Prisma.sql`
    SELECT c.politician_id AS "politicianId", c.entity_name AS name, COUNT(*)::int AS flags
    ${from} AND c.politician_id IN (${Prisma.join(officials.map((row) => Prisma.sql`${row.politicianId}::uuid`))})
    GROUP BY c.politician_id, c.entity_name
    ORDER BY flags DESC, c.entity_name ASC`);
  const byOfficial = new Map();
  for (const row of entities) {
    if (!byOfficial.has(row.politicianId)) byOfficial.set(row.politicianId, []);
    byOfficial.get(row.politicianId).push({ name: row.name ?? 'Unnamed entity', flags: Number(row.flags) });
  }
  return officials.map(({ needsReview, severityRank, ...row }) => ({
    ...row,
    flags: Number(row.flags),
    agendaItems: Number(row.agendaItems),
    meetings: Number(row.meetings),
    pending: Number(row.pending),
    highestSeverity: RANKED_SEVERITY[Number(severityRank)] ?? null,
    identityVerified: needsReview == null ? null : !needsReview,
    entities: byOfficial.get(row.politicianId) ?? [],
  }));
}
