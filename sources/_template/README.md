# How to add a data source (the Builder recipe)

One source = one folder. You only ever create files inside `sources/<your-id>/`. Nothing else needs editing:
the MCP tools, REST API, coverage, openapi.json, llms.txt, home page, smoke tests and daily collector all pick it up.

1. **Facts first.** The Notion Source Pipeline row must have verified facts: exact URL, fields, sample rows, licence.
2. **Copy this folder** to `sources/<cc>-<topic>` (e.g. `sources/ie-ppr`, `sources/de-fuel`). Lower-case, digits, dashes.
3. **`source.ts`**: the `INFO` block (publisher, licence, attribution, limits), exported pure parse functions,
   and one async function that fetches and returns `buildAnswer({ source: INFO, ... })`.
4. **`index.ts`**: the manifest (`defineSource`). Pick the `category` (a folder in `categories/`), list `countries`
   (ISO codes: GB not UK), add `paramNotes` for your country, at least one working `examples` entry (the first is
   a production smoke test), and `handle()`.
5. **Daily collector** (for a bulk file, or a live feed worth tracking over time): add `harvest()` returning one day of
   aggregate rows (use `aggregateDaily` from `lib/library/aggregate.ts`) and `historyKey()`. A bulk-only source
   (big CSV files) should harvest into the library and answer from it, never download the whole file per request.
6. **Tests:** `source.test.ts` with a fixture copied from the LIVE format (write the date you checked it).
7. `npm ci && npm test && npm run typecheck && npm run build` must all pass. `tests/registry.test.ts` explains any
   manifest mistake in plain words.
8. Branch `src/<id>`, push, preview-deploy, test the example live, merge to `main`.

A brand-new kind of question (e.g. drug prices) needs a new folder in `categories/` too (copy `categories/fuel`).
If your country needs a parameter the tool does not have, add it under `extraParams` in your manifest.
Never edit another source's folder.

Rules: official open data, licensed data, partner data or verified receipts only. Aggregates only for anything about
people's homes or purchases. No figure from fewer than 5 records. Asking prices are never presented as paid prices.
