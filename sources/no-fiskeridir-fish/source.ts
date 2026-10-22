// Norway: first-hand fish sales (what fishers were paid per kg), from the Fiskeridirektoratet open catch-note data
// "Fangstdata koblet med fartoydata" (https://register.fiskeridir.no/uttrekk/fangstdata_<YEAR>.csv.zip). Header and rows checked live on
// 2026-10-22 through the GitHub probe (the 2000 file; every year has the same columns). One zip per catch year holds one CSV
// (UTF-8 with BOM, ';' separated, decimal comma, dates dd.mm.yyyy, one row per species line of a sales note, about 1 GB a year).
// The file is far too big to read per request, so harvest() streams it once a day on GitHub Actions, keeps only the newest week of
// landings as aggregates, and every answer comes from the price library. No vessel, fisher or buyer field is ever read into a result.
import { createInflateRaw } from "node:zlib";
import { Readable } from "node:stream";
import { once } from "node:events";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH, summarise } from "../../lib/stats";
import { NATIONAL } from "../../lib/library/aggregate";
import { readLatestDay } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const ATTRIBUTION_LINE =
  "Source: Fiskeridirektoratet (Norwegian Directorate of Fisheries), Fangstdata koblet med fartoydata, NLOD. Changed by ProofPrice: for each species and product form we take the landings of the newest 7 days and report the median and 10th to 90th percentile of the price per kg paid to fishers.";

export const INFO: SourceInfo = {
  id: "no-fiskeridir-fish",
  country: "NO (Norway)",
  category: "wholesale fresh food (first-hand fish sales: price paid to fishers)",
  name: "Fish sales notes, first-hand prices (Fiskeridirektoratet)",
  publisher: "Fiskeridirektoratet (Norwegian Directorate of Fisheries)",
  what_is_recorded:
    "For each species line of a fish sales note (sluttseddel) for fish landed in Norway: the unit price in NOK per kg that the fisher was paid by the buyer at first-hand sale, for one product form (for example gutted without head). Published only as a median and range over at least 5 sales notes; never one vessel, fisher or buyer.",
  price_type: "transaction",
  freshness: "The Directorate rebuilds the current year's file nightly (not on Friday night); our copy is refreshed daily and each answer names the landing days it covers",
  licence: "Norwegian Licence for Open Government Data (NLOD 2.0): free use including commercial use, with attribution; no suggestion that the Directorate endorses the service",
  licence_url: "https://www.fiskeridir.no/statistikk-tall-og-analyse/lisens-for-bruk-av-fiskeridirektoratets-data",
  attribution: ATTRIBUTION_LINE,
  homepage: "https://www.fiskeridir.no/statistikk-tall-og-analyse/data-og-statistikk-om-yrkesfiske",
  limits:
    "First-hand prices paid to fishers at landing, not wholesale, shop or restaurant prices. The price is per kg of the product form named in the answer (round, gutted, headed...), so different forms of one species differ. Only landings in Norway counted; quality grades are mixed. " +
    "A cell needs 5 or more different sales notes. Prices before any later correction of a sales note may differ slightly. The Directorate gives no warranty and does not endorse ProofPrice.",
};

export const FILE_URL = (year: number) => `https://register.fiskeridir.no/uttrekk/fangstdata_${year}.csv.zip`;
export const WINDOW_DAYS = 7; // the newest 7 landing days (ending on the newest day with enough sales) form one library day
export const LOOKBACK_DAYS = 30; // landings older than this are not kept in memory
export const MIN_DAY_LINES = 20; // a day counts as "newest" only when at least this many valid lines landed on it
export const STALE_AFTER_DAYS = 14;
const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

// ---------- zip streaming ----------

/** Pure: bytes of a zip's first entry with the local header (30 bytes + name + extra) removed, as an async stream. Sizes in the header are not
 *  trusted (streamed zips write them as zero and put them after the data): the deflate stream ends by itself. */
export async function* skipLocalHeader(src: AsyncIterable<Uint8Array>): AsyncGenerator<Buffer> {
  let head = Buffer.alloc(0);
  let need = -1;
  for await (const chunk of src) {
    const c = Buffer.from(chunk);
    if (need < 0) {
      head = Buffer.concat([head, c]);
      if (head.length < 30) continue;
      if (head.readUInt32LE(0) !== 0x04034b50) throw new SourceError("The Fiskeridirektoratet download is not a zip file");
      const method = head.readUInt16LE(8);
      if (method !== 8) throw new SourceError(`The Fiskeridirektoratet zip uses an unsupported method (${method})`);
      need = 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      if (head.length < need) continue;
      const rest = head.subarray(need);
      head = Buffer.alloc(0);
      if (rest.length) yield rest;
    } else if (head.length && head.length < need) {
      head = Buffer.concat([head, c]);
      if (head.length >= need) {
        const rest = head.subarray(need);
        head = Buffer.alloc(0);
        if (rest.length) yield rest;
      }
    } else {
      yield c;
    }
  }
  if (need < 0 || head.length) throw new SourceError("The Fiskeridirektoratet zip ended before its first file started");
}

