// Sweden dental treatment prices: TLV (Dental and Pharmaceutical Benefits Agency) reference prices for dental care.
// TLV publishes one Excel file per tariff period on https://www.tlv.se/tandvard/referenspriser.html (the page lists the file in force and the
// next one; the download URL carries a changing id, so we read the page and pick the file whose "from" date is the latest one not after today).
// Columns (checked 12 Nov 2026): Åtgärdsnummer | Åtgärdsnamn | Referenspris allmäntandvård | Referenspris specialisttandvård | Tandteknisk kostnad | Dentalt material.
// Prices are SEK stored as text ("1100"), "-" = no price for that care type. Dentists in Sweden set their own prices; the reference price is
// what the state dental support is calculated on. It is a POSTED reference price, never what a patient paid.
// ~35 kB file: fetched live, cached in memory for 6 hours, no daily collector needed.

import { InputError, SourceError, withDeadline } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { NO_COUNT } from "../../lib/stats";
import { readXlsx } from "../../categories/rent/xlsx";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "se-tlv-dental",
  country: "SE (Sweden)",
  category: "doctor and hospital prices (dental care reference prices)",
  name: "Dental care reference prices (TLV referenspriser)",
  publisher: "TLV, the Dental and Pharmaceutical Benefits Agency (Tandvårds- och läkemedelsförmånsverket)",
  what_is_recorded:
    "For about 200 numbered dental treatments (examinations, fillings, root canals, crowns, implants, scaling and more) the reference price in SEK for general dental care and for specialist dental care.",
  price_type: "reimbursement_price",
  freshness: "TLV publishes a new tariff file once or twice a year; we read the page and use the file in force today",
  licence: "No licence stated on TLV's open data page (tlv.se/om-tlv/oppna-data.html); free tier only",
  licence_url: "https://www.tlv.se/om-tlv/oppna-data.html",
  attribution: "Source: TLV (Tandvårds- och läkemedelsförmånsverket), tlv.se, Referenspriser inom tandvårdsstödet; data not altered.",
  homepage: "https://www.tlv.se/tandvard/referenspriser.html",
  limits:
    "A reference price is the amount the Swedish state dental support is calculated on, not what a patient paid: dental clinics in Sweden set their own prices freely, so real prices are often higher or lower. " +
    "One price per numbered treatment; there is no sample size. The dental technician's cost and the material are part of the reference price for some treatments and are not shown separately.",
};

export const PAGE_URL = "https://www.tlv.se/tandvard/referenspriser.html";
const UA = "Mozilla/5.0 (compatible; ProofPrice/1.0; +https://proofprice.com; hello@proofprice.com)";
const SV_MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

export interface Treatment {
  code: number;
  name: string;
  general: number;
  specialist: number | null;
}
export interface TariffFile {
  url: string;
  from: string; // YYYY-MM-DD the tariff applies from
}

/** xlsx links on the TLV page, each with the date the tariff applies from (read from the file name: "fran15jan2027", "fr%C3%A5n%201%20jan%202026"). */
export function parseListing(html: string, base = "https://www.tlv.se"): TariffFile[] {
  const out: TariffFile[] = [];
  for (const m of html.matchAll(/href="([^"]*\.xlsx)"/gi)) {
    const href = m[1];
    let decoded = href;
    try { decoded = decodeURIComponent(href); } catch { /* keep raw */ }
    const d = decoded.match(/(\d{1,2})\s*(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)[a-z]*\s*(\d{4})/i);
    if (!d) continue;
    const month = SV_MONTHS.indexOf(d[2].toLowerCase()) + 1;
    const from = `${d[3]}-${String(month).padStart(2, "0")}-${String(Number(d[1])).padStart(2, "0")}`;
    out.push({ url: href.startsWith("http") ? href : base + href, from });
  }
  out.sort((a, b) => (a.from < b.from ? -1 : 1));
  return out;
}

