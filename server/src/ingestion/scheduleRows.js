/**
 * Single mapping from parser rows (snake_case) to Prisma schedule payloads
 * (camelCase). Shared by the single-filing upload and the bulk importer so
 * both store identical columns, including the full labelled source row.
 */
export const SCHEDULE_MODELS = {
  A: 'scheduleAInvestment',
  B: 'scheduleBRealEstate',
  CDE: 'scheduleCdeIncome',
  A2: 'scheduleA2BusinessPosition',
};

function withDetails(row, data) {
  return Array.isArray(row.details) && row.details.length ? { ...data, details: row.details } : data;
}

const MAPPERS = {
  A: (row) => withDetails(row, {
    entityName: row.entity_name,
    fairMarketValue: row.fair_market_value ?? null,
    natureOfInvestment: row.nature_of_investment ?? null,
  }),
  B: (row) => withDetails(row, {
    propertyDescription: row.property_description ?? null,
    city: row.city ?? null,
    county: row.county ?? null,
    fairMarketValue: row.fair_market_value ?? null,
    natureOfInterest: row.nature_of_interest ?? null,
  }),
  CDE: (row) => withDetails(row, {
    scheduleType: row.schedule_type,
    sourceName: row.source_name ?? null,
    amount: row.amount ?? null,
  }),
  A2: (row) => withDetails(row, {
    entityName: row.entity_name,
    businessPosition: row.business_position ?? null,
    fairMarketValue: row.fair_market_value ?? null,
    natureOfInvestment: row.nature_of_investment ?? null,
    grossIncomeRange: row.gross_income_range ?? null,
  }),
};

export function toScheduleData(schedule, rows = [], ids = {}) {
  const map = MAPPERS[schedule];
  if (!map) throw new Error(`Unknown Form 700 schedule ${schedule}`);
  return rows.map((row) => ({ ...ids, ...map(row) }));
}

/** Insert every schedule's rows for one filing inside an existing transaction. */
export async function createScheduleRows(tx, schedules, ids) {
  for (const [schedule, rows] of Object.entries(schedules)) {
    if (rows?.length) await tx[SCHEDULE_MODELS[schedule]].createMany({ data: toScheduleData(schedule, rows, ids) });
  }
}

/** Remove every schedule row of a filing (used when a filing is replaced). */
export async function deleteScheduleRows(tx, filingId) {
  for (const model of Object.values(SCHEDULE_MODELS)) {
    await tx[model].deleteMany({ where: { filingId } });
  }
}
