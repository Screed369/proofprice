// Poland commercial premises: the same national Real Estate Price Register (RCN, GUGiK) and WFS service as pl-rcn-home-sales, but the
// premises (lokale) whose function is retail/services (handlowoUslugowa) or office (biurowa). Plots are NOT served (the price sits on a
// bundle of plots). We never read or keep addresses, names or document numbers: a record is reduced to (date, function, price, area)
// in memory and only the aggregate leaves this file. Answered live: one filtered WFS request per 90-day slice.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH, summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";
import { PLACES, WFS, findPlace, makeFetch, normaliseName, type GmlFetcher } from "../pl-rcn-home-sales/source";

export const INFO: SourceInfo = {
  id: "pl-rcn-commercial",
  country: "Poland",
  category: "commercial property (notarised sales of shops, services and offices)",
  name: "Real Estate Price Register (RCN), commercial premises",
  publisher: "Glowny Urzad Geodezji i Kartografii (GUGiK, Surveyor General of Poland), Rejestr Cen Nieruchomosci, via mapy.geoportal.gov.pl",
  what_is_recorded:
    "The price in a notarial deed for one commercial premises (gross price in PLN and usable area in m2) whose function is retail/services or office, recorded in the national price register.",
  price_type: "transaction",
  freshness: "The register is filled from notarial deeds with a delay of several months; the answer names the newest sale it holds.",
  licence: "Public register; access is free of charge by Polish law (Dz.U. 2025 poz. 1542). Geoportal terms: publication of the material is allowed if the source is named. No named open licence.",
  licence_url: "https://www.geoportal.gov.pl/pl/dane/rejestr-cen-nieruchomosci-rcn/",
  attribution:
    "Source: Glowny Urzad Geodezji i Kartografii (GUGiK), Rejestr Cen Nieruchomosci (RCN), mapy.geoportal.gov.pl. Changed by ProofPrice: only free-market sales of retail/service and office premises, medians and percentiles computed from the records.",
  homepage: "https://www.geoportal.gov.pl/",
  limits:
    "Retail/services and office premises only (not warehouses, garages, plots or whole buildings), free-market deeds only. Prices are gross (VAT may be included). Price per m2 divides the premises' own price by its usable area. " +
    "Small cities hold few such sales: with fewer than 5 plausible sales no figure is given. Implausible records (area outside 10-2,000 m2, price per m2 outside 1,500-80,000 PLN) are dropped. " +
    "Licence status: free by law but no named open licence, so treat commercial reuse as unclear.",
  method_version: "1",
};

export const SLICE_DAYS = 90;
export const SLICE_CAP = 300;
export const DEFAULT_MONTHS = 12;
export const MAX_MONTHS = 24;
export const AREA_RANGE: [number, number] = [10, 2000];
export const M2_RANGE: [number, number] = [1500, 80000];
export const FUNCTIONS = { retail: "handlowoUslugowa", office: "biurowa" } as const;

export interface Sale { date: string; fn: "retail" | "office"; price: number; area: number; msc: string }

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<ms:${name}(?:\\s[^>]*)?>([\\s\\S]*?)</ms:${name}>`));
  return m ? m[1].trim() : "";
}

/** Parse a WFS GetFeature GML answer into commercial sales. Only date, function, premises price, area and the city name are read. */
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
    const f = tag(block, "LOK_FUNKCJA");
    const fn = f === FUNCTIONS.retail ? "retail" : f === FUNCTIONS.office ? "office" : null;
    if (!fn) continue;
    if (tag(block, "TRAN_RODZAJ_TRANS") !== "wolnyRynek") continue;
    const price = Number(tag(block, "LOK_CENA_BRUTTO"));
    const area = Number(tag(block, "LOK_POW_UZYT"));
    const dm = block.match(/<ms:DOK_DATA[^>]*>\s*<gml:timePosition>(\d{4}-\d{2}-\d{2})/);
    const date = dm ? dm[1] : "";
    const msc = normaliseName((tag(block, "LOK_ADRES").match(/MSC:([^;]*)/)?.[1] ?? "").trim());
    if (!date || !Number.isFinite(price) || !Number.isFinite(area) || price <= 0 || area <= 0) continue;
    sales.push({ date, fn, price, area, msc });
  }
  return { sales, returned: members.length };
}

export function plausible(s: Sale): boolean {
  const m2 = s.price / s.area;
  return s.area >= AREA_RANGE[0] && s.area <= AREA_RANGE[1] && m2 >= M2_RANGE[0] && m2 <= M2_RANGE[1];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const eq = (f: string, v: string) => `<fes:PropertyIsEqualTo><fes:ValueReference>${f}</fes:ValueReference><fes:Literal>${esc(v)}</fes:Literal></fes:PropertyIsEqualTo>`;

export function sliceUrl(teryt: string, from: string, toExclusive: string, fns: string[] = [FUNCTIONS.retail, FUNCTIONS.office]): string {
  const fnFilter = fns.length === 1 ? eq("LOK_FUNKCJA", fns[0]) : `<fes:Or>${fns.map((f) => eq("LOK_FUNKCJA", f)).join("")}</fes:Or>`;
  const filter =
    `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0"><fes:And>` +
    `<fes:PropertyIsGreaterThanOrEqualTo><fes:ValueReference>DOK_DATA</fes:ValueReference><fes:Literal>${from}</fes:Literal></fes:PropertyIsGreaterThanOrEqualTo>` +
    `<fes:PropertyIsLessThan><fes:ValueReference>DOK_DATA</fes:ValueReference><fes:Literal>${toExclusive}</fes:Literal></fes:PropertyIsLessThan>` +
    eq("TERYT", teryt) + eq("TRAN_RODZAJ_TRANS", "wolnyRynek") + fnFilter +
    `</fes:And></fes:Filter>`;
  return `${WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=ms:lokale&count=${SLICE_CAP}&filter=${encodeURIComponent(filter)}`;
}

