// Kenya: monthly regulated MAXIMUM pump prices by town, published by the Energy and Petroleum Regulatory Authority (EPRA).
// Format checked live on 2026-11-03 (curl from the cloud workspace, 200, 7.1 MB HTML, no key, no cookie):
//   GET https://www.epra.go.ke/pump-prices -> ONE <table id="datatable"> with header From | To | Town | Super (PMS) | Diesel (AGO) | Kerosene (IK),
//   about 5,580 rows (230 towns, 25 monthly periods), dates dd-mm-yyyy, KES per litre with 2 decimals, newest period first.
//   fixtures/pump-prices.html is a cut of that real page (7 rows, headers kept).
// The page is big, so only the daily collector (harvest) reads it; answers come from the price library. One regulated figure per town and fuel, no record count.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { readLatestDay, readMeta } from "../../lib/library/store";
import { NO_COUNT } from "../../lib/stats";

export const URL_PAGE = "https://www.epra.go.ke/pump-prices";

export const INFO: SourceInfo = {
  id: "ke-epra-fuel",
  country: "KE (Kenya)",
  category: "fuel (regulated maximum pump prices)",
  name: "EPRA maximum pump prices by town, Kenya shillings per litre",
  publisher: "Energy and Petroleum Regulatory Authority (EPRA), Kenya",
  what_is_recorded:
    "The maximum retail price in Kenya shillings (KES) per litre that EPRA allows at the pump in each town for Super petrol (PMS), Diesel (AGO) and Kerosene (IK), " +
    "for one monthly period (15th to 14th). One figure per town and fuel.",
  price_type: "posted_pump_price",
  freshness: "A new price table every month, applying from the 15th; every answer states the period",
  licence: "No reuse licence is stated on the EPRA page (footer: all rights reserved). Free tier only until the licence is cleared",
  licence_url: URL_PAGE,
  attribution: "Source: Energy and Petroleum Regulatory Authority (EPRA), Kenya, Maximum pump prices (epra.go.ke/pump-prices). Passed on as published by ProofPrice, which adds no change to the figure.",
  homepage: URL_PAGE,
  limits:
    "A regulated MAXIMUM price per town, not what a given station charged and not a transaction; there is no range and no count of stations. " +
    "Only petrol95 (Super PMS) and diesel (AGO) are offered; kerosene is given as extra information. Towns are those EPRA lists (about 230).",
};

export type KeFuel = "petrol95" | "diesel";
export const FUEL_ORDER: KeFuel[] = ["petrol95", "diesel"];
export const LABEL: Record<string, string> = { petrol95: "Super petrol (PMS)", diesel: "Diesel (AGO)", kerosene: "Kerosene (IK)" };
export const DEFAULT_TOWN = "nairobi";
export const MIN_KES = 40;
export const MAX_KES = 800;

export interface Entry { from: string; to: string; town: string; key: string; petrol95: number | null; diesel: number | null; kerosene: number | null }

const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
/** Town key: lower case, accents and punctuation removed, single spaces. */
export const townKey = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isoOf = (d: string) => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};
const kes = (s: string) => {
  const v = Number(s.replace(/,/g, ""));
  return v >= MIN_KES && v <= MAX_KES ? v : null;
};

/** Pure: every table row of the EPRA page as an entry (all periods). Throws when the layout is not the one we checked. */
export function parseTable(html: string): Entry[] {
  const i = html.indexOf('id="datatable"');
  if (i < 0) throw new SourceError("EPRA changed the layout of its pump price page (no price table); this source needs updating.");
  const head = strip(html.slice(i, html.indexOf("</thead>", i) + 8)).toLowerCase();
  if (!(head.startsWith("from to town super (pms) diesel (ago) kerosene (ik)") || head.includes("from to town super (pms) diesel (ago) kerosene (ik)")))
    throw new SourceError("EPRA changed the columns of its pump price table; this source needs updating.");
  const body = html.slice(html.indexOf("<tbody", i));
  const out: Entry[] = [];
  for (const tr of body.match(/<tr[\s>][\s\S]*?<\/tr>/g) ?? []) {
    const c = (tr.match(/<td[\s\S]*?<\/td>/g) ?? []).map(strip);
    if (c.length < 6) continue;
    const from = isoOf(c[0]);
    const to = isoOf(c[1]);
    if (!from || !to || !c[2]) continue;
    out.push({ from, to, town: c[2], key: townKey(c[2]), petrol95: kes(c[3]), diesel: kes(c[4]), kerosene: kes(c[5]) });
  }
  if (!out.length) throw new SourceError("EPRA pump price table held no readable rows; this source needs updating.");
  return out;
}

/** Pure: the entries of the newest period that has already started on `today` (Nairobi date), at least 5 towns. */
export function currentPeriod(entries: Entry[], today: string): Entry[] {
  const from = entries.filter((e) => e.from <= today).reduce((a, e) => (e.from > a ? e.from : a), "");
  const rows = entries.filter((e) => e.from === from);
  if (!from || rows.length < 5) throw new SourceError("EPRA's newest price period holds fewer than 5 towns; refusing to publish it.");
  return rows;
}

/** Kenya's calendar day (UTC+3 all year). */
export const keToday = (now = new Date()) => new Date(now.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);

