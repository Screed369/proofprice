// France: average prices PAID to producers for oilseeds, pulses and minor cereals, from FranceAgriMer's quarterly survey of grain collectors
// ("Historique des prix payes aux producteurs - cereales et oleoproteagineux", data.gouv.fr dataset 5bd300c98b4c415b5ad7561d).
// Format checked 2026-11-08 (GitHub probe fr-fam-grain, HTTP 200, 265,568 bytes): one .xlsx, sheets "Infos" (text) and "Publication nationale"
// (header: Trimestre | Campagne | Ble tendre | Ble dur | Orges | Mais | Seigle | Avoine | Sorgho | Triticale | Colza | Pois | Tournesol | Feverole |
// Soja | Epeautre | Lentilles | Lin | Lupin | Riz | Sarrasin; one row per campaign and quarter, euro per tonne, decimal point, blank = not surveyed).
// The price is the panel's average paid to producers, CUMULATIVE since the start of the campaign (July to June) and including later top-ups, so the
// quarter-4 figure is the complete campaign price. No record count is published, so every answer is an official statistic (range fields null).
// The file name carries the campaign (C25-26) and changes each year: it is resolved from the data.gouv.fr dataset record.
// Wheat, durum, barley, maize, rye, oats and triticale are answered for France by the European Commission's weekly prices (eu-farm-prices):
// this source serves only the other crops, so the two never clash.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";
import { readXlsx } from "../../categories/rent/xlsx";
import type { Cell } from "../../categories/rent/xlsx";

export const DATASET_API = "https://www.data.gouv.fr/api/1/datasets/5bd300c98b4c415b5ad7561d/";
export const DATASET_URL = "https://www.data.gouv.fr/datasets/historique-des-prix-moyens-mensuels-et-trimestriels-payes-aux-producteurs-depuis-2005-cereales-et-oleoproteagineux";
export const FALLBACK_FILE_URL =
  "https://visionet.franceagrimer.fr/Pages/OpenDocument.aspx?fileurl=SeriesChronologiques%2fproductions%20vegetales%2fgrandes%20cultures%2fprix%20pay%c3%a9s%20aux%20producteurs%2fSCR-CER-HISTOPRIXTRIMESTRIELS-C25-26.xlsx&telechargersanscomptage=oui";
const LICENCE_URL = "https://www.etalab.gouv.fr/licence-ouverte-open-licence/";
const USER_AGENT = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const INFO: SourceInfo = {
  id: "fr-famag-grain",
  country: "FR (France)",
  category: "farm prices (oilseeds, pulses and minor cereals paid to producers)",
  name: "Prix moyens payes aux producteurs, cereales et oleoproteagineux (FranceAgriMer)",
  publisher: "FranceAgriMer",
  what_is_recorded:
    "For about 19 crops (rapeseed, sunflower, peas, faba beans, soya, sorghum, spelt, lentils, flax, lupin, rice, buckwheat and the main cereals) the average price grain collectors paid to French producers, " +
    "in euro per tonne, from a quarterly survey of a panel of collectors (value of deliveries divided by tonnes collected, weighted by collection to a national average). " +
    "The price is cumulative since the start of the marketing campaign (July to June) and includes later top-ups; the figure for quarter 4 is the complete campaign price.",
  price_type: "official_statistic",
  freshness: "Quarterly, not live: the newest file read on 8 November 2026 runs to 30 June 2026 (campaign 2025/26); every answer states its campaign and quarter",
  licence:
    "Licence Ouverte 2.0 (Etalab), as recorded on data.gouv.fr for this dataset (licence code lov2); the file's own information sheet adds 'FranceAgriMer (tous droits reserves - reproduction interdite sans mention de la source)'. " +
    "Reuse is therefore treated as allowed only with the source cited; the licence text itself has not been confirmed, so this source is free tier only.",
  licence_url: LICENCE_URL,
  attribution: "Source: FranceAgriMer, prix moyens payes aux producteurs - cereales et oleoproteagineux, via data.gouv.fr (Licence Ouverte 2.0).",
  homepage: DATASET_URL,
  limits:
    "A national average for conventional farming only, cumulative since the start of the campaign, so it is not the price of that single quarter and not a spot or futures price. " +
    "No range, no sample size and no regional split are published. A crop that was not surveyed in a campaign has no figure. About one quarter behind.",
};

// ---------- crops: everyday words -> the file's own column names ----------

