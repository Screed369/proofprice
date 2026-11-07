// Japan: MAFF (Ministry of Agriculture, Forestry and Fisheries) monthly "negotiated trade prices" for rice (相対取引価格・数量):
// the price at which rice-collecting organisations (JA and others) sell rice to wholesalers, by prefecture and variety, per 60 kg of
// brown rice, tax included, with the volume traded. One CSV per month, file names change every month, so the page that lists them
// is read first and the newest "相対取引価格・数量（令和Y年M月）" CSV is taken. Formats checked live on 2026-11-07 (see fixtures.ts).
// Official statistic (no record count): the volume is in tonnes, not a number of sales, so every answer is an official statistic.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const PAGE_URL = "https://www.maff.go.jp/j/seisan/keikaku/soukatu/aitaikakaku.html";
const UA = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";
const NATIONAL_ROW = "全銘柄平均価格、合計数量";
export const UNIT = "per 60 kg of brown rice (tax included)";

export const INFO: SourceInfo = {
  id: "jp-maff-rice",
  country: "JP (Japan)",
  category: "farm-gate prices (rice: negotiated trade prices between collectors and wholesalers, monthly)",
  name: "Rice negotiated trade prices and volumes (MAFF, 米の相対取引価格・数量)",
  publisher: "Ministry of Agriculture, Forestry and Fisheries of Japan (農林水産省, MAFF)",
  what_is_recorded:
    "Each month, for every rice-producing prefecture and main variety, the volume-weighted average price at which rice-collecting organisations (JA and other shippers) sold the new crop to wholesalers, " +
    "per 60 kg of brown rice, consumption tax included, with the volume traded in tonnes, the crop-year average so far and the same month a year earlier. Plus an all-brand national average.",
  price_type: "official_statistic",
  freshness:
    "Monthly, not live: MAFF publishes each month's preliminary (速報) figures in the following weeks; every answer states its month. Early in a crop year (September, October) only part of the varieties have a price yet.",
  licence: "Public Data License 1.0 (PDL1.0), credit MAFF, changes must be stated (MAFF site terms)",
  licence_url: "https://www.maff.go.jp/j/use/link.html",
  attribution:
    "Source: Ministry of Agriculture, Forestry and Fisheries of Japan, 米の相対取引価格・数量 (rice negotiated trade prices and volumes), used under the Public Data License 1.0. Averages by prefecture or variety are calculated by ProofPrice from the published figures.",
  homepage: PAGE_URL,
  limits:
    "A published monthly average price for rice sold by collecting organisations to wholesalers (a wholesale contract price, not a farm-gate price paid to one farmer, and not a shop price). " +
    "Per 60 kg of brown rice, tax included, yen. The figures are preliminary (速報) and revised later. The traded volume is in tonnes, not a count of sales, so there is no sample size and no price range. " +
    "Prefecture and variety figures are MAFF's own where the row exists; a prefecture total or a variety total is calculated by ProofPrice as the volume-weighted average of the published rows. Varieties with no price yet in the month are not shown.",
};

// ---------- names ----------

/** Prefectures in the file (Japanese name without 都/道/府/県) -> English. Tokyo, Okinawa and a few others are not in the file. */
export const PREFECTURES: Record<string, string> = {
  北海道: "Hokkaido", 青森: "Aomori", 岩手: "Iwate", 宮城: "Miyagi", 秋田: "Akita", 山形: "Yamagata", 福島: "Fukushima", 茨城: "Ibaraki", 栃木: "Tochigi",
  群馬: "Gunma", 埼玉: "Saitama", 千葉: "Chiba", 東京: "Tokyo", 神奈川: "Kanagawa", 新潟: "Niigata", 富山: "Toyama", 石川: "Ishikawa", 福井: "Fukui",
  山梨: "Yamanashi", 長野: "Nagano", 岐阜: "Gifu", 静岡: "Shizuoka", 愛知: "Aichi", 三重: "Mie", 滋賀: "Shiga", 京都: "Kyoto", 大阪: "Osaka",
  兵庫: "Hyogo", 奈良: "Nara", 和歌山: "Wakayama", 鳥取: "Tottori", 島根: "Shimane", 岡山: "Okayama", 広島: "Hiroshima", 山口: "Yamaguchi",
  徳島: "Tokushima", 香川: "Kagawa", 愛媛: "Ehime", 高知: "Kochi", 福岡: "Fukuoka", 佐賀: "Saga", 長崎: "Nagasaki", 熊本: "Kumamoto", 大分: "Oita",
  宮崎: "Miyazaki", 鹿児島: "Kagoshima", 沖縄: "Okinawa",
};

