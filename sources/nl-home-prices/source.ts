// Netherlands home prices from Statistics Netherlands (CBS) table 83625NED "Bestaande koopwoningen; gemiddelde verkoopprijzen, regio".
// One OData v3 request for the region (name -> CBS key) and one for the figures: no bulk download.
// Formats below were checked live on 2026-10-14 through the GitHub probe (see the fixtures in source.test.ts).
//
// What CBS publishes: for the country, 4 landsdelen, 12 provinces and every municipality, ONE average sale price per year of
// existing owner-occupied homes bought by private individuals (Kadaster notarial transactions). No distribution, no record count,
// no split by home type. So the answer is an official statistic: value + measure "average", range fields null, sample_size null.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "nl-home-prices",
  country: "NL (Netherlands)",
  category: "home sales (official average sale price)",
  name: "Existing owner-occupied homes; average sale prices, by region (CBS table 83625NED)",
  publisher: "Statistics Netherlands (CBS), based on Kadaster notarial transactions",
  what_is_recorded:
    "For the Netherlands, its landsdelen, provinces and municipalities, and each year: the average price paid for existing owner-occupied homes bought by private individuals, " +
    "calculated by CBS from the notarial transactions the Kadaster registers each month. One published figure per region and year; never individual sales or addresses.",
  price_type: "official_statistic",
  freshness: "Annual: the previous year's figures are published in February (the 2025 figures appeared on 17 February 2026); each answer states its year",
  licence:
    "Creative Commons Attribution 4.0 International (CC BY 4.0). CBS copyright page: \"Unless otherwise stated, the content of this website is subject to Creative Commons Attribution (CC BY 4.0). " +
    "This means that the re-use of the content of this site is permitted, provided Statistics Netherlands is cited as the source.\" The table's own metadata (License field) names https://creativecommons.org/licenses/by/4.0/",
  licence_url: "https://www.cbs.nl/en-gb/about-us/website/copyright",
  attribution:
    "Source: Statistics Netherlands (CBS), table 83625NED, Bestaande koopwoningen; gemiddelde verkoopprijzen, regio (data: CBS, Kadaster), reused under CC BY 4.0. " +
    "Figures are passed on as published; the percentage changes and the comparison with the national average are calculated by ProofPrice. This is not an endorsement by CBS.",
  homepage: "https://opendata.cbs.nl/#/CBS/nl/dataset/83625NED/table",
  limits:
    "An average sale price per year, not a price index and not a valuation: it mixes whatever homes happened to sell that year, so a rise or fall can reflect which homes were sold as much as price changes (CBS says so itself). " +
    "Existing homes bought by private individuals only (new builds, rentals and purchases by companies are not included). Not split by home type, so property_type only supports 'any'. " +
    "CBS does not say how many sales stand behind each figure. Annual, so the newest figure can be up to 14 months old.",
};

export const TABLE = "83625NED";
export const ODATA_BASE = `https://opendata.cbs.nl/ODataApi/odata/${TABLE}`;
export const TABLE_URL = `https://opendata.cbs.nl/#/CBS/nl/dataset/${TABLE}/table`;
export const NATIONAL_KEY = "NL01  "; // CBS pads region keys to six characters
/** Years of history requested, counting back from the current year. */
export const YEARS_BACK = 6;

export type Fetcher = (url: string) => Promise<unknown>;
export interface FetchOptions {
  fetcher?: Fetcher;
  /** The clock (tests). */
  now?: Date;
}
const defaultFetcher: Fetcher = (url) => fetchJson(url, {}, 20000);

// ---------- place names (pure) ----------

/** Lower case, accents removed, curly quotes straightened, spaces collapsed. */
export function foldName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Words that mean "the whole country". */
const NATIONAL_WORDS = new Set(["nederland", "netherlands", "the netherlands", "holland", "nl", "pays-bas", "niederlande", "paises bajos", "paesi bassi", "nederlanden"]);

/** Other spellings -> a fragment of the CBS region title to search for. */
const ALIASES: Record<string, string> = {
  "den haag": "gravenhage", "the hague": "gravenhage", "s-gravenhage": "gravenhage", "'s-gravenhage": "gravenhage", "la haye": "gravenhage",
  "den-haag": "gravenhage", "denhaag": "gravenhage", "haag": "gravenhage", "gravenhage": "gravenhage", "den haag (gemeente)": "gravenhage",
  "den bosch": "hertogenbosch", "s-hertogenbosch": "hertogenbosch", "'s-hertogenbosch": "hertogenbosch", "bois-le-duc": "hertogenbosch",
  "north holland": "noord-holland", "south holland": "zuid-holland", "north brabant": "noord-brabant", "friesland": "frysl", "frisia": "frysl", "fryslan": "frysl",
  "hague": "gravenhage",
};

