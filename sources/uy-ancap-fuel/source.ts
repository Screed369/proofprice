// Uruguay: maximum pump-price tariffs for petrol and diesel set by Executive decree and published by ANCAP, monthly, in the national
// open-data catalogue (dataset "Precio de combustibles", CKAN datastore). Format checked live on 2026-10-22 from GitHub Actions (see fixtures.ts):
//   GET https://catalogodatos.gub.uy/api/3/action/datastore_search?resource_id=c486544e-0fca-4f6f-8403-3ee379a868f4&limit=330&sort=_id%20desc
//   -> {"success":true,"result":{"records":[{"_id":26556,"Ano":"2026","Mes":"7","Producto":"SUPER 95 30-S","Unidad":"88,67","Valor":"$/lt"}, ...],"total":26618}}
// One row per product per month since 2022, 22 products a month (newest first with sort _id desc). Quirks proven on the real data:
//  - the columns "Unidad" and "Valor" are swapped: the number (decimal comma) is in "Unidad", the unit ("$/lt", "$/kg", "$/ton") in "Valor";
//  - a month without a quotation holds "S/C" (sin cotizacion) in both; Aug and Sep 2026 are S/C for every pump fuel, so the newest quoted month is July 2026;
//  - product names carry a trailing " *" on many rows (a footnote), e.g. "GASOIL 10-S *";
//  - prices are in Uruguayan pesos and include IVA (22%) per the dataset notes. They are MAXIMUM prices fixed by decree, not what each driver paid.
// The ASCII-only query string matters: a request with accented column names was refused by the portal's security filter.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError, fetchJson } from "../../lib/http";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const RESOURCE_ID = "c486544e-0fca-4f6f-8403-3ee379a868f4";
export const DATASET_URL = "https://catalogodatos.gub.uy/dataset/ancap-precio-combustible-pe";
export const API = `https://catalogodatos.gub.uy/api/3/action/datastore_search?resource_id=${RESOURCE_ID}&limit=330&sort=_id%20desc`;
const SOURCE_LINE = 'Source: ANCAP, "Precio de combustibles" (catalogodatos.gub.uy), Licencia de Datos Abiertos - Uruguay';

export const INFO: SourceInfo = {
  id: "uy-ancap-fuel",
  country: "UY (Uruguay)",
  category: "fuel (regulated maximum pump prices)",
  name: "Precio de combustibles: precios maximos de combustibles del mercado interno (ANCAP, catalogodatos.gub.uy)",
  publisher: "ANCAP (Administracion Nacional de Combustibles, Alcohol y Portland), via the Uruguayan open-data catalogue (AGESIC)",
  what_is_recorded:
    "For each month since 2022, the maximum consumer price per litre of the fuels sold in the domestic market (Super 95 and Premium 97 petrol, gasoil 10-S and 50-S diesel), in Uruguayan pesos with IVA included, " +
    "as approved by decree of the Executive. One national figure per fuel and month; never a station or a driver.",
  price_type: "posted_pump_price",
  freshness: "Monthly: the price in force in each month; a month without a quotation is marked S/C by ANCAP",
  licence:
    'Licencia de Datos Abiertos - Uruguay (the dataset\'s own licence, odc-uy). It allows commercial and non-commercial use: the data may be "vendidos, copiados, distribuidos, traducidos, adaptados, fusionados con datos propios y de terceros, integrados en los procesos de negocio, productos y aplicaciones internas y externas". ' +
    'The provider, the licence and the dataset must always be cited, and changes must be mentioned in the source note.',
  licence_url:
    "https://www.gub.uy/agencia-gobierno-electronico-sociedad-informacion-conocimiento/sites/agencia-gobierno-electronico-sociedad-informacion-conocimiento/files/documentos/publicaciones/licencia_de_datos_abiertos_0.pdf",
  attribution:
    `${SOURCE_LINE} (${DATASET_URL}). Converted and aggregated by ProofPrice: the newest quoted month is passed on with the change on the previous quoted month and a year earlier calculated from the same dataset; no price is changed.`,
  homepage: DATASET_URL,
  limits:
    "A regulated MAXIMUM price per litre set by decree (national, IVA included), not the price at a station, town or postcode and not what each driver paid: an area or postcode in a request is answered with the national figure and says so. " +
    "ANCAP gives no count of sales or stations. Months without a quotation (S/C) are skipped: the answer is for the newest month that has a number and says which months were not quoted. " +
    "Only Super 95 (petrol95) and gasoil 10-S (diesel) can be asked for; premium 97 and gasoil 50-S are given in the extra fields.",
};

