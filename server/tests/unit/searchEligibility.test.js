import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const db = vi.hoisted(() => ({ $queryRaw: vi.fn().mockResolvedValue([]) }));
vi.mock("../../src/lib/prisma.js", () => ({ default: db }));
import router from "../../src/routes/search.js";

const app = express();
app.use("/api/search", router);

describe("search eligibility", () => {
  it("excludes inactive conflicts in SQL without changing other search groups", async () => {
    db.$queryRaw.mockClear();
    const response = await request(app).get("/api/search?q=builder");
    expect(response.status).toBe(200);
    const sql = db.$queryRaw.mock.calls[2][0].join(" ");
    expect(sql).toContain("c.eligibility_status IS NULL OR c.eligibility_status = 'active'");
    expect(db.$queryRaw).toHaveBeenCalledTimes(3);
  });
});