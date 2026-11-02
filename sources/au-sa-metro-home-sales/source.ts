// Adelaide (South Australia) house sales: median price by suburb, quarterly, from the SA Government's "Metro median house sales" dataset
// (Department for Housing and Urban Development via data.sa.gov.au, CC BY 4.0). Checked live 24 Oct 2026 (Q3 2026 file, 482 rows).
// One CKAN call finds the newest quarter's resource, one datastore_search reads its ~480 rows; no key.

import { fetchJson, InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { SA_SUBURBS } from "./suburbs";

export const INFO: SourceInfo = {
  id: "au-sa-metro-home-sales",
  country: "AU (Adelaide, South Australia)",
  category: "home sales (house prices by suburb)",
  name: "Metro median house sales (Adelaide, by suburb, quarterly)",
  publisher: "South Australian Government, Department for Housing and Urban Development (data.sa.gov.au)",
  what_is_recorded: "For each metropolitan Adelaide suburb: the number of house sales in the quarter and their median price, with the same quarter a year earlier.",
  price_type: "official_statistic",
  freshness: "Quarterly, published about two weeks after the quarter ends",
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0)",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution:
    "Metro median house sales, Department for Housing and Urban Development, Government of South Australia, via data.sa.gov.au, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).",
  homepage: "https://data.sa.gov.au/data/dataset/metro-median-house-sales",
  limits:
    "Houses only (no units or flats), metropolitan Adelaide only, by suburb (no postcode column). The publisher gives a median and a sales count, no price range. " +
    "A suburb with fewer than 5 sales in the quarter is withheld. A suburb that straddles two councils has one row per council; we answer with the council part that has most sales and say so.",
};

export const SITE = "https://data.sa.gov.au";
export const PACKAGE = "metro-median-house-sales";
export const MIN_SALES = 5;

export interface SaRow { council: string; suburb: string; sales: number | null; median: number | null; prevSales: number | null; prevMedian: number | null }
export interface SaTable { quarter: string; prevQuarter: string; rows: SaRow[] }

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

const SUBURB_SET = new Set(SA_SUBURBS.map(fold));

/** Names that are also well-known suburbs or towns in other states: only ours when the request also says SA, Adelaide or South Australia. */
const AMBIGUOUS = new Set(["campbelltown", "fitzroy", "st kilda", "brighton", "richmond", "hampton", "kensington", "mitcham", "malvern", "hawthorn", "windsor", "newton", "glenelg north", "grange", "mount barker", "kingston", "burnside", "prospect", "unley", "marion", "walkerville", "salisbury", "playford", "gawler", "elizabeth", "west beach", "henley beach", "torrens park"]);

function clean(raw: string): { name: string; hint: boolean } {
  const t = fold(raw);
  const hint = /\b(sa|south australia|adelaide|s a)\b/.test(t) && t !== "adelaide";
  const name = t.replace(/\b(south australia|adelaide|sa|s a)\s*$/, "").replace(/\b(south australia|adelaide|sa|s a)\s*$/, "").trim();
  return { name: name || t, hint };
}

