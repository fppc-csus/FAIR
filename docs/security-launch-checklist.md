# Security launch checklist

This checklist separates evidence available in the repository from checks that
require access to the non-production or production services. A local pass does
not certify a deployed environment.

## Acceptance criteria and evidence

| Acceptance criterion | Status | Evidence | Owner |
|---|---|---|---|
| Admin authorization uses an allowlist, role/claim, or tested single-account control | PASS in code/tests | Active database memberships grant access; the confirmed `FAIR_ADMIN_EMAIL` bootstraps only the first owner. See `server/src/lib/adminAccess.js` and `server/tests/unit/adminAccess.test.js`. | Backend maintainer |
| Unauthenticated and valid-but-unauthorized users cannot call admin endpoints | PASS in code/tests; invitation acceptance is the intentional exception | Application-mount tests check every protected route group, including sync and upload, for 401/403 and verify that sync is not invoked: `server/tests/unit/securityControls.test.js`. `/api/admin/users/accept` is authenticated and additionally requires a valid, unexpired, matching invitation. | Backend maintainer |
| Public endpoints expose only intended fields and do not leak archived files, internal errors, or service credentials | PASS in code/tests | Public politician response uses an explicit allowlist; a regression test injects archive-path/credential fields and confirms they are omitted. Global errors return a generic message: `server/tests/unit/securityControls.test.js`; public route selection tests remain in `server/tests/unit/politiciansRoutes.test.js` and `server/tests/unit/agendaRoutes.test.js`. | Backend maintainer |
| Upload MIME, extension, size, malformed-file, and filename/path controls are tested | PASS in code/tests | `server/tests/unit/upload.test.js` covers MIME, extension, 10 MB limit, malformed XLSX/PDF, and invalid content; `server/tests/unit/storage.test.js` checks Windows/POSIX path stripping and filename length. Storage keys are generated from trusted filing identifiers and sanitized filenames. | Backend maintainer |
| CORS, rate/abuse controls, dependency findings, and production headers are reviewed | PASS locally; deployment configuration still needs verification | CORS tests: `server/tests/unit/cors.test.js`. Helmet headers, API rate limiting, and admin authorization are tested in `server/tests/unit/securityControls.test.js`. Root, client, Apify, and server npm audits report zero vulnerabilities; server production dependencies are clean as well. | Backend maintainer; release owner verifies deployment |
| Supabase Storage privacy and access policies are verified in production | BLOCKED — production project not inspected | Repository migration sets `form700-uploads` to `public=false` (`supabase/migrations/20250407180000_form700_uploads_bucket.sql`). No `storage.objects` policies are created by the checked-in migrations. Verify the live bucket and live policies using the SQL in “Production verification”; test anonymous/authenticated denial against a known object. | Supabase project owner (assign a named operator) |
| Basic load tests cover public list/search and sync without exhausting DB connections | READY TO RUN — not executed against a live environment | `server/scripts/security-load-test.mjs` defaults to 3 workers for 30 seconds, caps runs at 5 workers/60 seconds, and calls the authorized sync endpoint at most once. It requires an explicit non-production acknowledgement. Observe Supabase connection metrics during the run. | Release/platform owner (assign a named operator) |
| Findings, severity, owner, and resolution evidence are recorded before launch | PARTIAL — local findings recorded; named accountable owners and live evidence pending | This table, the dependency audit results, and the production verification steps below record current evidence and blockers. Role owners must be replaced with named owners and production evidence attached before launch approval. | Release owner (assign a named individual) |

## Dependency audit record

The initial resolved-dependency audit found 17 GitHub Advisory CVEs, including
high-severity SheetJS and upload/parser dependencies and a critical
`proxy-addr` finding. The backend manifest and lockfile were updated; the
workbook parser now resolves to the official SheetJS 0.20.3 release, and
compatible transitive fixes were applied with npm overrides. Client React
Router dependencies were updated to 7.18.5; Apify Vite/Vitest and proxy/FTP
transitives were updated to patched versions. Final npm audits report
**0 vulnerabilities** in root, client, Apify, and server dependencies,
including production-only server dependencies. The final advisory assessment
of the remediated root, client, and Apify packages also found no known CVEs.

### Resolved finding ledger

