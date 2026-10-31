# FAIR — task routing directory

Use this index to load the **smallest useful context set**. Paths are relative to the repository root. Read nearby tests with the implementation; avoid unrelated folders.

## Task → files

| Task | Read first | Main implementation | Tests / validation | Usually skip |
|---|---|---|---|---|
| Public page, route, or styling | `client/CONTEXT.md`, `client/app/CONTEXT.md` | `client/app/routes.ts`, relevant `client/app/routes/*.tsx`, `client/app/components/`, `client/app/app.css` | colocated `*.test.tsx`; `cd client && npm test && npm run typecheck` | server internals unless the response shape changes |
| Client requests, loading, errors | `client/CONTEXT.md` | `client/app/lib/request.ts`, `client/app/hooks/usePublicData.ts`, `client/app/hooks/useCityDiscovery.ts` | colocated tests plus `server/tests/unit/useCityDiscovery.test.ts` | parsers and migrations |
| Admin login/session/guard | `client/CONTEXT.md`, `server/CONTEXT.md` | `client/app/adminAuth.ts`, `client/app/adminComponents.tsx`, `server/src/lib/auth.js` | `client/app/adminAuth.test.ts`, `server/tests/unit/auth.test.js` | ingestion logic |
| Express route or API contract | `server/CONTEXT.md` | `server/src/app.js`, matching file in `server/src/routes/` | matching `server/tests/unit/*Routes*.test.js` or feature test | Apify Actor and Python experiments |
| Public search | `server/CONTEXT.md` | `server/src/routes/search.js`, search indexes in `server/prisma/migrations/20260927160000_add_search_tsvector_indexes/` | `server/scripts/benchmark-search.mjs`, public UI tests | Form 700 parsers |
| Form 700 upload/parsing | `docs/fair/form700-ingestion/CONTEXT.md` | `server/src/routes/admin/upload.js`, `server/src/parsers/`, `server/src/lib/storage.js`, `server/src/utils/findOrCreatePolitician.js` | `server/tests/unit/upload.test.js`, parser and politician tests | agenda-only code |
| Conflict detection/rules | `docs/fair/entity-resolution/CONTEXT.md`, `docs/conflict_rules.md` | `server/src/config/conflictRules.js`, `server/src/detection/`, `server/src/utils/entityNorm.js`, `server/src/utils/findOrCreatePolitician.js` | detection/matching tests in `server/tests/unit/` | UI unless output changes |
| Conflict review/export/report | `server/CONTEXT.md` | `server/src/routes/conflicts.js`, `server/src/routes/admin/reports.js`, `server/src/utils/conflictExport.js`, `server/src/utils/conflictReportTemplate.js` | conflict detail/export/report tests | ingestion parsers |
| Legistar ingestion/sync | `docs/fair/agenda-ingestion/CONTEXT.md`, `docs/fair/cron-jobs/CONTEXT.md` | `server/src/ingestion/legistar*.js`, `server/src/jobs/nightlySync.js`, `server/src/jobs/runNightlyLegistarSync.js` | `server/tests/unit/nightlySync.test.js`, `runNightlyLegistarSync.test.js`; opt-in integration test | `APIs/` unless comparing legacy behavior |
| Apify Actor scraping | `apify/CONTEXT.md` | `apify/src/` and `apify/.actor/` | `cd apify && npm test && npm run build` | `server/src/jobs/` unless changing ingestion contract |
| Apify result ingestion | `docs/fair/agenda-ingestion/CONTEXT.md`, `apify/CONTEXT.md` | `server/src/jobs/runApifyAgendaScrape.js`, `server/src/ingestion/pdfParser.js`, `server/services/apifyscraper.js` | `runApifyAgendaScrape.test.js`, `pdfParser.test.js` | legacy Python helper |
| Scheduling/manual sync | `docs/fair/cron-jobs/CONTEXT.md` | `server/src/jobs/scheduleCronJobs.js`, `server/src/routes/adminSync.js`, `.github/workflows/` | nightly/Apify job tests; inspect workflow status | `server/src/queues/` and `server/src/workers/` (legacy/unwired) |
| Prisma schema/application migration | `supabase/CONTEXT.md` | `server/prisma/schema.prisma`, `server/prisma/migrations/` | `cd server && npx prisma validate && npm test` | `supabase/migrations/` unless Storage/RLS/auth changes |
| Supabase Storage/RLS/auth SQL | `supabase/CONTEXT.md`, `supabase/migrations/CONTEXT.md` | `supabase/migrations/` | inspect SQL and relevant server auth/storage tests | Prisma migrations unless app schema changes |
| CI/deployment | `.github/workflows/CONTEXT.md`, relevant package scripts | `.github/workflows/ci.yml`, Dockerfiles, package manifests | `npm run docs:check` plus package checks | disabled schedule files unless enabling them |
| Documentation/navigation | `CLAUDE.md`, this file | nearest `CONTEXT.md`, `README.md`, `scripts/check-docs.mjs` | `npm run docs:check && npm run test:docs` | application source unless verifying a claim |

