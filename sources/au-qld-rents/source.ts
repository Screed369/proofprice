// Queensland (Australia): median weekly rent of NEW tenancies by postcode and dwelling type, from the rental bonds lodged with the
// Residential Tenancies Authority (RTA). The RTA publishes one Excel workbook (rta-bond-statistics.xlsx, ~6 MB, overwritten every quarter)
// with, per postcode and dwelling ("Flat 1", "House 3", "Townhouse 2" = number of bedrooms), the quarterly MEDIAN weekly rent and the number
// of new bonds lodged. The medians are published, not recomputed: we cannot merge two medians, so each answer is one dwelling type in one postcode.
// The daily collector (harvest) reads the workbook once, keeps the latest quarter for every postcode and dwelling with at least 5 bonds,
// and requests are answered from the price library. Formats checked live on 2026-10-20 through the GitHub probe (Sep Qtr 2026 workbook,
// last updated 15 Oct 2026): sheets "Contents", "1 pc-rents", "2 pc-new-bonds", "3 pc-all-bonds", ...

import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { readDaily, readMeta } from "../../lib/library/store";
import { MIN_PUBLISH } from "../../lib/stats";
import { Cell, readXlsx } from "../../categories/rent/xlsx";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "au-qld-rents",
  country: "AU (Queensland)",
  category: "rent (median rent of new tenancies from rental bonds)",
  name: "RTA bond statistics: median weekly rents of new tenancies by postcode",
  publisher: "Residential Tenancies Authority (RTA), Queensland Government (Australia)",
  what_is_recorded:
    "For each Queensland postcode and dwelling type (flat, house or townhouse, by number of bedrooms) each quarter: the median weekly rent of the new tenancies whose bonds were lodged with the RTA, and the number of new bonds lodged. Aggregates only; never one tenancy or one address.",
  price_type: "official_statistic",
  freshness: "Quarterly; the RTA updates the workbook in April, July, October and January (the September quarter was published on 15 Oct 2026)",
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0), as printed on the Contents sheet of the RTA bond statistics workbook",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Source: © The State of Queensland (Residential Tenancies Authority) 2026, RTA bond statistics (median rents), licensed under Creative Commons Attribution 4.0 (CC BY 4.0). Figures passed on as published; the monthly equivalent is calculated by ProofPrice.",
  homepage: "https://www.rta.qld.gov.au/forms-resources/rta-quarterly-data/median-rents-quarterly-data",
  limits:
    "Queensland only (not the rest of Australia) and by postcode: the RTA also publishes suburbs and local government areas, which are not used yet. Rents of NEW tenancies whose bond was lodged in the quarter, not what sitting tenants pay. The RTA publishes one median per dwelling type and bedroom count (Flat 1-3, House 2-4, Townhouse 2-3), so medians cannot be combined across types; with no type given the answer is the most common dwelling in the postcode. A postcode and dwelling with fewer than 5 new bonds in the quarter gets no figure. No range is published.",
};

export const WORKBOOK_URL = "https://www.rta.qld.gov.au/sites/default/files/2023-04/rta-bond-statistics.xlsx";
const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

export type QldKind = "flat" | "house" | "townhouse";
export const QLD_KINDS: QldKind[] = ["flat", "house", "townhouse"];
/** Dwellings the RTA publishes (digit = bedrooms). */
export const QLD_DWELLINGS: { kind: QldKind; beds: number }[] = [
  { kind: "flat", beds: 1 }, { kind: "flat", beds: 2 }, { kind: "flat", beds: 3 },
  { kind: "house", beds: 2 }, { kind: "house", beds: 3 }, { kind: "house", beds: 4 },
  { kind: "townhouse", beds: 2 }, { kind: "townhouse", beds: 3 },
];

export const qldItem = (kind: QldKind, beds: number) => `${kind}-${beds}`;

const KIND_LABEL: Record<QldKind, string> = { flat: "flat", house: "house", townhouse: "townhouse" };

// ---------- parsing the workbook (pure) ----------

const text = (c: Cell) => String(c ?? "").trim();
const lower = (c: Cell) => text(c).toLowerCase();

export function parseDwelling(s: string): { kind: QldKind; beds: number } | null {
  const m = /^(flat|house|townhouse)\s+(\d)$/i.exec(s.trim());
  return m ? { kind: m[1].toLowerCase() as QldKind, beds: Number(m[2]) } : null;
}

