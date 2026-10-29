// Indonesia: daily average prices of 10 strategic foods in traditional markets, Bank Indonesia PIHPS Nasional
// (Pusat Informasi Harga Pangan Strategis). Format checked live on 2026-10-29 through the GitHub probe (GET, no key, no cookie):
//   https://www.bi.go.id/hargapangan/WebSite/TabelHarga/GetGridDataDaerah?price_type_id=1&comcat_id=&province_id=&regency_id=&market_id=&tipe_laporan=1&start_date=2026-10-27&end_date=2026-10-28
//   -> { data: [ { no: "I", name: "Beras", level: 1, "27/10/2026": "16,450", "28/10/2026": "16,500" },
//                { no: 1, name: "Beras Kualitas Bawah I", level: 2, "27/10/2026": "14,950", ... }, ... ] }
//   province_id=13 (DKI Jakarta) gives the same layout for one province; GetRefProvince lists the 34 provinces ({ data: [ { id, name } ] }).
// Columns are dd/mm/yyyy dates, values are strings with comma thousands (rupiah). 32 rows: 10 foods (level 1, the average of the
// varieties) and 22 varieties (level 2). The newest day is often partial (fewer markets have reported), so we ask up to yesterday
// (Jakarta time). PIHPS publishes one average per food and day, no record count: an official statistic.
// The feed carries no unit field: the prices are read as rupiah per kilogram (rice about 16,500), as in BI's tables. UNVERIFIED for oils.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import { exampleWords, ItemDef, matchItem } from "../../categories/groceries/items";

export const INFO: SourceInfo = {
  id: "id-bi-pihps",
  country: "ID (Indonesia)",
  category: "groceries (daily average prices of 10 strategic foods in traditional markets)",
  name: "PIHPS Nasional: Pusat Informasi Harga Pangan Strategis (Strategic Food Price Information Centre)",
  publisher: "Bank Indonesia (PIHPS Nasional)",
  what_is_recorded:
    "For 10 staple foods (rice, chicken, beef, eggs, shallots, garlic, red and bird's-eye chilli, cooking oil, sugar) and 22 varieties, the daily average price in Indonesian rupiah " +
    "in traditional markets, nationally or for one of the 34 provinces, from the market price survey Bank Indonesia runs with regional offices. One published average per food and day; never an individual shop or shopper.",
  price_type: "official_statistic",
  freshness: "Daily, one to two days behind; every answer names the day",
  licence:
    "No licence stated. The PIHPS site (read 23 Oct 2026) shows only 'Hak Cipta 2022 PIHPS Nasional - Semua Hak Dilindungi' (all rights reserved) and no terms of use. " +
    "ProofPrice therefore serves this source free of charge only: it is not on the list of sources cleared for paid use.",
  licence_url: "https://www.bi.go.id/hargapangan",
  attribution:
    "Source: PIHPS Nasional (Pusat Informasi Harga Pangan Strategis), Bank Indonesia, https://www.bi.go.id/hargapangan , accessed on the date in this answer's retrieved_at field. " +
    "Figures are passed on as published; the changes are calculated by ProofPrice. This is not a Bank Indonesia product and Bank Indonesia does not endorse it.",
  homepage: "https://www.bi.go.id/hargapangan",
  limits:
    "National and province averages for 10 staple foods only; no city or market prices. PIHPS does not say how many markets or quotes stand behind a daily average, and the newest day can be partial. " +
    "The data feed has no unit field: prices are read as rupiah per kilogram. These are survey prices in traditional markets, not receipts and not the price at any one stall.",
};

export const BASE = "https://www.bi.go.id/hargapangan/WebSite/TabelHarga/GetGridDataDaerah";

