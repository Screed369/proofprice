// Singapore fuel: pump prices of petrol (92, 95, 98 octane), diesel and LPG from SingStat's "Average Retail Prices of Selected Consumer Items"
// (Table Builder table M213761), the same monthly table as sg-singstat-prices (which leaves the fuel rows out). Format checked live on 2026-10-24
// through the GitHub probe (GET, no key), see fixtures/m213761-2026-sep.json (rows copied verbatim from the live response):
//   https://tablebuilder.singstat.gov.sg/api/table/tabledata/M213761?limit=2000&offset=0&timeFilter=2026%20Sep
//   -> { Data: { dataLastUpdated: "23/10/2026", row: [ { rowText: "Petrol, 95 Octane (Per Litre)", uoM: "Dollar", columns: [ { key: "2026 Sep", value: "2.92" } ] }, ... ] } }
// One national average per fuel and month, no range and no record count: an official statistic. The row texts below are SingStat's exactly.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";
import { changeOver, keyOf, monthUrl, monthWords, monthsBehind, parseMonth, readLatest, shiftMonth, type SgMonth, type SgOptions, type SgReading } from "../sg-singstat-prices/source";

export const INFO: SourceInfo = {
  id: "sg-singstat-fuel",
  country: "SG (Singapore)",
  category: "fuel (monthly national average pump price)",
  name: "Average Retail Prices of Selected Consumer Items, Monthly: petrol, diesel and LPG (SingStat table M213761)",
  publisher: "Department of Statistics Singapore (SingStat)",
  what_is_recorded:
    "Each month, the national average retail price in Singapore dollars of petrol (92, 95 and 98 octane) and diesel per litre and LPG per kilogram, from the prices SingStat records for the Consumer Price Index. " +
    "SingStat states the petrol and diesel averages include the on-site and loyalty discounts widely available to consumers. One published average per fuel and month; never an individual station.",
  price_type: "official_statistic",
  freshness: "Monthly, about three weeks after the month ends, with the month named in every answer",
  licence:
    "Singapore Open Data Licence v1.0. SingStat's Terms of Use say that use of Datasets made available through its website (including the Table Builder) is subject to the Singapore Open Data Licence, " +
    "which allows worldwide, perpetual, royalty-free use, commercially or non-commercially, with acknowledgement of the source and a link to the licence.",
  licence_url: "https://data.gov.sg/open-data-licence",
  attribution:
    "Contains information from Average Retail Prices of Selected Consumer Items (SingStat table M213761) accessed on the date in this answer's retrieved_at field from the Department of Statistics Singapore (SingStat), " +
    "which is made available under the terms of the Singapore Open Data Licence version 1.0 https://data.gov.sg/open-data-licence . " +
    "Figures are passed on as published; the changes on a month and a year earlier are calculated by ProofPrice. This is not an official SingStat product and SingStat does not endorse it.",
  homepage: "https://tablebuilder.singstat.gov.sg/table/TS/M213761",
  limits:
    "A national monthly average, not a pump price at a station: no town, station or range, and SingStat does not say how many price quotes stand behind an average. " +
    "It is a price recorded for the Consumer Price Index, not a receipt, and it includes the discounts SingStat says are widely available, so it can sit below the board price. " +
    "There is no E10, E85 or CNG in Singapore's table. The newest month can lag by about three weeks.",
};

/** SingStat's exact row text for each fuel the tool can be asked for. */
export const FUEL_ROWS: Record<string, { code: string; label: string; unit: string }> = {
  diesel: { code: "Diesel (Per Litre)", label: "diesel", unit: "per litre" },
  petrol95: { code: "Petrol, 95 Octane (Per Litre)", label: "95-octane petrol", unit: "per litre" },
  petrol98: { code: "Petrol, 98 Octane (Per Litre)", label: "98-octane petrol", unit: "per litre" },
  lpg: { code: "Liquefied Petroleum Gas (LPG) (Per Kilogram)", label: "LPG", unit: "per kg" },
};
const PETROL92 = { code: "Petrol, 92 Octane (Per Litre)", label: "92-octane petrol", unit: "per litre" };

const SG_WORDS = new Set(["sg", "singapore", "sgp", "national", "nationwide", "all", "whole country", "republic of singapore"]);
const sgd = (v: number) => `S$${v.toFixed(2)}`;

export const METHOD =
  "Singapore fuel: the Department of Statistics Singapore (SingStat) publishes each month the national average retail price of 92, 95 and 98 octane petrol, diesel (per litre) and LPG (per kilogram) in table M213761, " +
  "from the prices it records for the Consumer Price Index; SingStat says the petrol and diesel averages include the on-site and loyalty discounts that are widely available. " +
  "ProofPrice returns the published average for the newest month, unchanged, with the month before and the same month a year earlier. No range or sample size: SingStat gives one average. An official statistic for the whole country, not a station price.";

export interface SgFuelQuery {
  fuel?: string;
  town?: string;
  area?: string;
  postcode?: string;
  baseUrl?: string;
  today?: Date;
}

function placeOf(q: SgFuelQuery): string | undefined {
  return q.town || q.area || q.postcode || undefined;
}

