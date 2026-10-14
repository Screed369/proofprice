// United States medicine prices: NADAC, the National Average Drug Acquisition Cost, published weekly by the Centers for
// Medicare & Medicaid Services (CMS) on data.medicaid.gov. It is the average price that retail community pharmacies pay to
// ACQUIRE a drug (CMS: "covered outpatient drug prices by averaging survey invoice prices from retail community pharmacies").
// It is NOT what a patient pays at the counter: no dispensing fee, no pharmacy mark-up, no insurance.
//
// Formats below were checked live on 2026-10-14 through the GitHub probe (data.medicaid.gov is a DKAN portal, key-free):
//  - one dataset per calendar year ("NADAC (National Average Drug Acquisition Cost) 2026"), each a full history of weekly files;
//  - every weekly file ("as_of_date", a Wednesday) holds ONE row per NDC (a packaged product): ndc_description, ndc,
//    nadac_per_unit (5 decimals, US dollars), effective_date (when that rate took effect), pricing_unit (EA, ML or GM),
//    classification_for_rate_setting (G generic, B brand), otc (Y/N);
//  - the datastore query API (/api/1/datastore/query/<dataset id>/0) filters with conditions[n][property|operator|value]
//    ("=", "like", "starts with", "contains"), sorts, properties, limit (3 000 accepted), offset and count.
// Answers are live queries (one small request for the newest weekly date, one for the matching rows), not a bulk download.
//
// The figure is an official statistic (CMS publishes the average), so it uses buildStatisticAnswer, measure "average".

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, SourceError } from "../../lib/http";
import { buildQuery } from "../../lib/adapters/common";
import { percentile } from "../../lib/stats";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "us-nadac",
  country: "US (United States)",
  category: "medicines (pharmacy acquisition cost)",
  name: "National Average Drug Acquisition Cost (NADAC), weekly",
  publisher: "Centers for Medicare & Medicaid Services (CMS), U.S. Department of Health and Human Services",
  what_is_recorded:
    "Every week, for each packaged drug product (NDC) that U.S. retail community pharmacies buy: the national average price per unit " +
    "(tablet or capsule = EA, millilitre = ML, gram = GM) that CMS calculates from a survey of pharmacy purchase invoices, with the date the rate took effect, " +
    "whether it is a generic or a brand rate, and whether the product is sold over the counter.",
  price_type: "official_statistic",
  freshness: "A new weekly file (Wednesday) is published on data.medicaid.gov; each answer states the weekly file date and the date each rate took effect",
  licence:
    "No separate licence text. Each NADAC dataset on data.medicaid.gov carries the licence field https://www.usa.gov/publicdomain/label/1.0/ " +
    "(USAGov's page on U.S. Government works, which says: \"Government work is something created by a U.S. government officer or employee as part of their official duties.\"). " +
    "Data created by U.S. federal employees as part of their official duties is a U.S. Government work and is not subject to copyright. " +
    "USAGov also states: \"You cannot use government materials in a way that implies endorsement by a government agency, official, or employee.\"",
  licence_url: "https://www.usa.gov/publicdomain/label/1.0/",
  attribution:
    "Source: National Average Drug Acquisition Cost (NADAC), Centers for Medicare & Medicaid Services, data.medicaid.gov. " +
    "ProofPrice is not affiliated with or endorsed by CMS. Rates are passed on as published; the median across products and the 30-unit cost are calculated by ProofPrice.",
  homepage: "https://data.medicaid.gov/dataset/fbb83258-11c7-47f5-8b18-5f8e79f7e704",
  limits:
    "NADAC is the average price retail community pharmacies pay to acquire a drug (an average of surveyed purchase invoices), NOT the price a patient pays: " +
    "it leaves out the pharmacy's dispensing fee, mark-up and any insurance or coupon effect, so the counter price is higher. " +
    "It is a national average, not a transaction, and says nothing about one pharmacy. CMS does not publish how many invoices stand behind each rate. " +
    "Only drugs in the NADAC survey appear (outpatient drugs sold at retail pharmacies; no hospital, specialty-only or compounded products). " +
    "A name query spans several strengths and forms: we take the median over all matching NDC rates, which lands on the strength with the most NDCs, and list every product so the choice is visible. " +
    "The cost of 30 units is the unit cost multiplied by 30, shown for scale, not a price list.",
};

