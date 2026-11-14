// Licence guard for paid calls. A premium call (price check, history) may be CHARGED only when every source behind the
// answer is on this list. Any other source (or one we cannot work out) is served free with a short note: never a 402, never charged.
//
// The list is taken from the Notion Source Pipeline: a source goes in ONLY when its row has a line starting "Licence checked:"
// that says "commercial: yes". "unclear", "no" and "no line at all" all mean NOT cleared. A new source is not cleared by default:
// add its id here once its row says "commercial: yes".
//
// Last synced with the Source Pipeline: 2026-10-20. The batch marked 2026-11-14 below was checked against the licence pages themselves on 14 Nov 2026
// (see docs/licence-clearance-2026-11.md); the Notion Source Pipeline rows for it are being updated by the lead.
export const CLEARED_FOR_PAID: ReadonlySet<string> = new Set([
  "eu-energy", // Eurostat reuse policy / CC BY 4.0, "commercial: yes" (checked 2026-10-18)
  "no-childcare-fees", // Statistics Norway, CC BY 4.0, "commercial: yes" (checked 2026-10-18)
  "ca-cmhc-rents", // CMHC licence agreement, "commercial: yes" (checked 2026-10-17)
  "ca-farm-prices", // Statistics Canada Open Licence, "commercial: yes" (checked 2026-10-18)
  "wb-fpn-diet-costs", // World Bank CC BY 4.0, "commercial: yes" (checked 2026-10-18)
  "it-fuel", // MIMIT, IODL 2.0, commercial use stated in s.3 (checked 2026-11-14)
  "fr-fuel", // Etalab Licence Ouverte 2.0, "à des fins commerciales ou non" (checked 2026-11-14)
  "fr-dvf", // Licence Ouverte 2.0; no re-identification, no search indexing (we serve aggregates) (checked 2026-11-14)
  "fr-anil-rents", // Licence Ouverte 2.0 (checked 2026-11-14)
  "eu-oil-bulletin", // European Commission, CC BY 4.0 (answers IE and DE fuel) (checked 2026-11-14)
  "us-eia-fuel", // US EIA, public domain (checked 2026-11-14)
  "gb-desnz-fuel", // Open Government Licence v3.0 (checked 2026-11-14)
  "gb-hmlr-ppd", // Open Government Licence v3.0; aggregates only (checked 2026-11-14)
  "gb-ukhpi", // Open Government Licence v3.0 (checked 2026-11-14)
  "gb-ons-rents", // Open Government Licence v3.0 (checked 2026-11-14)
  "ie-ppr", // PSRA, CC BY 4.0 on data.gov.ie; site terms forbid use to advertise or promote a product (checked 2026-11-14)
  "sg-hdb-resale", // Singapore Open Data Licence v1.0, commercial use allowed (checked 2026-11-14)
  "sg-hdb-rents", // Singapore Open Data Licence v1.0, commercial use allowed (checked 2026-11-14)
  "tw-home-sales", // Taiwan Open Government Data License v1.0, "for any purpose" (checked 2026-11-14)
  "us-allegheny-home-sales", // CC0 1.0 (checked 2026-11-14)
  "us-dc-home-sales", // CC BY 4.0 (checked 2026-11-14)
  "au-sa-metro-home-sales", // CC BY 4.0 (checked 2026-11-14)
  "au-adelaide-sa-rents", // CC BY 4.0 (checked 2026-11-14)
  "au-justice-tas-rents", // CC BY 4.0 (checked 2026-11-14)
  "au-qld-rents", // CC BY 4.0 (checked 2026-11-14)
]);

export const UNCLEARED_NOTE =
  "Served free: this answer uses a source not yet cleared for paid use, so it is never charged. Payment (if sent) was ignored.";

/** True only when there is at least one source id and every one is cleared. Anything else (empty, unknown) is NOT cleared. */
export function allCleared(ids: readonly string[] | null | undefined): boolean {
  return !!ids && ids.length > 0 && ids.every((id) => typeof id === "string" && CLEARED_FOR_PAID.has(id));
}
