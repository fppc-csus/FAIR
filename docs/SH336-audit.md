# SH-336 pre-launch credential audit

Date: November 8, 2026 (America/Los_Angeles). Reviewer: Ishkaram Gill.
Baseline: supplied snapshot of main commit a9262bf. Status: IN PROGRESS; NOT a release security approval.

## Completed evidence

- User ran Gitleaks 8.30.1 against all locally available Git refs: 210 commits, no leaks detected. Reports: Desktop/SH336-history-redacted.json and SH336-files-redacted.json. File scan covered the clean audit worktree (not ignored local files in the original worktree). Scanner success is not proof that no secrets exist elsewhere.
- Only client/.env.example and server/.env.example were listed as tracked environment files at the audited checkout. Templates excluded from the uploaded ZIP; contents not reviewed here.
- Supabase FAIR production project visible under fppc-csus; shared project email has Owner role. Client approval and actual custodians remain unverified.
- Railway service laudable-light in invigorating-heart/production connects to fppc-csus/FAIR, main, root server. Migrations: npx prisma migrate deploy; start: npm start; health path /health. Deployment shown active. Health endpoint not independently requested.
- Railway variable names cover database URLs, Supabase privileged key, Apify token, origin, first-owner email and scheduler controls. Values not inspected. NODE_ENV absent from explicit list; effective runtime value unverified. Gemini credentials absent from explicit list; optional feature scope requires confirmation.
- Vercel fair has VITE_API_URL and VITE_SUPABASE_URL in Production/Preview, VITE_SUPABASE_ANON_KEY in Production, and a truncated publishable-key variable name in Production/Preview. No server-secret names among the four visible VITE variables. Values and deployed assets unverified.
- Apify shared account owns fair-agenda-pdf-scraper. One masked personal token visible. Token permissions, expiration and rotation not established.
- Google 2-Step Verification off, recovery phone/email absent, password last changed April 3. GitHub 2FA off, Google connected, no GitHub password configured. Apify 2FA off. Supabase membership MFA indicator shows cross. Railway/Vercel independent MFA controls not reviewed.

## Open findings and proposed owners

| Finding | Provisional severity | Proposed owner | Closure evidence |
| --- | --- | --- | --- |
| Privileged Supabase key, database password and Apify token shared in Discord and this conversation; active status unknown | High | Sina + client service custodians | Replacement deployed where needed, old credentials revoked/reset, successful smoke checks, dated confirmation without values |
| Shared Google password disclosed and matches the decoded historical DB password | High | Sina + client | Distinct replacement passwords, coordinated database/deployment updates, approved custodians and secure distribution |
| Shared privileged account; MFA off across inspected accounts; Google recovery methods missing | High | Client account owner + Sina | Named custodians/access review, coordinated MFA/recovery setup and confirmation of who retains recovery material |
| Server credentials in Vercel, including Preview; actual need unverified | Medium pending review | Sina + frontend deployment owner | Review SSR/build/runtime usage; remove unnecessary credentials, redeploy and test, inspect client assets for secrets |
| Preview lacks the anon-key variable used by reviewed client code | Medium | Frontend owner | Provide intended public configuration or implement/test publishable-key fallback; preview login succeeds |
| Production configuration missing-variable behavior not comprehensively validated | Medium | Ishkaram + backend owner | Run provided preflight with actual deployment env privately; fix missing/invalid names and test application error behavior |
| Apify resource access says anyone with ID can read | Medium pending data review | Apify custodian + Mao | Review resources for sensitive input/logs; restrict access where needed and verify ingestion compatibility |

Shared accounts and disabled MFA are observed findings; task wording requires verification but does not by itself mandate a particular MFA policy. Client/release owner must classify launch blockers. Rotation of potentially active disclosed credentials is required before an audit pass. Do not include secret values in tickets, logs or evidence.

November 8 follow-up — Sina confirmed the credentials were shared privately in the team Discord for development. Production use, rotation, and revocation remain unverified.

## Environment preflight

New scripts are standalone, read-only, dependency-free and do not change application startup. They do not load .env automatically or contact services.

From repository root:

```bash
node --test scripts/check-release-env.test.mjs
node scripts/check-release-env.mjs server
node scripts/check-release-env.mjs client
```

Run server/client checks only in a trusted environment containing that target's deployment variables. Do not export production secrets to chat or copy them into commands. A local empty audit worktree is expected to fail required-variable checks. Optional Gemini, initialized admin memberships and source-specific Actor IDs produce review warnings. Scheduler expression validity is left to existing node-cron validation. Preflight cannot verify token liveness, scopes, MFA, authorization, or deployed bundle contents.

## Validation of proposed changes

Local validation on November 8, 2026:

- After generating the Prisma client, `npm test` passed with 89 frontend, 458 backend, and 23 Apify tests.
- All seven configuration-checker tests passed.
- Documentation navigation validation passed, and all four documentation tests passed.
- Production configuration checks and credential rotation remain pending.

## Remaining acceptance items

Confirm ownership/approved account custodians for all services including Gemini if used; confirm Resend remains disabled/unimplemented. Inspect deployment assets without exposing values. Resolve rotation and configuration findings. Verify how the deployed app handles missing required configuration. Record exact release commit and final evidence. Obtain release owner's final security go/no-go. Audit remains IN PROGRESS.