/** Slices of SLICE_DAYS days, newest first, covering `months` x 30 days (rounded up to whole slices) that end the day after `today`. */
export function slices(today: string, months: number): { from: string; to: string }[] {
  const day = 86400000;
  const end = Date.parse(today + "T00:00:00Z") + day; // exclusive
  const n = Math.max(1, Math.ceil((months * 30) / SLICE_DAYS));
  const out: { from: string; to: string }[] = [];
  for (let i = 0; i < n; i++) {
    const to = end - i * SLICE_DAYS * day;
    const from = to - SLICE_DAYS * day;
    out.push({ from: new Date(from).toISOString().slice(0, 10), to: new Date(to).toISOString().slice(0, 10) });
  }
  return out;
}

export const defaultFetch: GmlFetcher = makeFetch(20000);

export function monthsOf(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return DEFAULT_MONTHS;
  return Math.max(1, Math.min(MAX_MONTHS, Math.round(n)));
}

export const COMMERCIAL_WORDS = new Set(["commercial", "shop", "shops", "office", "offices", "retail", "premises", "any", "all"]);
export interface PlCommercialArgs { town?: string; postcode?: string; property_type?: string; months?: number; baseUrl?: string; today?: string; fetchGml?: GmlFetcher }

const zl = (v: number) => fmtMoney(v, "PLN");

export async function plCommercial(args: PlCommercialArgs): Promise<PriceAnswer> {
  const town = (args.town ?? "").trim();
  if (!town) throw new InputError(`Give a city in town: ${PLACES.map((p) => p.label).join(", ")}. Poland's register is read per city county.`);
  if (args.postcode) throw new InputError("Poland: postcode is not supported; give the city as town.");
  if (args.property_type && !COMMERCIAL_WORDS.has(args.property_type.trim().toLowerCase())) {
    throw new InputError("Poland: only commercial premises (shops, services, offices) are available; building plots are not, because the register prices bundles of plots.");
  }
  const place = findPlace(town);
  if (!place) throw new InputError(`Give a city from this list in town: ${PLACES.map((p) => p.label).join(", ")}.`);
  const months = monthsOf(args.months);
  const today = args.today ?? new Date().toISOString().slice(0, 10);
  const fetchGml = args.fetchGml ?? defaultFetch;
  const parts = slices(today, months);
  const results = await Promise.all(parts.map(async (x) => parseSales(await fetchGml(sliceUrl(place.teryt, x.from, x.to)))));
  const all: Sale[] = [];
  let returned = 0, capped = false, wrongCity = 0;
  for (const r of results) {
    returned += r.returned;
    if (r.returned >= SLICE_CAP) capped = true;
    for (const s of r.sales) {
      if (s.msc && s.msc !== normaliseName(place.msc)) { wrongCity++; continue; }
      all.push(s);
    }
  }
  if (returned > 0 && wrongCity >= returned / 2) {
    throw new SourceError("The register returned records for a different city than asked; not answering", `place ${place.label}`);
  }
  const kept = all.filter(plausible);
  const dates = kept.map((s) => s.date).sort();
  const m2 = summarise(kept.map((s) => s.price / s.area));
  const prem = summarise(kept.map((s) => s.price));
  const byFunction: Record<string, unknown> = {};
  for (const fn of ["retail", "office"] as const) {
    const sub = summarise(kept.filter((s) => s.fn === fn).map((s) => s.price / s.area));
    if (sub && sub.count >= MIN_PUBLISH) byFunction[fn] = { sample_size: sub.count, median_per_m2: sub.median, typical_low: sub.low, typical_high: sub.high, currency: "PLN" };
  }
  const period = { from: parts[parts.length - 1].from, to: dates.length ? dates[dates.length - 1] : today };
  return buildAnswer({
    source: INFO,
    query: { country: "PL", town: place.label, property_type: "commercial", months },
    summary: m2,
    currency: "PLN",
    unit: "per m²",
    period,
    method:
      `Poland: notarised free-market sales of retail/service and office premises in ${place.label} from the national Real Estate Price Register (GUGiK), deeds dated from ${period.from}; ` +
      `median and 10th-90th percentile of the premises' gross price divided by its usable area; implausible records dropped; ${capped ? "at least one 90-day slice hit the " + SLICE_CAP + "-record read limit, so this is a sample" : "every record of the period was read"}. ` +
      `The register lags by months, so the period ends at the newest sale held.`,
    describe: (s) =>
      `Commercial premises (shops, services, offices) in ${place.label} sold for a median of ${zl(s.median)} per m² (typical range ${zl(s.low)} to ${zl(s.high)})` +
      (prem && prem.count >= MIN_PUBLISH ? `; a median of ${zl(prem.median)} per premises` : "") + ".",
    baseUrl: args.baseUrl,
    extra: {
      place: place.label,
      per_premises: prem && prem.count >= MIN_PUBLISH ? { median: prem.median, typical_low: prem.low, typical_high: prem.high, currency: "PLN" } : null,
      by_function: byFunction,
      sampled: capped,
      records_read: returned,
      records_dropped: all.length - kept.length,
      newest_sale: dates.length ? dates[dates.length - 1] : null,
    },
  });
}
