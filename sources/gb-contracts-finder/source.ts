// UK government contract prices from Contracts Finder (Crown Commercial Service / Cabinet Office), awarded-contract notices.
// API facts (from the Contracts Finder API documentation, Notices v2, read 2026-10-14; behaviour checked on a preview deployment):
//   POST https://www.contractsfinder.service.gov.uk/api/rest/2/search_notices/json   key-free, body { searchCriteria: {...}, size }
//   searchCriteria: types ["Contract"], statuses ["Awarded"], keyword, regions "A,B", cpvCodes [...], awardedFrom, awardedTo, publishedFrom, publishedTo
//   response: { hitCount, maxHits, noticeList: [ { score, item: { id, parentId, title, awardedValue, awardedDate, cpvCodes, region, isSubNotice, noticeStatus, ... } } ] }
// Behaviour seen on 2026-10-14: size up to 1000; several keyword words mean "any of them" (a quoted phrase means the phrase); an unknown region name is
// silently ignored (so only the names below are sent); a cpvCodes filter also matches notices that carry a parent code (45000000 for 45233142), so
// notices are checked against their own cpvCodes field afterwards.
// The OCDS search (GET /Published/Notices/OCDS/Search) has no keyword filter, so this v2 search is used instead.
import { fetchJson, InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import type { PriceAnswer } from "../../lib/answer";
import { contractAnswer } from "../../categories/contracts/answer";
import { cleanCpv, cpvInGroups, cpvStem, matchPurchase, monthsWindow, normaliseText, sliceWindow } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "gb-contracts-finder",
  country: "GB (United Kingdom)",
  category: "government contracts (awarded contracts)",
  name: "Contracts Finder: awarded contract notices",
  publisher: "Crown Commercial Service and Cabinet Office (Contracts Finder, GOV.UK)",
  what_is_recorded:
    "Notices of awarded public contracts published on Contracts Finder by UK public buyers: title, description, CPV codes, region, award date and the awarded value.",
  price_type: "contract_price",
  freshness: "Continuous: buyers publish award notices after a contract is awarded",
  licence:
    "Open Government Licence v3.0. Contracts Finder states: 'All content is available under the Open Government Licence v3.0 except where otherwise stated.' " +
    "Its OCDS data packages carry the licence URL http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/.",
  licence_url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  attribution:
    "Contains public sector information licensed under the Open Government Licence v3.0. Source: Contracts Finder (Crown Commercial Service / Cabinet Office). Figures are ProofPrice aggregates of the published award notices.",
  homepage: "https://www.contractsfinder.service.gov.uk/",
  limits:
    "Contracts Finder awards only (central government above £12,000, wider public sector above £30,000, plus voluntary notices); some above-threshold awards appear only on Find a Tender and are not included. " +
    "The awarded value is the contract's total value as the buyer stated it, often over several years and sometimes a framework ceiling, not a unit price. " +
    "Search is by keyword over the notice text, so some matches are loosely related; up to 1,000 notices are read per period slice. A region filter also keeps nationwide contracts that list the region among several. Aggregates only; suppliers are never named.",
};

export const SEARCH_URL = "https://www.contractsfinder.service.gov.uk/api/rest/2/search_notices/json";
export const PER_SLICE = 1000;
/** Awarded values below this are placeholders (0.01 appears often), not contract prices. */
export const MIN_VALUE = 100;

/** What a person may type -> the region name the search accepts (an unknown name would be ignored silently, so nothing else is sent). */
export const REGIONS: Record<string, string> = {
  "east midlands": "East Midlands",
  "east of england": "East of England",
  "east": "East of England",
  "london": "London",
  "north east": "North East",
  "north west": "North West",
  "south east": "South East",
  "south west": "South West",
  "west midlands": "West Midlands",
  "yorkshire and the humber": "Yorkshire and The Humber",
  "yorkshire and humber": "Yorkshire and The Humber",
  "yorkshire": "Yorkshire and The Humber",
  "scotland": "Scotland",
  "wales": "Wales",
  "northern ireland": "Northern Ireland",
};

export const REGION_NAMES = [...new Set(Object.values(REGIONS))];

export function regionName(raw: string): string | null {
  return REGIONS[normaliseText(raw)] ?? null;
}

export interface GbAward {
  id: string;
  parentId: string;
  value: number;
  date: string; // YYYY-MM-DD
  region: string;
}

/**
 * Pure parser for a search response. Parent notices whose lots are also listed are dropped so a contract is not counted twice.
 * With `stems` (CPV groups), only notices whose own cpvCodes belong to one of the groups are kept: the search also returns notices that merely carry a parent code.
 */
export function parseNotices(json: any, stems?: string[]): { awards: GbAward[]; hitCount: number; other_product: number } {
  if (!Array.isArray(json?.noticeList)) throw new SourceError("Unexpected response from Contracts Finder");
  const items = json.noticeList.map((x: any) => x?.item).filter(Boolean);
  const parents = new Set<string>(items.map((i: any) => String(i.parentId ?? "")).filter(Boolean));
  const awards: GbAward[] = [];
  const seen = new Set<string>();
  let otherProduct = 0;
  for (const i of items) {
    const id = String(i.id ?? "");
    if (id && (seen.has(id) || parents.has(id))) continue;
    if (id) seen.add(id);
    if (stems && stems.length) {
      const own = String(i.cpvCodes ?? "").split(/[\s,]+/).filter(Boolean);
      if (!own.some((c) => cpvInGroups(c, stems))) {
        otherProduct++;
        continue;
      }
    }
    const value = Number(i.awardedValue);
    if (!Number.isFinite(value) || value < MIN_VALUE) continue;
    awards.push({
      id,
      parentId: String(i.parentId ?? ""),
      value,
      date: String(i.awardedDate ?? i.publishedDate ?? "").slice(0, 10),
      region: String(i.region ?? ""),
    });
  }
  return { awards, hitCount: Number(json.hitCount ?? items.length), other_product: otherProduct };
}

