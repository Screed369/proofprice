// Portugal medicine prices: SNS Portal da Transparência (SPMS / INFARMED), dataset "preco-medio-por-embalagem":
// the average retail value (PVP) of a pack of medicine dispensed in community pharmacies to users of the national health service
// and public subsystems, per month and mainland region, for all medicines and for generics.
// Real response (probed 29 Oct 2026 from GitHub Actions, HTTP 200, OpenDataSoft Explore API v2.1, anonymous quota 5000 calls a day):
//   https://transparencia.sns.gov.pt/api/explore/v2.1/catalog/datasets/preco-medio-por-embalagem/records?limit=12&order_by=tempo%20desc
//   {"total_count":935,"results":[{"tempo":"2026-07","regiao":"Norte","valor_pvp_ambulatorio":86750645.34,"n_o_de_embalagens_ambulatorio":6011540,
//     "preco_medio_por_embalagem_ambulatorio":14.4306858708417,"valor_pvp_genericos":24411160.54,"n_o_de_embalagens_genericos":2854413,
//     "preco_medio_por_embalagem_genericos":8.55207727122879}, ...]}
// Five regions (Norte, Centro, Lisboa, Alentejo, Algarve; mainland only) a month, Jan 2011 to Jul 2026. The figure is an average over
// every pack dispensed: no per-medicine detail. The portal publishes the average itself; we only weight the regions by packs.

import { InputError, SourceError } from "../../lib/http";
import { odsQuery, type FetchOptions } from "../../lib/adapters";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "pt-sns-medicines",
  country: "PT (Portugal, mainland)",
  category: "medicines (average retail value of dispensed packs)",
  name: "Average price per pack of medicines dispensed (Preço médio por embalagem)",
  publisher: "SNS Portal da Transparência (SPMS, E.P.E.), data from INFARMED, Ministry of Health, Portugal",
  what_is_recorded:
    "Per month and mainland region: the total retail value (PVP, the printed retail price) and the number of packs of medicines dispensed in community pharmacies " +
    "to users of the national health service (SNS) and public subsystems, for all medicines and for generics, and the average value per pack.",
  price_type: "posted_price",
  freshness: "Monthly, about seven weeks after the month ends; every answer states its month",
  licence:
    "Reuse permitted under the Portuguese public-sector information reuse law (Lei n.º 26/2016) with the source named, the context kept and changes stated " +
    "(portal terms, sections 7.3 and 7.4); the portal names no open licence. Free tier only.",
  licence_url: "https://transparencia.sns.gov.pt/pages/termos-e-condicoes/",
  attribution:
    "Fonte: INFARMED / SNS Portal da Transparência (SPMS), dados reutilizados nos termos da Lei n.º 26/2016; agregação ProofPrice (regiões ponderadas pelo número de embalagens). Not endorsed by SNS or INFARMED.",
  homepage: "https://transparencia.sns.gov.pt/explore/dataset/preco-medio-por-embalagem/",
  limits:
    "An average over ALL packs dispensed, not a price list: no figure for a single medicine, strength or pack size. The value is the printed retail price (PVP) of packs " +
    "dispensed to national-health-service and public-subsystem users, not what the patient paid after reimbursement. Mainland Portugal only (no Madeira or Azores).",
};

const DOMAIN = "transparencia.sns.gov.pt";
const DATASET = "preco-medio-por-embalagem";
export const REGIONS = ["Norte", "Centro", "Lisboa", "Alentejo", "Algarve"];

export type Basket = "all" | "generics";

/** "all", "any", "average" (or empty) -> all medicines; "generic", "generics", "genérico(s)" -> generics. Anything else is a named medicine we cannot answer. */
export function normaliseBasket(medicine?: string): Basket {
  const m = String(medicine ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!m || ["all", "any", "average", "overall", "todos", "todas", "total", "medicines", "medicine"].includes(m)) return "all";
  if (["generic", "generics", "generico", "genericos", "generic medicines"].includes(m)) return "generics";
  throw new InputError(
    `Portugal has no per-medicine prices here: the official data is the average price per pack over all dispensed medicines. Give medicine=all (all medicines) or medicine=generics (generic medicines only), not '${String(medicine).trim().slice(0, 40)}'.`,
  );
}

