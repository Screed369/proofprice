// Switzerland (Zürich): median price of freehold condominiums (Stockwerkeigentum) sold between private parties, by year and city district,
// from Statistik Stadt Zürich. CKAN datastore on data.stadt-zuerich.ch, resource d9d471e9-11fc-4cca-8242-bc63e8d6ac92 (dataset
// bau_hae_preis_stockwerkeigentum_stadtquartier_od5157). Format checked live 2026-10-31: plain GET, no key, all fields TEXT.
// One request returns the whole table (about 800 rows, 250 KB); the answer is picked from it. Small areas show a range ("2-6") or
// "K" instead of a number: such rows are never used (a figure needs a plain count of at least 5 sales and a numeric median).
import { ckanSearch } from "../../lib/adapters";
import type { FetchOptions } from "../../lib/adapters";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import { MIN_PUBLISH } from "../../lib/stats";

export const SITE = "https://data.stadt-zuerich.ch";
export const RESOURCE_ID = "d9d471e9-11fc-4cca-8242-bc63e8d6ac92";
export const DATASET_URL = "https://data.stadt-zuerich.ch/dataset/bau_hae_preis_stockwerkeigentum_stadtquartier_od5157";

export const INFO: SourceInfo = {
  id: "ch-zurich-home-sales",
  country: "CH (city of Zürich)",
  category: "home sales (median price of condominiums sold, city of Zürich)",
  name: "Median price of freehold condominiums sold, by year and city district (Statistik Stadt Zürich)",
  publisher: "Statistik Stadt Zürich (Präsidialdepartement der Stadt Zürich)",
  what_is_recorded:
    "For the city of Zürich and each of its 12 districts (Kreise) and statistical quarters: the number of freehold condominium (Stockwerkeigentum) sales between private parties (Freihandkäufe) in a year, " +
    "the median price per flat and the median price per square metre of living area, from the registered property transfers. One published figure per area and year; never individual sales or addresses.",
  price_type: "transaction",
  freshness: "Yearly; the latest year published is 2025 (dataset updated 8 Jan 2026). Each answer states its year.",
  licence: "Creative Commons CCZero (CC0 1.0): the dataset's licence on data.stadt-zuerich.ch.",
  licence_url: "https://creativecommons.org/publicdomain/zero/1.0/",
  attribution: "Source: Statistik Stadt Zürich, Open Data Zürich, 'Preise für Stockwerkeigentum nach Stadtquartier' (data.stadt-zuerich.ch, CC0 1.0).",
  homepage: DATASET_URL,
  limits:
    "Freehold condominiums sold between private parties in the city of Zürich only, not houses, inheritances, gifts or sales between related parties, and not the rest of Switzerland. " +
    "One median per area and year: no 10th-90th percentile range is published. Areas with fewer than 5 sales in a year, or where the publisher shows a range or 'K' instead of a number, are not answered. Yearly, so up to a year behind.",
};

export interface Row {
  year: number;
  code: string;
  name: string;
  sales: number;
  medianFlat: number;
  perM2: number | null;
  mean: number | null;
  provisional: boolean;
}

const toInt = (v: unknown): number | null => (typeof v === "string" || typeof v === "number") && /^\d+$/.test(String(v).trim()) ? Number(String(v).trim()) : null;

/** Rows that can be published: a plain integer count of at least 5 and a numeric median. Everything else (ranges like "2-6" or "9–11", "K", null) is dropped. */
export function parseRows(records: Array<Record<string, any>>): { rows: Row[]; areas: Map<string, string> } {
  const rows: Row[] = [];
  const areas = new Map<string, string>();
  for (const r of records) {
    if (String(r.HAArtLevel1Cd) !== "22" || String(r.HASTWECd) !== "J") continue;
    const code = String(r.RaumCd ?? "").trim();
    const name = String(r.RaumLang ?? "").trim();
    if (code === "" || !name) continue;
    areas.set(code, name);
    const year = toInt(r.Stichtagdatjahr);
    const sales = toInt(r.AnzHA);
    const median = toInt(r.HAMedianPreis);
    if (year === null || sales === null || sales < MIN_PUBLISH || median === null || median <= 0) continue;
    const sum = toInt(r.HASumPreis);
    rows.push({
      year, code, name, sales, medianFlat: median,
      perM2: toInt(r.HAPreisWohnflaeche),
      mean: sum !== null ? Math.round(sum / sales) : null,
      provisional: String(r.DatenstandCd) !== "D",
    });
  }
  return { rows, areas };
}

export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ß/g, "ss").replace(/ü/g, "u").replace(/[^a-z0-9]+/g, " ").trim();
}

const CITY_WORDS = ["", "zurich", "zuerich", "zurich city", "city of zurich", "stadt zurich", "ganze stadt", "whole city", "city", "all", "switzerland", "schweiz", "ch"];

