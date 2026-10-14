// England: the Department for Education "Childcare and early years provider survey" (SCEYP), published on Explore education
// statistics. Each year (fieldwork May-July) DfE asks a sample of group-based providers, childminders and school-based
// providers what hourly fee they charge parents, and publishes the weighted mean and median hourly "parent-paid fee" by
// age of child and region, by local authority (2 year olds and 3 and 4 year olds) and by provider type (England).
// The release is a zip of CSV files; the daily collector (harvest) reads the newest release once into the price library
// and requests are answered from there. Formats checked live on 2026-10-14 (reporting year 2025, published 11 December 2025):
//  - GET https://content.explore-education-statistics.service.gov.uk/api/releases/<release id>/files is a zip with
//    data/sceyp25_mean_and_median_fee_by_child_age_and_region.csv:
//      time_period,time_identifier,geographic_level,country_code,country_name,region_code,region_name,age_group,mean_hourly_fee,median_hourly_fee,unweighted_base
//      2025,Calendar year,Regional,E92000001,England,E12000007,London,Children aged under 2,8.95,8.5,782
//    data/sceyp25_mean_and_median_fee_by_provider_type.csv:
//      time_period,time_identifier,geographic_level,country_code,country_name,provider_type,child_age,mean_hourly_fee,median_hourly_fee,unweighted_base
//      2025,Calendar year,National,E92000001,England,Childminders,Under 2 years old,6.36,6,"2,708"
//    data/sceyp25_mean_and_median_fee_by_LA.csv:
//      time_period,...,region_code,region_name,old_la_code,new_la_code,la_name,child_age,mean_hourly_fee,median_hourly_fee,unweighted_base,lower_ci,upper_ci
//      2025,Calendar year,Local authority,E92000001,England,E12000002,North West,352,E08000003,Manchester,2 years old,7.45985,7,47,...
//    "unweighted_base" is the number of providers answering ("[u]" marks a base DfE flags as low reliability, e.g. "[u] 18");
//    figures with a base under 10 are not shown. Median is "x" or "[u]" in some years/rows.
//  - the release page (find-statistics/childcare-and-early-years-provider-survey) links to the zip: the release id in that link
//    changes every year (reporting year 2025 = aaf7e46e-0776-43a2-9763-adc29bc04f44), so the collector reads it from the page.
//
// Library rows: area = "<ONS code> <name>" ("E92000001 England", "E12000007 London", "E09000007 Camden"); item = "<age>:<provider>"
// with age under2 | age2 | age3-4 | school (England regions only) and provider all | private | voluntary | nursery-class |
// maintained-nursery | childminder (provider types exist for England as a whole; regions and local authorities are all providers).
// A published figure is stored as median = low = high = the published median hourly fee in pounds, n = the unweighted base
// (number of providers answering), min = the published mean hourly fee and max = 1 when DfE flags the base as low reliability ([u]), else 0.
// The library date is the last day of the survey year (2025-12-31).