export interface Crop {
  /** The file's column name, without accents. */
  column: string;
  /** English name shown to callers. */
  label: string;
  words: string[];
}
const C = (column: string, label: string, words: string): Crop => ({ column, label, words: words.split("|").map((w) => w.trim()) });

/** Crops this source answers (the other cereals belong to eu-farm-prices). */
export const CROPS: Crop[] = [
  C("Colza", "rapeseed", "rapeseed|colza|canola|oilseed rape"),
  C("Tournesol", "sunflower seed", "sunflower|sunflower seed|sunflower seeds|tournesol"),
  C("Soja", "soya beans", "soybean|soybeans|soya|soya beans|soy|soja"),
  C("Pois", "protein peas", "peas|pea|protein peas|field peas|pois"),
  C("Feverole", "faba beans", "faba beans|faba bean|field beans|field bean|broad beans|feverole"),
  C("Lin", "linseed (flax)", "flax|linseed|flaxseed|lin"),
  C("Lupin", "lupin", "lupin|lupins"),
  C("Lentilles", "lentils", "lentils|lentil|lentilles"),
  C("Sorgho", "sorghum", "sorghum|sorgho"),
  C("Epeautre", "spelt", "spelt|epeautre"),
  C("Riz", "rice (paddy)", "rice|paddy rice|riz"),
  C("Sarrasin", "buckwheat", "buckwheat|sarrasin"),
];

/** Crops of the file that eu-farm-prices answers for France (listed so a test can check the two never overlap). */
export const EU_PORTAL_CROPS = ["Ble tendre", "Ble dur", "Orges", "Mais", "Seigle", "Avoine", "Triticale"];

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function matchCrop(query: unknown): Crop | null {
  const q = plain(String(query ?? ""));
  if (!q) return null;
  const direct = CROPS.find((c) => plain(c.label) === q || c.words.includes(q));
  if (direct) return direct;
  const q2 = q.replace(/ prices?$/, "");
  return CROPS.find((c) => c.words.includes(q2)) ?? null;
}

export const exampleCrops = () => CROPS.map((c) => c.words[0]).join(", ");

// ---------- the workbook ----------

export interface QuarterRow {
  campaign: string; // "2025/26"
  quarter: 1 | 2 | 3 | 4;
  prices: Record<string, number>; // by crop column, euro per tonne
}

export const SHEET_NAME = "Publication nationale";

const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Parse the "Publication nationale" sheet rows (cells as read from the workbook). Throws when the layout is not the known one. */
export function parseSheetRows(rows: Cell[][]): QuarterRow[] {
  const headIdx = rows.findIndex((r) => typeof r[0] === "string" && /^trimestre/i.test(r[0].trim()));
  if (headIdx < 0) throw new SourceError("FranceAgriMer's price workbook does not have the expected header (Trimestre, Campagne, crops)");
  const head = rows[headIdx].map((h) => stripAccents(String(h ?? "")).replace(/[*\s]+$/g, "").trim());
  if (!/^campagne/i.test(head[1] ?? "")) throw new SourceError("FranceAgriMer's price workbook does not have a Campagne column");
  const out: QuarterRow[] = [];
  for (const r of rows.slice(headIdx + 1)) {
    const q = Number(r[0]);
    const campaign = String(r[1] ?? "").trim();
    if (!(q >= 1 && q <= 4) || !/^\d{4}\/\d{2}$/.test(campaign)) continue;
    const prices: Record<string, number> = {};
    for (let i = 2; i < head.length; i++) {
      const v = r[i];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) prices[head[i]] = v;
    }
    out.push({ campaign, quarter: q as 1 | 2 | 3 | 4, prices });
  }
  if (!out.length) throw new SourceError("FranceAgriMer's price workbook held no data rows");
  return out;
}

export function parseWorkbook(buf: Buffer): QuarterRow[] {
  const sheet = readXlsx(buf).find((s) => s.name.trim().toLowerCase() === SHEET_NAME.toLowerCase());
  if (!sheet) throw new SourceError(`FranceAgriMer's price workbook has no sheet '${SHEET_NAME}'`);
  return parseSheetRows(sheet.rows);
}

const campaignStartYear = (c: string) => Number(c.slice(0, 4));
const key = (r: QuarterRow) => campaignStartYear(r.campaign) * 10 + r.quarter;

