// Ireland: what households pay for childcare, from the Central Statistics Office (CSO) table CCA12 "Cost of Childcare",
// the QNHS (Quarterly National Household Survey) childcare module, reference year 2016. For each of the eight NUTS3 regions
// (and the State) and for pre-school children, primary school children and all children aged 0-12 it gives the average
// hourly cost, the average hours per week and the average cost per week, in euro, of the paid childcare households use.
//
// IMPORTANT: this is NOT the Pobal "Annual Early Years Sector Profile" provider-fee survey, which is only published as PDF
// reports (checked 2026-10-14: no table of it on data.gov.ie or CSO PxStat), and the figures are from 2016, so they are
// 10 years old. Every answer says so. They are what parents reported paying (not provider price lists), by region (not county).
//
// Live source: one small CSV per request (81 rows) from the CSO PxStat API; no harvest is needed.
// Format checked live on 2026-10-14: https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/CCA12/CSV/1.0/en
//   "C02196V02652","Region","C03404V04099","School Going Status","TLIST(A1)","Year","STATISTIC","Statistic Label","UNIT","VALUE"
//   "-","State","01","Pre-School children","2016","2016","CCA12C03","Average Cost per Week","Euro","118"

import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";
import { csvObjects, fetchText } from "../../categories/childcare/csv";

export const CSV_URL = "https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/CCA12/CSV/1.0/en";
export const HOMEPAGE = "https://www.cso.ie/en/statistics/surveys/qnhsmoduleonchildcare/";

export const INFO: SourceInfo = {
  id: "ie-childcare-fees",
  country: "IE",
  category: "childcare (official survey of what households pay)",
  name: "CCA12 - Cost of Childcare (QNHS childcare module)",
  publisher: "Central Statistics Office (CSO), Ireland",
  what_is_recorded:
    "The average cost per week, average hours per week and average hourly cost of the paid childcare that households use, in euro, by region of Ireland and for pre-school children, primary school children and all children aged 0 to 12. Reported by households in the CSO's Quarterly National Household Survey childcare module (2016). Not the fee lists of providers, and not the Pobal Early Years Sector Profile.",
  price_type: "official_statistic",
  freshness: "2016 only (CSO has not repeated the table); regional, not county; ten years old",
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0), as stated for this table on data.gov.ie (license_id CC-BY-4.0, license_title \"Creative Commons Attribution 4.0\"). Attribution to the Central Statistics Office, Ireland.",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Source: Central Statistics Office, Ireland, table CCA12 Cost of Childcare (QNHS childcare module 2016), licensed CC BY 4.0.",
  homepage: HOMEPAGE,
  limits:
    "Data are from 2016, ten years old: childcare costs in Ireland have changed a great deal since. Regional (NUTS3) figures only, no county, city or town. Averages across all paid childcare households use (centres, childminders and others, part-time and full-time hours together), so there is no split by care type or full-time and part-time, and no separate infant, toddler or preschool figures: pre-school children means all children not yet in primary school. Household-reported costs, not provider fees. The CSO does not say whether costs are before or after any subsidy the household received.",
};

// ---------- geography: counties and cities -> the CSO's NUTS3 regions ----------

