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

**PROVISIONAL — CLIENT APPROVAL PENDING.** Eligibility is separate from the
entity/amount matching rules. `server/src/config/eligibilityPolicy.js` controls
the filing-period policy; `server/src/detection/eligibility.js` evaluates it.
The default is `PENDING`: no new automatic candidates are generated, and existing
candidates are **not** deactivated because the policy is pending. An operator can
explicitly configure `FAIR_FILING_PERIOD_OFFSETS` as comma-separated nonnegative
meeting-year minus filing-year offsets (for example `0,1`), pending written
client approval. This is a provisional calendar-year approximation, **not** a
determination of legal filing coverage. Exact reporting dates are not stored.

Agenda items use a linked meeting jurisdiction, or an unambiguous jurisdiction
ID/name from `cityId`/`cityName`. Conflicting or unknown city mappings require
review. Disclosures require the filing politician's canonical jurisdiction to
equal the agenda jurisdiction; cross-city filings are excluded. Missing meeting
dates, filing years, filing/disclosure identifiers, unreviewed politician identities,
inconsistent politician IDs, or unresolved jurisdictions require review, not
automatic matching. Detection returns `reviewRequired` reasons to ingestion
callers. The authenticated `GET /api/admin/politicians/eligibility-review`
endpoint exposes unresolved or identity-review filing politicians, agenda items
without meeting dates or city identifiers, and whether the period policy is
pending. Ambiguous city-name mappings and missing
filing years are currently surfaced only in the detection result; a comprehensive
persisted per-item review queue is not yet implemented. Correcting metadata and
rerunning detection is necessary before candidates can be generated.

New automated candidates retain filing/disclosure IDs, filing year, jurisdiction,
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

The checked-in Jira export requires client approval of these rules. This repository
contains no written client approval artifact as of September 28, 2026, so that
external sign-off remains outstanding before FAIR should be represented as an
authoritative legal determination.
