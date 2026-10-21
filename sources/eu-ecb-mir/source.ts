// Interest rates actually agreed on new loans and deposits, from the ECB's MFI interest rate statistics (dataset MIR) in the ECB Data Portal.
// Format checked live on 2026-10-21 through the GitHub probe (the ECB API answers from GitHub's servers; newest month then: 2026-08).
//
// What the ECB publishes: for the euro area and each euro-area country, the monthly average rate banks agreed on NEW business: household
// loans for house purchase and for consumption, loans to non-financial corporations (up to and over EUR 1 million), and household deposits,
// by initial rate-fixation period or agreed maturity. The data type used is "R", the annualised agreed rate (AAR) / narrowly defined
// effective rate (NDER). Each figure is passed on exactly as published. The newest month is published about five weeks after it ends.

import type { Catalog, Product, RatePoint, RateSeries, RateSource } from "../_rates/rates";
import { addMonths, allSeries, cleanPoints, csvLine, fetchText, libraryItem, PRODUCTS } from "../_rates/rates";
import { SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "eu-ecb-mir",
  country: "Euro area and its member countries",
  category: "interest-rates (rates on new loans and deposits)",
  name: "MFI interest rate statistics (MIR): rates on new business",
  publisher: "European Central Bank",
  what_is_recorded:
    "For the euro area and each euro-area country, the monthly average interest rate (annualised agreed rate) that banks agreed on new loans to households (house purchase, consumption), " +
    "on new loans to non-financial corporations (up to and over EUR 1 million) and on household deposits, by initial rate-fixation period or agreed maturity. " +
    "One published average per series and month; never an individual contract.",
  price_type: "official_statistic",
  freshness: "Monthly, about five weeks after the month ends; each answer states its month",
  licence: "ECB copyright notice: free use, including commercial use, if the ECB is cited as the source and the data appear accurately; any modification must be stated",
  licence_url: "https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html",
  attribution:
    "Source: ECB statistics (MFI interest rate statistics, dataset MIR, https://data.ecb.europa.eu/). The rates are passed on exactly as published by the ECB, unmodified. " +
    "Differences between months are calculated by ProofPrice and say so. The same figures are available free of charge from the ECB Data Portal.",
  homepage: "https://data.ecb.europa.eu/data/datasets/MIR/MIR.M.U2.B.A2C.A.R.A.2250.EUR.N",
  limits:
    "Official averages agreed on new business in a month, as an annualised agreed rate: an average across banks and contracts, not any one lender's rate, offer or quote. " +
    "Loans exclude revolving loans and overdrafts and credit card debt. In the euro area the ECB groups floating-rate loans with loans fixed for up to one year. " +
    "Overnight and notice deposits are reported on outstanding amounts. Some country series are missing for some terms or months; the newest months can be revised. Information only: not advice.",
  method_version: "1",
};

/** Euro-area aggregate and member countries (the ECB's REF_AREA code in `ref`; EA is its changing-composition euro area, U2). */
export const AREAS: { code: string; name: string; ref: string }[] = [
  { code: "EA", name: "the euro area", ref: "U2" },
  { code: "AT", name: "Austria", ref: "AT" }, { code: "BE", name: "Belgium", ref: "BE" }, { code: "BG", name: "Bulgaria", ref: "BG" },
  { code: "HR", name: "Croatia", ref: "HR" }, { code: "CY", name: "Cyprus", ref: "CY" }, { code: "EE", name: "Estonia", ref: "EE" },
  { code: "FI", name: "Finland", ref: "FI" }, { code: "FR", name: "France", ref: "FR" }, { code: "DE", name: "Germany", ref: "DE" },
  { code: "GR", name: "Greece", ref: "GR" }, { code: "IE", name: "Ireland", ref: "IE" }, { code: "IT", name: "Italy", ref: "IT" },
  { code: "LV", name: "Latvia", ref: "LV" }, { code: "LT", name: "Lithuania", ref: "LT" }, { code: "LU", name: "Luxembourg", ref: "LU" },
  { code: "MT", name: "Malta", ref: "MT" }, { code: "NL", name: "the Netherlands", ref: "NL" }, { code: "PT", name: "Portugal", ref: "PT" },
  { code: "SK", name: "Slovakia", ref: "SK" }, { code: "SI", name: "Slovenia", ref: "SI" }, { code: "ES", name: "Spain", ref: "ES" },
];

interface TermDef {
  /** The ECB's MATURITY_NOT_IRATE code. */
  m: string;
  label: string;
}