const API = "https://data.medicaid.gov/api/1";
/** Dataset ids (one per calendar year), checked live on 2026-10-14. Other years are looked up by title. */
export const DATASET_IDS: Record<number, string> = {
  2025: "f38d0706-1239-442c-a3cc-40ef1b686ac0",
  2026: "fbb83258-11c7-47f5-8b18-5f8e79f7e704",
};
export const ROW_LIMIT = 2000; // the portal accepts 3 000; a single drug name never comes close
export const STALE_AFTER_DAYS = 21;

export type Fetcher = (url: string) => Promise<unknown>;
const defaultFetcher: Fetcher = (url) => fetchJson(url, {}, 25000);

// ---------- what the user typed (pure) ----------

export interface Strength {
  value: number;
  unit: string; // "mg" | "mcg" | "g" | "ml" | "iu" | "unit" | "%" ; "" = any unit
}

export interface MedicineQuery {
  input: string;
  name: string; // first word, lower case, mapped to the American name
  extraWords: string[]; // other name words that must appear in the product description (HCL, ER, ...)
  strength: Strength | null;
  form: string | null; // canonical form word
}

/** British and international names -> the name the American NADAC file uses. */
export const US_NAMES: Record<string, string> = {
  paracetamol: "acetaminophen", salbutamol: "albuterol", adrenaline: "epinephrine", noradrenaline: "norepinephrine",
  glibenclamide: "glyburide", rifampicin: "rifampin", lignocaine: "lidocaine", frusemide: "furosemide", ciclosporin: "cyclosporine",
  pethidine: "meperidine", amoxycillin: "amoxicillin", paracetemol: "acetaminophen", tylenol: "acetaminophen",
};

