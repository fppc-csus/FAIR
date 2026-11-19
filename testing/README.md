# FAIR system test artifacts

This folder holds the run-for-record evidence for the FAIR System Test Report
(`docs/deliverables/FAIR-System-Test-Report.docx`).

| Path | Contents |
|---|---|
| `run-system-tests.sh` | Runs every automated suite and writes a dated record (verbose text + JSON per workspace, client type check and build, Prisma validation). |
| `results/2026-11-19/` | Run for record of November 19, 2026. |
| `results/2026-11-19/*-vitest.txt` | Human-readable results per workspace (client, server, apify). |
| `results/2026-11-19/*-vitest.json` | Machine-readable results (test names, durations, failures). |
| `results/2026-11-19/client-typecheck.txt`, `client-build.txt`, `prisma-validate.txt` | Build and schema validation output. |
| `results/2026-11-19/screenshots/` | Browser end-to-end evidence referenced by test IDs ST-01 to ST-31. |

Test scripts live next to the code they test: `client/app/**/*.test.tsx`,
`server/tests/unit/*.test.js`, `server/tests/functional/`, and `apify/tests/`.

To produce a new record:

```bash
bash testing/run-system-tests.sh
```