/** English words for the main varieties (lower case, no spaces) -> the name in the file. Other varieties are asked for by their Japanese name. */
export const VARIETIES: Record<string, string> = {
  koshihikari: "コシヒカリ", akitakomachi: "あきたこまち", hitomebore: "ひとめぼれ", hinohikari: "ヒノヒカリ", nanatsuboshi: "ななつぼし", yumepirika: "ゆめぴりか",
  tsuyahime: "つや姫", kinuhikari: "キヌヒカリ", sasanishiki: "ササニシキ", haenuki: "はえぬき", masshigura: "まっしぐら", kirara397: "きらら３９７",
  mizukagami: "みずかがみ", kinumusume: "きぬむすめ", ginganoshizuku: "銀河のしずく", yumemizuho: "ゆめみづほ", nikomaru: "にこまる", sagabiyori: "さがびより",
  morinokumasan: "森のくまさん", genkitsukushi: "元気つくし", yumetsukushi: "夢つくし", tentonotsubu: "天のつぶ", akisakari: "あきさかり", koshiibuki: "こしいぶき",
  fukufukumaru: "富富富", saikaruranokagayaki: "彩のかがやき", saikinokizuna: "彩のきずな", yukiwakamaru: "雪若丸", asahinoyume: "あさひの夢", tochiginohoshi: "とちぎの星",
  hanaechizen: "ハナエチゼン", hatsushimo: "ハツシモ", akebono: "アケボノ", hyakumangoku: "ひゃくまん穀", himenorin: "ひめの凜", hinatamaru: "ひなたまる",
  fusaotome: "ふさおとめ", fusakogane: "ふさこがね", akihoranamo: "あきほなみ",
};
const EXAMPLE_VARIETIES = ["Koshihikari", "Akitakomachi", "Hitomebore", "Hinohikari", "Nanatsuboshi", "Yumepirika", "Tsuyahime", "Sasanishiki", "Haenuki"];
export const exampleVarieties = (): string => EXAMPLE_VARIETIES.map((v) => `'${v.toLowerCase()}'`).join(", ");

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9぀-ヿ㐀-鿿]/g, "");
const PREF_BY_WORD = new Map<string, string>();
for (const [ja, en] of Object.entries(PREFECTURES)) {
  PREF_BY_WORD.set(norm(en), ja);
  PREF_BY_WORD.set(norm(ja), ja);
  for (const suf of ["都", "道", "府", "県"]) PREF_BY_WORD.set(norm(ja + suf), ja);
  for (const suf of ["prefecture", "ken", "to", "fu"]) PREF_BY_WORD.set(norm(en + suf), ja);
}
const VARIETY_BY_WORD = new Map<string, string>();
for (const [en, ja] of Object.entries(VARIETIES)) VARIETY_BY_WORD.set(norm(en), ja);

export function prefectureOf(region: string | undefined): string | null {
  const w = norm(region ?? "");
  if (!w) return null;
  const hit = PREF_BY_WORD.get(w);
  if (hit) return hit;
  throw new InputError(`Give a Japanese prefecture as region, e.g. 'Niigata', 'Akita', 'Hokkaido', 'Kumamoto' or 新潟. '${region}' is not one. Leave region out for the national figure.`);
}

export interface Wanted {
  /** The variety as the file names it, or null for all brands. */
  variety: string | null;
}
/** "rice", "japanese rice", "koshihikari rice", "コシヒカリ" -> variety. Anything else is an input error. */
export function varietyOf(product: string): Wanted {
  const rest = product.toLowerCase().replace(/\b(japanese|brown|white|japonica|rice|price|prices|the|of)\b/g, " ").trim();
  const w = norm(rest);
  if (!w || /^(kome|米|こめ|japan|all|any)$/.test(w) || w === "米") return { variety: null };
  const hit = VARIETY_BY_WORD.get(w);
  if (hit) return { variety: hit };
  if (/[぀-ヿ㐀-鿿]/.test(w)) return { variety: product.replace(/米|\s/g, "") || null };
  throw new InputError(`Give 'rice' or a Japanese rice variety as product, e.g. ${exampleVarieties()}, or the Japanese name (コシヒカリ). '${product}' is not one MAFF lists.`);
}

// ---------- parsing ----------

