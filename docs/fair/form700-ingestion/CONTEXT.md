# Workspace — Form 700 ingestion

## Role

**Form 700** files are **uploaded by admins** (raw **XLSX** archived in **Supabase Storage**). Parse with **SheetJS** (`xlsx` npm package) and map rows into your DB model per schedule.

## Schedules (domain vocabulary)

| Schedule | Content |
|----------|---------|
| **A** | Investments |
| **B** | Real estate |
| **C** | Income |
| **D** | Gifts |
| **E** | Travel payments |
| **A-2** | Business positions |

## Parsers (`server/src/parsers/`)

All parsers are pure and share one signature — `parseScheduleX(buffer, filingId)` (a Buffer or an already-read SheetJS workbook) → array of **snake_case** rows, no DB writes, `[]` on unreadable input or a missing sheet. `parseCoverPage(buffer)` → `{ filer_name, agency, district, office_title, filing_year }` (nulls when absent; a sheet whose name contains "cover" is used first, then the filer columns repeated on schedule sheets in NetFile-style exports). Sheets are located by name (`schedule a`, `schedule a-2`, `schedule b`, …) and the header row is detected by scanning for known column names, because FPPC exports put section titles above the headers. `server/src/routes/admin/upload.js` inserts all rows in one `prisma.$transaction`.

After a filing and its archived workbook are committed, the upload creates a
durable conflict-detection run against existing agenda items. Detection is
scoped to the filer's assigned jurisdiction and agenda dates within the filing
year (January 1 inclusive through the following January 1 exclusive). Items
linked to that jurisdiction's meetings and standalone items whose `city_name`
matches the jurisdiction name are eligible. The admin API at
`/api/admin/detection-runs` starts a jurisdiction/year backfill, lists recent
runs, exposes per-run status and item failures, and retries incomplete runs.
Per-agenda progress and unique conflict keys make retries safe; redetection
inserts missing conflicts without modifying review status or notes.

To replace an existing politician/year filing with a corrected workbook,
admins submit `replace_existing=true` with the upload. The archived replacement
is uploaded before the filing and schedule rows are atomically replaced; an
archive or database failure leaves the original filing data intact.

### A-2 column mapping (`schedule_a2_business_positions`)

| Row field (`parseScheduleA2`) | XLSX column (Schedule A-2 sheet) | Notes |
|---|---|---|
| `entity_name` | `NAME OF BUSINESS ENTITY OR TRUST` | required — rows without it are skipped |
| `business_position` | `YOUR BUSINESS POSITION` | e.g. Owner, Trustee, Co-Owner |
| `fair_market_value` | `FAIR MARKET VALUE` (first/left-most, section 1) | the section-4 FMV column for entity-held property is ignored |
| `nature_of_investment` | `NATURE OF INVESTMENT (if "other," describe)` | |
| `gross_income_range` | `INCLUDE YOUR PRO RATA SHARE OF GROSS INCOME TO ENTITY/TRUST` (section 2) | range string, e.g. `$0 - $499` |
| `filing_id` | — | passed in by the caller |

Headers are matched case-insensitively after collapsing whitespace/line breaks, exact match first then prefix match, so the left-most duplicate header wins. Section 3 (sources of income ≥ $10,000) and section 4 (investments/real property held by the entity) are not ingested yet. Broader coverage is tracked separately in SH-344, “Expand Schedule A-2 entity-held asset and income coverage,” and remains optional pending confirmed requirements and conflict-rule applicability.

## Boundaries

## Multi-filer NetFile exports

`server/src/parsers/form700Bulk.js` isolates filer/agency/year and submission
timestamp/type before calling schedule parsers. `server/src/ingestion/form700Bulk.js`
provides write-free previews, exact jurisdiction-scoped identity matching, and
per-filer transactional imports. The admin portal offers authenticated
`POST /api/admin/upload/form700/bulk/preview` and `/bulk/import` (multipart `file`;
import also requires the preview `digest`). The single-filing endpoint rejects
exports containing multiple filers or submission versions.

One latest-submission snapshot per filer/year is active. All submission summaries
are stored in `Form700Filing.importMetadata`; the full original workbook is
archived privately for each imported filing. Older submissions are not separately
active schedule records. Missing amendment schedules are not carried forward;
the preview warns about incomplete amendment coverage and requires admin review.
Existing filer/year rows are skipped, not replaced. Import failures are reported
per filer; successful filings remain committed, and retries skip them. Detection
failures do not undo successful disclosure imports and are shown in results.

Confirmed bulk attempts are written to `Form700ImportRun`, including warnings and
per-filer imported/skipped/failed results. `/api/admin/history` combines these
durable runs with older `Form700Filing.importMetadata`, grouped by workbook digest,
so pre-history imports remain visible without duplicating workbook-wide warnings.
The authenticated `/admin/history` page provides search, warning-only filtering,
pagination, profile links, and schedule counts.

Trusted operators can use `server/scripts/import-form700.mjs` with a workbook path
(preview only), then the printed digest to confirm. Run Prisma migrations and
regenerate the client first. The XLSX limit remains 10 MB; PDF parsing is not part
of this flow. Tests: `server/tests/unit/form700Bulk.test.js`, upload route tests,
and `client/app/components/Form700BulkUpload.test.tsx`.

- Parsing and validation rules belong with **server** code; storage policy with **Supabase Storage** (see `supabase/CONTEXT.md`).
- Do not expose bulk upload or admin endpoints without **Supabase Auth**.

## Related docs

- `server/CONTEXT.md`, `supabase/CONTEXT.md`
- Matching parsed entities: `../entity-resolution/CONTEXT.md`
