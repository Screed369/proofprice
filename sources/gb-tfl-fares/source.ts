// London TfL posted fares: the Transport for London Unified API "FareTo" endpoint (Single Fare Finder), key-free JSON.
// Format checked live on 2026-11-09 from the cloud workspace: GET https://api.tfl.gov.uk/StopPoint/940GZZLUKSX/FareTo/940GZZLUVIC
// -> 200 JSON array of one FaresSection { journey{fromStation,toStation}, rows[{startDate,endDate,passengerType,ticketsAvailable[
// {ticketType.type "CashSingle"|"Pay as you go", ticketTime.type "Anytime"|"Peak"|"Off Peak", cost "3.10" (string, GBP), mode}]}] }.
// An unknown pair answers 200 with []. Station search returns hub ids the fare endpoint rejects, so stations are a curated list of
// Underground stations with their NaPTAN codes (each code checked live against FareTo on 2026-11-09). Posted tariff, not paid.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError, fetchJson } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

const API = "https://api.tfl.gov.uk/StopPoint";
const UA = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const INFO: SourceInfo = {
  id: "gb-tfl-fares",
  country: "GB",
  category: "transport fares (London Underground)",
  name: "London Underground fares between stations (Transport for London, Unified API)",
  publisher: "Transport for London (TfL), Unified API",
  what_is_recorded:
    "The posted adult fare for one London Underground journey between two stations (20 central and main stations in this version): pay-as-you-go (Oyster or contactless) peak and off-peak fares, and the cash single fare, in pounds. A published fare table, not amounts paid.",
  price_type: "posted_price",
  freshness: "Updated by TfL when fares change (the annual change takes effect in March; the table read on 9 Nov 2026 runs 1 Nov 2026 to 1 Nov 2027)",
  licence: "TfL open data under the Transport Data Service terms (UNVERIFIED: the terms page is behind a Cloudflare challenge and was not read); free tier only",
  licence_url: "https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service",
  attribution:
    "Powered by TfL Open Data. Contains information from the Transport for London Unified API (api.tfl.gov.uk). " +
    "ProofPrice looks up the station pair; this is not an official service of Transport for London.",
  homepage: "https://api.tfl.gov.uk/",
  limits:
    "Posted adult Underground fares for 20 listed stations, not amounts paid, not a ticket and not a quote. Daily and weekly caps, Travelcards, railcards, child and concession fares, buses, trams, DLR, Elizabeth line and National Rail are not included. No sample size.",
};

/** Curated Underground stations: name -> NaPTAN code. Every code answered a FareTo call on 2026-11-09. */
export const STATIONS: Record<string, { code: string; name: string; aka?: string[] }> = {
  kingscross: { code: "940GZZLUKSX", name: "King's Cross St. Pancras", aka: ["kings cross", "king s cross st pancras", "st pancras"] },
  victoria: { code: "940GZZLUVIC", name: "Victoria" },
  oxfordcircus: { code: "940GZZLUOXC", name: "Oxford Circus" },
  liverpoolstreet: { code: "940GZZLULVT", name: "Liverpool Street" },
  waterloo: { code: "940GZZLUWLO", name: "Waterloo" },
  bank: { code: "940GZZLUBNK", name: "Bank" },
  paddington: { code: "940GZZLUPAC", name: "Paddington" },
  greenpark: { code: "940GZZLUGPK", name: "Green Park" },
  piccadillycircus: { code: "940GZZLUPCC", name: "Piccadilly Circus" },
  leicestersquare: { code: "940GZZLULSQ", name: "Leicester Square" },
  euston: { code: "940GZZLUEUS", name: "Euston" },
  londonbridge: { code: "940GZZLULNB", name: "London Bridge" },
  bondstreet: { code: "940GZZLUBND", name: "Bond Street" },
  westminster: { code: "940GZZLUWSM", name: "Westminster" },
  charingcross: { code: "940GZZLUCHX", name: "Charing Cross" },
  tottenhamcourtroad: { code: "940GZZLUTCR", name: "Tottenham Court Road" },
  holborn: { code: "940GZZLUHBN", name: "Holborn" },
  vauxhall: { code: "940GZZLUVXL", name: "Vauxhall" },
  hammersmith: { code: "940GZZLUHSD", name: "Hammersmith (District and Piccadilly)", aka: ["hammersmith district"] },
  heathrowt5: { code: "940GZZLUHR5", name: "Heathrow Terminal 5", aka: ["heathrow", "heathrow airport", "lhr", "heathrow t5"] },
};

const key = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");

/** Pure: resolve a station name (case, apostrophes, "station", "underground" ignored) to the curated entry. */
export function findStation(text: string, what: string): { code: string; name: string } {
  const t = key(text.replace(/\b(underground|tube|station|stn)\b/gi, ""));
  if (!t) throw new InputError(`Give a ${what}, for example "King's Cross" or "Victoria".`);
  for (const [k, s] of Object.entries(STATIONS)) {
    if (k === t || key(s.name) === t || (s.aka ?? []).some((a) => key(a) === t)) return s;
  }
  const near = Object.values(STATIONS).filter((s) => key(s.name).includes(t) || t.includes(key(s.name).slice(0, 6))).map((s) => s.name);
  const hint = near.length ? ` Did you mean: ${near.join(", ")}?` : ` Available stations: ${Object.values(STATIONS).map((s) => s.name).join(", ")}.`;
  throw new InputError(`Not yet known: ${what} "${text}" is not one of the London Underground stations in this version.${hint}`);
}

