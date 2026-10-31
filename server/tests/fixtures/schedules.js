//Schedule B => real estate
//Schedule C => income
//Schedule D => gifts
//Schedule E => travel
//Schedule A2 => business positions

export const scheduleBFixtures = [
  {
    id: "disclosure-b", filingId: "filing-1",
    politicianId: 1,
    filingYear: 2025, politicianJurisdictionId: "sac",
    propertyDescription: "123 Main Street",
    city: "Sacramento",
    county: "Sacramento",
  },
];

export const scheduleCdeFixtures = [
  {
    id: "disclosure-c", filingId: "filing-1",
    politicianId: 1,
    filingYear: 2025, politicianJurisdictionId: "sac",
    sourceName: "Acme Corporation",
    amount: 5000,
    scheduleType: "C",
  },
  {
    id: "disclosure-d", filingId: "filing-1",
    politicianId: 1,
    filingYear: 2025, politicianJurisdictionId: "sac",
    sourceName: "Downtown Business Association",
    amount: 100,
    scheduleType: "D",
  },
  {
    id: "disclosure-e", filingId: "filing-1",
    politicianId: 1,
    filingYear: 2025, politicianJurisdictionId: "sac",
    sourceName: "Regional Planning Council",
    amount: 250,
    scheduleType: "E",
  },
];

export const scheduleA2Fixtures = [
  {
    id: "disclosure-a2", filingId: "filing-1",
    politicianId: 1,
    filingYear: 2025, politicianJurisdictionId: "sac",
    entityName: "Acme Corporation",
    businessPosition: "Board Member",
  },
];