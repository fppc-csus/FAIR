import { describe, expect, it, vi } from "vitest";
import { detectConflictsForAgendaItems } from "../../src/detection/detectConflicts.js";

const item = (id, cityName, meetingDate) => ({ id, cityName, meetingDate, title: "Contract with Acme Builders" });
const filing = (id, city, year) => ({ id, filingYear: year, politicianId: `pol-${id}`, politician: { jurisdictionId: city }, archivedPath: `private/${id}` });
function database(items, rows) {
  const conflicts = [];
  const scheduleCdeIncome = { findMany: vi.fn(async ({ where }) => rows.filter((row) => where.filing.politician.OR[0].jurisdictionId.in.includes(row.filing.politician.jurisdictionId) || row.filing.politician.jurisdictionId == null)) };
  const client = {
    agendaItem: { findMany: vi.fn(async () => items) },
    jurisdiction: { findMany: vi.fn(async () => [{ id: "a", name: "Sacramento" }, { id: "b", name: "Davis" }]) },
    scheduleCdeIncome,
    conflict: {
      findMany: vi.fn(async () => conflicts),
      createMany: vi.fn(async ({ data }) => { conflicts.push(...data.map((entry) => ({ ...entry, id: `c${conflicts.length}` }))); return { count: data.length }; }),
      update: vi.fn(async ({ where, data }) => Object.assign(conflicts.find((entry) => entry.id === where.id), data)),
    },
    $transaction: async (fn) => fn(client),
  };
  return { client, conflicts, scheduleCdeIncome };
}

