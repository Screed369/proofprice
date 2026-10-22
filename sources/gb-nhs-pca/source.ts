// England medicine prices: what the NHS pays for medicines dispensed in the community, from NHSBSA's Prescription Cost Analysis
// (PCA) monthly data on the NHSBSA Open Data Portal (a CKAN portal; the SQL endpoint is key-free).
//
// Why PCA and not the Drug Tariff file: the portal does not offer Drug Tariff Part VIII as data (a search for "tariff" finds only
// freedom-of-information releases). PCA gives the Drug Tariff basic price actually applied to every item the NHS reimbursed:
// Net Ingredient Cost (NIC), "the amount paid using the basic price of the drug ... as stated in Part II Clause 8 of the Drug
// Tariff", divided by the quantity dispensed. That is the closest open number to "what the NHS actually paid" for the drug itself.
//
// Format checked live on 2026-10-14 through the GitHub probe:
//  - one table per month, resource id "PCA_YYYYMM" (Jan 2021 onward; month M appears around the 18th of month M+2);
//  - datastore_search_sql?resource_id=PCA_202607&sql=SELECT ... FROM `PCA_202607` ... runs on BigQuery and answers
//    {"success":true,"result":{"help":..,"success":"true","result":{"records":[...],"fields":[]}}} (note the nested result);
//  - an unknown month answers HTTP 404 {"error":{"__type":"Not Found Error"},"success":false};
//  - columns used: BNF_PRESENTATION_NAME ("Atorvastatin 20mg tablets"), UNIT_OF_MEASURE ("tablet"), PREP_CLASS ("01"), ITEMS,
//    TOTAL_QUANTITY, NIC (GBP). One aggregate query per request: a few dozen rows, never the 230 MB monthly file.
//
// The figure is an average computed from NHSBSA's published totals (NIC divided by quantity), so it is an official statistic
// (buildStatisticAnswer, measure "average"), price type "reimbursement_price".

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, retryOnce, SourceError } from "../../lib/http";
import { buildQuery } from "../../lib/adapters/common";
import { MIN_PUBLISH, percentile } from "../../lib/stats";
import { NATIONAL } from "../../lib/library/aggregate";
import type { DailyRow, HarvestResult, Params, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "gb-nhs-pca",
  country: "GB (England)",
  category: "medicines (NHS reimbursement prices)",
  name: "Prescription Cost Analysis (PCA) Monthly Administrative Data",
  publisher: "NHS Business Services Authority (NHSBSA)",
  what_is_recorded:
    "For every month, each medicine presentation (e.g. 'Atorvastatin 20mg tablets') dispensed in the community in England and submitted to NHSBSA for reimbursement: " +
    "the number of prescription items, the total quantity (tablets, capsules, ml...) and the Net Ingredient Cost (NIC): the basic price of the drug, as set in the Drug Tariff, for that quantity. " +
    "Aggregated by region, dispenser type and supplier; never a patient or a prescription.",
  price_type: "reimbursement_price",
  freshness: "Monthly, published about two months after the month ends (July data appears in September); each answer states the month it describes",
  licence:
    "Open Government Licence 3.0 (United Kingdom); NHSBSA's dataset page adds: \"You may use the data freely, provided that you attribute the source.\" It also asks anyone producing a press or broadcast story from the data to contact its communications team; that is a request, not a licence condition.",
  licence_url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  attribution:
    "Source: NHS Business Services Authority, \"Prescription Cost Analysis (PCA) Monthly Administrative Data\", NHSBSA Open Data Portal, " +
    "https://opendata.nhsbsa.net/dataset/prescription-cost-analysis-pca-monthly-data. Contains public sector information licensed under the Open Government Licence v3.0. " +
    "Totals are passed on as published; the average cost per unit (NIC divided by quantity) is calculated by ProofPrice.",
  homepage: "https://opendata.nhsbsa.net/dataset/prescription-cost-analysis-pca-monthly-data",
  limits:
    "This is the NHS reimbursement price of the drug itself: Net Ingredient Cost, the basic price (Drug Tariff or list price) times the quantity, \"before deduction of any dispenser discount\" (NHSBSA). " +
    "It leaves out pharmacy dispensing fees, VAT, discounts and the patient's prescription charge, and it is not the price a pharmacy paid its wholesaler or a private (non-NHS) price. " +
    "England only (Scotland, Wales and Northern Ireland publish their own data); community dispensing only, not hospitals, prisons or private prescriptions. " +
    "NHSBSA labels the monthly series management information, not an official statistic, and says prescribers' unsubmitted or disallowed items are excluded. " +
    "A name query averages every strength and form dispensed under that name, weighted by quantity; the most dispensed presentations are listed so the mix is visible. " +
    "NHSBSA asks anyone planning to publish the data to contact DataServicesSupport@nhsbsa.nhs.uk so that figures are not misunderstood.",
};

