// Quebec public contract prices from SEAO award notices (Secretariat du Conseil du tresor du Quebec, Donnees Quebec), CC BY 4.0.
// Format checked 2026-10-23 from GitHub's servers (probes qcseao-1, qcseao-2): the CKAN record
// https://www.donneesquebec.ca/recherche/api/3/action/package_show?id=systeme-electronique-dappel-doffres-seao lists OCDS 1.1 release packages
// (weekly hebdo_YYYYMMDD_YYYYMMDD.json, ~17-19 MB; monthly mensuel_YYYYMMDD_YYYYMMDD.json, ~68 MB), key-free plain GET, UTF-8.
// Each release is one contract event (tag contract / contractTermination ...) with awards[].{id,status,date,value.{amount,currency}} and
// tender.{title,items[].classification UNSPSC}. Parties (buyer and supplier names, addresses, company ids) are NEVER read or kept.
// The files are big, so they are read only by harvest() in the daily collector; answers come from the price library.
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import { readLatestDay } from "../../lib/library/store";
import { matchPurchase, PURCHASES } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "ca-qc-contracts",
  country: "CA (Quebec public contracts)",
  category: "government contracts (award notices)",
  name: "SEAO: Quebec public contract award notices",
  publisher: "Secrétariat du Conseil du trésor du Québec (SEAO), via Données Québec",
  what_is_recorded:
    "Contract award notices that Quebec ministries, agencies, school service centres, cities and municipalities publish on the SEAO system: title, award date, product class (UNSPSC) and the awarded amount in Canadian dollars.",
  price_type: "contract_price",
  freshness: "Weekly: Données Québec publishes new SEAO files every Monday; our copy is collected once a day",
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0)",
  licence_url: "https://www.donneesquebec.ca/licence/#cc-by",
  attribution:
    "Source: Secrétariat du Conseil du trésor (Québec), Système électronique d'appel d'offres (SEAO), Données Québec, CC BY 4.0. Figures are ProofPrice aggregates of the published notices (changes made: grouped, deduplicated, medians and ranges calculated).",
  homepage: "https://www.donneesquebec.ca/recherche/dataset/systeme-electronique-dappel-doffres-seao",
  limits:
    "Quebec only (not other provinces, not federal contracts). Only contracts above the publication thresholds are listed (municipalities from CA$25,000), so small purchases are missing and the low end of every range sits near that floor. The amount is the awarded value, often over the whole contract period and it may include options; it is not a unit price and not an amount paid yet. " +
    "Purchases are recognised from words in the (French) notice title and, for laptops, desktops and tablets, the UNSPSC code; a notice with an unusual title is missed. Placeholder amounts under 100 dollars are left out. " +
    "Aggregates only; buyers' suppliers and officials are never named or read.",
  method_version: "1",
};

/** Months of awards kept in each daily aggregate. */
export const WINDOW_MONTHS = 12;
export const MIN_VALUE = 100;
export const PACKAGE_URL = "https://www.donneesquebec.ca/recherche/api/3/action/package_show?id=systeme-electronique-dappel-doffres-seao";
export const UNIT = "per contract (award), total awarded value";

