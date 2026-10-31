import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));

import { runDetectionRun } from "../../src/detection/detectionRuns.js";

const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND_RUN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FILING_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const POLITICIAN_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const JURISDICTION_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function makePrisma({ agendaItems = [{ id: "agenda-1" }] } = {}) {
  const runs = new Map(
    [RUN_ID, SECOND_RUN_ID].map((id) => [
      id,
      {
        id,
        filingId: FILING_ID,
        politicianId: POLITICIAN_ID,
        filingYear: 2025,
        status: "queued",
        lockAt: null,
      },
    ]),
  );
  const runItems = [];
  let nextItemId = 1;

  return {
    runs,
    runItems,
    form700Filing: {
      findUnique: vi.fn(async () => ({
        politicianId: POLITICIAN_ID,
        politician: {
          id: POLITICIAN_ID,
          jurisdictionId: JURISDICTION_ID,
          jurisdiction: { name: "Sacramento" },
        },
      })),
    },
    agendaItem: {
      findMany: vi.fn(async () => agendaItems),
    },
    detectionRun: {
      updateMany: vi.fn(async ({ where, data }) => {
        const current = runs.get(where.id);
        const stale = current?.lockAt && current.lockAt.valueOf() < Date.now() - 10 * 60 * 1000;
        if (!current || !(["queued", "failed"].includes(current.status) || (current.status === "running" && stale))) {
          return { count: 0 };
        }
        Object.assign(current, data);
        return { count: 1 };
      }),
      findUnique: vi.fn(async ({ where }) => runs.get(where.id)),
      update: vi.fn(async ({ where, data }) => {
        const current = runs.get(where.id);
        Object.assign(current, data);
        return current;
      }),
    },
    detectionRunItem: {
      createMany: vi.fn(async ({ data }) => {
        let count = 0;
        for (const row of data) {
          const exists = runItems.some(
            (item) =>
              item.detectionRunId === row.detectionRunId &&
              item.agendaItemId === row.agendaItemId &&
              item.politicianId === row.politicianId,
          );
          if (exists) continue;
          runItems.push({
            id: `run-item-${nextItemId++}`,
            ...row,
            status: "pending",
            attempts: 0,
            candidateCount: 0,
            insertedCount: 0,
            duplicateCount: 0,
          });
          count += 1;
        }
        return { count };
      }),
      findMany: vi.fn(async ({ where }) => {
        const matching = runItems.filter((item) => item.detectionRunId === where.detectionRunId);
        return where.status?.not
          ? matching.filter((item) => item.status !== where.status.not)
          : matching;
      }),
      update: vi.fn(async ({ where, data }) => {
        const item = runItems.find((row) => row.id === where.id);
        const updateData = { ...data };
        if (data.attempts?.increment) {
          updateData.attempts = item.attempts + data.attempts.increment;
        }
        Object.assign(item, updateData);
        return item;
      }),
    },
  };
}

describe("runDetectionRun", () => {
  it("evaluates already-ingested agenda items within the jurisdiction and filing-year window", async () => {
    const prisma = makePrisma();
    const detectConflictsForAgendaItems = vi.fn(async () => ({
      totalCandidates: 2,
      inserted: 1,
      duplicates: 1,
    }));

    const result = await runDetectionRun(RUN_ID, {
      prisma,
      detectConflictsForAgendaItems,
    });

    expect(prisma.agendaItem.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            meeting: {
              is: {
                jurisdictionId: JURISDICTION_ID,
                meetingDate: {
                  gte: new Date(Date.UTC(2025, 0, 1)),
                  lt: new Date(Date.UTC(2026, 0, 1)),
                },
              },
            },
          },
          {
            meetingDate: {
              gte: new Date(Date.UTC(2025, 0, 1)),
              lt: new Date(Date.UTC(2026, 0, 1)),
            },
            meeting: { is: { jurisdictionId: JURISDICTION_ID } },
          },
          {
            meetingDate: {
              gte: new Date(Date.UTC(2025, 0, 1)),
              lt: new Date(Date.UTC(2026, 0, 1)),
            },
            cityName: { equals: "Sacramento", mode: "insensitive" },
          },
        ],
      },
      select: { id: true },
    });
    expect(detectConflictsForAgendaItems).toHaveBeenCalledWith(
      ["agenda-1"],
      { prisma, politicianIds: [POLITICIAN_ID] },
    );
    expect(result.run.status).toBe("completed");
    expect(result).toMatchObject({
      totalItems: 1,
      processedItems: 1,
      candidateCount: 2,
      insertedCount: 1,
      duplicateCount: 1,
      failureCount: 0,
    });
  });

  it("retries a failed item after interruption without double-inserting its conflict", async () => {
    const prisma = makePrisma();
    let insertedConflict = false;
    const detectConflictsForAgendaItems = vi.fn(async () => {
      if (!insertedConflict) {
        insertedConflict = true;
        throw new Error("process interrupted after conflict insert");
      }
      return { totalCandidates: 1, inserted: 0, duplicates: 1 };
    });

    const first = await runDetectionRun(RUN_ID, {
      prisma,
      detectConflictsForAgendaItems,
    });
    expect(first.run.status).toBe("failed");
    expect(first.failureCount).toBe(1);

    const retried = await runDetectionRun(RUN_ID, {
      prisma,
      detectConflictsForAgendaItems,
    });

    expect(retried.run.status).toBe("completed");
    expect(retried.processedItems).toBe(1);
    expect(retried.insertedCount).toBe(0);
    expect(retried.duplicateCount).toBe(1);
    expect(prisma.runItems[0].attempts).toBe(2);
    expect(detectConflictsForAgendaItems).toHaveBeenCalledTimes(2);
  });

  it("treats a repeated backfill as a duplicate instead of inserting another conflict", async () => {
    const prisma = makePrisma();
    const insertedKeys = new Set();
    const detectConflictsForAgendaItems = vi.fn(async ([agendaItemId]) => {
      const key = `${POLITICIAN_ID}:${agendaItemId}`;
      if (insertedKeys.has(key)) {
        return { totalCandidates: 1, inserted: 0, duplicates: 1 };
      }
      insertedKeys.add(key);
      return { totalCandidates: 1, inserted: 1, duplicates: 0 };
    });

    const firstRun = await runDetectionRun(RUN_ID, {
      prisma,
      detectConflictsForAgendaItems,
    });
    const secondRun = await runDetectionRun(SECOND_RUN_ID, {
      prisma,
      detectConflictsForAgendaItems,
    });

    expect(firstRun.insertedCount).toBe(1);
    expect(secondRun.insertedCount).toBe(0);
    expect(secondRun.duplicateCount).toBe(1);
    expect(insertedKeys.size).toBe(1);
  });
});
