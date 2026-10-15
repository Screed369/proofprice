# Free listings pack (DRAFTS ONLY, nothing has been submitted)

Prepared 15 Oct 2026. Simon submits these by hand.

## Core facts

- **Name:** ProofPrice
- **One line:** Real prices people actually paid, from official data, for AI agents.
- **160 characters:** MCP server and API that answers "what did people actually pay?" for homes, rents, fuel, energy, food and more, from official open data. No key needed.
- **Long description:** ProofPrice answers one question for AI agents: what did people actually pay for X, here, recently? Each answer is a price range (median, 10th-90th percentile), sample size, period, confidence, source, licence and price type, built from official open data (land registries, statistics offices, regulators). Aggregates only: no figure from fewer than 5 records. Posted or asking prices are never presented as paid prices. 16 read-only tools cover home sales, rents, fuel, household energy, groceries, farm and land prices, cars, airfares, broadband, childcare, medical prices, medicines, government contracts, a price check and coverage. Remote MCP over Streamable HTTP, no sign-in, plus a REST API.
- **Tags:** prices, real-estate, rents, fuel, energy, groceries, open-data, government-data, statistics, mcp, rest-api, europe
- **URLs:** Site https://proofprice.com · MCP https://proofprice.com/api/mcp · Answer pages https://proofprice.com/prices · Connect guides https://proofprice.com/connect · OpenAPI https://proofprice.com/openapi.json · llms.txt https://proofprice.com/llms.txt · Code https://github.com/Screed369/proofprice · Contact hello@proofprice.com · Licence MIT (code)
- **Connect snippet:** `claude mcp add --transport http proofprice https://proofprice.com/api/mcp`

## Per directory

| Directory | What to submit |
| --- | --- |
| Glama (glama.ai/mcp/servers) | Claim/add the server via the GitHub repo URL; use the 160-char text and tags. Remote server URL above. |
| mcp.so | "Submit" form: name, 160-char text, long description, GitHub URL, server URL (type: streamable-http). |
| PulseMCP | Submit via pulsemcp.com "Submit a server": GitHub URL and website URL. |
| Cursor directory (cursor.directory) | Submit MCP entry: name, one line, config `{ "mcpServers": { "proofprice": { "url": "https://proofprice.com/api/mcp" } } }`. |
| Official MCP registry | `server.json` already exists in the repo (`com.proofprice/pricepaid`); publishing needs an account step by Simon. |

## awesome-mcp-servers PR text (punkpeye/awesome-mcp-servers)

Title: `Add ProofPrice (official-data prices paid)`

Body:

> Adds ProofPrice, a remote MCP server that returns what people actually paid (homes, rents, fuel, household energy, groceries, childcare, medicines) from official open data, with source, period, sample size and licence on every answer. Read-only, no API key, Streamable HTTP. https://proofprice.com · https://github.com/Screed369/proofprice