import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { readLatestDay } from "../../lib/library/store";
import { unzipAll } from "../../categories/rent/xlsx";
import { cellNumber, csvObjects, fetchText, isUnreliable } from "../../categories/childcare/csv";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const RELEASE_PAGE = "https://explore-education-statistics.service.gov.uk/find-statistics/childcare-and-early-years-provider-survey";
export const CONTENT_API = "https://content.explore-education-statistics.service.gov.uk/api";
/** Reporting year 2025's file id; used only when the release page cannot be read. */
export const FALLBACK_RELEASE_ID = "aaf7e46e-0776-43a2-9763-adc29bc04f44";
const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const INFO: SourceInfo = {
  id: "gb-childcare-fees",
  country: "GB (England)",
  category: "childcare (official provider fee survey)",
  name: "Childcare and early years provider survey (SCEYP)",
  publisher: "Department for Education (England)",
  what_is_recorded:
    "The mean and median hourly fee that childcare providers in England charge parents (the parent-paid fee), by age of child (under 2, 2, 3 and 4, school age), by region, by local authority (2 year olds and 3 and 4 year olds) and by provider type (private and voluntary group-based providers, nursery classes, maintained nursery schools and childminders). From a survey of providers; not adverts. Government-funded hours are not part of the parent-paid fee.",
  price_type: "official_statistic",
  freshness: "Calendar year 2025 (survey fieldwork May to July 2025, published 11 December 2025; next release December 2026)",
  licence: "Open Government Licence v3.0. Explore education statistics says: \"All content is available under the Open Government Licence v3.0, except where otherwise stated\".",
  licence_url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  attribution: "Contains public sector information licensed under the Open Government Licence v3.0. Source: Department for Education, Childcare and early years provider survey 2025.",
  homepage: RELEASE_PAGE,
  limits:
    "England only (Scotland, Wales and Northern Ireland are not covered, so GB here means England). Hourly fees, with no split between full-time and part-time; multiply by the hours booked. Fees are what providers say they charge parents for hours parents pay for, before Tax-Free Childcare and without the government-funded hours many families receive. Provider-type figures exist for England as a whole only; regions have no provider split; local authority figures cover 2 year olds and 3 and 4 year olds only and are based on small samples (some are flagged low reliability). School-age fees are published by region only. Survey estimates carry sampling error.",
};

// ---------- item keys ----------

export const AGE_KEYS = ["under2", "age2", "age3-4", "school"] as const;
export type AgeKey = (typeof AGE_KEYS)[number];

const AGE_FROM_REGION_FILE: Record<string, AgeKey> = {
  "children aged under 2": "under2",
  "two year-old children": "age2",
  "three and four year old preschool children": "age3-4",
  "school age children": "school",
};
const AGE_FROM_PROVIDER_FILE: Record<string, AgeKey> = {
  "under 2 years old": "under2",
  "2 years old": "age2",
  "3 and 4 years old": "age3-4",
};
const PROVIDER_KEY: Record<string, string> = {
  "all providers": "all",
  "private group-based providers": "private",
  "voluntary group-based providers": "voluntary",
  "nursery class childcare settings": "nursery-class",
  "maintained nursery schools": "maintained-nursery",
  childminders: "childminder",
};
export const PROVIDER_LABEL: Record<string, string> = {
  all: "all providers",
  private: "private group-based providers (nurseries and similar)",
  voluntary: "voluntary group-based providers",
  "nursery-class": "nursery class childcare settings in schools",
  "maintained-nursery": "maintained nursery schools",
  childminder: "childminders",
};
const ENGLAND = "E92000001 England";

export interface FeeFiles {
  region: string; // text of ..._by_child_age_and_region.csv
  provider: string; // ..._by_provider_type.csv
  la: string; // ..._by_LA.csv
}

/** Pick the three CSVs out of the release zip, whatever the year prefix (sceyp25_, sceyp26_ ...). */
export function feeFilesFromZip(files: Map<string, Buffer>): FeeFiles {
  const find = (re: RegExp) => {
    for (const [name, buf] of files) if (re.test(name)) return buf.toString("utf8");
    throw new SourceError(`The DfE release zip has no file matching ${re}; the release layout may have changed and this source needs updating.`);
  };
  return {
    region: find(/mean_and_median_fee_by_child_age_and_region\.csv$/i),
    provider: find(/mean_and_median_fee_by_provider_type\.csv$/i),
    la: find(/mean_and_median_fee_by_LA\.csv$/i),
  };
}

function newest(rows: Record<string, string>[]): { year: number; rows: Record<string, string>[] } {
  const year = Math.max(0, ...rows.map((r) => Number(r["time_period"])).filter((n) => Number.isFinite(n)));
  return { year, rows: rows.filter((r) => Number(r["time_period"]) === year) };
}

