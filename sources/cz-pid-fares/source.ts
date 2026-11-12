// Prague integrated transport (PID, run by ROPID): posted fares from the GTFS feed https://data.pid.cz/PID_GTFS.zip.
// Format checked live on 2026-11-12 (range reads of the zip, no key, 47 MB archive updated daily): fare_attributes.txt =
// fare_id,price,currency_type,payment_method,transfers,agency_id,transfer_duration (17 rows: T30_* 39 CZK / 30 min, T90_* 50 CZK / 90 min,
// T0 free, TLD 100 CZK, TAE 200 CZK). Only fare_attributes.txt is read: the zip also holds a 112 MB stop_times.txt that is never downloaded.
// Posted tariff, the same for everyone in the fare group, not amounts paid. Licence CC BY 4.0 (ROPID / PID).

import { inflateRawSync } from "node:zlib";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const ZIP_URL = "https://data.pid.cz/PID_GTFS.zip";
const UA = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const INFO: SourceInfo = {
  id: "cz-pid-fares",
  country: "CZ (Prague and the PID region)",
  category: "transport fares (Prague metro, tram, bus)",
  name: "Prague Integrated Transport (PID) posted fares",
  publisher: "ROPID (Regionální organizátor pražské integrované dopravy), open data feed data.pid.cz",
  what_is_recorded:
    "The posted price of the standard PID single tickets (30-minute and 90-minute) and of the special-line fares in the fare table of the public GTFS feed. A published tariff, not amounts paid.",
  price_type: "posted_price",
  freshness: "The feed is rebuilt daily by the publisher; fares change only when the tariff changes",
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0): reuse including commercial use, with attribution",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Source: ROPID / Pražská integrovaná doprava (PID open data, data.pid.cz), CC BY 4.0. ProofPrice only reads the fare table; this is not an official PID service.",
  homepage: "https://pid.cz/o-systemu/opendata/",
  limits:
    "Posted base fares in CZK, the same for everyone, not amounts paid, not a ticket and not a quote. Reduced fares (seniors, students, children), passes and zone-specific long-term tickets are not in the feed's fare table. No sample size.",
};

export interface Fare {
  id: string;
  price: number;
  currency: string;
  /** Seconds the ticket is valid for transfers; null when the feed gives none. */
  validity_seconds: number | null;
}

/** Pure: parse fare_attributes.txt (comma separated, header line). */
export function parseFareAttributes(text: string): Fare[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) throw new SourceError("The PID fare table is empty; this source needs updating.");
  const head = lines[0].split(",").map((h) => h.trim());
  const ix = (n: string) => head.indexOf(n);
  const iId = ix("fare_id"), iPrice = ix("price"), iCur = ix("currency_type"), iDur = ix("transfer_duration");
  if (iId < 0 || iPrice < 0 || iCur < 0) throw new SourceError("The PID fare table has an unexpected layout; this source needs updating.");
  const out: Fare[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split(",").map((x) => x.trim());
    const price = Number(c[iPrice]);
    if (!c[iId] || !Number.isFinite(price) || price < 0) continue;
    const dur = iDur >= 0 && c[iDur] ? Number(c[iDur]) : NaN;
    out.push({ id: c[iId], price, currency: c[iCur] || "CZK", validity_seconds: Number.isFinite(dur) ? dur : null });
  }
  if (!out.some((f) => /^T90/.test(f.id)) || !out.some((f) => /^T30/.test(f.id))) {
    throw new SourceError("The PID fare table no longer lists the 30- and 90-minute tickets; this source needs updating.");
  }
  return out;
}

export interface FareInput {
  fare_type?: string;
  distance_km?: number;
  travel_time?: string;
  baseUrl?: string;
}

const METHOD =
  "Prague public transport: the posted price of the standard PID single ticket in the fare table of the public GTFS feed (ROPID). One price covers any distance inside the tariff zones; " +
  "a published list price, the same for everyone, not a count of fares paid.";