Suggested list line (check the repo's current category and emoji legend before sending; likely Finance & Fintech or Data Platforms):

`- [Screed369/proofprice](https://github.com/Screed369/proofprice) 🏎️ ☁️ - Prices people actually paid (homes, rents, fuel, energy, groceries) from official open data, with source, period, sample size and licence.`

## data.gov.ie reuse showcase text

> **ProofPrice** uses Irish open data to answer "what did people actually pay?" for AI assistants and developers. It reuses the PSRA Residential Property Price Register (home sales, with attribution to the Property Services Regulatory Authority), RTB rent averages and CSO consumer price tables (CC BY 4.0), and EU Weekly Oil Bulletin fuel prices. Only aggregates are published (median, range, sample size, period) with source and licence on every answer. Examples: https://proofprice.com/prices · Contact: hello@proofprice.com

(PSRA re-use terms require: acknowledge source and copyright, reproduce accurately, not for advertising a particular product. Keep the attribution line.)

## Which sources may be redistributed as dataset files

Hugging Face and Kaggle would host ProofPrice's own **aggregates** (library CSVs), not raw records. Only sources with a clear open licence are listed. Check each source's `attribution` text before upload.

**OK (open licence, redistribution with attribution):**

- CC BY 4.0: be-home-prices (Statbel), ie-rtb-rents, ie-cso-prices, ie-childcare-fees (CSO), eu-oil-bulletin, eu-energy, eu-farm-prices, eu-land-prices (European Commission / Eurostat), nl-home-prices (CBS), no-home-prices, no-ssb-rents (SSB), pt-home-prices (INE), au-nsw-rents
- CC0: se-home-prices, se-scb-rents
- Open Government Licence v3.0 (UK): gb-hmlr-ppd, gb-ons-rents, gb-ons-price-levels, gb-desnz-fuel, gb-childcare-fees, gb-contracts-finder, gb-nhs-pca
- Licence Ouverte / Etalab 2.0: fr-fuel, fr-medicines (fr-dvf also has reuse conditions: no re-identification of people)
- Public domain / US government works: us-eia-fuel, us-eia-energy, us-bls-average-prices, us-dol-childcare, us-dot-airfares
- Other open licences: it-fuel (IODL 2.0), sg-hdb-resale, sg-hdb-rents, sg-coe (Singapore Open Data Licence), tw-home-sales, tw-rents (Taiwan Open Government Data License), ca-statcan-fuel, ca-statcan-prices (Statistics Canada Open Licence), es-fuel (Spanish PSI reuse), br-aneel-electricity (ODbL; share-alike applies to the dataset), nz-mbie-fuel, nz-mbie-rents (CC BY per MBIE)

**NOT yet (check or hold back):**

- ie-ppr: PSRA terms (not CC BY on the PSRA site; prohibits promoting a product). Publish aggregates only after reading the terms once more; not in the first upload.
- br-fuel, mx-fuel: licence marked UNCONFIRMED in the code.
- us-home-sales, us-nadac, us-usaspending, us-cms-medicare: licence differs by dataset or none stated.
- ca-cmhc-rents (CMHC licence agreement, revocable), at-home-prices, au-home-sales, dk-home-prices, fi-home-prices (national statistics terms; check attribution wording), eu-ted, eu-broadband (Eurostat/Commission reuse; likely fine, confirm).
- at-fuel: taken offline.

## Hugging Face dataset card (draft)

```
---
license: other
license_name: per-source-open-licences
pretty_name: ProofPrice open aggregates
language: [en]
tags: [prices, real-estate, rents, fuel, energy, open-data]
size_categories: [10K<n<100K]
---
# ProofPrice open aggregates

Daily aggregate prices (median, 10th-90th percentile, sample size, period) computed by ProofPrice from official open data. No individual records, no personal data.

## Sources and licences
Every row carries its source id; each source keeps its own licence (CC BY 4.0, CC0, OGL v3.0, Licence Ouverte 2.0, public domain and others). Attribute the original publisher. See https://proofprice.com/sources.

## Fields
source_id, area, item, date, median, p10, p90, n, currency, unit, price_type.

## Limitations
Prices paid and posted prices are labelled by price_type and must not be mixed. Figures built from fewer than 5 records are never published. Information, not a valuation.

Live API and MCP: https://proofprice.com
```

## Kaggle dataset description (draft)

**Title:** ProofPrice: official prices paid, daily aggregates
**Subtitle:** Medians and ranges for homes, rents, fuel and energy from official open data
**Description:** Daily aggregates (median, 10th-90th percentile, sample size, period) computed from official open data: land registries, statistics offices and regulators. Only the sources listed under "OK" in the listings pack are included, each under its own open licence with attribution in the `source_id`/`attribution` columns. No individual records. Price type (transaction, official statistic, posted price) is stated on every row. Live access: https://proofprice.com (MCP and REST, no key). Contact hello@proofprice.com.
**Licence field:** "Other (specified in description)".
