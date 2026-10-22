// Home prices for Scotland and Northern Ireland from the UK House Price Index (UK HPI): the official monthly average price of homes
// by country, council area and property type, published by HM Land Registry with Registers of Scotland, NISRA (Land & Property
// Services) and the Office for National Statistics. England & Wales sales records are covered by gb-hmlr-ppd; this source adds the two
// nations that have no public sale-by-sale register, as an official statistic.
// Read through the Land Registry SPARQL endpoint (one small GET per answer). Format checked live on 2026-10-22 through the GitHub probe.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import { NI_AREAS, SCOTLAND_AREAS } from "./areas";

export const SPARQL_URL = "https://landregistry.data.gov.uk/landregistry/query";
export const PAGE_URL = "https://landregistry.data.gov.uk/app/ukhpi/";
export const LICENCE_URL = "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";

export const INFO: SourceInfo = {
  id: "gb-ukhpi",
  country: "GB (Scotland and Northern Ireland)",
  category: "home sales (official average price)",
  name: "UK House Price Index: average price of homes by council area and property type",
  publisher: "HM Land Registry, Registers of Scotland, Land & Property Services Northern Ireland and the Office for National Statistics (UK House Price Index)",
  what_is_recorded:
    "For Scotland, Northern Ireland and their council areas (32 in Scotland, 11 in Northern Ireland), each month: the average price of homes, overall and for detached, " +
    "semi-detached, terraced and flat/maisonette homes, calculated by the UK House Price Index from completed sales registered by Registers of Scotland and from the NI Land & Property Services data, " +
    "together with the price index and the annual change. One published figure per place, type and month; never individual sales or addresses.",
  price_type: "official_statistic",
  freshness: "Monthly: the newest month is about two months old, and recent months are revised as more sales are registered; each answer states its month",
  licence:
    "Open Government Licence v3.0. HM Land Registry's UK HPI pages state: \"All content is available under the Open Government Licence v3.0 except where otherwise stated.\" " +
    "(read 2026-10-22; the linked data is \"free to use under the terms of the OGL\").",
  licence_url: LICENCE_URL,
  attribution:
    "Contains HM Land Registry data © Crown copyright and database right 2026, and data from Registers of Scotland, Land & Property Services (Northern Ireland) and the Office for National Statistics. " +
    "This data is licensed under the Open Government Licence v3.0. Figures are passed on as published; the change on the year before is calculated by ProofPrice.",
  homepage: PAGE_URL,
  limits:
    "A statistic, not a list of sales: the UK HPI applies a price index to a base average, so the average price is a model figure that is revised for recent months and can differ from a simple mean of the latest sales. " +
    "Average of all homes of the type in the area, not the price of any one home, and no distribution (no typical range). The number of sales behind a month is published only after a delay, " +
    "so it is shown as extra information for the newest month that has one and is not a sample size. Council-area figures can move a lot from month to month where few homes sell. " +
    "England and Wales are answered from HM Land Registry's sale records instead (not this source).",
};