/** Pure-ish: inflate a zip's first entry and hand it over line by line (BOM removed, UTF-8). Memory stays small whatever the file size. */
export async function forEachZipLine(src: AsyncIterable<Uint8Array>, onLine: (line: string) => void): Promise<number> {
  const inflate = createInflateRaw();
  const decoder = new TextDecoder("utf-8");
  let tail = "";
  let lines = 0;
  let first = true;
  let ended = false;
  inflate.on("end", () => { ended = true; });
  // Feed the inflater with back-pressure. When the deflate stream ends, whatever follows (the zip's central directory) is not read further.
  const feeder = (async () => {
    try {
      for await (const c of skipLocalHeader(src)) {
        if (ended || inflate.destroyed) break;
        if (!inflate.write(c)) await Promise.race([once(inflate, "drain"), once(inflate, "close")]);
      }
      if (!inflate.destroyed) inflate.end();
    } catch (err) {
      inflate.destroy(err as Error);
    }
  })();
  const emit = (text: string) => {
    tail += text;
    let at: number;
    let from = 0;
    while ((at = tail.indexOf("\n", from)) >= 0) {
      let line = tail.slice(from, at);
      from = at + 1;
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (first) {
        line = line.replace(/^﻿/, "");
        first = false;
      }
      lines++;
      onLine(line);
    }
    tail = tail.slice(from);
  };
  for await (const chunk of inflate) emit(decoder.decode(chunk as Buffer, { stream: true }));
  await feeder;
  emit(decoder.decode());
  if (tail.length) {
    lines++;
    onLine(tail.replace(/\r$/, ""));
    tail = "";
  }
  return lines;
}

// ---------- parsing ----------

