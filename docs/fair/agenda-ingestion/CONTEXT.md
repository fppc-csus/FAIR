# Workspace — Agenda ingestion

## Role

Ingest **city council agendas** for cross-reference with Form 700 data.

## Sources

1. **Legistar REST API** — structured JSON for cities that use it.
2. **Apify** — scraping where agendas exist only as **PDF** or non-Legistar pages.
3. **PDF parsing** — `pdf-parse` (npm) when the artifact is a PDF.

## Boundaries

- City-specific quirks (URLs, selectors, Legistar endpoints) should be documented next to the code that uses them.
- Normalize to a **common internal shape** before entity matching (see `../entity-resolution/CONTEXT.md`).
- `server/src/ingestion/apifyAgenda.js` is the shared Apify → PDF download → `parsePdfAgenda` → Prisma upsert service used by admin sync and the scheduled/CLI scrape job. Downloads time out after 30 seconds, are streamed with a 20 MB limit, and upsert using `(city_id, meeting_date, item_number)`.
- Apify results are document references, not agenda items: the PDF must yield extractable agenda text before any `agenda_items` row is written. A failed, unreadable, password-protected, image-only, or oversized PDF is recorded as a skipped document and does not stop the remaining documents.
- The original PDF link is retained in `agenda_items.source_url` for admin document links; `item_text` contains only parsed agenda content.
- Legistar rows are built once in `server/src/ingestion/legistarAgendaRow.js` (nightly sync and admin "sync now"). `item_text` holds the title, agenda/minutes notes, action text and the latest **matter text** (`/Matters/{id}/Versions` → `/Texts/{textId}` `MatterTextPlain`, capped at 20,000 characters). Grantee and vendor names often appear only in the recommended action. Re-syncs update changed text and re-run detection; backfill history with `npm run backfill:legistar -- --city "<name>" --start YYYY-MM-DD --end YYYY-MM-DD`.
- Each Legistar item also stores its matter **attachments** (names appended to `item_text`, links in `legistar_item_payload.FairAttachments`) and its **roll-call votes** (`FairVotes`). `server/src/ingestion/legistarVotes.js` links roll-call names to filers in the source's jurisdiction by first and last name and upserts `vote_records`, so the conflict page shows whether the official voted Aye/Nay or recused.
- Admins may paste either a Legistar InSite address (`https://oakland.legistar.com/Calendar.aspx`) or the Web API URL; both are stored as `https://webapi.legistar.com/v1/<client>`. New sources are linked to their jurisdiction so agenda items meet that jurisdiction's Form 700 filers.
- Apify sync-log and data-source metrics distinguish documents found, PDFs fetched, documents skipped, agenda items inserted/skipped, and per-document errors. Admin polling reads the same persisted run results used by scheduled and CLI execution.
- The admin health API and page expose per-document source limitations, safe document links, Apify document counts, and conflict-detection errors from persisted sync logs. URL credentials, query strings, and fragments are not shown.

## Related docs

- `APIs/CONTEXT.md` (Python/helpers), `server/CONTEXT.md`
- `../cron-jobs/CONTEXT.md` for nightly pulls
- `sonoma-pilot-findings.md` for the write-free 2019 workbook/database and staff-report pilot; production sync does not yet enrich supporting documents.