export function sgFuelAnswer(reading: SgReading, q: SgFuelQuery): PriceAnswer {
  const fuel = q.fuel ?? "";
  const def = FUEL_ROWS[fuel];
  if (!def) throw new InputError("Singapore: fuel must be diesel, petrol95, petrol98 or lpg (SingStat has no E10, E85 or CNG series; 92-octane petrol is in extra.other_fuels).");
  const place = placeOf(q);
  const query = { country: "SG", fuel, ...(place ? { place } : {}) };
  const row = reading.latest.rows.get(keyOf(def.code));
  const base = { source: INFO, query, measure: "average" as const, currency: "SGD", method: METHOD, baseUrl: q.baseUrl };
  if (!row) {
    return buildStatisticAnswer({ ...base, value: null, unit: def.unit, period: { from: null, to: null }, reference_period: "n/a", describe: () => "" });
  }
  const month = reading.latest.month;
  const behind = monthsBehind(month, q.today ?? new Date());
  const prev = reading.previous?.rows.get(keyOf(def.code));
  const yearAgo = reading.yearAgo?.rows.get(keyOf(def.code));
  const mom = changeOver(prev?.value, reading.previous?.month ?? shiftMonth(month, -1), row.value);
  const yoy = changeOver(yearAgo?.value, reading.yearAgo?.month ?? shiftMonth(month, -12), row.value);
  const placeNote = place && !SG_WORDS.has(place.trim().toLowerCase()) ? `SingStat publishes one national price per fuel, so '${place}' is answered with the Singapore average.` : undefined;
  const notes = [
    placeNote,
    "SingStat says petrol and diesel averages include the on-site and loyalty discounts widely available to consumers, so they can sit below the price on the board.",
    fuel === "lpg" ? "LPG is priced per kilogram." : undefined,
    behind >= 4 ? `Old data: the newest month SingStat holds is ${monthWords(month)}, ${behind} months ago.` : undefined,
  ].filter(Boolean) as string[];
  const [yy, mm] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  const last = String(new Date(Date.UTC(yy, mm, 0)).getUTCDate()).padStart(2, "0");
  const others: Record<string, unknown> = {};
  for (const [k, d] of [...Object.entries(FUEL_ROWS), ["petrol92", PETROL92] as const]) {
    const r = reading.latest.rows.get(keyOf(d.code));
    if (r && k !== fuel) others[k] = { price_sgd: r.value, unit: d.unit, definition: d.label };
  }
  const move = (c: ReturnType<typeof changeOver>, what: string) =>
    c ? `${c.change_percent === 0 ? "unchanged" : `${c.change_percent > 0 ? "up" : "down"} ${Math.abs(c.change_percent)}%`} on ${what} (${sgd(c.from_value)} in ${monthWords(c.from_month)})` : `no figure for ${what}`;
  return buildStatisticAnswer({
    ...base,
    value: row.value,
    unit: def.unit,
    period: { from: `${month}-01`, to: `${month}-${last}` },
    reference_period: month,
    note: notes.join(" "),
    published: reading.latest.dataLastUpdated,
    describe: (v) =>
      `The national average retail price of ${def.label} in Singapore was ${sgd(v)} ${def.unit} in ${monthWords(month)} (Department of Statistics Singapore, Consumer Price Index price survey), ` +
      `${move(mom, "the month before")} and ${move(yoy, "a year earlier")}.`,
    extra: {
      country_name: "Singapore",
      reference_month: month,
      reference_month_label: monthWords(month),
      change_on_previous_month: mom,
      change_on_year_earlier: yoy,
      other_fuels: others,
      singstat_label: row.rowText,
      dataset: { code: "M213761", title: reading.latest.title, data_last_updated: reading.latest.dataLastUpdated, url: INFO.homepage },
      ...(placeNote ? { place_note: placeNote } : {}),
    },
  });
}

export async function sgFuel(input: SgFuelQuery, o: SgOptions = {}): Promise<PriceAnswer> {
  if (!FUEL_ROWS[input.fuel ?? ""]) throw new InputError("Singapore: fuel must be diesel, petrol95, petrol98 or lpg (SingStat has no E10, E85 or CNG series).");
  return sgFuelAnswer(await readLatest(input.today ?? new Date(), o), input);
}

// ---------- daily collector (stale-if-error copy and history) ----------
// Once a day the collector stores SingStat's newest month: one row per fuel the tool can be asked for, n NO_COUNT because SingStat gives one
// national average and no record count. Rows are dated by the last day of the reference month (referenceDates), so the copy keeps standing in
// for the month when SingStat's Table Builder is down.

export function harvestRows(reading: { latest: SgMonth }): HarvestResult {
  const rows = [];
  for (const [item, d] of Object.entries(FUEL_ROWS)) {
    const r = reading.latest.rows.get(keyOf(d.code));
    if (!r) continue;
    rows.push({ area: "SG", item, n: NO_COUNT, median: r.value, low: r.value, high: r.value, min: r.value, max: r.value });
  }
  if (!rows.length) throw new SourceError("SingStat table M213761 holds no petrol, diesel or LPG price for the newest month");
  const month = reading.latest.month;
  const last = String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0");
  return {
    date: `${month}-${last}`,
    currency: "SGD",
    unit: "per litre (LPG per kg)",
    rows,
    note: "SingStat table M213761: national average retail price of 95 and 98 octane petrol, diesel (SGD per litre) and LPG (SGD per kg) for the newest month. Published averages, not counts of records.",
  };
}

export async function sgFuelHarvest(o: SgOptions = {}): Promise<HarvestResult> {
  return harvestRows(await readLatest(new Date(), o));
}

export function sgFuelHistoryKey(p: { fuel?: string }): { area: string; item: string; label: string } | null {
  return p.fuel && FUEL_ROWS[p.fuel] ? { area: "SG", item: p.fuel, label: "Singapore (national average)" } : null;
}

export { monthUrl, parseMonth };