const SITE = "https://opendata.nhsbsa.net/api/3/action";
export const STALE_AFTER_DAYS = 150; // the newest month is normally 2-3 months old; older than this means the portal has stalled

export type Fetcher = (url: string) => Promise<unknown>;
// Two attempts of 10 s with a 0.5 s pause (retryOnce) stay inside the 20 s answer budget; one 30 s attempt used to hang on a slow portal.
export const ATTEMPT_TIMEOUT_MS = 10000;
const defaultFetcher: Fetcher = (url) => fetchJson(url, {}, ATTEMPT_TIMEOUT_MS);
const harvestFetcher: Fetcher = (url) => fetchJson(url, {}, 90000);

// ---------- what the user typed (pure) ----------

export interface Strength {
  value: number;
  unit: string;
}

export interface MedicineQuery {
  input: string;
  name: string; // first word, lower case, mapped to the British (BNF) name
  extraWords: string[]; // other words that must appear in the presentation name ("dispersible", "gastro-resistant")
  strength: Strength | null;
  form: string | null;
}

/** American and other names -> the name the British National Formulary (BNF) uses. */
export const UK_NAMES: Record<string, string> = {
  acetaminophen: "paracetamol", albuterol: "salbutamol", epinephrine: "adrenaline", norepinephrine: "noradrenaline",
  glyburide: "glibenclamide", rifampin: "rifampicin", meperidine: "pethidine", cyclosporine: "ciclosporin", amoxycillin: "amoxicillin",
  tylenol: "paracetamol", paracetemol: "paracetamol",
};

const STOP_WORDS = new Set(["of", "and", "the", "for", "pills", "pill", "generic", "brand", "price", "cost", "per", "pack", "a", "mg", "mcg", "ml", "g", "iu", "unit", "units"]);
const SALT_WORDS = new Set([
  "hydrochloride", "hcl", "besylate", "calcium", "sodium", "potassium", "maleate", "sulfate", "sulphate", "succinate", "tartrate",
  "acetate", "mesylate", "citrate", "phosphate", "bromide", "hydrobromide", "fumarate", "magnesium", "medoxomil", "mononitrate",
]);
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Form words a user may type -> canonical word -> pattern that finds it in a BNF presentation name. */
export const FORMS: Record<string, { word: string; test: RegExp }> = {
  tablet: { word: "tablet", test: /\btablets?\b/i },
  tablets: { word: "tablet", test: /\btablets?\b/i },
  tab: { word: "tablet", test: /\btablets?\b/i },
  tabs: { word: "tablet", test: /\btablets?\b/i },
  capsule: { word: "capsule", test: /\bcapsules?\b/i },
  capsules: { word: "capsule", test: /\bcapsules?\b/i },
  cap: { word: "capsule", test: /\bcapsules?\b/i },
  caps: { word: "capsule", test: /\bcapsules?\b/i },
  solution: { word: "solution", test: /\b(oral )?(solution|suspension|syrup|liquid|elixir)\b/i },
  suspension: { word: "solution", test: /\b(oral )?(solution|suspension|syrup|liquid|elixir)\b/i },
  liquid: { word: "solution", test: /\b(oral )?(solution|suspension|syrup|liquid|elixir)\b/i },
  syrup: { word: "solution", test: /\b(oral )?(solution|suspension|syrup|liquid|elixir)\b/i },
  cream: { word: "cream", test: /\bcream\b/i },
  ointment: { word: "ointment", test: /\bointment\b/i },
  gel: { word: "gel", test: /\bgel\b/i },
  inhaler: { word: "inhaler", test: /\b(inhaler|inhalation)\b/i },
  patch: { word: "patch", test: /\bpatch(es)?\b/i },
  drops: { word: "drops", test: /\bdrops?\b/i },
  spray: { word: "spray", test: /\bspray\b/i },
  injection: { word: "injection", test: /\b(injection|pre-filled|prefilled|cartridge|pen)\b/i },
  pen: { word: "injection", test: /\b(injection|pre-filled|prefilled|cartridge|pen)\b/i },
  suppository: { word: "suppository", test: /\bsuppositor(y|ies)\b/i },
};