export interface RegionMonth { month: string; region: string; value: number; packs: number; average: number }

/** Rows of the newest month that holds all five regions; throws when the response has no such month. */
export function newestMonth(results: Record<string, any>[], basket: Basket): { month: string; regions: RegionMonth[] } {
  const suffix = basket === "generics" ? "genericos" : "ambulatorio";
  const byMonth = new Map<string, RegionMonth[]>();
  for (const r of results) {
    const month = String(r?.tempo ?? "");
    const value = Number(r?.[`valor_pvp_${suffix}`]);
    const packs = Number(r?.[`n_o_de_embalagens_${suffix}`]);
    const average = Number(r?.[`preco_medio_por_embalagem_${suffix}`]);
    if (!/^\d{4}-\d{2}$/.test(month) || !r?.regiao || !(value > 0) || !(packs > 0) || !(average > 0)) continue;
    const list = byMonth.get(month) ?? [];
    if (!list.some((x) => x.region === r.regiao)) list.push({ month, region: String(r.regiao), value, packs, average });
    byMonth.set(month, list);
  }
  const months = [...byMonth.keys()].sort().reverse();
  for (const m of months) {
    const regions = byMonth.get(m)!;
    if (REGIONS.every((reg) => regions.some((x) => x.region === reg))) return { month: m, regions };
  }
  throw new SourceError("The SNS Portal da Transparência response holds no month with all five regions; the format may have changed and this source needs updating.");
}

/** Pack-weighted national average: total value / total packs. */
export function nationalAverage(regions: RegionMonth[]): { average: number; packs: number; value: number } {
  const value = regions.reduce((s, r) => s + r.value, 0);
  const packs = regions.reduce((s, r) => s + r.packs, 0);
  return { average: value / packs, packs, value };
}

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function ptAnswer(results: Record<string, any>[], basket: Basket, baseUrl?: string): PriceAnswer {
  const { month, regions } = newestMonth(results, basket);
  const nat = nationalAverage(regions);
  const what = basket === "generics" ? "generic medicines" : "medicines";
  const lo = Math.min(...regions.map((r) => r.average));
  const hi = Math.max(...regions.map((r) => r.average));
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "PT", medicine: basket },
    value: nat.average,
    measure: "average",
    currency: "EUR",
    unit: "per pack (average retail value of packs dispensed)",
    period: { from: `${month}-01`, to: monthEnd(month) },
    reference_period: month,
    sample_size: nat.packs,
    min: lo,
    max: hi,
    method:
      `Portugal's SNS Portal da Transparência publishes, for each mainland region and month, the retail value (PVP) and the number of packs of ${what} dispensed in community pharmacies to national-health-service and public-subsystem users. ` +
      "We add the five regions (total value divided by total packs) for the newest month. An average over all packs, not a price list and not per medicine.",
    describe: (v) =>
      `In ${month}, packs of ${what} dispensed in mainland Portuguese community pharmacies to national-health-service and public-subsystem users had an average retail value (PVP) of ${fmtMoney(v, "EUR")} per pack, ` +
      `across ${nat.packs.toLocaleString("en-GB")} packs; regional averages ran from ${fmtMoney(lo, "EUR")} to ${fmtMoney(hi, "EUR")}. ` +
      "This is an average over all packs, not the price of any one medicine, and it is the printed retail price, not what patients paid after reimbursement.",
    ending: `Average calculated by ProofPrice from the regional figures published by the SNS Portal da Transparência for ${month}.`,
    baseUrl,
    extra: {
      basket,
      by_region: Object.fromEntries(regions.map((r) => [r.region, { average_per_pack: Math.round(r.average * 100) / 100, packs: r.packs }])),
      price_level: "retail_list_price_average",
    },
  });
}

export async function ptMedicines(input: { medicine?: string; baseUrl?: string }, o: FetchOptions = {}): Promise<PriceAnswer> {
  const basket = normaliseBasket(input.medicine);
  const { results } = await odsQuery(DOMAIN, DATASET, { orderBy: "tempo desc", limit: 20 }, o);
  return ptAnswer(results, basket, input.baseUrl);
}
