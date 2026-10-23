// Washington, DC home sales from the District's own assessment records (Office of the Chief Financial Officer, Office of Tax and Revenue).
// Two ArcGIS tables on the DC GIS server, queried live: RESIDENTIAL (CAMA) = MapServer/25 (houses and rowhouses) and CONDOMINIUM (CAMA) = MapServer/24.
// Each row carries SALEDATE, PRICE and QUALIFIED ('Q' = arm's-length sale). We ask for the date and the price only: never the parcel number (SSL),
// an address or an owner. Fields and values checked live on 2026-10-23 through the Probe workflow (see the fixtures in source.test.ts).
// Each table keeps the latest recorded sale of every active property, so a home sold twice inside the window shows only its newest sale.

import { arcgisAll, arcgisQuery, Fetcher } from "../../lib/adapters";
import { InputError, SourceError } from "../../lib/http";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import type { SourceInfo } from "../../lib/plugin";

const BASE = "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land_WebMercator/MapServer";
export const LAYERS = { house: `${BASE}/25`, condo: `${BASE}/24` } as const;

export const INFO: SourceInfo = {
  id: "us-dc-home-sales",
  country: "US (Washington, DC)",
  category: "home sales",
  name: "Tax System Property Sales (CAMA): residential and condominium tables",
  publisher: "District of Columbia, Office of the Chief Financial Officer (Office of Tax and Revenue), published on Open Data DC",
  what_is_recorded: "The latest recorded sale of each active residential and condominium property: sale date, sale price and whether the sale was qualified (arm's length). No addresses or names are read.",
  price_type: "transaction",
  freshness: "Updated daily from the District's Computer-Assisted Mass Appraisal (CAMA) system; the newest sales are a few days old",
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0), as stated on the dataset record in the US federal data catalogue (publisher: Office of the Chief Financial Officer)",
  licence_url: "https://catalog.data.gov/dataset/tax-system-property-sales-cama",
  attribution: "Source: District of Columbia, Office of the Chief Financial Officer, Tax System Property Sales (CAMA), Open Data DC. Licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0). Figures are ProofPrice aggregates of the published sale records.",
  homepage: "https://opendata.dc.gov/",
  limits:
    "Washington, DC as a whole only: no neighbourhood or ZIP code. Houses/rowhouses and condominiums; commercial property and vacant land are not read. Only qualified (arm's-length) sales of $10,000 or more. " +
    "Each table holds the newest sale of every property, so a property sold twice in the window counts once (its newer sale). Aggregates only, never addresses, parcel numbers or names.",
};

export const MIN_SALE = 10_000;
export const MAX_ROWS = 20_000;
export const PAGE_SIZE = 2_000;
export const DC_TYPES = ["any", "house", "condo"] as const;
export type DcType = (typeof DC_TYPES)[number];

// ---------- is this request about Washington, DC? ----------

function normName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

const DC_STATE = new Set(["dc", "district of columbia", "washington dc"]);
const DC_NAMES = new Set(["dc", "district of columbia", "washington dc", "washington district of columbia", "the district", "washington city dc"]);
/** 20001-20599 are Washington, DC ZIP codes (no overlap with New York, Connecticut or Cook County). */
const DC_ZIP = /^20[0-5]\d{2}(?:-\d{4})?$/;

/**
 * True when a US home-sales request is about Washington, DC: state 'DC', or a town written 'Washington, DC' / 'Washington DC' / 'District of Columbia',
 * or a DC ZIP code with no town. A bare 'Washington' stays with Connecticut (the town of Washington, CT), as before.
 * sources/us-home-sales/index.ts carries a copy of this rule for its own serves() (a test keeps the two in step).
 */
export function isDcRequest(p: { town?: unknown; state?: unknown; postcode?: unknown }): boolean {
  const state = p.state === undefined || p.state === null ? "" : normName(String(p.state));
  if (state) return DC_STATE.has(state);
  const town = p.town === undefined || p.town === null ? "" : String(p.town);
  if (town.trim()) {
    const parts = town.split(",");
    const name = normName(parts[0]);
    const qualifier = parts[1] ? normName(parts[1]) : "";
    if (qualifier) return (name === "washington" || DC_NAMES.has(name)) && DC_STATE.has(qualifier);
    return DC_NAMES.has(name);
  }
  const zip = p.postcode === undefined || p.postcode === null ? "" : String(p.postcode).trim();
  return DC_ZIP.test(zip);
}

// ---------- queries ----------