const STRENGTH_RE = /(\d+(?:,\d{3})*(?:\.\d+)?|\d*\.\d+)\s*(mg|mcg|microgram|micrograms|ug|µg|g|gram|grams|ml|iu|units?|%)(?![a-z])/i;

function normUnit(u: string): string {
  const x = u.toLowerCase();
  if (x === "microgram" || x === "micrograms" || x === "ug" || x === "µg") return "mcg";
  if (x === "gram" || x === "grams") return "g";
  if (x === "units") return "unit";
  return x;
}

function toNumber(v: string): number {
  return Number(v.replace(/,(?=\d{3}\b)/g, ""));
}

/** "Atorvastatin 20mg", "Lipitor", "omeprazole capsules", "paracetamol" -> a MedicineQuery. Throws InputError for nothing usable. */
export function parseMedicine(raw?: string): MedicineQuery {
  const input = (raw ?? "").trim();
  const bad = () => new InputError("medicine is required: a medicine brand or generic name such as 'atorvastatin', 'atorvastatin 20mg' or 'Lipitor'.");
  if (!input) throw bad();
  let s = input.toLowerCase();
  let strength: Strength | null = null;
  const m = STRENGTH_RE.exec(s);
  if (m) {
    strength = { value: toNumber(m[1]), unit: normUnit(m[2]) };
    s = (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)).trim();
  }
  const tokens = s
    .replace(/[(),;]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9.\-%]/g, ""))
    .filter(Boolean);
  let form: string | null = null;
  const words: string[] = [];
  for (const t of tokens) {
    if (own(FORMS, t)) {
      form = form ?? FORMS[t].word;
    } else if (/^\d+(\.\d+)?$/.test(t)) {
      if (!strength) strength = { value: Number(t), unit: "" };
    } else if (!STOP_WORDS.has(t)) {
      words.push(t);
    }
  }
  const first = words.shift()?.replace(/^-+|-+$/g, "");
  if (!first || first.length < 3 || !/^[a-z][a-z0-9-]*$/.test(first)) throw bad();
  const name = own(UK_NAMES, first) ? UK_NAMES[first] : first;
  const extraWords = words.filter((w) => !SALT_WORDS.has(w) && /^[a-z0-9-]+$/.test(w));
  return { input, name, extraWords, strength, form };
}

/** All "number + unit" pairs in a presentation name: "Atorvastatin 20mg/5ml oral suspension" -> [20 mg, 5 ml]. */
export function nameStrengths(name: string): Strength[] {
  const out: Strength[] = [];
  const re = /(\d+(?:,\d{3})*(?:\.\d+)?|\d*\.\d+)\s*(mg|mcg|microgram|micrograms|g|ml|iu|units?|%|mmol)(?![a-z])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(name))) out.push({ value: toNumber(m[1]), unit: normUnit(m[2]) });
  return out;
}

export function matchesQuery(presentation: string, q: MedicineQuery): boolean {
  const low = presentation.toLowerCase();
  for (const w of q.extraWords) {
    if (!new RegExp(`(^|[^a-z0-9])${w.replace(/[^a-z0-9-]/g, "")}([^a-z0-9]|$)`).test(low)) return false;
  }
  if (q.strength) {
    const want = q.strength;
    if (!nameStrengths(presentation).some((s) => s.value === want.value && (want.unit === "" || s.unit === want.unit))) return false;
  }
  if (q.form && !FORMS[q.form]?.test.test(presentation)) return false;
  return true;
}

// ---------- the portal (pure URL builders and parsers) ----------

/** The monthly tables to try, most likely first: month M is published around the 18th of month M+2. */
export function candidateTables(today: string): string[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const d = Number(today.slice(8, 10));
  const offsets = d >= 15 ? [2, 3, 4, 5] : [3, 2, 4, 5];
  return offsets.map((k) => {
    const idx = y * 12 + (m - 1) - k;
    const yy = Math.floor(idx / 12);
    const mm = (idx % 12) + 1;
    return `PCA_${yy}${String(mm).padStart(2, "0")}`;
  });
}

