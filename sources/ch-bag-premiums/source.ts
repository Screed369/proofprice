// Swiss compulsory health insurance (OKP) premiums, approved tariffs, from the Federal Office of Public Health (BAG) via opendata.swiss / opendata.bagnet.ch.
// Format read on 2026-10-21 (Verifier probe, first 30 KB of Prämien_CH.csv, 25.8 MB, UTF-8 with BOM):
//   Versicherer,Kanton,Hoheitsgebiet,Geschäftsjahr,Erhebungsjahr,Region,Altersklasse,Unfalleinschluss,Tarif,Tariftyp,Altersuntergruppe,Franchisestufe,Franchise,Prämie,isBaseP,isBaseF,Tarifbezeichnung
//   8,AG,P_OKPCH,2027,2026,PR_REG_0,AKA_03_ERW,MIT_UNF,01_016,PRAXIS,E1,FRASTU_01,FRA_01_E_0300,549.5,0,1,Gesundheitspraxisversicherung
// One row = one insurer tariff in one premium region for one age class, accident option and deductible: a POSTED, regulator-approved list premium
// (CHF per month), the same for everyone in that region and age class. These are not amounts paid by individuals. The harvest turns the 280k+ rows into
// aggregate rows (canton x age group x accident x deductible x model) and the app answers from the library; the big file is never fetched per request.

import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { aggregateDaily } from "../../lib/library/aggregate";
import { readLatestDay } from "../../lib/library/store";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "ch-bag-premiums",
  country: "CH",
  category: "health insurance (compulsory basic cover, approved premiums)",
  name: "Health insurance premiums (Prämien_CH)",
  publisher: "Bundesamt für Gesundheit BAG (Swiss Federal Office of Public Health)",
  what_is_recorded:
    "One row per approved insurer tariff: insurer, canton, premium region, age class, accident cover, deductible, tariff model and the monthly premium in CHF.",
  price_type: "posted_price",
  freshness: "Once a year: premiums for the next year are approved and published in September",
  // The resource Prämien_CH.csv carries the opendata.swiss "Open use" terms (rights https://opendata.swiss/terms-of-use#terms_open
  // in the CKAN record, checked 2026-10-21); other files of the same dataset (Tarife, Prämien_EU) carry terms_by, but we read only Prämien_CH.csv.
  licence:
    'opendata.swiss terms of use, "Open use" (terms_open, as set for the file Prämien_CH.csv): "You may use this dataset for non-commercial purposes. ' +
    'You may use this dataset for commercial purposes. You are recommended to provide the source (author, title and link to the dataset)."',
  licence_url: "https://opendata.swiss/en/terms-of-use#terms_open",
  attribution:
    "Source: Bundesamt für Gesundheit BAG, Krankenversicherungsprämien, file Prämien_CH.csv (opendata.swiss, https://ckan.opendata.swiss/en/dataset/health-insurance-premiums).",
  homepage: "https://ckan.opendata.swiss/en/dataset/health-insurance-premiums",
  limits:
    "Posted list premiums approved by the BAG for compulsory basic insurance, not amounts paid by individuals and not a personal quote: the premium a person pays depends on the insurer they choose, their premium region and any premium reduction. " +
    "The figure pools every insurer tariff in the canton and its premium regions without weighting by number of insured people. Premiums are per month in CHF (as shown by the BAG's price comparison). Supplementary insurance is not included.",
};

export const DATA_URL = "https://opendata.bagnet.ch/?r=/download&path=L1ByYWVtaWVuL1Byw6RtaWVuX0NILmNzdg%3D%3D";

export const CANTONS = [
  "AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU", "LU", "NE", "NW", "OW", "SG", "SH", "SO", "SZ", "TG", "TI", "UR", "VD", "VS", "ZG", "ZH",
] as const;

export type AgeGroup = "adult" | "young_adult" | "child";
const AGE_CODES: Record<string, AgeGroup> = { AKA_01_KIN: "child", AKA_02_JUG: "young_adult", AKA_03_ERW: "adult" };

export interface Tariff {
  canton: string;
  age: AgeGroup;
  accident: "with" | "without";
  franchise: number;
  model: "standard" | "alternative";
  premium: number; // CHF per month
  businessYear: number; // Geschäftsjahr: the year the premiums apply to
  collectionYear: number; // Erhebungsjahr
}

