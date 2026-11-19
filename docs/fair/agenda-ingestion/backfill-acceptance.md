# Historical agenda backfill — client acceptance record

## Status

**Pending production execution and client acceptance.** No production backfill
was run while preparing this procedure. The agreed historical dates and
authoritative launch-city roster were not present in the repository, so final
counts cannot be stated here.

## Agreed scope

| Scope item | Client-approved value |
|---|---|
| Inclusive start date (YYYY-MM-DD) | Pending |
| Inclusive end date (YYYY-MM-DD) | Pending |
| Launch cities | Pending; list every city and its enabled ingestion source |
| Client approver and date | Pending |

Do not treat an omitted city, an empty provider response, or a zero-item result
as evidence of complete coverage. Reconcile this roster against enabled
production `DataSource` records before running either command.

## Execution

Run both applicable paths for the approved period, using production server
configuration and an exact configured city name for each city:

```sh
npm --prefix server run backfill:legistar -- --city "<CITY NAME>" --start YYYY-MM-DD --end YYYY-MM-DD
npm --prefix server run run:apify-agendas -- --city "<CITY NAME>" --start YYYY-MM-DD --end YYYY-MM-DD
```

Run only the source type configured for that city. Omit `--city` only after
confirming that every enabled source belongs to the approved launch roster.
These commands write agenda items and conflict results to the configured
database. Historical runs recheck conflict detection on existing items, and
duplicate-safe upserts make retries safe; they do not prove upstream coverage.

The CLI must exit unsuccessfully if the requested Legistar city is not
configured, any Legistar city or detector fails, no matching Apify source
completes, an Apify document/source error occurs, or conflict detection fails.
For Apify, the CLI checks the Actor run's `SUMMARY` and fails the run when
`errors` or `remaining` is nonzero. Inspect the summary and document-level
outcomes; a bounded crawl can leave pages unvisited even if the Actor itself
succeeds.

## Results by launch city and source

Add a row for every roster entry and source type run. Use persisted `SyncLog`
records for the detailed per-source outcomes and the CLI output for aggregate
counts. `Final stored agenda rows` must be measured from production for the
city/date range after ingestion, not inferred from `itemsFound`.

| City | Source | Dates | Meetings/documents found | Items found/parsed | Inserted | Existing/skipped | Final stored agenda rows | Conflict candidates | Conflicts inserted | Detection failures | Source errors / limitations | Status |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |

Record zero counts explicitly. Explain whether a zero means a complete empty
upstream result, an unsupported source, missing history, or another limitation.
For Apify, distinguish documents found, fetched, skipped by quality, and parsed
agenda items; a skipped PDF is not an agenda item count.

## Duplicate and detection checks

- Confirm the Legistar item identity and Apify `(city, meeting date, item
  number)` constraints are present in the production schema.
-   Compare `itemsInserted` and `itemsSkipped` with per-city `SyncLog` values, and
  compare final stored rows with the CLI's per-city `finalItemCount`. Record any
  mismatch and investigate it.
- Confirm every completed source log has zero `detectionErrors`; the backfill
  commands also fail when detection reports an error.
- Rerun the same bounded command only when needed to verify idempotency. Record
  the second run's inserted/skipped counts; do not interpret a zero insertion
  count as proof that all upstream meetings were returned.
- Record any provider cap, timeout, skipped meeting/document, parse failure,
  or conflict-detection error as a limitation; do not report the city as fully
  covered until resolved or explicitly accepted by the client.

## Known source limitations to check against observed results

- **Legistar:** meeting retrieval is paginated but capped at 5,000 results per
  city/run; hidden and test meetings are intentionally excluded. Empty or
  unavailable upstream event/item data cannot be distinguished from absent
  historical records without independent source verification.
- **Apify:** discovery is a bounded static-HTML crawl (depth 2, up to 200
  document requests by default); JavaScript-rendered archives and OCR are not
  supported. Missing/ambiguous dates, robots restrictions, inaccessible or
  redirected documents, and image-only, unsupported, or oversized PDFs can
  reduce coverage. Inspect Actor `SUMMARY`, per-document outcomes, and the
  city's official archive for the target period.
- **Conflict detection:** FAIR reports candidates for human review, not legal
  determinations. Successful detection counts do not establish precision or
  recall, and do not resolve missing disclosure, identity, or source data.

Update the table with measured production results, replace pending scope values,
attach the relevant run identifiers/log references, and obtain client sign-off
before marking AC8 accepted.