export function harvestFromHtml(html: string, now = new Date()): HarvestResult {
  const rows = currentPeriod(parseTable(html), keToday(now));
  const out: HarvestResult["rows"] = [];
  const seen = new Set<string>();
  for (const e of rows) {
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    for (const [item, v] of [["petrol95", e.petrol95], ["diesel", e.diesel], ["kerosene", e.kerosene]] as const) {
      if (v != null) out.push({ area: e.key, item, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });
    }
  }
  return {
    date: rows[0].from,
    currency: "KES",
    unit: "per litre",
    rows: out,
    note: `EPRA maximum pump prices (KES per litre) by town for the period ${rows[0].from} to ${rows[0].to}; the row date is the day the period starts. Items: petrol95 = Super (PMS), diesel = Diesel (AGO), kerosene = Kerosene (IK). Area = town name, lower case.`,
  };
}

export async function keHarvest(now = new Date()): Promise<HarvestResult> {
  let res: Response;
  try {
    res = await fetch(URL_PAGE, { headers: { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)", accept: "text/html" }, signal: AbortSignal.timeout(120000) });
  } catch (e: any) {
    throw new SourceError("Could not reach the EPRA pump price page", String(e?.cause?.code ?? e?.message ?? e));
  }
  if (!res.ok) throw new SourceError(`EPRA returned HTTP ${res.status}`, URL_PAGE, res.status);
  return harvestFromHtml(await res.text(), now);
}

const placeOf = (input: { town?: string; area?: string }) => townKey(input.town || input.area || "") || DEFAULT_TOWN;

export function keHistoryKey(p: { fuel?: string; town?: string; area?: string }): { area: string; item: string; label: string } | null {
  if (!FUEL_ORDER.includes(p.fuel as KeFuel)) return null;
  const area = placeOf(p);
  return { area, item: p.fuel as string, label: `Kenya, ${area} (EPRA maximum price)` };
}

const fuelError = () => new InputError("Kenya: EPRA's maximum prices are offered for petrol95 (Super PMS) and diesel (AGO). Other fuels are not offered.");
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const titleCase = (k: string) => k.replace(/\b[a-z]/g, (m) => m.toUpperCase());

export interface KeInput { fuel: string; town?: string; area?: string; postcode?: string; baseUrl?: string }

/** Pure: the answer from the newest library day (rows of that day). */
export function keAnswer(day: { date: string; rows: { area: string; item: string; median: number }[] }, input: KeInput, now = new Date()): PriceAnswer {
  const fuel = input.fuel as KeFuel;
  if (!FUEL_ORDER.includes(fuel)) throw fuelError();
  const asked = townKey(input.town || input.area || "");
  const town = asked || DEFAULT_TOWN;
  const mine = day.rows.find((r) => r.area === town && r.item === fuel);
  if (!mine) {
    const known = [...new Set(day.rows.map((r) => r.area))].sort();
    const eg = ["nairobi", "kisumu", "nakuru", "eldoret", "voi"].filter((t) => known.includes(t));
    throw new InputError(`Kenya: no EPRA price for the town '${input.town || input.area}'. Give a town EPRA lists (for example ${eg.join(", ") || known.slice(0, 5).join(", ")}); ${known.length} towns are available.`);
  }
  const kero = day.rows.find((r) => r.area === town && r.item === "kerosene");
  const name = titleCase(town);
  const age = Math.max(0, daysBetween(day.date, keToday(now)));
  const notes = ["A regulated maximum price fixed by EPRA for the town, not what a particular station charged."];
  if (!asked) notes.push("No town given: the price for Nairobi is returned.");
  if (input.postcode) notes.push("Postcodes are not used in Kenya.");
  if (age > 75) notes.push(`Old data: the newest period in our copy starts ${day.date}, ${age} days ago.`);
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "KE", fuel, town: name },
    value: mine.median,
    measure: "average",
    currency: "KES",
    unit: "per litre",
    period: { from: day.date, to: null },
    reference_period: day.date,
    note: notes.join(" "),
    method:
      "Kenya (fuel): the regulator EPRA publishes a table of maximum retail pump prices per town, one period per month (15th to 14th). " +
      "We copy the table once a day and pass on the figure for the period in force; it is one regulated maximum per town, with no range and no count of stations.",
    describe: (v) =>
      `The regulated maximum price of ${LABEL[fuel]} in ${name}, Kenya is ${fmtMoney(v, "KES")} per litre, for the monthly period starting ${day.date}. ` +
      "This is the ceiling EPRA sets for the town, not a measured station price.",
    ending: "Posted regulated maximum from EPRA, passed on unchanged.",
    extra: {
      country_name: "Kenya",
      town: name,
      period_from: day.date,
      data_age_days: age,
      fuel: { requested: fuel, label: LABEL[fuel] },
      ...(kero ? { other_product: { fuel: LABEL.kerosene, value: kero.median, currency: "KES", unit: "per litre" } } : {}),
      what_this_is: "Maximum retail price per litre fixed by the regulator EPRA for the town. Not a station price and not a transaction.",
    },
  });
}

export async function keFuelNow(input: KeInput, now = new Date()): Promise<PriceAnswer> {
  if (!FUEL_ORDER.includes(input.fuel as KeFuel)) throw fuelError();
  const meta = readMeta(INFO.id);
  const day = readLatestDay(INFO.id);
  if (!meta?.last_date || !day) throw new SourceError("Not yet available: ProofPrice copies the EPRA pump price table daily; figures appear after the first collection.");
  return keAnswer(day, input, now);
}