/** True for a request that names Quebec (used by serves() in this folder; ca-canadabuys-contracts has the mirror test). */
export function isQuebecArea(area: unknown): boolean {
  const t = String(area ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ["quebec", "qc", "province of quebec", "quebec province", "province de quebec"].includes(t);
}

/** One award, with only the fields we use. */
export interface QcAward {
  id: string;
  title: string;
  /** Award date YYYY-MM-DD. */
  date: string;
  value: number;
  unspsc: string;
  /** Date of the release that carried it (later releases supersede earlier ones). */
  released: string;
}

const UNSPSC_BY_PURCHASE: Record<string, string[]> = {
  laptops: ["43211503"],
  "desktop-computers": ["43211507"],
  tablets: ["43211508"],
};

export function purchaseOf(a: QcAward): string | null {
  if (a.unspsc) {
    for (const [id, prefixes] of Object.entries(UNSPSC_BY_PURCHASE)) if (prefixes.some((p) => a.unspsc.startsWith(p))) return id;
  }
  return matchPurchase(a.title)?.id ?? null;
}

/** Pure: one OCDS release package to awards. Only active awards in CAD with a usable amount and date; buyers, suppliers and addresses are not read. */
export function awardsFromPackage(pkg: any): QcAward[] {
  const out: QcAward[] = [];
  const releases: any[] = Array.isArray(pkg?.releases) ? pkg.releases : [];
  for (const r of releases) {
    const title = String(r?.tender?.title ?? "").replace(/\s+/g, " ").trim();
    if (!title) continue;
    const unspsc = String(r?.tender?.items?.[0]?.classification?.id ?? "").trim();
    const released = String(r?.date ?? "").slice(0, 10);
    for (const a of Array.isArray(r?.awards) ? r.awards : []) {
      if (String(a?.status ?? "active").toLowerCase() !== "active") continue;
      if (String(a?.value?.currency ?? "").toUpperCase() !== "CAD") continue;
      const value = Number(a?.value?.amount);
      if (!Number.isFinite(value) || value < MIN_VALUE) continue;
      const date = String(a?.date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const id = String(a?.id ?? "").trim();
      out.push({ id, title, date, value, unspsc, released });
    }
  }
  return out;
}

export function windowStart(today: string, months = WINDOW_MONTHS): string {
  const d = new Date(today + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate())).toISOString().slice(0, 10);
}

/** Pure: awards to library rows, one per purchase (area ALL), award ids counted once (newest release wins), with the 5-award rule. */
export function aggregate(awards: QcAward[], from: string, to: string): DailyRow[] {
  const latest = new Map<string, QcAward>();
  const anon: QcAward[] = [];
  for (const a of awards) {
    if (!a.id) {
      anon.push(a);
      continue;
    }
    const prev = latest.get(a.id);
    if (!prev || a.released >= prev.released) latest.set(a.id, a);
  }
  const byPurchase = new Map<string, number[]>();
  for (const a of [...latest.values(), ...anon]) {
    if (a.date < from || a.date > to) continue;
    const id = purchaseOf(a);
    if (!id) continue;
    const list = byPurchase.get(id) ?? [];
    list.push(a.value);
    byPurchase.set(id, list);
  }
  const rows: DailyRow[] = [];
  for (const [item, values] of byPurchase) {
    const s = summarise(values);
    if (!s || s.count < 5) continue;
    rows.push({ area: "ALL", item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  }
  return rows.sort((a, b) => a.item.localeCompare(b.item));
}

export interface QcFile { name: string; url: string; start: string; end: string }

/** Pure: the CKAN record to the files to read: monthly files ending inside the window, then weekly files after the last monthly one. */
export function chooseFiles(record: any, from: string): QcFile[] {
  const files: QcFile[] = [];
  for (const r of record?.result?.resources ?? []) {
    const m = String(r?.name ?? "").match(/^(mensuel|hebdo)_(\d{8})_(\d{8})\.json$/);
    if (!m || typeof r.url !== "string" || !r.url.startsWith("https://www.donneesquebec.ca/")) continue;
    const iso = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    files.push({ name: r.name, url: r.url, start: iso(m[2]), end: iso(m[3]) });
  }
  const monthly = files.filter((f) => f.name.startsWith("mensuel_") && f.end >= from);
  const lastMonthly = monthly.reduce((mx, f) => (f.end > mx ? f.end : mx), "");
  const weekly = files.filter((f) => f.name.startsWith("hebdo_") && f.start > lastMonthly && f.end >= from);
  return [...monthly, ...weekly].sort((a, b) => a.start.localeCompare(b.start));
}

async function getJson(url: string, timeoutMs: number): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)" }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err: any) {
    throw new SourceError("Could not reach Données Québec", String(err?.cause?.code ?? err?.message ?? err));
  }
  if (!res.ok) throw new SourceError(`Données Québec returned HTTP ${res.status}`, url, res.status);
  try {
    return JSON.parse(await res.text());
  } catch {
    throw new SourceError("Données Québec returned a file that is not JSON", url);
  }
}

export async function qcContractsHarvest(now: Date = new Date()): Promise<HarvestResult> {
  const to = now.toISOString().slice(0, 10);
  const from = windowStart(to);
  const record = await getJson(PACKAGE_URL, 120000);
  const files = chooseFiles(record, from);
  if (!files.length) throw new SourceError("Données Québec lists no SEAO award files for the window");
  const awards: QcAward[] = [];
  for (const f of files) {
    const pkg = await getJson(f.url, 300000); // one file at a time: the monthly ones are ~68 MB
    for (const a of awardsFromPackage(pkg)) if (a.date >= from && a.date <= to) awards.push(a);
  }
  const rows = aggregate(awards, from, to);
  return { date: to, currency: "CAD", unit: UNIT, rows, note: `Awards dated ${from} to ${to}; ${awards.length} usable award records read from ${files.length} files.` };
}

// ---------- the answer ----------

export interface QcInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  baseUrl?: string;
}

export const SUPPORTED_EXAMPLES = ["laptops", "catering", "road resurfacing", "building cleaning", "electricity", "school meals", "waste collection", "snow removal"];

export async function qcContracts(input: QcInput): Promise<PriceAnswer> {
  if (input.cpv) throw new InputError("Quebec: cpv is not used (notices carry UNSPSC codes that we do not search by). Leave it out and say what was bought in words.");
  const p = matchPurchase(input.what);
  if (!p) {
    throw new InputError(
      `Quebec: "${input.what}" is not one of the purchases we summarise from SEAO. Try a common purchase such as ${SUPPORTED_EXAMPLES.join(", ")} (${PURCHASES.length} purchases are recognised; see the tool description for the wording).`,
    );
  }
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("Quebec contract prices have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const from = windowStart(day.date);
  const row = day.rows.find((r) => r.area === "ALL" && r.item === p.id);
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  return buildAnswer({
    source: INFO,
    query: { country: "CA", buyer_area: "Quebec", what: input.what },
    summary,
    currency: "CAD",
    unit: UNIT,
    period: { from, to: day.date },
    method:
      `SEAO award notices for Quebec public buyers dated ${from} to ${day.date}, recognised by words in the French notice title or the UNSPSC code (${p.label}). Median and 10th–90th percentile of the awarded amount in CAD; ` +
      "each award counted once (the newest notice wins). Totals per contract, not unit prices; suppliers and buyers are never named.",
    describe: (s) =>
      `Quebec public buyers awarded ${p.label} contracts with a median total value of ${fmtMoney(s.median, "CAD")} per contract ` +
      `(typical range ${fmtMoney(s.low, "CAD")} to ${fmtMoney(s.high, "CAD")}, 10th to 90th percentile). These are awarded totals per contract, not unit prices.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "total awarded value per contract (award notice), not a unit price", matched_purchase: p.id, newest_collection: day.date },
  });
}
