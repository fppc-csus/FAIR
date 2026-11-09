# Launch city source configuration

The client-approved launch city selection for the additional-city onboarding
task is Fresno, Oakland, and San Jose. All three use Legistar:

| City | Legistar client ID | Canonical API base URL |
|---|---|---|
| Fresno | `fresno` | `https://webapi.legistar.com/v1/fresno` |
| Oakland | `oakland` | `https://webapi.legistar.com/v1/oakland` |
| San Jose | `sanjose` | `https://webapi.legistar.com/v1/sanjose` |

The source definitions live in `server/prisma/seed.js`. Run `npx prisma db seed`
from `server/` with the authorized target database configured to persist them.
New sources are created disabled, so adding the configuration does not turn on
scheduled ingestion before its acceptance criterion is verified. If a matching
Legistar source already exists, the seed updates its canonical city and URL
fields while preserving its enabled state and sync history.

On November 8, 2026, the public Legistar `Events?$top=1` endpoint returned a
valid event array for each of the three client IDs. This validates endpoint
availability and identifiers, not a persisted production source record, a
manual sync, agenda quality, deduplication, conflict detection, or scheduled
ingestion. Those acceptance checks remain outstanding. No credentials are
stored in this configuration or documentation.
