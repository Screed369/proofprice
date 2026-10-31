// United Kingdom: monthly farm-gate milk price (pence per litre received by producers) from Defra's "United Kingdom milk prices and
// composition of milk" statistics, an Open Government Licence v3.0 spreadsheet republished every month.
// Format checked live on 2026-10-31: the gov.uk content API (https://www.gov.uk/api/content/government/statistics/uk-milk-prices-and-composition-of-milk)
// lists the attachments; the one titled "... - dataset" (content_type application/vnd.oasis.opendocument.spreadsheet) is an ODS file whose name
// and URL change every release (milkprice_dataset_20261029.ods), so the URL is read from the API on every run. An ODS is a zip; its
// content.xml holds the sheet "Prices_Monthly": Month | Price (pence per litre) | Volume (million litres) | Weekly average volume |
// Butterfat (%) | Protein (%), one row per month since Jan-70, newest last (Sep-26 = 38.454 p/litre), then footnotes (1 = latest month provisional).
// Defra publishes ONE UK average per month: no distribution, no count of sales, so every answer is an official statistic.

import { inflateRawSync } from "node:zlib";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError, fetchJson } from "../../lib/http";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NATIONAL } from "../../lib/library/aggregate";
import { NO_COUNT } from "../../lib/stats";

export const INFO: SourceInfo = {
  id: "gb-defra-milk",
  country: "GB (United Kingdom)",
  category: "farm-gate prices (monthly price farmers receive for milk)",
  name: "United Kingdom milk prices and composition of milk (Defra monthly statistics)",
  publisher: "Department for Environment, Food and Rural Affairs (Defra)",
  what_is_recorded:
    "The average price UK dairy farmers received for the milk they delivered to dairies in each month since January 1970, in pence per litre, with the volume delivered and the butterfat and protein content. " +
    "Defra's compulsory monthly survey of dairies, weighted by volume; one UK average per month, never a farm or a contract.",
  price_type: "official_statistic",
  freshness:
    "Monthly, not live: Defra publishes each month's figure about four weeks after the month ends (September 2026 was published on 29 October 2026), and every answer states its reference month",
  licence: "Open Government Licence v3.0",
  licence_url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  attribution: "Contains public sector information licensed under the Open Government Licence v3.0. Source: Defra, United Kingdom milk prices and composition of milk.",
  homepage: "https://www.gov.uk/government/statistics/uk-milk-prices-and-composition-of-milk",
  limits:
    "A monthly UK average of the price farmers received for milk, net of delivery charges and excluding retrospective bonuses (except in Northern Ireland), not a range, not the price on one farm or contract and not a shop price: " +
    "Defra gives no distribution and no count of sales. There is one figure for the whole United Kingdom: Defra does not split it by nation. The newest month is provisional and is revised. " +
    "Do not use it for the price of milk in a shop.",
};

export const API_URL = "https://www.gov.uk/api/content/government/statistics/uk-milk-prices-and-composition-of-milk";
export const ODS_HOST = "assets.publishing.service.gov.uk";
export const ITEM = "Milk (per litre)";

// ---------- the ODS file ----------

/** Pure: the named entry of a zip held in memory (central directory, stored or deflated). */
export function zipEntry(zip: Buffer, name: string): Buffer {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SourceError("Defra's milk file is not a zip archive: the format has changed and this source needs updating.");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) break;
    const method = zip.readUInt16LE(p + 10);
    const csize = zip.readUInt32LE(p + 20);
    const nlen = zip.readUInt16LE(p + 28);
    const xlen = zip.readUInt16LE(p + 30);
    const clen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const entry = zip.toString("utf8", p + 46, p + 46 + nlen);
    if (entry === name) {
      const lnlen = zip.readUInt16LE(local + 26);
      const lxlen = zip.readUInt16LE(local + 28);
      const start = local + 30 + lnlen + lxlen;
      const raw = zip.subarray(start, start + csize);
      if (method === 8) return inflateRawSync(raw);
      if (method === 0) return Buffer.from(raw);
      throw new SourceError(`Defra's milk file uses an unsupported zip compression (${method}).`);
    }
    p += 46 + nlen + xlen + clen;
  }
  throw new SourceError(`Defra's milk file has no ${name}: the format has changed and this source needs updating.`);
}

