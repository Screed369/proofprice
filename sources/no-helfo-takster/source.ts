// Norway health service fee tariffs: Helsedirektoratet "takster" (the state tariff for doctors, psychologists, dentists and physiotherapists
// under the Helfo scheme). One XML per field on https://www.helsedirektoratet.no/tilskudd-og-finansiering/finansiering/takster (checked 12 Nov 2026):
// <Taksttabell xmlns="http://helfo.no/skjema/taksttabell"><fagomraade>LE</fagomraade><tidspunkt>2026-09-01</tidspunkt><Takst><takstkode>S2ad</takstkode>
// <fradato>2026-07-01</fradato><honorar>179.0</honorar><refusjon>0.0</refusjon>[<egenandel>]<spesialisttakst>true|false</spesialisttakst><Beskrivelse>..</Beskrivelse></Takst>...
// ISO-8859-1, dated file names ("Takster_Lege_01092026 oppdatert.xml"), so we read the page links and never hard-code a date.
// honorar = the fee set in the state tariff (NOK), refusjon = what the state refunds of it. It is a POSTED tariff, never what a patient paid.

import { InputError, SourceError, withDeadline } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { NO_COUNT } from "../../lib/stats";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "no-helfo-takster",
  country: "NO (Norway)",
  category: "doctor and hospital prices (state tariff fees)",
  name: "Health service fee tariffs (Helsedirektoratet takster, Helfo scheme)",
  publisher: "Helsedirektoratet (the Norwegian Directorate of Health)",
  what_is_recorded:
    "For each numbered tariff code (about 555 for doctors, plus psychologists, dentists and physiotherapists) the fee set in the state tariff in NOK and the amount the state refunds of it.",
  price_type: "reimbursement_price",
  freshness: "Helsedirektoratet publishes new tariff files about twice a year; we read the page and use the newest file for each field",
  licence: "No licence or reuse statement found on the Helsedirektoratet takster page (read 12 Nov 2026); free tier only",
  licence_url: "https://www.helsedirektoratet.no/tilskudd-og-finansiering/finansiering/takster",
  attribution: "Source: Helsedirektoratet, Takster (takstene for refusjon fra Helfo), helsedirektoratet.no; data not altered.",
  homepage: "https://www.helsedirektoratet.no/tilskudd-og-finansiering/finansiering/takster",
  limits:
    "A tariff fee is the amount set in the state scheme (the fee, and the part the state refunds), not what an individual patient paid: the patient pays the difference (egenandel), and private providers outside the scheme set their own prices. " +
    "One figure per tariff code; there is no sample size. Hospital stays are not included.",
};

export const PAGE_URL = "https://www.helsedirektoratet.no/tilskudd-og-finansiering/finansiering/takster";
const UA = "Mozilla/5.0 (compatible; ProofPrice/1.0; +https://proofprice.com; hello@proofprice.com)";

export type Field = "Lege" | "Psykolog" | "Tannlege" | "Fysioterapeut";
export const FIELD_LABEL: Record<Field, string> = { Lege: "doctor (lege)", Psykolog: "psychologist", Tannlege: "dentist", Fysioterapeut: "physiotherapist" };
const FIELDS: Field[] = ["Lege", "Psykolog", "Tannlege", "Fysioterapeut"];

export interface TariffFile { field: Field; url: string; from: string }
export interface Takst { field: Field; code: string; from: string; fee: number; refund: number | null; patientShare: number | null; specialist: boolean; text: string }