export interface GbCriteria {
  keyword?: string;
  cpv?: string;
  region?: string;
}

/** A search keyword: several words are sent as a quoted phrase, because unquoted words mean "any of them". */
export function keywordFor(text: string): string {
  const t = text.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
  return t.includes(" ") ? `"${t}"` : t;
}

export function buildRequest(c: GbCriteria, slice: { from: string; to: string }, size: number): Record<string, unknown> {
  const searchCriteria: Record<string, unknown> = {
    types: ["Contract"],
    statuses: ["Awarded"],
    awardedFrom: `${slice.from}T00:00:00`,
    awardedTo: `${slice.to}T23:59:59`,
  };
  if (c.cpv) searchCriteria.cpvCodes = [c.cpv];
  else if (c.keyword) searchCriteria.keyword = c.keyword;
  if (c.region) searchCriteria.regions = c.region;
  return { searchCriteria, size };
}


async function search(c: GbCriteria, slice: { from: string; to: string }, stems?: string[]): Promise<{ awards: GbAward[]; hitCount: number; other_product: number }> {
  const json = await fetchJson(
    SEARCH_URL,
    { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(buildRequest(c, slice, PER_SLICE)) },
    25000,
  );
  return parseNotices(json, stems);
}

async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export interface GbInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  months: number;
  baseUrl?: string;
}

export async function gbContracts(input: GbInput): Promise<PriceAnswer> {
  const win = monthsWindow(input.months);
  const c: GbCriteria = {};
  let stems: string[] | undefined;
  let label = input.what;
  let how: string;
  if (input.cpv) {
    const code = cleanCpv(input.cpv);
    if (!code || code.length !== 8) throw new InputError("For GB, cpv must be a full 8-digit CPV code such as 45233142.");
    c.cpv = code;
    stems = [cpvStem(code)];
    how = `CPV code ${code} (notices that list it among their own codes)`;
  } else {
    const p = matchPurchase(input.what);
    c.keyword = keywordFor(p ? p.gb ?? p.keyword : input.what);
    if (p) label = p.label;
    const isPhrase = c.keyword.startsWith('"');
    how = `the ${isPhrase ? "phrase" : "keyword"} ${isPhrase ? c.keyword : `"${c.keyword}"`} in the notice text`;
  }
  let where = "the UK";
  if (input.buyer_area) {
    const r = regionName(input.buyer_area);
    if (!r) throw new InputError(`For GB, buyer_area must be a region: ${REGION_NAMES.join(", ")}.`);
    c.region = r;
    where = `the UK (${r})`;
  }
  // One request for the whole window; if there are more notices than one request returns, read the window in slices.
  const whole = await search(c, win, stems);
  let awards = whole.awards;
  let slices = 1;
  let capped = false;
  if (whole.hitCount > PER_SLICE) {
    const parts = sliceWindow(win.from, win.to, Math.min(input.months, 12));
    const results = await inBatches(parts, 6, (s) => search(c, s, stems));
    const seen = new Set<string>();
    awards = [];
    for (const r of results) {
      for (const a of r.awards) {
        if (a.id && seen.has(a.id)) continue;
        if (a.id) seen.add(a.id);
        awards.push(a);
      }
    }
    slices = parts.length;
    capped = results.some((r) => r.hitCount > PER_SLICE);
  }
  const dates = awards.map((a) => a.date).filter(Boolean).sort();
  const notes: string[] = [];
  if (capped) notes.push(`${whole.hitCount} matching awards exist; up to ${PER_SLICE} per period slice were read.`);
  notes.push(`Each value is the total the buyer stated at award, often covering several years of supply and sometimes a framework ceiling; values under ${MIN_VALUE} pounds are left out as placeholders.`);
  if (c.region) notes.push(`The region filter also keeps nationwide contracts that list ${c.region} among several regions.`);
  return contractAnswer({
    source: INFO,
    query: { country: "GB", what: input.what, ...(input.cpv ? { cpv: input.cpv } : {}), ...(input.buyer_area ? { buyer_area: input.buyer_area } : {}), months: input.months },
    values: awards.map((a) => a.value),
    currency: "GBP",
    what: label,
    where,
    period: { from: win.from, to: win.to },
    newest: dates.length ? dates[dates.length - 1] : null,
    method:
      `Awarded-contract notices on Contracts Finder with an award date between ${win.from} and ${win.to}, found by ${how}` +
      (c.region ? ` in the region ${c.region}` : "") +
      `. Each notice's awarded value is one contract (parent notices whose lots are listed are not counted twice). Median and 10th–90th percentile in GBP; never supplier names. Totals per contract, not unit prices.`,
    notes,
    baseUrl: input.baseUrl,
    extra: { matched_filter: how, notices_matching: whole.hitCount, awards_used: awards.length, slices },
  });
}