export interface MonthRef {
  year: number; // Gregorian
  month: number; // 1-12
}
export interface RiceRow {
  prefecture: string; // Japanese name, or NATIONAL_ROW
  variety: string; // "" for the national row
  price: number | null; // yen per 60 kg, this month
  volume: number | null; // tonnes, this month
  lastYearPrice: number | null; // same month a year earlier
  lastYearVolume: number | null;
}
export interface RiceTable {
  month: MonthRef;
  rows: RiceRow[];
}

export const monthKey = (m: MonthRef): string => `${m.year}-${String(m.month).padStart(2, "0")}`;
const reiwa = (n: number): number => 2018 + n;

/** The newest monthly CSV listed on MAFF's page: <li> entries "…相対取引価格・数量（令和Y年M月）…" with a CSV link. */
export function newestCsv(html: string, pageUrl = PAGE_URL): { url: string; month: MonthRef } {
  let best: { url: string; month: MonthRef } | null = null;
  for (const li of html.match(/<li>[\s\S]*?<\/li>/g) ?? []) {
    const m = /相対取引価格・数量（令和(\d+)年(\d+)月）/.exec(li);
    const href = /href="([^"]*aitaikakaku-\d+\.csv)"/.exec(li);
    if (!m || !href) continue;
    const month = { year: reiwa(Number(m[1])), month: Number(m[2]) };
    if (!best || monthKey(month) > monthKey(best.month)) best = { url: new URL(href[1], pageUrl).toString(), month };
  }
  if (!best) throw new SourceError("MAFF's rice price page lists no monthly negotiated-price CSV (the page layout may have changed)");
  return best;
}

/** Quoted CSV with "18,702" style numbers. */
export function csvRows(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x !== "")) out.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some((x) => x !== "")) out.push(row); }
  return out;
}

