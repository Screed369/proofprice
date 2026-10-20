// Hong Kong wholesale fresh food: daily average reference wholesale prices from the Agriculture, Fisheries and Conservation Department (AFCD), via DATA.GOV.HK.
// Format checked 2026-10-20 from GitHub's servers (probe): GET https://www.afcd.gov.hk/english/agriculture/agr_fresh/files/Wholesale_Prices.csv
// = 200 text/csv, UTF-8, ~137 KB, bilingual. 18 columns: ENGLISH CATEGORY, FRESH FOOD CATEGORY, FOOD TYPE, PRICE (THIS MORNING), UNIT ("($ / Catty)" or "($ / Egg)"),
// INTAKE DATE, SOURCE OF SUPPLY (IF APPROPRIATE), PROVIDED BY, Last Revision Date (d/m/yyyy), each with a Chinese twin column. About 34 rows per day, several days per file.
// The header row is repeated inside the file, and PRICE can be "-" or "No supply today".

import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";

export const CSV_URL = "https://www.afcd.gov.hk/english/agriculture/agr_fresh/files/Wholesale_Prices.csv";
export const PAGE_URL = "https://data.gov.hk/en-data/dataset/hk-afcd-afcdlist-wholesale-prices";
export const TERMS_URL = "https://data.gov.hk/en/terms-and-conditions";
export const CATTY_KG = 0.6048;

export const INFO: SourceInfo = {
  id: "hk-afcd-wholesale",
  country: "HK (Hong Kong)",
  category: "wholesale-fresh-food (live pig, cattle and chicken, fish, eggs, vegetables)",
  name: "AFCD: average wholesale prices of major fresh food",
  publisher: "Agriculture, Fisheries and Conservation Department (AFCD), Government of the Hong Kong SAR, via DATA.GOV.HK",
  what_is_recorded:
    "For each day and food type, the average reference wholesale price that the AFCD reports from the slaughterhouses and the major wholesalers at the government wholesale markets, in Hong Kong dollars per catty (about 0.6 kg) or per egg.",
  price_type: "posted_price",
  freshness: "Daily on working days, published by the AFCD when necessary; each answer states the day its price applies to",
  licence: "DATA.GOV.HK Terms and Conditions of Use (free commercial and non-commercial reuse with attribution)",
  licence_url: TERMS_URL,
  attribution:
    "Source: Agriculture, Fisheries and Conservation Department (AFCD), HKSAR Government, via DATA.GOV.HK. Prices per kilogram are converted by ProofPrice from the published price per catty (1 catty = 0.6048 kg).",
  homepage: PAGE_URL,
  limits:
    "Reference wholesale prices reported by traders, not shop prices and not individual sales; the AFCD says they are averages and gives no number of records. " +
    "Posted, not paid prices. Only about 35 food types are covered. Government may withdraw or change the data.",
};

export const METHOD =
  "Hong Kong wholesale fresh food: the newest daily average reference wholesale price that the AFCD publishes for the food type (live pig, cattle and chicken, marine and freshwater fish, eggs, vegetables). " +
  "We pass on the published figure and its day, convert catties to kilograms, and add the previous days the file holds; it is a reference average reported by wholesalers, not a list of sales, so no range or sample size is calculated.";

// ---------- parsing ----------

export interface Row {
  date: string; // ISO, from Last Revision Date
  group: string; // FRESH FOOD CATEGORY
  food: string; // FOOD TYPE
  supply: string | null; // SOURCE OF SUPPLY, null when "-"
  price: number; // as published, HKD per catty or per egg
  perEgg: boolean;
  intake: string; // "Yesterday", "Last Week"...
  providedBy: string;
}

/** Split one CSV line, honouring double quotes. */
export function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** "1/10/2026" (d/m/yyyy) to "2026-10-01". Null when it is not a date. */
export function parseDmy(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Usable rows. Repeated header rows, "-" prices and "No supply today" are dropped. Throws SourceError when the layout has changed. */
export function parseCsv(text: string): Row[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const head = lines.length ? splitCsv(lines[0]) : [];
  if (head[2] !== "FRESH FOOD CATEGORY" || head[4] !== "FOOD TYPE" || !/^PRICE/.test(head[6] ?? "") || head[8] !== "UNIT" || !/^Last Revision Date/.test(head[16] ?? "")) {
    throw new SourceError("The AFCD changed the layout of its wholesale price file (expected FRESH FOOD CATEGORY, FOOD TYPE, PRICE, UNIT ... Last Revision Date); this source needs updating.");
  }
  const out: Row[] = [];
  for (const line of lines.slice(1)) {
    const c = splitCsv(line);
    if (c.length < 17) continue;
    const date = parseDmy(c[16]);
    const price = Number(c[6]);
    if (!/^Average Wholesale/i.test(c[0])) continue; // the file also holds 'Reference Farm Gate Price' rows (farm prices, not wholesale)
    if (!date || !c[4] || !c[6] || !Number.isFinite(price) || price <= 0) continue;
    const unit = c[8].toLowerCase();
    const perEgg = unit.includes("egg");
    if (!perEgg && !unit.includes("catty")) continue;
    out.push({
      date,
      group: c[2],
      food: c[4],
      supply: c[12] && c[12] !== "-" ? c[12] : null,
      price,
      perEgg,
      intake: c[10].replace(/[()]/g, ""),
      providedBy: c[14],
    });
  }
  if (!out.length) throw new SourceError("The AFCD wholesale price file had no usable prices; this source needs updating.");
  return out;
}

// ---------- matching ----------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const ALIASES: Record<string, string> = {
  pig: "live pig", pigs: "live pig", pork: "live pig", hog: "live pig", hogs: "live pig",
  cattle: "live cattle", cow: "live cattle", beef: "live cattle",
  chicken: "live chicken", chickens: "live chicken",
  egg: "egg", eggs: "egg",
  cabbage: "cabbage", tomatoes: "tomato", potatoes: "potato", spinach: "spinach", kale: "chinese kale", lettuce: "chinese lettuce",
  celery: "european celery", beans: "yard long bean", "long bean": "yard long bean", "green bean": "yard long bean",
  carp: "carp", croaker: "croaker", breams: "breams", bream: "breams", scad: "scads", mackerel: "mackerel", hairtail: "hairtail",
};

