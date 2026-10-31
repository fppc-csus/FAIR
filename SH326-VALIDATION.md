# SH-326 validation and API contract

GET /api/conflicts returns {data, total, page, pageSize}. Default page is 1;
default pageSize is 20; maximum is 100. The legacy limit parameter is an alias
for pageSize. Invalid parameters return 400 with {error}. Valid unknown UUIDs
return 404; malformed conflict UUIDs return 400.

Filters: city (exact displayed city), repeated types, repeated severities,
fromDate and toDate (YYYY-MM-DD, inclusive UTC detected date), reviewStatus
(pending, confirmed_conflict, not_applicable). Sort: detectedAt (newest), oldest,
severity (HIGH, MEDIUM, LOW). Every order ends with a unique ID tie-breaker.
City uses agenda city, then official jurisdiction, then Unknown, matching the
existing dashboard contract. GET /api/conflicts/filters supplies global cities.
CSV keeps its existing eight-column contract and includes every matching row,
not just the current page. Export remains bounded in 250-row batches.

Count and page queries share a repeatable-read snapshot. Offset pages are stable
for unchanged data, including timestamp ties; concurrent insertions or review
changes between requests can move rows. A frozen dataset or cursor/snapshot
protocol is required if cross-request snapshot stability is needed.

## Apply and test

From the repository root:

```bash
cd server
npm ci
npx prisma generate
npx prisma validate
npm test
# Apply the new indexes to your development/staging database:
npx prisma migrate deploy
cd ../client
npm ci
npm test
npm run typecheck
npm run build
cd ..
npm run docs:check
npm run test:docs
```

The SH-318 Prisma initialization fix is in a separate PR. If it has not merged,
unit suites that import the real Prisma module may still need the existing
local environment configuration. This package does not overwrite SH-318 files.

## Representative database performance evidence (pending)

No live database or credentials were supplied. Index deployment, query plans,
and performance are NOT verified. Agree a latency target with the team and use
representative staging data; do not claim the acceptance criterion is complete.

From server, run the read-only benchmark for default, combined filters, severity,
and late pages. Record total rows, PostgreSQL plans, execution times, and API
latency (count plus page plus hydration, including network) against the agreed target.

```bash
node scripts/benchmark-conflicts.mjs
node scripts/benchmark-conflicts.mjs 'city=Sacramento&types=INCOME&severities=HIGH'
node scripts/benchmark-conflicts.mjs 'sort=severity'
node scripts/benchmark-conflicts.mjs 'page=100'
```

The CASE severity index is SQL-only because Prisma does not model expression
indexes. Review future generated migrations so this index is retained.

## Manual checks

- Load a bookmarked filtered URL; reload and browser Back preserve filters/page.
- Next/Previous request only one page; changing a filter resets page to 1.
- Date range and review state affect dashboard and CSV identically.
- City choices include cities outside the current page.
- Invalid URL parameters show an error and Clear filters recovers.
- Empty results, late pages, timeout/retry, and offline errors are usable.
- Detail shows official, agenda, city/date, schedule, severity, and rule reference.

Prepared in a restricted runtime: JavaScript syntax and documentation checks can
run, but npm dependency downloads were denied. Documentation validator tests passed (3/3). The documentation path check in
this sanitized ZIP reports missing node_modules, generated React Router files,
and the intentionally excluded credentials document; verify it in the full local
checkout rather than creating placeholder credential files.

Full Vitest, TypeScript, build,
and database results must be recorded after running locally. Do not mark Done
until those checks and representative database verification pass.
