import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Conflicts from "./conflicts";
import Politicians from "./politicians";
import ConflictDetail from "./conflicts.$id";
import PoliticianDetail from "./politician-detail";
import AgendaDetail from "./agenda-detail";
import Home from "./home";
import { TIMEOUT_MESSAGE } from "../lib/request";
import { signInForTest } from "../test/session";

beforeEach(() => signInForTest());
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const record = { id: "1", politicianName: "Jordan Lee", city: "Sacramento", conflictType: "INCOME", severity: "HIGH", agendaItemSummary: "Contract review", detectedAt: "2026-10-01", entityName: "LandPaths", meetingDate: "2019-12-17", reviewStatus: "pending", identityVerified: false };

describe("investigator request recovery", () => {
  it.each([[Conflicts, 2], [Politicians, 1], [ConflictDetail, 1], [PoliticianDetail, 1], [AgendaDetail, 1], [Home, 5]] as const)("provides a timeout and retry on route %#", async (Page, initialRequests) => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
    render(<MemoryRouter><Page /></MemoryRouter>);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(TIMEOUT_MESSAGE);
    fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]);
    // The session check runs before each request, so let it settle first.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetch).toHaveBeenCalledTimes(initialRequests + 1);
  });
});

describe("conflict list", () => {
  it("shows what an investigator triages on and clears an empty filter", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = String(input);
      return Response.json(url.includes('/filters') ? { data: ['Sacramento'] } : { data: url.includes('severities=LOW') ? [] : [record], total: url.includes('severities=LOW') ? 0 : 1 });
    });
    render(<MemoryRouter><Conflicts /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Jordan Lee" })).toBeInTheDocument();
    expect(screen.getByText("LandPaths")).toBeInTheDocument();
    expect(screen.getByText("Identity unverified")).toBeInTheDocument();
    expect(screen.getByText("Awaiting review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Jordan Lee/ })).toHaveAttribute("href", "/conflicts/1");
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "LOW" } });
    expect(await screen.findByText("No records match these filters")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByRole("heading", { name: "Jordan Lee" })).toBeInTheDocument();
  });

  it("downloads the CSV with the session instead of an unauthenticated link", async () => {
    const createObjectURL = vi.fn(() => "blob:csv");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = String(input);
      if (url.includes("/export")) return new Response("id\n1", { headers: { "Content-Disposition": 'attachment; filename="fair-conflicts-2026.csv"' } });
      return Response.json(url.includes('/filters') ? { data: [] } : { data: [record], total: 1 });
    });
    render(<MemoryRouter><Conflicts /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Download CSV/ }));
    await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    const exportCall = fetch.mock.calls.find(([url]) => String(url).includes("/export"))!;
    expect(new Headers(exportCall[1]?.headers).get("Authorization")).toBe("Bearer test-access");
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

const dossier = {
  id: "2375dc6a-e271-4d7a-a9e1-41a157276190", slug: "lynda-hopkins", fullName: "Lynda Hopkins", officeTitle: "Supervisor", district: null,
  jurisdiction: { name: "County of Sonoma", type: "county" }, identityVerified: false,
  filings: [{
    id: "f", filingYear: 2019, filedAt: "2020-03-01", importMetadata: { filing_type: "Amendment - Annual", versions: [{ filed_serial: 2, filing_type: "Amendment - Annual" }, { filed_serial: 1, filing_type: "Annual" }] },
    investments: [], realProperty: [], gifts: [], travel: [],
    businessPositions: [{ id: "a2", entityName: "Foggy River Farm", businessPosition: null, fairMarketValue: "$10,001 - $100,000", natureOfInvestment: "Partnership", grossIncomeRange: "$10,001 - $100,000", details: [{ label: "GENERAL DESCRIPTION OF BUSINESS ACTIVITY", value: "Organic farm" }] }],
    income: [{ id: "c", scheduleType: "C", sourceName: "LandPaths", amount: "$10,001 - $100,000", details: [{ label: "CONSIDERATION FOR WHICH INCOME WAS RECEIVED", value: "Spouse's or registered domestic partner's income" }] }],
  }],
  conflicts: [{ id: "k1", conflictType: "INCOME", severity: "HIGH", entityName: "LandPaths", reviewStatus: "pending", filingYear: 2019, agendaItem: { id: "a", title: "Fiscal Year 2019-2020 Tourism Impact Fund Awards", meetingDate: "2019-12-17" } }],
  votes: [], reviewEvents: [],
  summary: { disclosures: { investments: 0, businessPositions: 1, realProperty: 0, income: 1, gifts: 0, travel: 0 }, conflicts: { total: 1, pending: 1, high: 1 } },
};