export interface Series { key: string; food: string; supply: string | null; group: string; rows: Row[] }

/** Group rows into one series per food type and source of supply, newest day first. */
export function seriesOf(rows: Row[]): Series[] {
  const m = new Map<string, Series>();
  for (const r of rows) {
    const k = `${r.food}\u0000${r.supply ?? ""}`;
    let s = m.get(k);
    if (!s) m.set(k, (s = { key: k, food: r.food, supply: r.supply, group: r.group, rows: [] }));
    s.rows.push(r);
  }
  for (const s of m.values()) s.rows.sort((a, b) => b.date.localeCompare(a.date));
  return [...m.values()];
}

const nameOf = (s: Series) => (s.supply ? `${s.food} (${s.supply})` : s.food);

/** Series matching the item asked for: exact name first, then every word contained in the food type or its category. */
export function matchSeries(all: Series[], asked: string): Series[] {
  const a0 = norm(asked);
  if (!a0) return [];
  const a = ALIASES[a0] ?? a0;
  const exact = all.filter((s) => norm(s.food) === a);
  if (exact.length) return exact;
  const words = a.split(" ");
  return all.filter((s) => {
    const hay = ` ${norm(s.food)} ${norm(s.group)} `;
    return words.every((w) => hay.includes(` ${w} `) || hay.includes(` ${w}s `) || hay.includes(w));
  });
}

export function itemHelp(all: Series[]): string {
  return [...new Set(all.map((s) => s.food.toLowerCase()))].join(", ");
}

// ---------- answer ----------

const r2 = (v: number) => Math.round(v * 100) / 100;

export function hkWholesaleFromRows(rows: Row[], input: { product?: string; baseUrl?: string }): PriceAnswer {
  const asked = (input.product ?? "").trim();
  if (!asked) throw new InputError("product is required, for example 'live pig', 'chicken', 'eggs', 'tomato' or 'grass carp'.");
  const all = seriesOf(rows);
  const found = matchSeries(all, asked).filter((s) => s.rows.length);
  const base = { source: INFO, query: { country: "HK", product: asked }, currency: "HKD", method: METHOD, baseUrl: input.baseUrl };
  if (!found.length) {
    return buildStatisticAnswer({
      ...base, value: null, measure: "average", unit: "per kg", period: { from: null, to: null }, reference_period: "", describe: () => "",
      extra: { note: `No Hong Kong wholesale price for '${asked}'. The AFCD file covers: ${itemHelp(all)}.` },
    });
  }
  // The series with the newest price first; ties keep file order.
  found.sort((a, b) => b.rows[0].date.localeCompare(a.rows[0].date));
  const best = found[0];
  const latest = best.rows[0];
  const perEgg = latest.perEgg;
  const conv = (v: number) => (perEgg ? v : r2(v / CATTY_KG));
  const unit = perEgg ? "per egg" : "per kg";
  const value = conv(latest.price);
  const name = nameOf(best);
  const recent = best.rows.slice(0, 7).map((r) => ({ date: r.date, price_hkd: conv(r.price), published_hkd_per_catty_or_egg: r.price }));
  const prev = best.rows[1];
  const change = prev ? Math.round(((latest.price - prev.price) / prev.price) * 1000) / 10 : null;
  const others = found.slice(1).map((s) => ({ item: nameOf(s), date: s.rows[0].date, price_hkd: conv(s.rows[0].price) }));
  return buildStatisticAnswer({
    ...base,
    query: { country: "HK", product: asked, item: name },
    value,
    measure: "average",
    unit,
    period: { from: latest.date, to: latest.date },
    reference_period: latest.date,
    describe: (x) => `Wholesale ${name.toLowerCase()} in Hong Kong: HK$${x} ${unit} (average reference price for ${latest.date}).`,
    note:
      "Reference wholesale price reported by wholesalers, not a shop price and not a paid price." +
      (perEgg ? "" : " Converted from HK$ per catty (1 catty = 0.6048 kg)."),
    extra: {
      item: name,
      food_category: latest.group,
      published_price: latest.price,
      published_unit: perEgg ? "HK$ per egg" : "HK$ per catty",
      reported_by: latest.providedBy,
      ...(latest.supply ? { source_of_supply: latest.supply } : {}),
      change_on_previous_published_day_percent: change,
      previous_published_day: prev?.date ?? null,
      recent_days: recent,
      other_matches: others,
      price_basis: "posted reference wholesale price",
    },
  });
}

export async function fetchCsv(url = CSV_URL, timeoutMs = 25000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, "", res.status);
    return await res.text();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export async function hkWholesale(
  input: { product?: string; baseUrl?: string },
  fetcher: () => Promise<string> = () => fetchCsv(),
): Promise<PriceAnswer> {
  if (!input.product?.trim()) throw new InputError("product is required, for example 'live pig', 'chicken', 'eggs', 'tomato' or 'grass carp'.");
  return hkWholesaleFromRows(parseCsv(await fetcher()), input);
}
