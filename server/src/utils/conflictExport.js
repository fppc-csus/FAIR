// Fields used by both the dashboard list and CSV export.
export const conflictInclude = {
  politician: {
    select: {
      fullName: true,
      jurisdiction: {
        select: { name: true },
      },
    },
  },
  agendaItem: {
    select: {
      title: true,
      description: true,
      itemText: true,
      cityName: true,
    },
  },
};

// Turn a database conflict into the fields shown on the dashboard.
export function dashboardRow(conflict) {
  return {
    id: conflict.id,
    reviewStatus: conflict.reviewStatus ?? "pending",
    politicianName: conflict.politician.fullName,
    city:
      conflict.agendaItem.cityName ??
      conflict.politician.jurisdiction?.name ??
      "Unknown",
    conflictType: conflict.conflictType,
    severity: conflict.severity,
    agendaItemSummary:
      conflict.agendaItem.title ??
      conflict.agendaItem.description ??
      conflict.agendaItem.itemText ??
      "Agenda item unavailable",
    detectedAt: new Date(conflict.detectedAt).toISOString(),
    eligibilityStatus: conflict.eligibilityStatus ?? "unknown",
  };
}

// Read and validate filters from the download URL.
export function parseExportFilters(query) {
  const scalar = (key) => {
    const value = query[key];

    if (value == null) return "";

    if (typeof value !== "string") {
      throw new Error(`Invalid ${key} filter`);
    }

    return value;
  };

  const list = (key) => {
    const value = query[key];

    if (value == null) return [];

    const values = Array.isArray(value) ? value : [value];

    if (!values.every((item) => typeof item === "string")) {
      throw new Error(`Invalid ${key} filter`);
    }

    return values.filter(Boolean);
  };

  const fromDate = scalar("fromDate");
  const toDate = scalar("toDate");

  for (const date of [fromDate, toDate]) {
    if (
      date &&
      (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        Number.isNaN(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date
      )
    ) {
      throw new Error("Invalid date filter; use YYYY-MM-DD");
    }
  }

  if (fromDate && toDate && fromDate > toDate) {
    throw new Error("From date must not be after To date");
  }

  return {
    reviewStatus: scalar("reviewStatus"),
    city: scalar("city"),
    types: list("types"),
    severities: list("severities").map((value) =>
      value.toUpperCase()
    ),
    fromDate,
    toDate,
  };
}

// Apply the same filter rules as the dashboard.
export function matchesFilters(row, filters) {
  const date = row.detectedAt.slice(0, 10);

  return (
    (!filters.reviewStatus || row.reviewStatus === filters.reviewStatus) &&
    (!filters.city || row.city === filters.city) &&
    (
      !filters.types.length ||
      filters.types.includes(row.conflictType)
    ) &&
    (
      !filters.severities.length ||
      filters.severities.includes(row.severity.toUpperCase())
    ) &&
    (!filters.fromDate || date >= filters.fromDate) &&
    (!filters.toDate || date <= filters.toDate)
  );
}

export const csvHeaders = [
  "Politician",
  "City",
  "Conflict type",
  "Severity",
  "Agenda item",
  "Detected",
  "Full agenda item text",
  "FPPC rule reference",
];

// Format one CSV row, including commas, quotes, and line breaks.
export function csvLine(values) {
  return values.map((value) => {
    let text = String(value ?? "");

    // Prevent spreadsheet apps from treating text as a formula.
    if (
      /^[\s\uFEFF]*[=+@-]/u.test(text) ||
      /^[\t\r\n]/.test(text)
    ) {
      text = "'" + text;
    }

    return '"' + text.replaceAll('"', '""') + '"';
  }).join(",") + "\r\n";
}

// Build one exported conflict row in the header order.
export function conflictCsvLine(
  conflict,
  row = dashboardRow(conflict)
) {
  return csvLine([
    row.politicianName,
    row.city,
    row.conflictType,
    row.severity,
    row.agendaItemSummary,
    row.detectedAt,
    conflict.agendaItem.itemText ??
      conflict.agendaItem.description ??
      conflict.agendaItem.title ??
      "",
    conflict.ruleReference,
  ]);
}