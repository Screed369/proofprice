// Poland home sales: the national Real Estate Price Register (Rejestr Cen Nieruchomosci, RCN), published by the Surveyor General
// (GUGiK) through the Geoportal WFS 2.0 service. Every notarised sale of a flat (lokal) is a record with its price, usable area and
// market (primary = from a developer, secondary = resale). We never read or keep addresses, names or document numbers: a record is
// reduced to (date, city, market, price, area) in memory and only the aggregate leaves this file.
// Answered live per request: for each 30-day slice of the window one filtered WFS request (city county code, residential flats,
// free-market sales), then the median and 10th-90th percentile of the flat prices and of the price per m2.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH, summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "pl-rcn-home-sales",
  country: "Poland",
  category: "home sales (notarised flat sales)",
  name: "Real Estate Price Register (RCN)",
  publisher: "Glowny Urzad Geodezji i Kartografii (GUGiK, Surveyor General of Poland), Rejestr Cen Nieruchomosci, via mapy.geoportal.gov.pl",
  what_is_recorded:
    "The price in a notarial deed for one residential flat (gross price in PLN, usable area in m2, primary or secondary market), recorded in the national price register.",
  price_type: "transaction",
  freshness: "The register is updated continuously from notarial deeds; sales appear a few weeks after the deed date. Each answer names the period it covers.",
  licence: "Public register; access is free of charge by Polish law (Dz.U. 2025 poz. 1542). The WFS states Fees none and AccessConstraints none; no named open licence.",
  licence_url: "https://mapy.geoportal.gov.pl/wss/service/rcn?service=WFS&request=GetCapabilities",
  attribution:
    "Source: Glowny Urzad Geodezji i Kartografii (GUGiK), Rejestr Cen Nieruchomosci (RCN), mapy.geoportal.gov.pl. Changed by ProofPrice: only flat sales on the free market, medians and percentiles computed from the records.",
  homepage: "https://www.geoportal.gov.pl/",
  limits:
    "Flat sales only (not houses, plots or commercial premises), free-market deeds only. Prices are gross (VAT included on primary-market sales). A request reads at most 300 records per 30-day slice, " +
    "so in the largest cities the figure comes from a sample of the period (the answer says so). Implausible records (area outside 12-250 m2, price per m2 outside 2,000-60,000 PLN) are dropped. " +
    "Licence status: free by law but no named open licence, so treat commercial reuse as unclear.",
  method_version: "1",
};

export const WFS = "https://mapy.geoportal.gov.pl/wss/service/rcn";
export const SLICE_DAYS = 30;
export const SLICE_CAP = 300;
export const MAX_MONTHS = 6;
export const DEFAULT_MONTHS = 3;
/** When the caller did not ask for a window and it holds fewer than MIN_PUBLISH sales (the register lags in some cities), widen in steps up to this many months. */
export const AUTO_WIDEN_STEPS = [6, 12];
export const AREA_RANGE: [number, number] = [12, 250];
export const M2_RANGE: [number, number] = [2000, 60000];

export interface Place { teryt: string; msc: string; label: string; names: string[] }

/** City counties (powiaty grodzkie): TERYT county code = voivodeship 2 digits + county 2 digits; msc is the city name as the register prints it. */
export const PLACES: Place[] = [
  { teryt: "1465", msc: "Warszawa", label: "Warsaw", names: ["warszawa", "warsaw"] },
  { teryt: "1261", msc: "Krakow", label: "Krakow", names: ["krakow", "cracow"] },
  { teryt: "1061", msc: "Lodz", label: "Lodz", names: ["lodz"] },
  { teryt: "0264", msc: "Wroclaw", label: "Wroclaw", names: ["wroclaw", "breslau"] },
  { teryt: "3064", msc: "Poznan", label: "Poznan", names: ["poznan", "posen"] },
  { teryt: "2261", msc: "Gdansk", label: "Gdansk", names: ["gdansk", "danzig"] },
  { teryt: "2262", msc: "Gdynia", label: "Gdynia", names: ["gdynia"] },
  { teryt: "3262", msc: "Szczecin", label: "Szczecin", names: ["szczecin", "stettin"] },
  { teryt: "0663", msc: "Lublin", label: "Lublin", names: ["lublin"] },
  { teryt: "2469", msc: "Katowice", label: "Katowice", names: ["katowice"] },
  { teryt: "0461", msc: "Bydgoszcz", label: "Bydgoszcz", names: ["bydgoszcz"] },
  { teryt: "2062", msc: "Bialystok", label: "Bialystok", names: ["bialystok"] },
  { teryt: "1863", msc: "Rzeszow", label: "Rzeszow", names: ["rzeszow"] },
  { teryt: "0463", msc: "Torun", label: "Torun", names: ["torun"] },
  { teryt: "2661", msc: "Kielce", label: "Kielce", names: ["kielce"] },
  { teryt: "2862", msc: "Olsztyn", label: "Olsztyn", names: ["olsztyn"] },
  { teryt: "1661", msc: "Opole", label: "Opole", names: ["opole"] },
  { teryt: "1463", msc: "Radom", label: "Radom", names: ["radom"] },
  { teryt: "2464", msc: "Czestochowa", label: "Czestochowa", names: ["czestochowa"] },
];