export function tableMonth(table: string): { from: string; to: string; label: string } {
  const y = Number(table.slice(4, 8));
  const m = Number(table.slice(8, 10));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}`, label: `${names[m - 1]} ${y}` };
}

/** The aggregate query: one row per presentation and unit whose name starts with the medicine name. Light on purpose: only the five
 *  columns the answer needs (no preparation class), a short row limit, one pass over the month table. */
export function sqlFor(table: string, name: string, limit = 200): string {
  if (!/^PCA_\d{6}$/.test(table)) throw new Error(`Unexpected table name ${table}`);
  const safe = name.toUpperCase().replace(/[^A-Z0-9-]/g, "").replace(/-{2,}/g, "-");
  if (!safe) throw new InputError("medicine name has no usable letters");
  return (
    "SELECT BNF_PRESENTATION_NAME, UNIT_OF_MEASURE, SUM(ITEMS) AS items, SUM(TOTAL_QUANTITY) AS quantity, SUM(NIC) AS nic " +
    `FROM \`${table}\` WHERE UPPER(BNF_PRESENTATION_NAME) LIKE '${safe} %' GROUP BY 1, 2 ORDER BY items DESC LIMIT ${Math.max(1, Math.min(1000, Math.floor(limit)))}`
  );
}

export function sqlUrl(table: string, sql: string): string {
  return `${SITE}/datastore_search_sql?` + buildQuery([["resource_id", table], ["sql", sql]]);
}