/** The newest plain file for each field on the page (files with "merknader" or "kommunal" in the name are other editions and are skipped). */
export function parseListing(html: string, base = "https://www.helsedirektoratet.no"): TariffFile[] {
  const best = new Map<Field, TariffFile>();
  for (const m of html.matchAll(/href="([^"]*\/Takster_(Lege|Psykolog|Tannlege|Fysioterapeut)_(\d{2})(\d{2})(\d{4})[^"/]*\.xml)"/gi)) {
    const field = FIELDS.find((f) => f.toLowerCase() === m[2].toLowerCase())!;
    const from = `${m[5]}-${m[4]}-${m[3]}`;
    const cur = best.get(field);
    if (!cur || from > cur.from) best.set(field, { field, url: m[1].startsWith("http") ? m[1] : base + m[1], from });
  }
  return [...best.values()];
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : null;
}
function num(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/** Parse one tariff XML (already decoded to text). Throws when the file is not a tariff table. Codes valid from a date after `today` are left out; a repeated code keeps the newest. */
export function parseTakster(xml: string, field: Field, today: string): { takster: Takst[]; published: string | null } {
  if (!/<Taksttabell[\s>]/.test(xml)) throw new SourceError("Helsedirektoratet tariff file format changed", xml.slice(0, 80));
  const byCode = new Map<string, Takst>();
  for (const m of xml.matchAll(/<Takst>([\s\S]*?)<\/Takst>/g)) {
    const b = m[1];
    const code = tag(b, "takstkode");
    const fee = num(tag(b, "honorar"));
    const from = tag(b, "fradato") ?? "";
    const text = tag(b, "Beskrivelse");
    if (!code || fee === null || fee <= 0 || !text || from > today) continue;
    const t: Takst = {
      field, code, from, fee, refund: num(tag(b, "refusjon")), patientShare: num(tag(b, "egenandel")),
      specialist: tag(b, "spesialisttakst") === "true", text: unescapeXml(text).replace(/\s+/g, " ").trim(),
    };
    const old = byCode.get(code);
    if (!old || t.from >= old.from) byCode.set(code, t);
  }
  const takster = [...byCode.values()];
  if (takster.length < 20) throw new SourceError("Helsedirektoratet tariff file format changed", `only ${takster.length} tariff codes`);
  return { takster, published: tag(xml, "tidspunkt") };
}

// Words people ask with (English) mapped to Norwegian words used in the tariff texts.
const EN_NO: Record<string, string[]> = {
  consultation: ["konsultasjon"], visit: ["konsultasjon"], appointment: ["konsultasjon"], consult: ["konsultasjon"],
  cataract: ["katarakt"], "x-ray": ["røntgen"], xray: ["røntgen"], ecg: ["ekg"], vaccination: ["vaksin"], vaccine: ["vaksin"],
  "sick note": ["sykmelding"], "sick leave": ["sykmelding"], stitches: ["sutur"], suture: ["sutur"], surgery: ["operasjon"], operation: ["operasjon"],
  injection: ["injeksjon"], pregnancy: ["svangerskap"], ultrasound: ["ultralyd"], examination: ["undersøkelse"], exam: ["undersøkelse"], "check-up": ["undersøkelse"], checkup: ["undersøkelse"],
  treatment: ["behandling"], therapy: ["behandling"], telephone: ["telefon"], phone: ["telefon"], video: ["video"], digital: ["digital"], night: ["natt"], evening: ["kveld"],
  filling: ["fylling"], extraction: ["trekk", "ekstraksjon"], "root canal": ["rotfylling"], crown: ["krone"], children: ["barn"], child: ["barn"],
  gp: ["allmennlege", "fastlege"], "general practitioner": ["allmennlege", "fastlege"],
};
const STOP = new Set(["of", "the", "a", "an", "for", "and", "or", "per", "at", "to", "price", "cost", "fee", "norway", "en", "ett", "og", "av", "for", "hos", "med"]);
const FIELD_WORDS: Array<[RegExp, Field]> = [
  [/psykolog|psycholog|psychotherap|mental/i, "Psykolog"],
  [/fysioterap|physio|sjukegymn/i, "Fysioterapeut"],
  [/tannlege|tannhelse|tann|dentist|dental|tooth|teeth/i, "Tannlege"],
  [/\blege\b|doctor|physician|\bgp\b|fastlege|allmennlege|general practitioner/i, "Lege"],
];

/** Which fields to search: the ones the question names, otherwise all (doctors first on ties). */
export function fieldsFor(service: string): Field[] {
  const hit = FIELD_WORDS.filter(([re]) => re.test(service)).map(([, f]) => f);
  return hit.length ? hit : FIELDS;
}

export function searchWords(service: string): string[] {
  const text = service.toLowerCase().trim();
  if (text.length < 2) throw new InputError("Give a medical service, e.g. 'consultation', 'cataract operation' or a tariff code such as S2ad.");
  const words = new Set<string>();
  let rest = text;
  for (const [en, no] of Object.entries(EN_NO)) {
    if (text.includes(en)) { no.forEach((w) => words.add(w)); rest = rest.replace(en, " "); }
  }
  for (const w of rest.split(/[^a-zæøåé0-9-]+/).filter((x) => x.length >= 3 && !STOP.has(x))) words.add(w);
  for (const [re] of FIELD_WORDS) for (const w of [...words]) if (re.test(w)) words.delete(w); // provider words select the file, they are not part of the text
  if (!words.size) { // only a profession was named ("psychologist"): that profession's basic service
    const f = FIELD_WORDS.find(([re]) => re.test(text))?.[1];
    words.add(f === "Psykolog" ? "psykoterapi" : f === "Fysioterapeut" ? "behandling" : f === "Tannlege" ? "undersøkelse" : "konsultasjon");
  }
  return [...words];
}

export interface Match { item: Takst; others: Takst[] }

/** Best tariff for a code or words. A code must match exactly (any case). Words: most words matched wins, then the shortest text (the basic service), then the field order. */
export function findTakst(list: Takst[], service: string): Match | null {
  const s = service.trim();
  const exact = list.filter((t) => t.code.toLowerCase() === s.toLowerCase());
  if (exact.length) return { item: exact[0], others: exact.slice(1) };
  if (/^[a-z]?\d+[a-z]*$/i.test(s) && s.length <= 6) return null; // looks like a code: do not guess by words
  const words = searchWords(s);
  if (!words.length) throw new InputError("Give a medical service, e.g. 'consultation', 'cataract operation' or a tariff code such as S2ad.");
  const wantsSpecialist = /spesialist|specialist/i.test(s);
  const scored = list
    .map((t, i) => ({ t, i, score: words.filter((w) => t.text.toLowerCase().includes(w)).length - (!wantsSpecialist && /spesialist/i.test(t.text) ? 0.5 : 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.t.text.length - b.t.text.length || a.i - b.i);
  if (!scored.length) return null;
  const top = scored.filter((x) => x.score === scored[0].score);
  return { item: top[0].t, others: top.slice(1, 6).map((x) => x.t) };
}

export function takstAnswer(opts: { match: Match | null; service: string; from: string; published: string | null; baseUrl?: string }): PriceAnswer {
  const t = opts.match?.item;
  const first = t ? t.text.split(/(?<=\.)\s/)[0].slice(0, 180) : "";
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "NO", service: opts.service },
    value: t ? t.fee : null,
    measure: "average",
    currency: "NOK",
    unit: "per service (fee set in the state tariff)",
    period: { from: opts.from, to: null },
    reference_period: `tariff of ${opts.published ?? opts.from}`,
    sample_size: NO_COUNT,
    method:
      "Norway: the fee (honorar) set in the Helsedirektoratet tariff for the numbered service, from the newest tariff file for that field. The part the state refunds (refusjon) and the patient's share are in the extra fields. " +
      "A tariff fee is set by the state scheme, not what patients paid.",
    describe: (v) =>
      `Norwegian state tariff for ${FIELD_LABEL[t!.field]} service ${t!.code} ("${first}"): fee ${fmtMoney(v, "NOK")}` +
      (t!.refund !== null ? `, of which the state refunds ${fmtMoney(t!.refund, "NOK")}` : "") + `. Valid from ${t!.from}.`,
    ending: "Posted state tariff under the Helfo scheme; patients pay the difference (egenandel), and providers outside the scheme set their own prices.",
    note: "Tariff fee, not a paid price.",
    baseUrl: opts.baseUrl,
    extra: {
      provider_field: t?.field ?? null,
      tariff_code: t?.code ?? null,
      description: t?.text.slice(0, 400) ?? null,
      fee_nok: t?.fee ?? null,
      state_refund_nok: t?.refund ?? null,
      patient_share_nok: t?.patientShare ?? (t && t.refund !== null ? Math.max(0, Math.round((t.fee - t.refund) * 100) / 100) : null),
      specialist_tariff: t?.specialist ?? null,
      other_matches: (opts.match?.others ?? []).map((o) => ({ provider_field: o.field, code: o.code, fee_nok: o.fee, description: o.text.slice(0, 120) })),
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

const CACHE_MS = 6 * 3600_000;
let listing: { at: number; files: TariffFile[] } | null = null;
const fileCache = new Map<string, { at: number; today: string; takster: Takst[]; published: string | null }>();

async function loadField(file: TariffFile, today: string) {
  const hit = fileCache.get(file.url);
  if (hit && Date.now() - hit.at < CACHE_MS && hit.today === today) return hit;
  const xml = new TextDecoder("iso-8859-1").decode(await fetchBuf(file.url, 9000));
  const parsed = parseTakster(xml, file.field, today);
  const v = { at: Date.now(), today, ...parsed };
  fileCache.set(file.url, v);
  return v;
}

export async function noMedicalPrices(p: { service: string | undefined; state?: string | undefined; setting?: string | undefined; baseUrl?: string }): Promise<PriceAnswer> {
  if (!p.service) throw new InputError("service is required: a medical service such as 'consultation', 'cataract operation', 'psychologist session' or a tariff code such as S2ad.");
  if (p.state || p.setting) throw new InputError("Norway tariff fees have no state or setting option: leave them out.");
  const wanted = fieldsFor(p.service);
  const today = new Date().toISOString().slice(0, 10);
  const work = (async () => {
    if (!listing || Date.now() - listing.at > CACHE_MS) {
      listing = { at: Date.now(), files: parseListing((await fetchBuf(PAGE_URL, 8000)).toString("utf8")) };
    }
    const files = wanted.map((f) => listing!.files.find((x) => x.field === f)).filter((x): x is TariffFile => !!x);
    if (!files.length) throw new SourceError("Helsedirektoratet page lists no tariff file", PAGE_URL);
    const loaded = await Promise.all(files.map((f) => loadField(f, today)));
    return { files, loaded };
  })();
  const { files, loaded } = await withDeadline(work, 17000, () => new SourceError("Source timed out", PAGE_URL));
  const list = loaded.flatMap((l) => l.takster);
  const match = findTakst(list, p.service);
  const file = match ? files.find((f) => f.field === match.item.field)! : files[0];
  const published = loaded[files.indexOf(file)]?.published ?? null;
  return takstAnswer({ match, service: p.service, from: file.from, published, baseUrl: p.baseUrl });
}