export interface MilkPoint {
  /** YYYY-MM */
  month: string;
  /** pence per litre */
  pence: number;
  volume: number | null;
  butterfat: number | null;
  protein: number | null;
}

export interface MilkSeries {
  points: MilkPoint[]; // oldest first
  /** Footnote 1 says the latest month is provisional. */
  provisional: boolean;
}

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function rowCells(row: string): { value: string | null; date: string | null; text: string }[] {
  const out: { value: string | null; date: string | null; text: string }[] = [];
  for (const m of row.matchAll(/<table:table-cell([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-cell>)/g)) {
    const attrs = m[1];
    const repeat = Math.min(Number(/number-columns-repeated="(\d+)"/.exec(attrs)?.[1] ?? 1), 8);
    const cell = {
      value: /office:value="([^"]*)"/.exec(attrs)?.[1] ?? null,
      date: /office:date-value="([^"]*)"/.exec(attrs)?.[1] ?? null,
      text: decode((m[2] ?? "").replace(/<[^>]+>/g, "")),
    };
    for (let i = 0; i < repeat; i++) out.push(cell);
  }
  return out;
}

/** Pure: the monthly series from the content.xml of Defra's workbook (sheet "Prices_Monthly"). Throws a plain SourceError when the layout is not the one we checked. */
export function parseMilkSheet(contentXml: string): MilkSeries {
  const at = contentXml.indexOf('table:name="Prices_Monthly"');
  if (at < 0) throw new SourceError('Defra\'s milk workbook has no sheet "Prices_Monthly": the format has changed and this source needs updating.');
  const end = contentXml.indexOf("</table:table>", at);
  const rows = contentXml.slice(at, end < 0 ? undefined : end).match(/<table:table-row[^>]*?(?:\/>|>[\s\S]*?<\/table:table-row>)/g) ?? [];
  const header = rows.length > 1 ? rowCells(rows[1]).map((c) => c.text) : [];
  if (!/pence per litre/i.test(header[1] ?? "") || !/^Month$/i.test((header[0] ?? "").trim())) {
    throw new SourceError("Defra's milk sheet no longer has a Month and a price in pence per litre in its first two columns: the format has changed and this source needs updating.");
  }
  const num = (c?: { value: string | null }) => (c?.value != null && Number.isFinite(Number(c.value)) ? Number(c.value) : null);
  const points: MilkPoint[] = [];
  let provisional = false;
  for (const r of rows.slice(2)) {
    const cells = rowCells(r);
    const d = cells[0]?.date;
    if (d && /^\d{4}-\d{2}/.test(d)) {
      const pence = num(cells[1]);
      if (pence != null && pence > 0) points.push({ month: d.slice(0, 7), pence, volume: num(cells[2]), butterfat: num(cells[4]), protein: num(cells[5]) });
    } else if (/latest month'?s data are provisional/i.test(cells[0]?.text ?? "")) provisional = true;
  }
  if (!points.length) throw new SourceError("Defra's milk sheet held no monthly prices: the format has changed and this source needs updating.");
  points.sort((a, b) => a.month.localeCompare(b.month));
  return { points, provisional };
}

/** Pure: the ODS attachment of the gov.uk content API reply (the one titled "... dataset"). */
export function odsUrlFrom(api: unknown): string {
  const list: any[] = (api as any)?.details?.attachments ?? [];
  const ods = list.filter((a) => /opendocument\.spreadsheet/.test(String(a?.content_type ?? "")) && typeof a?.url === "string");
  const pick = ods.find((a) => /dataset/i.test(String(a.title ?? ""))) ?? ods[0];
  if (!pick) throw new SourceError("Defra's milk page lists no spreadsheet: the format has changed and this source needs updating.");
  let url: URL;
  try {
    url = new URL(pick.url);
  } catch {
    throw new SourceError("Defra's milk spreadsheet link is not a full address: the format has changed and this source needs updating.");
  }
  if (url.protocol !== "https:" || url.hostname !== ODS_HOST) throw new SourceError("Defra's milk spreadsheet is not on assets.publishing.service.gov.uk: refusing to read it.");
  return url.toString();
}

export type Getter = () => Promise<MilkSeries & { published?: string }>;

let cache: { at: number; value: MilkSeries & { published?: string } } | null = null;
export function clearMilkCache(): void {
  cache = null;
}

async function fetchBytes(url: string, timeoutMs = 20000): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
    return Buffer.from(await res.arrayBuffer());
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

/** Live: the API reply, then the spreadsheet it points to. Cached six hours in memory (the figure changes once a month). */
export const liveMilk: Getter = async () => {
  if (cache && Date.now() - cache.at < 6 * 3600 * 1000) return cache.value;
  const api = await fetchJson(API_URL);
  const zip = await fetchBytes(odsUrlFrom(api));
  const series = parseMilkSheet(zipEntry(zip, "content.xml").toString("utf8"));
  const published = typeof api?.public_updated_at === "string" ? api.public_updated_at.slice(0, 10) : undefined;
  const value = { ...series, published };
  cache = { at: Date.now(), value };
  return value;
};

// ---------- the product ----------

const MILK_WORDS = ["milk", "cow milk", "cows milk", "cow's milk", "raw milk", "farm milk", "farmgate milk", "farm gate milk", "dairy", "dairy milk", "milk price", "milk prices"];

export function isMilk(product: string): boolean {
  const q = product.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();
  return MILK_WORDS.includes(q) || /^(raw |fresh |uk |british )?(cow'?s? )?milk( price)?$/.test(q);
}

const NATIONS = /^(uk|u\.k\.|united kingdom|gb|great britain|britain|england|wales|scotland|northern ireland|ni)$/i;

// ---------- the answer ----------

export function monthWords(month: string): string {
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const m = /^(\d{4})-(\d{2})/.exec(month);
  return m ? `${names[Number(m[2]) - 1]} ${m[1]}` : month;
}

export function monthRange(month: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})/.exec(month)!;
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}` };
}

function shiftMonth(month: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})/.exec(month)!;
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const pounds = (pence: number) => pence / 100;

export function milkMethod(): string {
  return (
    "United Kingdom (farm-gate milk): Defra's monthly statistics on UK milk prices and composition, from its compulsory monthly survey of dairies. " +
    "We read the spreadsheet Defra publishes, take the newest month and pass on the published UK average price farmers received, with the change on the month before and a year earlier that we calculate from two published averages; " +
    "it is a monthly average net of delivery charges, not a sale, a contract or a shop price, and no range is calculated."
  );
}

export interface MilkQuery {
  product: string;
  region?: string;
  baseUrl?: string;
}

export function milkAnswer(series: (MilkSeries & { published?: string }) | null, q: MilkQuery): PriceAnswer {
  const query: Record<string, unknown> = { country: "GB", product: q.product };
  const base = { source: INFO, query, measure: "average" as const, currency: "GBP", method: milkMethod(), baseUrl: q.baseUrl };
  const empty = (summary: string, extra: Record<string, unknown>): PriceAnswer => ({
    ...buildStatisticAnswer({ ...base, value: null, unit: "", period: { from: null, to: null }, reference_period: "", describe: () => "" }),
    summary,
    extra,
  });
  if (!isMilk(q.product)) {
    return empty(`Defra's monthly farm-gate series for the United Kingdom covers milk only. "${q.product}" is not in it. Try product=milk.`, { available_products: ["milk"] });
  }
  const pts = series?.points ?? [];
  const last = pts[pts.length - 1];
  if (!series || !last) return empty("Defra publishes no recent milk price.", {});
  const at = (m: string) => pts.find((p) => p.month === m) ?? null;
  const change = (from: MilkPoint | null) =>
    from ? { reference_month: from.month, pence_per_litre: r2(from.pence), change_percent: r2(((last.pence - from.pence) / from.pence) * 100), change_pence: r2(last.pence - from.pence) } : null;
  const mom = change(at(shiftMonth(last.month, -1)));
  const yoy = change(at(shiftMonth(last.month, -12)));
  const regionNote =
    q.region && !/^(uk|united kingdom|gb|great britain|britain)$/i.test(q.region.trim())
      ? NATIONS.test(q.region.trim())
        ? `Defra publishes one figure for the whole United Kingdom, not for ${q.region.trim()} alone, so the UK average is returned.`
        : `Defra publishes one figure for the whole United Kingdom, so "${q.region.trim()}" was ignored and the UK average is returned.`
      : null;
  const notes = [
    `A monthly UK average of the price farmers received for milk in ${monthWords(last.month)}, net of delivery charges: not a sale, not a contract and not a shop price.`,
  ];
  if (series.provisional) notes.push(`Defra marks the latest month (${monthWords(last.month)}) as provisional; it can be revised.`);
  if (regionNote) notes.push(regionNote);
  const value = pounds(last.pence);
  const last12 = pts.slice(-12).map((p) => ({ month: p.month, pence_per_litre: r2(p.pence) }));

  return buildStatisticAnswer({
    ...base,
    value,
    unit: "per litre",
    period: monthRange(last.month),
    reference_period: last.month,
    published: series.published ?? null,
    note: notes.join(" "),
    describe: () =>
      `UK farmers received on average ${r2(last.pence)} pence per litre (${fmtMoney(value, "GBP")}) for milk in ${monthWords(last.month)}, as published by Defra (a monthly average, not a shop price)` +
      (series.provisional ? ", provisional. " : ". ") +
      (yoy
        ? yoy.change_percent === 0
          ? `That is unchanged from a year earlier (${yoy.pence_per_litre} pence in ${monthWords(yoy.reference_month)}).`
          : `That is ${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than a year earlier (${yoy.pence_per_litre} pence in ${monthWords(yoy.reference_month)}).`
        : "Defra holds no price for the same month a year earlier."),
    extra: {
      country_name: "United Kingdom",
      product: { definition: "Milk delivered by UK producers to dairies, average price received (pence per litre, net of delivery charges)", asked_for: q.product },
      unit: { value_unit: "GBP per litre", published_wording: "pence per litre", pence_per_litre: r2(last.pence) },
      what_this_is: "Monthly UK average price received by dairy farmers, published by Defra. Not a sale, not a contract and not a shop price.",
      reference_month: last.month,
      reference_month_label: monthWords(last.month),
      provisional: series.provisional,
      change_on_previous_month: mom,
      change_on_year_earlier: yoy,
      ...(yoy ? {} : { change_on_year_earlier_unavailable: "Defra holds no price for the same month a year earlier." }),
      last_12_months: last12,
      composition: {
        volume_million_litres: last.volume != null ? r2(last.volume) : null,
        butterfat_percent: last.butterfat != null ? r2(last.butterfat) : null,
        protein_percent: last.protein != null ? r2(last.protein) : null,
      },
      dataset: { name: "United Kingdom milk prices and composition of milk - dataset", url: INFO.homepage, published: series.published ?? null },
      ...(regionNote ? { region_note: regionNote } : {}),
    },
  });
}