export const PROPERTY_TYPES = ["any", "detached", "semi-detached", "terraced", "flat-maisonette"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
const TYPE_FIELD: Record<PropertyType, string> = {
  any: "a",
  detached: "ad",
  "semi-detached": "as",
  terraced: "at",
  "flat-maisonette": "af",
};
const TYPE_WORDS: Record<PropertyType, string> = {
  any: "homes of all types",
  detached: "detached homes",
  "semi-detached": "semi-detached homes",
  terraced: "terraced homes",
  "flat-maisonette": "flats and maisonettes",
};

// ---------- places (pure) ----------

export interface Place {
  slug: string;
  label: string;
  nation: "Scotland" | "Northern Ireland";
  level: "nation" | "council area";
}

const PLACES: Place[] = [
  { slug: "scotland", label: "Scotland", nation: "Scotland", level: "nation" },
  { slug: "northern-ireland", label: "Northern Ireland", nation: "Northern Ireland", level: "nation" },
  ...Object.entries(SCOTLAND_AREAS).map(([slug, label]): Place => ({ slug, label, nation: "Scotland", level: "council area" })),
  ...Object.entries(NI_AREAS).map(([slug, label]): Place => ({ slug, label, nation: "Northern Ireland", level: "council area" })),
];

/** Lower case, accents removed, punctuation to single spaces, "city of" / "council" / "county" dropped. */
export function foldName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(city of|city|council|county|the|area)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// What people call these places, folded, to the region slug.
const ALIASES: Record<string, string> = {
  edinburgh: "city-of-edinburgh",
  glasgow: "city-of-glasgow",
  aberdeen: "city-of-aberdeen",
  dundee: "city-of-dundee",
  scottish: "scotland",
  ni: "northern-ireland",
  "n ireland": "northern-ireland",
  ulster: "northern-ireland",
  derry: "derry-and-strabane",
  londonderry: "derry-and-strabane",
  strabane: "derry-and-strabane",
  "derry and strabane": "derry-and-strabane",
  ards: "north-down-and-ards",
  "north down": "north-down-and-ards",
  "ards and north down": "north-down-and-ards",
  bangor: "north-down-and-ards",
  armagh: "armagh-banbridge-and-craigavon",
  banbridge: "armagh-banbridge-and-craigavon",
  craigavon: "armagh-banbridge-and-craigavon",
  portadown: "armagh-banbridge-and-craigavon",
  lurgan: "armagh-banbridge-and-craigavon",
  newry: "newry-mourne-and-down",
  downpatrick: "newry-mourne-and-down",
  lisburn: "lisburn-and-castlereagh",
  castlereagh: "lisburn-and-castlereagh",
  antrim: "antrim-and-newtownabbey",
  newtownabbey: "antrim-and-newtownabbey",
  carrickfergus: "mid-and-east-antrim",
  ballymena: "mid-and-east-antrim",
  larne: "mid-and-east-antrim",
  coleraine: "causeway-coast-and-glens",
  limavady: "causeway-coast-and-glens",
  ballymoney: "causeway-coast-and-glens",
  "causeway coast": "causeway-coast-and-glens",
  fermanagh: "fermanagh-and-omagh",
  omagh: "fermanagh-and-omagh",
  enniskillen: "fermanagh-and-omagh",
  cookstown: "mid-ulster",
  dungannon: "mid-ulster",
  magherafelt: "mid-ulster",
  orkney: "orkney-islands",
  shetland: "shetland-islands",
  "western isles": "na-h-eileanan-siar",
  "outer hebrides": "na-h-eileanan-siar",
  "eilean siar": "na-h-eileanan-siar",
  borders: "scottish-borders",
  dumfries: "dumfries-and-galloway",
  galloway: "dumfries-and-galloway",
  perth: "perth-and-kinross",
  kinross: "perth-and-kinross",
  argyll: "argyll-and-bute",
  bute: "argyll-and-bute",
  inverness: "highland",
  "the highlands": "highland",
  highlands: "highland",
  paisley: "renfrewshire",
  "east kilbride": "south-lanarkshire",
  hamilton: "south-lanarkshire",
  motherwell: "north-lanarkshire",
  livingston: "west-lothian",
  kirkcaldy: "fife",
  "st andrews": "fife",
  dunfermline: "fife",
  ayr: "south-ayrshire",
  kilmarnock: "east-ayrshire",
  irvine: "north-ayrshire",
  greenock: "inverclyde",
  musselburgh: "east-lothian",
};

const BY_NAME = new Map<string, Place>();
for (const p of PLACES) BY_NAME.set(foldName(p.label), p);
for (const [alias, slug] of Object.entries(ALIASES)) {
  const p = PLACES.find((x) => x.slug === slug);
  if (p && !BY_NAME.has(alias)) BY_NAME.set(alias, p);
}

/** The Scottish or Northern Irish place a name means, or null (England and Wales, and anything unknown, are not this source's). */
export function findPlace(name: string | undefined | null): Place | null {
  if (!name) return null;
  const f = foldName(name.replace(/,\s*(scotland|northern ireland|uk|united kingdom)\s*$/i, ""));
  if (!f) return null;
  return BY_NAME.get(f) ?? BY_NAME.get(f.replace(/\s+(scotland|northern ireland)$/, "")) ?? null;
}

export function placeNames(): string {
  return PLACES.map((p) => p.label).join(", ");
}

// ---------- the SPARQL answer (pure) ----------

export interface Month {
  month: string; // "2026-07"
  values: Record<string, number | null>; // a, ad, as, at, af (average prices)
  index: number | null;
  annualChange: number | null;
  salesVolume: number | null;
}

export function buildQuery(slug: string): string {
  if (!/^[a-z-]+$/.test(slug)) throw new InputError("Unknown place.");
  return (
    "PREFIX ukhpi: <http://landregistry.data.gov.uk/def/ukhpi/>\n" +
    "SELECT ?m ?a ?ad ?as ?at ?af ?i ?y ?v WHERE { ?obs ukhpi:refRegion ?r ; ukhpi:refMonth ?m ; ukhpi:averagePrice ?a .\n" +
    "OPTIONAL{?obs ukhpi:averagePriceDetached ?ad} OPTIONAL{?obs ukhpi:averagePriceSemiDetached ?as} OPTIONAL{?obs ukhpi:averagePriceTerraced ?at} OPTIONAL{?obs ukhpi:averagePriceFlatMaisonette ?af}\n" +
    "OPTIONAL{?obs ukhpi:housePriceIndex ?i} OPTIONAL{?obs ukhpi:percentageAnnualChange ?y} OPTIONAL{?obs ukhpi:salesVolume ?v}\n" +
    `FILTER(?r = <http://landregistry.data.gov.uk/id/region/${slug}>) } ORDER BY DESC(?m) LIMIT 14`
  );
}

export function queryUrl(slug: string): string {
  return `${SPARQL_URL}?output=json&query=${encodeURIComponent(buildQuery(slug))}`;
}

const numOf = (b: any, k: string): number | null => {
  const v = b?.[k]?.value;
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** SPARQL JSON -> months, newest first. Throws SourceError when the shape is not a SPARQL result. */
export function parseMonths(json: any): Month[] {
  const rows = json?.results?.bindings;
  if (!Array.isArray(rows)) throw new SourceError("Unexpected answer from the UK House Price Index service", "no results.bindings");
  const out: Month[] = [];
  for (const b of rows) {
    const month = String(b?.m?.value ?? "");
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    out.push({
      month,
      values: { a: numOf(b, "a"), ad: numOf(b, "ad"), as: numOf(b, "as"), at: numOf(b, "at"), af: numOf(b, "af") },
      index: numOf(b, "i"),
      annualChange: numOf(b, "y"),
      salesVolume: numOf(b, "v"),
    });
  }
  return out.sort((x, y) => (x.month < y.month ? 1 : -1));
}

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function monthBefore(month: string, back: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const METHOD =
  "Scotland and Northern Ireland: the average home price that the UK House Price Index (HM Land Registry with Registers of Scotland and Land & Property Services NI) publishes every month for the nation, council area and property type. " +
  "We pass on the newest published month with the change on the same month a year earlier; it is an official average, not a list of sales.";

export interface Query {
  town?: string;
  property_type?: string;
  baseUrl?: string;
}

function empty(q: Query, place: string, type: PropertyType, summary: string): PriceAnswer {
  const none = buildStatisticAnswer({
    source: INFO,
    query: { country: "GB", town: place, property_type: type },
    value: null,
    measure: "average",
    currency: "GBP",
    unit: "per home",
    period: { from: null, to: null },
    reference_period: "",
    method: METHOD,
    describe: () => "",
    baseUrl: q.baseUrl,
  });
  return { ...none, summary };
}

/** The finished answer from the parsed months. */
export function ukhpiAnswer(place: Place, type: PropertyType, months: Month[], q: Query = {}): PriceAnswer {
  const field = TYPE_FIELD[type];
  const withFigure = months.filter((m) => m.values[field] !== null && (m.values[field] as number) > 0);
  const latest = withFigure[0];
  if (!latest) {
    return empty(
      q,
      place.label,
      type,
      `The UK House Price Index publishes no average price for ${TYPE_WORDS[type]} in ${place.label}. Try property_type any, or a wider area (${place.nation}).`,
    );
  }
  const value = latest.values[field] as number;
  const prevMonth = monthBefore(latest.month, 12);
  const prev = months.find((m) => m.month === prevMonth && m.values[field] !== null);
  const changePct = prev ? Math.round(((value / (prev.values[field] as number)) - 1) * 1000) / 10 : null;
  const volume = months.find((m) => m.salesVolume !== null);
  const label = monthLabel(latest.month);
  const notes = [
    "Official UK House Price Index average for the month; recent months are revised as more sales are registered.",
    place.level === "council area" ? `${place.label} is a council area of ${place.nation}.` : "",
  ].filter(Boolean);
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "GB", town: place.label, property_type: type },
    value,
    measure: "average",
    currency: "GBP",
    unit: "per home",
    period: { from: `${latest.month}-01`, to: monthEnd(latest.month) },
    reference_period: latest.month,
    method: METHOD,
    note: notes.join(" "),
    baseUrl: q.baseUrl,
    describe: (v) =>
      `In ${place.label} the average price of ${TYPE_WORDS[type]} was ${fmtMoney(v, "GBP")} in ${label} (UK House Price Index; an official average, not a median)` +
      (changePct === null ? "." : `, ${changePct === 0 ? "unchanged" : `${Math.abs(changePct)}% ${changePct > 0 ? "higher" : "lower"}`} than in ${monthLabel(prevMonth)}.`),
    extra: {
      place: { name: place.label, level: place.level, nation: place.nation },
      property_type: type,
      price_index: latest.index,
      annual_change_percent_published: type === "any" ? latest.annualChange : null,
      change_on_year_percent: changePct,
      same_month_last_year: prev ? { month: prevMonth, value: prev.values[field] } : null,
      sales_volume: volume ? { month: volume.month, sales: volume.salesVolume, note: "Completed sales registered in that month (published with a delay); not a sample size." } : null,
      dataset: { sparql: SPARQL_URL, page: PAGE_URL },
    },
  });
}

// ---------- fetching ----------

export async function ukHpi(q: Query): Promise<PriceAnswer> {
  const raw = (q.property_type ?? "any").toLowerCase();
  if (!PROPERTY_TYPES.includes(raw as PropertyType)) {
    throw new InputError(`property_type must be one of: ${PROPERTY_TYPES.join(", ")}`);
  }
  const type = raw as PropertyType;
  if (!q.town) throw new InputError("A place is required: Scotland, Northern Ireland or a council area such as 'Edinburgh' or 'Belfast'.");
  const place = findPlace(q.town);
  if (!place) {
    return empty(q, q.town, type, `The UK House Price Index source here covers Scotland and Northern Ireland only. '${q.town}' is not one of their council areas. Valid places: ${placeNames()}.`);
  }
  const json = await fetchJson(queryUrl(place.slug), { headers: { accept: "application/sparql-results+json" } }, 15000);
  return ukhpiAnswer(place, type, parseMonths(json), q);
}
