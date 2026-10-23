// Sweden: sold INDUSTRIAL real estate (factories, petrol stations/workshops, warehouses) from Statistics Sweden (SCB), table TAB1158
// "Sold industrial real estate by region, type of real estate and year": number of sales and AVERAGE purchase price (1 000 SEK) per county, yearly.
// Format checked live on 2026-10-23 from GitHub's servers (JSON-stat2, see fixtures/tab1158.json).
import { InputError, fetchJson } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { parseJsonStat, rowsWhere, JsonStatTable } from "../../lib/adapters";
import { SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "se-scb-commercial-property",
  country: "SE (Sweden)",
  category: "commercial property (official statistics, sold industrial real estate)",
  name: "Sold industrial real estate, average purchase price (Statistics Sweden, table TAB1158)",
  publisher: "Statistics Sweden (SCB)",
  what_is_recorded:
    "Number of sold industrial properties (manufacturing, petrol stations and workshops, warehouses) and their average purchase price in SEK, by county and year, from the property register's recorded purchase prices.",
  price_type: "official_statistic",
  freshness: "Yearly; sales during 2025, published 5 June 2026",
  licence: "CC0 (Statistics Sweden open data API): data may be used and shared without any requirement to state the source",
  licence_url: "https://www.scb.se/en/About-us/about-the-website-and-terms-of-use/open-data-api/",
  attribution: "Based on data from Statistics Sweden (SCB), sold industrial real estate (table TAB1158). CC0. ProofPrice is not a partner of Statistics Sweden.",
  homepage: "https://www.statistikdatabasen.scb.se/pxweb/en/ssd/START__BO__BO0501/",
  limits:
    "An average price per PROPERTY (not per square metre) over all sales of that type in the county and year, published by SCB with the number of sales; there is no range or median, and a few large deals can move the average a lot. Only industrial real estate (factories, petrol stations and workshops, warehouses); shops, offices and building plots are not in this table. Yearly counties, not towns or postcodes. Cells with fewer than 5 sales are not shown.",
};

const TYPES = ["420426", "430431", "432"];
const C_N = "BO0501G5";
const C_AVG = "BO0501G6";
const MIN_SALES = 5;

export const URL_ALL =
  "https://api.scb.se/OV0104/v2beta/api/v2/tables/TAB1158/data?lang=en&outputFormat=json-stat2" +
  "&valueCodes%5BRegion%5D=*&valueCodes%5BFastighetstyp%5D=420426,430431,432&valueCodes%5BContentsCode%5D=BO0501G5,BO0501G6&valueCodes%5BTid%5D=top(3)";

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.,']/g, "").replace(/\s+/g, " ").trim();
}

export function parseTable(json: unknown): JsonStatTable {
  const t = parseJsonStat(json);
  for (const d of ["Region", "Fastighetstyp", "ContentsCode", "Tid"]) {
    if (!t.codes[d]) throw new SourceError("Statistics Sweden changed the layout of table TAB1158; this source needs updating.");
  }
  for (const c of [C_N, C_AVG]) {
    if (!t.codes.ContentsCode.includes(c)) throw new SourceError("Statistics Sweden no longer publishes the industrial real estate prices in table TAB1158; this source needs updating.");
  }
  return t;
}

export function countyNames(table: JsonStatTable): string[] {
  return table.codes.Region.filter((c) => c !== "00").map((c) => table.labels.Region[c].replace(/ county$/i, ""));
}

export function matchRegion(table: JsonStatTable, input: string | undefined): { code: string; label: string } {
  const q = norm(input ?? "sweden").replace(/ (county|lan)$/, "").replace(/^(greater|metropolitan) /, "");
  if (["sweden", "sverige", "national", "nationwide", "whole country", "all"].includes(q)) return { code: "00", label: "Sweden" };
  for (const c of table.codes.Region) {
    if (c === "00") continue;
    const name = table.labels.Region[c].replace(/ county$/i, "");
    if (norm(name) === q || (q === "vastra gotaland" && c === "14") || (q === "gothenburg" && c === "14") || (q === "goteborg" && c === "14")
      || (q === "malmo" && c === "12") || (q === "skane" && c === "12") || (q === "stockholm" && c === "01")) {
      return { code: c, label: name + " county" };
    }
  }
  throw new InputError("'" + input + "' is not a county in the Swedish industrial property statistics. Use Sweden (whole country) or a county such as " + countyNames(table).slice(0, 6).join(", ") + ".");
}

