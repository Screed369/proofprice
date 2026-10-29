// Île-de-France public transport fares: Île-de-France Mobilités' posted tariff list (dataset "titres-et-tarifs", OpenDataSoft on
// data.iledefrance-mobilites.fr, also on data.gouv.fr). Format checked live on 2026-10-29 through the GitHub probe: plain GET, no key,
// Explore API v2.1 records, 30 products (total_count 30). Fields: product_name, short_description, price_indication, price_period,
// price (French text: "2,55€", "86,40 €", "dès 30,60€", "-50%", "Gratuit", "Prix variable"), selling_arguments, url.
// Posted list prices, the same for everyone in a fare group, not amounts paid. Licence Ouverte v2.0 (Etalab).

import { odsQuery } from "../../lib/adapters";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const DOMAIN = "data.iledefrance-mobilites.fr";
export const DATASET = "titres-et-tarifs";

export const INFO: SourceInfo = {
  id: "fr-idfm-fares",
  country: "FR (Île-de-France)",
  category: "transport fares (Paris region metro, RER, train, bus and tram)",
  name: "Île-de-France Mobilités posted fares: single tickets and Navigo passes",
  publisher: "Île-de-France Mobilités, published on data.gouv.fr and data.iledefrance-mobilites.fr",
  what_is_recorded:
    "The posted price of each Île-de-France public transport ticket and pass (single ticket, day, week, month and year passes, student and youth passes). A published tariff list, not amounts paid.",
  price_type: "posted_price",
  freshness: "Updated by the publisher when fares change (the list read 29 Oct 2026 had been modified on 28 Oct 2026)",
  licence: "Licence Ouverte v2.0 (Etalab): reuse including commercial use, with attribution",
  licence_url: "https://www.etalab.gouv.fr/wp-content/uploads/2017/04/ETALAB-Licence-Ouverte-v2.0.pdf",
  attribution:
    "Source: Île-de-France Mobilités (titres-et-tarifs, data.gouv.fr), Licence Ouverte v2.0 (Etalab). ProofPrice reads the price text and picks the product; this is not an official service of Île-de-France Mobilités.",
  homepage: "https://data.gouv.fr/en/datasets/description-et-tarif-des-titres-de-transport-en-ile-de-france",
  limits:
    "Posted list prices for the whole Île-de-France region (zones 1 to 5), not amounts paid, not a ticket and not a quote. Discounts shown as a percentage or as free travel, passes with a variable price and tickets no longer sold are not turned into a fare. No sample size.",
};

export type PriceKind = "amount" | "from" | "percent" | "free" | "variable";

export interface Product {
  name: string;
  kind: PriceKind;
  /** Euros for "amount" and "from" (the lowest price of a range); the percentage for "percent"; otherwise null. */
  value: number | null;
  /** The publisher's period text, e.g. "à l'unité", "par mois", "par an" (null when none is given). */
  period: string | null;
  discontinued: boolean;
  url: string | null;
}

/** Pure: "2,55€" -> amount 2.55; "86,40 €" -> 86.4; "dès 30,60€" -> from 30.6; "-50%" -> percent 50; "Gratuit"/"Gratuité" -> free; anything else -> variable. */
export function parsePriceText(text: string): { kind: PriceKind; value: number | null } {
  const s = text.replace(/ /g, " ").trim().toLowerCase();
  if (/^gratuit/.test(s)) return { kind: "free", value: 0 };
  const pct = s.match(/^[-−–]?\s*(\d+(?:[.,]\d+)?)\s*%$/);
  if (pct) return { kind: "percent", value: Number(pct[1].replace(",", ".")) };
  const eur = s.match(/^(dès\s+)?(\d+(?:[.,]\d+)?)\s*€$/);
  if (eur) {
    const v = Number(eur[2].replace(",", "."));
    if (Number.isFinite(v) && v > 0) return { kind: eur[1] ? "from" : "amount", value: v };
  }
  return { kind: "variable", value: null };
}

