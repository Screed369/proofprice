// Interest rates actually charged and paid on new business in the UK, from the Bank of England Database (effective interest rates).
// Format checked live on 2026-10-21 through the GitHub probe (the IADB CSV endpoint answers from GitHub's servers; newest month then: 2026-08).
//
// What the Bank publishes: for UK-resident banks, the monthly average (weighted) sterling interest rate on NEW lending to individuals,
// to private non-financial corporations and to SMEs, and on new fixed-rate bond deposits from individuals. These are the Bank's
// "effective rates" series (Bankstats table G1.4). Each figure is passed on exactly as published, about five weeks after the month ends.

import type { Catalog, Product, RatePoint, RateSeries, RateSource } from "../_rates/rates";
import { addMonths, cleanPoints, csvLine, fetchText, libraryItem, MONTH_NAMES, PRODUCTS } from "../_rates/rates";
import { SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "gb-boe-rates",
  country: "GB",
  category: "interest-rates (rates on new loans and deposits)",
  name: "Effective interest rates on new lending and deposits (Bank of England Database)",
  publisher: "Bank of England",
  what_is_recorded:
    "For UK-resident banks, the monthly weighted-average sterling interest rate (the Bank's effective rate) on new mortgages and other new loans to individuals, " +
    "on new loans to private non-financial corporations and to small and medium-sized enterprises, and on new fixed-rate bond deposits from individuals. One published average per series and month; never an individual contract.",
  price_type: "official_statistic",
  freshness: "Monthly, about five weeks after the month ends; each answer states its month",
  licence: "UK Open Government Licence v3.0 (the Bank of England says data in its Database are reusable under it; these series are in the Database)",
  licence_url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  attribution:
    "Contains public sector information licensed under the Open Government Licence v3.0. Source: Bank of England Database, effective interest rates on new business (Bankstats table G1.4; series codes in the answer). " +
    "Copyright the Governor and Company of the Bank of England. Rates are passed on exactly as published; differences between months are calculated by ProofPrice and say so.",
  homepage: "https://www.bankofengland.co.uk/boeapps/database/",
  limits:
    "Official averages on new business in a month, weighted across UK-resident banks (the Bank calls them effective rates): an average across lenders and contracts, not any one lender's rate, offer or quote. " +
    "Mortgage and loan series are for individuals and individual trusts (not companies), in sterling. Other loans include consumer credit and other personal lending. " +
    "Deposit series are for fixed-rate bonds. The Bank does not say how many contracts stand behind a figure; the newest months can be revised. Information only: not advice.",
  method_version: "1",
};

interface Def {
  term: string;
  code: string;
  label: string;
}

const FIXED_INDIVIDUALS = "individuals and individual trusts";

const SERIES: { product: Product; label: string; defs: Def[] }[] = [
  {
    product: "mortgage",
    label: `sterling loans secured on dwellings (mortgages) to ${FIXED_INDIVIDUALS}`,
    defs: [
      { term: "total", code: "CFMZ6JM", label: "all rate types taken together" },
      { term: "floating", code: "CFMZ6JO", label: "a floating rate" },
      { term: "fixed", code: "CFMZ6JV", label: "a fixed rate of any fixation period" },
      { term: "up-to-2y", code: "CFMZ6JX", label: "a fixed rate with an initial fixation of up to 2 years" },
      { term: "5y", code: "CFMZ6K3", label: "a fixed rate with an initial fixation of 5 years" },
    ],
  },
  {
    product: "consumer_loan",
    label: `sterling other loans (consumer credit and other personal lending) to ${FIXED_INDIVIDUALS}`,
    defs: [
      { term: "total", code: "CFMZ6K5", label: "all rate types taken together" },
      { term: "floating", code: "CFMZ6K7", label: "a floating rate" },
      { term: "fixed", code: "CFMZ6K9", label: "a fixed rate of any fixation period" },
      { term: "1-5y", code: "CFMZ6KD", label: "a fixed rate with an initial fixation of over 1 and up to 5 years" },
    ],
  },
  {
    product: "business_loan",
    label: "sterling loans to private non-financial corporations",
    defs: [
      { term: "total", code: "CFMBJ82", label: "all rate types taken together" },
      { term: "floating", code: "CFMBJ83", label: "a floating rate" },
      { term: "fixed", code: "CFMBJ84", label: "a fixed rate of any fixation period" },
    ],
  },
  {
    product: "business_loan_small",
    label: "sterling loans to small and medium-sized enterprises (SMEs)",
    defs: [
      { term: "total", code: "CFMZ6LD", label: "all rate types taken together" },
      { term: "floating", code: "CFMZJ3L", label: "a floating rate" },
      { term: "fixed", code: "CFMZJ3U", label: "a fixed rate of any fixation period" },
    ],
  },
  {
    product: "deposit",
    label: `sterling fixed-rate bond deposits from ${FIXED_INDIVIDUALS}`,
    defs: [
      { term: "total", code: "CFMZ6IE", label: "all fixed periods taken together" },
      { term: "up-to-1y", code: "CFMZ6IP", label: "a fixed period of up to 1 year" },
      { term: "1-2y", code: "CFMZ6IT", label: "a fixed period of over 1 and up to 2 years" },
      { term: "over-2y", code: "CFMZ6IV", label: "a fixed period of over 2 years" },
    ],
  },
];

