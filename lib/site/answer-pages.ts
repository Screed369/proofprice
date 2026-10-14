// Answer pages: one static page per place for every source that keeps a price library, built from the newest day of
// the library (library/<source>/daily). Pure functions: the data comes in as arguments, so the rules are unit-tested.
//
// Rules this file enforces (CLAUDE.md data-honesty rules):
//  - a figure is built only from a row with at least MIN_PUBLISH (5) records; thinner rows are skipped, never shown;
//  - every figure carries its source, licence, sample size and date (the page component prints them next to it);
//  - posted pump prices are described as posted prices; asking prices never appear.

import { fmtMoney } from "../answer";
import { FUEL_LABEL, type Fuel } from "../fuels";
import type { SourceInfo } from "../plugin";
import { MIN_PUBLISH, confidenceLabel } from "../stats";
import { areaFor, countryName, NATIONAL_KEY, type AreaInfo } from "./areas";
import { int, longDate, moneyFixed, monthsBefore, shortDate } from "./format";

// ---------- which library sources get pages ----------

export type PageCategory = "fuel" | "home-sales";

export interface PageSourceSpec {
  sourceId: string;
  country: string; // ISO 3166-1 alpha-2, upper case
  category: PageCategory;
}

/** Library sources with answer pages. A new library source needs one line here plus its place names in lib/site/areas.ts. */
export const PAGE_SOURCES: PageSourceSpec[] = [
  { sourceId: "es-fuel", country: "ES", category: "fuel" },
  { sourceId: "fr-fuel", country: "FR", category: "fuel" },
  { sourceId: "it-fuel", country: "IT", category: "fuel" },
  { sourceId: "ie-ppr", country: "IE", category: "home-sales" },
];

export const CATEGORY_LABEL: Record<PageCategory, string> = {
  fuel: "Fuel prices",
  "home-sales": "Home sale prices",
};

export interface CategoryFacts {
  tool: string; // MCP tool name, from the registry
  restPath: string; // /api/v1/<restPath>
  hasHistory: boolean;
}

// ---------- types ----------

/** One aggregate row of the library (a day's row without its date). */
export interface DayRow {
  area: string;
  item: string;
  n: number;
  median: number;
  low: number; // 10th percentile
  high: number; // 90th percentile
  min?: number;
  max?: number;
}

export interface Figure {
  id: string; // "diesel", "diesel/served", "second-hand"
  label: string; // "Diesel", "Second-hand homes"
  question: string; // used as the section heading and the FAQ question
  phrase: string; // the thing asked about, as it reads in a question: "diesel", "second-hand homes"
  answer: string; // one plain sentence with the figure, range, sample size, date and confidence
  n: number;
  median: number;
  low: number;
  high: number;
  currency: string;
  unit: string;
  confidence: "high" | "medium" | "low";
  medianText: string;
  rangeText: string;
  liveRestPath: string | null; // live answer from the REST API, when the API can answer this place
  mcpArgs: Record<string, string | number>;
  caveat?: string;
}

export interface AnswerPage {
  path: string; // /prices/es/fuel/madrid
  sourceId: string;
  country: string; // "ES"
  countrySlug: string; // "es"
  countryName: string;
  category: PageCategory;
  categoryLabel: string;
  area: AreaInfo;
  national: boolean;
  h1: string;
  title: string; // without the site suffix
  description: string;
  figures: Figure[]; // never empty
  asOf: string; // YYYY-MM-DD of the library day
  period: { from: string; to: string } | null; // home sales: the rolling window
  basis: string; // what kind of price this is, in one sentence
  mcpTool: string;
  historyRestPath: string | null;
  ask: string; // copy-paste text for the reader's AI
  source: {
    id: string;
    name: string;
    publisher: string;
    licence: string;
    licence_url: string;
    attribution: string;
    homepage: string;
    freshness: string;
    limits: string;
    price_type: SourceInfo["price_type"];
  };
}

export interface BuildResult {
  pages: AnswerPage[];
  skipped: { code: string; reason: "no-name" | "too-few-records" }[];
}