/** One ';' separated line into cells; a cell may be quoted ("" is a quote). */
export function splitSemi(line: string): string[] {
  if (!line.includes('"')) return line.split(";");
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ";") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/ø/g, "o").replace(/æ/g, "ae").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
export const num = (s: string | undefined): number => {
  const t = (s ?? "").trim().replace(/\s/g, "").replace(",", ".");
  return t === "" ? NaN : Number(t);
};
/** dd.mm.yyyy to yyyy-mm-dd, or null. */
export function isoFromNo(s: string | undefined): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec((s ?? "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export interface Columns {
  doc: number;
  date: number;
  county: number;
  nation: number;
  species: number;
  form: number;
  weight: number;
  price: number;
}

/** Column positions from the header row, by name, so a reordered file still works. Throws with the header when a column is missing. */
export function readHeader(line: string): Columns {
  const cells = splitSemi(line).map(norm);
  const at = (name: string) => cells.indexOf(norm(name));
  const cols: Columns = {
    doc: at("Dokumentnummer"),
    date: at("Landingsdato"),
    county: at("Landingsfylke"),
    nation: at("Landingsnasjon (kode)"),
    species: at("Art"),
    form: at("Produkttilstand"),
    weight: at("Produktvekt"),
    price: at("Enhetspris for fisker"),
  };
  const missing = Object.entries(cols).filter(([, v]) => v < 0).map(([k]) => k);
  if (missing.length) {
    throw new SourceError(`The Fiskeridirektoratet file changed: column(s) ${missing.join(", ")} not found; this source needs updating.`, `header: ${cells.slice(0, 40).join("|")}`);
  }
  return cols;
}

export interface Sale {
  doc: string;
  date: string; // yyyy-mm-dd landing date
  county: string;
  species: string;
  form: string;
  price: number; // NOK per kg of product weight
}

/** Pure: one data row into a sale, or null when it is not usable (landed abroad, no price or weight, bad date). Reads no vessel, fisher or buyer field. */
export interface Diag {
  lines: number;
  usable: number;
  newestDate: string;
  nations: Map<string, number>;
}
export const newDiag = (): Diag => ({ lines: 0, usable: 0, newestDate: "", nations: new Map() });
export const diagText = (d: Diag) =>
  `read ${d.lines} lines, ${d.usable} usable Norwegian sales; newest landing date in the file ${d.newestDate || "none"}; landing nations ${[...d.nations].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k || "(empty)"}=${v}`).join(", ") || "none"}`;

export function parseSale(line: string, c: Columns, diag?: Diag): Sale | null {
  const f = splitSemi(line);
  if (diag) {
    diag.lines++;
    const nat = (f[c.nation] ?? "").trim().toUpperCase();
    diag.nations.set(nat, (diag.nations.get(nat) ?? 0) + 1);
    const d = isoFromNo(f[c.date]);
    if (d && d > diag.newestDate) diag.newestDate = d;
  }
  if (f.length <= c.price) return null;
  if ((f[c.nation] ?? "").trim().toUpperCase() !== "NOR") return null;
  const date = isoFromNo(f[c.date]);
  const price = num(f[c.price]);
  const weight = num(f[c.weight]);
  const species = (f[c.species] ?? "").trim();
  if (!date || !species || !Number.isFinite(price) || price <= 0 || !Number.isFinite(weight) || weight <= 0) return null;
  if (diag) diag.usable++;
  return { doc: (f[c.doc] ?? "").trim(), date, county: (f[c.county] ?? "").trim(), species, form: (f[c.form] ?? "").trim() || "unspecified", price };
}

export const itemName = (species: string, form: string) => `${species}, ${form}`;

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
const isoOf = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);

/** Pure: library rows for the newest week. Cells (county or Norway, species and product form) with fewer than 5 different sales notes are dropped. */
export function aggregateSales(sales: Sale[], today: string): { date: string; rows: DailyRow[]; sales: number } | null {
  const lastOk = dayNumber(today);
  const perDay = new Map<string, number>();
  for (const s of sales) if (dayNumber(s.date) <= lastOk) perDay.set(s.date, (perDay.get(s.date) ?? 0) + 1);
  const newest = [...perDay.entries()].filter(([, n]) => n >= MIN_DAY_LINES).map(([d]) => d).sort().pop();
  if (!newest) return null;
  const from = isoOf(dayNumber(newest) - (WINDOW_DAYS - 1));
  const cells = new Map<string, { area: string; item: string; prices: number[]; docs: Set<string> }>();
  const add = (area: string, item: string, s: Sale) => {
    const k = `${area}\u0000${item}`;
    let cell = cells.get(k);
    if (!cell) cells.set(k, (cell = { area, item, prices: [], docs: new Set() }));
    cell.prices.push(s.price);
    cell.docs.add(s.doc || `${s.date}#${cell.prices.length}`);
  };
  let used = 0;
  for (const s of sales) {
    if (s.date < from || s.date > newest) continue;
    used++;
    const item = itemName(s.species, s.form);
    add(NATIONAL, item, s);
    if (s.county) add(s.county, item, s);
  }
  const rows: DailyRow[] = [];
  for (const cell of cells.values()) {
    if (cell.docs.size < MIN_PUBLISH) continue;
    const sum = summarise(cell.prices);
    if (!sum) continue;
    rows.push({ area: cell.area, item: cell.item, n: cell.docs.size, median: sum.median, low: sum.low, high: sum.high, min: sum.min, max: sum.max });
  }
  rows.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
  return { date: newest, rows, sales: used };
}

// ---------- harvest ----------

export type Opener = (year: number) => Promise<AsyncIterable<Uint8Array>>;

export const openYear: Opener = async (year) => {
  let res: Response;
  try {
    res = await fetch(FILE_URL(year), { headers: UA, signal: AbortSignal.timeout(25 * 60 * 1000) });
  } catch (err: any) {
    throw new SourceError("Could not reach Fiskeridirektoratet", String(err?.cause?.code ?? err?.message ?? err));
  }
  if (!res.ok || !res.body) throw new SourceError(`Fiskeridirektoratet returned HTTP ${res.status} for the ${year} file`, undefined, res.status);
  return Readable.fromWeb(res.body as any);
};

/** Reads one year's file and keeps only the sales within LOOKBACK_DAYS of the newest landing date seen so far (so the file's own newest day
 *  decides, not today's date: a file that lags behind still gives its newest week). Memory stays small whatever the file size. */
export async function readYear(open: Opener, year: number, diag: Diag = newDiag(), today: string = new Date().toISOString().slice(0, 10)): Promise<Sale[]> {
  let sales: Sale[] = [];
  let cols: Columns | null = null;
  let newest = "";
  let sincePrune = 0;
  const prune = () => {
    const from = isoOf(dayNumber(newest) - LOOKBACK_DAYS);
    sales = sales.filter((x) => x.date >= from);
    sincePrune = 0;
  };
  await forEachZipLine(await open(year), (line) => {
    if (!line) return;
    if (!cols) {
      cols = readHeader(line);
      return;
    }
    const s = parseSale(line, cols, diag);
    if (!s) return;
    if (s.date > newest && s.date <= today) newest = s.date;
    sales.push(s);
    if (++sincePrune >= 100000 && newest) prune();
  });
  if (!cols) throw new SourceError("The Fiskeridirektoratet file was empty");
  if (newest) prune();
  return sales;
}