/** The campaign runs July to June; quarter 1 ends 30 September, 2 on 31 December, 3 on 31 March, 4 on 30 June. */
export function quarterEnd(campaign: string, quarter: number): string {
  const y = campaignStartYear(campaign);
  return quarter === 1 ? `${y}-09-30` : quarter === 2 ? `${y}-12-31` : quarter === 3 ? `${y + 1}-03-31` : `${y + 1}-06-30`;
}
export const campaignStart = (campaign: string) => `${campaignStartYear(campaign)}-07-01`;

export interface CropReading {
  campaign: string;
  quarter: number;
  value: number;
}

/** Readings for one crop, newest first. */
export function readings(rows: QuarterRow[], column: string): CropReading[] {
  return rows
    .filter((r) => r.prices[column] !== undefined)
    .sort((a, b) => key(b) - key(a))
    .map((r) => ({ campaign: r.campaign, quarter: r.quarter, value: r.prices[column] }));
}

export const lastYearOf = (campaign: string) => `${campaignStartYear(campaign) - 1}/${String(campaignStartYear(campaign) % 100).padStart(2, "0")}`;

// ---------- fetch ----------

const TTL_MS = 24 * 3600 * 1000;
let cache: { at: number; rows: QuarterRow[]; file: string } | null = null;
export function clearCache(): void {
  cache = null;
}

export type FileLocator = () => Promise<string>;
export type FileGetter = (url: string) => Promise<Buffer>;

/** The newest quarterly workbook, from the dataset's resource list (the file name changes with each campaign). */
export const defaultLocator: FileLocator = async () => {
  try {
    const rec = await fetchJson(DATASET_API, { headers: { "user-agent": USER_AGENT } }, 12000);
    const res = (Array.isArray(rec?.resources) ? rec.resources : []).find((r: any) => typeof r?.url === "string" && /HISTOPRIXTRIMESTRIELS/i.test(r.url));
    if (res?.url) return String(res.url);
  } catch {
    // fall through to the last known file
  }
  return FALLBACK_FILE_URL;
};

export const defaultFile: FileGetter = async (url) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*" }, signal: ctrl.signal });
    if (!res.ok) throw new SourceError(`FranceAgriMer answered HTTP ${res.status}`, undefined, res.status);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError(ctrl.signal.aborted ? "FranceAgriMer timed out" : "Could not reach FranceAgriMer for its price workbook");
  } finally {
    clearTimeout(timer);
  }
};

export async function loadRows(locate: FileLocator = defaultLocator, getFile: FileGetter = defaultFile) {
  const custom = locate !== defaultLocator || getFile !== defaultFile;
  if (!custom && cache && Date.now() - cache.at < TTL_MS) return cache;
  const url = await locate();
  const loaded = { at: Date.now(), rows: parseWorkbook(await getFile(url)), file: url };
  if (!custom) cache = loaded;
  return loaded;
}

// ---------- the answer ----------

const eur = (v: number) => fmtMoney(v, "EUR");
const round1 = (v: number) => Math.round(v * 10) / 10;
const pct = (a: number, b: number) => Math.round(((a - b) / b) * 1000) / 10;
const QUARTER_WORDS = ["", "July to September", "July to December", "July to March", "July to June (the complete campaign price)"];

export function famMethod(): string {
  return (
    "France (oilseeds, pulses and minor cereals): FranceAgriMer surveys a panel of grain collectors every quarter and publishes the national average price paid to producers, in euro per tonne " +
    "(value of deliveries divided by tonnes collected, weighted by collection). The price is cumulative since the start of the campaign (July to June) and includes later top-ups. " +
    "We pass on the published average; it is not a range, a single sale or a spot price."
  );
}