/** One CSV data line (comma separated; the first 14 columns hold no quoted commas) -> a tariff, or null for a line that is not a usable OKP premium. */
export function parsePremiumLine(line: string): Tariff | null {
  const c = line.split(",");
  if (c.length < 14) return null;
  const age = AGE_CODES[c[6]];
  const accident = c[7] === "MIT_UNF" ? "with" : c[7] === "OHN_UNF" ? "without" : null;
  const f = /_(\d{1,5})$/.exec(c[12] ?? "");
  const premium = Number(c[13]);
  const canton = (c[1] ?? "").trim();
  if (!age || !accident || !f || !Number.isFinite(premium) || premium <= 0) return null;
  if (!(CANTONS as readonly string[]).includes(canton)) return null;
  if (c[2] !== "P_OKPCH") return null;
  const businessYear = Number(c[3]);
  const collectionYear = Number(c[4]);
  if (!Number.isInteger(businessYear) || !Number.isInteger(collectionYear)) return null;
  return {
    canton, age, accident, franchise: Number(f[1]),
    model: c[9] === "BASE" ? "standard" : "alternative",
    premium, businessYear, collectionYear,
  };
}

export const itemKey = (age: AgeGroup, accident: string, franchise: number, model: string) => `${age}/${accident}/${franchise}/${model}`;

/** Aggregate tariffs into library rows: per canton and for the whole country ("ALL"), one row per age group, accident option, deductible and model. */
export function premiumRows(tariffs: Tariff[]) {
  return aggregateDaily(tariffs.map((t) => ({ area: t.canton, item: itemKey(t.age, t.accident, t.franchise, t.model), price: t.premium })));
}