export async function fishHarvest(now: Date = new Date(), open: Opener = openYear): Promise<HarvestResult> {
  const today = now.toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  const years = [year];
  if (dayNumber(today) - dayNumber(`${year}-01-01`) < LOOKBACK_DAYS) years.unshift(year - 1); // early January: last year's file still holds the last landings
  const diag = newDiag();
  const sales: Sale[] = [];
  for (const y of years) sales.push(...(await readYear(open, y, diag, today)));
  const agg = aggregateSales(sales, today);
  if (!agg || !agg.rows.length) throw new SourceError(`Fiskeridirektoratet's file holds no landings with enough sales to publish (${diagText(diag)})`);
  return {
    date: agg.date,
    currency: "NOK",
    unit: "per kg product weight",
    rows: agg.rows,
    note: `Fiskeridirektoratet sales notes for fish landed in Norway, landings ${isoOf(dayNumber(agg.date) - (WINDOW_DAYS - 1))} to ${agg.date}: price paid to fishers per kg of the named product form; n is the number of different sales notes (5 or more needed); county rows use the landing county. ${diagText(diag)}.`,
  };
}

// ---------- answering from the library ----------

/** English fish names to the Norwegian names used in the file. */
export const ENGLISH: Record<string, string> = {
  cod: "torsk", "atlantic cod": "torsk", haddock: "hyse", saithe: "sei", pollock: "sei", coalfish: "sei", herring: "sild", mackerel: "makrell",
  salmon: "laks", halibut: "kveite", monkfish: "breiflabb", anglerfish: "breiflabb", shrimp: "reker", prawn: "reker", "king crab": "kongekrabbe",
  capelin: "lodde", "blue whiting": "kolmule", ling: "lange", tusk: "brosme", redfish: "uer", plaice: "rodspette", "greenland halibut": "blalange",
  wolffish: "steinbit", catfish: "steinbit", squid: "blekksprut", scallop: "kamskjell", "snow crab": "snokrabbe", "brown crab": "taskekrabbe",
  trout: "orret", "atlantic herring": "sild", whiting: "hviting", skate: "skate", flounder: "skrubbe", turbot: "piggvar",
};

export function wanted(product: string): string[] {
  const q = norm(product);
  const mapped = ENGLISH[q] ?? ENGLISH[q.replace(/s$/, "")] ?? q;
  return norm(mapped).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
}

export interface Def {
  key: string;
  species: string;
  form: string;
  row: DailyRow;
}

export function defsFor(rows: DailyRow[], area: string): Def[] {
  const out: Def[] = [];
  for (const r of rows) {
    if (r.area !== area || r.n < MIN_PUBLISH) continue;
    const at = r.item.indexOf(", ");
    out.push({ key: r.item, species: at < 0 ? r.item : r.item.slice(0, at), form: at < 0 ? "" : r.item.slice(at + 2), row: r });
  }
  return out;
}

