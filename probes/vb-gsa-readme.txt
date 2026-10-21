URL: https://raw.githubusercontent.com/benswork-space/us-government-surplus-dataset/main/README.md
Fetched: 2026-10-21T11:44:15Z from GitHub Actions
Status, type, bytes: 200 text/plain; charset=utf-8 3585
Errors: 

=== RESPONSE HEADERS
HTTP/2 200 
cache-control: max-age=300
content-security-policy: default-src 'none'; style-src 'unsafe-inline'; sandbox
content-type: text/plain; charset=utf-8
etag: "27970da398993dfae83359f282d727388d0f8a419bd9f64ebad062395214fa9f"
strict-transport-security: max-age=31536000
x-content-type-options: nosniff
x-frame-options: deny
x-xss-protection: 1; mode=block
x-github-request-id: AEE8:24D47F:39D6:18436:6AD8A58E
x-github-edge-region: westus2
accept-ranges: bytes
date: Wed, 21 Oct 2026 11:44:15 GMT
via: 1.1 varnish
x-served-by: cache-bfi-krnt7300042-BFI
x-cache: MISS
x-cache-hits: 0
x-timer: S1792583055.006682,VS0,VE112
vary: Authorization,Accept-Encoding
access-control-allow-origin: *
cross-origin-resource-policy: cross-origin
x-fastly-request-id: 96c4b7147a17ca4ef2a2d9938c000dfa0dbfde66
expires: Wed, 21 Oct 2026 11:49:15 GMT
source-age: 0
content-length: 3585

=== FILE TYPE: Unicode text, UTF-8 text, with very long lines (335)
=== FIRST 30000 BYTES
# U.S. Government (GSA) Surplus Auction Dataset

A free, open dataset of completed **U.S. federal surplus auction lots** sold
through [GSA Auctions](https://gsaauctions.gov), aggregated by
[GovAuctions](https://govauctions.app).

- **Rows:** 13,837 lots
- **Date range (auction end):** 2026-05-06 → 2026-10-08
- **States/territories:** 55
- **Categories:** 18
- **Lots with a recorded bid:** 8,910
- **Generated:** 2026-10-01
- **Schema version:** 1.0
- **License:** [CC-BY-4.0](./LICENSE) — free to use **with attribution to GovAuctions (https://govauctions.app)**

![Dot plot of the median winning bid for each category of U.S. federal surplus lot, on a log scale. Vehicles are highest at roughly $3,200; office furniture is lowest at roughly $25.](./assets/median-bid-by-category.png)

![Horizontal bar chart of the 15 states with the most U.S. federal surplus auction lots, by lot count.](./assets/lots-by-state.png)

## Why this is safe to publish openly

GSA is a U.S. federal agency, so these listings are works of the U.S. government
and are **not subject to copyright** (17 U.S.C. §105). GSA is also a source we
index with explicit sanction. The dataset is **data only — no images** — and
contains no personal information (sellers are federal agencies).

## Files

| File | Description |
|------|-------------|
| `us-gsa-surplus-auctions.csv`  | Lot-level data, CSV (RFC-4180) |
| `us-gsa-surplus-auctions.json` | Lot-level data, JSON array |
| `manifest.json` | Machine-readable metadata (counts, range, schema, license) |

## Data dictionary

| Column | Type | Notes |
|--------|------|-------|
| `id` | string | Stable GovAuctions/GSA lot id |
| `title` | string | Lot title (federal work, public domain) |
| `category` | string | Normalized category (see list below) |
| `condition` | string | Condition as reported by GSA, when present |
| `seller_type` | string | Selling level (e.g. `federal`) |
| `state` | string | Lot location, 2-letter state/territory |
| `city` | string | Lot location city, when present |
| `zip` | string | Lot location ZIP, when present |
| `currency` | string | Always `USD` |
| `starting_bid` | number | Opening/list price. Populated for 521 of 13,837 rows |
| `current_or_final_bid` | number | **Bid level, not a guaranteed sale price** (see below) |
| `bid_count` | number | Number of bids observed (GSA bid counts are reliable) |
| `buyer_premium_pct` | number | Buyer's premium percentage, when applicable |
| `sold` | enum | `true` / `false` / `unknown` — derived; `unknown` when undeterminable |
| `ended_at` | date | Auction end date (`YYYY-MM-DD`, UTC) |
| `source_url` | string | Link to the original GSA listing |

**Categories:** `appliances`, `art-decor`, `building-materials`, `catering-food-service`, `collectibles`, `electronics`, `heavy-equipment`, `janitorial-cleaning`, `jewelry`, `medical-scientific`, `military-surplus`, `miscellaneous`, `office-furniture`, `real-estate`, `seized-property`, `sporting-goods`, `tools-industrial`, `vehicles`

## Important caveat on price

`current_or_final_bid` is the **current or last-observed bid**, not a confirmed
hammer price. Treat it as a *bid level*. Auction prices are heavily
right-skewed, so medians are more meaningful than means. Use the `sold` flag to
filter to lots with a positive sale signal where you need one.

## Cite this dataset

> GovAuctions (https://govauctions.app), "U.S. Government (GSA) Surplus Auction Dataset," 2026-10-01.
> Source: https://govauctions.app/research/state-of-government-surplus

Updated monthly. Issues and pull requests welcome.