/** Library rows (without the date) and the survey year, from the three CSVs. */
export function feeRows(files: FeeFiles): { year: number; rows: DailyRow[] } {
  const rows: DailyRow[] = [];
  const add = (area: string, item: string, r: Record<string, string>) => {
    const median = cellNumber(r["median_hourly_fee"]);
    const mean = cellNumber(r["mean_hourly_fee"]);
    const base = cellNumber(r["unweighted_base"]);
    if (median === null || mean === null || base === null || base < 10 || median <= 0) return;
    rows.push({ area, item, n: base, median, low: median, high: median, min: mean, max: isUnreliable(r["unweighted_base"]) ? 1 : 0 });
  };
  const region = newest(csvObjects(files.region));
  for (const r of region.rows) {
    const age = AGE_FROM_REGION_FILE[(r["age_group"] ?? "").toLowerCase()];
    if (!age || !r["region_code"] || !r["region_name"]) continue;
    add(`${r["region_code"]} ${r["region_name"]}`, `${age}:all`, r);
  }
  const provider = newest(csvObjects(files.provider));
  for (const r of provider.rows) {
    const age = AGE_FROM_PROVIDER_FILE[(r["child_age"] ?? "").toLowerCase()];
    const prov = PROVIDER_KEY[(r["provider_type"] ?? "").toLowerCase()];
    if (!age || !prov) continue;
    add(ENGLAND, `${age}:${prov}`, r);
  }
  const la = newest(csvObjects(files.la));
  for (const r of la.rows) {
    const age = AGE_FROM_PROVIDER_FILE[(r["child_age"] ?? "").toLowerCase().replace(/^under 2 years old$/, "under 2 years old")];
    if (!age || !r["new_la_code"] || !r["la_name"]) continue;
    add(`${r["new_la_code"]} ${r["la_name"]}`, `${age}:all`, r);
  }
  if (region.year !== provider.year || region.year !== la.year) {
    throw new SourceError(`The DfE files are for different years (regions ${region.year}, provider types ${provider.year}, local authorities ${la.year}); the release layout may have changed.`);
  }
  const count = (pred: (d: DailyRow) => boolean) => rows.filter(pred).length;
  // The real release has 36 region rows (9 regions x 4 ages), about 18 England rows and about 290 local authority rows.
  if (count((d) => d.area.startsWith("E12")) < 30 || count((d) => d.area === ENGLAND) < 12 || count((d) => /^E0[6-9]/.test(d.area)) < 100) {
    throw new SourceError("Too few fee rows found in the DfE release; the files may have changed and this source needs updating.");
  }
  return { year: region.year, rows };
}

/** The release id in the zip link of the release page, or null. */
export function pickReleaseId(html: string): string | null {
  const m = /api\/releases\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/files/i.exec(html);
  return m ? m[1] : null;
}

async function download(url: string, tries = 3): Promise<Buffer> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA } });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      last = `HTTP ${res.status}`;
    } catch (e: any) {
      last = String(e?.message ?? e);
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, harvestOptions.retryDelayMs * (i + 1)));
  }
  throw new SourceError(`Could not download ${url}: ${last}`);
}

/** Tests set retryDelayMs to 0. */
export const harvestOptions = { retryDelayMs: 2000 };

/** The daily collector: find the newest release's zip, read the three fee tables once. */
export async function gbHarvest(): Promise<HarvestResult> {
  let id = FALLBACK_RELEASE_ID;
  try {
    id = pickReleaseId(await fetchText(RELEASE_PAGE, { headers: { "user-agent": UA } }, 30000)) ?? FALLBACK_RELEASE_ID;
  } catch {
    // keep the known release
  }
  const url = `${CONTENT_API}/releases/${id}/files`;
  const { year, rows } = feeRows(feeFilesFromZip(unzipAll(await download(url))));
  return {
    date: `${year}-12-31`,
    currency: "GBP",
    unit: "per hour",
    rows,
    note: `DfE Childcare and early years provider survey ${year} (release ${id}): published mean and median hourly parent-paid fee by region, local authority and provider type. Figures are published survey estimates; n is the unweighted base (providers answering); min holds the mean fee, max flags low reliability.`,
  };
}