export type UyFuel = "petrol95" | "diesel";
export const FUEL_ORDER: UyFuel[] = ["petrol95", "diesel"];
export const FUELS: Record<UyFuel, { product: string; label: string; also: { product: string; label: string } }> = {
  petrol95: { product: "SUPER 95 30-S", label: "Super 95 petrol", also: { product: "PREMIUM 97 30-S", label: "Premium 97 petrol" } },
  diesel: { product: "GASOIL 10-S", label: "gasoil 10-S diesel", also: { product: "GASOIL 50-S", label: "gasoil 50-S diesel" } },
};

export interface Quote {
  month: string; // YYYY-MM
  product: string; // normalised: upper case, no asterisk
  value: number | null; // pesos per litre; null = S/C (no quotation)
}

const normProduct = (s: string) => s.replace(/\*/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const asNumber = (s: string): number | null => {
  const t = s.trim();
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$|^\d+\.\d+$/.test(t)) return null;
  const v = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(v) && v > 0 ? v : null;
};

/** Pure: the datastore reply -> quotes of per-litre products. Reads the number from whichever of "Unidad" / "Valor" holds it (they are swapped
 *  in the real data, so a later fix by the publisher still works). Throws SourceError, saying what changed, if the layout is not the known one. */
export function parseQuotes(body: unknown): Quote[] {
  const recs = (body as { result?: { records?: unknown } })?.result?.records;
  if (!Array.isArray(recs)) throw new SourceError("The Uruguay open-data portal answered in an unexpected format (no records list); this source needs updating.");
  const out: Quote[] = [];
  for (const r of recs as Record<string, unknown>[]) {
    const ano = String(r?.Ano ?? "").trim();
    const mes = String(r?.Mes ?? "").trim();
    if (!/^\d{4}$/.test(ano) || !/^\d{1,2}$/.test(mes) || Number(mes) < 1 || Number(mes) > 12 || typeof r.Producto !== "string") continue;
    const a = String(r.Unidad ?? "");
    const b = String(r.Valor ?? "");
    const [num, unit] = asNumber(a) !== null ? [a, b] : [b, a];
    const value = asNumber(num);
    if (value !== null && unit.trim() !== "$/lt") continue; // only per-litre products matter; a number with another unit is not ours
    out.push({ month: `${ano}-${mes.padStart(2, "0")}`, product: normProduct(r.Producto), value });
  }
  if (!out.length) throw new SourceError("The Uruguay open-data portal returned no usable price rows; this source needs updating.");
  return out;
}