describe("official dossier", () => {
  it("shows every schedule, the full original columns, flags and identity status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: dossier }));
    render(<MemoryRouter initialEntries={["/politicians/lynda-hopkins"]}><Routes><Route path="/politicians/:id" element={<PoliticianDetail />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Lynda Hopkins" })).toBeInTheDocument();
    expect(screen.getByText("Identity unverified")).toBeInTheDocument();
    expect(screen.getByText(/2 submissions — amendments applied per schedule/)).toBeInTheDocument();
    const income = screen.getByRole("region", { name: /Schedule C/ });
    fireEvent.click(within(income).getByRole("button", { name: /LandPaths/ }));
    expect(within(income).getByText("Spouse's or registered domestic partner's income")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Schedule A-2/ })).toHaveTextContent("Foggy River Farm");
    expect(screen.getByRole("link", { name: /Tourism Impact Fund/ })).toHaveAttribute("href", "/conflicts/k1");
  });
});

const conflictDetail = {
  id: "e62f84af-4b46-4b75-a286-25720a30a453",
  politician: { id: dossier.id, slug: "lynda-hopkins", name: "Lynda Hopkins", officeTitle: "Supervisor", district: null, jurisdiction: "County of Sonoma", identityVerified: false },
  conflictType: "INCOME", severity: "HIGH", ruleReference: "Cal. Gov. Code §87100, §87103(c)", entityName: "LandPaths", filingYear: 2019, reviewStatus: "pending", reviews: [],
  scheduleEntry: { scheduleType: "C", entityName: "LandPaths", dollarValue: "$10,001 - $100,000", natureOfInterest: null, details: [{ label: "YOUR BUSINESS POSITION", value: "Spouse" }] },
  officialVote: { vote: "Aye", voteDate: "2019-12-17" },
  agendaItem: { id: "a", title: "Tourism Impact Fund Awards", text: "…", meetingDate: "2019-12-17", city: "Sonoma County", sourceUrl: "https://sonoma-county.legistar.com/x", attachments: [{ name: "Summary Report", url: "https://sonoma-county.legistar1.com/s.pdf" }], evidence: { before: "Sonoma Ecology Center, $10,000; ", match: "LandPaths", after: ", $20,000;" } },
};

describe("agenda item", () => {
  it("shows the roll call with links to filers and the matter attachments", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: {
      id: "a", title: "Fiscal Year 2019-2020 Tourism Impact Fund Awards", description: null, itemText: "LandPaths, $20,000", itemNumber: null, agendaNumber: "15.",
      meetingDate: "2019-12-17", cityName: "Sonoma County", sourceType: "legistar", bodyName: "Board of Supervisors", conflicts: [],
      rollCall: [{ personName: "Lynda Hopkins", value: "Aye" }, { personName: "David Rabbitt", value: "Absent" }],
      votes: [{ vote: "Aye", politician: { id: "h", slug: "lynda-hopkins", fullName: "Lynda Hopkins" } }],
      attachments: [{ name: "Attachment A", url: "https://sonoma-county.legistar1.com/a.pdf" }],
    } }));
    render(<MemoryRouter initialEntries={["/agenda/a"]}><Routes><Route path="/agenda/:id" element={<AgendaDetail />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole("link", { name: "Lynda Hopkins" })).toHaveAttribute("href", "/politicians/lynda-hopkins");
    expect(screen.getByText("Absent")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Attachment A/ })).toHaveAttribute("href", "https://sonoma-county.legistar1.com/a.pdf");
  });
});

describe("conflict investigation", () => {
  it("highlights the agenda passage and records a review decision with a note", async () => {
    let reviewed = false;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("/review")) { reviewed = true; return Response.json({ data: { reviewStatus: "confirmed_conflict" } }); }
      return Response.json({ data: { ...conflictDetail, reviewStatus: reviewed ? "confirmed_conflict" : "pending" } });
    });
    render(<MemoryRouter initialEntries={[`/conflicts/${conflictDetail.id}`]}><Routes><Route path="/conflicts/:id" element={<ConflictDetail />} /></Routes></MemoryRouter>);
    expect(await screen.findByText("LandPaths", { selector: "mark" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lynda Hopkins" })).toHaveAttribute("href", "/politicians/lynda-hopkins");
    expect(screen.getByRole("link", { name: /Original agenda/ })).toHaveAttribute("href", "https://sonoma-county.legistar.com/x");
    expect(screen.getByText("Aye")).toHaveClass("text-red-700");
    expect(screen.getByRole("link", { name: /Summary Report/ })).toHaveAttribute("href", "https://sonoma-county.legistar1.com/s.pdf");
    expect(screen.getByRole("button", { name: "Save review" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Decision"), { target: { value: "confirmed_conflict" } });
    fireEvent.change(screen.getByLabelText("Investigator note"), { target: { value: "Voted 12/17/2019 without recusal; spouse employed by LandPaths." } });
    fireEvent.click(screen.getByRole("button", { name: "Save review" }));
    expect(await screen.findByText("Confirmed conflict")).toBeInTheDocument();
    const reviewCall = fetch.mock.calls.find(([url]) => String(url).includes("/review"))!;
    expect(JSON.parse(String(reviewCall[1]?.body))).toEqual({ status: "confirmed_conflict", note: "Voted 12/17/2019 without recusal; spouse employed by LandPaths." });
  });
});