describe("scoped detection", () => {
  it("isolates mixed cities and dates while retaining provenance and idempotence", async () => {
    const { client, conflicts, scheduleCdeIncome } = database(
      [item("i1", "Sacramento", "2026-01-01"), item("i2", "Davis", "2027-01-01")],
      [{ id: "d1", filingId: "f1", filing: filing("f1", "a", 2025), sourceName: "Acme Builders", scheduleType: "C", amount: "$500" },
        { id: "d2", filingId: "f2", filing: filing("f2", "b", 2025), sourceName: "Acme Builders", scheduleType: "C", amount: "$500" }],
    );
    const policy = { period: "YEAR_OFFSETS", offsets: [1] };
    const first = await detectConflictsForAgendaItems(["i1", "i2"], { prisma: client, eligibilityPolicy: policy });
    expect(first.inserted).toBe(1);
    expect(conflicts[0]).toMatchObject({ filingId: "f1", disclosureId: "d1", filingYear: 2025, supportingSource: "private/f1", eligibilityStatus: "active", detectionOwner: "SH-324" });
    expect(conflicts[0].ruleReference).toContain("87103");
    expect(scheduleCdeIncome.findMany.mock.calls[0][0].where.filing.politician.OR[0].jurisdictionId.in).toEqual(["a", "b"]);
    const second = await detectConflictsForAgendaItems(["i1", "i2"], { prisma: client, eligibilityPolicy: policy });
    expect(second.inserted).toBe(0);
    expect(conflicts).toHaveLength(1);
  });
  it("filters stored Schedule A investments by jurisdiction and period", async () => {
    const { client, conflicts } = database([item("i1", "Sacramento", "2026-01-01")], []);
    client.scheduleAInvestment = { findMany: vi.fn(async () => [
      { id: "a1", filingId: "f1", filing: filing("f1", "a", 2025), entityName: "Acme Builders", fairMarketValue: "$10,000" },
      { id: "a2", filingId: "f2", filing: filing("f2", "b", 2025), entityName: "Acme Builders", fairMarketValue: "$10,000" },
      { id: "a3", filingId: "f3", filing: filing("f3", "a", 2024), entityName: "Acme Builders", fairMarketValue: "$10,000" },
    ]) };
    const result = await detectConflictsForAgendaItems(["i1"], { prisma: client, eligibilityPolicy: { period: "YEAR_OFFSETS", offsets: [1] } });
    expect(result.inserted).toBe(1);
    expect(conflicts[0]).toMatchObject({ conflictType: "INVESTMENT", filingId: "f1", disclosureId: "a1" });
    expect(client.scheduleAInvestment.findMany.mock.calls[0][0].where.filing.politician.OR[0].jurisdictionId.in).toEqual(["a"]);
  });
  it("keeps both disclosures for the same entity when their supporting filing differs", async () => {
    const rows = [
      { id: "d1", filingId: "f1", filing: filing("f1", "a", 2025), sourceName: "Acme Builders", scheduleType: "C", amount: "$500" },
      { id: "d2", filingId: "f2", filing: filing("f2", "a", 2026), sourceName: "Acme Builders", scheduleType: "C", amount: "$500" },
    ];
    const { client, conflicts } = database([item("i1", "Sacramento", "2026-01-01")], rows);
    const result = await detectConflictsForAgendaItems(["i1"], { prisma: client, eligibilityPolicy: { period: "YEAR_OFFSETS", offsets: [0, 1] } });
    expect(result.inserted).toBe(2);
    expect(new Set(conflicts.map((row) => row.sourceKey)).size).toBe(2);
    expect(conflicts.map((row) => row.filingId).sort()).toEqual(["f1", "f2"]);
  });
  it("does not deactivate reviewed candidates while policy is pending", async () => {
    const { client, conflicts } = database([item("i1", "Sacramento", "2026-01-01")], []);
    conflicts.push({ id: "reviewed", agendaItemId: "i1", politicianId: "p", conflictType: "INCOME", sourceKey: "INCOME:acme builders", detectionOwner: "SH-324", eligibilityStatus: "active", reviewStatus: "confirmed_conflict", reviewNote: "Keep" });
    const result = await detectConflictsForAgendaItems(["i1"], { prisma: client, eligibilityPolicy: { period: "PENDING", offsets: [] } });
    expect(result.reviewRequired).toContainEqual({ agendaItemId: "i1", reason: "POLICY_PENDING" });
    expect(conflicts[0]).toMatchObject({ eligibilityStatus: "active", reviewStatus: "confirmed_conflict", reviewNote: "Keep" });
  });
  it("reports unresolved filing jurisdiction without creating or inactivating candidates", async () => {
    const rows = [{ id: "d1", filingId: "f1", filing: filing("f1", null, 2025), sourceName: "Acme Builders", scheduleType: "C", amount: "$500" }];
    const { client, conflicts } = database([item("i1", "Sacramento", "2026-01-01")], rows);
    const result = await detectConflictsForAgendaItems(["i1"], { prisma: client, eligibilityPolicy: { period: "YEAR_OFFSETS", offsets: [1] } });
    expect(result.reviewRequired).toContainEqual({ agendaItemId: "i1", filingId: "f1", reason: "UNRESOLVED_POLITICIAN_JURISDICTION" });
    expect(conflicts).toHaveLength(0);
  });
  it("inactivates and reactivates only managed candidates after jurisdiction correction, preserving reviews", async () => {
    const items = [item("i1", "Sacramento", "2026-01-01")];
    const rows = [{ id: "d1", filingId: "f1", filing: filing("f1", "a", 2025), sourceName: "Acme Builders", scheduleType: "C", amount: "$500" }];
    const { client, conflicts } = database(items, rows);
    const policy = { period: "YEAR_OFFSETS", offsets: [1] };
    await detectConflictsForAgendaItems(["i1"], { prisma: client, eligibilityPolicy: policy });
    const managed = conflicts[0];
    managed.reviewStatus = "confirmed_conflict";
    managed.reviewNote = "Reviewed";
    managed.reviews = [{ note: "history" }];
    conflicts.push({ ...managed, id: "manual", sourceKey: "INCOME:manual", detectionOwner: null, eligibilityStatus: null });
    items[0].cityName = "Davis";
    const out = await detectConflictsForAgendaItems(["i1"], { prisma: client, eligibilityPolicy: policy });
    expect(out.inactivated).toBe(1);
    expect(managed).toMatchObject({ eligibilityStatus: "inactive", reviewNote: "Reviewed", reviews: [{ note: "history" }] });
    expect(conflicts[1].eligibilityStatus).toBeNull();
    items[0].cityName = "Sacramento";
    const restored = await detectConflictsForAgendaItems(["i1"], { prisma: client, eligibilityPolicy: policy });
    expect(restored.reactivated).toBe(1);
    expect(managed).toMatchObject({ eligibilityStatus: "active", reviewStatus: "confirmed_conflict", reviewNote: "Reviewed" });
    expect(conflicts).toHaveLength(2);
  });
  it("does not inactivate candidates when agenda jurisdiction or meeting date is unresolved", async () => {
    const items = [item("i1", "Unknown", null)];
    const { client, conflicts } = database(items, []);
    conflicts.push({ id: "reviewed", agendaItemId: "i1", detectionOwner: "SH-324", eligibilityStatus: "active" });
    const result = await detectConflictsForAgendaItems(["i1"], { prisma: client, eligibilityPolicy: { period: "YEAR_OFFSETS", offsets: [1] } });
    expect(result.reviewRequired[0].reason).toBe("UNRESOLVED_JURISDICTION");
    expect(conflicts[0].eligibilityStatus).toBe("active");
  });
  it("does not duplicate or adopt a legacy row with the original entity source key", async () => {
    const rows = [{ id: "d1", filingId: "f1", filing: filing("f1", "a", 2025), sourceName: "Acme Builders", scheduleType: "C", amount: "$500" }];
    const { client, conflicts } = database([item("i1", "Sacramento", "2026-01-01")], rows);
    conflicts.push({ id: "legacy", agendaItemId: "i1", politicianId: "pol-f1", conflictType: "INCOME", sourceKey: "INCOME:acme builders", reviewStatus: "confirmed_conflict", detectionOwner: null });
    const result = await detectConflictsForAgendaItems(["i1"], { prisma: client, eligibilityPolicy: { period: "YEAR_OFFSETS", offsets: [1] } });
    expect(result.inserted).toBe(0);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ id: "legacy", reviewStatus: "confirmed_conflict", detectionOwner: null });
  });
  it("retains managed candidates when a matching filing loses required year metadata", async () => {
    const items = [item("i1", "Sacramento", "2026-01-01")];
    const rows = [{ id: "d1", filingId: "f1", filing: filing("f1", "a", 2025), sourceName: "Acme Builders", scheduleType: "C", amount: "$500" }];
    const { client, conflicts } = database(items, rows);
    const policy = { period: "YEAR_OFFSETS", offsets: [1] };
    await detectConflictsForAgendaItems(["i1"], { prisma: client, eligibilityPolicy: policy });
    delete rows[0].filing.filingYear;
    const result = await detectConflictsForAgendaItems(["i1"], { prisma: client, eligibilityPolicy: policy });
    expect(result.reviewRequired).toContainEqual({ agendaItemId: "i1", filingId: "f1", reason: "MISSING_FILING_YEAR" });
    expect(conflicts[0].eligibilityStatus).toBe("active");
  });
  it("persists eligible disclosures despite another disclosure requiring review, without inactivating prior matches", async () => {
    const rows = [
      { id: "d1", filingId: "f1", filing: filing("f1", "a", 2025), sourceName: "Acme Builders", scheduleType: "C", amount: "$500" },
      { id: "d2", filingId: "f2", filing: filing("f2", "a", 2025), sourceName: "Acme Builders", scheduleType: "C", amount: "$500" },
    ];
    const { client, conflicts } = database([item("i1", "Sacramento", "2026-01-01")], rows);
    const policy = { period: "YEAR_OFFSETS", offsets: [1] };
    await detectConflictsForAgendaItems(["i1"], { prisma: client, eligibilityPolicy: policy });
    const previous = conflicts.find((row) => row.disclosureId === "d2");
    previous.reviewStatus = "confirmed_conflict";
    previous.reviewNote = "Analyst decision";
    rows.splice(1, 1, { ...rows[1], filing: { ...rows[1].filing, filingYear: null } });
    rows.push({ id: "d3", filingId: "f3", filing: filing("f3", "a", 2025), sourceName: "Acme Builders", scheduleType: "C", amount: "$500" });

    const result = await detectConflictsForAgendaItems(["i1"], { prisma: client, eligibilityPolicy: policy });
    expect(result.reviewRequired).toContainEqual({ agendaItemId: "i1", filingId: "f2", reason: "MISSING_FILING_YEAR" });
    expect(result.inserted).toBe(1);
    expect(conflicts.find((row) => row.disclosureId === "d3")?.eligibilityStatus).toBe("active");
    expect(previous).toMatchObject({ eligibilityStatus: "active", reviewStatus: "confirmed_conflict", reviewNote: "Analyst decision" });
  });
  it("refreshes managed evidence without changing review decisions", async () => {
    const rows = [{ id: "d1", filingId: "f1", filing: filing("f1", "a", 2025), sourceName: "Acme Builders", scheduleType: "C", amount: "$500" }];
    const { client, conflicts } = database([item("i1", "Sacramento", "2026-01-01")], rows);
    const policy = { period: "YEAR_OFFSETS", offsets: [1] };
    await detectConflictsForAgendaItems(["i1"], { prisma: client, eligibilityPolicy: policy });
    conflicts[0].reviewStatus = "not_applicable";
    conflicts[0].reviewNote = "Resolved by analyst";
    rows[0].filing.archivedPath = "private/corrected";
    const result = await detectConflictsForAgendaItems(["i1"], { prisma: client, eligibilityPolicy: policy });
    expect(result.inserted).toBe(0);
    expect(conflicts[0]).toMatchObject({ supportingSource: "private/corrected", reviewStatus: "not_applicable", reviewNote: "Resolved by analyst" });
  });
  it("does not write partial reconciliation if the transaction rejects", async () => {
    const rows = [{ id: "d1", filingId: "f1", filing: filing("f1", "a", 2025), sourceName: "Acme Builders", scheduleType: "C", amount: "$500" }];
    const { client, conflicts } = database([item("i1", "Sacramento", "2026-01-01")], rows);
    client.$transaction = vi.fn().mockRejectedValue(new Error("transaction failed"));
    await expect(detectConflictsForAgendaItems(["i1"], { prisma: client, eligibilityPolicy: { period: "YEAR_OFFSETS", offsets: [1] } })).rejects.toThrow("transaction failed");
    expect(conflicts).toHaveLength(0);
  });
  it("discovers candidates after acquiring the agenda lock on overlapping runs", async () => {
    const oldRow = { id: "d1", filingId: "f1", filing: filing("f1", "a", 2025), sourceName: "Acme Builders", scheduleType: "C", amount: "$500" };
    const newRow = { ...oldRow, id: "d2", filingId: "f2", filing: filing("f2", "a", 2025) };
    const rows = [oldRow];
    const { client, conflicts } = database([item("i1", "Sacramento", "2026-01-01")], rows);
    let firstRead;
    const readStarted = new Promise((resolve) => { firstRead = resolve; });
    let resumeFirst;
    const firstPaused = new Promise((resolve) => { resumeFirst = resolve; });
    let reads = 0;
    client.scheduleCdeIncome.findMany = vi.fn(async () => {
      const snapshot = [...rows];
      if (++reads === 1) {
        firstRead();
        await firstPaused;
      }
      return snapshot;
    });
    // Serialize the mocked transactions as PostgreSQL's agenda-row lock does.
    let release = () => {};
    let previous = Promise.resolve();
    client.$transaction = async (fn) => {
      await previous;
      previous = new Promise((resolve) => { release = resolve; });
      try { return await fn(client); } finally { release(); }
    };
    client.$queryRaw = vi.fn(async () => {});
    const policy = { period: "YEAR_OFFSETS", offsets: [1] };
    const first = detectConflictsForAgendaItems(["i1"], { prisma: client, eligibilityPolicy: policy });
    await readStarted;
    expect(client.$queryRaw).toHaveBeenCalledTimes(1);
    const second = detectConflictsForAgendaItems(["i1"], { prisma: client, eligibilityPolicy: policy });
    await new Promise((resolve) => setImmediate(resolve));
    expect(reads).toBe(1);
    rows.splice(0, 1, newRow);
    resumeFirst();
    await Promise.all([first, second]);
    expect(client.$queryRaw).toHaveBeenCalledTimes(2);
    expect(reads).toBe(2);
    expect(conflicts.find((row) => row.disclosureId === "d1")?.eligibilityStatus).toBe("inactive");
    expect(conflicts.find((row) => row.disclosureId === "d2")?.eligibilityStatus).toBe("active");
  });
});