const MONTHS: Record<string, string> = { mar: "03-31", jun: "06-30", sep: "09-30", dec: "12-31" };

export interface TableData {
  /** Column of the newest quarter. */
  lastCol: number;
  /** Quarter end date of the newest quarter, YYYY-MM-DD. */
  date: string;
  /** postcode|dwelling -> value in the newest quarter (null = blank cell) */
  values: Map<string, { postcode: string; kind: QldKind; beds: number; value: number | null }>;
}

/** Read one "by Postcode" sheet: the header row (Postcode | Dwelling), the two quarter label rows under it, then one row per postcode x dwelling. */
export function parsePostcodeTable(rows: Cell[][]): TableData {
  const hi = rows.findIndex((r) => r.some((c) => lower(c) === "postcode") && r.some((c) => lower(c) === "dwelling"));
  if (hi < 0) throw new SourceError("The RTA bond statistics workbook has a new layout (no Postcode / Dwelling header); this source needs updating.");
  const head = rows[hi];
  const cPost = head.findIndex((c) => lower(c) === "postcode");
  const cDwell = head.findIndex((c) => lower(c) === "dwelling");
  // The quarter labels sit in the next two rows: month names (Mar Jun Sep Dec), then the year.
  const monthRow = rows[hi + 1] ?? [];
  const yearRow = rows[hi + 2] ?? [];
  let lastCol = -1;
  let date = "";
  for (let c = Math.max(cPost, cDwell) + 1; c < monthRow.length; c++) {
    const md = MONTHS[lower(monthRow[c]).slice(0, 3)];
    const y = Number(text(yearRow[c]));
    if (md && Number.isInteger(y) && y > 2000 && y < 2100) {
      lastCol = c;
      date = `${y}-${md}`;
    }
  }
  if (lastCol < 0) throw new SourceError("The RTA bond statistics workbook has a new layout (no quarter labels under the header); this source needs updating.");
  const values: TableData["values"] = new Map();
  for (const r of rows.slice(hi + 3)) {
    const pc = text(r[cPost]);
    const d = parseDwelling(text(r[cDwell]));
    if (!/^\d{4}$/.test(pc) || !d) continue;
    const raw = r[lastCol];
    const v = typeof raw === "number" ? raw : /^\s*\d+(\.\d+)?\s*$/.test(text(raw)) ? Number(text(raw)) : null;
    values.set(`${pc}|${d.kind}-${d.beds}`, { postcode: pc, kind: d.kind, beds: d.beds, value: v !== null && Number.isFinite(v) ? v : null });
  }
  return { lastCol, date, values };
}

const firstText = (rows: Cell[][]) => {
  for (const r of rows.slice(0, 8)) {
    const t = r.map(text).find((x) => x);
    if (t && /by postcode/i.test(t)) return t.toLowerCase();
  }
  return "";
};

/** The two sheets we need, found by the title in their first rows ("Median rents, by Postcode", "Bonds lodged, by Postcode"). */
export function findSheets(sheets: { name: string; rows: Cell[][] }[]): { rents: Cell[][]; bonds: Cell[][] } {
  let rents: Cell[][] | undefined;
  let bonds: Cell[][] | undefined;
  for (const s of sheets) {
    const t = firstText(s.rows);
    if (t.startsWith("median rents")) rents = rents ?? s.rows;
    else if (t.startsWith("bonds lodged")) bonds = bonds ?? s.rows;
  }
  if (!rents || !bonds) throw new SourceError("The RTA bond statistics workbook has a new layout (the 'Median rents, by Postcode' or 'Bonds lodged, by Postcode' sheet was not found); this source needs updating.");
  return { rents, bonds };
}

/** Library rows for the newest quarter. The RTA gives no range, so low/high/min/max repeat the median (answers never use them). */
export function qldDailyRows(rents: TableData, bonds: TableData): { date: string; rows: DailyRow[] } {
  if (rents.date !== bonds.date) throw new SourceError(`The RTA median-rents and bonds-lodged sheets end in different quarters (${rents.date} and ${bonds.date}); this source needs updating.`);
  const rows: DailyRow[] = [];
  for (const [key, r] of rents.values) {
    const b = bonds.values.get(key)?.value ?? null;
    if (r.value === null || r.value < 50 || r.value > 10000 || b === null || b < MIN_PUBLISH) continue;
    rows.push({ area: r.postcode, item: qldItem(r.kind, r.beds), n: b, median: r.value, low: r.value, high: r.value, min: r.value, max: r.value });
  }
  rows.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
  return { date: rents.date, rows };
}