const def = (code: string, label: string, ...words: string[]): ItemDef => ({ code, label, unit: "per kg", words });
// code = BI's row name exactly as published (trimmed, lower-cased when matched). Level-1 rows come first so they are the default for a plain word.
export const ITEMS: ItemDef[] = [
  def("Beras", "Rice, average of all qualities", "rice", "beras"),
  def("Daging Ayam", "Chicken meat", "chicken", "daging ayam", "ayam"),
  def("Daging Sapi", "Beef, average of both qualities", "beef", "daging sapi", "sapi"),
  def("Telur Ayam", "Chicken eggs", "eggs", "egg", "telur", "telur ayam"),
  def("Bawang Merah", "Shallots", "shallot", "shallots", "red onion", "onion", "bawang merah"),
  def("Bawang Putih", "Garlic", "garlic", "bawang putih"),
  def("Cabai Merah", "Red chilli, average of large and curly", "chilli", "chili", "red chilli", "red chili", "cabai", "cabai merah"),
  def("Cabai Rawit", "Bird's-eye chilli, average of green and red", "bird's eye chilli", "birds eye chili", "cabai rawit", "rawit"),
  def("Minyak Goreng", "Cooking oil, average of bulk and branded", "cooking oil", "oil", "vegetable oil", "palm oil", "minyak goreng"),
  def("Gula Pasir", "Granulated sugar, average of premium and local", "sugar", "white sugar", "gula", "gula pasir"),
  def("Beras Kualitas Bawah I", "Rice, lower quality I", "lower rice i", "low quality rice"),
  def("Beras Kualitas Bawah II", "Rice, lower quality II", "lower rice ii"),
  def("Beras Kualitas Medium I", "Rice, medium quality I", "medium rice", "medium rice i", "medium quality rice"),
  def("Beras Kualitas Medium II", "Rice, medium quality II", "medium rice ii"),
  def("Beras Kualitas Super I", "Rice, super quality I", "premium rice", "super rice", "super rice i", "super quality rice"),
  def("Beras Kualitas Super II", "Rice, super quality II", "super rice ii"),
  def("Daging Ayam Ras Segar", "Fresh broiler chicken meat", "broiler chicken", "fresh chicken"),
  def("Daging Sapi Kualitas 1", "Beef, quality 1", "beef quality 1", "best beef", "premium beef"),
  def("Daging Sapi Kualitas 2", "Beef, quality 2", "beef quality 2"),
  def("Telur Ayam Ras Segar", "Fresh broiler-hen eggs", "fresh eggs", "hen eggs"),
  def("Bawang Merah Ukuran Sedang", "Shallots, medium size", "medium shallots"),
  def("Bawang Putih Ukuran Sedang", "Garlic, medium size", "medium garlic"),
  def("Cabai Merah Besar", "Large red chilli", "large red chilli", "large chilli", "big chilli"),
  def("Cabai Merah Keriting", "Curly red chilli", "curly chilli", "curly red chilli", "keriting"),
  def("Cabai Rawit Hijau", "Green bird's-eye chilli", "green chilli", "green bird's eye chilli"),
  def("Cabai Rawit Merah", "Red bird's-eye chilli", "red bird's eye chilli", "red rawit"),
  def("Minyak Goreng Curah", "Cooking oil, bulk (unbranded)", "bulk cooking oil", "curah"),
  def("Minyak Goreng Kemasan Bermerk 1", "Cooking oil, branded pack 1", "branded cooking oil", "packaged cooking oil"),
  def("Minyak Goreng Kemasan Bermerk 2", "Cooking oil, branded pack 2", "branded cooking oil 2"),
  def("Gula Pasir Kualitas Premium", "Granulated sugar, premium quality", "premium sugar"),
  def("Gula Pasir Lokal", "Granulated sugar, local", "local sugar"),
];

export const keyOf = (name: string): string => name.trim().toLowerCase();