## Repository map

| Path | Status and purpose |
|---|---|
| `client/` | Active React application. Routes are registered in `client/app/routes.ts`. |
| `server/` | Active Express API, Prisma schema, ingestion, detection, jobs, scripts, and tests. |
| `apify/` | Active standalone TypeScript Apify Actor package for finding agenda PDFs. |
| `supabase/` | Supabase-only migrations and policy guidance; not the main application schema. |
| `docs/fair/` | Cross-cutting feature guides; each guide points to real implementation. |
| `docs/` | Domain/schema/smoke-test documentation and assets. Some markdown files are empty placeholders. |
| `.github/workflows/ci.yml` | Active backend CI. The two `scheduled-*.yml` files currently contain only `# disabled`. |
| `APIs/` | Legacy/experimental Python agenda helper; production ingestion is in `server/` and `apify/`. |
| `Backend/` | Legacy placeholder; do not add primary backend work here. |
| `Jira-sprints/` | Historical/planning CSV exports; search only when a task explicitly concerns backlog history. |
| `.clinerules/` | Local coding-agent rules for React, tests, and README updates. |
| `scripts/` | Repository maintenance tooling, currently documentation validation. |

## High-signal entry points

- Client route manifest: `client/app/routes.ts`
- Client shell: `client/app/root.tsx`
- Server route mounting: `server/src/app.js`
- Server process and cron startup: `server/src/index.js`
- Prisma data model: `server/prisma/schema.prisma`
- Conflict thresholds: `server/src/config/conflictRules.js`
- Legistar pipeline: `server/src/jobs/nightlySync.js`
- Apify ingestion pipeline: `server/src/jobs/runApifyAgendaScrape.js`
- Actor runtime: `apify/src/runtime.ts`

## Context and generated-content policy

- Read: the nearest context guide, relevant source, direct imports, and matching tests.
- Search before reading broad folders: filenames → exported symbol/route → callers.
- Do not load: node_modules/, package lock bodies, build output, `client/.react-router/`, binary XLSX/ICO files, `.DS_Store`, or Jira CSV bodies unless specifically needed.
- Empty placeholders (`docs/architecture.md`, `docs/client_operations_manual.md`, `docs/credentials.md`, `server/src/queues/syncQueue.js`, and `server/test_scheduleCDE.js`) are not implementation evidence.
- Potentially stale/unwired files include `server/src/routes/adminRoutes.js`, `server/src/workers/syncWorker.js`, and old root-level `server/test_*.js`; verify imports before relying on them.

## Required final validation

Run focused tests while working. Before completing any code, configuration, dependency, or feature task, run the root suite plus checks for every affected workspace. Documentation-only tasks may run only the two documentation commands. Test-infrastructure changes must also run coverage.

```bash
# Required after any non-documentation change
npm test

# Required after test framework, setup, dependency, or coverage changes
npm run test:coverage

# Required for documentation changes
npm run docs:check
npm run test:docs

# Additional affected-workspace checks
npm --prefix client run typecheck && npm --prefix client run build
npm --prefix apify run build
cd server && npx prisma validate
```

Do not mark work complete when a required command fails; resolve it or explicitly report the remaining failure.
