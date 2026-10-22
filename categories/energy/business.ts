// Business (non-household) electricity and gas prices inside the existing energy tool: shared words and country lists.
// The tool is still pricepaid_energy_prices; `sector` picks the household figure (default, unchanged) or the business one.
// Sources: eu-energy-business (Eurostat), gb-desnz-energy-business (DESNZ), us-eia-energy-business (EIA). They import their
// country lists from here, and categories/energy/index.ts uses the same lists to refuse business requests for other countries.
import { InputError } from "../../lib/http";

export type Sector = "household" | "business";

const SECTOR_ALIASES: Record<string, Sector> = {
  household: "household", households: "household", home: "household", homes: "household", residential: "household",
  domestic: "household", consumer: "household", consumers: "household", retail: "household",
  business: "business", businesses: "business", "non household": "business", nonhousehold: "business",
  "non domestic": "business", nondomestic: "business", commercial: "business", industrial: "business", industry: "business",
  company: "business", companies: "business", sme: "business", smes: "business", corporate: "business",
};

/** "business", "non-household", "Commercial" -> "business"; "household", "home" -> "household"; empty -> "household". */
export function normaliseSector(raw: unknown): Sector {
  const s = String(raw ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (!s) return "household";
  const hit = SECTOR_ALIASES[s];
  if (!hit) throw new InputError('sector must be "household" (default) or "business" (non-household consumers: shops, offices, factories).');
  return hit;
}

/** Eurostat allows commercial reuse of its data for the EU, EFTA and (official) candidate countries only
 *  (https://ec.europa.eu/eurostat/help/copyright-notice), so these are the countries sources/eu-energy-business answers for.
 *  EU27 + Norway and Iceland (EFTA members with data) + the official candidate countries with data in nrg_pc_205 / nrg_pc_203. */
export const EU_BUSINESS_COUNTRIES: Record<string, string> = {
  AT: "Austria", BE: "Belgium", BG: "Bulgaria", HR: "Croatia", CY: "Cyprus", CZ: "Czechia", DK: "Denmark", EE: "Estonia",
  FI: "Finland", FR: "France", DE: "Germany", GR: "Greece", HU: "Hungary", IE: "Ireland", IT: "Italy", LV: "Latvia",
  LT: "Lithuania", LU: "Luxembourg", MT: "Malta", NL: "Netherlands", PL: "Poland", PT: "Portugal", RO: "Romania",
  SK: "Slovakia", SI: "Slovenia", ES: "Spain", SE: "Sweden",
  NO: "Norway", IS: "Iceland",
  AL: "Albania", BA: "Bosnia and Herzegovina", GE: "Georgia", MD: "Moldova", ME: "Montenegro", MK: "North Macedonia",
  RS: "Serbia", TR: "Türkiye", UA: "Ukraine",
};

export const GB_BUSINESS_COUNTRY = "GB";
export const US_BUSINESS_COUNTRY = "US";

/** Every country that has a business figure. A business request for any other country is refused with a plain message. */
export const BUSINESS_COUNTRIES: string[] = [...Object.keys(EU_BUSINESS_COUNTRIES), GB_BUSINESS_COUNTRY, US_BUSINESS_COUNTRY];
