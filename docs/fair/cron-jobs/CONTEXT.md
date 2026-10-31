# Workspace — cron and synchronization

## Implemented paths

- `server/src/index.js` invokes `scheduleCronJobs()`.
- `server/src/jobs/scheduleCronJobs.js` schedules nightly Legistar and weekly Apify jobs when `CRON_ENABLED` is true (default true in code).
- `server/src/jobs/runNightlyLegistarSync.js` and `runApifyAgendaScrape.js` are direct CLI entry points.
- Scheduled and CLI Apify runs share `server/src/ingestion/apifyAgenda.js` with the authenticated manual Apify sync in `server/src/routes/admin/sources.js`.
- `server/src/routes/adminSync.js` exposes the authenticated manual Legistar trigger.

Set `CRON_ENABLED=false` on a web host when another scheduler owns execution, otherwise multiple instances can duplicate work. Jobs must remain idempotent and retry-safe.

## Current deployment status

`.github/workflows/scheduled-legistar-sync.yml` and `scheduled-apify-agendas.yml` are currently disabled placeholder files. GitHub Actions scheduling is a target design, not active checked-in behavior. Active CI is `.github/workflows/ci.yml`.

Do not use `server/src/queues/syncQueue.js` or `server/src/workers/syncWorker.js` as architecture references; the queue file is empty and the worker is not wired into startup. Do not introduce Redis/BullMQ without explicit approval.

Related: `../agenda-ingestion/CONTEXT.md`, `server/CONTEXT.md`.