/** Pure: pick the answer out of the parsed fares. Default = the 90-minute ticket (the usual single ticket for a journey with transfers). */
export function answerFromFares(fares: Fare[], input: FareInput, retrievedOn: string = new Date().toISOString().slice(0, 10)): PriceAnswer {
  const group = (input.fare_type ?? "adult").toString().toLowerCase();
  if (group !== "adult") {
    throw new InputError("For Prague (CZ) the fare table only holds the standard adult fares: leave fare_type out or use adult. Reduced fares are not in the open data.");
  }
  if (input.travel_time !== undefined && input.travel_time !== "other") {
    throw new InputError("Prague has no early-morning fare band: leave travel_time out or use other.");
  }
  if (input.distance_km !== undefined && (!Number.isFinite(input.distance_km) || input.distance_km < 0)) {
    throw new InputError("distance_km must be a number of kilometres, e.g. 8.5.");
  }
  const t90 = fares.find((f) => /^T90/.test(f.id) && f.price > 0);
  if (!t90) throw new SourceError("The PID fare table has no 90-minute ticket price.");
  const t30 = fares.find((f) => /^T30/.test(f.id) && f.price > 0);
  const label = (f: Fare) =>
    /^T30/.test(f.id) ? "30-minute ticket" : /^T90/.test(f.id) ? "90-minute ticket" : f.id === "T0" ? "free fare" : `special-line fare ${f.id}`;
  const seen = new Set<string>();
  const products = fares
    .map((f) => ({ product: label(f), price_czk: f.price, valid_minutes: f.validity_seconds ? f.validity_seconds / 60 : null }))
    .filter((p) => {
      const key = p.product + p.price_czk;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "CZ", fare_type: "adult", ...(input.distance_km !== undefined ? { distance_km: input.distance_km } : {}) },
    value: t90.price,
    measure: "average",
    currency: "CZK",
    unit: "per 90-minute single ticket",
    period: { from: retrievedOn, to: null },
    reference_period: "fare table in force on " + retrievedOn,
    method: METHOD,
    describe: (v) => `The posted adult 90-minute single ticket in Prague (PID) costs CZK ${v.toFixed(0)}${t30 ? `; the 30-minute ticket costs CZK ${t30.price.toFixed(0)}` : ""}.`,
    note:
      "Posted list price, not an amount paid. The fare does not depend on distance inside the tariff zones." +
      (input.distance_km !== undefined ? " The distance you gave does not change it." : ""),
    baseUrl: input.baseUrl,
    extra: { products, ticket: label(t90) },
  });
}

// ---- reading one file out of the 47 MB zip with HTTP range requests (never download the whole archive) ----

async function range(url: string, header: string, signal: AbortSignal): Promise<Buffer> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Range: header }, signal });
  if (res.status !== 206 && res.status !== 200) throw new SourceError(`PID open data answered HTTP ${res.status}.`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (res.status === 200 && buf.length > 5_000_000) throw new SourceError("PID open data ignored the range request; refusing to read the whole archive.");
  return buf;
}

/** Pure: find one entry in a zip's tail (end-of-central-directory + central directory). */
export function findEntry(tail: Buffer, tailStart: number, name: string): { offset: number; csize: number; method: number } | null {
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new SourceError("PID archive: end of central directory not found.");
  const cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
  let p = cdOff - tailStart;
  if (p < 0) throw new SourceError("PID archive: central directory larger than the tail read.");
  const end = p + cdSize;
  while (p + 46 <= end && tail.readUInt32LE(p) === 0x02014b50) {
    const method = tail.readUInt16LE(p + 10), csize = tail.readUInt32LE(p + 20);
    const nl = tail.readUInt16LE(p + 28), el = tail.readUInt16LE(p + 30), cl = tail.readUInt16LE(p + 32);
    const offset = tail.readUInt32LE(p + 42);
    if (tail.toString("utf8", p + 46, p + 46 + nl) === name) return { offset, csize, method };
    p += 46 + nl + el + cl;
  }
  return null;
}

export async function readFareAttributes(url: string = ZIP_URL, timeoutMs = 20000): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const tail = await range(url, "bytes=-65536", ctl.signal);
    const len = await totalLength(url, ctl.signal);
    const ent = findEntry(tail, len - tail.length, "fare_attributes.txt");
    if (!ent) throw new SourceError("PID archive has no fare_attributes.txt; this source needs updating.");
    const head = await range(url, `bytes=${ent.offset}-${ent.offset + 29}`, ctl.signal);
    if (head.readUInt32LE(0) !== 0x04034b50) throw new SourceError("PID archive: bad local header.");
    const dataStart = ent.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    const raw = await range(url, `bytes=${dataStart}-${dataStart + ent.csize - 1}`, ctl.signal);
    return (ent.method === 8 ? inflateRawSync(raw) : raw).toString("utf8");
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError("PID open data (data.pid.cz) did not answer in time or could not be read.");
  } finally {
    clearTimeout(timer);
  }
}

async function totalLength(url: string, signal: AbortSignal): Promise<number> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Range: "bytes=0-0" }, signal });
  const m = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "");
  await res.arrayBuffer();
  if (!m) throw new SourceError("PID open data did not report the archive size.");
  return Number(m[1]);
}

export async function pidFares(input: FareInput, fetcher?: () => Promise<string>): Promise<PriceAnswer> {
  const text = fetcher ? await fetcher() : await readFareAttributes();
  return answerFromFares(parseFareAttributes(text), input);
}