/** Species whose name starts with (or contains as a whole word) all the wanted words, best-supported product form first. */
export function matchDefs(defs: Def[], product: string): Def[] {
  const words = wanted(product);
  if (!words.length) return [];
  const score = (d: Def) => {
    const name = norm(d.species);
    const tokens = name.split(/[^a-z0-9]+/);
    if (!words.every((w) => tokens.some((t) => t === w || t.startsWith(w)))) return 0;
    return (tokens[0] === words[0] ? 3 : 1) + (name === words.join(" ") ? 2 : 0);
  };
  return defs
    .map((d) => ({ d, s: score(d) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.d.row.n - a.d.row.n || a.d.key.localeCompare(b.d.key))
    .map((x) => x.d);
}

export function resolveCounty(rows: DailyRow[], region: string): string | null {
  const counties = [...new Set(rows.map((r) => r.area))].filter((a) => a !== NATIONAL);
  const q = norm(region);
  if (!q) return null;
  return counties.find((c) => norm(c) === q) ?? counties.find((c) => norm(c).startsWith(q) || norm(c).includes(q)) ?? null;
}

const methodText = () =>
  "Median and 10th–90th percentile of the price per kg that fishers were paid at first-hand sale, from Fiskeridirektoratet's fish sales notes for fish landed in Norway during the newest 7 landing days, in Norwegian kroner. " +
  "One species in one product form (for example gutted without head); n is the number of different sales notes (5 or more needed).";

export interface LibraryDay {
  date: string;
  rows: DailyRow[];
}

export function fishAnswerFromRows(day: LibraryDay, input: { product?: string; region?: string; baseUrl?: string; today?: string }): PriceAnswer {
  const product = (input.product ?? "").trim();
  if (!product) throw new InputError("product is required: a fish in English or Norwegian, e.g. 'cod' (torsk), 'haddock' (hyse), 'herring' (sild), 'mackerel' (makrell), 'saithe' (sei).");
  const region = (input.region ?? "").trim();
  let area = NATIONAL;
  let place = "Norway";
  if (region) {
    const c = resolveCounty(day.rows, region);
    if (!c) {
      const counties = [...new Set(day.rows.map((r) => r.area))].filter((a) => a !== NATIONAL).sort();
      throw new InputError(`region '${region}' has no figures in our copy (not a Norwegian landing county, or no fish sold in 5 or more sales notes there). Counties with figures: ${counties.join(", ")}. Leave region out for the national figure.`);
    }
    area = c;
    place = c;
  }
  const to = day.date;
  const from = isoOf(dayNumber(day.date) - (WINDOW_DAYS - 1));
  const query = { country: "NO", product, ...(region ? { region: place } : {}) };
  const hits = matchDefs(defsFor(day.rows, area), product);
  if (!hits.length) {
    const nat = matchDefs(defsFor(day.rows, NATIONAL), product);
    const names = [...new Set(defsFor(day.rows, NATIONAL).map((d) => d.species))].sort().slice(0, 40);
    return buildAnswer({
      source: INFO, query, summary: null, currency: "NOK", unit: "per kg", period: { from, to }, method: methodText(), describe: () => "", baseUrl: input.baseUrl,
      extra: {
        hint:
          area !== NATIONAL && nat.length
            ? `Fewer than 5 sales notes in ${place} for '${product}' in the newest 7 landing days. Leave region out for the national figure.`
            : `No species matching '${product}' was sold in 5 or more sales notes in the newest 7 landing days. Species held include: ${names.join(", ")}.`,
      },
    });
  }
  const best = hits[0];
  const r = best.row;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const age = dayNumber(today) - dayNumber(day.date);
  const stale = age > STALE_AFTER_DAYS;
  const others = hits.slice(1, 9).map((d) => `${d.species}, ${d.form}`);
  return buildAnswer({
    source: INFO,
    query: { ...query, product: `${best.species}, ${best.form}` },
    summary: { count: r.n, median: r.median, low: r.low, high: r.high, min: r.min, max: r.max },
    currency: "NOK",
    unit: `per kg (${best.form || "product weight"})`,
    period: { from, to },
    method: methodText(),
    describe: (x) =>
      `Fishers landing in ${place} were paid a median of ${fmtMoney(x.median, "NOK")} per kg for ${best.species.toLowerCase()} (${best.form.toLowerCase()}); ` +
      `10th–90th percentile ${fmtMoney(x.low, "NOK")}–${fmtMoney(x.high, "NOK")}, landings ${from} to ${to}. ` +
      `This is the first-hand price paid to the fisher, not a wholesale, shop or restaurant price.` +
      (stale ? ` The newest landings in the Directorate's file are ${age} days old.` : ""),
    evidence: { label: "First-hand sales notes", meaning: "Prices from official fish sales notes (what the buyer paid the fisher at first sale); the sample size is the number of different sales notes." },
    extra: {
      sales_notes: r.n,
      area: place,
      species: best.species,
      product_form: best.form,
      ...(others.length ? { other_matches: others } : {}),
      ...(stale ? { stale: true, days_since_collected: age } : {}),
      attribution_notice: ATTRIBUTION_LINE,
    },
  });
}

export async function fishPrices(input: { product?: string; region?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("ProofPrice collects the Fiskeridirektoratet fish sales file daily; data appears after the next collection.");
  return fishAnswerFromRows(day, input);
}

export function fishHistoryKey(p: { product?: string; region?: string }): { area: string; item: string; label: string } | null {
  try {
    const day = readLatestDay(INFO.id);
    if (!day || !p.product) return null;
    const area = p.region ? resolveCounty(day.rows, String(p.region)) : NATIONAL;
    if (!area) return null;
    const best = matchDefs(defsFor(day.rows, area), String(p.product))[0];
    return best ? { area, item: best.key, label: `${best.species} (${best.form}), ${area === NATIONAL ? "Norway" : area}` } : null;
  } catch {
    return null;
  }
}
