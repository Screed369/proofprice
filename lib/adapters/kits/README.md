# Source kits (`lib/adapters/kits/`)

A kit turns a short config into a whole source: answer, daily collector, history key, stale-if-error and safety checks.
Owner: the **Adapter Steward** (Simon's OK, 22 Oct 2026). Source builders use kits; they never edit this folder.
Need a feature? Write a "Kit request" line on the Notion **Gap fixes** page. Design: Notion "Research: generic adapters (22 Oct 2026)".

## Kit 1: statistics tables (`defineStatsTableSource`)

For a table a statistics office or regulator publishes with **one official figure per item, place and period** (average retail
prices, average rents, average fuel prices). Not for tables of individual records (stations, sales): those need a median of
records and the 5-record rule (the records kit, planned).

| Reader `kind` | Service | Request |
| --- | --- | --- |
| `pxweb-v1` | PxWeb API v1 (Latvia CSB, Statistics Finland, Slovenia SURS, SCB, Estonia, Iceland) | POST `{query, response: json-stat2}`, newest N periods via `top` |
| `pxweb-v2` | PxWebApi 2 (Statistics Norway) | GET `valueCodes[dim]=...`, `top(N)` |
| `jsonstat` | any JSON-stat 2.0 URL (CSO PxStat) | GET whole dataset |
| `eurostat` | Eurostat dissemination API | GET with dimension filters, `lastTimePeriod` |
| `sdmx-csv` | SDMX 2.1 REST, CSV formats (OECD, ABS, ECB, Eurostat SDMX) | GET `<base>/data/<flow>/<key>?lastNObservations=N` |
| `odata` | OData JSON `{value:[...]}` (CBS StatLine) | GET with `$filter` |
| `ckan-datastore` | a statistics table in a CKAN datastore | GET `datastore_search` |

### The recipe (a new source is one folder, about 60 lines)

1. **Facts first**, as always: Source Pipeline row Verified (a probe of the real reply) and **Licence cleared = Yes**.
2. `sources/<cc>-<topic>/index.ts`:

```ts
import { defineStatsTableSource, StatsTableConfig } from "../../lib/adapters/kits";
export const CONFIG: StatsTableConfig = {
  info: { id: "lv-csb-prices", price_type: "official_statistic", licence: "CC BY 4.0", attribution: "Source: CSB Latvia, table PCC010m. CC BY 4.0.", /* all SourceInfo fields */ },
  licenceCheck: { checked: "2026-10-23", quote: "Data is provided under CC BY 4.0 license", url: "https://...", commercial: "yes" },
  table: { id: "PCC010m", title: "Average retail prices of selected goods" },
  category: "groceries", countryHelp: "LV = Latvia (CSB average retail prices)", placeName: "Latvia",
  reader: { kind: "pxweb-v1", url: "https://data.stat.gov.lv/api/v1/en/OSP_PUB/START/VEK/PC/PCC/PCC010m" },
  dims: { time: "TIME", item: "GOODS_SERVICES" },            // + area: "<dim>" when the table has places
  fixed: { ContentsCode: "PCC010m" },                         // every other dimension pinned to one code
  items: { "milk-1l": { code: "<publisher code>", label: "Milk, 1 l", unit: "per litre", words: ["milk"], labelMustContain: "1 l", plausible: [0.5, 3] } },
  itemParam: "item",
  areas: { ALL: { code: null, iso: "LV", label: "Latvia" } },
  currency: "EUR", measure: "average",
  golden: [{ item: "milk-1l", period: "2026-09", value: 1.23 /* copied BY HAND from the publisher's web page */, seenAt: "https://...", seenOn: "2026-10-23" }],
  whatThisIs: "Average shelf price recorded by CSB price collectors for the consumer price index; not a receipt.",
  method: "...", examples: [{ params: { country: "LV", item: "milk" } }],
};
export default defineStatsTableSource(CONFIG);
```

3. `source.test.ts`: copy one real reply (probe or preview) into a fixture **that includes the golden month**, then
   `assert.deepEqual(checkKitFixture(CONFIG, FIXTURE), [])`. `tests/kits.test.ts` refuses a kit source whose test does not.
4. `npm ci && npm test && npm run typecheck && npm run build`, branch, one preview, merge. Note the golden value
   (figure, page, date) in the Source Pipeline row.

### What the kit guarantees (you cannot switch these off)

- `price_type` is `official_statistic`; answers use `buildStatisticAnswer`: `sample_size` null, the reference period, no invented range.
- `harvest()` writes `n: NO_COUNT` (never a made-up count), one row per item and place for the newest period, dated by the end of
  that period (`referenceDates`), so stale-if-error and history work without more code.
- **Licence gate** (`kitProblems`): a licence page read on a date with a quote; `commercial: "no"` never builds; `"unclear"` or
  restricted words (OPEN-BY-ASK, NC, ND, share-alike, ODbL) build only with a Decision named in `licenceCheck.decision`.
  The attribution must name the publisher and the table id.
- **Golden value**: at least one figure copied by hand from the publisher's own page, checked against the live fixture.
- **Label check**: the publisher's own label for each code must still contain `labelMustContain` (catches code changes such as
  Latvia's February 2026 recoding); otherwise the source refuses to answer.
- **Believable range** per item (`plausible`, at most 50x wide): a value outside it is never answered and is left out of the library.
- Only listed items and places exist: no "all items", no guessed place.

Any change to how the kit reads, checks or answers bumps `KIT_VERSION` in `stats-table.ts` (it is part of every kit source's
`method_version`, so answer ids change honestly). Planned next (research page, days 6-14): SDMX-JSON/ML reader, records kit
(CKAN/DKAN newest file, Socrata) with the 5-record rule, the weekly golden-value re-check in `crosscheck.yml`.