/** Pure: turn dataset records into products. Test rows are dropped; an unexpectedly short list is an error. */
export function parseProducts(records: Record<string, any>[]): Product[] {
  const out: Product[] = [];
  for (const r of records) {
    const name = String(r?.product_name ?? "").trim();
    const priceText = r?.price;
    if (!name || typeof priceText !== "string" || /^test\b/i.test(name)) continue;
    const p = parsePriceText(priceText);
    const args = String(r?.selling_arguments ?? "");
    out.push({
      name,
      kind: p.kind,
      value: p.value,
      period: typeof r?.price_period === "string" ? r.price_period.trim() : null,
      discontinued: /plus vendus?/i.test(args),
      url: typeof r?.url === "string" ? r.url : null,
    });
  }
  if (out.length < 10) throw new SourceError("The Île-de-France fare list has far fewer products than expected; this source needs updating.");
  return out;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'").toLowerCase().trim();

/** Which product answers each fare group. The list has no age or income groups with their own single fare. */
const PRODUCT_FOR: Record<string, { match: string; label: string; unit: string }> = {
  adult: { match: "ticket metro-train-rer", label: "single ticket Métro-Train-RER (valid in all zones, not airports)", unit: "per single ticket (Métro-Train-RER)" },
  student: { match: "forfait imagine r etudiant", label: "annual Imagine R student pass", unit: "per year (Imagine R student pass, file fee included)" },
};

export interface FareInput {
  fare_type?: string;
  distance_km?: number;
  travel_time?: string;
  baseUrl?: string;
}

const METHOD =
  "Île-de-France public transport: the posted price of the matching product in Île-de-France Mobilités' tariff list. A single Métro-Train-RER ticket costs the same for any distance inside the region. " +
  "A published list price, the same for everyone in the group, not a count of fares paid; the other priced products are listed in extra.products.";

/** Pure: pick the product for the request out of the parsed list. */
export function answerFromProducts(products: Product[], input: FareInput, retrievedOn: string = new Date().toISOString().slice(0, 10)): PriceAnswer {
  const group = (input.fare_type ?? "adult").toString().toLowerCase();
  if (group === "senior" || group === "disability" || group === "workfare") {
    throw new InputError(
      "For Île-de-France (FR) the list gives seniors, disabled people and people on low incomes a percentage reduction or free travel, not a fixed fare. Ask for fare_type adult (single ticket) or student (annual Imagine R pass).",
    );
  }
  if (!(group in PRODUCT_FOR)) throw new InputError("fare_type for FR must be adult or student.");
  if (input.travel_time !== undefined && input.travel_time !== "other") {
    throw new InputError("Île-de-France has no early-morning fare band: leave travel_time out or use other.");
  }
  if (input.distance_km !== undefined && (!Number.isFinite(input.distance_km) || input.distance_km < 0)) {
    throw new InputError("distance_km must be a number of kilometres, e.g. 8.5.");
  }
  const want = PRODUCT_FOR[group];
  const hit = products.find((p) => norm(p.name) === want.match && p.kind === "amount" && !p.discontinued);
  if (!hit || hit.value === null) throw new SourceError(`The Île-de-France fare list has no current price for the ${want.label}.`);
  const priced = products
    .filter((p) => (p.kind === "amount" || p.kind === "from") && !p.discontinued)
    .map((p) => ({ product: p.name, price_eur: p.value, from_price: p.kind === "from", per: p.period }));
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "FR", fare_type: group, ...(input.distance_km !== undefined ? { distance_km: input.distance_km } : {}) },
    value: hit.value,
    measure: "average",
    currency: "EUR",
    unit: want.unit,
    period: { from: retrievedOn, to: null },
    reference_period: "tariff list in force on " + retrievedOn,
    method: METHOD,
    describe: (v) => `The posted ${want.label} in Île-de-France costs EUR ${v.toFixed(2)}.`,
    note:
      "Posted list price, not an amount paid. The fare does not depend on distance inside the region." +
      (input.distance_km !== undefined && group === "adult" ? " The distance you gave does not change it." : ""),
    baseUrl: input.baseUrl,
    extra: { product: hit.name, publisher_period: hit.period, products: priced, product_url: hit.url },
  });
}

export async function idfmFares(input: FareInput, fetcher?: () => Promise<Record<string, any>[]>): Promise<PriceAnswer> {
  const records = fetcher ? await fetcher() : (await odsQuery(DOMAIN, DATASET, { limit: 100 })).results;
  return answerFromProducts(parseProducts(records), input);
}