const SALT_WORDS = new Set([
  "hydrochloride", "hcl", "besylate", "calcium", "sodium", "potassium", "maleate", "sulfate", "sulphate", "succinate", "tartrate",
  "acetate", "mesylate", "citrate", "phosphate", "bromide", "hydrobromide", "fumarate", "magnesium", "medoxomil", "mononitrate",
]);
const STOP_WORDS = new Set(["of", "and", "the", "for", "pills", "pill", "generic", "brand", "price", "cost", "per", "pack", "a", "mg", "mcg", "ml", "g", "iu", "unit", "units"]);

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Form words a user may type -> canonical form -> pattern that finds it in a NADAC product description. */
export const FORMS: Record<string, { word: string; test: RegExp }> = {
  tablet: { word: "tablet", test: /\b(TABLETS?|TABS?|TB|[A-Z]+-TAB|[A-Z]+-TB|CHEW|ODT)\b/ },
  tablets: { word: "tablet", test: /\b(TABLETS?|TABS?|TB|[A-Z]+-TAB|[A-Z]+-TB|CHEW|ODT)\b/ },
  tab: { word: "tablet", test: /\b(TABLETS?|TABS?|TB|[A-Z]+-TAB|[A-Z]+-TB|CHEW|ODT)\b/ },
  tabs: { word: "tablet", test: /\b(TABLETS?|TABS?|TB|[A-Z]+-TAB|[A-Z]+-TB|CHEW|ODT)\b/ },
  capsule: { word: "capsule", test: /\b(CAPSULES?|CAPS?|GELCAP|[A-Z]+-CAP)\b/ },
  capsules: { word: "capsule", test: /\b(CAPSULES?|CAPS?|GELCAP|[A-Z]+-CAP)\b/ },
  cap: { word: "capsule", test: /\b(CAPSULES?|CAPS?|GELCAP|[A-Z]+-CAP)\b/ },
  caps: { word: "capsule", test: /\b(CAPSULES?|CAPS?|GELCAP|[A-Z]+-CAP)\b/ },
  solution: { word: "solution", test: /\b(SOLN|SOLUTION|LIQ|LIQUID|SUSP|SUSPENSION|SYRUP|SYR|ELIXIR)\b/ },
  soln: { word: "solution", test: /\b(SOLN|SOLUTION|LIQ|LIQUID|SUSP|SUSPENSION|SYRUP|SYR|ELIXIR)\b/ },
  liquid: { word: "solution", test: /\b(SOLN|SOLUTION|LIQ|LIQUID|SUSP|SUSPENSION|SYRUP|SYR|ELIXIR)\b/ },
  suspension: { word: "solution", test: /\b(SOLN|SOLUTION|LIQ|LIQUID|SUSP|SUSPENSION|SYRUP|SYR|ELIXIR)\b/ },
  syrup: { word: "solution", test: /\b(SOLN|SOLUTION|LIQ|LIQUID|SUSP|SUSPENSION|SYRUP|SYR|ELIXIR)\b/ },
  cream: { word: "cream", test: /\b(CREAM|CRM)\b/ },
  ointment: { word: "ointment", test: /\b(OINT|OINTMENT)\b/ },
  gel: { word: "gel", test: /\bGEL\b/ },
  inhaler: { word: "inhaler", test: /\b(INHALER|HFA|INH)\b/ },
  patch: { word: "patch", test: /\b(PATCH|PTCH)\b/ },
  drops: { word: "drops", test: /\b(DROPS?|DRP|OPHTH|OPTH)\b/ },
  spray: { word: "spray", test: /\bSPRAY\b/ },
  injection: { word: "injection", test: /\b(INJ|INJECTION|SYRINGE|VIAL|PEN|CARTRIDGE)\b/ },
  pen: { word: "injection", test: /\b(INJ|INJECTION|SYRINGE|VIAL|PEN|CARTRIDGE)\b/ },
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

/** "Atorvastatin 20mg", "Lipitor", "metformin hcl 500 mg tablet", "paracetamol" -> a MedicineQuery. Throws InputError for nothing usable. */
export function parseMedicine(raw?: string): MedicineQuery {
  const input = (raw ?? "").trim();
  if (!input) throw new InputError("medicine is required: a medicine brand or generic name such as 'atorvastatin', 'atorvastatin 20mg' or 'Lipitor'.");
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
  const first = words.shift();
  const clean = first?.replace(/^-+|-+$/g, "");
  if (!clean || clean.length < 3 || !/^[a-z][a-z0-9-]*$/.test(clean)) {
    throw new InputError("medicine is required: a medicine brand or generic name such as 'atorvastatin', 'atorvastatin 20mg' or 'Lipitor'.");
  }
  const name = own(US_NAMES, clean) ? US_NAMES[clean] : clean;
  const extraWords = words.filter((w) => !SALT_WORDS.has(w) && /^[a-z0-9-]+$/.test(w)).map((w) => w.toUpperCase());
  return { input, name, extraWords, strength, form };
}

/** All "number + unit" pairs in a NADAC description: "AMOXICILLIN 250 MG/5 ML SUSP" -> [250 mg, 5 ml]. */
export function descriptionStrengths(desc: string): Strength[] {
  const out: Strength[] = [];
  const re = /(\d+(?:,\d{3})*(?:\.\d+)?|\d*\.\d+)\s*(MG|MCG|G|ML|IU|UNITS?|%|MEQ)(?![A-Z])/g;
  const up = desc.toUpperCase();
  let m: RegExpExecArray | null;
  while ((m = re.exec(up))) out.push({ value: toNumber(m[1]), unit: normUnit(m[2]) });
  return out;
}

export function matchesQuery(desc: string, q: MedicineQuery): boolean {
  const up = desc.toUpperCase();
  for (const w of q.extraWords) {
    if (!new RegExp(`(^|[^A-Z0-9])${w.replace(/[^A-Z0-9-]/g, "")}([^A-Z0-9]|$)`).test(up)) return false;
  }
  if (q.strength) {
    const want = q.strength;
    if (!descriptionStrengths(desc).some((s) => s.value === want.value && (want.unit === "" || s.unit === want.unit))) return false;
  }
  if (q.form && !FORMS[q.form]?.test.test(up)) return false;
  return true;
}

// ---------- the portal (pure URL builders and parsers) ----------

function conditionPairs(conds: { property: string; operator: string; value: string }[]): Array<[string, string]> {
  return conds.flatMap((c, i): Array<[string, string]> => [
    [`conditions[${i}][property]`, c.property],
    [`conditions[${i}][operator]`, c.operator],
    [`conditions[${i}][value]`, c.value],
  ]);
}

const ROW_PROPERTIES = ["ndc_description", "ndc", "nadac_per_unit", "effective_date", "pricing_unit", "classification_for_rate_setting", "otc", "as_of_date"];

/** Rows of one weekly file whose description starts with `name` followed by a space (or contains it, as a fallback). */
export function rowsUrl(datasetId: string, asOf: string, name: string, mode: "starts" | "contains" = "starts"): string {
  const safe = name.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!safe) throw new InputError("medicine name has no usable letters");
  const like = mode === "starts" ? `${safe} %` : `%${safe}%`;
  return `${API}/datastore/query/${datasetId}/0?` + buildQuery([
    ...conditionPairs([
      { property: "ndc_description", operator: "like", value: like },
      { property: "as_of_date", operator: "=", value: asOf },
    ]),
    ...ROW_PROPERTIES.map((p, i): [string, string] => [`properties[${i}]`, p]),
    ["sorts[0][property]", "ndc_description"], ["sorts[0][order]", "asc"], ["sorts[1][property]", "ndc"], ["sorts[1][order]", "asc"],
    ["limit", String(ROW_LIMIT)], ["offset", "0"], ["schema", "false"], ["count", "true"],
  ]);
}