export async function famGrainPrices(
  q: { product?: string; baseUrl?: string },
  locate?: FileLocator,
  getFile?: FileGetter,
): Promise<PriceAnswer> {
  const word = (q.product ?? "").trim();
  if (!word) throw new InputError(`product is required, for example 'rapeseed', 'sunflower', 'peas' or 'soybeans'.`);
  const crop = matchCrop(word);
  const query = { country: "FR", product: word };
  const base = { source: INFO, query, measure: "average" as const, currency: "EUR", method: famMethod(), baseUrl: q.baseUrl };
  if (!crop) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `FranceAgriMer's survey has no crop '${word}' here. Try one of: ${exampleCrops()}. (Wheat, barley, maize, oats, rye and triticale for France come from the European Commission weekly prices.)`, extra: { available_products: CROPS.map((c) => c.words[0]) } };
  }
  const { rows, file } = await loadRows(locate, getFile);
  const series = readings(rows, crop.column);
  const now = series[0];
  if (!now) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `FranceAgriMer's file holds no price for ${crop.label}.`, extra: { products: CROPS.map((c) => c.words[0]) } };
  }
  const sameQuarterLastCampaign = series.find((s) => s.quarter === now.quarter && s.campaign === lastYearOf(now.campaign)) ?? null;
  const finals = series.filter((s) => s.quarter === 4).slice(0, 5).map((s) => ({ campaign: s.campaign, value: round1(s.value) }));
  const newestCampaign = rows.reduce((m, r) => (key(r) > m.k ? { k: key(r), c: r.campaign, q: r.quarter } : m), { k: 0, c: "", q: 0 });
  const notes: string[] = [
    `A cumulative campaign-to-date average: what grain collectors paid French producers for ${crop.label} from 1 July ${campaignStartYear(now.campaign)} to ${quarterEnd(now.campaign, now.quarter)}, including later top-ups. It is not the price of that quarter alone, and not a spot price. Conventional farming only.`,
  ];
  if (newestCampaign.k > key({ campaign: now.campaign, quarter: now.quarter as 1, prices: {} })) {
    notes.push(`The file's newest quarter is ${newestCampaign.c} quarter ${newestCampaign.q}, but it holds no ${crop.label} figure: the newest with one is ${now.campaign} quarter ${now.quarter}.`);
  }
  return buildStatisticAnswer({
    ...base,
    value: round1(now.value),
    unit: "per tonne",
    period: { from: campaignStart(now.campaign), to: quarterEnd(now.campaign, now.quarter) },
    reference_period: `${now.campaign} Q${now.quarter}`,
    note: notes.join(" "),
    describe: (v) =>
      `Grain collectors paid French producers on average ${eur(v)} per tonne for ${crop.label} in campaign ${now.campaign}, cumulative from July to ${quarterEnd(now.campaign, now.quarter)} (${QUARTER_WORDS[now.quarter]}). ` +
      (sameQuarterLastCampaign ? `That is ${pct(now.value, sameQuarterLastCampaign.value) >= 0 ? "up" : "down"} ${Math.abs(pct(now.value, sameQuarterLastCampaign.value))}% on the same point of ${sameQuarterLastCampaign.campaign} (${eur(round1(sameQuarterLastCampaign.value))}). ` : "") +
      "A national average from FranceAgriMer's panel of collectors, not a range or a spot price.",
    extra: {
      crop: crop.label,
      crop_column: crop.column,
      campaign: now.campaign,
      quarter: now.quarter,
      cumulative_to: quarterEnd(now.campaign, now.quarter),
      same_point_previous_campaign: sameQuarterLastCampaign ? { campaign: sameQuarterLastCampaign.campaign, value: round1(sameQuarterLastCampaign.value), change_percent: pct(now.value, sameQuarterLastCampaign.value) } : null,
      complete_campaign_prices: finals,
      file,
      products: CROPS.map((c) => c.words[0]),
    },
  });
}

// ---------- daily library copy (stale-if-error) ----------

/** Pure: one library row per crop for the newest quarter of the file that has the crop, dated at that quarter's end. */
export function harvestRows(rows: QuarterRow[]): HarvestResult {
  const newest = rows.reduce((m, r) => (key(r) > key(m) ? r : m), rows[0]);
  const out: DailyRow[] = [];
  for (const c of CROPS) {
    const v = newest.prices[c.column];
    if (v === undefined) continue;
    const r = round1(v);
    out.push({ area: "France", item: c.label, n: NO_COUNT, median: r, low: r, high: r, min: r, max: r });
  }
  if (!out.length) throw new SourceError(`FranceAgriMer's file held no price for ${newest.campaign} quarter ${newest.quarter}`);
  return {
    date: quarterEnd(newest.campaign, newest.quarter),
    currency: "EUR",
    unit: "per tonne",
    rows: out,
    note: `FranceAgriMer average prices paid to producers, campaign ${newest.campaign} quarter ${newest.quarter} (cumulative since 1 July): one published national average per crop, not counts of sales (no count is published).`,
  };
}

export async function famHarvest(locate?: FileLocator, getFile?: FileGetter): Promise<HarvestResult> {
  clearCache();
  return harvestRows((await loadRows(locate, getFile)).rows);
}

export function famHistoryKey(p: { product?: string }): { area: string; item: string; label: string } | null {
  const crop = matchCrop(p.product);
  if (!crop) return null;
  return { area: "France", item: crop.label, label: `France, ${crop.label}` };
}
