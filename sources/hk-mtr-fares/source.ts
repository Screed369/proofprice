// Hong Kong MTR fares: the MTR Corporation's posted fare per station pair (Octopus and single-journey ticket fares, HKD).
// Format checked live on 2026-11-05 from the cloud workspace: plain GET, no key, https://opendata.mtr.com.hk/data/mtr_lines_fares.csv
// (743,938 bytes, 9,216 station pairs, UTF-8, quoted CSV, Last-Modified 2 Apr 2026). Columns SRC_STATION_NAME, SRC_STATION_ID,
// DEST_STATION_NAME, DEST_STATION_ID, OCT_ADT_FARE, OCT_STD_FARE, OCT_JOYYOU_SIXTY_FARE, SINGLE_ADT_FARE, OCT_CON_CHILD_FARE,
// OCT_CON_ELDERLY_FARE, OCT_CON_PWD_FARE, SINGLE_CON_CHILD_FARE, SINGLE_CON_ELDERLY_FARE. Posted tariff, not paid.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const URL_FARES = "https://opendata.mtr.com.hk/data/mtr_lines_fares.csv";
const UA = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const INFO: SourceInfo = {
  id: "hk-mtr-fares",
  country: "HK",
  category: "transport fares (MTR)",
  name: "MTR fares between stations (MTR Corporation open data)",
  publisher: "MTR Corporation Limited, published on DATA.GOV.HK",
  what_is_recorded:
    "The posted fare for one MTR journey between two stations (9,216 station pairs) for an adult, an elderly person or a person with a disability paying with Octopus, and the single-journey ticket fare for adults and elderly people. A published fare table, not amounts paid.",
  price_type: "posted_price",
  freshness: "Updated by the MTR Corporation when fares change; the file read on 5 Nov 2026 was last modified 2 Apr 2026",
  licence: "DATA.GOV.HK Terms and Conditions of Use (browse, download, distribute and reproduce the data for commercial and non-commercial purposes, free of charge, with clear source attribution)",
  licence_url: "https://data.gov.hk/en/terms-and-conditions",
  attribution:
    "Contains information from the MTR fares open data (MTR Corporation Limited) accessed from DATA.GOV.HK under its Terms and Conditions of Use (https://data.gov.hk/en/terms-and-conditions). " +
    "ProofPrice looks up the station pair; this is not an official service of the MTR Corporation or the Hong Kong Government.",
  homepage: "https://opendata.mtr.com.hk/data/mtr_lines_fares.csv",
  limits:
    "Posted MTR fares per station pair, not amounts paid, not a ticket and not a quote. Airport Express, Light Rail, MTR Bus, student and child concessions, passes and discounts are not included. No sample size.",
};

export type FareGroup = "adult" | "senior" | "disability";
export type Ticket = "octopus" | "single";

export interface Pair {
  from: string;
  fromId: number;
  to: string;
  toId: number;
  octopus: { adult: number; senior: number; disability: number };
  single: { adult: number; senior: number };
}

