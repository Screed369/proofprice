// Costa Rica: the regulated maximum consumer prices of fuels, set by the regulator ARESEP (Autoridad Reguladora de los Servicios Publicos).
// Format checked live on 2026-10-29 from GitHub's servers (probe crfuel-b1; fixtures/tarifas.json is a cut of that real reply):
//   GET https://datos.aresep.go.cr/ws.datosabiertos/Services/IE/TarifaCombustible.svc/ObtenerHistoricoTarifasHidrocarburos  (no key, no parameters)
//   -> 200 JSON, about 11 MB, the whole history, newest first: { metadata: {...}, value: [ { fechaRige, producto, precioFinal, precioFinalSinIVA, rige, ... } ] }
//   fechaRige = date the price applies from (ISO); precioFinal = maximum consumer price in colones (CRC) per litre, IVA included; null for products without a
//   consumer price (bunker, asphalt...). Product names are Spanish ("Gasolina RON 95", "Gasolina RON 91", "Diésel para uso automotriz de 50 ppm de azufre").
// The file is big, so only the daily collector (harvest) reads it. Answers come from the price library. One regulated figure per product, no record count.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { readLatestDay, readMeta } from "../../lib/library/store";
import { NO_COUNT } from "../../lib/stats";

export const URL_TARIFFS = "https://datos.aresep.go.cr/ws.datosabiertos/Services/IE/TarifaCombustible.svc/ObtenerHistoricoTarifasHidrocarburos";
const PAGE = "https://aresep.go.cr/datos-abiertos/tarifas-de-combustibles/";

export const INFO: SourceInfo = {
  id: "cr-aresep-fuel",
  country: "CR (Costa Rica)",
  category: "fuel (regulated maximum pump prices)",
  name: "ARESEP fuel tariffs: maximum consumer prices of hydrocarbons, colones per litre",
  publisher: "Autoridad Reguladora de los Servicios Públicos (ARESEP), Costa Rica",
  what_is_recorded:
    "The maximum price in colones (CRC) per litre, IVA included, that the regulator fixes for the consumer of Gasolina RON 95, Gasolina RON 91 and automotive diesel (50 ppm sulphur), " +
    "with the date the price applies from. One national price per product; the same price applies at every station in the country.",
  price_type: "posted_pump_price",
  freshness: "Updated when ARESEP fixes a new tariff (about once a month, sometimes more often); every answer states the date the price applies from",
  licence: "No reuse licence is stated on the ARESEP open-data page; published as open data. Free tier only until the licence is cleared",
  licence_url: PAGE,
  attribution: "Fuente: ARESEP, Datos abiertos, Tarifas de combustibles (aresep.go.cr/datos-abiertos). Passed on as published by ProofPrice, which adds no change to the figure.",
  homepage: PAGE,
  limits:
    "A regulated MAXIMUM price fixed by the regulator for the whole country, not what a given station charged and not a transaction; there is no range and no count of stations. " +
    "Only petrol95 (Gasolina RON 95) and diesel (50 ppm) are offered; Gasolina RON 91 is given as extra information. LPG, kerosene, aviation fuel and industrial products are not offered. " +
    "Area, town and postcode are not used: the price is national.",
};

export type CrFuel = "petrol95" | "diesel";
export const FUEL_ORDER: CrFuel[] = ["petrol95", "diesel"];
export const LABEL: Record<string, string> = { petrol95: "Gasolina RON 95 (super)", petrol91: "Gasolina RON 91 (regular)", diesel: "diesel (automotive, 50 ppm sulphur)" };
/** Library item for each ARESEP product name (matched after removing accents and case). */
const PRODUCT_ITEM: Record<string, string> = {
  "gasolina ron 95": "petrol95",
  "gasolina ron 91": "petrol91",
  "diesel para uso automotriz de 50 ppm de azufre": "diesel",
};
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export const MIN_CRC = 200;
export const MAX_CRC = 2500;

export interface Tariff { item: string; from: string; price: number; price_ex_vat: number | null }

/** Pure: the tariffs that apply on `today` (Costa Rica date): per product the newest fechaRige on or before today, with a plausible consumer price. */
export function parseTariffs(json: unknown, today: string): Tariff[] {
  const rows = (json as any)?.value;
  if (!Array.isArray(rows)) throw new SourceError("ARESEP changed the layout of its fuel tariff file (no 'value' list); this source needs updating.");
  const best = new Map<string, Tariff>();
  for (const r of rows) {
    const item = PRODUCT_ITEM[norm(String(r?.producto ?? ""))];
    if (!item) continue;
    const from = String(r?.fechaRige ?? "").slice(0, 10);
    const price = Number(r?.precioFinal);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || from > today) continue;
    if (!(price >= MIN_CRC && price <= MAX_CRC)) continue;
    const cur = best.get(item);
    if (cur && cur.from >= from) continue;
    const ex = Number(r?.precioFinalSinIVA);
    best.set(item, { item, from, price, price_ex_vat: ex >= MIN_CRC && ex <= MAX_CRC ? ex : null });
  }
  return [...best.values()];
}

/** Costa Rica's calendar day (UTC-6 all year). */
export const crToday = (now = new Date()) => new Date(now.getTime() - 6 * 3600 * 1000).toISOString().slice(0, 10);

