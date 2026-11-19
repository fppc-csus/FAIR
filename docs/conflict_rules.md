# Conflict of Interest Rules

FAIR surfaces **potential** conflicts for review; it does not determine whether an
official has a legal conflict or must recuse. The executable thresholds and rule
references are maintained in `server/src/config/conflictRules.js`; this document
describes the corresponding review rules.

| Schedule | Interest | Trigger used by FAIR | Threshold / severity input | Reference |
|---|---|---|---|---|
| A | Investment | The agenda text names a disclosed business entity or investment. | Investments below $2,000 are not automatically flagged; the disclosed fair-market-value range determines severity. | Cal. Gov. Code §§87100, 87103(a) |
| A-2 | Business position | The agenda text names a business entity in which the filer holds a disclosed position. | The position is flagged regardless of a parsed dollar amount; severity is MEDIUM pending reviewer assessment. | Cal. Gov. Code §§87100, 87103(d) |
| A-2 / B / C (related parties) | Income or investment held through a disclosure | The agenda text names an A-2 entity's source of income of $10,000+ or entity-held investment, a Schedule B tenant (source of rental income), or a Schedule C commission/rental source. Commercial lenders are never matched (§82030(b)(10)). | Flagged as INCOME or INVESTMENT; the entity label names the parent disclosure. | Cal. Gov. Code §§87103(a), (c) |
| B | Real estate | The agenda text names the disclosed street address or APN. City-name matching (a land-use decision naming the property's city) is off by default because it matched every land-use item in the filer's own city; it remains available as the `matchCity` research option. | The disclosed fair-market-value range determines severity. | Cal. Gov. Code §§87100, 87103(b) |
| C | Income | The agenda text names a disclosed income source. Salary or stipends from a government agency are excluded (§82030(b)(2)). | $500 or more when an amount can be parsed; the amount determines severity. | Cal. Gov. Code §§87100, 87103(c) |
| D | Gifts | The agenda text names a disclosed gift source. | Gifts from one source on the statement are summed and must reach the gift limit for the decision year ($500 2019–20, $520 2021–22, $590 2023–24, $630 2025–26). | Cal. Gov. Code §§87100, 87103(e), 89503 |
| E | Travel payments | The agenda text names a disclosed travel-payment source. | $500 or the gift limit, whichever is lower. | Cal. Gov. Code §§87100, 87103(c), (e) |

Form 700 *reporting* thresholds ($50 gifts, $500 income) are not the
*disqualification* thresholds used above.

Entity names are normalized before matching. Exact phrases anywhere in the
agenda text (including Legistar matter text) score 1.0. Multi-word names may
also match approximately: scores of 0.90 or above are accepted automatically and
scores from 0.70 through 0.899 are sent to Gemini for a constrained yes/no
resolution. One-word names must match exactly.

**Aliases and acronyms (deterministic, no AI).** A disclosed name also matches
the other names in its alias group (`server/src/config/entityAliases.js`, e.g.
Pacific Gas and Electric Company ↔ PG&E ↔ PGE, Southern California Edison ↔ SCE)
and other spellings of an acronym ("PG&E", "PGE" and "P.G.&E." are equal;
acronym tokens must be upper case). Initials are never guessed from an arbitrary
name: guessing matched "Agent for Cement Masons" to Annaly Capital Management, so
spelled-out ↔ acronym pairs must be listed in the alias table.

**Ordinary-word company names.** A one-word name that is also a common English
word ("Apple", "Scoop", "Shell" — curated in `COMMON_WORD_NAMES`), or that the
agenda uses as a lower-case word, is accepted only when the mention is
corroborated: a corporate suffix right after it ("Apple Inc.") or vocabulary
from the filer's reported business activity within ~200 characters (Technology →
software, computer, iPhone, network…). "Apple Blossom Festival" and "Gravenstein
Apple Fair" are rejected for an Apple Inc. investment; "Apple iPads" is accepted. Every stored conflict retains its entity,
rule reference, severity, and source key for auditability.

## Approval status

### Eligibility (SH-324)

Eligibility is separate from the entity/amount matching rules.
`server/src/config/eligibilityPolicy.js` controls the filing-period policy;
`server/src/detection/eligibility.js` evaluates it. The default offsets are
`0,1` (meeting year minus filing year): an annual statement covering year N is
compared with meetings in years N and N+1, reflecting the 12-month look-back
for income and gifts in §87103(c) and (e). Operators may override this with
`FAIR_FILING_PERIOD_OFFSETS` (for example `0`) or set it to `pending` to pause
automatic candidates; existing candidates are not deactivated while paused. This
is a calendar-year approximation, **not** a determination of legal filing
coverage. Exact reporting dates are not stored.

Agenda items use a linked meeting jurisdiction, the jurisdiction an
administrator linked to their data source, or an unambiguous jurisdiction
ID/name from `cityId`/`cityName`. Names are compared canonically, so
"County of Sonoma" and "Sonoma County" (or "City of Fresno" and "Fresno") are
one jurisdiction. Conflicting or unknown city mappings require
review. Disclosures require the filing politician's canonical jurisdiction to
equal the agenda jurisdiction; cross-city filings are excluded. Missing meeting
dates, filing years, filing/disclosure identifiers, inconsistent politician IDs,
or unresolved jurisdictions require review, not automatic matching. Politicians
awaiting identity review are still matched; their candidates are shown with an
"identity unverified" badge until an administrator approves the profile. Detection returns `reviewRequired` reasons to ingestion
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