/** Read the whole file as a stream (it is about 26 MB) and keep only the aggregates. */
export async function streamTariffs(body: ReadableStream<Uint8Array>): Promise<Tariff[]> {
  const out: Tariff[] = [];
  const reader = body.getReader();
  const dec = new TextDecoder("utf-8");
  let tail = "";
  let first = true;
  for (;;) {
    const { done, value } = await reader.read();
    let text = tail + (done ? dec.decode() : dec.decode(value, { stream: true }));
    if (first && text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    first = false;
    const lines = text.split(/\r?\n/);
    tail = done ? "" : (lines.pop() ?? "");
    for (const l of lines) {
      if (!l || l.startsWith("Versicherer,")) continue;
      const t = parsePremiumLine(l);
      if (t) out.push(t);
    }
    if (done) break;
  }
  return out;
}

export async function premiumsHarvest(fetcher: typeof fetch = fetch): Promise<HarvestResult> {
  const res = await fetcher(DATA_URL, { headers: { "User-Agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" }, signal: AbortSignal.timeout(240000) });
  if (!res.ok || !res.body) throw new SourceError(`BAG premium file answered HTTP ${res.status}`);
  const tariffs = await streamTariffs(res.body as ReadableStream<Uint8Array>);
  if (tariffs.length < 1000) throw new SourceError(`Only ${tariffs.length} premium rows could be read from the BAG file; this source needs updating.`);
  const year = tariffs.reduce((a, t) => Math.max(a, t.collectionYear), 0);
  const bYear = tariffs.reduce((a, t) => Math.max(a, t.businessYear), 0);
  return {
    // The file is collected in September of the collection year; the same date is used on every daily run, so the library keeps one copy per year.
    date: `${year}-09-30`,
    currency: "CHF",
    unit: "per month",
    rows: premiumRows(tariffs.filter((t) => t.collectionYear === year)),
    note: `BAG approved basic-insurance premiums for ${bYear}, collected ${year}. n = number of insurer tariffs (all premium regions of the canton pooled), not people. Posted list premiums, not amounts paid.`,
  };
}

// ---------- answering ----------

const DEFAULT_ACCIDENT = (age: AgeGroup) => (age === "child" ? "with" : "without");

export interface PremiumInput {
  area?: string;
  age_group?: string;
  franchise?: number;
  accident?: string;
  model?: string;
  baseUrl?: string;
}

export function resolveCanton(raw: string | undefined): string {
  const t = (raw ?? "").trim().toUpperCase();
  if (!t) return "ALL";
  if (t === "CH" || t === "ALL") return "ALL";
  if ((CANTONS as readonly string[]).includes(t)) return t;
  throw new InputError(`'${raw}' is not a Swiss canton code. Give one of: ${CANTONS.join(", ")} (or leave area out for all of Switzerland).`);
}

export function premiumAnswer(lib: { date: string; rows: { area: string; item: string; n: number; median: number; low: number; high: number; min: number; max: number }[] }, input: PremiumInput): PriceAnswer {
  const area = resolveCanton(input.area);
  const age = ((input.age_group as AgeGroup | undefined) ?? "adult");
  if (!["adult", "young_adult", "child"].includes(age)) throw new InputError("age_group must be adult, young_adult or child.");
  const accident = input.accident ?? DEFAULT_ACCIDENT(age);
  const model = input.model ?? "standard";
  const inScope = lib.rows.filter((r) => r.area === area && r.item.startsWith(`${age}/${accident}/`) && r.item.endsWith(`/${model}`));
  const available = inScope.map((r) => Number(r.item.split("/")[2])).sort((a, b) => a - b);
  const franchise = input.franchise ?? available[0];
  const row = franchise === undefined ? undefined : inScope.find((r) => r.item === itemKey(age, accident, franchise, model));
  const year = Number(lib.date.slice(0, 4)) + 1; // premiums collected in September apply from 1 January of the following year
  const period = { from: `${year}-01-01`, to: `${year}-12-31` };
  const where = area === "ALL" ? "Switzerland" : `canton ${area}`;
  const query = { country: "CH", area: area === "ALL" ? null : area, age_group: age, franchise: franchise ?? null, accident, model };
  const answer = buildAnswer({
    source: INFO,
    query,
    summary: row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null,
    currency: "CHF",
    unit: "per month",
    period,
    method:
      "BAG-approved monthly premiums of compulsory basic health insurance for the premium year. Median and 10th to 90th percentile across all insurer tariffs (every insurer, every premium region of the canton, " +
      "pooled without weighting by insured people) for the chosen age group, accident option, deductible and model. Posted list prices, not amounts paid; at least 5 tariffs are needed.",
    describe: (s) =>
      `${age.replace("_", " ")} basic health insurance premium in ${where} for ${year}, deductible CHF ${franchise}, ${accident} accident cover, ${model} model: median ${fmtMoney(s.median, "CHF")} per month; ` +
      `10th to 90th percentile ${fmtMoney(s.low, "CHF")} to ${fmtMoney(s.high, "CHF")}. These are approved list premiums, not amounts paid.`,
    baseUrl: input.baseUrl,
    // The premium year has not started yet when the premiums are published (September): the data date is the collection date.
    published: lib.date,
    extra: {
      price_basis: "posted, regulator-approved list premium per month; not an amount paid by individuals",
      premium_year: year,
      area_resolved: where,
      franchise_chf: franchise ?? null,
      available_franchises: available,
      sample_size_note: "sample_size is the number of insurer tariffs behind the figure, not a number of people.",
    },
  });
  if (!row) {
    answer.summary = available.length
      ? `No premium figure for deductible CHF ${input.franchise} (${age.replace("_", " ")}, ${accident} accident cover, ${model} model) in ${where}. Deductibles available: ${available.join(", ")}.`
      : `No premium figure for ${age.replace("_", " ")}, ${accident} accident cover, ${model} model in ${where}: fewer than 5 approved tariffs match.`;
  } else {
    answer.summary = answer.summary.replace(/ Based on (\d+) records from [^.]*(?:\([^)]*\))?\./, ` Based on ${row.n} approved insurer tariffs (${INFO.publisher}, premium year ${year}).`);
  }
  return answer;
}

export async function chPremiums(input: PremiumInput): Promise<PriceAnswer> {
  resolveCanton(input.area); // bad input fails before the library is touched
  const lib = readLatestDay(INFO.id);
  if (!lib) throw new SourceError("Our copy of the BAG premium file has not been collected yet (it is read by the daily collector, never per request). Try again after the next collection.");
  return premiumAnswer(lib, input);
}