// ---------- provinces (BI ids from GetRefProvince, checked 2026-10-29) ----------
export const PROVINCES: Array<{ id: number; name: string; aliases: string[] }> = [
  { id: 1, name: "Aceh", aliases: [] },
  { id: 17, name: "Bali", aliases: [] },
  { id: 11, name: "Banten", aliases: [] },
  { id: 7, name: "Bengkulu", aliases: [] },
  { id: 15, name: "DI Yogyakarta", aliases: ["yogyakarta", "jogja", "yogya"] },
  { id: 13, name: "DKI Jakarta", aliases: ["jakarta"] },
  { id: 25, name: "Gorontalo", aliases: [] },
  { id: 6, name: "Jambi", aliases: [] },
  { id: 12, name: "Jawa Barat", aliases: ["west java"] },
  { id: 14, name: "Jawa Tengah", aliases: ["central java"] },
  { id: 16, name: "Jawa Timur", aliases: ["east java"] },
  { id: 20, name: "Kalimantan Barat", aliases: ["west kalimantan"] },
  { id: 21, name: "Kalimantan Selatan", aliases: ["south kalimantan"] },
  { id: 22, name: "Kalimantan Tengah", aliases: ["central kalimantan"] },
  { id: 23, name: "Kalimantan Timur", aliases: ["east kalimantan"] },
  { id: 24, name: "Kalimantan Utara", aliases: ["north kalimantan"] },
  { id: 9, name: "Kepulauan Bangka Belitung", aliases: ["bangka belitung", "bangka"] },
  { id: 5, name: "Kepulauan Riau", aliases: ["riau islands"] },
  { id: 10, name: "Lampung", aliases: [] },
  { id: 31, name: "Maluku", aliases: [] },
  { id: 32, name: "Maluku Utara", aliases: ["north maluku"] },
  { id: 18, name: "Nusa Tenggara Barat", aliases: ["west nusa tenggara", "ntb", "lombok"] },
  { id: 19, name: "Nusa Tenggara Timur", aliases: ["east nusa tenggara", "ntt"] },
  { id: 33, name: "Papua", aliases: [] },
  { id: 34, name: "Papua Barat", aliases: ["west papua"] },
  { id: 4, name: "Riau", aliases: [] },
  { id: 30, name: "Sulawesi Barat", aliases: ["west sulawesi"] },
  { id: 26, name: "Sulawesi Selatan", aliases: ["south sulawesi", "makassar"] },
  { id: 28, name: "Sulawesi Tengah", aliases: ["central sulawesi"] },
  { id: 27, name: "Sulawesi Tenggara", aliases: ["southeast sulawesi", "south east sulawesi"] },
  { id: 29, name: "Sulawesi Utara", aliases: ["north sulawesi"] },
  { id: 3, name: "Sumatera Barat", aliases: ["west sumatra", "sumatra barat"] },
  { id: 8, name: "Sumatera Selatan", aliases: ["south sumatra", "sumatra selatan"] },
  { id: 2, name: "Sumatera Utara", aliases: ["north sumatra", "sumatra utara"] },
];

const NATIONAL_WORDS = new Set(["id", "indonesia", "idn", "national", "nationwide", "all", "whole country", "republic of indonesia"]);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** "jakarta" -> DKI Jakarta; null when the words are not a province BI publishes. */
export function matchProvince(raw: string): { id: number; name: string } | null {
  const q = norm(raw);
  if (!q) return null;
  for (const p of PROVINCES) if ([p.name, ...p.aliases].some((a) => norm(a) === q)) return { id: p.id, name: p.name };
  return null;
}

// ---------- reading the grid (pure) ----------

export interface IdSeries {
  name: string;
  /** ISO date -> rupiah. Days with no price are left out. */
  days: Map<string, number>;
}

export const isoFromBi = (text: string): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
export const biFromIso = (iso: string): string => `${iso.slice(0, 4)}-${iso.slice(5, 7)}-${iso.slice(8, 10)}`;
export const parseRupiah = (v: unknown): number | null => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Parse one GetGridDataDaerah response. Throws SourceError when the shape is not BI's. */
export function parseGrid(json: unknown): Map<string, IdSeries> {
  const data = (json as any)?.data;
  if (!Array.isArray(data)) throw new SourceError("PIHPS returned an unexpected shape (no data array).");
  const out = new Map<string, IdSeries>();
  for (const r of data) {
    const name = String(r?.name ?? "").trim();
    if (!name) continue;
    const days = new Map<string, number>();
    for (const [k, v] of Object.entries(r)) {
      const iso = isoFromBi(k);
      const price = iso ? parseRupiah(v) : null;
      if (iso && price !== null) days.set(iso, price);
    }
    out.set(keyOf(name), { name, days });
  }
  return out;
}

