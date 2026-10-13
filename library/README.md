# ProofPrice price library

Daily aggregate snapshots of official price data, written by the collector
(`scripts/harvest.ts`, run every day by `.github/workflows/harvest.yml`).

- `library/<source-id>/daily/<YYYY-MM>.csv` — one row per day, area and item:
  `date,area,item,n,median,low,high,min,max` (low/high = 10th/90th percentile, n = records counted).
  Rows with fewer than 5 records are never stored. `area` "ALL" = the whole country.
- `library/<source-id>/meta.json` — first/last day held, number of days, last run, last error.

Aggregates only: no row ever describes a single person, home or receipt.
Do not edit by hand; the collector rewrites a day idempotently. Read through `lib/library/store.ts` only.