/** The newest weekly file date of a dataset. */
export function latestUrl(datasetId: string): string {
  return `${API}/datastore/query/${datasetId}/0?` + buildQuery([
    ["sorts[0][property]", "as_of_date"], ["sorts[0][order]", "desc"], ["properties[0]", "as_of_date"],
    ["limit", "1"], ["schema", "false"], ["count", "false"],
  ]);
}

export function datasetSearchUrl(title: string): string {
  return `${API}/search?` + buildQuery([["fulltext", title], ["page-size", "5"]]);
}

export function nadacTitle(year: number): string {
  return `NADAC (National Average Drug Acquisition Cost) ${year}`;
}

function isObj(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** {"results":[{"as_of_date":"2026-10-14"}],...} -> "2026-10-14", or null when the dataset holds no rows. */
export function parseLatest(json: unknown): string | null {
  if (!isObj(json) || !Array.isArray(json.results)) throw new SourceError("Unexpected response from data.medicaid.gov (no results)");
  const d = json.results[0]?.as_of_date;
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

/** The dataset search answers {results:{"dkan_dataset/<id>":{title, identifier,...}}}; pick the exact title. */
export function parseDatasetSearch(json: unknown, title: string): string | null {
  if (!isObj(json) || !isObj(json.results)) return null;
  for (const v of Object.values(json.results)) {
    if (isObj(v) && v.title === title && typeof v.identifier === "string") return v.identifier;
  }
  return null;
}

export interface NadacRow {
  description: string;
  ndc: string;
  rate: number; // US dollars per pricing unit
  effective: string; // YYYY-MM-DD
  unit: string; // EA | ML | GM
  cls: "generic" | "brand" | "unknown";
  otc: boolean | null;
  asOf: string;
}

export function parseRows(json: unknown): { rows: NadacRow[]; total: number | null } {
  if (!isObj(json) || !Array.isArray(json.results)) throw new SourceError("Unexpected response from data.medicaid.gov (no results)");
  const rows: NadacRow[] = [];
  for (const r of json.results) {
    if (!isObj(r)) continue;
    const rate = Number(r.nadac_per_unit);
    if (typeof r.ndc_description !== "string" || !Number.isFinite(rate) || rate <= 0) continue;
    const c = String(r.classification_for_rate_setting ?? "").toUpperCase();
    rows.push({
      description: r.ndc_description.trim(),
      ndc: String(r.ndc ?? ""),
      rate,
      effective: String(r.effective_date ?? "").slice(0, 10),
      unit: String(r.pricing_unit ?? "").toUpperCase(),
      cls: c === "G" ? "generic" : c === "B" ? "brand" : "unknown",
      otc: r.otc === "Y" ? true : r.otc === "N" ? false : null,
      asOf: String(r.as_of_date ?? "").slice(0, 10),
    });
  }
  const total = typeof json.count === "number" ? json.count : json.count !== undefined && Number.isFinite(Number(json.count)) ? Number(json.count) : null;
  return { rows, total };
}

// ---------- the calculation (pure) ----------

export interface Product {
  description: string;
  ndcs: number;
  rate: number; // median across this product's NDCs
  low: number;
  high: number;
  unit: string;
  cls: NadacRow["cls"];
  otc: boolean | null;
  effective: string; // newest effective date among its NDCs
}

const r5 = (v: number) => Math.round(v * 100000) / 100000;
const median = (v: number[]) => percentile([...v].sort((a, b) => a - b), 0.5);

/** One entry per distinct product description (strength + form), valued at the median of its NDC rates. */
export function groupProducts(rows: NadacRow[]): Product[] {
  const by = new Map<string, NadacRow[]>();
  for (const r of rows) {
    const g = by.get(r.description);
    if (g) g.push(r);
    else by.set(r.description, [r]);
  }
  const out: Product[] = [];
  for (const [description, g] of by) {
    const rates = g.map((x) => x.rate);
    const units = new Map<string, number>();
    for (const x of g) units.set(x.unit, (units.get(x.unit) ?? 0) + 1);
    const unit = [...units.entries()].sort((a, b) => b[1] - a[1])[0][0];
    out.push({
      description,
      ndcs: g.length,
      rate: r5(median(rates)),
      low: Math.min(...rates),
      high: Math.max(...rates),
      unit,
      cls: g.some((x) => x.cls === "brand") ? "brand" : g[0].cls,
      otc: g[0].otc,
      effective: g.map((x) => x.effective).sort().slice(-1)[0],
    });
  }
  return out.sort((a, b) => a.description.localeCompare(b.description));
}

const UNIT_RANK: Record<string, number> = { EA: 0, ML: 1, GM: 2 };

/** The pricing unit with the most NDC rows (ties go to EA, then ML, then GM); rows in other units are returned as `other`. */
export function dominantUnit(rows: NadacRow[]): { unit: string; used: NadacRow[]; other: NadacRow[] } {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.unit, (counts.get(r.unit) ?? 0) + 1);
  const unit = [...counts.entries()].sort((a, b) => b[1] - a[1] || (UNIT_RANK[a[0]] ?? 9) - (UNIT_RANK[b[0]] ?? 9))[0][0];
  return { unit, used: rows.filter((r) => r.unit === unit), other: rows.filter((r) => r.unit !== unit) };
}

/** "tablet", "capsule", "mL", "gram" or "unit (each)". */
export function unitWord(unit: string, descriptions: string[]): string {
  if (unit === "ML") return "mL";
  if (unit === "GM") return "gram";
  if (descriptions.length && descriptions.every((d) => FORMS.tablet.test.test(d.toUpperCase()))) return "tablet";
  if (descriptions.length && descriptions.every((d) => FORMS.capsule.test.test(d.toUpperCase()))) return "capsule";
  return "unit (each)";
}

/** Dollar text that keeps the precision NADAC publishes: $0.02792, $0.0374, $1.50, $19.07, $1,234. */
export function usd(v: number): string {
  if (v >= 100) return "$" + Math.round(v).toLocaleString("en-US");
  if (v >= 1) return "$" + v.toFixed(2);
  const t = v.toFixed(5).replace(/0+$/, "");
  const [i, f = ""] = t.split(".");
  return `$${i}.${f.padEnd(v >= 0.1 ? 2 : 3, "0")}`;
}

/** Dollars and cents for a pack: $0.84, $23.30, $1,235. */
export function usdPack(v: number): string {
  return v >= 100 ? "$" + Math.round(v).toLocaleString("en-US") : "$" + v.toFixed(2);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
}

// ---------- the answer ----------

function methodText(): string {
  return (
    "NADAC (National Average Drug Acquisition Cost) is calculated by the Centers for Medicare & Medicaid Services from a survey of invoice prices that U.S. retail community pharmacies pay to buy drugs, " +
    "and published weekly per National Drug Code (NDC, one packaged product). We read the newest weekly file live from data.medicaid.gov, keep the NDCs whose description starts with the medicine name " +
    "(narrowed by any strength, form or extra word you gave), and take the median of their per-unit rates in the most common pricing unit (tablet or capsule, mL or gram). " +
    "When the name spans several strengths or forms, the median falls on the strength that has the most NDCs, so every product is listed. " +
    "This is what pharmacies pay to acquire the drug, not what a patient pays at the counter."
  );
}

export interface NadacInput {
  medicine?: string;
  baseUrl?: string;
}

export interface NadacDeps {
  fetcher?: Fetcher;
  today?: string; // YYYY-MM-DD, for tests
}

export function buildNadacAnswer(opts: {
  q: MedicineQuery;
  rows: NadacRow[];
  asOf: string;
  today: string;
  total: number | null; // set only when the portal held more matching rows than we fetched (the answer then covers the first rows only)
  baseUrl?: string;
  unmatched?: string[]; // descriptions that started with the name but failed the strength/form filter
}): PriceAnswer {
  const { q, rows, asOf, today } = opts;
  const query = {
    country: "US", medicine: q.input,
    matched_name: q.name.toUpperCase(),
    ...(q.strength ? { strength: `${q.strength.value}${q.strength.unit ? " " + q.strength.unit : ""}` } : {}),
    ...(q.form ? { form: q.form } : {}),
  };
  const products = groupProducts(rows);
  if (!products.length) {
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: "average", currency: "USD", unit: "per unit",
      period: { from: null, to: asOf }, reference_period: `NADAC weekly file as of ${asOf}`, method: methodText(),
      describe: () => "", baseUrl: opts.baseUrl,
      extra: {
        hint: opts.unmatched?.length
          ? "Products starting with this name exist, but none has the strength or form you gave. Try the name alone, or one of: " + opts.unmatched.slice(0, 12).join("; ")
          : "No NADAC product description starts with this name. Try the brand or the generic (US) name; NADAC lists drugs by generic name, e.g. 'acetaminophen' for paracetamol.",
      },
    });
  }
  const { unit, used: usedRows, other: otherRows } = dominantUnit(rows);
  const used = groupProducts(usedRows);
  const other = groupProducts(otherRows);
  const rates = usedRows.map((r) => r.rate);
  const value = r5(median(rates));
  const word = unitWord(unit, used.map((p) => p.description));
  const solid = unit === "EA" && (word === "tablet" || word === "capsule");
  const ndcCount = usedRows.length;
  const newestEffective = usedRows.map((r) => r.effective).sort().slice(-1)[0] ?? asOf;
  const oldestEffective = usedRows.map((r) => r.effective).sort()[0] ?? asOf;
  const ageDays = daysBetween(asOf, today);
  const stale = ageDays > STALE_AFTER_DAYS;
  const classes = new Set(used.map((p) => p.cls));
  const single = used.length === 1;
  const what = single ? used[0].description : `${q.name.toUpperCase()} (${used.length} strengths and forms; median across ${ndcCount} NDC rates)`;
  const pack = (n: number) => r5(value * n);
  const noteParts = [
    "NADAC is the pharmacy's average acquisition cost, not the patient's price.",
    ...(stale ? [`The newest NADAC weekly file is ${ageDays} days old: treat the figure as out of date.`] : []),
    ...(classes.has("brand") && classes.has("generic") ? ["Brand and generic rates are mixed in this answer."] : []),
  ];
  const answer = buildStatisticAnswer({
    source: INFO,
    query,
    value,
    measure: "average",
    currency: "USD",
    unit: `per ${word}`,
    period: { from: oldestEffective || null, to: asOf },
    reference_period: `NADAC weekly file as of ${asOf} (rates effective ${oldestEffective === newestEffective ? newestEffective : `${oldestEffective} to ${newestEffective}`})`,
    sample_size: ndcCount,
    method: methodText(),
    describe: (v) =>
      `US retail pharmacies paid on average about ${usd(v)} per ${word} to acquire ${what}` +
      (single ? "" : `; across these products the published rates range from ${usd(Math.min(...rates))} to ${usd(Math.max(...rates))}`) +
      `. This is the pharmacy's acquisition cost (NADAC), not the price a patient pays at the counter.` +
      (solid ? ` At that unit cost, 30 ${word}s would cost the pharmacy roughly ${usdPack(v * 30)}.` : "") +
      (stale ? ` The newest NADAC file is ${ageDays} days old.` : ""),
    note: noteParts.join(" "),
    baseUrl: opts.baseUrl,
    extra: {
      pricing_unit: unit,
      what_the_figure_is:
        "NADAC: the national average price retail community pharmacies pay to acquire this drug per unit, from a CMS survey of purchase invoices. It excludes the pharmacy's dispensing fee and mark-up and any insurance or coupon effect.",
      headline_basis: single
        ? "the median of the NDC rates of this one product (NDCs of the same product usually carry the same rate)"
        : "the median of the per-unit rates of all matching NDCs (every packaged product) in the most common pricing unit; it falls on the strength with the most NDCs, so give a strength for an exact figure",
      weekly_file_date: asOf,
      rates_effective_from: oldestEffective,
      rates_effective_to: newestEffective,
      days_since_weekly_file: ageDays,
      ...(stale ? { stale: true } : {}),
      products_matched: used.length,
      ndc_rows_used: ndcCount,
      ...(opts.total !== null ? { rows_truncated: true, rows_in_portal: opts.total } : {}),
      ...(solid
        ? {
            typical_pack: {
              note: "Unit cost multiplied by the number of units; arithmetic for scale only, not a published pack price.",
              cost_for_30_units: usdPack(pack(30)), cost_for_30_units_usd: pack(30),
              cost_for_90_units: usdPack(pack(90)), cost_for_90_units_usd: pack(90),
              unit: word,
            },
          }
        : {}),
      products: used.slice(0, 25).map((p) => ({
        description: p.description,
        nadac_per_unit_usd: p.rate,
        pricing_unit: p.unit,
        ndcs: p.ndcs,
        ...(p.low !== p.high ? { ndc_rate_range_usd: [p.low, p.high] } : {}),
        rate: p.cls === "brand" ? "brand" : p.cls === "generic" ? "generic" : "unclassified",
        over_the_counter: p.otc,
        rate_effective: p.effective,
        ...(unit === "EA" && solid ? { cost_for_30_units_usd: r5(p.rate * 30) } : {}),
      })),
      ...(used.length > 25 ? { products_shown: 25 } : {}),
      ...(other.length
        ? { other_pricing_units: other.slice(0, 10).map((p) => ({ description: p.description, nadac_per_unit_usd: p.rate, pricing_unit: p.unit })) }
        : {}),
    },
  });
  return answer;
}