/** True when this source should answer the request (a metropolitan Adelaide suburb). Plain "Adelaide" and "South Australia" stay with the ABS state figure. */
export function servesSuburb(town: string | undefined, postcode?: string): boolean {
  if (!town || postcode) return false;
  const { name, hint } = clean(town);
  if (!SUBURB_SET.has(name)) return false;
  if (name === "adelaide") return /\b(city|cbd|suburb)\b/.test(fold(town));
  return hint || !AMBIGUOUS.has(name);
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Newest quarter's resource from CKAN package_show: names look like "Metropolitan Median House Sales Q3 2026". */
export function pickLatestResource(pkg: any): { id: string; quarter: string } {
  const list = pkg?.result?.resources;
  if (!pkg?.success || !Array.isArray(list)) throw new SourceError("Unexpected response from data.sa.gov.au (package_show)");
  let best: { id: string; q: number; y: number } | null = null;
  for (const r of list) {
    const m = /Median House Sales Q([1-4]) (\d{4})/i.exec(String(r?.name ?? ""));
    if (!m || !r.id || r.datastore_active === false) continue;
    const q = Number(m[1]), y = Number(m[2]);
    if (!best || y * 10 + q > best.y * 10 + best.q) best = { id: String(r.id), q, y };
  }
  if (!best) throw new SourceError("No quarterly file found in the South Australian dataset");
  return { id: best.id, quarter: `${best.y}-Q${best.q}` };
}

/** The newest `count` quarterly resources (newest first) that have a datastore: used to look back when a suburb is thin in the latest quarter. */
export function pickRecentResources(pkg: any, count: number): { id: string; quarter: string }[] {
  const list = pkg?.result?.resources;
  if (!pkg?.success || !Array.isArray(list)) throw new SourceError("Unexpected response from data.sa.gov.au (package_show)");
  const out: { id: string; q: number; y: number }[] = [];
  for (const r of list) {
    const m = /Median House Sales Q([1-4]) (\d{4})/i.exec(String(r?.name ?? ""));
    if (!m || !r.id || r.datastore_active === false) continue;
    out.push({ id: String(r.id), q: Number(m[1]), y: Number(m[2]) });
  }
  out.sort((a, b) => b.y * 10 + b.q - (a.y * 10 + a.q));
  return out.slice(0, count).map((r) => ({ id: r.id, quarter: `${r.y}-Q${r.q}` }));
}

/** Rows of one quarterly file; the columns are named "Sales 3Q 2026", "Median 3Q 2026" and the year before. Values are text, null when no sales. */
export function parseTable(json: any): SaTable {
  const recs = json?.result?.records;
  if (!json?.success || !Array.isArray(recs) || !recs.length) throw new SourceError("Unexpected response from data.sa.gov.au (datastore_search)");
  const keys = Object.keys(recs[0]).map((k) => /^Sales (\d)Q (\d{4})$/.exec(k)).filter(Boolean) as RegExpExecArray[];
  if (keys.length < 2) throw new SourceError("The South Australian file has no 'Sales nQ yyyy' columns (format changed)");
  keys.sort((a, b) => Number(b[2]) - Number(a[2]));
  const cur = keys[0], prev = keys[keys.length - 1];
  const rows: SaRow[] = recs.map((r: any) => ({
    council: String(r.City ?? "").trim(),
    suburb: String(r.Suburb ?? "").trim(),
    sales: num(r[`Sales ${cur[1]}Q ${cur[2]}`]),
    median: num(r[`Median ${cur[1]}Q ${cur[2]}`]),
    prevSales: num(r[`Sales ${prev[1]}Q ${prev[2]}`]),
    prevMedian: num(r[`Median ${prev[1]}Q ${prev[2]}`]),
  })).filter((r: SaRow) => r.suburb);
  return { quarter: `${cur[2]}-Q${cur[1]}`, prevQuarter: `${prev[2]}-Q${prev[1]}`, rows };
}

export function quarterBounds(q: string): { from: string; to: string } {
  const m = /^(\d{4})-Q([1-4])$/.exec(q)!;
  const y = Number(m[1]), n = Number(m[2]);
  const endDay = [31, 30, 30, 31][n - 1];
  const p = (x: number) => String(x).padStart(2, "0");
  return { from: `${y}-${p(n * 3 - 2)}-01`, to: `${y}-${p(n * 3)}-${p(endDay)}` };
}

const title = (s: string) => s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, a, b) => a + b.toUpperCase()).replace(/\bAnd\b/g, "and").replace(/\bSt\b/g, "St");

const enoughSales = (r: SaRow) => r.sales !== null && r.sales >= MIN_SALES && r.median !== null && r.median > 0;
const bestPart = (parts: SaRow[]) => [...parts].sort((a, b) => (b.sales ?? -1) - (a.sales ?? -1))[0];

/** `earlier` = the quarters before `latest`, newest first. A suburb with fewer than 5 sales in the latest quarter is answered from the newest
 *  earlier quarter in which it had 5 or more, and the answer says which quarter that is (medians of different quarters are never pooled). */