const REGION_OF: Record<string, string> = {};
const put = (region: string, places: string[]) => places.forEach((p) => (REGION_OF[plain(p)] = region));
function plain(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bco\.?\s+/g, "")
    .replace(/\bcounty\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
put("Border", ["Cavan", "Donegal", "Leitrim", "Monaghan", "Sligo"]);
put("Midland", ["Laois", "Longford", "Offaly", "Westmeath"]);
put("West", ["Galway", "Mayo", "Roscommon", "Galway City"]);
put("Dublin", ["Dublin", "Dublin City", "Fingal", "South Dublin", "Dun Laoghaire-Rathdown", "Dun Laoghaire", "Dublin 1", "Dublin 2"]);
put("Mid-East", ["Kildare", "Louth", "Meath", "Wicklow", "Drogheda", "Dundalk"]);
put("Mid-West", ["Clare", "Limerick", "Tipperary", "Limerick City"]);
put("South-East", ["Carlow", "Kilkenny", "Waterford", "Wexford", "Waterford City"]);
put("South-West", ["Cork", "Kerry", "Cork City"]);

export const REGIONS = ["Border", "Midland", "West", "Dublin", "Mid-East", "Mid-West", "South-East", "South-West"];

/** "Dublin", "County Cork", "Co. Mayo", "Leinster"?? -> the CSO region label, or "State" for the whole country. */
export function regionFor(area: string | undefined): { region: string; viaPlace: string | null } {
  const raw = area?.trim();
  if (!raw || /^(ireland|state|republic of ireland|all|national|ie)$/i.test(raw)) return { region: "State", viaPlace: null };
  const key = plain(raw);
  const direct = REGIONS.find((r) => plain(r) === key);
  if (direct) return { region: direct, viaPlace: null };
  const hit = REGION_OF[key];
  if (hit) return { region: hit, viaPlace: raw };
  throw new InputError(`Give an Irish county, city or region (for example Dublin, Cork, Galway, or a region such as Mid-West); "${raw}" was not recognised. The CSO publishes eight regions: ${REGIONS.join(", ")}.`);
}

// ---------- the table ----------

export interface CostRow {
  region: string; // "State", "Dublin", ...
  group: string; // "Pre-School children" | "Primary school children" | "All children aged 0-12 years"
  statistic: "CCA12C01" | "CCA12C02" | "CCA12C03";
  year: string;
  value: number;
}

export function parseCca12(csv: string): CostRow[] {
  const out: CostRow[] = [];
  for (const r of csvObjects(csv)) {
    const stat = r["STATISTIC"];
    if (stat !== "CCA12C01" && stat !== "CCA12C02" && stat !== "CCA12C03") continue;
    const value = Number(r["VALUE"]);
    const region = r["Region"];
    const group = r["School Going Status"];
    if (!Number.isFinite(value) || !region || !group || !r["Year"]) continue;
    out.push({ region, group, statistic: stat, year: r["Year"], value });
  }
  if (out.length < 60) throw new SourceError(`Only ${out.length} usable rows in CSO table CCA12; the table may have changed and this source needs updating.`);
  return out;
}

const GROUPS = { preschool: "Pre-School children", school: "Primary school children", all: "All children aged 0-12 years" } as const;

export interface IeInput {
  area?: string;
  age_group?: string;
  care_type?: string;
  hours?: string;
  baseUrl?: string;
}

/** Pure: the answer from the table's rows. */
export function ieAnswer(rows: CostRow[], input: IeInput, now = new Date()): PriceAnswer {
  const { region, viaPlace } = regionFor(input.area);
  const age = input.age_group;
  const group = age === "school-age" ? GROUPS.school : age ? GROUPS.preschool : GROUPS.all;
  const pick = (stat: CostRow["statistic"], reg = region, grp = group) => rows.find((r) => r.region === reg && r.group === grp && r.statistic === stat);
  const week = pick("CCA12C03");
  const hourly = pick("CCA12C01");
  const hours = pick("CCA12C02");
  const year = week?.year ?? rows[0]?.year ?? "2016";
  const yearsOld = now.getUTCFullYear() - Number(year);
  const regionName = region === "State" ? "Ireland" : `the ${region} region`;
  const ageText = age === "school-age" ? "primary school children" : age ? "pre-school children (all children not yet at primary school)" : "children aged 0 to 12";
  const notes: string[] = [
    `This is ${yearsOld} years old (${year}): Irish childcare costs have changed a lot since, so use it only as a rough historic guide.`,
    "The CSO reports what households said they paid on average for the paid childcare they use (all kinds and all hours together), by region. It is not a provider fee list, not full-time, and not split by care type; there is no separate infant or toddler figure.",
  ];
  if (viaPlace) notes.push(`${viaPlace} is in the ${region} region, so the regional figure is shown.`);
  if (input.care_type) notes.push("care_type was ignored: the table does not split by centre and home-based care.");
  if (input.hours) notes.push("hours was ignored: the table averages part-time and full-time use (see hours_per_week).");
  if (age === "infant" || age === "toddler") notes.push(`The table has no ${age} figure; the pre-school children figure (all children below primary school age) is shown.`);
  return buildStatisticAnswer({
    source: INFO,
    query: {
      country: "IE",
      area: input.area?.trim() || "Ireland",
      age_group: age ?? null,
      care_type: input.care_type ?? null,
      hours: input.hours ?? null,
    },
    value: week?.value ?? null,
    measure: "average",
    currency: "EUR",
    unit: "per week",
    period: { from: `${year}-01-01`, to: `${year}-12-31` },
    reference_period: year,
    method:
      "Ireland (CSO table CCA12, QNHS childcare module): the average cost per week of the paid childcare that households in the chosen region use, for the chosen group of children, as published by the Central Statistics Office for 2016. We pass on the published average; it is household-reported, regional, and ten years old. It is an average, not a range built from individual bills.",
    describe: (v) =>
      `In ${year}, ${yearsOld} years ago, households in ${regionName} using paid childcare for ${ageText} spent an average of ${fmtMoney(v, "EUR")} a week` +
      `${hours ? ` (about ${hours.value} hours a week` + (hourly ? ` at an average ${fmtMoney(hourly.value, "EUR")} an hour)` : ")") : ""}.`,
    note: notes.join(" "),
    baseUrl: input.baseUrl,
    extra: week
      ? {
          region,
          children: group,
          average_hourly_cost: hourly?.value ?? null,
          average_hours_per_week: hours?.value ?? null,
          data_year: Number(year),
          data_age_years: yearsOld,
          price_basis: "average weekly cost of paid childcare reported by households (all care types, part-time and full-time together)",
          coverage_note: "Regional (NUTS3) figures. The Pobal Early Years Sector Profile county fees are not available as open data.",
        }
      : undefined,
  });
}

export async function ieChildcare(input: IeInput, now = new Date(), load: () => Promise<string> = () => fetchText(CSV_URL)): Promise<PriceAnswer> {
  const rows = parseCca12(await load());
  return ieAnswer(rows, input, now);
}