/** Lower-case, strip Polish accents and punctuation: "Łódź" -> "lodz", "Kraków, Poland" -> "krakow poland". */
export function normaliseName(raw: string): string {
  return raw
    .replace(/ł/g, "l").replace(/Ł/g, "L")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function findPlace(raw: string): Place | null {
  const n = normaliseName(raw).replace(/\b(poland|polska|city|miasto|m)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return null;
  return PLACES.find((p) => p.names.includes(n)) ?? null;
}

export interface Sale { date: string; market: "primary" | "secondary" | "unknown"; price: number; area: number; msc: string }

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<ms:${name}(?:\\s[^>]*)?>([\\s\\S]*?)</ms:${name}>`));
  return m ? m[1].trim() : "";
}

/** Parse a WFS GetFeature GML answer into the flat sales we use. Only date, market, price, area and the city name are read. */
export function parseSales(gml: string): { sales: Sale[]; returned: number } {
  if (/ExceptionReport|ServiceException/.test(gml)) {
    const m = gml.match(/<ows:ExceptionText>([\s\S]*?)<\/ows:ExceptionText>/);
    throw new SourceError("The Polish price register returned an error", (m?.[1] ?? gml).slice(0, 200));
  }
  if (!/FeatureCollection/.test(gml)) throw new SourceError("The Polish price register answered in an unexpected format");
  const members = gml.split("<wfs:member>").slice(1);
  const sales: Sale[] = [];
  for (const blockFull of members) {
    const block = blockFull.split("</wfs:member>")[0];
    if (tag(block, "LOK_FUNKCJA") !== "mieszkalna") continue;
    if (tag(block, "TRAN_RODZAJ_TRANS") !== "wolnyRynek") continue;
    const price = Number(tag(block, "LOK_CENA_BRUTTO"));
    const area = Number(tag(block, "LOK_POW_UZYT"));
    const dm = block.match(/<ms:DOK_DATA[^>]*>\s*<gml:timePosition>(\d{4}-\d{2}-\d{2})/);
    const date = dm ? dm[1] : "";
    const msc = normaliseName((tag(block, "LOK_ADRES").match(/MSC:([^;]*)/)?.[1] ?? "").trim());
    const rynek = tag(block, "TRAN_RODZAJ_RYNKU");
    const market = rynek === "rynekPierwotny" ? "primary" : rynek === "rynekWtorny" ? "secondary" : "unknown";
    if (!date || !Number.isFinite(price) || !Number.isFinite(area) || price <= 0 || area <= 0) continue;
    sales.push({ date, market, price, area, msc });
  }
  return { sales, returned: members.length };
}

/** Keep plausible flat sales: area and price per m2 inside the ranges. */
export function plausible(s: Sale): boolean {
  const m2 = s.price / s.area;
  return s.area >= AREA_RANGE[0] && s.area <= AREA_RANGE[1] && m2 >= M2_RANGE[0] && m2 <= M2_RANGE[1];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const eq = (f: string, v: string) => `<fes:PropertyIsEqualTo><fes:ValueReference>${f}</fes:ValueReference><fes:Literal>${esc(v)}</fes:Literal></fes:PropertyIsEqualTo>`;

export function sliceUrl(teryt: string, from: string, toExclusive: string): string {
  const filter =
    `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0"><fes:And>` +
    `<fes:PropertyIsGreaterThanOrEqualTo><fes:ValueReference>DOK_DATA</fes:ValueReference><fes:Literal>${from}</fes:Literal></fes:PropertyIsGreaterThanOrEqualTo>` +
    `<fes:PropertyIsLessThan><fes:ValueReference>DOK_DATA</fes:ValueReference><fes:Literal>${toExclusive}</fes:Literal></fes:PropertyIsLessThan>` +
    eq("TERYT", teryt) + eq("LOK_FUNKCJA", "mieszkalna") + eq("TRAN_RODZAJ_TRANS", "wolnyRynek") +
    `</fes:And></fes:Filter>`;
  return `${WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=ms:lokale&count=${SLICE_CAP}&filter=${encodeURIComponent(filter)}`;
}

/** Slices of SLICE_DAYS days, newest first, covering `months` x 30 days that end the day after `today`. */
export function slices(today: string, months: number, skip = 0): { from: string; to: string }[] {
  const day = 86400000;
  const end = Date.parse(today + "T00:00:00Z") + day; // exclusive
  const out: { from: string; to: string }[] = [];
  for (let i = skip; i < skip + months; i++) {
    const to = end - i * SLICE_DAYS * day;
    const from = to - SLICE_DAYS * day;
    out.push({ from: new Date(from).toISOString().slice(0, 10), to: new Date(to).toISOString().slice(0, 10) });
  }
  return out;
}

export type GmlFetcher = (url: string) => Promise<string>;

export const defaultFetch: GmlFetcher = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)", accept: "application/gml+xml, text/xml" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, (await res.text().catch(() => "")).slice(0, 200), res.status);
    return await res.text();
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
};

