// Montenegro: the maximum retail prices of fuels, set by the government and published each week on the open-data portal data.gov.me (CKAN).
// Format checked live on 2026-10-30 (fixtures/package_search.json is a cut of the real reply):
//   GET https://data.gov.me/api/3/action/package_search?q=cijene+goriva&rows=20&sort=metadata_modified+desc   (no key)
//   -> {success, result:{count, results:[{name, metadata_modified, license_id:"other-open", notes_en, ...}]}}
//   Fuel notices are packages named nove-cijene-goriva-od-DD-MM-YYYY (the date the prices apply from). notes_en holds the notice text, e.g.
//   "EUROSUPER 95: €1.81/l (-€0.02)", "EURO DIESEL: €1.98/l", "FUEL OIL: €2.02/l" (the spelling changes: "EURODIESEL", "HEATING OIL", "–" instead of ":").
//   The search also returns other datasets (a consumer price index): only the fuel notices are read.
// One government-fixed maximum per fuel and week; no record count.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, SourceError } from "../../lib/http";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { readLatestDay, readMeta } from "../../lib/library/store";
import { NO_COUNT } from "../../lib/stats";

export const URL_SEARCH = "https://data.gov.me/api/3/action/package_search?q=cijene+goriva&rows=20&sort=metadata_modified+desc";
const PAGE = "https://data.gov.me/en/about";

export const INFO: SourceInfo = {
  id: "me-gov-fuel",
  country: "ME (Montenegro)",
  category: "fuel (government maximum retail prices)",
  name: "Montenegro maximum retail prices of petroleum products, euro per litre",
  publisher: "Ministry of Energy and Mining of Montenegro, published on the open-data portal data.gov.me (Ministry of Public Administration)",
  what_is_recorded:
    "The maximum retail price in euro per litre, taxes included, that the government of Montenegro fixes for Eurosuper 95, Eurosuper 98, Eurodiesel and heating oil, " +
    "with the date it applies from. One national price per fuel; it is a ceiling, valid for every station.",
  price_type: "posted_pump_price",
  freshness: "New prices are published about every week (usually Tuesday); every answer states the date the price applies from",
  licence: "Dataset licence on data.gov.me: 'Other (Open)' (Open Definition); the portal says open data may be reused for commercial and non-commercial purposes. No named licence, so free tier only",
  licence_url: "https://data.gov.me/en/about",
  attribution: "Source: Ministry of Energy and Mining of Montenegro, data.gov.me (open data). Passed on as published by ProofPrice, which adds no change to the figure.",
  homepage: PAGE,
  limits:
    "A government MAXIMUM price for the whole country, not what a given station charged and not a transaction; there is no range and no count of stations. " +
    "Only petrol95 (Eurosuper 95) and diesel (Eurodiesel) are offered; Eurosuper 98 and heating oil are given as extra information. " +
    "Area, town and postcode are not used: the price is national.",
};

export type MeFuel = "petrol95" | "diesel";
export const FUEL_ORDER: MeFuel[] = ["petrol95", "diesel"];
export const LABEL: Record<string, string> = { petrol95: "Eurosuper 95", petrol98: "Eurosuper 98", diesel: "Eurodiesel", heating_oil: "heating oil" };
export const MIN_EUR = 0.5;
export const MAX_EUR = 5;

const PATTERNS: Record<string, RegExp> = {
  petrol95: /EURO\s?SUPER\s*95\D{0,12}?(\d[.,]\d{1,3})/i,
  petrol98: /EURO\s?SUPER\s*98\D{0,12}?(\d[.,]\d{1,3})/i,
  diesel: /EURO\s?DIESEL\D{0,12}?(\d[.,]\d{1,3})/i,
  heating_oil: /(?:HEATING\s+OIL|FUEL\s+OIL)\D{0,12}?(\d[.,]\d{1,3})/i,
};

export interface Notice { from: string; prices: Record<string, number> }