export function answerFor(latest: SaTable, townRaw: string, baseUrl?: string, earlier: SaTable[] = []): PriceAnswer {
  const { name } = clean(townRaw);
  const partsOf = (t: SaTable) => t.rows.filter((r) => fold(r.suburb) === name);
  let table = latest;
  let parts = partsOf(latest);
  if (!parts.length) {
    throw new InputError(`"${townRaw.trim()}" is not a metropolitan Adelaide suburb in the South Australian file. Give a suburb such as Norwood, Glenelg, Marion or Prospect.`);
  }
  let best = bestPart(parts);
  let lookedBack: { latest_quarter: string; latest_sales: number | null } | null = null;
  if (!enoughSales(best)) {
    for (const t of earlier) {
      const p = partsOf(t);
      if (p.length && enoughSales(bestPart(p))) {
        lookedBack = { latest_quarter: latest.quarter, latest_sales: best.sales };
        table = t;
        parts = p;
        best = bestPart(p);
        break;
      }
    }
  }
  const b = quarterBounds(table.quarter);
  const place = title(best.suburb);
  const enough = best.sales !== null && best.sales >= MIN_SALES && best.median !== null && best.median > 0;
  const split = parts.length > 1;
  const extra: Record<string, unknown> = {
    ...(lookedBack ? { looked_back_from: lookedBack } : {}),
    suburb: place,
    council: title(best.council),
    quarter: table.quarter,
    previous_year: { quarter: table.prevQuarter, sales: best.prevSales, median: best.prevMedian },
    property_type: "house",
  };
  if (split) extra.other_council_parts = parts.filter((p) => p !== best).map((p) => ({ council: title(p.council), sales: p.sales }));
  if (!enough) extra.withheld = best.sales === null ? "no house sales recorded in the quarter" : `only ${best.sales} house sales in the quarter (minimum ${MIN_SALES})`;
  const yoy =
    enough && best.prevMedian && best.prevSales !== null && best.prevSales >= MIN_SALES
      ? ` A year earlier (${table.prevQuarter}) it was ${fmtMoney(best.prevMedian, "AUD")} from ${best.prevSales} sales.`
      : "";
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "AU", town: place, property_type: "house" },
    value: enough ? best.median : null,
    measure: "median",
    currency: "AUD",
    unit: "per house",
    period: b,
    reference_period: table.quarter,
    sample_size: enough ? best.sales : null,
    method:
      "The South Australian Government publishes, for each metropolitan Adelaide suburb and quarter, the number of house sales and their median price. We pass the published median on unchanged, with the sales count as sample size; a suburb with fewer than 5 sales is withheld.",
    describe: (v) =>
      (lookedBack ? `${place} had only ${lookedBack.latest_sales ?? 0} house sales in ${lookedBack.latest_quarter} (minimum ${MIN_SALES} to publish), so this is the newest of the last four quarters with enough sales. ` : "") +
      `Houses in ${place}${split ? ` (${title(best.council)} council part)` : ""}, Adelaide, sold for a median of ${fmtMoney(v, "AUD")} in ${table.quarter} (${best.sales} sales).${yoy}`,
    note: [
      lookedBack ? `${place} had ${lookedBack.latest_sales ?? 0} house sales in ${lookedBack.latest_quarter}, too few to publish a median (minimum ${MIN_SALES}); this is the newest of the last four quarters with ${MIN_SALES} or more sales (${table.quarter}).` : "",
      split ? `${place} lies in more than one council area; this is the part with most sales (${title(best.council)}).` : "",
    ].filter(Boolean).join(" ") || undefined,
    baseUrl,
    extra,
    ending: "Median of house sales published by the South Australian Government (Department for Housing and Urban Development). Houses only, not units.",
  });
}