export interface PlHomeArgs { town?: string; postcode?: string; property_type?: string; months?: number; baseUrl?: string; today?: string; fetchGml?: GmlFetcher }

export function monthsOf(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return DEFAULT_MONTHS;
  return Math.max(1, Math.min(MAX_MONTHS, Math.round(n)));
}

const zl = (v: number) => fmtMoney(v, "PLN");

export async function plHomeSales(args: PlHomeArgs): Promise<PriceAnswer> {
  const town = (args.town ?? "").trim();
  if (!town) {
    throw new InputError(`Give a city in town: ${PLACES.map((p) => p.label).join(", ")}. Poland's register is read per city county.`);
  }
  if (args.postcode) throw new InputError("Poland: postcode is not supported; give the city as town.");
  if (args.property_type && args.property_type !== "any") throw new InputError("Poland: only flats are available (property_type any).");
  const place = findPlace(town);
  if (!place) throw new InputError(`Give a city from this list in town: ${PLACES.map((p) => p.label).join(", ")}.`);
  const months = monthsOf(args.months);
  const today = args.today ?? new Date().toISOString().slice(0, 10);
  const fetchGml = args.fetchGml ?? defaultFetch;
  let parts = slices(today, months);
  const all: Sale[] = [];
  let capped = false, returned = 0, wrongCity = 0;
  const readParts = async (sl: { from: string; to: string }[]) => {
    const results = await Promise.all(sl.map(async (x) => parseSales(await fetchGml(sliceUrl(place.teryt, x.from, x.to)))));
    for (const r of results) {
      returned += r.returned;
      if (r.returned >= SLICE_CAP) capped = true;
      for (const s of r.sales) {
        if (s.msc && s.msc !== normaliseName(place.msc)) { wrongCity++; continue; }
        all.push(s);
      }
    }
  };
  await readParts(parts);
  // The register lags by a few weeks and some cities (Warsaw) load slowly: with no window asked for and too few sales, widen step by step and say so.
  let usedMonths = months;
  let widened = false;
  if (args.months === undefined) {
    for (const target of AUTO_WIDEN_STEPS) {
      if (all.filter(plausible).length >= MIN_PUBLISH || wrongCity > 0) break;
      const extra = slices(today, target - usedMonths, usedMonths);
      await readParts(extra);
      parts = parts.concat(extra);
      usedMonths = target;
      widened = true;
    }
  }
  // Guard against a wrong county code: if most records name another city, refuse rather than answer for the wrong place.
  if (returned > 0 && wrongCity > 0 && wrongCity >= returned / 2) {
    throw new SourceError("The register returned records for a different city than asked; not answering", `place ${place.label}`);
  }
  const kept = all.filter(plausible);
  const dates = kept.map((s) => s.date).sort();
  const summary = summarise(kept.map((s) => s.price));
  const m2 = summarise(kept.map((s) => s.price / s.area));
  const byMarket: Record<string, unknown> = {};
  for (const mk of ["primary", "secondary"] as const) {
    const sub = kept.filter((s) => s.market === mk);
    const ss = summarise(sub.map((s) => s.price));
    const mm = summarise(sub.map((s) => s.price / s.area));
    if (ss && ss.count >= MIN_PUBLISH && mm) byMarket[mk] = { sample_size: ss.count, median_price: ss.median, price_low: ss.low, price_high: ss.high, median_per_m2: mm.median };
  }
  const period = { from: parts[parts.length - 1].from, to: today };
  return buildAnswer({
    source: INFO,
    query: { country: "PL", town: place.label, months: usedMonths },
    summary,
    currency: "PLN",
    unit: "per flat",
    period,
    method:
      `Poland: notarised flat sales on the free market in ${place.label} from the national Real Estate Price Register (GUGiK), ${usedMonths * SLICE_DAYS} days up to ${today}${widened ? " (widened automatically from " + months * SLICE_DAYS + " days because the register held too few recent sales for this city)" : ""}; ` +
      `median and 10th-90th percentile of the gross price per flat; implausible records dropped; ${capped ? "at least one 30-day slice hit the " + SLICE_CAP + "-record read limit, so this is a sample of the period" : "every record of the period was read"}.`,
    describe: (s) =>
      `Flats in ${place.label} sold for a median of ${zl(s.median)} (typical range ${zl(s.low)} to ${zl(s.high)})` +
      (m2 ? `, a median of ${zl(m2.median)} per m2` : "") + `.`,
    baseUrl: args.baseUrl,
    extra: {
      place: place.label,
      per_m2: m2 && m2.count >= MIN_PUBLISH ? { median: m2.median, typical_low: m2.low, typical_high: m2.high, currency: "PLN" } : null,
      by_market: byMarket,
      sampled: capped,
      widened,
      records_read: returned,
      records_dropped: all.length - kept.length,
      newest_sale: dates.length ? dates[dates.length - 1] : null,
    },
  });
}
