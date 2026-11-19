# Launch city source configuration

The client-approved launch city selection for the additional-city onboarding
task is Fresno, Oakland, and San Jose. All three use Legistar:

| City | Legistar client ID | Canonical API base URL |
|---|---|---|
| Fresno | `fresno` | `https://webapi.legistar.com/v1/fresno` |
| Oakland | `oakland` | `https://webapi.legistar.com/v1/oakland` |
| San Jose | `sanjose` | `https://webapi.legistar.com/v1/sanjose` |

The source and city-jurisdiction definitions live in `server/prisma/seed.js`.
Run `npx prisma db seed` from `server/` with the authorized target database
configured to persist them. Each source is linked to its city jurisdiction.
New sources are created disabled, so adding the configuration does not turn on
scheduled ingestion before its acceptance criterion is verified. If a matching
Legistar source already exists, the seed updates its canonical city and URL
fields while preserving its enabled state and sync history.

On November 8, 2026, the public Legistar `Events?$top=1` endpoint returned a
valid event array for each of the three client IDs. The source records and
matching `city` jurisdictions are persisted in the configured database and
linked by jurisdiction ID. This is an acceptance snapshot from November 8,
2026 (Pacific time); item counts are non-demo Legistar agenda rows recorded
under each city/source, and sync outcomes are from persisted sync logs:

| City | Source enabled | Stored items | Missing title/date/text | Duplicate Legistar ID groups | Latest observed manual sync |
|---|---:|---:|---:|---:|---|
| Fresno | Yes | 697 | 0 / 0 / 0 | 0 | Success, 575 found, 0 inserted, 575 skipped, 0 conflict candidates, 0 detection errors |
| Oakland | No | 0 | Not applicable | 0 | Failed before ingestion: `Network error: fetch failed`; 0 items found |
| San Jose | No | 162 | 0 / 0 / 0 | 0 | Still marked running with an expired heartbeat at the latest check; completion and item counts are unconfirmed |

Fresno's completed rerun did not insert duplicates. Oakland has no stored
agenda items, so item quality and rerun behavior cannot yet be assessed. San
Jose has stored rows from an earlier import, but the latest manual sync has no
confirmed result. The source setup also contains earlier failed attempts due
to a stale generated Prisma client; that client was regenerated before the
Fresno rerun. No city-specific production conflict candidates have been
confirmed. The matching Schedule C test is synthetic and verifies the shared
Legistar source type only.

The public conflicts filter endpoint returned all three city names. Fresno
and San Jose agenda detail endpoints displayed their city names; no Oakland
agenda detail could be tested because Oakland has no stored agenda rows. No
politicians are currently linked to these city jurisdictions, so public
politician pages cannot yet be verified for launch-city officials.

The local server environment reported `CRON_ENABLED=false`. The Railway
production scheduler setting and deployment logs were not accessible for
verification; do not treat the local value as proof of production scheduler
state. The GitHub scheduled workflows remain disabled placeholders.

Acceptance evidence is partial: city/source configuration and the public
filter integration are verified; AC2 manual sync is confirmed only for Fresno;
AC3 production scheduling, Oakland and San Jose sync completion, complete
agenda-quality/deduplication checks for every city, and city-specific public
politician pages remain outstanding. All source URLs and results are recorded
without credentials or tokens.