export const AREA = { code: "GB", name: "the United Kingdom" };

export const CATALOG: Catalog = {
  areas: [AREA],
  forArea(code: string): RateSeries[] {
    if (code !== AREA.code) return [];
    return SERIES.flatMap((g) =>
      g.defs.map((d) => ({
        area: AREA.code,
        areaName: AREA.name,
        product: g.product,
        term: d.term,
        kind: PRODUCTS[g.product].kind,
        item: libraryItem(g.product, d.term),
        code: d.code,
        productLabel: g.label,
        termLabel: d.label,
        seriesLabel: `Bank of England Database ${d.code}: weighted average interest rate on new business, ${g.label}, ${d.label}`,
      })),
    );
  },
};

const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

/** "31 Aug 2026" -> "2026-08". */
export function boePeriod(date: string): string | null {
  const m = /^\s*\d{1,2}\s+([A-Za-z]{3})\s+(\d{4})\s*$/.exec(date);
  if (!m) return null;
  const i = MONTH_SHORT.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
  return i < 0 ? null : `${m[2]}-${String(i + 1).padStart(2, "0")}`;
}

/** Parse the IADB CSV (CSVF=TT: a block of series descriptions, a blank line, then DATE,<codes> and one row per month). Empty cells are skipped. Pure. */
export function parseBoeCsv(text: string): Map<string, RatePoint[]> {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => /^DATE,/i.test(l.trim()));
  if (at < 0) throw new SourceError("The Bank of England database answered in a format we do not recognise (no DATE header row).");
  const codes = csvLine(lines[at].trim()).slice(1).map((c) => c.trim());
  const out = new Map<string, RatePoint[]>(codes.map((c) => [c, []]));
  for (const line of lines.slice(at + 1)) {
    if (!line.trim()) continue;
    const c = csvLine(line);
    const period = boePeriod(c[0] ?? "");
    if (!period) continue;
    codes.forEach((code, i) => {
      const raw = (c[i + 1] ?? "").trim();
      if (raw === "") return;
      const value = Number(raw);
      if (Number.isFinite(value)) out.get(code)!.push({ period, value });
    });
  }
  return out;
}

const API = "https://www.bankofengland.co.uk/boeapps/iadb/fromshowcolumns.asp";

/** The Database URL for some series from the first of a month to now. */
export function boeUrl(codes: string[], fromMonth: string): string {
  const [y, m] = fromMonth.split("-");
  return `${API}?csv.x=yes&Datefrom=01/${MONTH_SHORT[Number(m) - 1]}/${y}&Dateto=now&SeriesCodes=${codes.join(",")}&CSVF=TT&UsingCodes=Y&VPD=Y&VFD=N`;
}

export function makeSource(fetcher: (url: string) => Promise<string> = fetchText): RateSource {
  const all = CATALOG.forArea("GB");
  return {
    info: INFO,
    catalog: CATALOG,
    freshDays: 75,
    method:
      "The Bank of England publishes every month the weighted-average sterling interest rate (its effective rate) on new lending to individuals, private non-financial corporations and SMEs, and on new fixed-rate bond deposits, in its Database (Bankstats table G1.4). " +
      "ProofPrice returns the latest published figure for the series asked for, exactly as published, with the earlier months. It is an official average across banks, not a quote, and no range is calculated; the Bank does not say how many contracts stand behind a figure.",
    async fetchLive(series, months, today) {
      const text = await fetcher(boeUrl([series.code], addMonths(today.toISOString().slice(0, 7), -(months + 1))));
      return cleanPoints(parseBoeCsv(text).get(series.code) ?? []);
    },
    async fetchAll(fromMonth) {
      const parsed = parseBoeCsv(await fetcher(boeUrl(all.map((s) => s.code), fromMonth)));
      return new Map(all.map((s) => [`${s.area}\u0000${s.item}`, parsed.get(s.code) ?? []] as const));
    },
  };
}