/** The file in force on `today`: the newest one that applies from a date not after today (or the oldest listed file if none has started). */
export function fileInForce(files: TariffFile[], today: string): TariffFile | null {
  if (!files.length) return null;
  const started = files.filter((f) => f.from <= today);
  return started.length ? started[started.length - 1] : files[0];
}
/** First day the next listed tariff applies from, or null. */
export function nextChange(files: TariffFile[], inForce: TariffFile): string | null {
  const later = files.filter((f) => f.from > inForce.from);
  return later.length ? later[0].from : null;
}

function sek(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null; // "-" = no price
}

/** Rows of the sheet (as read by readXlsx) to treatments. Throws when the header is not the one we checked. */
export function parseTreatments(rows: unknown[][]): Treatment[] {
  const head = rows[0] ?? [];
  if (!/tg.rdsnummer/i.test(String(head[0] ?? "")) || !/referenspris/i.test(String(head[2] ?? ""))) {
    throw new SourceError("TLV dental reference price file format changed", String(head.slice(0, 4)));
  }
  const out: Treatment[] = [];
  for (const r of rows.slice(1)) {
    const code = Number(r[0]);
    const general = sek(r[2]);
    if (!Number.isInteger(code) || code <= 0 || general === null || typeof r[1] !== "string") continue;
    out.push({ code, name: r[1].replace(/\s+/g, " ").trim(), general, specialist: sek(r[3]) });
  }
  if (out.length < 50) throw new SourceError("TLV dental reference price file format changed", `only ${out.length} treatments`);
  return out;
}

// English words people ask with, mapped to the Swedish words TLV uses in treatment names.
const EN_SV: Record<string, string[]> = {
  crown: ["krona", "permanent"], crowns: ["krona", "permanent"], bridge: ["bro"], implant: ["implantat"], implants: ["implantat"], filling: ["fyllning"], fillings: ["fyllning"],
  "root canal": ["rotfyllning"], root: ["rot"], canal: ["rotkanal"], extraction: ["tanddragning", "avlägsnande"], removal: ["avlägsnande"],
  checkup: ["undersökning"], "check-up": ["undersökning"], exam: ["undersökning"], examination: ["undersökning"],
  scaling: ["tandsten"], tartar: ["tandsten"], cleaning: ["tandsten"], hygienist: ["tandhygienist"], dentist: ["tandläkare"],
  denture: ["protes"], dentures: ["protes"], periodontal: ["parodontal"], gum: ["parodontal"], gums: ["parodontal"], xray: ["röntgen"], "x-ray": ["röntgen"],
  sealant: ["fissurförsegling"], orthodontic: ["ortodontisk"], braces: ["ortodontisk"], surgery: ["kirurgisk", "operation"], anaesthesia: ["bedövning"], anesthesia: ["bedövning"],
};
const STOP = new Set(["of", "the", "a", "an", "for", "and", "or", "per", "dental", "tooth", "teeth", "treatment", "price", "cost", "en", "ett", "och", "av", "för", "tand"]);

/** Search words for a free-text service: Swedish words as given plus the Swedish equivalents of English ones. Throws on empty input. */
export function searchWords(service: string): string[] {
  const text = service.toLowerCase().trim();
  if (text.length < 2) throw new InputError("Give a dental treatment, e.g. 'crown' (or 'krona') or a TLV treatment number such as 800.");
  const words = new Set<string>();
  for (const [en, sv] of Object.entries(EN_SV)) if (text.includes(en)) sv.forEach((w) => words.add(w));
  for (const w of text.split(/[^a-zåäöé0-9-]+/).filter((x) => x.length >= 3 && !STOP.has(x))) if (!EN_SV[w]) words.add(w);
  return [...words];
}