export async function gbMilkPrices(input: MilkQuery, get: Getter = liveMilk): Promise<PriceAnswer> {
  const product = (input.product ?? "").trim();
  if (!product) throw new InputError("product is required, for example product=milk.");
  if (!isMilk(product)) return milkAnswer(null, { ...input, product });
  return milkAnswer(await get(), { ...input, product });
}

// ---------- the library copy (stale-if-error) ----------

/** Pure: one library row for the newest month. The figure is a published average: n is NO_COUNT and the range fields repeat it. */
export function milkHarvestRows(series: MilkSeries): HarvestResult {
  const last = series.points[series.points.length - 1];
  if (!last) throw new SourceError("Defra's milk sheet held no monthly price");
  const v = pounds(last.pence);
  return {
    date: monthRange(last.month).to,
    currency: "GBP",
    unit: "per litre",
    rows: [{ area: NATIONAL, item: ITEM, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v }],
    note: `Defra, United Kingdom milk prices: average price farmers received for milk in ${monthWords(last.month)}${series.provisional ? " (provisional)" : ""}. A published UK average, not a count of sales (no count is published).`,
  };
}

export async function gbMilkHarvest(get: Getter = liveMilk): Promise<HarvestResult> {
  return milkHarvestRows(await get());
}

export function milkHistoryKey(p: { product?: string }): { area: string; item: string; label: string } | null {
  return p.product && isMilk(p.product) ? { area: NATIONAL, item: ITEM, label: "United Kingdom (farm-gate milk)" } : null;
}