/** Pure: "nove-cijene-goriva-od-27-10-2026" -> "2026-10-27" (null for other datasets). */
export function noticeDate(name: string): string | null {
  const m = /^nove-cijene-goriva-od-(\d{2})-(\d{2})-(\d{4})/.exec(name);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Pure: the newest fuel notice that applies on `today` (Montenegro date), with plausible prices for petrol95 and diesel at least. */
export function parseNotices(json: unknown, today: string): Notice | null {
  const results = (json as any)?.result?.results;
  if (!(json as any)?.success || !Array.isArray(results)) throw new SourceError("data.gov.me changed the layout of its search reply (no result list); this source needs updating.");
  let best: Notice | null = null;
  for (const r of results) {
    const from = noticeDate(String(r?.name ?? ""));
    if (!from || from > today) continue;
    if (best && best.from >= from) continue;
    const text = String(r?.notes_en ?? "");
    const prices: Record<string, number> = {};
    for (const [item, re] of Object.entries(PATTERNS)) {
      const m = re.exec(text);
      if (!m) continue;
      const v = Number(m[1].replace(",", "."));
      if (v >= MIN_EUR && v <= MAX_EUR) prices[item] = v;
    }
    if (prices.petrol95 === undefined || prices.diesel === undefined) continue;
    best = { from, prices };
  }
  return best;
}

/** Montenegro's calendar day (CET/CEST: UTC+1 or UTC+2). Two hours ahead of UTC is close enough: notices are dated by day and published in the morning. */
export const meToday = (now = new Date()) => new Date(now.getTime() + 2 * 3600 * 1000).toISOString().slice(0, 10);

export function harvestFromJson(json: unknown, now = new Date()): HarvestResult {
  const n = parseNotices(json, meToday(now));
  if (!n) throw new SourceError("No current fuel notice with Eurosuper 95 and Eurodiesel prices was found in the data.gov.me search reply.");
  const rows = Object.entries(n.prices).map(([item, v]) => ({ area: "ME", item, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v }));
  return {
    date: n.from,
    currency: "EUR",
    unit: "per litre",
    rows,
    note: "Government maximum retail prices (euro per litre, taxes included) in force on the collection day; the row date is the date the newest notice applies from. Items: petrol95 = Eurosuper 95, petrol98 = Eurosuper 98, diesel = Eurodiesel, heating_oil = heating oil.",
  };
}

export async function meHarvest(now = new Date()): Promise<HarvestResult> {
  return harvestFromJson(await fetchJson(URL_SEARCH, { headers: { accept: "application/json" } }, 60000), now);
}

export function meHistoryKey(p: { fuel?: string }): { area: string; item: string; label: string } | null {
  return FUEL_ORDER.includes(p.fuel as MeFuel) ? { area: "ME", item: p.fuel as string, label: "Montenegro (national maximum price)" } : null;
}

const fuelError = () => new InputError("Montenegro: the government's maximum prices are offered for petrol95 (Eurosuper 95) and diesel (Eurodiesel). LPG and the other fuels are not offered.");
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

export interface MeInput { fuel: string; area?: string; town?: string; postcode?: string; baseUrl?: string }

/** Pure: the answer from the newest library day (rows of that day). */
export function meAnswer(day: { date: string; rows: { area: string; item: string; median: number }[] }, input: MeInput, now = new Date()): PriceAnswer {
  const fuel = input.fuel as MeFuel;
  if (!FUEL_ORDER.includes(fuel)) throw fuelError();
  const mine = day.rows.find((r) => r.area === "ME" && r.item === fuel);
  const extras: Record<string, unknown> = {};
  for (const item of ["petrol98", "heating_oil"]) {
    const r = day.rows.find((x) => x.area === "ME" && x.item === item);
    if (r) extras[item] = { fuel: LABEL[item], value: r.median, currency: "EUR", unit: "per litre" };
  }
  const asked = [input.postcode && `postcode ${input.postcode}`, input.town, input.area].filter(Boolean) as string[];
  const query = { country: "ME", fuel, ...(input.area ? { area: input.area } : {}), ...(input.town ? { town: input.town } : {}), ...(input.postcode ? { postcode: input.postcode } : {}) };
  const age = Math.max(0, daysBetween(day.date, meToday(now)));
  const notes = ["A government maximum retail price for the whole country, not what a particular station charged."];
  if (asked.length) notes.push(`Montenegro publishes no price by ${asked.join(", ")}: the national maximum price is given.`);
  if (age > 30) notes.push(`Old data: the newest notice in our copy applies from ${day.date}, ${age} days ago.`);
  return buildStatisticAnswer({
    source: INFO,
    query,
    value: mine ? mine.median : null,
    measure: "average",
    currency: "EUR",
    unit: "per litre",
    period: { from: day.date, to: null },
    reference_period: day.date,
    note: notes.join(" "),
    method:
      "Montenegro (fuel): the government fixes maximum retail prices per litre (taxes included) for petrol, diesel and heating oil about every week and publishes each notice on data.gov.me with the date it applies from. " +
      "We copy the notice once a day and pass on the price in force; it is one national maximum, with no range and no count of stations.",
    describe: (v) =>
      `The government maximum retail price of ${LABEL[fuel]} in Montenegro is ${fmtMoney(v, "EUR")} per litre (taxes included), in force since ${day.date}. ` +
      "This is the ceiling fixed for the whole country, not a measured station price.",
    ending: "Posted government maximum from data.gov.me, passed on unchanged.",
    extra: {
      country_name: "Montenegro",
      applies_from: day.date,
      data_age_days: age,
      fuel: { requested: fuel, label: LABEL[fuel] },
      ...(Object.keys(extras).length ? { other_grades: extras } : {}),
      what_this_is: "Maximum retail price per litre fixed by the government of Montenegro, national, taxes included. Not a station price and not a transaction.",
      ...(asked.length ? { place_note: `Not used: ${asked.join(", ")}. National price returned.` } : {}),
    },
  });
}

export async function meFuelNow(input: MeInput, now = new Date()): Promise<PriceAnswer> {
  if (!FUEL_ORDER.includes(input.fuel as MeFuel)) throw fuelError();
  const meta = readMeta(INFO.id);
  const day = readLatestDay(INFO.id);
  if (!meta?.last_date || !day) throw new SourceError("Not yet available: ProofPrice copies the Montenegro fuel notices daily; figures appear after the first collection.");
  return meAnswer(day, input, now);
}
