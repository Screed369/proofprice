// French state auctions (Enchères du Domaine, DNID): lots sold in calendar 2024. Format checked on 2026-10-21
// (12,978,652 bytes, semicolon-separated, UTF-8 with BOM, CRLF, dates dd/mm/yyyy).
import { SourceError } from "../../lib/http";
import { summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";

// Stable alias that follows republishing (resource id of "Données de ventes année 2024"); redirects to the current file.
export const CSV_URL = "https://www.data.gouv.fr/api/1/datasets/r/76570370-c52e-46f1-80b0-76cb28058a47";

export const INFO: SourceInfo = {
  id: "fr-domaine-auctions",
  country: "FR",
  category: "auctions (state auction hammer prices)",
  name: "Enchères du Domaine: données de ventes (lots sold at French state auctions)",
  publisher: "Direction Nationale d'Interventions Domaniales (DNID), Enchères du Domaine, via data.gouv.fr",
  what_is_recorded: "One lot sold at a French state auction (seized, impounded, court-ordered and administrative sales), with its hammer price.",
  price_type: "transaction",
  freshness: "Yearly file: calendar 2024 (published 20 Feb 2026); the 2025 file is expected around Feb 2027",
  licence: "Licence Ouverte 2.0 (Etalab)",
  licence_url: "https://github.com/etalab/licence-ouverte/blob/master/open-licence.md",
  attribution:
    "Direction Nationale d'Interventions Domaniales (DNID), Enchères du Domaine, original data downloaded from https://www.data.gouv.fr/datasets/donnees-de-ventes-annee-2024/, updated 20 February 2026, Licence Ouverte 2.0. Aggregated by ProofPrice (changed: medians and percentiles only).",
  homepage: "https://www.data.gouv.fr/datasets/donnees-de-ventes-annee-2024/",
  limits:
    "Hammer price (prix d'adjudication) of lots sold at state auctions in 2024, whether buyer fees are included is not stated. Seized, impounded and court sales, often high-mileage or damaged goods: not retail prices. Land leases (Herbage) and lots with a zero price are left out.",
};

export const AUCTION_EVIDENCE = {
  label: "Auction hammer prices (state auctions)",
  meaning:
    "The hammer price (prix d'adjudication) of lots sold at French state auctions in 2024, from the publisher's yearly file: a winning bid level, not a confirmed receipt, and not a retail price. The file does not say whether buyer fees are included.",
};

export interface Lot {
  category: string;
  brand: string;
  model: string;
  text: string; // folded searchable text: description, brand, model, category
  city: string;
  price: number;
  soldAt: string; // yyyy-mm-dd
}

/** Lower-case, accents removed, trailing dots and stars dropped ("RENAULT." -> "renault"). */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&amp;/g, "&")
    .toLowerCase()
    .replace(/[*.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** RFC 4180-style rows with a chosen separator (quoted cells, doubled quotes, line breaks inside quotes). */
export function parseRows(text: string, sep = ";"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"') {
        if (t[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const HEADER = ["Description du lot", "Catégorie", "Marque", "Modèle", "Date de vente", "CAV organisateur", "Prix adjudication"];

/** Sold lots with a price above zero and a valid dd/mm/yyyy date. Land leases (Herbage) are not goods and are dropped. */
export function parseLots(text: string): Lot[] {
  const rows = parseRows(text);
  const head = (rows[0] ?? []).map((h) => h.trim());
  const [iDesc, iCat, iBrand, iModel, iDate, iCav, iPrice] = HEADER.map((n) => head.indexOf(n));
  if ([iDesc, iCat, iBrand, iModel, iDate, iCav, iPrice].some((v) => v < 0)) throw new SourceError("Unexpected file format from Enchères du Domaine");
  const lots: Lot[] = [];
  for (const r of rows.slice(1)) {
    const category = (r[iCat] ?? "").trim();
    if (!category || category === "Herbage") continue;
    const price = Number(r[iPrice]);
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((r[iDate] ?? "").trim());
    if (!(price > 0) || !m) continue;
    const brand = (r[iBrand] ?? "").trim();
    const model = (r[iModel] ?? "").trim();
    lots.push({
      category,
      brand,
      model,
      text: fold(`${r[iDesc] ?? ""} ${brand} ${model} ${category}`),
      city: fold(r[iCav] ?? ""),
      price,
      soldAt: `${m[3]}-${m[2]}-${m[1]}`,
    });
  }
  return lots;
}

/** Plain-English group names mapped to the publisher's French categories (compared folded). */
export const GROUPS: Record<string, string[]> = {
  vehicles: ["vehicules de tourisme", "utilitaires", "2 a 3 roues - voiturettes"],
  cars: ["vehicules de tourisme"],
  vans: ["utilitaires"],
  motorbikes: ["2 a 3 roues - voiturettes"],
  scooters: ["2 a 3 roues - voiturettes"],
  bicycles: ["velos"],
  bikes: ["velos"],
  computers: ["informatique"],
  furniture: ["mobilier et luminaires"],
  jewellery: ["bijoux"],
  jewelry: ["bijoux"],
  wine: ["vins et alcools"],
  clothing: ["vetements,chaussures,accessoires"],
  "workshop equipment": ["materiel d'atelier"],
};

/** A request matches a group name, a French category name, or every word found in the lot text (brand, model, description). */
export function matchLots(lots: Lot[], what: string, city?: string, fromDate?: string): Lot[] {
  const key = fold(what).replace(/\s+/g, " ");
  const group = GROUPS[key];
  const cats = group ?? [];
  const words = key.split(/[^a-z0-9]+/).filter(Boolean);
  const wantCity = city ? fold(city) : "";
  const frenchCat = !group && lots.some((l) => fold(l.category) === key) ? key : "";
  return lots.filter((l) => {
    if (fromDate && l.soldAt < fromDate) return false;
    if (wantCity && !l.city.includes(wantCity)) return false;
    if (group) return cats.includes(fold(l.category));
    if (frenchCat) return fold(l.category) === frenchCat;
    return words.length > 0 && words.every((w) => l.text.includes(w));
  });
}

let cache: { at: number; lots: Lot[] } | null = null;

async function loadLots(): Promise<Lot[]> {
  if (cache && Date.now() - cache.at < 24 * 3600 * 1000) return cache.lots;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(CSV_URL, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)" },
    });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, undefined, res.status);
    const lots = parseLots(await res.text());
    if (lots.length < 100) throw new SourceError("The auction file held almost no sold lots");
    cache = { at: Date.now(), lots };
    return lots;
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    if (err?.name === "AbortError") throw new SourceError("Source timed out", CSV_URL);
    throw new SourceError("Could not reach data.gouv.fr", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export async function auctionPrices(input: { what: string; city?: string; months: number; baseUrl?: string }, lots?: Lot[]): Promise<PriceAnswer> {
  const all = lots ?? (await loadLots());
  const newest = all.reduce((m, l) => (l.soldAt > m ? l.soldAt : m), "");
  if (!newest) throw new SourceError("The auction file held no sold lots");
  const d = new Date(newest + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - input.months);
  const from = d.toISOString().slice(0, 10);
  const hits = matchLots(all, input.what, input.city, from);
  const s = summarise(hits.map((l) => l.price));
  const oldest = hits.reduce((m, l) => (!m || l.soldAt < m ? l.soldAt : m), "");
  return buildAnswer({
    source: INFO,
    query: { country: "FR", what: input.what, ...(input.city ? { state: input.city } : {}), months: input.months },
    summary: s,
    currency: "EUR",
    unit: "per lot",
    period: { from: oldest || from, to: newest },
    method:
      "Median and 10th–90th percentile of the hammer price (prix d'adjudication) of lots sold at French state auctions (Enchères du Domaine) in 2024 that match the lot type, in the stated months. Land leases and zero prices are left out. Seized, impounded and court-ordered sales, not retail prices. No range under 5 lots.",
    describe: (x) =>
      `Matching lots sold at French state auctions in 2024 had a median hammer price of ${fmtMoney(x.median, "EUR")} per lot (10th–90th percentile ${fmtMoney(x.low, "EUR")} to ${fmtMoney(x.high, "EUR")}); ` +
      "a winning bid level at state auctions (seized, impounded or court sales), not a retail price. The file does not say whether buyer fees are included.",
    baseUrl: input.baseUrl,
    evidence: AUCTION_EVIDENCE,
  });
}