const fix = (words: string) => `an initial rate-fixation period of ${words}`;
/** Loan terms (MATURITY_NOT_IRATE codes checked on 2026-10-21): A total, AM composite, F floating or up to 1 year, D up to 3 months, Q 3 months to 1 year, R 1-3, S 3-5, I 1-5, J over 5, O 5-10, P over 10, K over 1 year. */
const LOAN_TERMS: Record<string, TermDef> = {
  total: { m: "A", label: "all initial rate-fixation periods taken together" },
  floating: { m: "F", label: "a floating rate or an initial rate-fixation period of up to 1 year" },
  "up-to-3m": { m: "D", label: "a floating rate or an initial rate-fixation period of up to 3 months" },
  "3m-1y": { m: "Q", label: fix("over 3 months and up to 1 year") },
  "1-3y": { m: "R", label: fix("over 1 and up to 3 years") },
  "3-5y": { m: "S", label: fix("over 3 and up to 5 years") },
  "1-5y": { m: "I", label: fix("over 1 and up to 5 years") },
  "over-5y": { m: "J", label: fix("over 5 years") },
  "5-10y": { m: "O", label: fix("over 5 and up to 10 years") },
  "over-10y": { m: "P", label: fix("over 10 years") },
  "over-1y": { m: "K", label: fix("over 1 year") },
};
const pick = (keys: string[], from: Record<string, TermDef> = LOAN_TERMS): Record<string, TermDef> => Object.fromEntries(keys.map((k) => [k, from[k]]));

const DEPOSIT_TERMS: Record<string, TermDef> = {
  total: { m: "A", label: "all agreed maturities taken together" },
  "up-to-1y": { m: "F", label: "an agreed maturity of up to 1 year" },
  "1-2y": { m: "G", label: "an agreed maturity of over 1 and up to 2 years" },
  "over-2y": { m: "H", label: "an agreed maturity of over 2 years" },
  "over-1y": { m: "K", label: "an agreed maturity of over 1 year" },
  "up-to-2y": { m: "L", label: "an agreed maturity of up to 2 years" },
};

interface Template {
  product: Product;
  /** BS_ITEM */
  item: string;
  /** BS_COUNT_SECTOR: 2250 households, 2240 non-financial corporations. */
  sector: string;
  /** AMOUNT_CAT: A total, 0 up to EUR 1 million, 1 over EUR 1 million. */
  amount: string;
  label: string;
  terms: Record<string, TermDef>;
}

/** Every series offered. The euro area aggregate has all of them; a country may lack some (the answer then says no figure is published). */
export const TEMPLATES: Template[] = [
  {
    product: "mortgage", item: "A2C", sector: "2250", amount: "A", label: "loans to households for house purchase",
    terms: {
      ...pick(["total", "floating", "1-5y", "5-10y", "over-10y", "over-1y"]),
      composite: { m: "AM", label: "the ECB's composite cost-of-borrowing indicator for house purchase (all fixation periods, volumes weighted by a moving average)" },
    },
  },
  { product: "consumer_loan", item: "A2B", sector: "2250", amount: "A", label: "loans to households for consumption", terms: pick(["total", "floating", "1-5y", "over-5y", "over-1y"]) },
  {
    product: "business_loan", item: "A2A", sector: "2240", amount: "A", label: "loans to non-financial corporations",
    terms: pick(["total", "up-to-3m", "floating", "3m-1y", "1-3y", "3-5y", "1-5y", "over-5y", "5-10y", "over-10y", "over-1y"]),
  },
  {
    product: "business_loan_small", item: "A2A", sector: "2240", amount: "0", label: "loans to non-financial corporations of up to EUR 1 million",
    terms: pick(["total", "floating", "1-5y", "over-5y", "over-1y"]),
  },
  {
    product: "business_loan_large", item: "A2A", sector: "2240", amount: "1", label: "loans to non-financial corporations of over EUR 1 million",
    terms: pick(["total", "up-to-3m", "floating", "3m-1y", "1-3y", "3-5y", "1-5y", "over-5y", "5-10y", "over-10y", "over-1y"]),
  },
  { product: "deposit", item: "L22", sector: "2250", amount: "A", label: "household deposits with an agreed maturity", terms: DEPOSIT_TERMS },
  { product: "deposit_overnight", item: "L21", sector: "2250", amount: "A", label: "household overnight deposits", terms: { total: { m: "A", label: "overnight deposits have no agreed maturity" } } },
  {
    product: "deposit_notice", item: "L23", sector: "2250", amount: "A", label: "household deposits redeemable at notice",
    terms: {
      total: { m: "A", label: "all notice periods taken together" },
      "up-to-3m": { m: "D", label: "a period of notice of up to 3 months" },
      "over-3m": { m: "E", label: "a period of notice of over 3 months" },
    },
  },
];

/** The ECB series key, e.g. MIR.M.IE.B.A2C.A.R.A.2250.EUR.N (data type R = annualised agreed rate, N = new business). */
export const ecbKey = (ref: string, t: Pick<Template, "item" | "sector" | "amount">, maturity: string) => `MIR.M.${ref}.B.${t.item}.${maturity}.R.${t.amount}.${t.sector}.EUR.N`;