export function monthsBack(last: string, months: number): string {
  const d = new Date(last + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}
export function nextDay(date: string): string {
  return new Date(Date.parse(date + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
}

export function clampMonths(months: number | undefined): number {
  return months === undefined || !Number.isFinite(months) ? 12 : Math.max(1, Math.min(36, Math.round(months)));
}

/** The ArcGIS where-clause: arm's-length sales of at least $10,000 inside the window (from exclusive, to inclusive). */
export function buildWhere(window: { from: string; to: string }): string {
  return `QUALIFIED='Q' AND PRICE>=${MIN_SALE} AND SALEDATE>date '${window.from}' AND SALEDATE<date '${nextDay(window.to)}'`;
}

/** Date and price only. */
export const OUT_FIELDS = ["SALEDATE", "PRICE"];
export const ORDER = ["SALEDATE DESC", "OBJECTID ASC"];

export interface DcSale {
  price: number;
  date: string; // YYYY-MM-DD
}

/** SALEDATE is epoch milliseconds (noon UTC). Rows without a usable price or date are dropped. */
export function parseSales(rows: Record<string, any>[]): DcSale[] {
  const out: DcSale[] = [];
  for (const r of rows) {
    const price = Number(r.PRICE);
    const ms = Number(r.SALEDATE);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(ms) || ms <= 0) continue;
    out.push({ price, date: new Date(ms).toISOString().slice(0, 10) });
  }
  return out;
}

async function latestSale(layer: string, today: Date, fetcher?: Fetcher): Promise<string | null> {
  const tomorrow = nextDay(today.toISOString().slice(0, 10)); // ignore mistyped future dates
  const r = await arcgisQuery(
    layer,
    { where: `QUALIFIED='Q' AND PRICE>=${MIN_SALE} AND SALEDATE<date '${tomorrow}'`, outFields: ["SALEDATE"], orderByFields: ["SALEDATE DESC"], resultRecordCount: 1 },
    { fetcher, timeoutMs: 25000 },
  );
  const s = parseSales(r.rows.map((x) => ({ SALEDATE: x.SALEDATE, PRICE: 1 })));
  return s[0]?.date ?? null;
}

export interface DcHomeSalesInput {
  town?: string;
  postcode?: string;
  state?: string;
  property_type?: string;
  months?: number;
  baseUrl?: string;
}
export interface DcHomeSalesOptions {
  fetcher?: Fetcher;
  today?: Date;
}

function typeNoun(type: DcType): string {
  return type === "house" ? "Houses and rowhouses" : type === "condo" ? "Condos" : "Homes (houses, rowhouses and condos)";
}

export async function dcHomeSales(input: DcHomeSalesInput, opts: DcHomeSalesOptions = {}): Promise<PriceAnswer> {
  const type = (input.property_type ?? "any").toLowerCase() as DcType;
  if (!(DC_TYPES as readonly string[]).includes(type)) {
    throw new InputError(`property_type must be one of: ${DC_TYPES.join(", ")} for Washington, DC (coop is New York City only).`);
  }
  if (input.postcode && String(input.postcode).trim()) {
    throw new InputError("Washington, DC sales are answered for the whole District: a ZIP code cannot narrow them. Leave postcode out.");
  }
  const months = clampMonths(input.months);
  const today = opts.today ?? new Date();
  const layers = type === "any" ? [LAYERS.house, LAYERS.condo] : [LAYERS[type]];

  const latests = (await Promise.all(layers.map((l) => latestSale(l, today, opts.fetcher)))).filter((d): d is string => d !== null);
  if (!latests.length) throw new SourceError("The DC property sales tables returned no recent qualified sales");
  const latest = latests.sort().reverse()[0];
  const window = { from: monthsBack(latest, months), to: latest };
  const where = buildWhere(window);

  const parts = await Promise.all(
    layers.map((l) => arcgisAll(l, { where, outFields: OUT_FIELDS, orderByFields: ORDER }, { fetcher: opts.fetcher, maxRows: MAX_ROWS, pageSize: PAGE_SIZE, timeoutMs: 25000 })),
  );
  const sales = parts.flatMap((c) => parseSales(c.rows));
  const truncated = parts.some((c) => c.truncated);
  const dates = sales.map((s) => s.date).sort();
  const summary = summarise(sales.map((s) => s.price));

  const notes: string[] = [];
  if (truncated) notes.push(`Result capped at ${MAX_ROWS.toLocaleString("en-US")} sales per table; ask for fewer months for the full window.`);
  notes.push("Each DC table keeps the newest sale of every property, so a home sold twice inside the window counts once, at its newer price.");

  return buildAnswer({
    source: INFO,
    query: { country: "US", town: input.town ?? null, state: "DC", property_type: type, months },
    summary,
    currency: "USD",
    unit: type === "any" ? "per sale" : "per home",
    period: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    method:
      `Median and 10th–90th percentile of qualified (arm's-length) sales of ${typeNoun(type).toLowerCase()} in Washington, DC in the ${months} months up to the latest recorded sale (${latest}), ` +
      "from the District's Computer-Assisted Mass Appraisal tables (Office of the Chief Financial Officer). Sales under $10,000 and unqualified sales (family transfers, forced sales and similar) are excluded. " +
      "The tables keep each property's newest sale only. A sale of several units in one deal can repeat its price on each unit; the median and range are robust to this but not immune." +
      (truncated ? ` Only the ${MAX_ROWS.toLocaleString("en-US")} most recent sales per table are used.` : ""),
    describe: (x) =>
      `${typeNoun(type)} in Washington, DC sold for a median of ${fmtMoney(x.median, "USD")}; 10th–90th percentile range ${fmtMoney(x.low, "USD")}–${fmtMoney(x.high, "USD")}.`,
    baseUrl: input.baseUrl,
    extra: {
      area: "Washington, DC",
      dataset: { name: INFO.name, url: INFO.licence_url },
      window: { months, from_exclusive: window.from, to: window.to },
      dataset_latest_sale: latest,
      notes,
    },
  });
}