// ---------- answering ----------

const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/,\s*(city|county) of$/, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export interface LibPlace {
  key: string;
  code: string;
  name: string;
  kind: "country" | "region" | "local authority";
}

export function placesOf(rows: { area: string }[]): LibPlace[] {
  const seen = new Set<string>();
  const out: LibPlace[] = [];
  for (const r of rows) {
    if (seen.has(r.area)) continue;
    seen.add(r.area);
    const i = r.area.indexOf(" ");
    if (i < 0) continue;
    const code = r.area.slice(0, i);
    out.push({ key: r.area, code, name: r.area.slice(i + 1), kind: code.startsWith("E92") ? "country" : code.startsWith("E12") ? "region" : "local authority" });
  }
  return out;
}

/** Region first, then local authority (exact, then unique partial). */
export function matchPlace(places: LibPlace[], text: string): LibPlace {
  const q = plain(text);
  if (!q) throw new InputError("Give a place in England: a region (London, North West), a local authority (Manchester, Leeds, Camden) or England.");
  if (/^(england|uk|united kingdom|great britain|gb|national)$/.test(q)) return places.find((p) => p.kind === "country")!;
  const exact = (kind: LibPlace["kind"]) => places.filter((p) => p.kind === kind && plain(p.name) === q);
  for (const kind of ["region", "local authority"] as const) {
    const e = exact(kind);
    if (e.length === 1) return e[0];
  }
  const partial = places.filter((p) => p.kind === "local authority" && (plain(p.name).startsWith(q) || plain(p.name).includes(` ${q}`) || q.includes(plain(p.name))));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new InputError(`Give a more exact place: "${text}" matches ${partial.slice(0, 6).map((p) => p.name).join(", ")}.`);
  throw new InputError(`No fee figure for "${text}" in England. Give a region (London, North West ...), a local authority (Manchester, Leeds, Camden ...) or England. Local authorities with too few responses are not published.`);
}

export interface GbInput {
  area?: string;
  age_group?: string;
  care_type?: string;
  hours?: string;
  baseUrl?: string;
}

const AGE_OF_PARAM: Record<string, AgeKey> = { infant: "under2", toddler: "age2", preschool: "age3-4", "school-age": "school" };
const AGE_LABEL: Record<AgeKey, string> = {
  under2: "children under 2",
  age2: "2 year olds",
  "age3-4": "3 and 4 year olds",
  school: "school-age children",
};

