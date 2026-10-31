import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import Conflicts from "./conflicts";
import Politicians from "./politicians";
import ConflictDetail from "./conflicts.$id";
import PoliticianDetail from "./politician-detail";
import AgendaDetail from "./agenda-detail";
import Profile from "./politician.profile";
import { Welcome } from "../welcome/welcome";
import { TIMEOUT_MESSAGE } from "../lib/request";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const record = { id: "1", politicianName: "Jordan Lee", city: "Sacramento", conflictType: "INCOME", severity: "HIGH", agendaItemSummary: "Contract review", detectedAt: "2026-10-01" };

describe("public request recovery", () => {
  it.each([Conflicts, Politicians, ConflictDetail, PoliticianDetail, AgendaDetail, Welcome, Profile])("provides a timeout and retry on route %#", async Page => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
    render(<MemoryRouter><Page /></MemoryRouter>);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(TIMEOUT_MESSAGE);
    fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]);
    expect(fetch).toHaveBeenCalledTimes(Page === Conflicts ? 3 : 2);
    if (Page !== Conflicts) expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("shows essential conflict information and clears an empty filter", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = String(input);
      return Response.json(url.includes('/filters') ? { data: ['Sacramento'] } : { data: url.includes('severities=LOW') ? [] : [record], total: url.includes('severities=LOW') ? 0 : 1 });
    });
    render(<MemoryRouter><Conflicts /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Jordan Lee" })).toBeInTheDocument();
    expect(screen.getAllByText("HIGH")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /Jordan Lee/ })).toHaveAttribute("href", "/conflicts/1");
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "LOW" } });
    expect(await screen.findByText("No records match these filters")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByRole("heading", { name: "Jordan Lee" })).toBeInTheDocument();
  });
  it("recovers from a server failure", async () => {
    let failed = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      if (String(input).includes('/filters')) return Response.json({ data: ['Sacramento'] });
      if (!failed) { failed = true; return Response.json({}, { status: 500 }); }
      return Response.json({ data: [record], total: 1 });
    });
    render(<MemoryRouter><Conflicts /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Jordan Lee" })).toBeInTheDocument();
  });
});