export async function fetchQuotes(): Promise<Quote[]> {
  return parseQuotes(await fetchJson(API, { headers: { accept: "application/json" } }, 25000));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const shift = (m: string, by: number) => {
  const t = Number(m.slice(0, 4)) * 12 + (Number(m.slice(5, 7)) - 1) + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const lastDay = (m: string) => `${m}-${String(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
const pct = (now: number, then: number) => Math.round(((now - then) / then) * 1000) / 10;

export interface UyFuelInput {
  fuel: string;
  area?: string;
  town?: string;
  postcode?: string;
  baseUrl?: string;
}

export function uyFuelMethod(): string {
  return (
    "Uruguay (fuel): ANCAP publishes, in the national open-data catalogue, the maximum consumer price per litre of the domestic-market fuels, approved by decree and in force each month, in Uruguayan pesos with IVA included. " +
    "We read the newest months from the catalogue and pass on the figure for the newest month that has a quotation, with the change on the previous quoted month and on the same month a year earlier. " +
    "It is a regulated national maximum with no count of sales, not a station price and not what each driver paid."
  );
}

const quoteOf = (qs: Quote[], product: string, month: string): number | null => qs.find((q) => q.product === product && q.month === month)?.value ?? null;

/** Pure: the answer from the parsed quotes. `today` only decides the "old data" note. */
export function uyFuelAnswer(qs: Quote[], input: UyFuelInput, today = new Date()): PriceAnswer {
  const fuel = input.fuel as UyFuel;
  if (!FUEL_ORDER.includes(fuel)) {
    throw new InputError("Uruguay: ANCAP publishes maximum prices for Super 95 petrol (petrol95) and gasoil 10-S diesel (diesel). Other fuels are not available for Uruguay.");
  }
  const def = FUELS[fuel];
  const asked = [input.postcode && `postcode ${input.postcode}`, input.town, input.area].filter(Boolean) as string[];
  const query = { country: "UY", fuel, ...(input.area ? { area: input.area } : {}), ...(input.town ? { town: input.town } : {}), ...(input.postcode ? { postcode: input.postcode } : {}) };
  const base = { source: INFO, query, measure: "average" as const, currency: "UYU", unit: "per litre", method: uyFuelMethod(), baseUrl: input.baseUrl };
  const own = qs.filter((q) => q.product === def.product).sort((a, b) => (a.month < b.month ? 1 : -1));
  const head = own.find((q) => q.value !== null);
  if (!head) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `ANCAP's dataset holds no recent quoted maximum price of ${def.label} for Uruguay. Try another fuel (${FUEL_ORDER.join(", ")}).` };
  }
  const value = head.value as number;
  const newestMonth = qs.reduce((m, q) => (q.month > m ? q.month : m), head.month);
  const unquoted = own.filter((q) => q.value === null && q.month > head.month).map((q) => q.month).sort();
  const prevMonth = own.find((q) => q.value !== null && q.month < head.month);
  const year = quoteOf(qs, def.product, shift(head.month, -12));
  const alsoVal = quoteOf(qs, def.also.product, head.month);
  const notes = [`A regulated maximum price in force in ${monthName(head.month)}, set by decree and including IVA, not the price at a station and not what each driver paid.`];
  if (unquoted.length) notes.push(`ANCAP shows no quotation (S/C) for ${def.label} in ${unquoted.map(monthName).join(" and ")}, so the newest quoted month is given.`);
  else if (newestMonth > head.month) notes.push(`The dataset already holds ${monthName(newestMonth)} for other products, but not for this fuel.`);
  if (asked.length) notes.push(`ANCAP publishes no figure by ${asked.join(", ")}: the national maximum price for Uruguay is given.`);
  const ageMonths = (today.getUTCFullYear() - Number(head.month.slice(0, 4))) * 12 + (today.getUTCMonth() + 1 - Number(head.month.slice(5, 7)));
  if (ageMonths > 2) notes.push(`Old data: the newest quoted month for this fuel is ${ageMonths} months old.`);
  const mk = (ref: string | null, v: number | null) => (ref && v !== null ? { reference_month: ref, value: v, change_percent: pct(value, v) } : null);
  return buildStatisticAnswer({
    ...base,
    value: Math.round(value * 100) / 100,
    period: { from: `${head.month}-01`, to: lastDay(head.month) },
    reference_period: head.month,
    note: notes.join(" "),
    evidence: { label: "Regulated maximum price", meaning: "A maximum consumer price per litre fixed by decree of the Uruguayan Executive and published by ANCAP. Not a transaction price and not an average of sales." },
    describe: (v) =>
      `The maximum price of ${def.label} in Uruguay was ${fmtMoney(v, "UYU")} per litre in ${monthName(head.month)} (set by decree, IVA included). ` +
      (year !== null ? (year === value ? "That is unchanged from a year earlier. " : `That is ${Math.abs(pct(value, year))}% ${value > year ? "higher" : "lower"} than a year earlier (${fmtMoney(year, "UYU")}). `) : "") +
      "This is a regulated national maximum, not a station price.",
    extra: {
      country_name: "Uruguay",
      fuel: { requested: fuel, label: def.label, ancap_product: def.product },
      reference_month: head.month,
      change_on_previous_quoted_month: mk(prevMonth?.month ?? null, prevMonth?.value ?? null),
      change_on_year_earlier: mk(year !== null ? shift(head.month, -12) : null, year),
      months_without_quotation_since: unquoted,
      same_month_other_grade: alsoVal !== null ? { label: def.also.label, ancap_product: def.also.product, value: alsoVal, currency: "UYU", unit: "per litre" } : null,
      what_this_is: "Maximum consumer price per litre fixed by decree and published by ANCAP, in Uruguayan pesos with IVA. Not a station price, not a transaction price, no count of sales.",
      dataset: { name: INFO.name, url: DATASET_URL, resource_id: RESOURCE_ID },
      attribution_notice: SOURCE_LINE,
      ...(asked.length ? { place_note: `Not used: ${asked.join(", ")}. National maximum price returned.` } : {}),
    },
  });
}

