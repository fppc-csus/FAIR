import { describe, expect, it, vi } from "vitest";

const { postgresFactory } = vi.hoisted(() => ({ postgresFactory: vi.fn() }));
vi.mock("postgres", () => ({ default: postgresFactory }));
vi.mock("../../src/ingestion/legistar.js", () => ({
  fetchLegistarAgendaItemsForDataSource: vi.fn(),
}));

import { fetchLegistarAgendaItemsForDataSource } from "../../src/ingestion/legistar.js";
import { runNightlyLegistarSync } from "../../src/jobs/nightlySync.js";
import { runLegistarSyncForCity } from "../../src/jobs/nightlySync.js";

function createSql(insertedIds = [], existingIds = [], finalItemCount = 0) {
  const sql = (strings) => {
    const text = Array.isArray(strings) ? strings.join(" ") : "";
    if (text.includes("COUNT(*)")) {
      return Promise.resolve([{ count: String(finalItemCount) }]);
    }
    if (text.includes("SELECT id") && text.includes("agenda_items")) {
      return Promise.resolve(existingIds.map((id) => ({ id })));
    }
    if (text.includes("INSERT INTO agenda_items")) {
      return Promise.resolve(insertedIds.map((id) => ({ id })));
    }
    return Promise.resolve([]);
  };
  sql.unsafe = vi.fn();
  return sql;
}