const toNum = (s: string | undefined): number | null => {
  const t = (s ?? "").replace(/[,\s]/g, "");
  if (!t || t === "-" || t === "－" || t === "…" || t === "x") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Columns are found by their header words (月_価格 / 月_数量), twice each: this month, then the same month a year earlier. */
export function parseRiceCsv(text: string): RiceTable {
  const all = csvRows(text);
  const head = all[0] ?? [];
  const priceCols = head.map((h, i) => (/^\d+年\d+月_価格/.test(h) ? i : -1)).filter((i) => i >= 0);
  const volCols = head.map((h, i) => (/^\d+年\d+月_数量/.test(h) ? i : -1)).filter((i) => i >= 0);
  const mh = /^(\d+)年(\d+)月_価格/.exec(head[priceCols[0]] ?? "");
  if (head[0] !== "産地" || priceCols.length < 1 || volCols.length < 1 || !mh) {
    throw new SourceError("MAFF's rice price CSV has an unexpected header (expected 産地, 品種銘柄, N年M月_価格…)");
  }
  const rows: RiceRow[] = [];
  for (const r of all.slice(1)) {
    const prefecture = (r[0] ?? "").trim();
    if (!prefecture) continue;
    rows.push({
      prefecture,
      variety: (r[1] ?? "").trim(),
      price: toNum(r[priceCols[0]]),
      volume: toNum(r[volCols[0]]),
      lastYearPrice: priceCols[1] !== undefined ? toNum(r[priceCols[1]]) : null,
      lastYearVolume: volCols[1] !== undefined ? toNum(r[volCols[1]]) : null,
    });
  }
  if (!rows.some((r) => r.prefecture === NATIONAL_ROW)) throw new SourceError("MAFF's rice price CSV has no all-brand national row");
  return { month: { year: reiwa(Number(mh[1])), month: Number(mh[2]) }, rows };
}

// ---------- the figure ----------

export interface Figure {
  price: number;
  volume: number | null;
  lastYearPrice: number | null;
  min: number | null;
  max: number | null;
  /** How the figure was formed. */
  basis: "published" | "weighted";
  rowsUsed: number;
}

function weighted(rows: RiceRow[]): Figure | null {
  const priced = rows.filter((r) => r.price !== null && r.price > 0 && r.volume !== null && r.volume > 0);
  if (!priced.length) return null;
  const vol = priced.reduce((a, r) => a + (r.volume as number), 0);
  const price = priced.reduce((a, r) => a + (r.price as number) * (r.volume as number), 0) / vol;
  const ly = priced.filter((r) => r.lastYearPrice !== null && r.lastYearVolume !== null && (r.lastYearVolume as number) > 0);
  const lyVol = ly.reduce((a, r) => a + (r.lastYearVolume as number), 0);
  const lastYearPrice = ly.length ? ly.reduce((a, r) => a + (r.lastYearPrice as number) * (r.lastYearVolume as number), 0) / lyVol : null;
  const prices = priced.map((r) => r.price as number);
  return { price: Math.round(price), volume: vol, lastYearPrice: lastYearPrice === null ? null : Math.round(lastYearPrice), min: Math.min(...prices), max: Math.max(...prices), basis: "weighted", rowsUsed: priced.length };
}

/** Pick the figure for a request. prefecture is the Japanese name or null; variety the file's name or null. */
export function figureFor(table: RiceTable, prefecture: string | null, variety: string | null): Figure | null {
  if (!prefecture && !variety) {
    const n = table.rows.find((r) => r.prefecture === NATIONAL_ROW);
    if (!n || n.price === null) return null;
    return { price: n.price, volume: n.volume, lastYearPrice: n.lastYearPrice, min: null, max: null, basis: "published", rowsUsed: 1 };
  }
  const rows = table.rows.filter((r) => r.prefecture !== NATIONAL_ROW && (!prefecture || r.prefecture === prefecture) && (!variety || r.variety === variety || r.variety.startsWith(`${variety}（`)));
  // コシヒカリ in Niigata is published as sub-regions (一般, 魚沼...): several rows are weighted, a single row is returned as published.
  const f = weighted(rows);
  if (f && rows.length === 1) return { ...f, basis: "published", min: null, max: null };
  return f;
}

// ---------- fetching ----------

async function getText(url: string): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,text/csv,*/*" }, signal: ctl.signal, redirect: "follow" });
    if (!res.ok) throw new SourceError(`MAFF answered HTTP ${res.status} for ${new URL(url).pathname}`);
    return await res.text();
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError(`Could not reach MAFF (${(e as Error)?.name === "AbortError" ? "timed out" : (e as Error)?.message ?? "network error"})`);
  } finally {
    clearTimeout(timer);
  }
}

let cache: { at: number; table: RiceTable; url: string } | null = null;
const CACHE_MS = 6 * 3600 * 1000;

export async function loadLatest(get: (url: string) => Promise<string> = getText, now = Date.now()): Promise<{ table: RiceTable; url: string }> {
  if (get === getText && cache && now - cache.at < CACHE_MS) return cache;
  const page = await get(PAGE_URL);
  const { url, month } = newestCsv(page);
  const table = parseRiceCsv(await get(url));
  if (monthKey(table.month) !== monthKey(month)) throw new SourceError(`MAFF's file ${new URL(url).pathname} is for ${monthKey(table.month)}, the page says ${monthKey(month)}`);
  const out = { at: now, table, url };
  if (get === getText) cache = out;
  return out;
}

// ---------- the answer ----------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthWords = (m: MonthRef): string => `${MONTHS[m.month - 1]} ${m.year}`;
const lastDay = (m: MonthRef): string => `${monthKey(m)}-${String(new Date(Date.UTC(m.year, m.month, 0)).getUTCDate()).padStart(2, "0")}`;
const yen = (v: number): string => `¥${Math.round(v).toLocaleString("en-US")}`;

export const jpRiceMethod =
  "Japan (rice): the average price at which collecting organisations sold rice to wholesalers in the month, from MAFF's monthly negotiated-trade-price table (米の相対取引価格・数量), per 60 kg of brown rice, tax included. " +
  "A prefecture or variety row is MAFF's own figure; where several rows apply (a prefecture's varieties, or a variety across prefectures) we take the volume-weighted average of the published rows and give the cheapest and dearest. " +
  "Preliminary figures, no count of sales, no price range.";

export function answerFrom(
  table: RiceTable,
  req: { product: string; region?: string },
  baseUrl?: string,
): PriceAnswer {
  const prefecture = prefectureOf(req.region);
  const { variety } = varietyOf(req.product);
  const f = figureFor(table, prefecture, variety);
  const where = prefecture ? PREFECTURES[prefecture] ?? prefecture : "Japan (national)";
  const what = variety ? `${Object.entries(VARIETIES).find(([, ja]) => ja === variety)?.[0] ?? variety} rice` : "rice (all brands)";
  const label = `${what}, ${where}`;
  const query = { country: "JP", product: req.product, ...(req.region ? { region: req.region } : {}) };
  const m = table.month;
  const ref = monthKey(m);
  const yoy = f && f.lastYearPrice ? Math.round(((f.price - f.lastYearPrice) / f.lastYearPrice) * 100) : null;
  return buildStatisticAnswer({
    source: INFO,
    query,
    value: f ? f.price : null,
    measure: "average",
    currency: "JPY",
    unit: UNIT,
    period: { from: `${ref}-01`, to: lastDay(m) },
    reference_period: ref,
    sample_size: null,
    min: f?.basis === "weighted" ? f.min : null,
    max: f?.basis === "weighted" ? f.max : null,
    method: jpRiceMethod,
    describe: (v) =>
      `Rice negotiated trade price, ${label}, ${monthWords(m)}: about ${yen(v)} ${UNIT} (MAFF, preliminary)` +
      (f?.lastYearPrice ? `; a year earlier ${yen(f.lastYearPrice)}${yoy !== null ? ` (${yoy > 0 ? "+" : ""}${yoy}%)` : ""}` : "") +
      (f?.volume ? `; ${Math.round(f.volume).toLocaleString("en-US")} tonnes traded.` : "."),
    note:
      "Wholesale contract price between collecting organisations and wholesalers, not a shop price and not what one farmer received. New-crop varieties appear as they start trading, so early in the crop year (September to November) the national figure covers only part of the harvest.",
    baseUrl,
    extra: {
      item: label,
      volume_tonnes: f?.volume ?? null,
      same_month_year_earlier: f?.lastYearPrice ?? null,
      change_vs_year_earlier_percent: yoy,
      basis: f?.basis ?? null,
      rows_used: f?.rowsUsed ?? 0,
      month: ref,
    },
  });
}

export async function jpRicePrices(req: { product: string; region?: string; baseUrl?: string }, get?: (url: string) => Promise<string>): Promise<PriceAnswer> {
  // Check the request before any download, so a typo costs nothing.
  prefectureOf(req.region);
  varietyOf(req.product);
  const { table } = await loadLatest(get);
  return answerFrom(table, req, req.baseUrl);
}

// ---------- daily collector ----------

export const riceItem = (variety: string | null): string => {
  if (!variety) return "rice";
  const en = Object.entries(VARIETIES).find(([, ja]) => ja === variety)?.[0];
  return `rice/${en ?? variety}`;
};

export function riceHarvestRows(table: RiceTable): HarvestResult {
  const rows: HarvestResult["rows"] = [];
  const push = (area: string, item: string, v: number) => rows.push({ area, item, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });
  const nat = figureFor(table, null, null);
  if (nat) push("ALL", "rice", nat.price);
  const prefs = [...new Set(table.rows.map((r) => r.prefecture))].filter((p) => p !== NATIONAL_ROW);
  for (const p of prefs) {
    const en = PREFECTURES[p];
    if (!en) continue;
    const total = figureFor(table, p, null);
    if (total) push(en, "rice", total.price);
    const names = [...new Set(table.rows.filter((r) => r.prefecture === p).map((r) => r.variety))];
    for (const v of [...new Set([...names, ...names.map((x) => x.replace(/（.*）$/, ""))])]) {
      const f = figureFor(table, p, v);
      if (f) push(en, riceItem(v), f.price);
    }
  }
  if (!rows.length) throw new SourceError("MAFF's rice price file holds no usable price");
  return {
    date: lastDay(table.month),
    currency: "JPY",
    unit: UNIT,
    rows,
    note: `MAFF negotiated trade prices for rice, ${monthWords(table.month)} (preliminary): published monthly averages by prefecture and variety, no count of sales.`,
  };
}

export async function jpRiceHarvest(get?: (url: string) => Promise<string>): Promise<HarvestResult> {
  const { table } = await loadLatest(get);
  return riceHarvestRows(table);
}

/** Where a request lives in the library, so /history and the stale-if-error copy can answer without asking MAFF. */
export function riceHistoryKey(p: { product?: string; region?: string }): { area: string; item: string; label: string } | null {
  try {
    const pref = prefectureOf(p.region);
    const { variety } = varietyOf(p.product ?? "rice");
    const area = pref ? PREFECTURES[pref] : "ALL";
    if (!area) return null;
    if (!pref && variety) return null; // a variety across prefectures is calculated live, not stored
    return { area, item: riceItem(variety), label: `${variety ? variety : "all brands"} rice, ${pref ? area : "Japan"}` };
  } catch {
    return null;
  }
}
