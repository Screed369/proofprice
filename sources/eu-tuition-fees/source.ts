// European higher-education tuition fees from Eurydice (European Commission / EACEA), "National Student Fee and Support Systems"
// open-data workbook. One xlsx, one reference academic year (2023/24 in the 2025 release), 37 European systems.
//
// The sheet "Fees_sub-topic 5" gives, per country, the MINIMUM, MAXIMUM (standard length of study) and MOST COMMON annual fee
// in national currency, split by cycle (first / second), student category and full-time / part-time. These are posted statutory
// fee levels, not prices paid by sampled students: no sample size, price type "posted_price".
//
// Format checked live on 2026-10-16 (GitHub Actions probe, HTTP 200, 224 KB, no key):
//   row 4: "Annual fee amount (national currency)|Education cycle|Student category|Student status|BE-FR|BE-DE|BE-NL|BG|CZ|DK|DE|EE|IE|EL|ES|FR|..."
//   "Most common|First cycle|Home students|Full-time|N/A|450|1116|:|250|0|100|0|3000|0|929|170|:|1629|0|..."   (":" = not available, "N/A" = not applicable)
// Sheet "Eurostat data" has the 2023 euro exchange rates ("|SE|11.4788"), used for the euro equivalent.
// The file is annual, 224 KB, and answered from the CDN: it is fetched per request (cached in memory for an hour), no harvest needed.

import { inflateRawSync } from "node:zlib";
import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";
import { fetchBinary } from "./fetch";

export const FILE_URL = "https://eurydice.eacea.ec.europa.eu/sites/default/files/2025-09/Open%20data_2023-2024.xlsx";
export const HOMEPAGE = "https://eurydice.eacea.ec.europa.eu/interactive-publication";
export const FEES_SHEET = "Fees_sub-topic 5";
export const RATES_SHEET = "Eurostat data";

export const INFO: SourceInfo = {
  id: "eu-tuition-fees",
  country: "Europe (EU, EEA, candidate and other Eurydice countries)",
  category: "tuition (posted annual university fees)",
  name: "Eurydice: National Student Fee and Support Systems in European Higher Education (open data)",
  publisher: "Eurydice network, European Education and Culture Executive Agency (EACEA), European Commission",
  what_is_recorded:
    "For each country, the minimum, maximum and most common annual tuition fee charged to students in public higher education, by degree cycle (bachelor's / master's), student category (home, international, self-financed, specific discipline, foreign-language) and full-time or part-time study, in national currency, for one academic year. Policy fee levels, not individual payments.",
  price_type: "posted_price",
  freshness: "Academic year 2023/24 (Eurydice release of September 2025); updated about once a year",
  licence:
    "(c) European Union 2025. Reuse is authorised under the European Commission reuse policy (Decision 2011/833/EU, equivalent to CC BY 4.0) with attribution; see the Commission legal notice.",
  licence_url: "https://commission.europa.eu/legal-notice_en",
  attribution: "Source: Eurydice, European Education and Culture Executive Agency, (c) European Union 2025 (National Student Fee and Support Systems in European Higher Education, 2023/24).",
  homepage: HOMEPAGE,
  limits:
    "Posted statutory fee levels for one academic year, not what students actually paid: many students pay less (grants, waivers) or nothing. The most common fee is a policy value, not a median of payments, and there is no sample size. Fees are for public institutions in national currency; the euro equivalent uses the 2023 average exchange rate from Eurostat. Where the publisher shows a colon the figure is not available; N/A means the category does not exist in that country. Belgium has three systems (French, German- and Flemish-speaking communities).",
};

// ---------- reading an xlsx without a dependency ----------

/** Unzip the named entries of a zip archive held in memory (stored or deflate). */
export function unzip(buf: Buffer, want: (name: string) => boolean): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SourceError("The Eurydice file is not a zip archive; the format may have changed and this source needs updating.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
  }
  return out;
}

const unescapeXml = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

