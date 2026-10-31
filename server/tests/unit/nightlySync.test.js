import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/ingestion/legistar.js", () => ({
  fetchLegistarAgendaItemsForDataSource: vi.fn(),
}));

import { fetchLegistarAgendaItemsForDataSource } from "../../src/ingestion/legistar.js";
import { runLegistarSyncForCity } from "../../src/jobs/nightlySync.js";

function createSql(insertedIds = []) {
  const sql = (strings) => {
    const text = Array.isArray(strings) ? strings.join(" ") : "";
    if (text.includes("INSERT INTO agenda_items")) {
      return Promise.resolve(insertedIds.map((id) => ({ id })));
    }
    return Promise.resolve([]);
  };
  sql.unsafe = vi.fn();
  return sql;
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