const addDays = (iso: string, d: number): string => new Date(Date.parse(iso + "T00:00:00Z") + d * 86400000).toISOString().slice(0, 10);
/** Today's date in Jakarta (UTC+7). */
export const jakartaToday = (now: Date): string => new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);

export function gridUrl(from: string, to: string, provinceId?: number): string {
  return `${BASE}?price_type_id=1&comcat_id=&province_id=${provinceId ?? ""}&regency_id=&market_id=&tipe_laporan=1&start_date=${from}&end_date=${to}`;
}

// ---------- the answer (pure) ----------

const roundTo = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const idr = (v: number) => `Rp ${Math.round(v).toLocaleString("en-US")}`;

export interface Change { from_date: string; from_value: number; change_percent: number; change_amount: number }
export function changeOver(from: number | null | undefined, fromDate: string, to: number): Change | null {
  if (typeof from !== "number" || !(from > 0)) return null;
  return { from_date: fromDate, from_value: from, change_percent: roundTo(((to - from) / from) * 100, 1), change_amount: Math.round(to - from) };
}

export function idMethod(): string {
  return (
    "Bank Indonesia's PIHPS Nasional publishes, every day, the average price of 10 staple foods (and 22 varieties) in traditional markets, nationally and by province, from its market price survey. " +
    "ProofPrice returns the published average for the newest full day, unchanged, with the day a week earlier and the same day a year earlier. " +
    "No range is calculated: PIHPS gives one average and does not say how many markets or quotes are behind it. These are survey prices for statistics, not receipts."
  );
}

export interface IdQuery { item: string; region?: string; baseUrl?: string; today?: Date }
export interface IdReading { current: Map<string, IdSeries>; yearAgo: Map<string, IdSeries> | null; provinceName: string | null }

