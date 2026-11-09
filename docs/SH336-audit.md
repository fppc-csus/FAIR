# SH-336 Pre-launch credential audit

**Audit date:** November 8, 2026 (Pacific time)
**Auditor and SH-336 sign-off owner:** Ishkaram Gill
**Repository baseline:** `main` commit `a9262bf`
**Status:** In Progress. Release sign-off pending.

## Completed evidence

- Gitleaks 8.30.1 scanned the clean audit worktree and 210 commits across locally available Git refs. Both scans reported no leaks. The redacted reports are `SH336-history-redacted.json` and `SH336-files-redacted.json`. The worktree scan covered the separate audit checkout.
- The tracked environment-file check listed only `client/.env.example` and `server/.env.example`. The review archive excluded both templates.
- The shared project account has the Owner role on the FAIR production project in Supabase under `fppc-csus`. The approved custodians and account recovery arrangements still need verification.
- Railway’s `laudable-light` production service is connected to `fppc-csus/FAIR` on `main`, with `server` as the root directory. The dashboard showed an active deployment configured with `npx prisma migrate deploy`, `npm start`, and `/health` as the health-check path. An independent health check remains pending.
- Railway lists variables for database access, Supabase, Apify, the frontend origin, the initial admin email, and scheduler settings. The effective production values remain unverified. `NODE_ENV` and Gemini key names were absent from the explicit service-variable list.
- Vercel’s `fair` project shows `VITE_API_URL` and `VITE_SUPABASE_URL` in Production and Preview, `VITE_SUPABASE_ANON_KEY` in Production, and a Supabase publishable-key entry in Production and Preview. The four visible `VITE_*` names correspond to public configuration. The values and deployed browser bundle still need verification. Vercel also lists server credential names whose build or runtime use needs review.
- The shared Apify account owns `fair-agenda-pdf-scraper`. The dashboard showed one masked personal API token and no connected third-party apps. Token permissions, expiration, and rotation remain unverified.
- Google 2-Step Verification, GitHub 2FA, and Apify 2FA were off when reviewed. The Google account showed no recovery phone or email and listed April 3 as the last password change. GitHub showed a connected Google account. Supabase showed an × under MFA for the shared Owner account. Railway and Vercel MFA and recovery status remain unverified.

## Credential follow-up

On November 8, Sina said the credentials were shared privately in the team Discord for development. Ishkaram then verified that the Supabase secret key listed in the FAIR production project exactly matches the key shared in Discord. Whether Railway uses that key remains unverified. Record only status, dates, affected services, and restricted evidence references.

| Credential | Evidence | Rotation and revocation status | Evidence needed to close |
| --- | --- | --- | --- |
| Supabase secret key | On November 8, Ishkaram confirmed an exact match between the key listed in the FAIR production Supabase project and the key shared in Discord for development. | Previously shared key confirmed still listed as of November 8. Railway usage and subsequent revocation remain unverified. | Identify deployments that use the key, coordinate replacement, verify the backend works with the new key, and record the date the old key was revoked. |
| Database password | The password was shared in the development `.env` message and used in both database connection strings shown there. | Unverified | Confirm whether the database password was reset and the old password invalidated. Record updates to affected deployments and the database connectivity check. |
| Apify API token | A token was shared in the development `.env` message. Apify shows a masked personal token, and Railway lists `APIFY_TOKEN`. | Unverified | Confirm whether the shared token was revoked. If it was still active, record the replacement, old-token revocation, and ingestion smoke-test result. |
| Shared Google password | The shared account was used during the audit. The password provided for that account matched the historical database password. | Unverified | Confirm whether the Google password was replaced with a distinct password. Record who controls account access and recovery. |

## Open findings and proposed owners

| Finding | Provisional severity | Proposed owner | Closure evidence |
| --- | --- | --- | --- |
| The shared Supabase secret key is still listed in the production project. The status of the other shared credentials remains unverified. | High | Sina and service custodians | Record Supabase key replacement and revocation, plus the backend smoke-test result. Confirm the status of the other shared credentials and record remediation where required. |
| Shared privileged access, missing Google recovery methods, and MFA disabled on inspected accounts | High | Client account owner and Sina | Approved custodians, confirmation of who requires access, and documented MFA and recovery status where supported. |
| Server credentials listed in Vercel, including Preview | Medium, pending review | Sina and frontend deployment owner | Verify build, server runtime, and deployment use. Remove unnecessary entries and verify the deployed browser bundle contains no privileged credentials. |
| Preview lacks the anon-key variable used by the reviewed client code | Medium | Frontend owner | Verify Preview sign-in with the intended public configuration. If needed, configure the public key the code expects or implement and test a publishable-key fallback. |
| Effective production configuration and missing-variable behavior remain unverified | Medium | Ishkaram and backend/frontend deployment owners | Run the preflight privately against the effective deployment environments. In staging, omit a required variable and record how the application reports it. |
| Apify resource access allows reading by resource ID | Medium, pending review | Apify custodian and Mao | Review whether the setting exposes sensitive inputs or logs. If access changes are needed, verify ingestion still works afterward. |

## Environment preflight

From the repository root, run the test suite for the checker:

```bash
node --test scripts/check-release-env.test.mjs
```

Run each preflight in a trusted environment where the corresponding deployment variables are already loaded:

```bash
# Railway backend environment
node scripts/check-release-env.mjs server

# Vercel frontend build environment
node scripts/check-release-env.mjs client
```

The scripts read the supplied environment and report variable names and validation errors without printing credential values. A clean local worktree without deployment variables will report missing settings. Verify credential validity, access controls, and deployed browser assets separately.

## Local validation

Local validation on November 8, 2026:

- After generating the Prisma client, `npm test` passed with 89 frontend, 458 backend, and 23 Apify tests.
- All seven configuration-checker tests passed.
- Documentation navigation validation passed, and all four documentation tests passed.

## Remaining acceptance items

- [ ] Coordinate replacement of the shared Supabase secret key, verify the backend with the replacement, and record revocation of the old key.
- [ ] Verify the status of the shared database password, Apify token, and Google password. Record rotation and revocation evidence where required.
- [ ] Verify approved production account custodians and access for Supabase, Apify, Railway, and Vercel. Confirm whether Gemini and Resend are enabled and verify their account ownership if applicable.
- [ ] Record MFA and recovery status where supported, including the remaining Railway and Vercel checks.
- [ ] Run the production configuration preflight, review server credential placement and deployed browser assets, and document missing-variable behavior in staging.
- [ ] Record the exact release commit, date, auditor, and restricted evidence references. Ishkaram Gill records the SH-336 audit decision before go-live once the acceptance criteria are satisfied.

**Current decision:** Local checks passed. The previously shared Supabase secret key was confirmed still listed in the production project on November 8. Credential remediation and production verification remain open.
## Database password cutover review

- Railway Production `DATABASE_URL` matches the database password shared on October 26. The `DIRECT_URL` comparison remains unverified. Both Railway variables are editable and are on the cutover checklist.
- Vercel Production and Preview `DATABASE_URL` both match the previously shared value. Vercel Project Storage showed no connected resource, and the reviewed frontend source had no direct database URL references. Deployment usage remains unverified.
- Before any reset, Railway `/health/ready` returned HTTP 200 with database status `ok`.
- Reset status: pending. Confirm which Vercel entries are needed, coordinate updates for affected deployments, and rerun readiness and public smoke checks after the cutover.