const textOf = (xml: string): string => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join("");

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** One worksheet as rows of strings (blank cells are ""). */
export function parseSheetXml(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const body = rm[1];
    if (!body) continue;
    const rowNo = Number(/\br="(\d+)"/.exec(rm[0])?.[1] ?? rows.length + 1);
    const cells: string[] = [];
    for (const cm of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const inner = cm[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const idx = ref ? colIndex(ref) : cells.length;
      let v = "";
      if (type === "s") v = shared[Number(/<v>(\d+)<\/v>/.exec(inner)?.[1])] ?? "";
      else if (type === "inlineStr") v = textOf(inner);
      else v = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
      while (cells.length < idx) cells.push("");
      cells[idx] = v.trim();
    }
    while (rows.length < rowNo - 1) rows.push([]);
    rows[rowNo - 1] = cells;
  }
  return rows;
}

/** Every sheet of the workbook as { name -> rows }. */
export function readWorkbook(buf: Buffer): Map<string, string[][]> {
  const files = unzip(buf, (n) => n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const wb = files.get("xl/workbook.xml")?.toString("utf8");
  const rels = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8");
  if (!wb || !rels) throw new SourceError("The Eurydice workbook has no sheet list; the format may have changed and this source needs updating.");
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1])?.[1];
    const t = /\bTarget="([^"]+)"/.exec(m[1])?.[1];
    if (id && t) target.set(id, t.replace(/^\/?(xl\/)?/, "xl/"));
  }
  const shared = [...(files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "").matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) => textOf(m[1] ?? ""));
  const out = new Map<string, string[][]>();
  for (const m of wb.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const name = unescapeXml(/\bname="([^"]*)"/.exec(m[1])?.[1] ?? "");
    const rid = /\br:id="([^"]+)"/.exec(m[1])?.[1];
    const path = rid ? target.get(rid) : undefined;
    const xml = path ? files.get(path)?.toString("utf8") : undefined;
    if (name && xml) out.set(name, parseSheetXml(xml, shared));
  }
  return out;
}

// ---------- the fee table ----------

export interface FeeRow {
  measure: "minimum" | "maximum" | "common";
  cycle: "first" | "second";
  group: "home" | "international" | "non-state-subsidised" | "specific-discipline" | "foreign-language";
  mode: "full-time" | "part-time";
  values: Record<string, string>; // column code ("IE", "BE-FR", "EL") -> raw cell
}

export interface FeeTable {
  academicYear: string; // "2023/2024"
  rows: FeeRow[];
  rates: Record<string, number>; // normalised key ("IE", "BEFR") -> national currency units per euro
}

const normKey = (s: string): string => s.replace(/[^A-Za-z]/g, "").toUpperCase();

function measureOf(label: string): FeeRow["measure"] | null {
  const l = label.toLowerCase();
  if (l.startsWith("minimum")) return "minimum";
  if (l.startsWith("most common")) return "common";
  if (l.startsWith("maximum") && /standard/.test(l)) return "maximum"; // not the "insufficient credits / extended length" rows
  return null;
}
function groupOf(label: string): FeeRow["group"] | null {
  const l = label.toLowerCase();
  if (l.startsWith("home")) return "home";
  if (l.startsWith("international")) return "international";
  if (l.includes("non-state")) return "non-state-subsidised";
  if (l.includes("specific discipline")) return "specific-discipline";
  if (l.includes("foreign language")) return "foreign-language";
  return null;
}