/** A place as asked, folded, without a trailing ", Netherlands", "(gemeente)" or a leading "gemeente". */
export function cleanPlace(place: string): string {
  return foldName(place.split(",")[0]).replace(/\s*\((gemeente|pv|ld)\)\s*$/, "").replace(/^gemeente /, "");
}

/** The fragment of a region title to search for, or "national". Throws InputError on characters that are not part of any place name. */
export function searchToken(place: string): string {
  const folded = cleanPlace(place);
  if (NATIONAL_WORDS.has(folded)) return "national";
  const alias = ALIASES[folded];
  if (alias) return alias;
  const token = folded.replace(/^'?s[- ](?=[a-z]{4})/, "");
  if (!/^[a-z0-9 .'\-]{2,60}$/.test(token)) throw new InputError(`'${place}' is not a place name CBS can look up. Use a municipality such as 'Amsterdam' or 'Den Haag', or a province such as 'Noord-Holland'.`);
  return token;
}

export interface Region {
  key: string; // CBS key, e.g. "GM0363" or "PV27  "
  title: string; // e.g. "Amsterdam", "Utrecht (gemeente)", "Noord-Holland (PV)"
  kind: "GM" | "PV" | "LD" | "NL";
  dissolved: boolean;
}

const KIND_NAME: Record<Region["kind"], string> = { GM: "municipality", PV: "province", LD: "landsdeel (region)", NL: "country" };
const KIND_RANK: Record<Region["kind"], number> = { GM: 0, PV: 1, LD: 2, NL: 3 };

/** Plain name of a CBS region title: no "(gemeente)", "(PV)" or "(LD)" suffix. */
export function plainTitle(title: string): string {
  return title.replace(/\s*\((gemeente|PV|LD)\)\s*$/, "").trim();
}

export function regionLookupUrl(token: string): string {
  const safe = token.replace(/'/g, "''");
  return `${ODATA_BASE}/RegioS?$filter=${encodeURIComponent(`substringof('${safe}',tolower(Title))`)}&$select=Key,Title,Description`;
}

export function parseRegions(json: unknown): Region[] {
  const value = (json as any)?.value;
  if (!Array.isArray(value)) throw new SourceError("Unexpected response from CBS (no region list)");
  const out: Region[] = [];
  for (const r of value) {
    const key = typeof r?.Key === "string" ? r.Key : "";
    const title = typeof r?.Title === "string" ? r.Title : "";
    const kind = key.slice(0, 2) as Region["kind"];
    if (!title || !(kind in KIND_NAME)) continue;
    out.push({ key, title, kind, dissolved: /opgeheven/i.test(String(r?.Description ?? "")) });
  }
  return out;
}

/**
 * Choose the region the caller meant from the CBS title matches. Dissolved municipalities are ignored.
 * An exact name wins (a municipality before a province before a landsdeel); otherwise a single match is used;
 * several partial matches are an InputError listing them.
 */
export function pickRegion(matches: Region[], place: string): Region {
  const wanted = cleanPlace(place);
  const live = matches.filter((m) => !m.dissolved);
  if (matches.some((m) => m.dissolved && foldName(plainTitle(m.title)) === wanted) && !live.some((m) => foldName(plainTitle(m.title)) === wanted)) {
    throw new InputError(`'${place}' no longer exists as a Dutch municipality (it was merged into another one). Use the name of the municipality it is part of today.`);
  }
  if (!live.length) {
    throw new InputError(`No current Dutch municipality, province or region called '${place}'. Try the Dutch spelling (Den Haag, Groningen, Utrecht) or omit the town for the national average.`);
  }
  const aliasToken = ALIASES[wanted];
  const exact = live
    .filter((m) => {
      const plain = foldName(plainTitle(m.title));
      return plain === wanted || (aliasToken !== undefined && plain.includes(aliasToken)) || plain.replace(/^'s-/, "") === wanted.replace(/^'?s-/, "");
    })
    .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
  if (exact.length) return exact[0];
  const munis = live.filter((m) => m.kind === "GM");
  const pool = munis.length ? munis : live;
  if (pool.length === 1) return pool[0];
  const names = pool.slice(0, 8).map((m) => plainTitle(m.title) + (m.title.includes("(") ? ` [${m.title}]` : ""));
  throw new InputError(`'${place}' matches several Dutch places: ${names.join(", ")}. Use the exact name.`);
}

// ---------- the figures (pure) ----------

export interface NlValue {
  key: string;
  year: number;
  value: number;
}

export function dataUrl(keys: string[], sinceYear: number): string {
  const regions = keys.map((k) => `RegioS eq '${k}'`).join(" or ");
  return `${ODATA_BASE}/TypedDataSet?$filter=${encodeURIComponent(`(${regions}) and Perioden ge '${sinceYear}JJ00'`)}`;
}

/** Annual rows ("2025JJ00") with a figure. CBS answers "." / null for a municipality without a published figure. */
export function parseValues(json: unknown): NlValue[] {
  const value = (json as any)?.value;
  if (!Array.isArray(value)) throw new SourceError("Unexpected response from CBS (no data rows)");
  const out: NlValue[] = [];
  for (const r of value) {
    const m = /^(\d{4})JJ00$/.exec(String(r?.Perioden ?? ""));
    const v = r?.GemiddeldeVerkoopprijs_1;
    if (!m || typeof r?.RegioS !== "string" || typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
    out.push({ key: r.RegioS, year: Number(m[1]), value: v });
  }
  return out;
}

export interface NlReading {
  region: Region;
  year: number;
  value: number;
  previous: { year: number; value: number; change_percent: number } | null;
  national: { year: number; value: number; difference_percent: number } | null;
  nationalLatestYear: number | null;
  series: { year: number; value: number }[];
}

const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/** Latest annual figure for the region, the year before it, the national figure for the same year and the short series. Null if CBS has no figure. */
export function readNl(values: NlValue[], region: Region): NlReading | null {
  const mine = values.filter((v) => v.key.trim() === region.key.trim()).sort((a, b) => a.year - b.year);
  if (!mine.length) return null;
  const latest = mine[mine.length - 1];
  const prev = mine.find((v) => v.year === latest.year - 1);
  const nat = values.filter((v) => v.key.trim() === NATIONAL_KEY.trim()).sort((a, b) => a.year - b.year);
  const natSame = nat.find((v) => v.year === latest.year);
  const isNational = region.key.trim() === NATIONAL_KEY.trim();
  return {
    region,
    year: latest.year,
    value: latest.value,
    previous: prev ? { year: prev.year, value: prev.value, change_percent: roundTo(((latest.value - prev.value) / prev.value) * 100, 1) } : null,
    national: natSame && !isNational ? { year: natSame.year, value: natSame.value, difference_percent: roundTo(((latest.value - natSame.value) / natSame.value) * 100, 1) } : null,
    nationalLatestYear: nat.length ? nat[nat.length - 1].year : null,
    series: mine.map((v) => ({ year: v.year, value: v.value })),
  };
}

function plainChange(pct: number, prevLabel: string, prevValue: number): string {
  if (pct === 0) return ` That is unchanged from ${prevLabel} (${fmtMoney(prevValue, "EUR")}).`;
  return ` That is ${Math.abs(pct)}% ${pct > 0 ? "higher" : "lower"} than in ${prevLabel} (${fmtMoney(prevValue, "EUR")}).`;
}

export interface NlQuery {
  place: string | null; // as asked; null = national
  property_type: string;
  baseUrl?: string;
  apiUrl?: string;
  now?: Date;
}

const METHOD =
  "CBS publishes, once a year, the average price paid for existing owner-occupied homes bought by private individuals, per region (table 83625NED), calculated from the notarial transactions the Kadaster registers. " +
  "ProofPrice passes on the published annual figure for the latest year CBS holds, unchanged, with the year before it, the national average and a short history. " +
  "No range is calculated: CBS gives one average and does not say how many sales are behind it. An average sale price is not a price index.";

/** The finished answer for a reading (or for no reading). Pure. */
export function nlAnswer(reading: NlReading | null, q: NlQuery): PriceAnswer {
  const query = { country: "NL", town: reading?.region ? plainTitle(reading.region.title) : q.place ?? "Netherlands", property_type: q.property_type };
  const base = { source: INFO, query, measure: "average" as const, currency: "EUR", unit: "per home", method: METHOD, baseUrl: q.baseUrl };
  if (!reading) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `CBS publishes no average sale price for ${q.place ?? "the Netherlands"} in table ${TABLE} for the last ${YEARS_BACK} years.` };
  }
  const r = reading;
  const name = plainTitle(r.region.title);
  const where = r.region.kind === "NL" ? "the Netherlands" : r.region.kind === "GM" ? name : `${name} (${KIND_NAME[r.region.kind]})`;
  const now = q.now ?? new Date();
  const notes: string[] = [];
  if (r.nationalLatestYear !== null && r.year < r.nationalLatestYear) {
    notes.push(`The latest figure CBS holds for ${name} is for ${r.year}; national figures run to ${r.nationalLatestYear}.`);
  }
  if (r.year <= now.getUTCFullYear() - 2) {
    notes.push(`This figure is for ${r.year}, more than a year old: CBS has not published a newer annual figure for this area.`);
  }
  const extra: Record<string, unknown> = {
    region: { code: r.region.key.trim(), name, level: KIND_NAME[r.region.kind], cbs_title: r.region.title },
    reference_period_label: String(r.year),
    previous_period: r.previous ? { reference_period: String(r.previous.year), value: r.previous.value, change_percent: r.previous.change_percent } : null,
    national_average: r.national ? { reference_period: String(r.national.year), value: r.national.value, region_vs_national_percent: r.national.difference_percent } : null,
    series: r.series.map((s) => ({ reference_period: String(s.year), value: s.value })),
    definition: "Average price paid for existing owner-occupied homes bought by private individuals (not new builds), from Kadaster notarial transactions.",
    table: { id: TABLE, url: TABLE_URL },
    ...(q.apiUrl ? { cbs_api_url: q.apiUrl } : {}),
  };
  return buildStatisticAnswer({
    ...base,
    value: r.value,
    period: { from: `${r.year}-01-01`, to: `${r.year}-12-31` },
    reference_period: String(r.year),
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In ${where} the average sale price of existing owner-occupied homes was ${fmtMoney(v, "EUR")} in ${r.year}.` +
      (r.previous ? plainChange(r.previous.change_percent, String(r.previous.year), r.previous.value) : "") +
      (r.national
        ? ` The national average for ${r.national.year} was ${fmtMoney(r.national.value, "EUR")} (${Math.abs(r.national.difference_percent)}% ${r.national.difference_percent >= 0 ? "above" : "below"}).`
        : ""),
    extra,
  });
}

// ---------- the request ----------

export async function nlHomePrices(
  input: { town?: string; postcode?: string; property_type?: string; baseUrl?: string },
  o: FetchOptions = {},
): Promise<PriceAnswer> {
  const fetcher = o.fetcher ?? defaultFetcher;
  const now = o.now ?? new Date();
  const type = (input.property_type ?? "any").trim().toLowerCase() || "any";
  if (input.postcode && !input.town) {
    throw new InputError("CBS publishes Dutch home prices by municipality, province and country, not by postcode. Give the municipality as town, or omit it for the national average.");
  }

  let region: Region;
  const token = input.town ? searchToken(input.town) : "national";
  if (token === "national") {
    region = { key: NATIONAL_KEY, title: "Nederland", kind: "NL", dissolved: false };
  } else {
    region = pickRegion(parseRegions(await fetcher(regionLookupUrl(token))), input.town!);
  }

  if (type !== "any") {
    // CBS does not split this table by home type. Say so rather than hand back an all-homes figure as if it were one type's.
    const none = buildStatisticAnswer({
      source: INFO,
      query: { country: "NL", town: plainTitle(region.title), property_type: type },
      value: null,
      measure: "average",
      currency: "EUR",
      unit: "per home",
      period: { from: null, to: null },
      reference_period: "",
      method: METHOD,
      describe: () => "",
      baseUrl: input.baseUrl,
    });
    return {
      ...none,
      summary: `CBS publishes the Dutch average sale price for all existing owner-occupied homes together, not by home type, so there is no official figure for property_type '${type}'. Ask without property_type for the all-homes average.`,
    };
  }

  const since = now.getUTCFullYear() - YEARS_BACK;
  const keys = region.key.trim() === NATIONAL_KEY.trim() ? [NATIONAL_KEY] : [region.key, NATIONAL_KEY];
  const url = dataUrl(keys, since);
  const reading = readNl(parseValues(await fetcher(url)), region);
  return nlAnswer(reading, { place: input.town ?? null, property_type: type, baseUrl: input.baseUrl, apiUrl: url, now });
}