/** Pure: split one quoted CSV line (no embedded newlines in this file). */
export function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Pure: the CSV text into station pairs. Rows that do not parse are skipped; far too few pairs is an error. */
export function parseFares(text: string): Pair[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const head = splitLine(lines[0] ?? "");
  const col = (n: string) => head.indexOf(n);
  const need = ["SRC_STATION_NAME", "SRC_STATION_ID", "DEST_STATION_NAME", "DEST_STATION_ID", "OCT_ADT_FARE", "OCT_CON_ELDERLY_FARE", "OCT_CON_PWD_FARE", "SINGLE_ADT_FARE", "SINGLE_CON_ELDERLY_FARE"];
  if (need.some((n) => col(n) < 0)) throw new SourceError("The MTR fare file has different columns than expected; this source needs updating.");
  const c = Object.fromEntries(need.map((n) => [n, col(n)]));
  const out: Pair[] = [];
  for (const line of lines.slice(1)) {
    const f = splitLine(line);
    const num = (n: string) => Number(f[c[n]]);
    const p: Pair = {
      from: f[c.SRC_STATION_NAME]?.trim() ?? "",
      fromId: num("SRC_STATION_ID"),
      to: f[c.DEST_STATION_NAME]?.trim() ?? "",
      toId: num("DEST_STATION_ID"),
      octopus: { adult: num("OCT_ADT_FARE"), senior: num("OCT_CON_ELDERLY_FARE"), disability: num("OCT_CON_PWD_FARE") },
      single: { adult: num("SINGLE_ADT_FARE"), senior: num("SINGLE_CON_ELDERLY_FARE") },
    };
    if (!p.from || !p.to || ![p.octopus.adult, p.octopus.senior, p.octopus.disability, p.single.adult, p.single.senior].every(Number.isFinite)) continue;
    out.push(p);
  }
  if (out.length < 1000) throw new SourceError("The MTR fare file has far fewer station pairs than expected; this source needs updating.");
  return out;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

/** Pure: find one station by English name (any case, punctuation ignored) or by numeric station id. */
export function findStation(pairs: Pair[], text: string, what: string): { name: string; id: number } {
  const t = norm(text);
  if (!t) throw new InputError(`Give a ${what}, for example "Central" or "Tsim Sha Tsui".`);
  const stations = new Map<number, string>();
  for (const p of pairs) { stations.set(p.fromId, p.from); stations.set(p.toId, p.to); }
  for (const [id, name] of stations) if (String(id) === t || norm(name) === t) return { name, id };
  const near = [...stations.values()].filter((n) => norm(n).includes(t) || t.includes(norm(n))).sort().slice(0, 8);
  const hint = near.length ? ` Did you mean: ${near.join(", ")}?` : ` ${stations.size} stations are available, for example Central, Admiralty, Tsim Sha Tsui, Mong Kok, Tung Chung.`;
  throw new InputError(`Not yet known: ${what} "${text}" is not an MTR station name.${hint}`);
}

export interface FareInput {
  from_station?: string;
  to_station?: string;
  fare_type?: string;
  ticket?: string;
  baseUrl?: string;
  modified?: string | null;
}

const GROUP_LABEL: Record<FareGroup, string> = { adult: "adult", senior: "elderly (60+ concession)", disability: "person with a disability (concession)" };
const METHOD =
  "Hong Kong MTR: the MTR Corporation's posted fare for one journey between the two stations, from its open-data fare table, for the chosen fare group and ticket type, in Hong Kong dollars. " +
  "A published fare table, the same for everyone in the group, not a count of fares paid; Airport Express, Light Rail and MTR Bus are not included.";

/** Pure: pick the fare for the request out of the parsed table. */
export function answerFromFares(pairs: Pair[], input: FareInput): PriceAnswer {
  if (!input.from_station || !input.to_station) {
    throw new InputError('Give from_station and to_station for Hong Kong (MTR), for example from_station=Central&to_station=Tsim Sha Tsui.');
  }
  const group = (input.fare_type ?? "adult").toString().toLowerCase() as FareGroup;
  if (!(group in GROUP_LABEL)) throw new InputError("fare_type for HK must be adult, senior or disability (student and child fares are not included).");
  const ticket = (input.ticket ?? "octopus").toString().toLowerCase() as Ticket;
  if (ticket !== "octopus" && ticket !== "single") throw new InputError('ticket for HK must be "octopus" (default) or "single" (single-journey ticket).');
  if (ticket === "single" && group === "disability") throw new InputError("A single-journey ticket fare is published for adult and senior only; use ticket=octopus for disability.");
  const a = findStation(pairs, input.from_station, "from_station");
  const b = findStation(pairs, input.to_station, "to_station");
  if (a.id === b.id) throw new InputError("from_station and to_station are the same station; give two different stations.");
  const hit = pairs.find((p) => p.fromId === a.id && p.toId === b.id);
  const fare = hit ? (ticket === "octopus" ? hit.octopus[group] : (hit.single as Record<string, number>)[group]) : NaN;
  const modified = input.modified ?? null;
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "HK", from_station: a.name, to_station: b.name, fare_type: group, ticket },
    value: Number.isFinite(fare) ? fare : null,
    measure: "average",
    currency: "HKD",
    unit: `per journey (MTR ${ticket === "octopus" ? "Octopus" : "single-journey ticket"} fare)`,
    period: { from: modified, to: null },
    reference_period: modified ? `fares in the MTR file last modified ${modified}` : "fares in the current MTR open-data file",
    method: METHOD,
    describe: (v) =>
      `The posted MTR ${ticket === "octopus" ? "Octopus" : "single-journey ticket"} ${GROUP_LABEL[group]} fare from ${a.name} to ${b.name} is HKD ${v.toFixed(2)} per journey.`,
    note: "Posted fare table, not an amount paid. Airport Express, Light Rail and MTR Bus are not included.",
    baseUrl: input.baseUrl,
    published: modified,
    extra: { from_station: a.name, to_station: b.name, fare_group: group, ticket, mode: "MTR" },
  });
}

let cache: { at: number; pairs: Pair[]; modified: string | null } | null = null;
const CACHE_MS = 6 * 3600 * 1000;

async function download(): Promise<{ text: string; modified: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(URL_FARES, { headers: { "user-agent": UA, accept: "text/csv,*/*" }, signal: controller.signal });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, URL_FARES, res.status);
    const lm = res.headers.get("last-modified");
    const d = lm ? new Date(lm) : null;
    return { text: await res.text(), modified: d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null };
  } catch (e: any) {
    if (e instanceof SourceError) throw e;
    if (e?.name === "AbortError") throw new SourceError("Source timed out", URL_FARES);
    throw new SourceError("Could not reach the official source", String(e?.cause?.code ?? e?.message ?? e));
  } finally {
    clearTimeout(timer);
  }
}

export async function hkFares(input: FareInput, load?: () => Promise<{ text: string; modified: string | null }>): Promise<PriceAnswer> {
  if (!load && cache && Date.now() - cache.at < CACHE_MS) return answerFromFares(cache.pairs, { ...input, modified: cache.modified });
  const { text, modified } = await (load ?? download)();
  const pairs = parseFares(text);
  if (!load) cache = { at: Date.now(), pairs, modified };
  return answerFromFares(pairs, { ...input, modified });
}
