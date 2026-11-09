# Conflict of Interest Rules

FAIR surfaces **potential** conflicts for review; it does not determine whether an
official has a legal conflict or must recuse. The executable thresholds and rule
references are maintained in `server/src/config/conflictRules.js`; this document
describes the corresponding review rules.

| Schedule | Interest | Trigger used by FAIR | Threshold / severity input | Reference |
|---|---|---|---|---|
| A | Investment | The agenda text names a disclosed business entity or investment. | Investments below $2,000 are not automatically flagged; the disclosed fair-market-value range determines severity. | Cal. Gov. Code §§87100, 87103(a) |
| A-2 | Business position | The agenda text names a business entity in which the filer holds a disclosed position. | The position is flagged regardless of a parsed dollar amount; severity is MEDIUM pending reviewer assessment. | Cal. Gov. Code §§87100, 87103(d) |
| B | Real estate | An agenda item directly names the disclosed property, or a land-use item matches the disclosed city/county. | The disclosed fair-market-value range determines severity. | Cal. Gov. Code §§87100, 87103(b) |
| C | Income | The agenda text names a disclosed income source. | $500 or more when an amount can be parsed; the amount determines severity. | Cal. Gov. Code §§87100, 87103(c) |
| D | Gifts | The agenda text names a disclosed gift source. | $50 or more when an amount can be parsed; the amount determines severity. | Cal. Gov. Code §§87100, 87103(e) |
| E | Travel payments | The agenda text names a disclosed travel-payment source. | $50 or more when an amount can be parsed; the amount determines severity. | Cal. Gov. Code §§87100, 87103(c) |

Entity names are normalized before matching. Scores of 0.90 or above are
accepted automatically; scores from 0.70 through 0.899 are sent to Gemini for a
constrained yes/no resolution. Every stored conflict retains its entity,
rule reference, severity, and source key for auditability.

## Approval status

### Eligibility (SH-324)

The revised SH-324 policy compares verified Form 700 disclosures against **every**
new agenda item, across all jurisdictions and filing years. Jurisdiction and filing
year are required, administrator-verified metadata, **not** comparison filters.
Meeting dates must also be present and administrator-verified. The executable
policy is `server/src/config/eligibilityPolicy.js`; the checks are in
`server/src/detection/eligibility.js`. No filing-year offset setting is used.
Existing records are not implicitly verified by the migration. An administrator
confirms the stored values using authenticated
`POST /api/admin/eligibility/{politician|filing|agenda}/:id/verify`.
Send `{ "expectedValue": ... }` (jurisdiction UUID, integer filing year, or
UTC ISO date-time) matching the value reviewed by the administrator; mismatches
return `STALE_VALUE`. Verification records the confirmed value, admin identity,
time, and an append-only audit event. Changes to jurisdiction, year, item date,
linked meeting, or linked meeting date invalidate verification through database
triggers, including when an old value is later restored. Existing ingestion paths
can still store unverified records.
`GET /api/admin/politicians/eligibility-review` lists unverified records and
reasons. Missing, invalid, or conflicting meeting dates and unverified filing
years or politician jurisdictions are excluded; detection returns `reviewRequired`
reasons. Corrections and confirmations create durable retryable detection runs
in the metadata transaction, dispatched after commit. A politician change
rechecks every filing; a linked meeting-date correction rechecks every agenda
item in the meeting. Agenda verification rechecks the selected item. Failed
runs can be retried under admin detection runs; legacy rows remain untouched.

New automated candidates retain filing/disclosure IDs, filing year, agenda and politician jurisdictions,
meeting date, source path, and legal rule reference. Reprocessing marks only
positively identified SH-324-managed candidates inactive when no longer matched;
reprocessing refreshes their matching evidence, and reactivation preserves existing
review status, notes, and review history. Legacy
rows have unknown ownership and are never automatically reconciled. Public list
and detail responses include `eligibilityStatus` (`active`, `inactive`, or
`unknown`). Inactive records remain accessible by ID for audit but are excluded
from the default public list/CSV, search results, politician/agenda conflict
counts and detail lists, and admin PDF reports so they cannot appear as current
matches. Written client decisions are needed on jurisdiction mapping, reporting
period dates, treatment of unresolved cases, and the applicable filing-period
offsets before this policy is approved.
When disclosure IDs are present, the candidate source key includes the disclosure
ID to distinguish same-named interests in different filings. A legacy candidate
using the older key is retained rather than automatically claimed by SH-324.
Cross-jurisdiction matches do not establish official authority; old disclosures
do not prove a present financial interest. Every result requires human verification,
not a legal determination.
