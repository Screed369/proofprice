// Medicare Physician & Other Practitioners - by Geography and Service (data.cms.gov, key-free data API).
// Formats checked live on 2026-10-14 through the GitHub Probe workflow (see source.test.ts for the fixtures).
//
// One row per HCPCS/CPT code x place of service x geography (the nation or one state):
//   Rndrng_Prvdr_Geo_Lvl "National"|"State", Rndrng_Prvdr_Geo_Cd, Rndrng_Prvdr_Geo_Desc ("National", "Texas"), HCPCS_Cd, HCPCS_Desc, HCPCS_Drug_Ind,
//   Place_Of_Srvc "O" (office / non-facility) | "F" (facility), Tot_Rndrng_Prvdrs, Tot_Benes, Tot_Srvcs, Tot_Bene_Day_Srvcs,
//   Avg_Sbmtd_Chrg (what providers billed: a list price, NEVER presented as a price paid), Avg_Mdcr_Alowd_Amt (the Medicare-allowed amount per service:
//   what Medicare pays plus the patient's deductible and coinsurance plus any third party), Avg_Mdcr_Pymt_Amt (the part Medicare itself pays),
//   Avg_Mdcr_Stdzd_Amt. CMS leaves out records derived from 10 or fewer beneficiaries.
// The answer is an official statistic: the published average Medicare allowed amount, with the number of services behind it.
// CPT(R) descriptions (HCPCS_Desc of numeric codes) are AMA copyright and are never passed on; HCPCS level II descriptions (letter codes) are CMS's own.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";
import { MIN_PUBLISH } from "../../lib/stats";
import { CmsOptions, cmsQuery, count, dataYear, Geo, numOrNull, PHYSICIAN_DATASET, round2, usd } from "../us-cms-medicare/cms";
import { CODE_LABELS, isCpt } from "../us-cms-medicare/services";

export const INFO: SourceInfo = {
  id: "us-cms-physician",
  country: "US",
  category: "doctor and hospital prices (Medicare)",
  name: "Medicare Physician & Other Practitioners - by Geography and Service",
  publisher: "Centers for Medicare & Medicaid Services (CMS)",
  what_is_recorded:
    "For each billing code (HCPCS/CPT), place of service (office or facility), state and the nation, for Medicare fee-for-service Part B: the number of providers, beneficiaries and services, " +
    "the average Medicare allowed amount, the average Medicare payment and the average amount providers billed. Averages only; CMS leaves out anything derived from 10 or fewer beneficiaries.",
  price_type: "official_statistic",
  freshness: "Annual: one calendar year at a time (the 2024 data year was released in 2026); every answer states its data year",
  licence:
    "U.S. Government Works (the licence the Data.gov catalog lists for this dataset; no separate licence is stated on data.cms.gov). " +
    'CPT(R) codes and descriptions in the CMS files are covered by the AMA licence: "CPT codes, descriptions and other data only are copyright 1995 - 2025 American Medical Association." ' +
    'and "CPT is a registered trademark of the American Medical Association (AMA)." (https://www.cms.gov/license/ama). ' +
    "ProofPrice passes on Medicare payment amounts and the code numbers a caller supplies, and writes its own plain labels; it does not copy the CMS/AMA code descriptions.",
  licence_url: "https://www.usa.gov/government-works",
  attribution:
    "Source: Centers for Medicare & Medicaid Services, Medicare Physician & Other Practitioners - by Geography and Service (data.cms.gov). Amounts are what Medicare allowed for services to Medicare fee-for-service patients, passed on as published. " +
    "CPT is a registered trademark of the American Medical Association (AMA); CPT codes and descriptions are copyright AMA.",
  homepage: "https://data.cms.gov/provider-summary-by-type-of-service/medicare-physician-other-practitioners/medicare-physician-other-practitioners-by-geography-and-service",
  limits:
    "What Medicare allowed for its fee-for-service patients (Medicare Advantage is not included): the Medicare-set fee, which is usually lower than private-insurance and cash prices, and is not a quote. " +
    "'Facility' rows (a hospital or surgery centre) are the doctor's professional fee only: the hospital or surgery-centre fee is billed separately and is not included. 'Office' rows cover the whole service. " +
    "Annual data, about 16 months old when released. CMS leaves out services for 10 or fewer beneficiaries, so rare services and small states can be missing. What providers billed is a list price and is never shown as a price paid.",
};

