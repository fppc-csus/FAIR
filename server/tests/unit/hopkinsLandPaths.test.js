// Regression for the client-reported case FPPC No. 22/207: on 2019-12-17 the
// Sonoma County Board of Supervisors approved Tourism Impact Fund awards
// (Legistar file 2019-1709) including "LandPaths, $20,000"; Supervisor Lynda
// Hopkins's 2019 Form 700 Schedule C lists LandPaths as a source of income.
// Every link that previously blocked the match is exercised here: the name
// appears only in the matter text, the agenda says "Sonoma County" while the
// filer's agency is "County of Sonoma", and the imported filer is unverified.
import { describe, expect, it, vi } from "vitest";
import { detectConflictsForAgendaItems } from "../../src/detection/detectConflicts.js";
import { buildLegistarAgendaRow } from "../../src/ingestion/legistarAgendaRow.js";
import { relatedNamesFromDetails, buildColumnLabels } from "../../src/parsers/parserUtils.js";

const matterText = `Title:
..Title
Fiscal Year 2019-2020 Tourism Impact Fund Awards
..End
Recommended Action:
A) Authorize the County Administrator to execute agreements for a total of $102,000 with grantees: Boys and Girls Club of Sonoma Valley, $30,000; Sonoma Ecology Center, $10,000; Nuestra Comunidad, $10,000; LandPaths, $20,000; Russian Riverkeeper, $25,000;`;

function memoryPrisma({ agendaItems, scheduleCde = [], scheduleA2 = [], scheduleB = [] }) {
  const conflicts = [];
  const prisma = {
    $transaction: async (fn) => fn(prisma),
    jurisdiction: { findMany: async () => [{ id: "county-sonoma", name: "County of Sonoma" }, { id: "fresno", name: "City of Fresno" }] },
    dataSource: { findMany: async () => [] },
    agendaItem: { findMany: async ({ where }) => agendaItems.filter((item) => where.id.in.includes(item.id)) },
    scheduleAInvestment: { findMany: async () => [] },
    scheduleBRealEstate: { findMany: async () => scheduleB },
    scheduleCdeIncome: { findMany: async () => scheduleCde },
    scheduleA2BusinessPosition: { findMany: async () => scheduleA2 },
    conflict: {
      findMany: async () => conflicts,
      update: vi.fn(),
      createMany: async ({ data }) => { conflicts.push(...data); return { count: data.length }; },
    },
    _conflicts: conflicts,
  };
  return prisma;
}

const hopkinsFiling = { id: "filing-hopkins", filingYear: 2019, politicianId: "hopkins", originalFilename: "County of Sonoma -- Form 700 (2019).xlsx",
  politician: { jurisdictionId: "county-sonoma", needsReview: true } };

const sonomaItem = {
  id: "item-2019-1709",
  ...buildLegistarAgendaRow({
    source: { id: "sonoma-source", cityName: "Sonoma County", legistarBaseUrl: "https://webapi.legistar.com/v1/sonoma-county" },
    meeting: { EventDate: "2019-12-17T00:00:00" }, meetingId: 2400,
    item: { EventItemId: 28386, EventItemMatterId: 5339, EventItemTitle: "Fiscal Year 2019-2020 Tourism Impact Fund Awards" },
    matterText,
  }),
};

describe("Hopkins / LandPaths (FPPC No. 22/207)", () => {
  it("flags the December 17, 2019 Tourism Impact Fund vote as a source-of-income candidate", async () => {
    const prisma = memoryPrisma({
      agendaItems: [sonomaItem],
      scheduleCde: [{ id: "c-landpaths", filingId: hopkinsFiling.id, politicianId: "hopkins", sourceName: "LandPaths", amount: "$10,001 - $100,000", scheduleType: "C", filing: hopkinsFiling }],
    });

    const result = await detectConflictsForAgendaItems([sonomaItem.id], { prisma, eligibilityPolicy: { period: "YEAR_OFFSETS", offsets: [0, 1] } });

    expect(result.inserted).toBe(1);
    expect(prisma._conflicts[0]).toMatchObject({
      politicianId: "hopkins", agendaItemId: sonomaItem.id, conflictType: "INCOME", severity: "HIGH",
      entityName: "LandPaths", filingYear: 2019, jurisdictionId: "county-sonoma",
    });
  });

  it("flags a name listed inside a disclosure, such as an A-2 business's own income source", async () => {
    const prisma = memoryPrisma({
      agendaItems: [{ ...sonomaItem, id: "item-ecology", itemText: "Agreement with Sonoma Ecology Center for watershed work" }],
      scheduleA2: [{ id: "a2", filingId: hopkinsFiling.id, politicianId: "hopkins", entityName: "Foggy River Farm", businessPosition: "Partner", filing: hopkinsFiling,
        details: [{ label: "LIST SINGLE SOURCES OF INCOME OF $10,000 OR MORE", value: "Sonoma Ecology Center; None" }] }],
    });

    await detectConflictsForAgendaItems(["item-ecology"], { prisma, eligibilityPolicy: { period: "YEAR_OFFSETS", offsets: [0] } });

    expect(prisma._conflicts).toHaveLength(1);
    expect(prisma._conflicts[0].conflictType).toBe("INCOME");
    expect(prisma._conflicts[0].entityName).toContain("Sonoma Ecology Center");
    expect(prisma._conflicts[0].entityName).toContain("Foggy River Farm");
  });
});

describe("Form 700 related parties and column labels", () => {
  it("extracts income sources and holdings but never commercial lenders", () => {
    const related = relatedNamesFromDetails([
      { label: "SOURCE OF RENTAL INCOME OF $10,000 OR MORE", value: "Lindsey Mirresi (tenant)" },
      { label: "NAME OF LENDER", value: "Freedom Mortgage" },
      { label: "LIST SINGLE SOURCES OF INCOME OF $10,000 OR MORE", value: "Chevron, Kinder Morgan, Tesoro Refining & Marketing, LLC, Valero" },
      { label: "INVESTMENT — BUSINESS ENTITY/NAME", value: "Swallowfork, LLC" },
      { label: "LIST SINGLE SOURCES OF INCOME OF $10,000 OR MORE", value: "N/A" },
    ]);
    expect(related.map(({ name, kind }) => `${kind}:${name}`)).toEqual([
      "INCOME:Lindsey Mirresi", "INCOME:Chevron", "INCOME:Kinder Morgan", "INCOME:Tesoro Refining & Marketing, LLC", "INCOME:Valero",
      "INVESTMENT:Swallowfork, LLC",
    ]);
  });

  it("labels grouped columns from both header rows and drops form hints", () => {
    expect(buildColumnLabels(
      ["NAME OF SOURCE", "IF APPLICABLE, LIST DATE\r\n(mm/dd/yyyy)", null, "INVESTMENT", null, "FAIR MARKET VALUE\r\n(Select from drop down list)"],
      [null, "ACQUIRED", "DISPOSED", "BUSINESS ENTITY/NAME", "DESCRIPTION OF BUSINESS ACTIVITY", null],
    )).toEqual([
      "NAME OF SOURCE", "IF APPLICABLE, LIST DATE — ACQUIRED", "IF APPLICABLE, LIST DATE — DISPOSED",
      "INVESTMENT — BUSINESS ENTITY/NAME", "INVESTMENT — DESCRIPTION OF BUSINESS ACTIVITY", "FAIR MARKET VALUE",
    ]);
  });
});