export interface TypePick { type: string; label: string; sales: number; average: number }
export interface Pick { year: string; sales: number; average: number; byType: TypePick[]; hidden_types: string[] }

/** Latest year in which the county has at least 5 sales with published prices; the headline is the sales-weighted mean of the types' averages. */
export function pickLatest(table: JsonStatTable, region: string): Pick | null {
  const rows = rowsWhere(table, { Region: region });
  const years = [...new Set(rows.map((r) => String(r.Tid)))].sort().reverse();
  for (const y of years) {
    const used: TypePick[] = [];
    const hidden: string[] = [];
    for (const t of TYPES) {
      const v = (c: string) => rows.find((r) => String(r.Tid) === y && r.Fastighetstyp === t && r.ContentsCode === c)?.value ?? null;
      const n = v(C_N);
      const a = v(C_AVG);
      const label = table.labels.Fastighetstyp[t] ?? t;
      if (n !== null && n > 0 && a !== null && a > 0) used.push({ type: t, label, sales: n, average: a * 1000 });
      else hidden.push(label);
    }
    const sales = used.reduce((s, u) => s + u.sales, 0);
    if (sales >= MIN_SALES) {
      const average = used.reduce((s, u) => s + u.sales * u.average, 0) / sales;
      return { year: y, sales, average, byType: used, hidden_types: hidden };
    }
  }
  return null;
}

export interface SeCommercialInput { town?: string; postcode?: string; property_type?: string; baseUrl?: string }

export async function seCommercialProperty(input: SeCommercialInput, fetcher?: (url: string) => Promise<unknown>): Promise<PriceAnswer> {
  if (input.postcode) throw new InputError("Sweden has county figures only: leave out postcode and give the county as town (for example 'Skåne'), or leave town out for the whole country.");
  if (input.property_type === "land") {
    throw new InputError("Sweden has no building-plot price statistics here: Statistics Sweden's table covers sold industrial real estate (factories, petrol stations and workshops, warehouses). Use property_type=commercial.");
  }
  const get = fetcher ?? ((u: string) => fetchJson(u, {}, 20000));
  const table = parseTable(await get(URL_ALL));
  const region = matchRegion(table, input.town);
  const pick = pickLatest(table, region.code);
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "SE", town: region.label, property_type: "commercial" },
    value: pick ? pick.average : null,
    measure: "average",
    currency: "SEK",
    unit: "per property",
    period: pick ? { from: `${pick.year}-01-01`, to: `${pick.year}-12-31` } : { from: null, to: null },
    reference_period: pick ? pick.year : "",
    sample_size: pick ? pick.sales : null,
    method:
      "Sweden (Statistics Sweden, table TAB1158): the average recorded purchase price of industrial properties (manufacturing, petrol stations and workshops, warehouses) sold in the county during the year, taken as the mean of the three types' published averages weighted by their number of sales. This is a price per property, not per square metre. Types with fewer than 5 sales or no published price are left out; so are counties with fewer than 5 sales in total.",
    describe: (v) => `The average purchase price of an industrial property sold in ${region.label} in ${pick!.year} was ${fmtMoney(v, "SEK")} per property, across ${pick!.sales} sales.`,
    note: "Average price per industrial property (not per m2); a few large sales can move it a lot. Shops, offices and building plots are not included.",
    baseUrl: input.baseUrl,
    published: table.updated ?? null,
    extra: pick
      ? {
          region: { name: region.label, scb_code: region.code },
          sales: pick.sales,
          price_basis: "average purchase price per property, SEK (not per m2)",
          by_type: pick.byType
            .filter((t) => t.sales >= MIN_SALES)
            .map((t) => ({ type: t.label, sales: t.sales, average_price: Math.round(t.average) })),
          types_not_shown: pick.hidden_types.concat(pick.byType.filter((t) => t.sales < MIN_SALES).map((t) => t.label)),
          table_updated: table.updated,
        }
      : { reason: `No year with at least ${MIN_SALES} industrial property sales and published prices for ${region.label}. Try the whole country (leave town out).` },
  });
}
