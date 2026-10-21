// Interest rates actually charged on new lending by Canadian chartered banks, from the Bank of Canada (Valet API), which publishes the
// OSFI "Report on New and Existing Lending (A4)" figures as the series group A4_RATES_*.
// Format checked live on 2026-10-21 through the GitHub probe (newest month then: 2026-07; the Bank publishes about eleven weeks after the month ends).
//
// What is published: for the major chartered banks, the average interest rate charged on FUNDS ADVANCED in the month (new lending), for
// insured and uninsured residential mortgages (by variable rate or fixed term), consumer credit and business loans. We use only the
// "funds advanced" series (new lending), never the "outstanding balances" series (existing lending). Passed on exactly as published.

import type { Catalog, Product, RatePoint, RateSeries, RateSource } from "../_rates/rates";
import { addMonths, cleanPoints, fetchText, libraryItem, PRODUCTS } from "../_rates/rates";
import { SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "ca-boc-rates",
  country: "CA",
  category: "interest-rates (rates on new loans and deposits)",
  name: "Interest rates charged for new lending by chartered banks (funds advanced)",
  publisher: "Bank of Canada (from the OSFI Report on New and Existing Lending, A4)",
  what_is_recorded:
    "For Canadian chartered banks, the monthly average interest rate charged on funds advanced in the month: insured and uninsured residential mortgages (variable rate and fixed terms), " +
    "consumer credit and business loans. One published average per series and month; never an individual contract.",
  price_type: "official_statistic",
  freshness: "Monthly, about eleven weeks after the month ends; each answer states its month",
  licence: "Open Government Licence - Canada (the dataset is listed on open.canada.ca under it); the Bank of Canada's terms also allow free reuse with attribution",
  licence_url: "https://open.canada.ca/en/open-government-licence-canada",
  attribution:
    "Contains information licensed under the Open Government Licence - Canada. Source: Bank of Canada, Interest rates charged for new and existing lending by chartered banks (series A4_RATES, Valet API; data from the OSFI Report on New and Existing Lending, A4). " +
    "Rates are passed on exactly as published; differences between months are calculated by ProofPrice and say so.",
  homepage: "https://www.bankofcanada.ca/rates/banking-and-financial-statistics/interest-rates-for-new-and-existing-lending-by-chartered-banks/",
  limits:
    "Official averages on funds advanced in a month, across the reporting chartered banks: not any one lender's rate, offer or quote, and not a posted rate. " +
    "Canada publishes insured and uninsured mortgages separately (there is no single mortgage figure). Consumer credit and business loans are totals only. " +
    "No deposit rates. The Bank does not say how many loans stand behind a figure; the newest months can be revised. Information only: not advice.",
  method_version: "1",
};

export const AREA = { code: "CA", name: "Canada" };

interface Def {
  term: string;
  code: string;
  label: string;
}

const MORTGAGE_TERMS = (codes: string[]): Def[] => [
  { term: "total", code: codes[0], label: "all rate types taken together" },
  { term: "floating", code: codes[1], label: "a variable rate" },
  { term: "up-to-1y", code: codes[2], label: "a fixed rate with a term of under 1 year" },
  { term: "1-3y", code: codes[3], label: "a fixed rate with a term of 1 to under 3 years" },
  { term: "3-5y", code: codes[4], label: "a fixed rate with a term of 3 to under 5 years" },
  { term: "over-5y", code: codes[5], label: "a fixed rate with a term of 5 years and over" },
];

const SERIES: { product: Product; label: string; defs: Def[] }[] = [
  { product: "mortgage_insured", label: "insured residential mortgages", defs: MORTGAGE_TERMS(["V122667775", "V122667776", "V122667777", "V122667778", "V122667779", "V122667780"]) },
  { product: "mortgage_uninsured", label: "uninsured residential mortgages", defs: MORTGAGE_TERMS(["V122667781", "V122667782", "V122667783", "V122667784", "V122667785", "V122667786"]) },
  { product: "consumer_loan", label: "consumer credit (non-mortgage loans to individuals)", defs: [{ term: "total", code: "V122667803", label: "all types of consumer credit taken together" }] },
  { product: "business_loan", label: "business loans (credit extended to the corporate sector)", defs: [{ term: "total", code: "V122667816", label: "all types of business loan taken together" }] },
];

export const CATALOG: Catalog = {
  areas: [AREA],
  aliases: {
    mortgage: {
      to: "mortgage_uninsured",
      note: "Canada publishes insured and uninsured mortgage rates separately, so this is the uninsured (conventional) mortgage rate; ask for product=mortgage_insured for insured mortgages.",
    },
  },
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
        seriesLabel: `Bank of Canada Valet ${d.code}: interest rate charged on funds advanced (new lending), ${g.label}, ${d.label}`,
      })),
    );
  },
};

/** Parse a Valet observations reply: {"observations":[{"d":"2026-07-01","V122667775":{"v":"4.16"}}]}. Missing values are skipped. Pure. */
export function parseValet(text: string): Map<string, RatePoint[]> {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SourceError("The Bank of Canada Valet API answered in a format we do not recognise (not JSON).");
  }
  if (!Array.isArray(json?.observations)) throw new SourceError("The Bank of Canada Valet API answered in a format we do not recognise (no observations).");
  const out = new Map<string, RatePoint[]>();
  for (const o of json.observations) {
    const period = String(o?.d ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(period)) continue;
    for (const [code, cell] of Object.entries(o)) {
      if (code === "d") continue;
      const raw = String((cell as any)?.v ?? "").trim();
      if (raw === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      const list = out.get(code) ?? [];
      list.push({ period, value });
      out.set(code, list);
    }
  }
  return out;
}

const API = "https://www.bankofcanada.ca/valet/observations/";
export const valetUrl = (codes: string[], fromMonth: string) => `${API}${codes.join(",")}/json?start_date=${fromMonth}-01`;

export function makeSource(fetcher: (url: string) => Promise<string> = fetchText): RateSource {
  const all = CATALOG.forArea("CA");
  return {
    info: INFO,
    catalog: CATALOG,
    freshDays: 120,
    method:
      "The Bank of Canada publishes every month, from the OSFI Report on New and Existing Lending (A4), the average interest rate chartered banks charged on funds advanced in the month, for residential mortgages (insured and uninsured, by variable rate or fixed term), consumer credit and business loans. " +
      "ProofPrice returns the latest published figure for the series asked for, exactly as published, with the earlier months. It is an official average across banks, not a quote, and no range is calculated; the Bank does not say how many loans stand behind a figure.",
    async fetchLive(series, months, today) {
      const text = await fetcher(valetUrl([series.code], addMonths(today.toISOString().slice(0, 7), -(months + 1))));
      return cleanPoints(parseValet(text).get(series.code) ?? []);
    },
    async fetchAll(fromMonth) {
      const parsed = parseValet(await fetcher(valetUrl(all.map((s) => s.code), fromMonth)));
      return new Map(all.map((s) => [`${s.area}\u0000${s.item}`, parsed.get(s.code) ?? []] as const));
    },
  };
}