function createNightlyPrisma() {
  const syncLogs = [];
  const runs = [];
  let logId = 0;
  const prisma = {
    syncJobRun: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }) => {
        const run = { id: "job-run-1", ...data };
        runs.push(run);
        return { id: run.id };
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
      update: vi.fn(async ({ where, data }) => {
        const run = runs.find((entry) => entry.id === where.id);
        Object.assign(run, data);
        return run;
      }),
    },
    syncLog: {
      create: vi.fn(async ({ data }) => {
        const syncLog = { id: `sync-${++logId}`, ...data };
        syncLogs.push(syncLog);
        return { id: syncLog.id };
      }),
      update: vi.fn(async ({ where, data }) => {
        const syncLog = syncLogs.find((entry) => entry.id === where.id);
        Object.assign(syncLog, data);
        return syncLog;
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    dataSource: {
      update: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (operations) => Promise.all(operations)),
  };
  return { prisma, syncLogs, runs };
}

describe("runLegistarSyncForCity", () => {
  it("runs detection only for agenda rows inserted during this sync", async () => {
    fetchLegistarAgendaItemsForDataSource.mockResolvedValue({
      meetings: [{ EventId: 10, EventDate: "2026-09-28T00:00:00Z" }],
      allItems: [
        {
          meetingId: 10,
          meeting: { EventBodyName: "City Council", EventDate: "2026-09-28T00:00:00Z" },
          item: { EventItemId: 100, EventItemTitle: "Acme Development contract" },
        },
        {
          meetingId: 10,
          meeting: { EventBodyName: "City Council", EventDate: "2026-09-28T00:00:00Z" },
          item: { EventItemId: 101, EventItemTitle: "Existing agenda item" },
        },
      ],
    });
    const detectConflictsForAgendaItems = vi.fn().mockResolvedValue({
      inserted: 2,
      skipped: 1,
      totalCandidates: 2,
    });

    const result = await runLegistarSyncForCity(
      createSql(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]),
      { id: "source-1", city_name: "Test City", legistar_base_url: "https://webapi.legistar.com/v1/test" },
      new Set([
        "id",
        "legistar_item_id",
        "source_type",
        "legistar_event_id",
        "legistar_matter_id",
        "city_name",
        "title",
        "agenda_number",
        "body_name",
        "meeting_date",
        "event_item_passed_flag",
        "legistar_item_payload",
      ]),
      { detectConflictsForAgendaItems },
    );

    expect(detectConflictsForAgendaItems).toHaveBeenCalledWith(
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      undefined,
    );
    expect(result).toMatchObject({
      itemsFound: 2,
      itemsInserted: 1,
      itemsSkipped: 1,
      insertedAgendaItemIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      conflictCandidates: 2,
      conflictsDetected: 2,
      conflictsSkipped: 1,
      detectionErrors: [],
    });
  });

  it("rechecks all fetched agenda rows during historical backfills", async () => {
    fetchLegistarAgendaItemsForDataSource.mockResolvedValue({
      meetings: [{ EventId: 10 }],
      allItems: [
        {
          meetingId: 10,
          meeting: { EventDate: "2025-01-01T00:00:00Z" },
          item: { EventItemId: 100, EventItemTitle: "Previously stored item" },
        },
        {
          meetingId: 10,
          meeting: { EventDate: "2025-01-01T00:00:00Z" },
          item: { EventItemId: 101, EventItemTitle: "New item" },
        },
      ],
    });
    const detector = vi.fn().mockResolvedValue({ inserted: 1, skipped: 0, totalCandidates: 1 });
    const result = await runLegistarSyncForCity(
      createSql(["new-agenda-id"], ["existing-agenda-id", "new-agenda-id"], 37),
      { id: "source-1", city_name: "Test City", legistar_base_url: "https://webapi.legistar.com/v1/test" },
      new Set(["legistar_item_id", "source_type"]),
      {
        detectConflictsForAgendaItems: detector,
        detectExistingAgendaItems: true,
        includeFinalItemCount: true,
        startDate: "2025-01-01",
        endDate: "2025-12-31",
      },
    );

    expect(detector).toHaveBeenCalledWith(["existing-agenda-id", "new-agenda-id"], undefined);
    expect(result).toMatchObject({
      itemsFound: 2,
      itemsInserted: 1,
      itemsSkipped: 1,
      itemsRechecked: 2,
      finalItemCount: 37,
    });
  });

  describe("runNightlyLegistarSync", () => {
    it("logs a city failure and continues processing independent cities", async () => {
      const sql = async (strings) => {
        const query = strings.join(" ");
        if (query.includes("table_name = 'data_sources'")) {
          return ["source_type", "enabled", "city_name"].map((column_name) => ({ column_name }));
        }
        if (query.includes("table_name = 'agenda_items'")) {
          return [{ column_name: "legistar_item_id" }];
        }
        return [];
      };
      sql.unsafe = vi.fn(async () => [
        { id: "city-1", city_name: "First City" },
        { id: "city-2", city_name: "Second City" },
      ]);
      sql.end = vi.fn();
      postgresFactory.mockClear();
      fetchLegistarAgendaItemsForDataSource.mockClear();
      postgresFactory.mockReturnValue(sql);
      fetchLegistarAgendaItemsForDataSource
        .mockRejectedValueOnce(new Error("Legistar unavailable"))
        .mockResolvedValueOnce({ meetings: [], allItems: [] });
      vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/fair");
      const state = createNightlyPrisma();

      const result = await runNightlyLegistarSync({ prisma: state.prisma });

      expect(result).toMatchObject({ citiesProcessed: 1, failures: 1 });
      expect(fetchLegistarAgendaItemsForDataSource).toHaveBeenCalledTimes(2);
      expect(state.syncLogs.map(({ status }) => status)).toEqual(["failed", "success"]);
      expect(state.syncLogs.every(({ jobRunId }) => jobRunId === "job-run-1")).toBe(true);
      expect(state.runs[0]).toMatchObject({ status: "failed" });
      expect(sql.end).toHaveBeenCalledOnce();
      vi.unstubAllEnvs();
    });
  });

  it("records detection failures separately without failing agenda insertion", async () => {
    fetchLegistarAgendaItemsForDataSource.mockResolvedValue({
      meetings: [{ EventId: 10 }],
      allItems: [{
        meetingId: 10,
        meeting: { EventBodyName: "City Council" },
        item: { EventItemId: 100, EventItemTitle: "Acme Development contract" },
      }],
    });
    const detectConflictsForAgendaItems = vi.fn().mockRejectedValue(new Error("detector unavailable"));

    const result = await runLegistarSyncForCity(
      createSql(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]),
      { id: "source-1", city_name: "Test City", legistar_base_url: "https://webapi.legistar.com/v1/test" },
      new Set(["legistar_item_id", "source_type"]),
      { detectConflictsForAgendaItems },
    );

    expect(result).toMatchObject({
      itemsInserted: 1,
      conflictsDetected: 0,
      conflictCandidates: 0,
      conflictsSkipped: 0,
      detectionErrors: [{
        agendaItemIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
        message: "detector unavailable",
      }],
    });
  });

  it("does not invoke detection when every agenda item already exists", async () => {
    fetchLegistarAgendaItemsForDataSource.mockResolvedValue({
      meetings: [{ EventId: 10 }],
      allItems: [
        {
          meetingId: 10,
          meeting: { EventBodyName: "City Council" },
          item: { EventItemId: 100, EventItemTitle: "Existing agenda item" },
        },
      ],
    });
    const detectConflictsForAgendaItems = vi.fn();

    const result = await runLegistarSyncForCity(
      createSql([]),
      { id: "source-1", city_name: "Test City", legistar_base_url: "https://webapi.legistar.com/v1/test" },
      new Set(["legistar_item_id", "source_type"]),
      { detectConflictsForAgendaItems },
    );

    expect(detectConflictsForAgendaItems).not.toHaveBeenCalled();
    expect(result).toMatchObject({ itemsInserted: 0, itemsSkipped: 1, conflictsDetected: 0 });
  });
});