export async function saHomeSales(input: { town?: string; postcode?: string; baseUrl?: string }, fetch: (u: string) => Promise<any> = (u) => fetchJson(u, {}, 15000)): Promise<PriceAnswer> {
  if (!input.town?.trim()) {
    throw new InputError(
      input.postcode
        ? "This source is by suburb, not postcode. Give an Adelaide suburb name, e.g. town=Norwood."
        : "Give an Adelaide suburb in 'town', e.g. town=Norwood, Glenelg, Marion or Prospect.",
    );
  }
  const pkg = await fetch(`${SITE}/data/api/3/action/package_show?id=${PACKAGE}`);
  const res = pickLatestResource(pkg);
  const data = await fetch(`${SITE}/data/api/3/action/datastore_search?resource_id=${res.id}&limit=1000`);
  const latest = parseTable(data);
  // Thin suburb in the newest quarter: look back (at most 3 earlier quarters, one call each, stopping at the first with 5+ sales).
  const { name } = clean(input.town);
  const mine = latest.rows.filter((r) => fold(r.suburb) === name);
  if (mine.length && !enoughSales(bestPart(mine))) {
    const earlier: SaTable[] = [];
    for (const r of pickRecentResources(pkg, 4).filter((x) => x.quarter !== res.quarter)) {
      try {
        earlier.push(parseTable(await fetch(`${SITE}/data/api/3/action/datastore_search?resource_id=${r.id}&limit=1000`)));
      } catch {
        break; // an older file that will not load: answer with what we have
      }
      const p = earlier[earlier.length - 1].rows.filter((x) => fold(x.suburb) === name);
      if (p.length && enoughSales(bestPart(p))) break;
    }
    return answerFor(latest, input.town, input.baseUrl, earlier);
  }
  return answerFor(latest, input.town, input.baseUrl);
}

// ---------- daily collector and history ----------

/** Library area for a suburb: the folded name, e.g. "norwood". */
export const suburbArea = (name: string) => fold(name);

/** One library row per suburb for the newest quarter: the council part with most sales, only when it has 5 or more sales. The publisher gives a
 *  median and a count, no range, so low/high/min/max repeat the median (the same convention as the Adelaide rents source). */
export function harvestRows(table: SaTable): DailyRow[] {
  const bySuburb = new Map<string, SaRow[]>();
  for (const r of table.rows) bySuburb.set(fold(r.suburb), [...(bySuburb.get(fold(r.suburb)) ?? []), r]);
  const out: DailyRow[] = [];
  for (const [area, parts] of bySuburb) {
    const b = bestPart(parts);
    if (!enoughSales(b)) continue;
    out.push({ area, item: "house", n: b.sales as number, median: b.median as number, low: b.median as number, high: b.median as number, min: b.median as number, max: b.median as number });
  }
  return out;
}

export async function saHarvest(fetch: (u: string) => Promise<any> = (u) => fetchJson(u, {}, 20000)): Promise<HarvestResult> {
  const pkg = await fetch(`${SITE}/data/api/3/action/package_show?id=${PACKAGE}`);
  const res = pickLatestResource(pkg);
  const table = parseTable(await fetch(`${SITE}/data/api/3/action/datastore_search?resource_id=${res.id}&limit=1000`));
  if (table.quarter !== res.quarter) throw new SourceError(`The newest South Australian file is ${res.quarter} but its columns say ${table.quarter}; this source needs updating.`);
  const rows = harvestRows(table);
  if (rows.length < 50) throw new SourceError(`Only ${rows.length} Adelaide suburbs had 5 or more house sales in ${table.quarter}; the file may have changed.`);
  return {
    date: quarterBounds(table.quarter).to,
    currency: "AUD",
    unit: "per house",
    rows,
    note: `Median house sale price by metropolitan Adelaide suburb in ${table.quarter}; n is the number of house sales (suburbs with fewer than ${MIN_SALES} sales are left out; a suburb in two councils uses the part with most sales).`,
  };
}

/** Library keys for a request, or null when it is not an Adelaide suburb. */
export function saHistoryKey(p: { town?: string; postcode?: string }): { area: string; item: string; label: string } | null {
  if (!servesSuburb(p.town, p.postcode)) return null;
  const { name } = clean(p.town as string);
  return { area: suburbArea(name), item: "house", label: `${title(name)}, Adelaide (houses)` };
}
