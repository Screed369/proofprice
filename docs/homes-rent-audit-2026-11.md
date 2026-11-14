# Homes and rent audit, November 2026

Audit of what ProofPrice holds for home sales and rent. Written 14 Nov 2026 from branch `docs/homes-rent-audit` (base: today's main plus PR #8). No code was changed. Price types are the `price_type` and plain-English text in each source's `source.ts`/`info.ts`, not guessed.

## Summary

- Home-sales sources: **43** (40 distinct countries). Rent sources: **21** (17 distinct countries).
- Home sales by price type (a country can appear in more than one row):
  - Real sale records (`transaction`): 17 sources, 11 countries (CH CO FR GB HK IE PL QA SG TW US)
  - Official average or statistic: 19 sources, 17 countries (AT AU BE CA CH CZ DK FI GB HU LV NL NO NZ PT SE US)
  - Appraised or guideline value: 2 sources, 2 countries (DE ES)
  - Declared tax value, not a price paid (Brazilian ITBI, code label `posted_price`): 4 sources, 1 countries (BR)
  - Index only, no money figure (Eurostat, 2015 = 100): 1 sources, 18 countries (BG CY CZ DE EE ES HR HU IS IT LT LU LV MT PL RO SI SK)
- Rent by price type:
  - Real letting records (`transaction`: bond lodgements, approved HDB rentals, registered rentals): 5 sources, 4 countries (AU NZ SG TW)
  - Official average or statistic: 16 sources, 14 countries (AU CA CH DE ES FI FR GB HK IE NO PT SE US)
  - Appraised, declared or index only: 0
- **Countries where home sales are answered from real sale records: 11** (CH CO FR GB HK IE PL QA SG TW US). Caveats: CH is the city and canton of Zurich only; SG is public housing (HDB) only; GB is England and Wales only; US is seven local areas only; HK is price-band counts (Land Registry) plus discounted public flats.
- **Countries where home sales are answered from any official figure: 40** (28 with a price in money, 12 with only the Eurostat index: BG CY EE HR IS IT LT LU MT RO SI SK). Of the 28, 25 have real records or an official statistic of prices; DE and ES have only appraised/guideline values (plus the index) and BR has only declared tax values.
- Other categories: 9 commercial-property sources, 1 land-prices source, 1 state-property-rents source (listed at the end).
- Live check: 64 calls (first example of each source, `ppcheck=1`, one call each, no retries; plus 1 coverage call). All 64 returned HTTP 200 and status `ok`. One answer (us-detroit-home-sales) was a stale library copy. No `insufficient_data` or `no_matches`. 22 answers carry no sample size by design (official statistics publish no record count).

## Full table: home sales (43)

| Source id | Countries | Publisher | Price type (from code) | Smallest area | Filters | Freshness | Copy | Licence | Live (HTTP/status/s/n) |
|---|---|---|---|---|---|---|---|---|---|
| at-home-prices | AT | STATISTIK AUSTRIA | official average/statistic | district / municipality (100 largest); Vienna postcode maps to district | type (house/flat); per m2 | yearly | copy only (no history) | STATISTIK AUSTRIA imprint | 200/ok/1.2s/- |
| au-home-sales | AU |  | official average/statistic | state or territory (postcode maps to state) | none (all dwellings) | quarterly | copy only (no history) |  | 200/ok/0.5s/- |
| au-sa-metro-home-sales | AU | South Australian Government | official average/statistic | suburb (metro Adelaide) | houses only | quarterly | copy + history | Creative Commons Attribution 4.0 | 200/ok/1.9s/13 |
| be-home-prices | BE | Statbel | official average/statistic | municipality | type (house, flat, facades) | quarterly | copy only (no history) | Creative Commons Attribution 4.0 International | 200/ok/0.3s/1645 |
| br-itbi-fortaleza | BR | Prefeitura Municipal de Fortaleza | declared tax value (not a paid price) | neighbourhood (Fortaleza only) | type (flat/house) | monthly | copy + history | Creative Commons Attribution | 200/ok/0.2s/960 |
| br-itbi-recife | BR | Prefeitura do Recife | declared tax value (not a paid price) | neighbourhood (Recife only) | type (flat/house) | monthly-ish (during the year) | copy + history | Open Data Commons Open Database License | 200/ok/0.3s/3383 |
| br-itbi-rio | BR | Prefeitura da Cidade do Rio de Janeiro | declared tax value (not a paid price) | neighbourhood (Rio only) | type (flat/house) | monthly | copy + history | Creative Commons Attribution 4.0 International | 200/ok/0.2s/1303 |
| br-poa-itbi | BR | Prefeitura de Porto Alegre | declared tax value (not a paid price) | neighbourhood (Porto Alegre only) | type (flat/house) | monthly | copy + history | Creative Commons Attribution | 200/ok/0.4s/1181 |
| ca-bc-ptt | CA | Government of British Columbia | official average/statistic | municipality (British Columbia only) | none (all residential) | monthly | copy + history | Open Government Licence - British Columbia v2.0 | 200/ok/0.2s/1105 |
| ch-zh-canton-home-sales | CH | Kanton Zürich | real sale/letting records | municipality (canton Zurich only) | type (house/flat) | yearly | no copy | opendata.swiss 'terms_open' | 200/ok/1.5s/245 |
| ch-zurich-home-sales | CH | Statistik Stadt Zürich | real sale/letting records | statistical quarter (city of Zurich only) | flats only | yearly | copy only (no history) | Creative Commons CCZero | 200/ok/0.9s/720 |
| ch-zz-bl-home-sales | CH | Kanton Basel-Landschaft | official average/statistic | district (Basel-Landschaft; Zurich city) | flats only | yearly | copy only (no history) | opendata.swiss terms of use | 200/ok/0.7s/- |
| co-igac-home-sales | CO | Instituto Geográfico Agustín Codazzi | real sale/letting records | municipality | urban/rural zone | yearly (ends 2023, not current) | copy only (no history) | Creative Commons Attribution-ShareAlike 4.0 | 200/ok/0.4s/44173 |
| cz-czso-home-prices | CZ | Czech Statistical Office | official average/statistic | country | type (flat/house) | yearly | copy only (no history) | Creative Commons Attribution 4.0 International | 200/ok/0.8s/- |
| de-nrw-irw | DE | Oberer Gutachterausschuss für Grundstückswerte i | appraised/guideline value | town (North Rhine-Westphalia only) | type (flat, house, terraced) | yearly | copy only (no history) | Datenlizenz Deutschland - Zero - Version 2.0 | 200/ok/0.2s/- |
| dk-home-prices | DK | Statistics Denmark | official average/statistic | municipality | type (house/flat) | quarterly | copy only (no history) | Statistics Denmark | 200/ok/7.5s/1477 |
| es-appraised-homes | ES | Ministerio de Transportes y Movilidad Sostenible | appraised/guideline value | municipality 25,000+ (province below that) | none | quarterly | copy only (no history) | Not confirmed | 200/ok/1.0s/- |
| eu-home-price-index | 18 EU (BG CY CZ DE EE ES HR HU IS IT LT LU LV MT PL RO SI SK) | Eurostat | index only (not money) | country | none | quarterly | copy only (no history) | Creative Commons Attribution 4.0 International | 200/ok/0.7s/- |
| fi-home-prices | FI | Statistics Finland | official average/statistic | postcode area | type, room count | quarterly | copy only (no history) | Statistics Finland | 200/ok/1.4s/2013 |
| fr-dvf | FR | Direction générale des Finances publiques | real sale/letting records | postcode | type (house/flat) | twice a year | copy + history | Licence Ouverte / Etalab 2.0 | 200/ok/2.2s/1350 |
| gb-hmlr-ppd | GB | HM Land Registry | real sale/letting records | postal town (England and Wales only) | type (detached, semi, terraced, flat) | monthly | copy + history | Open Government Licence v3.0 | 200/ok/4.9s/3137 |
| gb-ukhpi | GB | HM Land Registry | official average/statistic | council area (Scotland, N. Ireland only) | type | monthly | copy only (no history) | Open Government Licence v3.0. HM Land Registry's | 200/ok/0.3s/- |
| hk-ha-tps-sales | HK | Hong Kong Housing Authority | real sale/letting records | public estate | none | quarterly | copy + history | DATA.GOV.HK Terms and Conditions | 200/ok/0.2s/122 |
| hk-landreg-sales | HK | The Land Registry | real sale/letting records | Hong Kong as a whole (estate gives discounted public flats) | none | monthly | copy only (no history) | DATA.GOV.HK Terms and Conditions | 200/ok/3.0s/70035 |
| hu-ksh-home-prices | HU | KSH | official average/statistic | region / large city | new vs existing | yearly | copy only (no history) | KSH copyright page | 200/ok/2.2s/- |
| ie-ppr | IE | Property Services Regulatory Authority | real sale/letting records | Dublin postal district / county | new vs second-hand | monthly | copy + history | PSRA re-use terms | 200/ok/0.3s/14142 |
| lv-vzd-detached-houses | LV | Valsts zemes dienests | official average/statistic | town / parish (houses) | houses | monthly | copy only (no history) | Creative Commons Attribution 4.0 International | 200/ok/1.3s/49 |
| lv-vzd-home-sales | LV | Valsts zemes dienests | official average/statistic | town / parish (apartments) | apartments only | monthly | copy only (no history) | Creative Commons Attribution 4.0 International | 200/ok/1.3s/4986 |
| nl-home-prices | NL | Statistics Netherlands | official average/statistic | municipality | none | yearly | copy only (no history) | Creative Commons Attribution 4.0 International | 200/ok/0.8s/- |
| no-home-prices | NO | Statistics Norway | official average/statistic | municipality | type (house, terraced, flat) | quarterly | copy only (no history) | Creative Commons Attribution 4.0 International | 200/ok/0.5s/5066 |
| nz-hud-home-sales | NZ | Ministry of Housing and Urban Development | official average/statistic | territorial authority / Auckland local board | none | monthly | copy only (no history) | Creative Commons Attribution 4.0 International | 200/ok/0.2s/2432 |
| pl-rcn-home-sales | PL | Glowny Urzad Geodezji i Kartografii | real sale/letting records | city | flats only | monthly | copy + history | Public register | 200/ok/3.1s/75 |
| pt-home-prices | PT | Statistics Portugal | official average/statistic | municipality (58) | none (bedroom split in answer) | quarterly | copy only (no history) | Creative Commons Attribution 4.0 | 200/ok/3.9s/- |
| qa-home-sales | QA | National Planning Council | real sale/letting records | municipality / district | type (villa, building) | in batches (newest sale 31 Dec 2025) | copy + history | Creative Commons Attribution 4.0 | 200/ok/0.9s/734 |
| se-home-prices | SE | Statistics Sweden | official average/statistic | municipality (houses); county (flats) | type (house/flat) | quarterly | copy + history | CC0. Statistics Sweden | 200/ok/2.3s/1380 |
| sg-hdb-resale | SG | Housing & Development Board via data.gov.sg | real sale/letting records | HDB town (public housing only) | flat type | daily | copy + history | Singapore Open Data Licence v1.0 | 200/ok/2.3s/2073 |
| tw-home-sales | TW | Ministry of the Interior | real sale/letting records | district | type (5 building types) | every 10 days | copy + history |  | 200/ok/0.3s/5708 |
| us-allegheny-home-sales | US | Allegheny County Real Estate Division | real sale/letting records | ZIP (Allegheny County PA only) | none | daily | copy + history | Creative Commons CC0 1.0 Universal | 200/ok/0.1s/1737 |
| us-az-maricopa-home-sales | US | Maricopa County Assessor's Office | real sale/letting records | ZIP (Maricopa County AZ only) | house/condo | monthly | copy + history | No reuse licence is stated for this dataset | 200/ok/0.2s/10888 |
| us-census-new-home-sales | US | U.S. Census Bureau | official average/statistic | country (new houses) | new only | monthly | copy only (no history) | Creative Commons CC0 1.0 | 200/ok/0.2s/- |
| us-dc-home-sales | US | District of Columbia | real sale/letting records | Washington DC (whole city) | house/condo | daily | copy only (no history) | Creative Commons Attribution 4.0 | 200/ok/1.5s/4972 |
| us-detroit-home-sales | US | City of Detroit | real sale/letting records | ZIP (Detroit only) | none | monthly | copy only (no history) | No licence stated on the dataset record | 200/ok/25.8s/6027/STALE |
| us-home-sales | US | State of Connecticut | real sale/letting records | town (CT), NYC neighbourhood/ZIP, Chicago, Cook County township | house/condo/coop | yearly (grand-list year) | copy + history | Public Domain | 200/ok/1.0s/530 |

## Full table: rent (21)

| Source id | Countries | Publisher | Price type (from code) | Smallest area | Filters | Freshness | Copy | Licence | Live (HTTP/status/s/n) |
|---|---|---|---|---|---|---|---|---|---|
| au-adelaide-sa-rents | AU | SA Housing Authority | official average/statistic | suburb or postcode (SA only) | type, bedrooms | quarterly | copy + history | Creative Commons Attribution 4.0 | 200/ok/0.5s/1305 |
| au-justice-tas-rents | AU | Department of Justice | real sale/letting records | postcode or suburb (Tasmania only) | type, bedrooms | monthly | copy + history | Creative Commons Attribution 4.0 International | 200/ok/0.2s/173 |
| au-nsw-rents | AU | NSW Fair Trading | real sale/letting records | postcode (NSW only) | type, bedrooms | monthly | copy + history | Creative Commons Attribution | 200/ok/0.2s/1220 |
| au-qld-rents | AU | Residential Tenancies Authority | official average/statistic | postcode (Queensland only) | type, bedrooms | quarterly | copy + history | Creative Commons Attribution 4.0 | 200/ok/0.3s/313 |
| ca-cmhc-rents | CA | Canada Mortgage and Housing Corporation | official average/statistic | city of 10,000+ | bedrooms; apartment/row | yearly | copy + history | CMHC licence agreement for the use of data. \"CM | 200/ok/0.8s/- |
| ch-bfs-rents | CH | Federal Statistical Office | official average/statistic | canton | none | yearly | copy only (no history) | opendata.swiss terms 'open use | 200/ok/0.7s/- |
| de-zensus-rents | DE | Statistisches Bundesamt | official average/statistic | city (about 90) | none | static (one date) | copy only (no history) | Destatis copyright terms for its website content | 200/ok/0.3s/- |
| es-cat-rents | ES | Institut Català del Sòl | official average/statistic | municipality (Catalonia only) | none | daily | copy + history | Generalitat de Catalunya open data | 200/ok/0.9s/7845 |
| fi-stat-rents | FI | Statistics Finland | official average/statistic | city / district | rooms | quarterly | copy only (no history) | Statistics Finland | 200/ok/0.6s/43365 |
| fr-anil-rents | FR | Observatoires Locaux des Loyers | official average/statistic | agglomeration (about 50 areas) | type, rooms | yearly | copy + history | Licence Ouverte 2.0 | 200/ok/1.2s/16004 |
| gb-ons-rents | GB | Office for National Statistics | official average/statistic | local authority | type, bedrooms | monthly | copy + history |  | 200/ok/0.3s/- |
| hk-rvd-rents | HK | Rating and Valuation Department | official average/statistic | region (HK Island, Kowloon, NT) | flat size class | monthly | copy + history | DATA.GOV.HK Terms and Conditions of Use | 200/ok/0.4s/- |
| ie-rtb-rents | IE | Residential Tenancies Board | official average/statistic | town / Dublin district | type, bedrooms | quarterly | copy + history | Creative Commons Attribution 4.0 | 200/ok/1.2s/- |
| no-ssb-rents | NO | Statistics Norway | official average/statistic | price zone (Oslo, Bergen, etc.) | rooms | yearly | copy + history | Creative Commons Attribution 4.0 | 200/ok/1.4s/- |
| nz-mbie-rents | NZ | Ministry of Business | real sale/letting records | territorial authority | none (type and bedrooms not applied) | monthly | copy + history |  | 200/ok/5.0s/663 |
| pt-ine-rents | PT | Statistics Portugal | official average/statistic | municipality (all 308) | none | quarterly | copy only (no history) | Creative Commons Attribution 4.0 | 200/ok/1.4s/- |
| se-scb-rents | SE | Statistics Sweden | official average/statistic | region group (Greater Stockholm etc.) | rooms (required) | yearly | copy + history | CC0 | 200/ok/3.5s/- |
| se-scb-rents-newbuild | SE | Statistics Sweden | official average/statistic | region group (new-build flats) | rooms | yearly | copy + history | CC0 | 200/ok/1.6s/1783 |
| sg-hdb-rents | SG | Housing & Development Board | real sale/letting records | HDB town | flat type | monthly | copy + history | Singapore Open Data Licence v1.0 | 200/ok/2.7s/922 |
| tw-rents | TW | Ministry of the Interior | real sale/letting records | district | type, bedrooms, room-only | every 10 days | copy + history |  | 200/ok/0.2s/3332 |
| us-census-acs-rent | US | US Census Bureau | official average/statistic | city 50,000+ / county / metro | none | yearly | copy only (no history) | US Census Bureau statistics. The licence wording | 200/ok/0.2s/- |

Notes on the table:
- "Copy" = the source has `harvest` + `historyKey`, so the daily collector keeps a copy that stands in when the live source is down. "copy only (no history)" means the manifest sets `noHistory` (one figure per place and year, nothing to track). Only ch-zh-canton-home-sales has no harvest or historyKey, so it has no stale copy.
- Live column: HTTP status / answer `status` / seconds / sample size (`-` = none published). Times are one call each, from this shell, and may include a cached answer; cold versus warm cannot be told apart.
- The first example of eu-home-price-index (country ES) was answered by eu-home-price-index itself, as designed (no town given).
- Filters are what the manifest's `paramNotes` say the source accepts.

## 10 slowest answers

1. us-detroit-home-sales: 25.80 s (ok, stale copy; /api/v1/home-sales?country=US&town=Detroit%2C+MI&ppcheck=1)
2. dk-home-prices: 7.47 s (ok; /api/v1/home-sales?country=DK&town=K%C3%B8benhavn&ppcheck=1)
3. nz-mbie-rents: 4.99 s (ok; /api/v1/rent?country=NZ&town=Wellington&ppcheck=1)
4. gb-hmlr-ppd: 4.87 s (ok; /api/v1/home-sales?country=GB&town=Bristol&property_type=terraced&ppcheck=1)
5. pt-home-prices: 3.91 s (ok; /api/v1/home-sales?country=PT&town=Lisboa&ppcheck=1)
6. se-scb-rents: 3.53 s (ok; /api/v1/rent?country=SE&town=Greater+Stockholm&bedrooms=2&ppcheck=1)
7. pl-rcn-home-sales: 3.07 s (ok; /api/v1/home-sales?country=PL&town=Warszawa&ppcheck=1)
8. hk-landreg-sales: 3.00 s (ok; /api/v1/home-sales?country=HK&ppcheck=1)
9. sg-hdb-rents: 2.69 s (ok; /api/v1/rent?country=SG&town=Tampines&flat_type=4+ROOM&ppcheck=1)
10. se-home-prices: 2.28 s (ok; /api/v1/home-sales?country=SE&town=Stockholm&ppcheck=1)

## Failures, insufficient_data and no_matches

- Failed (non-200 or non-ok): none.
- insufficient_data: none. no_matches: none.
- Stale copy served: us-detroit-home-sales (25.80 s, answered from the library copy; the live source was slow or down).
- Odd but not failed: au-sa-metro-home-sales returned sample size 13 (Norwood); lv-vzd-detached-houses returned 49. Both are thin.

## Biggest gaps in the most-asked countries

- **IT:** home sales index only (Eurostat, national, no price in money). No rent source. No commercial source.
- **FR:** sales from real records by postcode (fr-dvf), but published twice a year with a months-long delay and without Alsace-Moselle and Mayotte. Rents by about 50 agglomerations only (ANIL, annual; Lyon and Lille not observed), no postcode.
- **ES:** no real sale records; home sales are appraised values per m2 (es-appraised-homes, municipalities over 25,000) plus the index. Rent only for Catalonia (es-cat-rents); nothing for the rest of Spain.
- **IE:** strongest sale source (ie-ppr, real records, county or Dublin district; no Eircode or town level). Rents are a quarterly average (about five months behind) with no sample size and no range.
- **US:** home sales for seven local areas only (Connecticut, NYC, Chicago and Cook County, Allegheny PA, Maricopa AZ, Washington DC, Detroit) plus one national new-house median. Rent only from the Census ACS (five-year survey, yearly, cities of 50,000+, no sample size).
- **GB:** England and Wales sales by postal town (no postcode), Scotland and Northern Ireland only as average prices (UKHPI, no records). Rents by local authority only, official statistic, no postcode.
- **CA:** sales for British Columbia only, as an average declared value (not a median). Rent from CMHC yearly averages for cities of 10,000+; no postcode; no sale source for the other provinces.
- **SG:** both sale and rent are public housing (HDB) only. No private home sales or rents (sg-sla-rents is state property, not homes).
- **TW:** real sale and letting records to district level, every 10 days. No gap found in the manifests (presales are left out by design).
- **DE:** no real sale records. Sales are NRW guideline values (not paid prices) plus the national index. Rents are the Zensus 2022 census (one fixed date, 15 May 2022, never updated).
- **AU:** sales are ABS state-level figures plus Adelaide metro suburbs (houses only). Rents from bond data cover NSW, QLD, SA and TAS only; no Victoria, WA, ACT or NT rent source.

## Fixes that would help most (ordered)

1. IT: add a home-sales source with prices in money (today index only) and a rent source (none).
2. ES: add real sale records or notarial/registry prices (today appraised values) and rent outside Catalonia (none).
3. DE: add real sale records (today NRW guideline values only) and a rent source newer than the 2022 census.
4. US: widen sales beyond seven local areas and add rent beyond the ACS survey (no sample size, cities of 50,000+).
5. AU: add rent for Victoria, WA, ACT and NT, and suburb-level sale records outside Adelaide.
6. CA: add sale sources outside British Columbia and a median instead of an average declared value.
7. GB: add a postcode level for sales and rents; add Scottish and Northern Irish sale records (today averages only).
8. FR: add rents beyond the ~50 agglomerations and postcode level; note the DVF delay and missing Alsace-Moselle and Mayotte.
9. SG: add private homes (sales and rents); today HDB only.
10. Speed and resilience: us-detroit-home-sales answered from a stale copy in 25.8 s; dk-home-prices took 7.5 s, nz-mbie-rents 5.0 s, gb-hmlr-ppd 4.9 s.
11. Sample size: 22 of 64 first-example answers carry no sample size (official statistics); agents cannot judge them by count.

## Other categories (name and country only)

Commercial property (9): dk-dst-commercial-property (DK); fr-dvf-commercial (FR); hk-rvd-commercial (HK); jp-land-prices (JP); pl-rcn-commercial (PL); se-scb-commercial-property (SE); sg-ura-land-tenders (SG); tw-moi-commercial (TW); us-nyc-commercial (US).

Land prices (1): eu-land-prices (EU member states, most; Norway rent only).

State property rents (1): sg-sla-rents (SG).

## What could not be checked

- Cold-versus-cached timing: each call was made once, so a cached answer may look faster than a cold one.
- Examples beyond the first per source (smoke:false ones) were not called.
- Only the first example was called, so postcode, bedroom and other paths of each source were not exercised.
- Sample size "-" was taken from the answer's `sample_size` field; the figure inside each answer (price values, periods, confidence) was not reviewed.
- Licence column is shortened to the licence name; full text sits in each source's INFO.