// ---------- fuel ----------

const FUEL_ORDER = ["diesel", "diesel/served", "petrol95", "petrol95/served", "petrol98", "petrol98/served", "e10", "e85", "lpg", "methane"];

/** How a fuel reads inside a question. */
const FUEL_PHRASE: Record<Fuel, string> = {
  diesel: "diesel",
  petrol95: "unleaded 95 petrol",
  petrol98: "unleaded 98 petrol",
  e10: "unleaded 95-E10 petrol",
  e85: "E85 bioethanol",
  lpg: "LPG (autogas)",
  methane: "compressed natural gas (CNG)",
};

const fuelOrder = (item: string) => {
  const i = FUEL_ORDER.indexOf(item);
  return i < 0 ? 999 : i;
};

const rest = (path: string, params: Record<string, string | number>) => `${path}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`;

/** Shortest recognisable form of a publisher name, for meta descriptions: drops " (acronym)", ", country" and " via site". */
export function shortPublisher(p: string): string {
  return p.split(/ \(|, | via /)[0].trim();
}

/** The licence's name without its small print: "Creative Commons Attribution 4.0 (PSRA open data; ...)" -> "Creative Commons Attribution 4.0".
 *  The full wording is always shown in the "Where this comes from" block. */
export function shortLicence(l: string): string {
  return l.split(/ \(|: /)[0].trim();
}

/** Drops a trailing full stop so a sentence can be closed with one of its own. */
export function noFullStop(s: string): string {
  return s.replace(/[.\s]+$/, "");
}

function fuelFigures(spec: PageSourceSpec, area: AreaInfo, rows: DayRow[], date: string, cat: CategoryFacts, currency: string): Figure[] {
  const hasServed = rows.some((r) => r.item.endsWith("/served"));
  const byItem = new Map<string, DayRow>();
  for (const r of rows) if (r.n >= MIN_PUBLISH && Number.isFinite(r.median) && Number.isFinite(r.low) && Number.isFinite(r.high)) byItem.set(r.item, r);
  const items = [...byItem.keys()]
    .filter((i) => i.split("/")[0] in FUEL_LABEL && (i.includes("/") ? i.endsWith("/served") : true))
    .sort((a, b) => fuelOrder(a) - fuelOrder(b));
  const out: Figure[] = [];
  for (const item of items) {
    const r = byItem.get(item)!;
    const [fuelKey, service] = item.split("/");
    const fuel = fuelKey as Fuel;
    const served = service === "served";
    const unit = fuel === "methane" ? "per kg" : "per litre";
    const hasPair = hasServed && (fuel === "diesel" || fuel === "petrol95" || fuel === "petrol98");
    const label = FUEL_LABEL[fuel] + (served ? " (attended service)" : hasPair ? " (self-service)" : "");
    const phrase = FUEL_PHRASE[fuel] + (served ? " with attended service" : hasPair ? " at self-service" : "");
    const confidence = confidenceLabel(r.n) as Figure["confidence"];
    // Pump prices are quoted to the thousandth of a euro, so always show three decimals.
    const medianText = moneyFixed(r.median, currency, 3);
    const rangeText = `${moneyFixed(r.low, currency, 3)} to ${moneyFixed(r.high, currency, 3)}`;
    const params: Record<string, string | number> = { country: spec.country, area: area.code, fuel };
    if (served) params.service = "served";
    out.push({
      id: item,
      label,
      question: `What does ${phrase} cost in ${area.label} today?`,
      phrase,
      answer:
        `${label} in ${area.label}: median ${medianText} ${unit} on ${longDate(date)}; typical range ${rangeText} (10th to 90th percentile) ` +
        `across ${int(r.n)} stations. Confidence: ${confidence}.`,
      n: r.n,
      median: r.median,
      low: r.low,
      high: r.high,
      currency,
      unit,
      confidence,
      medianText,
      rangeText,
      liveRestPath: area.kind === "country" ? null : rest(`/api/v1/${cat.restPath}`, params),
      mcpArgs: params,
    });
  }
  return out;
}

// ---------- home sales (Ireland: rolling 12-month window) ----------

const HOME_TYPES: { type: "any" | "second-hand" | "new"; label: string; noun: string }[] = [
  { type: "any", label: "Homes", noun: "homes" },
  { type: "second-hand", label: "Second-hand homes", noun: "second-hand homes" },
  { type: "new", label: "New homes", noun: "new homes" },
];
const HOME_MONTHS = 12;

function homeFigures(spec: PageSourceSpec, area: AreaInfo, rows: DayRow[], date: string, cat: CategoryFacts, currency: string): Figure[] {
  const out: Figure[] = [];
  for (const t of HOME_TYPES) {
    const r = [...rows].reverse().find((x) => x.item === `${t.type}:${HOME_MONTHS}m`);
    if (!r || r.n < MIN_PUBLISH || !Number.isFinite(r.median) || !Number.isFinite(r.low) || !Number.isFinite(r.high)) continue;
    // Where an area has no new-build sales, "any" and "second-hand" are the same records: show one figure, not two.
    const first = out[0];
    if (first && first.n === r.n && first.median === r.median && first.low === r.low && first.high === r.high) continue;
    const confidence = confidenceLabel(r.n) as Figure["confidence"];
    const medianText = fmtMoney(r.median, currency);
    const rangeText = `${fmtMoney(r.low, currency)} to ${fmtMoney(r.high, currency)}`;
    const params: Record<string, string | number> = { country: spec.country, months: HOME_MONTHS };
    if (area.kind !== "country") params.town = area.name; // "Cork", "Dublin" (the county), "Dublin 6"
    if (t.type !== "any") params.property_type = t.type;
    out.push({
      id: t.type,
      label: t.label,
      question: `What did ${t.noun} sell for in ${area.label}?`,
      phrase: t.noun,
      answer:
        `${t.label} in ${area.label} sold for a median of ${medianText} in the ${HOME_MONTHS} months to ${longDate(date)}; ` +
        `typical range ${rangeText} (10th to 90th percentile), from ${int(r.n)} recorded sales. Confidence: ${confidence}.`,
      n: r.n,
      median: r.median,
      low: r.low,
      high: r.high,
      currency,
      unit: "per home",
      confidence,
      medianText,
      rangeText,
      liveRestPath: rest(`/api/v1/${cat.restPath}`, params),
      mcpArgs: params,
      ...(t.type === "new"
        ? { caveat: "New homes are usually recorded without 13.5% VAT, so do not compare these prices with second-hand prices directly." }
        : {}),
    });
  }
  return out;
}

// ---------- page assembly ----------

const BASIS: Record<SourceInfo["price_type"], string> = {
  transaction: "Prices recorded in official records of completed sales. Asking prices are never used.",
  posted_pump_price: "Posted pump prices: what each filling station displays for a litre, as published in the official feed. They are not individual receipts.",
  posted_price: "Posted prices, as published by the official source. They are not individual receipts.",
  contract_price: "Contract prices, as published by the official source.",
  reimbursement_price: "Reimbursement prices set by the official source.",
};

function askText(page: { category: PageCategory; area: AreaInfo; headline: Figure }): string {
  const { category, area, headline } = page;
  if (category === "fuel") {
    return `Using the ProofPrice MCP server, what does ${headline.phrase} cost in ${area.label} today? Give the median, the typical range and the number of stations, and cite the source and licence.`;
  }
  return `Using the ProofPrice MCP server, what did homes sell for in ${area.label} over the last ${HOME_MONTHS} months? Give the median, the typical range and the number of sales, and cite the source and licence.`;
}

export function buildSourcePages(
  spec: PageSourceSpec,
  day: { date: string; rows: DayRow[] },
  ctx: { info: SourceInfo; category: CategoryFacts; currency?: string | null },
): BuildResult {
  const currency = ctx.currency || "EUR";
  const byArea = new Map<string, DayRow[]>();
  for (const r of day.rows) {
    const list = byArea.get(r.area);
    if (list) list.push(r);
    else byArea.set(r.area, [r]);
  }
  const skipped: BuildResult["skipped"] = [];
  const pages: AnswerPage[] = [];
  const countrySlug = spec.country.toLowerCase();
  const usedSlugs = new Set<string>();
  const codes = [...byArea.keys()].sort((a, b) => (a === NATIONAL_KEY ? -1 : b === NATIONAL_KEY ? 1 : a.localeCompare(b)));
  for (const code of codes) {
    const baseArea = areaFor(spec.sourceId, code);
    if (!baseArea) {
      skipped.push({ code, reason: "no-name" });
      continue;
    }
    const rows = byArea.get(code)!;
    const figures =
      spec.category === "fuel"
        ? fuelFigures(spec, baseArea, rows, day.date, ctx.category, currency)
        : homeFigures(spec, baseArea, rows, day.date, ctx.category, currency);
    if (!figures.length) {
      skipped.push({ code, reason: "too-few-records" });
      continue;
    }
    let slug = baseArea.slug;
    if (usedSlugs.has(slug)) slug = `${slug}-${code.toLowerCase()}`;
    usedSlugs.add(slug);
    const area: AreaInfo = { ...baseArea, slug };
    const headline = figures[0];
    const national = area.kind === "country";
    const i = ctx.info;
    const homes = spec.category === "home-sales";
    const h1 = homes ? `What did homes sell for in ${area.label}?` : `What does fuel cost in ${area.label} today?`;
    const sourceShort = shortPublisher(i.publisher);
    const description = homes
      ? `${headline.label} in ${area.label} sold for a median of ${headline.medianText} in the ${HOME_MONTHS} months to ${longDate(day.date)} ` +
        `(typical range ${headline.rangeText}, ${int(headline.n)} sales). Source: ${sourceShort}.`
      : `Median pump prices in ${area.label} on ${longDate(day.date)}: ` +
        figures
          .slice(0, 3)
          .map((f) => `${FUEL_PHRASE[f.id.split("/")[0] as Fuel] ?? f.label}${f.id.endsWith("/served") ? " (attended)" : ""} ${f.medianText} ${f.unit}`)
          .join(", ") +
        `. Posted prices from ${sourceShort}, not receipts.`;
    const page: AnswerPage = {
      path: `/prices/${countrySlug}/${spec.category}/${slug}`,
      sourceId: spec.sourceId,
      country: spec.country,
      countrySlug,
      countryName: countryName(spec.country),
      category: spec.category,
      categoryLabel: CATEGORY_LABEL[spec.category],
      area,
      national,
      h1,
      title: homes
        ? `Home prices in ${area.label}: median ${headline.medianText} (${HOME_MONTHS} months)`
        : `Fuel prices in ${area.label}, ${shortDate(day.date)}`,
      description,
      figures,
      asOf: day.date,
      period: homes ? { from: monthsBefore(day.date, HOME_MONTHS), to: day.date } : null,
      basis: BASIS[i.price_type] ?? "",
      mcpTool: ctx.category.tool,
      historyRestPath:
        ctx.category.hasHistory && spec.category === "fuel"
          ? rest(`/api/v1/${ctx.category.restPath}/history`, {
              country: spec.country,
              ...(national ? {} : { area: area.code }),
              fuel: headline.id.split("/")[0],
              days: 30,
            })
          : null,
      ask: "",
      source: {
        id: i.id,
        name: i.name,
        publisher: i.publisher,
        licence: i.licence,
        licence_url: i.licence_url,
        attribution: i.attribution,
        homepage: i.homepage,
        freshness: i.freshness,
        limits: i.limits,
        price_type: i.price_type,
      },
    };
    page.ask = askText({ category: spec.category, area, headline });
    pages.push(page);
  }
  // National page first, then A to Z by name.
  pages.sort((a, b) => (a.national === b.national ? a.area.name.localeCompare(b.area.name, "en") : a.national ? -1 : 1));
  return { pages, skipped };
}