// ---------- fetching ----------

async function datasetIdFor(year: number, fetcher: Fetcher): Promise<string | null> {
  if (DATASET_IDS[year]) return DATASET_IDS[year];
  const title = nadacTitle(year);
  return parseDatasetSearch(await fetcher(datasetSearchUrl(title)), title);
}

export async function nadacMedicine(input: NadacInput, deps: NadacDeps = {}): Promise<PriceAnswer> {
  const fetcher = deps.fetcher ?? defaultFetcher;
  const today = deps.today ?? new Date().toISOString().slice(0, 10);
  const q = parseMedicine(input.medicine);
  const year = Number(today.slice(0, 4));
  let datasetId: string | null = null;
  let asOf: string | null = null;
  for (const y of [year, year - 1]) {
    const id = await datasetIdFor(y, fetcher);
    if (!id) continue;
    const latest = parseLatest(await fetcher(latestUrl(id)));
    if (latest) {
      datasetId = id;
      asOf = latest;
      break;
    }
  }
  if (!datasetId || !asOf) throw new SourceError("Could not find the newest NADAC weekly file on data.medicaid.gov");

  let { rows, total } = parseRows(await fetcher(rowsUrl(datasetId, asOf, q.name, "starts")));
  if (!rows.length && q.name.length >= 4) ({ rows, total } = parseRows(await fetcher(rowsUrl(datasetId, asOf, q.name, "contains"))));
  const kept = rows.filter((r) => matchesQuery(r.description, q));
  const unmatched = [...new Set(rows.map((r) => r.description))];
  const truncated = total !== null && total > rows.length ? total : null;
  return buildNadacAnswer({ q, rows: kept, asOf, today, total: truncated, baseUrl: input.baseUrl, unmatched: kept.length ? undefined : unmatched });
}
