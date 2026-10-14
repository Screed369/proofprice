// Shared plumbing for the two data.cms.gov sources (Medicare physician payments and Medicare inpatient payments).
// The Data.CMS.gov data API is key-free: GET https://data.cms.gov/data-api/v1/dataset/<uuid>/data?filter[Field]=value&size=N returns a JSON
// array of row objects, every value a string. IN filters use filter[x][condition][path|operator|value][]. The dataset uuids below are the
// "latest" pointers (they now return the 2024 data year; CMS moves them when a new year is released), and
// /data-api/v1/dataset-resources/<uuid> names the data year ("... - by Geography and Service 2024").
// Formats checked live on 2026-10-14 through the GitHub Probe workflow.

import { Fetcher, resolveFetcher } from "../../lib/adapters";
import { SourceError } from "../../lib/http";

export const CMS_API = "https://data.cms.gov/data-api/v1";
export const PHYSICIAN_DATASET = "6fea9d79-0129-4e4c-b1b8-23cd86a4f435"; // Medicare Physician & Other Practitioners - by Geography and Service
export const INPATIENT_DATASET = "2941ab09-8cee-49d8-9703-f3c5b854e388"; // Medicare Inpatient Hospitals - by Geography and Service

export interface CmsFilter {
  field: string;
  /** One value = equality; several = IN. With op "CONTAINS" the (single) value is searched for inside the field, ignoring case. */
  values: string[];
  op?: "CONTAINS";
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

/** https://data.cms.gov/data-api/v1/dataset/<id>/data?filter... Every value is percent-encoded. */
export function cmsDataUrl(dataset: string, filters: CmsFilter[], size: number): string {
  const parts: string[] = [];
  filters.forEach((f, i) => {
    if (f.op === "CONTAINS") {
      const k = `filter[g${i}][condition]`;
      parts.push(`${enc(`${k}[path]`)}=${enc(f.field)}`, `${enc(`${k}[operator]`)}=CONTAINS`, `${enc(`${k}[value]`)}=${enc(f.values[0])}`);
    } else if (f.values.length === 1) {
      parts.push(`${enc(`filter[${f.field}]`)}=${enc(f.values[0])}`);
    } else {
      const k = `filter[g${i}][condition]`;
      parts.push(`${enc(`${k}[path]`)}=${enc(f.field)}`, `${enc(`${k}[operator]`)}=IN`, ...f.values.map((v) => `${enc(`${k}[value][]`)}=${enc(v)}`));
    }
  });
  parts.push(`size=${Math.max(1, Math.min(5000, Math.floor(size)))}`);
  return `${CMS_API}/dataset/${dataset}/data?${parts.join("&")}`;
}

export function cmsResourcesUrl(dataset: string): string {
  return `${CMS_API}/dataset-resources/${dataset}`;
}

/** A CMS data answer is a JSON array of row objects; anything else is an error from the portal. */
export function parseCmsRows(json: unknown): Record<string, any>[] {
  if (Array.isArray(json)) return json.filter((r) => typeof r === "object" && r !== null && !Array.isArray(r));
  const msg = json && typeof json === "object" && typeof (json as any).message === "string" ? (json as any).message : "not a list of rows";
  throw new SourceError(`Unexpected response from the CMS data API (${msg})`.slice(0, 300));
}

export interface CmsOptions {
  fetcher?: Fetcher;
  timeoutMs?: number;
}

export async function cmsQuery(dataset: string, filters: CmsFilter[], size: number, o: CmsOptions = {}): Promise<Record<string, any>[]> {
  return parseCmsRows(await resolveFetcher({ fetcher: o.fetcher, timeoutMs: o.timeoutMs ?? 25000 })(cmsDataUrl(dataset, filters, size)));
}

/** "Medicare Physician & Other Practitioners - by Geography and Service 2024" -> 2024. The first resource that ends in a year. */
export function parseDataYear(json: unknown): number | null {
  const data = json && typeof json === "object" ? (json as any).data : null;
  if (!Array.isArray(data)) return null;
  for (const r of data) {
    const m = typeof r?.name === "string" ? /\b((?:19|20)\d{2})\s*$/.exec(r.name.trim()) : null;
    if (m) return Number(m[1]);
  }
  return null;
}

const YEAR_TTL_MS = 6 * 3600 * 1000;
const yearCache = new Map<string, { year: number | null; at: number }>();
export function clearYearCache(): void {
  yearCache.clear();
}

/** The data year the dataset's "latest" pointer serves now. Null if CMS does not say (the answer then says so). Cached for six hours. */
export async function dataYear(dataset: string, o: CmsOptions = {}): Promise<number | null> {
  const hit = yearCache.get(dataset);
  if (hit && !o.fetcher && Date.now() - hit.at < YEAR_TTL_MS) return hit.year;
  let year: number | null = null;
  try {
    year = parseDataYear(await resolveFetcher({ fetcher: o.fetcher, timeoutMs: 15000 })(cmsResourcesUrl(dataset)));
  } catch {
    year = null; // the rows are still good; only the year label is missing
  }
  if (!o.fetcher && year !== null) yearCache.set(dataset, { year, at: Date.now() });
  return year;
}

// ---------- states ----------

/** CMS Rndrng_Prvdr_Geo_Desc values for the states and territories that have rows (checked 2026-10-14), keyed by postal code. */
export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico", GU: "Guam", VI: "Virgin Islands", MP: "Northern Mariana Islands",
};

const NAME_TO_CODE: Record<string, string> = Object.fromEntries(Object.entries(STATE_NAMES).map(([c, n]) => [n.toLowerCase(), c]));

export interface Geo {
  level: "National" | "State";
  /** The exact Rndrng_Prvdr_Geo_Desc CMS uses: "National" or "Texas". */
  desc: string;
  /** Postal code, or null for national. */
  code: string | null;
  /** "the United States" or "Texas". */
  label: string;
}

export const NATIONAL: Geo = { level: "National", desc: "National", code: null, label: "the United States" };

/** "TX", "tx", "Texas", "new york" -> Geo. Empty -> national. Throws a plain message listing what is accepted. */
export function parseGeo(raw: string | undefined, fail: (message: string) => Error): Geo {
  const s = (raw ?? "").trim().replace(/\./g, "");
  if (!s || /^(us|usa|united states|national|nationwide)$/i.test(s)) return NATIONAL;
  const code = STATE_NAMES[s.toUpperCase()] ? s.toUpperCase() : NAME_TO_CODE[s.toLowerCase().replace(/\s+/g, " ")];
  if (!code) throw fail(`state must be a US state or territory as a two-letter code or name (for example TX or Texas), or left out for the national average. Not recognised: ${raw}.`);
  return { level: "State", desc: STATE_NAMES[code], code, label: STATE_NAMES[code] };
}

// ---------- numbers ----------

export function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const round2 = (v: number) => Math.round(v * 100) / 100;

/** Dollars for a sentence: 83.75 -> "$83.75", 15157.44 -> "$15,157". */
export function usd(v: number): string {
  return v >= 1000 ? `$${Math.round(v).toLocaleString("en-US")}` : `$${v.toFixed(2)}`;
}

/** Thousands separators for a count: 4151 -> "4,151". */
export function count(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