export const CATALOG: Catalog = {
  areas: AREAS.map((a) => ({ code: a.code, name: a.name })),
  forArea(code: string): RateSeries[] {
    const a = AREAS.find((x) => x.code === code);
    if (!a) return [];
    return TEMPLATES.flatMap((t) =>
      Object.entries(t.terms).map(([term, def]) => ({
        area: a.code,
        areaName: a.name,
        product: t.product,
        term,
        kind: PRODUCTS[t.product].kind,
        item: libraryItem(t.product, term),
        code: ecbKey(a.ref, t, def.m),
        productLabel: t.label,
        termLabel: def.label,
        seriesLabel: `ECB MFI interest rate statistics, new business, annualised agreed rate: ${t.label}, ${def.label}`,
      })),
    );
  },
};

// ---------- reading the ECB's CSV ----------

/** Parse the ECB's csvdata (detail=dataonly or full): one point per row, grouped by series key. Rows without a value are skipped (a missing figure). Pure. */
export function parseEcbCsv(text: string): Map<string, RatePoint[]> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const out = new Map<string, RatePoint[]>();
  if (!lines.length) return out;
  const head = csvLine(lines[0]);
  const iKey = head.indexOf("KEY");
  const iTime = head.indexOf("TIME_PERIOD");
  const iVal = head.indexOf("OBS_VALUE");
  if (iKey < 0 || iTime < 0 || iVal < 0) throw new SourceError("The ECB data portal answered in a format we do not recognise (no KEY, TIME_PERIOD, OBS_VALUE columns).");
  for (const line of lines.slice(1)) {
    const c = csvLine(line);
    const raw = (c[iVal] ?? "").trim();
    if (raw === "") continue;
    const value = Number(raw);
    const period = (c[iTime] ?? "").trim();
    if (!Number.isFinite(value) || !/^\d{4}-\d{2}$/.test(period)) continue;
    const key = c[iKey];
    const list = out.get(key) ?? [];
    list.push({ period, value });
    out.set(key, list);
  }
  return out;
}

const API = "https://data-api.ecb.europa.eu/service/data/MIR/";

/** The request groups of the collector: one API call each (the key lists every area, item, maturity and amount wanted). Pure. */
export function collectorUrls(fromMonth: string, toMonth: string): string[] {
  const refs = AREAS.map((a) => a.ref).join("+");
  const groups: { items: string[]; maturities: string[]; amounts: string[]; sector: string }[] = [
    { items: ["A2C"], maturities: ["A", "AM", "F", "I", "K", "O", "P"], amounts: ["A"], sector: "2250" },
    { items: ["A2B"], maturities: ["A", "F", "I", "J", "K"], amounts: ["A"], sector: "2250" },
    { items: ["A2A"], maturities: ["A", "D", "F", "Q", "R", "S", "I", "J", "K", "O", "P"], amounts: ["0", "1", "A"], sector: "2240" },
    { items: ["L21", "L22", "L23"], maturities: ["A", "D", "E", "F", "G", "H", "K", "L"], amounts: ["A"], sector: "2250" },
  ];
  return groups.map(
    (g) => `${API}M.${refs}.B.${g.items.join("+")}.${g.maturities.join("+")}.R.${g.amounts.join("+")}.${g.sector}.EUR.N?startPeriod=${fromMonth}&endPeriod=${toMonth}&detail=dataonly&format=csvdata`,
  );
}

/** Group parsed points by the catalog's library series. Pure. */
export function toSeriesMap(parsed: Map<string, RatePoint[]>): Map<string, RatePoint[]> {
  const out = new Map<string, RatePoint[]>();
  const byCode = new Map(allSeries(CATALOG).map((s) => [s.code, s] as const));
  for (const [key, points] of parsed) {
    const s = byCode.get(key);
    if (s) out.set(`${s.area}\u0000${s.item}`, [...(out.get(`${s.area}\u0000${s.item}`) ?? []), ...points]);
  }
  return out;
}

export function makeSource(fetcher: (url: string) => Promise<string> = fetchText): RateSource {
  return {
    info: INFO,
    catalog: CATALOG,
    freshDays: 75,
    method:
      "The ECB publishes every month, for the euro area and each euro-area country, the average interest rate (annualised agreed rate) that banks agreed on new loans and deposits, by type, size and initial rate-fixation period or maturity (dataset MIR). " +
      "ProofPrice returns the latest published figure for the series asked for, exactly as published, with the earlier months. It is an official average across banks, not a quote, and no range is calculated; the ECB does not say how many contracts stand behind a figure.",
    async fetchLive(series, months, today) {
      const start = addMonths(today.toISOString().slice(0, 7), -(months + 1));
      const key = series.code.replace(/^MIR\./, "");
      const text = await fetcher(`${API}${key}?startPeriod=${start}&detail=dataonly&format=csvdata`);
      return cleanPoints(parseEcbCsv(text).get(series.code) ?? []);
    },
    async fetchAll(fromMonth, toMonth) {
      const merged = new Map<string, RatePoint[]>();
      for (const url of collectorUrls(fromMonth, toMonth)) {
        for (const [k, v] of toSeriesMap(parseEcbCsv(await fetcher(url)))) merged.set(k, [...(merged.get(k) ?? []), ...v]);
      }
      return merged;
    },
  };
}