export function harvestFromJson(json: unknown, now = new Date()): HarvestResult {
  const tariffs = parseTariffs(json, crToday(now));
  for (const need of FUEL_ORDER) {
    if (!tariffs.some((t) => t.item === need)) throw new SourceError(`The ARESEP tariff file holds no current price for ${need}; expected both petrol95 and diesel.`);
  }
  const date = tariffs.reduce((a, t) => (t.from > a ? t.from : a), "");
  const rows = tariffs.map((t) => ({ area: "CR", item: t.item, n: NO_COUNT, median: t.price, low: t.price, high: t.price, min: t.price, max: t.price }));
  return {
    date,
    currency: "CRC",
    unit: "per litre",
    rows,
    note: "ARESEP regulated maximum consumer prices (colones per litre, IVA included) in force on the collection day; the row date is the newest date a price applies from. Items: petrol95 = Gasolina RON 95, petrol91 = Gasolina RON 91, diesel = automotive diesel 50 ppm.",
  };
}

export async function crHarvest(now = new Date()): Promise<HarvestResult> {
  let res: Response;
  try {
    res = await fetch(URL_TARIFFS, { headers: { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)", accept: "application/json" }, signal: AbortSignal.timeout(180000) });
  } catch (e: any) {
    throw new SourceError("Could not reach the ARESEP fuel tariff file", String(e?.cause?.code ?? e?.message ?? e));
  }
  if (!res.ok) throw new SourceError(`ARESEP returned HTTP ${res.status}`, URL_TARIFFS, res.status);
  return harvestFromJson(JSON.parse((await res.text()).replace(/^﻿/, "")), now);
}

export function crHistoryKey(p: { fuel?: string }): { area: string; item: string; label: string } | null {
  return FUEL_ORDER.includes(p.fuel as CrFuel) ? { area: "CR", item: p.fuel as string, label: "Costa Rica (national maximum price)" } : null;
}

const fuelError = () => new InputError("Costa Rica: ARESEP's maximum prices are offered for petrol95 (Gasolina RON 95) and diesel. LPG, kerosene and the other fuels are not offered.");
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

export interface CrInput { fuel: string; area?: string; town?: string; postcode?: string; baseUrl?: string }

/** Pure: the answer from the newest library day (rows of that day). */
export function crAnswer(day: { date: string; rows: { area: string; item: string; median: number }[] }, input: CrInput, now = new Date()): PriceAnswer {
  const fuel = input.fuel as CrFuel;
  if (!FUEL_ORDER.includes(fuel)) throw fuelError();
  const mine = day.rows.find((r) => r.area === "CR" && r.item === fuel);
  const other = day.rows.find((r) => r.area === "CR" && r.item === "petrol91");
  const asked = [input.postcode && `postcode ${input.postcode}`, input.town, input.area].filter(Boolean) as string[];
  const query = { country: "CR", fuel, ...(input.area ? { area: input.area } : {}), ...(input.town ? { town: input.town } : {}), ...(input.postcode ? { postcode: input.postcode } : {}) };
  const age = Math.max(0, daysBetween(day.date, crToday(now)));
  const notes = ["A regulated maximum consumer price fixed by ARESEP for the whole country, not what a particular station charged."];
  if (asked.length) notes.push(`ARESEP publishes no price by ${asked.join(", ")}: the national maximum price is given.`);
  if (age > 120) notes.push(`Old data: the newest tariff in our copy applies from ${day.date}, ${age} days ago.`);
  return buildStatisticAnswer({
    source: INFO,
    query,
    value: mine ? mine.median : null,
    measure: "average",
    currency: "CRC",
    unit: "per litre",
    period: { from: day.date, to: null },
    reference_period: day.date,
    note: notes.join(" "),
    method:
      "Costa Rica (fuel): the regulator ARESEP fixes a maximum consumer price per litre (IVA included) for each fuel and publishes every tariff with the date it applies from. " +
      "We copy the file once a day and pass on the price in force; it is one national regulated maximum, with no range and no count of stations.",
    describe: (v) =>
      `The regulated maximum price of ${LABEL[fuel]} in Costa Rica is ${fmtMoney(v, "CRC")} per litre (IVA included), in force since ${day.date}. ` +
      "This is the price ARESEP fixes for the whole country, not a measured station price.",
    ending: "Posted regulated maximum from ARESEP, passed on unchanged.",
    extra: {
      country_name: "Costa Rica",
      applies_from: day.date,
      data_age_days: age,
      fuel: { requested: fuel, label: LABEL[fuel] },
      ...(other ? { other_grade: { fuel: "Gasolina RON 91 (regular)", value: other.median, currency: "CRC", unit: "per litre" } } : {}),
      what_this_is: "Maximum consumer price per litre fixed by the regulator ARESEP, national, IVA included. Not a station price and not a transaction.",
      ...(asked.length ? { place_note: `Not used: ${asked.join(", ")}. National price returned.` } : {}),
    },
  });
}

export async function crFuelNow(input: CrInput, now = new Date()): Promise<PriceAnswer> {
  if (!FUEL_ORDER.includes(input.fuel as CrFuel)) throw fuelError();
  const meta = readMeta(INFO.id);
  const day = readLatestDay(INFO.id);
  if (!meta?.last_date || !day) throw new SourceError("Not yet available: ProofPrice copies the ARESEP fuel tariff file daily; figures appear after the first collection.");
  return crAnswer(day, input, now);
}