function isObj(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export interface PcaRow {
  presentation: string;
  unit: string;
  prepClass: string;
  items: number;
  quantity: number;
  nic: number;
}

/** Parse the portal's SQL answer (the records sit under result.result.records). */
export function parseSql(json: unknown): PcaRow[] {
  if (!isObj(json) || json.success !== true || !isObj(json.result)) {
    const msg = isObj(json) && isObj(json.error) && typeof json.error.message === "string" ? json.error.message : "no result";
    throw new SourceError(`The NHSBSA open data portal refused the request: ${msg}`.slice(0, 300));
  }
  const inner = isObj(json.result.result) ? json.result.result : json.result;
  if (!Array.isArray(inner.records)) throw new SourceError("Unexpected response from the NHSBSA open data portal (no records)");
  const out: PcaRow[] = [];
  for (const r of inner.records) {
    if (!isObj(r) || typeof r.BNF_PRESENTATION_NAME !== "string") continue;
    const items = Number(r.items);
    const quantity = Number(r.quantity);
    const nic = Number(r.nic);
    if (![items, quantity, nic].every(Number.isFinite) || items <= 0 || quantity <= 0 || nic <= 0) continue;
    out.push({
      presentation: r.BNF_PRESENTATION_NAME.trim(), unit: String(r.UNIT_OF_MEASURE ?? "").trim().toLowerCase(),
      prepClass: String(r.PREP_CLASS ?? ""), items, quantity, nic,
    });
  }
  return out;
}

// ---------- the calculation (pure) ----------

const r5 = (v: number) => Math.round(v * 100000) / 100000;
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface Presentation {
  presentation: string;
  unit: string;
  items: number;
  quantity: number;
  nic: number;
}

/** Merge preparation classes: one entry per presentation name and unit. */
export function mergePresentations(rows: PcaRow[]): Presentation[] {
  const by = new Map<string, Presentation>();
  for (const r of rows) {
    const k = `${r.presentation}\u0000${r.unit}`;
    const g = by.get(k);
    if (g) {
      g.items += r.items;
      g.quantity += r.quantity;
      g.nic += r.nic;
    } else by.set(k, { presentation: r.presentation, unit: r.unit, items: r.items, quantity: r.quantity, nic: r.nic });
  }
  return [...by.values()].sort((a, b) => b.items - a.items);
}

/** The unit of measure with the most prescription items (tablet, capsule, ml...). */
export function dominantUnit(ps: Presentation[]): string | null {
  const by = new Map<string, number>();
  for (const p of ps) by.set(p.unit, (by.get(p.unit) ?? 0) + p.items);
  return [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function gbp(v: number): string {
  if (v >= 100) return "£" + Math.round(v).toLocaleString("en-GB");
  if (v >= 1) return "£" + v.toFixed(2);
  const t = v.toFixed(5).replace(/0+$/, "");
  const [i, f = ""] = t.split(".");
  return `£${i}.${f.padEnd(v >= 0.1 ? 2 : 3, "0")}`;
}

/** Pounds and pence for a pack: £0.73, £23.30, £1,235. */
export function gbpPack(v: number): string {
  return v >= 100 ? "£" + Math.round(v).toLocaleString("en-GB") : "£" + v.toFixed(2);
}

function methodText(): string {
  return (
    "From NHSBSA's Prescription Cost Analysis (PCA) monthly table for the newest month published: for every presentation whose name starts with the medicine name (narrowed by any strength, form or extra word you gave), " +
    "we add up Net Ingredient Cost (the Drug Tariff basic price of the quantity dispensed) and the quantity, over the unit of measure with the most prescription items, and divide: the average basic price the NHS in England reimbursed for the drug per tablet, capsule or ml. " +
    "Aggregated by NHSBSA across all dispensers and suppliers; before dispenser discounts, fees and patient charges."
  );
}

export function buildGbAnswer(opts: {
  q: MedicineQuery;
  rows: PcaRow[];
  table: string;
  today: string;
  baseUrl?: string;
  unmatched?: string[];
}): PriceAnswer {
  const { q, table, today } = opts;
  const month = tableMonth(table);
  const query = {
    country: "GB", medicine: q.input,
    matched_name: q.name,
    ...(q.strength ? { strength: `${q.strength.value}${q.strength.unit ? " " + q.strength.unit : ""}` } : {}),
    ...(q.form ? { form: q.form } : {}),
  };
  const all = mergePresentations(opts.rows);
  const unit = dominantUnit(all);
  const used = unit ? all.filter((p) => p.unit === unit) : [];
  const items = used.reduce((a, p) => a + p.items, 0);
  const quantity = used.reduce((a, p) => a + p.quantity, 0);
  const nic = used.reduce((a, p) => a + p.nic, 0);
  const enough = used.length > 0 && items >= MIN_PUBLISH && quantity > 0;
  const value = enough ? r5(nic / quantity) : null;
  const ageDays = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(month.to + "T00:00:00Z")) / 86400000);
  const stale = ageDays > STALE_AFTER_DAYS;
  const solid = unit === "tablet" || unit === "capsule";
  const single = used.length === 1;
  const label = used[0]?.presentation.split(" ")[0] ?? q.name;
  const narrowed = Boolean(q.strength || q.form || q.extraWords.length);
  const what = single
    ? used[0].presentation
    : `${label} (${used.length} ${narrowed ? "matching presentations" : "presentations, all strengths and forms"}, measured per ${unit})`;
  const perItem = enough ? nic / items : 0;
  const avgQty = enough ? quantity / items : 0;
  const hint = !all.length
    ? opts.unmatched?.length
      ? "Presentations starting with this name exist, but none has the strength, form or words you gave. Try the name alone, or one of: " + opts.unmatched.slice(0, 12).join("; ")
      : "No NHS presentation name starts with this word. NHS names follow the British National Formulary: use the generic or brand name, first word, e.g. 'paracetamol' for acetaminophen."
    : undefined;
  const answer = buildStatisticAnswer({
    source: INFO,
    query,
    value,
    measure: "average",
    currency: "GBP",
    unit: `per ${unit || "unit"}`,
    period: { from: month.from, to: month.to },
    reference_period: `${month.label} (PCA monthly data, England)`,
    sample_size: enough ? items : null,
    method: methodText(),
    // NHSBSA publishes totals (NIC, quantity, items), not this average, and calls the series management information, not an
    // official statistic: say who calculated the figure.
    ending: `Average calculated by ProofPrice (Net Ingredient Cost divided by quantity) from the totals ${INFO.publisher} publishes for ${month.label} (management information, not an official statistic).`,
    describe: (v) =>
      `The NHS in England reimbursed on average about ${gbp(v)} per ${unit} in ingredient cost (Net Ingredient Cost: the Drug Tariff basic price, before dispenser discounts and fees) for ${what}, ` +
      `dispensed in the community in ${month.label}` +
      (solid ? `; roughly ${gbpPack((nic / quantity) * 28)} for a 28-${unit} supply` : "") +
      `. Based on ${items.toLocaleString("en-GB")} prescription items. This is what the NHS reimburses for the drug, not a shop price or what a patient pays.` +
      (stale ? ` The newest month on the portal is ${ageDays} days old.` : ""),
    note:
      "Net Ingredient Cost per unit: the Drug Tariff basic price, before dispenser discounts, fees, VAT and patient charges. England, community dispensing; NHSBSA management information, not an official statistic." +
      (stale ? ` The newest month on the portal ended ${ageDays} days ago: treat as out of date.` : ""),
    baseUrl: opts.baseUrl,
    extra: {
      ...(hint ? { hint } : {}),
      ...(enough
        ? {
            price_type_explained:
              "reimbursement_price: the basic price the NHS applies when it reimburses pharmacies (the Drug Tariff price for generics, the list price for branded products). Not a retail price.",
            month: table.slice(4),
            unit_of_measure: unit,
            prescription_items: items,
            total_quantity: quantity,
            total_net_ingredient_cost_gbp: r2(nic),
            average_cost_per_item_gbp: r2(perItem),
            average_quantity_per_item: Math.round(avgQty * 10) / 10,
            ...(stale ? { stale: true, days_since_month_end: ageDays } : {}),
            ...(solid
              ? {
                  typical_pack: {
                    note: "Unit cost multiplied by the number of units; arithmetic for scale only, not a published pack price. NHS supplies are commonly 28 days.",
                    cost_for_28_units: gbpPack((nic / quantity) * 28), cost_for_28_units_gbp: r5((nic / quantity) * 28),
                    cost_for_56_units: gbpPack((nic / quantity) * 56), cost_for_56_units_gbp: r5((nic / quantity) * 56),
                    unit,
                  },
                }
              : {}),
            presentations: used.slice(0, 15).map((p) => ({
              presentation: p.presentation,
              prescription_items: p.items,
              cost_per_unit_gbp: r5(p.nic / p.quantity),
              cost_per_item_gbp: r2(p.nic / p.items),
              average_quantity_per_item: Math.round((p.quantity / p.items) * 10) / 10,
            })),
            ...(used.length > 15 ? { presentations_shown: 15, presentations_total: used.length } : {}),
            ...(all.length > used.length
              ? {
                  other_units_of_measure: [...new Set(all.filter((p) => p.unit !== unit).map((p) => p.unit))].slice(0, 8),
                  note_other_units: "Presentations measured in another unit (e.g. ml for liquids) are not mixed into the headline.",
                }
              : {}),
          }
        : {}),
    },
  });
  if (!enough && used.length > 0) {
    // Data exists but rests on fewer than MIN_PUBLISH prescription items: say so instead of "no matching statistic".
    answer.status = "insufficient_data";
    answer.confidence = "insufficient";
    answer.summary = `Only ${items} prescription item(s) for ${what} in ${month.label} in NHSBSA's Prescription Cost Analysis; at least ${MIN_PUBLISH} are needed before we publish a figure.`;
  }
  return answer;
}

// ---------- fetching ----------

function isNotFound(err: unknown): boolean {
  return err instanceof SourceError && (err.status === 404 || /HTTP 404/.test(err.message));
}

export async function gbMedicine(input: { medicine?: string; baseUrl?: string }, deps: { fetcher?: Fetcher; today?: string } = {}): Promise<PriceAnswer> {
  const fetcher = deps.fetcher ?? defaultFetcher;
  const today = deps.today ?? new Date().toISOString().slice(0, 10);
  const q = parseMedicine(input.medicine);
  let rows: PcaRow[] | null = null;
  let table = "";
  for (const t of candidateTables(today)) {
    try {
      rows = parseSql(await retryOnce(() => fetcher(sqlUrl(t, sqlFor(t, q.name)))));
      table = t;
      break;
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }
  if (!rows) throw new SourceError("Could not find a recent monthly Prescription Cost Analysis table on the NHSBSA open data portal");
  const kept = rows.filter((r) => matchesQuery(r.presentation, q));
  const unmatched = [...new Set(rows.map((r) => r.presentation))];
  return buildGbAnswer({ q, rows: kept, table, today, baseUrl: input.baseUrl, unmatched: kept.length ? undefined : unmatched });
}

// ---------- the price library (daily collector) and stale-if-error ----------

export const HARVEST_UNIT = "per tablet, capsule or ml (the unit most dispensed for the medicine)";
export const MAX_NAMES = 2000; // library size guard: the medicine names with the most prescription items

/** The whole month in one pass: every presentation and unit, most dispensed first (about 740 KB for 5,000 rows). */
export function sqlAll(table: string, limit = 5000): string {
  if (!/^PCA_\d{6}$/.test(table)) throw new Error(`Unexpected table name ${table}`);
  return (
    "SELECT BNF_PRESENTATION_NAME, UNIT_OF_MEASURE, SUM(ITEMS) AS items, SUM(TOTAL_QUANTITY) AS quantity, SUM(NIC) AS nic " +
    `FROM \`${table}\` GROUP BY 1, 2 ORDER BY items DESC LIMIT ${Math.max(1, Math.min(10000, Math.floor(limit)))}`
  );
}

/** "Omeprazole 20mg capsules" -> "omeprazole" (the first word, the way parseMedicine reads a name); null when it is not a usable name. */
export function nameKey(presentation: string): string | null {
  const sp = presentation.indexOf(" ");
  if (sp < 0) return null; // the live query matches "NAME %", so a one-word presentation never counts
  const w = presentation.slice(0, sp).toLowerCase();
  return w.length >= 3 && /^[a-z][a-z0-9-]*$/.test(w) ? w : null;
}

/** Pure: one library row per medicine name. median = Net Ingredient Cost / quantity over the unit with the most items (the same figure
 *  the live answer gives); low/high = 10th/90th percentile and min/max of the presentations' unit costs; n = prescription items. */
export function pcaDailyRows(rows: PcaRow[]): DailyRow[] {
  const groups = new Map<string, PcaRow[]>();
  for (const r of rows) {
    const k = nameKey(r.presentation);
    if (!k) continue;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out: DailyRow[] = [];
  for (const [k, g] of groups) {
    const all = mergePresentations(g);
    const unit = dominantUnit(all);
    const used = all.filter((p) => p.unit === unit);
    const items = used.reduce((a, p) => a + p.items, 0);
    const quantity = used.reduce((a, p) => a + p.quantity, 0);
    const nic = used.reduce((a, p) => a + p.nic, 0);
    if (!unit || items < MIN_PUBLISH || quantity <= 0 || nic <= 0) continue;
    const costs = used.map((p) => p.nic / p.quantity).sort((a, b) => a - b);
    out.push({
      area: NATIONAL, item: `name:${k}`, n: items, median: r5(nic / quantity),
      low: r5(percentile(costs, 0.1)), high: r5(percentile(costs, 0.9)), min: r5(costs[0]), max: r5(costs[costs.length - 1]),
    });
  }
  return out.sort((a, b) => b.n - a.n).slice(0, MAX_NAMES).sort((a, b) => a.item.localeCompare(b.item));
}

/** The collector: the newest published month in one aggregate query. The row date is the collection day (stale-if-error looks for
 *  a snapshot from the last 7 days); the month it describes is in the note. */
export async function nhsHarvest(deps: { fetcher?: Fetcher; today?: string } = {}): Promise<HarvestResult> {
  const fetcher = deps.fetcher ?? harvestFetcher;
  const today = deps.today ?? new Date().toISOString().slice(0, 10);
  for (const t of candidateTables(today)) {
    let parsed: PcaRow[];
    try {
      parsed = parseSql(await retryOnce(() => fetcher(sqlUrl(t, sqlAll(t))), 5000));
    } catch (err) {
      if (isNotFound(err)) continue;
      throw err;
    }
    const rows = pcaDailyRows(parsed);
    if (!rows.length) throw new SourceError(`NHSBSA table ${t} held no medicine with ${MIN_PUBLISH}+ prescription items`);
    return {
      date: today, currency: "GBP", unit: HARVEST_UNIT, rows,
      note: `Net Ingredient Cost per unit (Drug Tariff basic price, before fees and discounts), England, ${tableMonth(t).label}; ${rows.length} medicine names; n = prescription items.`,
    };
  }
  throw new SourceError("Could not find a recent monthly Prescription Cost Analysis table on the NHSBSA open data portal");
}

/** Which library row answers this request. Only a plain medicine name: a strength, form or extra word asks a narrower question than the
 *  library row (all strengths and forms of the name) answers, so it gets no stand-in. */
export function nhsHistoryKey(p: Params) {
  try {
    const q = parseMedicine(typeof p.medicine === "string" ? p.medicine : undefined);
    if (q.strength || q.form || q.extraWords.length) return null;
    return { area: NATIONAL, item: `name:${q.name}`, label: `${q.name}, England` };
  } catch {
    return null;
  }
}