export type Place = "O" | "F";
export type PhysicianSetting = "office" | "facility";
export const PLACE_WORDS: Record<Place, { setting: PhysicianSetting; words: string }> = {
  O: { setting: "office", words: "an office (non-facility) setting" },
  F: { setting: "facility", words: "a facility setting (hospital or surgery centre; the doctor's fee only)" },
};
const PLACE_OF: Record<PhysicianSetting, Place> = { office: "O", facility: "F" };

export interface PhysicianRow {
  geo: string;
  geoCode: string;
  level: string;
  code: string;
  description: string;
  place: Place;
  providers: number | null;
  beneficiaries: number | null;
  services: number;
  allowed: number;
  payment: number | null;
  billed: number | null;
}

/** Rows of the CMS file -> typed rows. A row without a positive allowed amount or a count of services is dropped. */
export function parsePhysicianRows(rows: Record<string, any>[]): PhysicianRow[] {
  const out: PhysicianRow[] = [];
  for (const r of rows) {
    const place = r.Place_Of_Srvc;
    const services = numOrNull(r.Tot_Srvcs);
    const allowed = numOrNull(r.Avg_Mdcr_Alowd_Amt);
    if ((place !== "O" && place !== "F") || services === null || services <= 0 || allowed === null || allowed <= 0) continue;
    out.push({
      geo: String(r.Rndrng_Prvdr_Geo_Desc ?? ""),
      geoCode: String(r.Rndrng_Prvdr_Geo_Cd ?? ""),
      level: String(r.Rndrng_Prvdr_Geo_Lvl ?? ""),
      code: String(r.HCPCS_Cd ?? ""),
      description: String(r.HCPCS_Desc ?? ""),
      place,
      providers: numOrNull(r.Tot_Rndrng_Prvdrs),
      beneficiaries: numOrNull(r.Tot_Benes),
      services,
      allowed,
      payment: numOrNull(r.Avg_Mdcr_Pymt_Amt),
      billed: numOrNull(r.Avg_Sbmtd_Chrg),
    });
  }
  return out;
}

/** All rows of the given codes, for the state asked (or the nation) and for the nation, both settings. */
export async function fetchPhysician(codes: string[], geo: Geo, o: CmsOptions = {}): Promise<PhysicianRow[]> {
  const geos = geo.level === "State" ? [geo.desc, "National"] : ["National"];
  const rows = await cmsQuery(PHYSICIAN_DATASET, [{ field: "HCPCS_Cd", values: codes }, { field: "Rndrng_Prvdr_Geo_Desc", values: geos }], codes.length * 4 + 4, o);
  return parsePhysicianRows(rows);
}

/** ProofPrice's own plain label for a code (never a CMS or AMA description). */
export function labelFor(code: string): string {
  return CODE_LABELS[code] ?? (isCpt(code) ? `service with CPT code ${code}` : `service with HCPCS code ${code}`);
}

export interface SettingChoice {
  place: Place;
  reason: "requested" | "usual" | "most-services";
}

/**
 * The setting to headline for one code in one geography.
 * An explicitly requested setting must exist (else null). A usual setting (the table's default for a plain-words request) is used when it exists,
 * otherwise the setting with more services behind it.
 */
export function chooseSetting(rows: PhysicianRow[], geo: Geo, setting: PhysicianSetting | null, explicit: boolean): SettingChoice | null {
  const mine = rows.filter((r) => r.geo === geo.desc);
  if (!mine.length) return null;
  const has = (p: Place) => mine.some((r) => r.place === p);
  if (setting && explicit) return has(PLACE_OF[setting]) ? { place: PLACE_OF[setting], reason: "requested" } : null;
  if (setting && has(PLACE_OF[setting])) return { place: PLACE_OF[setting], reason: "usual" };
  const best = [...mine].sort((a, b) => b.services - a.services)[0];
  return { place: best.place, reason: "most-services" };
}

