import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Welcome } from "./welcome";

describe("Welcome", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders recent conflicts from the API data envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [{
        id: "conflict-1",
        politicianName: "Jordan Lee",
        city: "Sacramento",
        conflictType: "BUSINESS_POSITION",
        severity: "HIGH",
        agendaItemSummary: "Award of a public works contract",
        detectedAt: "2026-10-01T00:00:00.000Z",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    render(<MemoryRouter><Welcome /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "Jordan Lee" })).toBeInTheDocument();
    expect(screen.getByText("Business Position")).toBeInTheDocument();
    expect(screen.getByText("Award of a public works contract")).toBeInTheDocument();
  });

  it("shows a useful empty state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<MemoryRouter><Welcome /></MemoryRouter>);
    expect(await screen.findByText("No conflict flags are available")).toBeInTheDocument();
  });
});