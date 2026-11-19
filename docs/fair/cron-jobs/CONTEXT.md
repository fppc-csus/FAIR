# Workspace — cron and synchronization

## Implemented paths

- `server/src/index.js` recovers stale persisted runs, then invokes `scheduleCronJobs()`.
- `server/src/jobs/scheduleCronJobs.js` schedules Legistar and Apify jobs only when `CRON_ENABLED=true`.
- `server/src/jobs/runNightlyLegistarSync.js` and `runApifyAgendaScrape.js` are direct CLI entry points.
- Scheduled and CLI Apify runs share `server/src/ingestion/apifyAgenda.js` with the authenticated manual Apify sync in `server/src/routes/admin/sources.js`.
- `server/src/routes/adminSync.js` exposes the authenticated manual Legistar trigger.

## Production schedule

The Railway API service is the single production scheduler owner. Set these
variables on that service only; do not configure a second scheduler for these
jobs. Local development and CI keep `CRON_ENABLED=false`.

| Variable | Production value | Behavior |
|---|---|---|
| `CRON_ENABLED` | `true` | Enables the Railway server's `node-cron` schedules |
| `CRON_TIMEZONE` | `America/Los_Angeles` | Interprets both schedules in Pacific time, including daylight-saving changes |
| `LEGISTAR_CRON_SCHEDULE` | `0 2 * * *` | Daily at 02:00; fetch a 30-day lookback |
| `LEGISTAR_LOOKBACK_DAYS` | `30` | Legistar lookback window |
| `APIFY_AGENDA_CRON_SCHEDULE` | `10 3 * * 1` | Monday at 03:10; fetch a 14-day lookback |
| `APIFY_LOOKBACK_DAYS` | `14` | Apify lookback window |

Detection and Legistar backfill are manual/admin- or operator-triggered, not
scheduled.

## Concurrency, recovery, and retry policy

Each Legistar job, Apify job, and Apify city ingestion has a persisted
`SyncJobRun` row. A Postgres partial unique index permits only one `running`
row per job key, so another process skips an overlapping run. Runs heartbeat
every 30 seconds. Startup and the next claim mark a run with no heartbeat for
five minutes as `interrupted`, fail its remaining running sync logs, and free
the job key without database intervention.

There are no automatic retries inside a provider run. Per-city/PDF errors are
recorded and remaining cities/documents continue; failed work is retried at
the next scheduled cadence or by an explicit admin/CLI rerun. Legistar agenda
items use their stable provider item ID, Apify agenda items use
`(city_id, meeting_date, item_number)`, and conflicts have a unique identity
constraint, so reruns do not duplicate data.

## Current deployment status

`.github/workflows/scheduled-legistar-sync.yml` and `scheduled-apify-agendas.yml` are disabled placeholders. Active CI is `.github/workflows/ci.yml`.

Scheduling uses `node-cron` only (the unwired Redis queue/worker stubs were removed). Do not introduce Redis/BullMQ without explicit approval.

Related: `../agenda-ingestion/CONTEXT.md`, `server/CONTEXT.md`.