export function parseFeeTable(sheets: Map<string, string[][]>): FeeTable {
  const fees = sheets.get(FEES_SHEET);
  if (!fees) throw new SourceError(`The Eurydice workbook has no sheet "${FEES_SHEET}"; the format may have changed and this source needs updating.`);
  const headerAt = fees.findIndex((r) => /^annual fee amount/i.test(r[0] ?? ""));
  if (headerAt < 0) throw new SourceError("The Eurydice fee sheet has no header row; the format may have changed and this source needs updating.");
  const header = fees[headerAt];
  const academicYear = fees.slice(0, headerAt).map((r) => /(\d{4}\/\d{4})/.exec(r[0] ?? "")?.[1]).find(Boolean) ?? "2023/2024";
  const rows: FeeRow[] = [];
  for (const r of fees.slice(headerAt + 1)) {
    const measure = measureOf(r[0] ?? "");
    const cycle = /^first/i.test(r[1] ?? "") ? "first" : /^second/i.test(r[1] ?? "") ? "second" : null;
    const group = groupOf(r[2] ?? "");
    const mode = /^full/i.test(r[3] ?? "") ? "full-time" : /^part/i.test(r[3] ?? "") ? "part-time" : null;
    if (!measure || !cycle || !group || !mode) continue;
    const values: Record<string, string> = {};
    for (let i = 4; i < header.length; i++) if (header[i]) values[header[i]] = (r[i] ?? "").trim();
    rows.push({ measure, cycle, group, mode, values });
  }
  if (rows.length < 40) throw new SourceError(`Only ${rows.length} usable rows in the Eurydice fee sheet; the format may have changed and this source needs updating.`);
  const rates: Record<string, number> = {};
  for (const r of sheets.get(RATES_SHEET) ?? []) {
    const code = (r[1] ?? "").trim();
    const rate = Number(r[2]);
    if (/^[A-Z]{2}(\s[a-z]{2})?$/.test(code) && Number.isFinite(rate) && rate > 0) rates[normKey(code)] = rate;
  }
  return { academicYear, rows, rates };
}

// ---------- countries ----------

/** ISO code -> { name, currency, columns in the Eurydice sheet }. Belgium has three communities. */
export const COUNTRY: Record<string, { name: string; currency: string; columns: string[] }> = {
  BE: { name: "Belgium", currency: "EUR", columns: ["BE-FR", "BE-DE", "BE-NL"] },
  BG: { name: "Bulgaria", currency: "BGN", columns: ["BG"] },
  CZ: { name: "Czechia", currency: "CZK", columns: ["CZ"] },
  DK: { name: "Denmark", currency: "DKK", columns: ["DK"] },
  DE: { name: "Germany", currency: "EUR", columns: ["DE"] },
  EE: { name: "Estonia", currency: "EUR", columns: ["EE"] },
  IE: { name: "Ireland", currency: "EUR", columns: ["IE"] },
  GR: { name: "Greece", currency: "EUR", columns: ["EL"] },
  ES: { name: "Spain", currency: "EUR", columns: ["ES"] },
  FR: { name: "France", currency: "EUR", columns: ["FR"] },
  HR: { name: "Croatia", currency: "EUR", columns: ["HR"] },
  IT: { name: "Italy", currency: "EUR", columns: ["IT"] },
  CY: { name: "Cyprus", currency: "EUR", columns: ["CY"] },
  LV: { name: "Latvia", currency: "EUR", columns: ["LV"] },
  LT: { name: "Lithuania", currency: "EUR", columns: ["LT"] },
  LU: { name: "Luxembourg", currency: "EUR", columns: ["LU"] },
  HU: { name: "Hungary", currency: "HUF", columns: ["HU"] },
  MT: { name: "Malta", currency: "EUR", columns: ["MT"] },
  NL: { name: "Netherlands", currency: "EUR", columns: ["NL"] },
  AT: { name: "Austria", currency: "EUR", columns: ["AT"] },
  PL: { name: "Poland", currency: "PLN", columns: ["PL"] },
  PT: { name: "Portugal", currency: "EUR", columns: ["PT"] },
  RO: { name: "Romania", currency: "RON", columns: ["RO"] },
  SI: { name: "Slovenia", currency: "EUR", columns: ["SI"] },
  SK: { name: "Slovakia", currency: "EUR", columns: ["SK"] },
  FI: { name: "Finland", currency: "EUR", columns: ["FI"] },
  SE: { name: "Sweden", currency: "SEK", columns: ["SE"] },
  AL: { name: "Albania", currency: "ALL", columns: ["AL"] },
  BA: { name: "Bosnia and Herzegovina", currency: "BAM", columns: ["BA"] },
  CH: { name: "Switzerland", currency: "CHF", columns: ["CH"] },
  IS: { name: "Iceland", currency: "ISK", columns: ["IS"] },
  LI: { name: "Liechtenstein", currency: "CHF", columns: ["LI"] },
  ME: { name: "Montenegro", currency: "EUR", columns: ["ME"] },
  MK: { name: "North Macedonia", currency: "MKD", columns: ["MK"] },
  NO: { name: "Norway", currency: "NOK", columns: ["NO"] },
  RS: { name: "Serbia", currency: "RSD", columns: ["RS"] },
  TR: { name: "Turkey", currency: "TRY", columns: ["TR"] },
};