export interface Fares {
  from: string;
  to: string;
  start: string | null;
  end: string | null;
  payg: { peak?: number; offpeak?: number; anytime?: number };
  cash?: number;
}

/** Pure: TfL FareTo JSON into the adult fares. [] (pair not known) or no adult row is an error. */
export function parseFares(json: any): Fares {
  const section = Array.isArray(json) ? json[0] : null;
  if (!section) throw new InputError("TfL publishes no fare for this pair of stations.");
  const rows: any[] = Array.isArray(section.rows) ? section.rows : [];
  const row = rows.find((r) => r?.passengerType === "Adult" && !r.specialFare) ?? rows.find((r) => r?.passengerType === "Adult");
  if (!row || !Array.isArray(row.ticketsAvailable)) throw new SourceError("The TfL fare response has no adult fares; this source needs updating.");
  const out: Fares = {
    from: String(section.journey?.fromStation?.commonName ?? row.from ?? ""),
    to: String(section.journey?.toStation?.commonName ?? row.to ?? ""),
    start: typeof row.startDate === "string" ? row.startDate.slice(0, 10) : null,
    end: typeof row.endDate === "string" ? row.endDate.slice(0, 10) : null,
    payg: {},
  };
  for (const t of row.ticketsAvailable) {
    const cost = Number(t?.cost);
    if (!Number.isFinite(cost)) continue;
    const type = t?.ticketType?.type;
    const time = t?.ticketTime?.type;
    if (type === "CashSingle") out.cash = cost;
    else if (type === "Pay as you go") {
      if (time === "Peak") out.payg.peak = cost;
      else if (time === "Off Peak") out.payg.offpeak = cost;
      else if (time === "Anytime") out.payg.anytime = cost;
    }
  }
  if (out.cash === undefined && Object.keys(out.payg).length === 0) throw new SourceError("The TfL fare response has no usable fares; this source needs updating.");
  return out;
}

export interface FareInput {
  from_station?: string;
  to_station?: string;
  fare_type?: string;
  ticket?: string;
  time_of_day?: string;
  baseUrl?: string;
}

/** Pure: pick the fare for the request out of the parsed table. */
export function answerFromFares(f: Fares, input: FareInput): PriceAnswer {
  const ticket = (input.ticket ?? "payg").toString().toLowerCase();
  if (ticket !== "payg" && ticket !== "cash") throw new InputError('ticket for London must be "payg" (Oyster or contactless, default) or "cash" (single paper ticket).');
  const tod = (input.time_of_day ?? "peak").toString().toLowerCase().replace(/[\s_]+/g, "-");
  if (!["peak", "off-peak", "offpeak"].includes(tod)) throw new InputError('time_of_day for London must be "peak" (default) or "off-peak".');
  const off = tod !== "peak";
  let value: number | undefined;
  let band: string;
  if (ticket === "cash") { value = f.cash; band = "cash single, any time"; }
  else if (f.payg.anytime !== undefined) { value = f.payg.anytime; band = "pay as you go, any time"; }
  else { value = off ? f.payg.offpeak : f.payg.peak; band = off ? "pay as you go, off-peak" : "pay as you go, peak (Mon-Fri 06:30-09:30 and 16:00-19:00)"; }
  const label = ticket === "cash" ? "cash single" : "pay-as-you-go (Oyster or contactless)";
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "GB", from_station: f.from, to_station: f.to, fare_type: "adult", ticket, time_of_day: ticket === "cash" ? "any" : off ? "off-peak" : "peak" },
    value: value ?? null,
    measure: "average",
    currency: "GBP",
    unit: `per journey (${band})`,
    period: { from: f.start, to: f.end },
    reference_period: f.start ? `fares valid ${f.start} to ${f.end ?? "further notice"}` : "current TfL fare table",
    method:
      "London Underground: Transport for London's posted adult fare for one journey between the two stations, from the TfL Unified API fare finder, in pounds. " +
      "A published fare table, the same for every adult, not a count of fares paid; daily caps, Travelcards and concessions are not included.",
    describe: (v) => `The posted adult ${label} fare on the London Underground from ${f.from} to ${f.to} is GBP ${v.toFixed(2)} per journey (${band}).`,
    note: "Posted fare table, not an amount paid. The fare is the standard adult fare; daily caps, Travelcards and concessions are not included.",
    baseUrl: input.baseUrl,
    published: f.start,
    extra: { from_station: f.from, to_station: f.to, fare_group: "adult", ticket, fare_band: band, mode: "London Underground" },
  });
}

export async function tflFares(input: FareInput, load?: (url: string) => Promise<any>): Promise<PriceAnswer> {
  if (!input.from_station || !input.to_station) {
    throw new InputError("Give tfl_from and tfl_to for London, for example tfl_from=King's Cross&tfl_to=Victoria.");
  }
  const ft = (input.fare_type ?? "adult").toString().toLowerCase();
  if (ft !== "adult" && ft !== "adults" && ft !== "standard") throw new InputError("fare_type for London must be adult (child, student and concession fares are not included).");
  const a = findStation(input.from_station, "from_station");
  const b = findStation(input.to_station, "to_station");
  if (a.code === b.code) throw new InputError("from_station and to_station are the same station; give two different stations.");
  const url = `${API}/${a.code}/FareTo/${b.code}`;
  const json = await (load ?? ((u: string) => fetchJson(u, { headers: { "user-agent": UA, accept: "application/json" } }, 15000)))(url);
  return answerFromFares(parseFares(json), input);
}
