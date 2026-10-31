# Backend workspace (`server/`)

## Entry points

- `src/index.js`: loads env, starts cron, listens on the port.
- `src/app.js`: Express middleware and authoritative route mounting; import this in HTTP tests.
- `prisma/schema.prisma`: application data model and camelCase-to-snake_case mappings.
- `src/routes/`: public and authenticated admin endpoints.
- `src/ingestion/`, `src/parsers/`, `src/detection/`: pipeline stages.
- `src/jobs/`: runnable synchronization and scheduler code.
- `src/lib/`: env, Prisma, Supabase, auth, and Storage adapters.
- `tests/unit/` and `tests/integration/`: Vitest suites.

## Active route groups

Public: `/health`, `/api/conflicts` (including `/filters`), `/api/politicians`, `/api/agenda`, `/api/search`.

Admin (Supabase JWT required): `/api/admin/session`, `/api/admin/sources`, `/api/admin/reports`, `/api/admin/politicians`, `/api/admin/history`, `/api/admin/sync`, `/api/admin/upload`.

`src/routes/adminRoutes.js`, `src/queues/syncQueue.js`, and `src/workers/syncWorker.js` are not mounted by `app.js`; verify before modifying them.

## Data and service boundaries

- Prisma owns application schema/migrations under `server/prisma/`; see `supabase/CONTEXT.md` for Supabase-only SQL.
- Prisma uses camelCase fields. Raw SQL and Supabase JS use mapped snake_case table/column names.
- Raw Form 700 workbooks are archived in Supabase Storage; privileged keys remain server-only.
- Gemini is optional and used only in explicit ambiguous matching paths. Resend notifications are not implemented.
- Use `node-cron`; do not introduce Redis/BullMQ without an explicit architecture change.

## Commands

```bash
cd server
npm test
npm run test:integration   # live test remains opt-in through env
npx prisma validate
npx prisma generate
```

Use `DIRECTORY.md` to select the feature guide and exact tests for a task.