const COMMUNITY: Record<string, string> = {
  fr: "BE-FR", french: "BE-FR", wallonia: "BE-FR", "french community": "BE-FR", "fédération wallonie-bruxelles": "BE-FR",
  de: "BE-DE", german: "BE-DE", "german-speaking": "BE-DE", "german community": "BE-DE",
  nl: "BE-NL", flemish: "BE-NL", flanders: "BE-NL", dutch: "BE-NL", "flemish community": "BE-NL",
};

export interface TuitionInput {
  country: string;
  cycle?: string;
  student_group?: string;
  study_mode?: string;
  community?: string;
  baseUrl?: string;
}

const GROUP_TEXT: Record<FeeRow["group"], string> = {
  home: "home students",
  international: "international students",
  "non-state-subsidised": "students on non-state-subsidised (self-financed) places",
  "specific-discipline": "students in specific disciplines",
  "foreign-language": "students in foreign-language programmes",
};

/** A published cell as a number: "3000" -> 3000, ":" / "N/A" / "na" / "nd" -> null. */
export function feeCell(s: string | undefined): number | null {
  if (s === undefined) return null;
  const n = Number(s.trim());
  return s.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
}

const fmt = (v: number, currency: string): string => `${Math.round(v * 100) / 100 === Math.round(v) ? Math.round(v).toLocaleString("en-GB") : (Math.round(v * 100) / 100).toLocaleString("en-GB")} ${currency}`;