export interface Match {
  treatment: Treatment;
  others: Treatment[];
}
/** Best treatment for a code or words. A code must match exactly. Words: most matched words wins, then the lowest code (the basic treatments come first in the tariff). */
export function findTreatment(list: Treatment[], service: string): Match | null {
  const s = service.trim();
  if (/^\d{3}$/.test(s)) {
    const t = list.find((x) => x.code === Number(s));
    return t ? { treatment: t, others: [] } : null;
  }
  const words = searchWords(s);
  if (!words.length) throw new InputError("Give a dental treatment, e.g. 'crown' (or 'krona') or a TLV treatment number such as 800.");
  const scored = list
    .map((t) => ({ t, score: words.filter((w) => t.name.toLowerCase().includes(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.t.code - b.t.code);
  if (!scored.length) return null;
  // Only treatments matching as many words as the best one count as alternatives.
  const top = scored.filter((x) => x.score === scored[0].score);
  return { treatment: top[0].t, others: top.slice(1, 6).map((x) => x.t) };
}

export function treatmentAnswer(opts: { match: Match | null; service: string; file: TariffFile; next: string | null; today: string; baseUrl?: string }): PriceAnswer {
  const { match, file } = opts;
  const query = { country: "SE", service: opts.service };
  const period = { from: file.from, to: opts.next ? new Date(Date.parse(opts.next) - 86400000).toISOString().slice(0, 10) : null };
  const t = match?.treatment;
  const specialist = t?.specialist ?? null;
  return buildStatisticAnswer({
    source: INFO,
    query,
    value: t ? t.general : null,
    measure: "average",
    currency: "SEK",
    unit: "per treatment (general dental care reference price)",
    period,
    reference_period: `from ${file.from}`,
    sample_size: NO_COUNT,
    min: t ? t.general : null,
    max: specialist !== null && t ? Math.max(specialist, t.general) : t ? t.general : null,
    method:
      "Sweden dental care: TLV's published reference price per numbered treatment (general dental care; the specialist price is in max when it differs), from the tariff file in force today. " +
      "A reference price is what the state dental support is calculated on, not what patients paid.",
    describe: (v) =>
      `TLV reference price for "${t!.name}" (treatment ${t!.code}): ${fmtMoney(v, "SEK")} in general dental care` +
      (specialist !== null ? `, ${fmtMoney(specialist, "SEK")} in specialist dental care.` : " (no specialist price).") +
      ` Valid from ${file.from}${opts.next ? `; a new tariff applies from ${opts.next}` : ""}.`,
    ending: "Posted reference price used for the Swedish dental support; clinics set their own prices, so this is not what patients paid.",
    note: "Reference price, not a paid price.",
    baseUrl: opts.baseUrl,
    extra: {
      treatment_code: t?.code ?? null,
      treatment: t?.name ?? null,
      general_dental_care_sek: t?.general ?? null,
      specialist_dental_care_sek: specialist,
      other_matches: (match?.others ?? []).map((o) => ({ code: o.code, name: o.name, general_dental_care_sek: o.general })),
      next_tariff_from: opts.next,
    },
  });
}

async function fetchBuf(url: string, ms: number): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": UA } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
    return Buffer.from(await res.arrayBuffer());
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

let cache: { at: number; today: string; list: Treatment[]; file: TariffFile; next: string | null } | null = null;
const CACHE_MS = 6 * 3600_000;

async function load(today: string) {
  if (cache && Date.now() - cache.at < CACHE_MS && cache.today === today) return cache;
  const html = (await fetchBuf(PAGE_URL, 8000)).toString("utf8");
  const files = parseListing(html);
  const file = fileInForce(files, today);
  if (!file) throw new SourceError("TLV page lists no dental reference price file", PAGE_URL);
  const buf = await fetchBuf(file.url, 9000);
  const list = parseTreatments(readXlsx(buf)[0]?.rows ?? []);
  cache = { at: Date.now(), today, list, file, next: nextChange(files, file) };
  return cache;
}

export async function seDentalPrices(p: { service: string | undefined; state?: string | undefined; setting?: string | undefined; baseUrl?: string }): Promise<PriceAnswer> {
  if (!p.service) throw new InputError("service is required: a dental treatment such as 'crown', 'root canal', 'implant' or a TLV treatment number such as 800.");
  if (p.state || p.setting) throw new InputError("Sweden dental prices have no state or setting option: leave them out.");
  const today = new Date().toISOString().slice(0, 10);
  searchWords(/^\d{3}$/.test(p.service.trim()) ? "000" : p.service); // validate input before any network call
  const c = await withDeadline(load(today), 17000, () => new SourceError("Source timed out", PAGE_URL));
  return treatmentAnswer({ match: findTreatment(c.list, p.service), service: p.service, file: c.file, next: c.next, today, baseUrl: p.baseUrl });
}