export interface PhysicianContext {
  /** The codes of the request, the headline code first. The first one with data in the geography is the headline. */
  codes: string[];
  geo: Geo;
  /** The setting asked for (explicit) or usual for the service (not explicit); null = decide from the data. */
  setting: PhysicianSetting | null;
  explicit: boolean;
  year: number | null;
  /** The plain name of the service group when the request was in words, e.g. "established-patient office visit". */
  group?: string;
  /** The service exactly as the caller wrote it, echoed in the answer's query. */
  requested?: string;
  baseUrl?: string;
}

function yearPeriod(year: number | null): { from: string | null; to: string | null } {
  return year === null ? { from: null, to: null } : { from: `${year}-01-01`, to: `${year}-12-31` };
}

const METHOD =
  "CMS publishes, once a year, the average Medicare-allowed amount for each billing code in each setting (office or facility), state and the nation, for Medicare fee-for-service patients (dataset Medicare Physician & Other Practitioners - by Geography and Service). " +
  "ProofPrice returns the published average for the latest data year, unchanged, with the number of services behind it, the share Medicare itself paid and the national average for comparison. " +
  "No range is calculated: CMS gives one average per code, setting and place. It is what Medicare allowed, not a private-insurance or cash price.";

/** The finished answer for a request in the physician file. Pure. */
export function physicianAnswer(rows: PhysicianRow[], ctx: PhysicianContext): PriceAnswer {
  const first = ctx.codes[0];
  const query = { country: "US", service: ctx.requested ?? ctx.codes.join(","), state: ctx.geo.code, setting: ctx.explicit ? ctx.setting : null };
  const base = {
    source: INFO,
    query,
    measure: "average" as const,
    currency: "USD",
    unit: "per service (Medicare-allowed amount)",
    method: METHOD,
    baseUrl: ctx.baseUrl,
  };
  const yearWords = ctx.year === null ? "the latest data year" : String(ctx.year);
  const empty = (summary: string, status: PriceAnswer["status"]): PriceAnswer => ({
    ...buildStatisticAnswer({ ...base, value: null, period: yearPeriod(ctx.year), reference_period: ctx.year === null ? "latest data year" : String(ctx.year), describe: () => "" }),
    status,
    summary,
  });

  let headline: { code: string; pick: SettingChoice } | null = null;
  for (const code of ctx.codes) {
    const pick = chooseSetting(rows.filter((r) => r.code === code), ctx.geo, ctx.setting, ctx.explicit);
    if (pick) {
      headline = { code, pick };
      break;
    }
  }
  if (!headline) {
    const where = ctx.geo.level === "State" ? ctx.geo.label : "the United States";
    const natl = ctx.geo.level === "State" && rows.some((r) => r.geo === "National");
    return empty(
      `The Medicare physician file has no average for ${labelFor(first)} (code ${first})${ctx.explicit && ctx.setting ? ` in ${ctx.setting === "office" ? "an" : "a"} ${ctx.setting} setting` : ""} in ${where} for ${yearWords}: ` +
        `CMS leaves out services billed for 10 or fewer beneficiaries, and the code may not exist in the file.` +
        (natl ? " A national figure exists: ask again without a state." : ""),
      "no_matches",
    );
  }
  const { code, pick } = headline;
  const label = labelFor(code);
  const mine = rows.filter((r) => r.code === code);
  const row = mine.find((r) => r.geo === ctx.geo.desc && r.place === pick.place)!;
  if (row.services < MIN_PUBLISH) {
    return empty(`Only ${count(row.services)} service(s) behind the Medicare average for ${label} in ${ctx.geo.label}; at least ${MIN_PUBLISH} are needed before we publish a figure.`, "insufficient_data");
  }
  const natl = ctx.geo.level === "State" ? mine.find((r) => r.geo === "National" && r.place === pick.place) ?? null : null;
  const other = mine.find((r) => r.geo === ctx.geo.desc && r.place !== pick.place) ?? null;
  const placeInfo = PLACE_WORDS[pick.place];
  const related = ctx.codes
    .filter((c) => c !== code)
    .flatMap((c) => {
      const r = rows.find((x) => x.code === c && x.geo === ctx.geo.desc && x.place === pick.place);
      return r && r.services >= MIN_PUBLISH ? [{ code: c, service: labelFor(c), average_medicare_allowed_amount: round2(r.allowed), services: Math.round(r.services) }] : [];
    });

  const notes: string[] = [];
  if (pick.place === "F") notes.push("Facility setting: this is the doctor's professional fee only. The hospital or surgery-centre fee is billed separately and is not in this figure.");
  else notes.push("Office setting: the Medicare-allowed amount for the whole service (doctor, staff and equipment).");
  notes.push("This is what Medicare allowed (Medicare's payment plus the patient's deductible and coinsurance), not what private insurance pays or the cash price; private-insurance and cash prices are usually higher.");
  if (pick.reason === "most-services") notes.push(`Both settings can apply to this code; the headline is the ${placeInfo.setting} setting because it has more services behind it.`);
  if (pick.reason === "usual" && other) notes.push(`The other setting (${PLACE_WORDS[other.place].setting}) is shown under other_setting.`);
  if (ctx.setting && !ctx.explicit && pick.reason !== "usual") notes.push(`The usual setting for this service (${ctx.setting}) has no average in the file, so the ${placeInfo.setting} setting is shown.`);
  if (code !== first) notes.push(`There is no average for code ${first} in ${ctx.geo.label}, so the next code in the group (${code}) is shown.`);
  if (ctx.year !== null && new Date().getUTCFullYear() - ctx.year >= 3) notes.push(`The newest data year CMS serves is ${ctx.year}, so these amounts may be out of date.`);

  return buildStatisticAnswer({
    ...base,
    value: row.allowed,
    period: yearPeriod(ctx.year),
    reference_period: ctx.year === null ? "latest data year (not stated by CMS)" : String(ctx.year),
    sample_size: Math.round(row.services),
    note: notes.join(" "),
    describe: (v) =>
      `For ${label} (code ${code}) in ${ctx.geo.label}, Medicare allowed an average of ${usd(v)} per service in ${yearWords} in ${placeInfo.words}, across ${count(row.services)} services.` +
      (row.payment !== null ? ` Medicare itself paid ${usd(row.payment)} of that on average; the patient's share and any other insurer cover the rest.` : "") +
      (natl ? ` The national average is ${usd(natl.allowed)}.` : "") +
      " This is what Medicare allowed, not a private-insurance or cash price.",
    extra: {
      code,
      service: label,
      ...(ctx.group ? { service_group: ctx.group } : {}),
      code_system: isCpt(code) ? "CPT (copyright American Medical Association)" : "HCPCS level II",
      ...(!isCpt(code) && row.description ? { cms_description: row.description } : {}),
      what_it_is: "average Medicare-allowed amount, not a private-insurance or cash price",
      geography: { level: row.level, name: row.geo, code: ctx.geo.code },
      setting: placeInfo.setting,
      average_medicare_allowed_amount: round2(row.allowed),
      average_medicare_payment: row.payment === null ? null : round2(row.payment),
      services: Math.round(row.services),
      beneficiaries: row.beneficiaries,
      providers: row.providers,
      ...(row.billed !== null ? { average_billed_charge_not_a_price_paid: round2(row.billed) } : {}),
      national: natl ? { average_medicare_allowed_amount: round2(natl.allowed), services: Math.round(natl.services) } : null,
      other_setting: other
        ? {
            setting: PLACE_WORDS[other.place].setting,
            average_medicare_allowed_amount: round2(other.allowed),
            services: Math.round(other.services),
            what_it_covers: other.place === "F" ? "the doctor's professional fee only" : "the whole service",
          }
        : null,
      ...(related.length ? { related_codes: related } : {}),
      data_year: ctx.year,
      dataset: { name: INFO.name, id: PHYSICIAN_DATASET, url: INFO.homepage },
      notes,
    },
  });
}

/** Fetch and answer. The data year is looked up beside the rows; if CMS does not say, the answer says so. */
export async function medicarePhysician(input: Omit<PhysicianContext, "year">, o: CmsOptions = {}): Promise<PriceAnswer> {
  const [rows, year] = await Promise.all([fetchPhysician(input.codes, input.geo, o), dataYear(PHYSICIAN_DATASET, o)]);
  return physicianAnswer(rows, { ...input, year });
}