/** Pure: the answer from the parsed table. */
export function tuitionAnswer(table: FeeTable, input: TuitionInput): PriceAnswer {
  const iso = input.country.toUpperCase();
  const c = COUNTRY[iso];
  if (!c) throw new InputError(`No Eurydice tuition data for country "${input.country}". Covered: ${Object.keys(COUNTRY).join(", ")}.`);
  let column = c.columns[0];
  let place = c.name;
  if (c.columns.length > 1) {
    const com = input.community?.trim().toLowerCase();
    const hit = com ? COMMUNITY[com] : undefined;
    if (!hit) throw new InputError(`Belgium has three higher-education systems with different fees. Add community=fr (French Community), nl (Flemish Community) or de (German-speaking Community).`);
    column = hit;
    place = `Belgium (${{ "BE-FR": "French", "BE-DE": "German-speaking", "BE-NL": "Flemish" }[hit]} Community)`;
  }
  const cycle = (input.cycle ?? "first") as FeeRow["cycle"];
  const group = (input.student_group ?? "home") as FeeRow["group"];
  const mode = (input.study_mode ?? "full-time") as FeeRow["mode"];
  const pick = (m: FeeRow["measure"]) => table.rows.find((r) => r.measure === m && r.cycle === cycle && r.group === group && r.mode === mode);
  const raw = { min: pick("minimum")?.values[column], max: pick("maximum")?.values[column], common: pick("common")?.values[column] };
  const min = feeCell(raw.min);
  const max = feeCell(raw.max);
  const common = feeCell(raw.common);
  const rate = table.rates[normKey(column)] ?? (c.currency === "EUR" ? 1 : undefined);
  const euro = (v: number | null) => (v === null || !rate ? null : Math.round((v / rate) * 100) / 100);
  const currency = c.currency;
  const label = `${cycle === "first" ? "bachelor's (first cycle)" : "master's (second cycle)"}, ${GROUP_TEXT[group]}, ${mode}`;
  const startYear = Number(table.academicYear.slice(0, 4));
  const period = { from: `${startYear}-09-01`, to: `${startYear + 1}-08-31` };
  const have = common !== null || min !== null || max !== null;
  const notes: string[] = [
    "These are posted annual fee levels for public higher education, not what students paid; grants, waivers and loans are not deducted.",
    `The most common fee is a policy value published by Eurydice, not a median of payments.`,
  ];
  if (common === null && have) notes.push("Eurydice gives no 'most common' fee here, so only the range is shown.");
  if (!have) notes.push(`Eurydice shows no fee (not available or not applicable) for ${label} in ${place}; try another student_group, cycle or study_mode.`);
  const answer = buildStatisticAnswer({
    source: INFO,
    query: { country: iso, cycle, student_group: group, study_mode: mode, ...(c.columns.length > 1 ? { community: column } : {}) },
    value: common !== null && common > 0 ? common : null,
    measure: "average",
    currency,
    unit: "per academic year",
    period,
    reference_period: `${table.academicYear.replace("/", "-")} academic year`,
    low: min,
    high: max,
    method:
      "Europe tuition fees (Eurydice open data, sheet Fees_sub-topic 5): the most common annual tuition fee, with the minimum and the maximum (standard length of study), that public higher-education institutions charge the chosen student category in national currency for the academic year shown. We pass on the published figures; they are posted fee levels, not payments by sampled students, and a euro equivalent is added with the 2023 Eurostat average exchange rate.",
    describe: (v) =>
      `In ${table.academicYear}, the most common annual tuition fee for ${label} in ${place} is ${fmt(v, currency)}` +
      `${currency !== "EUR" && euro(v) !== null ? ` (about ${fmt(euro(v)!, "EUR")})` : ""}` +
      `${min !== null && max !== null && min !== max ? `, within a range of ${fmt(min, currency)} to ${fmt(max, currency)}` : ""}.`,
    note: notes.join(" "),
    baseUrl: input.baseUrl,
    extra: {
      place,
      academic_year: table.academicYear,
      fee_basis: "posted statutory annual fee, national currency",
      student: label,
      most_common_fee: common,
      minimum_fee: min,
      maximum_fee_standard_length: max,
      euro_equivalent: { most_common: euro(common), minimum: euro(min), maximum: euro(max), exchange_rate_per_euro: rate ?? null, rate_year: 2023 },
      raw_cells: raw,
      publisher_codes: "':' = data not available, 'N/A' = category does not exist in that country",
    },
  });
  if (value0(common) || (answer.status === "no_matches" && have)) {
    // A fee of zero (free tuition) or a range without a most-common figure is still a real answer: the generic builder only accepts value > 0.
    answer.status = "ok";
    answer.confidence = "high";
    answer.price = {
      currency,
      unit: "per academic year",
      value: common ?? 0,
      measure: "average",
      median: null,
      typical_low: min,
      typical_high: max,
      min: null,
      max: null,
    };
    answer.summary =
      common === 0
        ? `In ${table.academicYear}, the most common annual tuition fee for ${label} in ${place} is 0 ${currency}: no tuition fee is charged${max ? ` in the typical case (the maximum posted is ${fmt(max, currency)})` : ""}. Official figure published by ${INFO.publisher} for the ${table.academicYear} academic year.`
        : `In ${table.academicYear}, annual tuition fees for ${label} in ${place} range from ${fmt(min ?? 0, currency)} to ${fmt(max ?? min ?? 0, currency)}; Eurydice gives no single most-common fee. Official figures published by ${INFO.publisher} for the ${table.academicYear} academic year.`;
    if (common === null) answer.price.value = max ?? min ?? 0;
  }
  return answer;
}

const value0 = (v: number | null): boolean => v === 0;

// ---------- fetch (cached in memory for an hour) ----------

let cache: { at: number; table: FeeTable } | null = null;

export async function loadTable(load: () => Promise<Buffer> = () => fetchBinary(FILE_URL), now = Date.now()): Promise<FeeTable> {
  if (cache && now - cache.at < 3600_000) return cache.table;
  const table = parseFeeTable(readWorkbook(await load()));
  cache = { at: now, table };
  return table;
}

export async function euTuition(input: TuitionInput, load?: () => Promise<Buffer>): Promise<PriceAnswer> {
  return tuitionAnswer(await loadTable(load), input);
}