/** Pure: the answer for one place from the library's rows. */
export function gbAnswer(
  lib: { date: string; rows: { area: string; item: string; n: number; median: number; min: number; max: number }[] },
  input: GbInput,
  now = new Date(),
): PriceAnswer {
  const places = placesOf(lib.rows);
  const place = input.area?.trim() ? matchPlace(places, input.area) : places.find((p) => p.kind === "country")!;
  if (!place) throw new SourceError("The price library holds no England fee figures yet.");
  const ageKey: AgeKey = input.age_group ? AGE_OF_PARAM[input.age_group] : "age3-4";
  if (!ageKey) throw new InputError('age_group must be "infant", "toddler", "preschool" or "school-age".');
  if (input.care_type && place.kind !== "country") {
    throw new InputError(`care_type must be left out for ${place.name}: fees by provider type (private nursery, childminder ...) are published for England as a whole only. Leave out area (or use England) to choose care_type, or leave out care_type for ${place.name}.`);
  }
  const provider = input.care_type === "home-based" || input.care_type === "childminder" ? "childminder" : input.care_type === "centre" ? "private" : "all";
  const row = lib.rows.find((r) => r.area === place.key && r.item === `${ageKey}:${provider}`);
  const year = Number(lib.date.slice(0, 4));
  const unreliable = !!row && row.max === 1;
  const notes: string[] = [
    "The hourly fee providers say they charge parents (the parent-paid fee) for hours parents pay for; multiply by the hours booked. Government-funded hours and Tax-Free Childcare are not deducted.",
    "England only.",
  ];
  if (!input.age_group) notes.push("No age_group was given, so the answer is for 3 and 4 year olds (preschool); see by_age_group for the others.");
  if (input.hours) notes.push("hours was ignored: fees are published per hour, with no full-time or part-time split.");
  if (input.care_type === "centre") notes.push("centre is shown as private group-based providers (private nurseries and similar), the largest group of centres; voluntary, school-based and all-provider figures are in by_provider_type.");
  if (unreliable) notes.push("DfE flags this local authority figure as low reliability because few providers answered.");
  const byAge: Record<string, number> = {};
  for (const k of AGE_KEYS) {
    const r = lib.rows.find((x) => x.area === place.key && x.item === `${k}:${provider}`);
    if (r) byAge[AGE_LABEL[k]] = r.median;
  }
  const byProvider: Record<string, number> = {};
  if (place.kind === "country") {
    for (const p of Object.keys(PROVIDER_LABEL)) {
      const r = lib.rows.find((x) => x.area === place.key && x.item === `${ageKey}:${p}`);
      if (r) byProvider[PROVIDER_LABEL[p]] = r.median;
    }
  }
  const where = place.kind === "country" ? "England" : place.name;
  const who = provider === "all" ? "providers" : PROVIDER_LABEL[provider];
  return buildStatisticAnswer({
    source: INFO,
    query: {
      country: "GB",
      area: where,
      age_group: input.age_group ?? "preschool",
      care_type: input.care_type ?? null,
      hours: input.hours ?? null,
    },
    value: row?.median ?? null,
    measure: "median",
    currency: "GBP",
    unit: "per hour",
    period: { from: `${year}-01-01`, to: `${year}-12-31` },
    reference_period: String(year),
    sample_size: row ? row.n : null,
    method:
      "England (Department for Education, Childcare and early years provider survey): the weighted median hourly fee that childcare providers say they charge parents, for the chosen region, local authority or England, age of child and (for England) provider type, from the latest annual survey (fieldwork May to July). We pass on the published median; the sample size is the number of providers answering. Hourly, before government-funded hours.",
    describe: (v) =>
      `The median hourly fee that ${who} in ${where} charge parents for ${AGE_LABEL[ageKey]} was ${fmtMoney(v, "GBP")} an hour in ${year}${row ? ` (mean ${fmtMoney(row.min, "GBP")})` : ""}.`,
    note: notes.join(" "),
    baseUrl: input.baseUrl,
    extra: row
      ? {
          area: { name: where, ons_code: place.code, kind: place.kind },
          age_group: input.age_group ?? "preschool",
          provider_type: provider === "all" ? "all providers" : PROVIDER_LABEL[provider],
          mean_hourly_fee: row.min,
          providers_answering: row.n,
          low_reliability: unreliable,
          by_age_group: byAge,
          ...(place.kind === "country" ? { by_provider_type: byProvider } : {}),
          data_year: year,
          data_age_years: now.getUTCFullYear() - year,
          price_basis: "median hourly parent-paid fee charged by providers, before funded hours and Tax-Free Childcare",
          coverage_note: "England only; Scotland, Wales and Northern Ireland are not covered.",
        }
      : { reason: `DfE publishes no ${AGE_LABEL[ageKey]} fee for ${where}${ageKey === "school" ? " (school-age fees are published by region only)" : ""}${provider !== "all" ? " for this provider type" : ""}.` },
  });
}

export async function gbChildcare(input: GbInput, now = new Date()): Promise<PriceAnswer> {
  const lib = readLatestDay(INFO.id);
  if (!lib) throw new SourceError("Not yet available: the DfE childcare fee figures appear after the next collection (the price library has no data for this source yet).");
  return gbAnswer(lib, input, now);
}
