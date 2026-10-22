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

## Adapters: one plug for hundreds of portals (`lib/adapters/`)

Many governments run the same few open-data platforms, so you rarely need to write fetch code from scratch.
`import { ... } from "../../lib/adapters"` gives you a URL builder, a parser and a paging helper per platform. Parsers are
pure and tested against real responses; fetch wrappers use `lib/http.ts` (hard timeout) and stop at a row cap.

| Adapter | Portal software | Portals that run it (examples) | Typical use |
| --- | --- | --- | --- |
| `ckan` | CKAN | data.gov.uk, data.gov.au, open.canada.ca, catalog.data.gov, data.qld.gov.au, data.gov.sg (`/api/action`) | `datastore_search`, `datastore_search_sql`, `package_show` to find the newest CSV/JSON |
| `socrata` | Socrata (SODA) | data.cityofchicago.org, data.cityofnewyork.us, data.sfgov.org, data.cdc.gov | SoQL: `$select`, `$where`, `$group`, `$order` |
| `opendatasoft` | OpenDataSoft Explore API v2.1 | data.economie.gouv.fr, opendata.paris.fr, data.iledefrance.fr | `records` with `select`/`where`/`group_by`, `exports` with a limit |
| `arcgis` | ArcGIS REST (FeatureServer / MapServer) | hub.arcgis.com sites, services.arcgis.com layers, agency servers such as tigerweb.geo.census.gov | layer `query`, counts, statistics |
| `jsonstat` | JSON-stat 2.0 (+ Eurostat helpers) | Eurostat; PxWeb / PxStat offices such as Statistics Norway and the CSO in Ireland | statistics cubes: `eurostatUrl`, `parseJsonStat` |

Example: a source that asks a Socrata portal for one aggregate per request (no bulk file, a few rows back):

```ts
// sources/us-chi-example/source.ts   (INFO is the SourceInfo block defined above it)
import { socrataQuery, soqlString } from "../../lib/adapters";
import { buildAnswer, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
export async function chicagoPrices(item: string, baseUrl?: string): Promise<PriceAnswer> {
  const rows = await socrataQuery("data.cityofchicago.org", "abcd-1234", {
    select: "price", where: `item = ${soqlString(item)} AND date > '2026-01-01T00:00:00'`, order: "date DESC", limit: 500,
  });
  const s = summarise(rows.map((r) => Number(r.price)));          // SoQL returns numbers as strings: convert
  return buildAnswer({ source: INFO, query: { country: "US", item }, summary: s, currency: "USD", unit: "per item",
    period: { from: "2026-01-01", to: null }, method: "Median of ...", describe: (x) => `Median ${x.median} USD.`, baseUrl });
}
```

Other adapters work the same way: `ckanSearch` / `ckanAll`, `odsQuery` / `odsAll`, `arcgisQuery` / `arcgisAll`,
`fetchEurostat` / `fetchJsonStat`. The `*All` helpers page for you and never return more than `maxRows` (default 5 000).

Rules:
- **Bulk files still go through `harvest()`.** An adapter is for live questions that return a few rows or an aggregate.
  A whole dataset or a daily dump is collected once a day by `harvest()` into the price library and answered from there;
  never download it per request. (Exports without a `limit`, and downloading the file that a `ckanLatestResource` URL points to, are for `harvest()` only.)
- **Official statistics** (an average or median that a statistics office or regulator publishes, such as Eurostat) use
  `buildStatisticAnswer` from `lib/answer.ts` and `price_type: "official_statistic"`. See `sources/eu-energy/` for a complete example.
- Facts first still applies: probe the real response (see the **Probe** recipe in CLAUDE.md), copy it into your test as a fixture,
  and write the date you checked it.

## Kits: a whole source from a short config (`lib/adapters/kits/`)

For a table a statistics office publishes (one official figure per item, place and period: PxWeb, PxStat/JSON-stat, Eurostat,
SDMX CSV, OData, CKAN datastore), do not hand-write fetch/parse/answer/harvest code: write a config for `defineStatsTableSource`
(about 60 lines) and a fixture test that calls `checkKitFixture`. Recipe and rules: `lib/adapters/kits/README.md`. The kit folder
belongs to the Adapter Steward; ask for kit changes on the Notion Gap fixes page ("Kit request").

## Optional: an outside check (`crossCheck`)

If the publisher (or another official body) states a headline figure for the same place and period, add `crossCheck` to the
manifest from a `crosscheck.ts` in your folder (copy `sources/ie-ppr/crosscheck.ts` or `sources/es-fuel/crosscheck.ts`). Name the
EXACT official series, 1 to 6 like-for-like places, a tolerance, the bias you expect (the alarm is a jump in the gap, not the gap),
and the known differences in plain words. Publisher readers live in `sources/_crosscheck/feeds.ts` with a fixture test. Probe the
official file once before you add it. It is internal: the weekly `crosscheck.yml` writes `library/_crosscheck/<id>.csv`; nothing is
shown to agents. `tests/registry.test.ts` says what to fix if it is malformed.