export function idAnswer(reading: IdReading | null, d: ItemDef | null, related: ItemDef[], q: IdQuery): PriceAnswer {
  const query: Record<string, unknown> = { country: "ID", item: q.item, ...(q.region ? { region: q.region } : {}) };
  const base = { source: INFO, query, measure: "average" as const, currency: "IDR", method: idMethod(), baseUrl: q.baseUrl };
  const series = reading && d ? reading.current.get(keyOf(d.code)) : undefined;
  const newest = series && series.days.size ? [...series.days.keys()].sort().pop()! : null;

  if (!d || !reading || !series || !newest) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: d?.unit ?? "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const hint = d
      ? `PIHPS holds no price for "${d.label}" in the last 10 days${reading?.provinceName ? ` in ${reading.provinceName}` : ""}.`
      : `PIHPS has no staple food for "${q.item}": it covers rice, chicken, beef, eggs, shallots, garlic, chilli, cooking oil and sugar.`;
    return { ...none, summary: `${hint} Try one of: ${exampleWords(ITEMS, 12).join(", ")}.`, extra: { available_items: exampleWords(ITEMS, 40) } };
  }

  const value = series.days.get(newest)!;
  const weekDate = addDays(newest, -7);
  const week = changeOver(series.days.get(weekDate), weekDate, value);
  const yearSeries = reading.yearAgo?.get(keyOf(d.code));
  // the same day a year earlier, else the nearest day within 3 days
  let yearFound: string | null = null;
  if (yearSeries) {
    for (const off of [0, -1, 1, -2, 2, -3, 3]) { const c = addDays(newest, -365 + off); if (yearSeries.days.has(c)) { yearFound = c; break; } }
  }
  const year = yearFound ? changeOver(yearSeries!.days.get(yearFound), yearFound, value) : null;
  const where = reading.provinceName ?? "Indonesia";
  const today = jakartaToday(q.today ?? new Date());
  const behind = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(newest + "T00:00:00Z")) / 86400000);
  const notes: string[] = [];
  if (behind >= 5) notes.push(`Old data: the newest day PIHPS holds for this food is ${newest}, ${behind} days ago.`);
  notes.push("Survey average in traditional markets, not a receipt. The feed gives no unit; the price is read as rupiah per kilogram.");

  const recent = [...series.days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-7).map(([date, v]) => ({ date, value: v }));
  return buildStatisticAnswer({
    ...base,
    value,
    unit: d.unit,
    period: { from: newest, to: newest },
    reference_period: newest,
    note: notes.join(" "),
    published: newest,
    describe: (v) =>
      `In ${where} the average market price of "${d.label}" was ${idr(v)} per kg on ${newest}` +
      ` (Bank Indonesia PIHPS market price survey, not receipts).` +
      (week ? ` That is ${week.change_percent === 0 ? "unchanged from" : `${Math.abs(week.change_percent)}% ${week.change_percent > 0 ? "higher" : "lower"} than on`} ${week.from_date} (${idr(week.from_value)}).` : "") +
      (year ? ` A year earlier (${year.from_date}) it was ${idr(year.from_value)}, ${year.change_percent === 0 ? "unchanged" : `${Math.abs(year.change_percent)}% ${year.change_percent > 0 ? "lower" : "higher"} than now`}.` : ""),
    extra: {
      country_name: "Indonesia",
      area: where,
      item: { definition: d.label, unit: d.unit, pihps_name: series.name, asked_for: q.item },
      what_this_is: "Average market price recorded by Bank Indonesia's PIHPS price survey in traditional markets. Not a receipt and not the price at any one stall.",
      reference_day: newest,
      change_on_week_earlier: week ? { reference_day: week.from_date, value: week.from_value, change_percent: week.change_percent, change_amount: week.change_amount } : null,
      change_on_year_earlier: year ? { reference_day: year.from_date, value: year.from_value, change_percent: year.change_percent, change_amount: year.change_amount } : null,
      recent_days: recent,
      other_definitions: related.map((r) => ({ item: r.words[0], definition: r.label, unit: r.unit })),
      dataset: { title: INFO.name, url: INFO.homepage },
    },
  });
}

// ---------- the request ----------

export interface IdOptions { getter?: (url: string) => Promise<unknown>; timeoutMs?: number }

export async function readGrids(today: Date, provinceId: number | undefined, o: IdOptions = {}): Promise<{ current: Map<string, IdSeries>; yearAgo: Map<string, IdSeries> | null }> {
  const get = o.getter ?? ((url: string) => fetchJson(url, {}, o.timeoutMs ?? 20000));
  const end = addDays(jakartaToday(today), -1);
  const current = parseGrid(await get(gridUrl(addDays(end, -9), end, provinceId)));
  const newest = [...current.values()].flatMap((s) => [...s.days.keys()]).sort().pop();
  let yearAgo: Map<string, IdSeries> | null = null;
  if (newest) {
    try { yearAgo = parseGrid(await get(gridUrl(addDays(newest, -368), addDays(newest, -362), provinceId))); } catch { yearAgo = null; }
  }
  return { current, yearAgo };
}

export async function idBiPihps(input: IdQuery, o: IdOptions = {}): Promise<PriceAnswer> {
  const item = input.item?.trim();
  if (!item) throw new InputError("item is required: a staple food such as 'rice', 'eggs', 'chicken', 'chilli', 'cooking oil' or 'sugar'.");
  let province: { id: number; name: string } | null = null;
  if (input.region && !NATIONAL_WORDS.has(norm(input.region))) {
    province = matchProvince(input.region);
    if (!province) throw new InputError(`region "${input.region}" is not an Indonesian province PIHPS publishes. Use one of: ${PROVINCES.map((p) => p.name).join(", ")}; or leave it out for the national average.`);
  }
  const m = matchItem(ITEMS, item);
  if (!m.primary) return idAnswer(null, null, [], input);
  const g = await readGrids(input.today ?? new Date(), province?.id, o);
  return idAnswer({ ...g, provinceName: province?.name ?? null }, m.primary, m.related, input);
}