| Severity | Finding | Resolution evidence | Owner |
|---|---|---|---|
| CRITICAL | CVE-2026-90711 — `proxy-addr` 2.0.7 IP-spoofing/trust-subnet flaw | Updated to 2.0.8 in the server lockfile; final server audit is clean. | Backend maintainer |
| HIGH | CVE-2026-102990 — `basic-ftp` 5.3.1 parser DoS; CVE-2026-111181 — `body-parser` 1.20.6 compressed-body DoS | Updated to `basic-ftp` 6.2.1 and `body-parser` 1.20.9; final server audit is clean. | Backend maintainer |
| HIGH | CVE-2026-111755, CVE-2026-111756, CVE-2026-116689 — `follow-redirects` 1.16.0 credential-handling issues | Updated to 1.16.3; final server audit is clean. | Backend maintainer |
| HIGH | CVE-2026-113872 — `multer` 2.3.0 upload teardown DoS | Updated to 2.5.0; final server audit is clean. | Backend maintainer |
| HIGH | CVE-2023-30533 and CVE-2024-22363 — `xlsx` 0.18.5 prototype pollution and ReDoS | Replaced the vulnerable package source with the official SheetJS 0.20.3 release; final server audit is clean. | Backend maintainer |
| MEDIUM | CVE-2026-101911, CVE-2026-101912, CVE-2026-111997 — `ip-address` 10.7.0 parsing and subnet checks | Updated to 10.7.6; final server audit is clean. | Backend maintainer |
| MEDIUM | CVE-2026-88932 — `multer` 2.3.0 orphaned upload writes | Updated to 2.5.0; final server audit is clean. | Backend maintainer |
| MEDIUM | CVE-2026-8723, CVE-2026-82417, CVE-2026-82562, CVE-2026-110816 — vulnerable `qs` 6.14.2/6.15.3 | Locked all server transitive copies to 6.16.1; final server audit is clean. | Backend maintainer |
| HIGH / MEDIUM | Client React Router advisories and `qs`; Apify `apify-client` proxy/FTP chain, Vite, and Vitest advisories | Client Router packages updated to 7.18.5 and `qs` to 6.16.1; Apify Vite updated to 7.3.7, Vitest and coverage provider to 4.1.12, with patched proxy/FTP overrides. Root, client, and Apify audits and final advisory assessments are clean. | Frontend maintainer; Apify maintainer |

These are resolved dependency findings, not outstanding launch blockers. The
role owners above still need named individuals in the release record.

Recheck before release:

```powershell
npm audit
npm --prefix client audit
npm --prefix apify audit
npm audit --prefix server
npm audit --prefix server --omit=dev
```

The backend rate limiter uses an in-memory store. Do not scale the API to
multiple replicas until a shared store is configured and tested. Confirm
`TRUST_PROXY_HOPS` matches the actual trusted ingress chain; an incorrect value
can merge client IPs or trust spoofed forwarded headers. Keep the backend
connection limit at or below the production database budget.

## Production verification

Run these checks using the production Supabase dashboard/operator account;
never paste service-role keys, database URLs, or user tokens into this
checklist or chat.

1. Confirm the `form700-uploads` bucket has `public = false` in
   `storage.buckets`.
2. Inspect `pg_policies` for `storage.objects`; ensure no policy grants `anon`
   or general `authenticated` users access to this bucket. Confirm the server
   can still access required objects using its server-only key.
3. With an anonymous client and a normal authenticated non-admin account, try
   to retrieve a known test object; both must be denied. Do not use a production
   filing as the test object.
4. Verify the deployed `CLIENT_ORIGIN`, HTTPS/HSTS response headers, proxy-hop
   count, one-replica rate-limit assumption, and `PRISMA_MAX_CONNECTIONS`.
5. From a non-production shell only, run the load test while watching database
   connection metrics:

   ```powershell
   $env:FAIR_LOAD_TEST_TARGET = 'non-production'
   $env:FAIR_LOAD_TEST_BASE_URL = 'https://<verified-staging-api-origin>'
   npm --prefix server run load:security
   ```

   To include one manual sync, set `FAIR_LOAD_TEST_SYNC=true` and provide an
   authorized staging token through a secure local secret store. The runner
   never prints the token. Do not run this against production.
6. Attach the sanitized audit output, load-test summary, storage-policy
   evidence, and named owner/resolution notes to the release record. Confirm
   no findings remain open before launch.

The local load-test harness and unit tests do not establish production
availability, Storage policy correctness, or actual database connection
headroom.