// ---------- collector ----------

/** Tests set retryDelayMs to 0. */
export const harvestOptions = { retryDelayMs: 2000 };

async function download(url: string, tries = 3): Promise<Buffer> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA } });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      last = `HTTP ${res.status}`;
    } catch (e: any) {
      last = String(e?.message ?? e);
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, harvestOptions.retryDelayMs * (i + 1)));
  }
  throw new SourceError(`Could not download ${url}: ${last}`);
}

/** The daily collector: read the workbook once and return the newest quarter's postcode medians. */
export async function qldHarvest(): Promise<HarvestResult> {
  const sheets = readXlsx(await download(WORKBOOK_URL));
  const { rents, bonds } = findSheets(sheets);
  const { date, rows } = qldDailyRows(parsePostcodeTable(rents), parsePostcodeTable(bonds));
  if (!rows.length) throw new SourceError("The RTA workbook gave no postcode with at least 5 new bonds; it may have changed.");
  return {
    date,
    currency: "AUD",
    unit: "per week",
    rows,
    note: `Median weekly rent of new tenancies in the quarter ending ${date}, by Queensland postcode and dwelling type; n is the number of new bonds lodged (RTA bond statistics).`,
  };
}

// ---------- answering ----------

export interface QldInput {
  postcode?: string;
  town?: string;
  property_type?: string;
  bedrooms?: number;
  baseUrl?: string;
}

export function qldPostcode(input: { postcode?: string; town?: string }): string {
  const pc = input.postcode?.trim() ?? (input.town && /^\d{4}$/.test(input.town.trim()) ? input.town.trim() : undefined);
  if (pc) {
    if (!/^\d{4}$/.test(pc)) throw new InputError("A Queensland postcode has four digits, e.g. 4000 (Brisbane city).");
    return pc;
  }
  throw new InputError(
    `Queensland rents are published by postcode, so a postcode is required (for example 4000 for Brisbane city, 4217 for Surfers Paradise, 4870 for Cairns${input.town ? `; '${input.town}' is not a postcode` : ""}).`,
  );
}

export function qldKinds(pt?: string): { kinds: QldKind[]; label: string } {
  if (pt === undefined || pt === "any") return { kinds: QLD_KINDS, label: "homes" };
  if (pt === "apartment" || pt === "flat") return { kinds: ["flat"], label: "flats" };
  if (pt === "house") return { kinds: ["house"], label: "houses" };
  if (pt === "room") throw new InputError("The RTA bond statistics do not cover rented rooms, so property_type room is not available.");
  throw new InputError('property_type must be "apartment" (flat), "house" or "any".');
}

export function qldBeds(b?: number): number | undefined {
  if (b === undefined) return undefined;
  if (!Number.isInteger(b) || b < 0) throw new InputError("bedrooms must be a whole number.");
  return b;
}

const quarterLabel = (date: string) => {
  const [y, m] = date.split("-").map(Number);
  return `${y}-Q${Math.ceil(m / 3)}`;
};
const quarterStart = (date: string) => {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 3, 1)).toISOString().slice(0, 10);
};
const monthly = (w: number) => Math.round((w * 52) / 12);
const dwellingText = (kind: QldKind, beds: number) => `${beds}-bedroom ${KIND_LABEL[kind]}`;

export interface Cand {
  kind: QldKind;
  beds: number;
  row: DailyRow & { date: string };
}

