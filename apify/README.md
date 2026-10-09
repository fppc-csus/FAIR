# FAIR agenda PDF Actor

Standalone TypeScript Actor for discovering public council agenda PDFs. Uses
the existing `apify-client` dependency to read Actor input and write the default
dataset. No database credentials, PDF item parsing, or conflict detection.

## Deploy from this repository

1. Commit and push this folder to the branch you want Apify to build.
2. Create an Actor, select **Source → Git repository**, and enter:

   ```text
   https://github.com/fppc-csus/FAIR.git#main:apify
   ```

3. Build the Actor, then run it with the contents of `INPUT.example.json`.
4. Inspect the default dataset and the `SUMMARY` key-value-store record.
5. Set `APIFY_ACTOR_ID` and `APIFY_TOKEN` in the FAIR server environment.
   The existing server integration already supplies the expected input.

For a private repository, configure repository access in Apify. Deployment-key
authentication uses `git@github.com:fppc-csus/FAIR.git#main:apify` and a read-only
GitHub deploy key. Never commit API tokens.

The Actor definition explicitly sets the Docker context to this folder, so the
image does not install or build the rest of FAIR. Change `main` in the Git URL
if these files are pushed to a different branch.

## Local development

From this folder:

```sh
npm ci
npm test
npm run build
INPUT_PATH=INPUT.example.json npm start
```

Local runs write `storage/dataset.jsonl` and `storage/summary.json` (ignored by
Git). Each local run replaces the prior dataset. Cloud runs use Apify-provided
storage IDs and token. Tests use fixtures/mocks and make no live requests.

## Input and output

Required: `cityName`. `startUrl` is optional. Without it, the Actor looks up an
exact California city-government match in CISA's public `.gov` domain registry
and crawls that homepage. Missing or multiple matches fail explicitly; provide
the city's official agenda URL to bypass discovery. This is not a general web
search and does not cover every California city. A `.gov` registration does not
guarantee a working website. The resolved URL is saved in the cloud `SOURCE`
key-value-store record.

Defaults: `maxDepth: 4` for city discovery (`2` for explicit URLs unless supplied
by the input schema), `maxPages: 200`, `sameDomainOnly: true`,
`lookbackDays: 14`. The starting page is depth zero. `maxPages` counts document
requests, including PDFs, but excludes robots requests and retries. Each request
gets at most three attempts. Crawling is sequential and paced, with a 30-second
timeout and 20 MB response limit.

Each dataset record has `pdf_url`, `meeting_date` (`YYYY-MM-DD`), and `city_name`,
plus `source_page_url` and `document_title`. City names are preserved unchanged.
The cutoff uses the Pacific calendar date minus `lookbackDays`, inclusively;
published future meetings are included. Numeric dates use US month/day/year.
Documents must have a PDF signature, not merely a PDF filename or content type.

## Scope and limitations

- This first implementation supports static HTML links and table/list meeting
  rows. It does not execute JavaScript, extract dates from PDF contents, or OCR.
- The example archive URL comes from FAIR's existing integration; live support
  for Lemon Grove and Calexico has not been verified. Inspect each city's actual
  results before enabling unattended ingestion. City-specific adapters may be
  necessary for complex markup and dynamically rendered archives.
- Redirects are intentionally blocked. Configure the final archive URL; links
  requiring redirects are logged as errors rather than followed unsafely.
- HTML extraction is a limited dependency-free link scanner, not a full browser
  DOM parser. Nested or malformed markup may need a city-specific adapter.
- Missing dates are skipped. Dates are taken from row/link context, filenames,
  or a meeting page heading; conflicting dates require manual review.
- Exact URL/date duplicates are removed. Original and amended documents with
  different URLs are both retained: automatic supersession is not implemented.
- Minutes, videos and clearly labeled attachments are excluded heuristically.
  Review results for false positives, especially mixed-board archives.
- With `sameDomainOnly`, external HTML is not traversed; directly linked
  document endpoints on external hosts may be fetched and validated as PDFs.
- Robots rules are conservative: all Disallow groups are honored and Allow
  exceptions are not applied. Missing robots.txt (404) is allowed; other robots
  failures skip the host. No logins, cookies, proxies or bypasses are used.
- Public-address checks are defense in depth, not a sandbox for hostile URLs;
  only configure trusted city sources. DNS checks are not connection-pinned.
- A starting-page failure or dataset-write failure fails the run. Individual
  document failures are logged and counted in SUMMARY. A successful run with
  zero records is not proof that the archive contains no agendas.
- Long-run migration/checkpoint resume is not implemented; run bounded crawls.

Apify reference: https://docs.apify.com/actors/development/deployment/source-types