/** "Zürich", "Kreis 7", "7", "district 7", "Altstetten" -> the area code in the table ("0" = whole city). Throws InputError listing choices. */
export function resolveArea(town: string | undefined, areas: Map<string, string>): { code: string; name: string } {
  const raw = (town ?? "").trim();
  const key = fold(raw);
  if (CITY_WORDS.includes(key)) return { code: "0", name: areas.get("0") ?? "Ganze Stadt" };
  const k = key.replace(/^(kreis|district|bezirk|quartier|stadtkreis)\s+/, "");
  if (/^\d{1,2}$/.test(k)) {
    const code = String(Number(k));
    if (areas.has(code)) return { code, name: areas.get(code)! };
  }
  for (const [code, name] of areas) if (fold(name) === key || fold(name) === k) return { code, name };
  const near = [...areas.values()].filter((n) => k.length >= 3 && fold(n).includes(k)).slice(0, 5);
  if (near.length === 1) {
    const e = [...areas].find(([, n]) => n === near[0])!;
    return { code: e[0], name: e[1] };
  }
  throw new InputError(
    `No Zürich district or quarter called "${raw}". Use Zürich for the whole city, a district such as 'Kreis 7' or 'Kreis 11', or a quarter such as Altstetten, Oerlikon, Seefeld or Enge.` +
      (near.length ? ` Did you mean: ${near.join("; ")}?` : ""),
  );
}

export function normaliseType(raw?: string): "flat" {
  const s = fold(raw ?? "");
  if (["", "any", "flat", "flats", "apartment", "apartments", "condo", "condos", "condominium", "condominiums", "stockwerkeigentum", "wohnung", "eigentumswohnung"].includes(s)) return "flat";
  throw new InputError(`property_type for Zürich must be flat (a freehold condominium) or left out; houses are not in this table. Not available: ${String(raw)}.`);
}

export const METHOD =
  "Statistik Stadt Zürich publishes, for each year, the number of freehold condominium sales between private parties (Freihandkäufe im Stockwerkeigentum) and the median price per flat and per square metre of living area, " +
  "for the whole city, each district (Kreis) and each statistical quarter, from the registered property transfers. ProofPrice returns the published median for the newest year in which the area has at least 5 sales " +
  "and a published median, unchanged, with the year before and the whole-city median. Changes are calculated by ProofPrice from two published medians. No range is published, so none is shown.";

export interface AnswerInput { town?: string; property_type?: string; baseUrl?: string }

const pct = (a: number, b: number) => Math.round(((a - b) / b) * 1000) / 10;

export function zurichAnswer(records: Array<Record<string, any>>, q: AnswerInput): PriceAnswer {
  normaliseType(q.property_type);
  const { rows, areas } = parseRows(records);
  const area = resolveArea(q.town, areas);
  const mine = rows.filter((r) => r.code === area.code).sort((a, b) => b.year - a.year);
  const query = { country: "CH", town: area.code === "0" ? "Zürich" : area.name, property_type: "flat" };
  const base = { source: INFO, query, measure: "median" as const, currency: "CHF", unit: "per flat", method: METHOD, baseUrl: q.baseUrl };
  const latestYear = rows.reduce((m, r) => Math.max(m, r.year), 0);
  const newest = mine[0];
  if (!newest || newest.year < latestYear - 4) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `Statistik Stadt Zürich publishes no median condominium price for ${area.name} with at least ${MIN_PUBLISH} sales in the last five years. Try the district (Kreis) it lies in, or Zürich as a whole.` };
  }
  const prev = mine.find((r) => r.year === newest.year - 1) ?? null;
  const city = rows.find((r) => r.code === "0" && r.year === newest.year) ?? null;
  const notes: string[] = [];
  if (newest.year < latestYear) notes.push(`The newest year for ${area.name} with a published median is ${newest.year}; the table runs to ${latestYear}.`);
  if (newest.provisional) notes.push("Statistik Stadt Zürich marks this year as provisional.");
  const where = area.code === "0" ? "the city of Zürich" : area.name + ", Zürich";
  const extra: Record<string, unknown> = {
    area: area.name,
    median_price_per_m2_living_area_chf: newest.perM2,
    mean_price_per_flat_chf: newest.mean,
    previous_year: prev ? { year: prev.year, median_chf: prev.medianFlat, sales: prev.sales, change_percent: pct(newest.medianFlat, prev.medianFlat) } : null,
    whole_city: city && area.code !== "0" ? { median_chf: city.medianFlat, sales: city.sales } : null,
  };
  return buildStatisticAnswer({
    ...base,
    value: newest.medianFlat,
    period: { from: `${newest.year}-01-01`, to: `${newest.year}-12-31` },
    reference_period: String(newest.year),
    sample_size: newest.sales,
    note: notes.length ? notes.join(" ") : undefined,
    extra,
    describe: (v) =>
      `The median price paid for a freehold condominium in ${where} in ${newest.year} was ${fmtMoney(v, "CHF")} (${newest.sales} sales` +
      `${newest.perM2 ? `, median ${fmtMoney(newest.perM2, "CHF")} per m² of living area` : ""}).` +
      `${prev ? ` That is ${Math.abs(pct(v, prev.medianFlat))}% ${v >= prev.medianFlat ? "higher" : "lower"} than the median in ${prev.year}.` : ""}`,
    ending: "Median of registered private sales published by Statistik Stadt Zürich; no price range is published.",
  });
}

export async function zurichHomeSales(q: AnswerInput & FetchOptions): Promise<PriceAnswer> {
  const res = await ckanSearch(
    SITE,
    { resourceId: RESOURCE_ID, filters: { HAArtLevel1Cd: "22", HASTWECd: "J" }, sort: "Stichtagdatjahr desc", limit: 1000, includeTotal: false },
    q,
  );
  return zurichAnswer(res.records, q);
}