/** Pure: the answer for a postcode from the candidate library rows (already filtered by type and bedrooms). */
export function qldAnswerFromCandidates(
  cands: Cand[],
  q: { postcode: string; kindsAsked: boolean; bedsAsked: boolean; baseUrl?: string },
): PriceAnswer {
  const sorted = [...cands].sort((a, b) => b.row.n - a.row.n || a.kind.localeCompare(b.kind) || a.beds - b.beds);
  const top = sorted[0];
  const query = { country: "AU", state: "QLD", postcode: q.postcode };
  if (!top) {
    return buildStatisticAnswer({
      source: INFO,
      query,
      value: null,
      measure: "median",
      currency: "AUD",
      unit: "per week",
      period: { from: null, to: null },
      reference_period: "",
      method: METHOD,
      describe: () => "",
      baseUrl: q.baseUrl,
      extra: { hint: "No dwelling of that kind had at least 5 new bonds lodged in postcode " + q.postcode + " in the latest quarter, or the postcode is not in Queensland. Try another dwelling type or a nearby postcode." },
    });
  }
  const d = top.row.date;
  const others = sorted.slice(1).map((c) => ({ dwelling: dwellingText(c.kind, c.beds), median_weekly_rent: c.row.median, new_bonds: c.row.n }));
  const chosenNote = q.kindsAsked && q.bedsAsked ? "" : ` This is the most common dwelling in the postcode (${top.row.n} new bonds); other dwellings are listed under extra.other_dwellings.`;
  return buildStatisticAnswer({
    source: INFO,
    query: { ...query, dwelling: dwellingText(top.kind, top.beds) },
    value: top.row.median,
    measure: "median",
    currency: "AUD",
    unit: "per week",
    period: { from: quarterStart(d), to: d },
    reference_period: quarterLabel(d),
    sample_size: top.row.n,
    method: METHOD,
    describe: (v) =>
      `The median weekly rent of new tenancies of ${dwellingText(top.kind, top.beds)}s in postcode ${q.postcode}, Queensland, was ${fmtMoney(v, "AUD")} (about ${fmtMoney(monthly(v), "AUD")} a month) in the quarter ending ${d}, from ${top.row.n} new rental bonds lodged with the RTA.` +
      chosenNote +
      " These are rents of new leases, not what sitting tenants pay; no range is published.",
    baseUrl: q.baseUrl,
    extra: {
      dwelling: dwellingText(top.kind, top.beds),
      median_per_month_equivalent: monthly(top.row.median),
      per_month_note: "Weekly rent x 52 / 12; the published figures are weekly.",
      new_bonds_lodged: top.row.n,
      ...(others.length ? { other_dwellings: others } : {}),
    },
  });
}

const METHOD =
  "The Queensland Residential Tenancies Authority publishes every quarter the median weekly rent of the new tenancies whose bonds were lodged in the quarter, per postcode and dwelling type (flat, house or townhouse by number of bedrooms), and the number of new bonds lodged. " +
  "ProofPrice passes on the published median for the latest quarter and uses the number of bonds as the sample size. A postcode and dwelling with fewer than 5 new bonds gets no figure. Medians of different dwelling types cannot be combined, so each answer is one dwelling type; with none chosen, the most common one in the postcode. No range is published.";

export async function qldRents(input: QldInput): Promise<PriceAnswer> {
  const postcode = qldPostcode(input);
  const k = qldKinds(input.property_type);
  const beds = qldBeds(input.bedrooms);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("Not yet available: ProofPrice collects the Queensland RTA bond statistics daily; figures appear after the next collection.");
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 10 * 86400000).toISOString().slice(0, 10);
  const cands: Cand[] = [];
  for (const dw of QLD_DWELLINGS) {
    if (!k.kinds.includes(dw.kind) || (beds !== undefined && dw.beds !== beds)) continue;
    const rows = readDaily(INFO.id, { area: postcode, item: qldItem(dw.kind, dw.beds), from, to });
    const r = rows[rows.length - 1];
    if (r && r.n >= MIN_PUBLISH) cands.push({ kind: dw.kind, beds: dw.beds, row: r });
  }
  const ans = qldAnswerFromCandidates(cands, { postcode, kindsAsked: input.property_type !== undefined && input.property_type !== "any", bedsAsked: beds !== undefined, baseUrl: input.baseUrl });
  const ageDays = Math.round((Date.now() - Date.parse(to + "T00:00:00Z")) / 86400000);
  if (ageDays > 150) {
    ans.extra = { ...(ans.extra ?? {}), data_age_note: `The newest quarter held ends ${to}, ${ageDays} days ago; the RTA normally publishes a quarter within a month of its end.` };
  }
  return ans;
}