export async function uyFuelNow(input: UyFuelInput, today = new Date()): Promise<PriceAnswer> {
  if (!FUEL_ORDER.includes(input.fuel as UyFuel)) {
    throw new InputError("Uruguay: ANCAP publishes maximum prices for Super 95 petrol (petrol95) and gasoil 10-S diesel (diesel). Other fuels are not available for Uruguay.");
  }
  return uyFuelAnswer(await fetchQuotes(), input, today);
}

// ---------- daily collector (stale-if-error copy) ----------
// Once a day the collector stores the newest month in which BOTH Super 95 and gasoil 10-S have a quotation: one national row per
// fuel (area UY), n NO_COUNT because ANCAP publishes a decreed maximum, not a count of sales. Rows are dated by the last day of
// that month (referenceDates), so the copy keeps standing in for the live portal for a week when catalogodatos.gub.uy is down.

/** Pure: the quotes -> the library rows for the newest month quoted for every pump fuel. */
export function uyHarvestRows(qs: Quote[]): HarvestResult {
  const quoted = (product: string) => new Set(qs.filter((q) => q.product === product && q.value !== null).map((q) => q.month));
  const sets = FUEL_ORDER.map((f) => quoted(FUELS[f].product));
  const common = [...sets[0]].filter((m) => sets.every((s) => s.has(m))).sort();
  const month = common[common.length - 1];
  if (!month) throw new SourceError("ANCAP dataset holds no month with a quoted maximum price for both Super 95 and gasoil 10-S; this source needs updating.");
  const rows = FUEL_ORDER.map((f) => {
    const v = Math.round((quoteOf(qs, FUELS[f].product, month) as number) * 100) / 100;
    return { area: "UY", item: f, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v };
  });
  return {
    date: lastDay(month),
    currency: "UYU",
    unit: "per litre",
    rows,
    note: "ANCAP regulated maximum consumer price per litre (set by decree, IVA included) of Super 95 and gasoil 10-S for the newest month quoted for both. A published decreed maximum, not a count of records.",
  };
}

export async function uyFuelHarvest(): Promise<HarvestResult> {
  return uyHarvestRows(await fetchQuotes());
}

export function uyFuelHistoryKey(p: { fuel?: string }): { area: string; item: string; label: string } | null {
  return p.fuel === "petrol95" || p.fuel === "diesel" ? { area: "UY", item: p.fuel, label: "Uruguay (national maximum price)" } : null;
}
