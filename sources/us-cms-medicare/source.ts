// Doctor and hospital prices in the US: what Medicare paid, from two CMS files on data.cms.gov.
//  - sources/us-cms-physician  Medicare Physician & Other Practitioners - by Geography and Service (office and facility services, by billing code)
//  - sources/us-cms-inpatient  Medicare Inpatient Hospitals - by Geography and Service (hospital stays, by MS-DRG)
// The registry allows one registered source per category and country, so this folder is the registered source ("us-cms-medicare"): it reads the
// request (plain words, a billing code or an MS-DRG), picks the right CMS file and hands over to the two modules above, which own the fetching,
// parsing and answers. Both modules are plain TypeScript folders without a manifest on purpose.
//
// Every figure is what Medicare allowed or paid for its fee-for-service patients: never a private-insurance or cash price.

import type { PriceAnswer } from "../../lib/answer";
import { InputError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import { MIN_PUBLISH } from "../../lib/stats";
import { INFO as INPATIENT_INFO, medicareInpatient, searchDrgTitles } from "../us-cms-inpatient/source";
import { fetchPhysician, INFO as PHYSICIAN_INFO, medicarePhysician, PhysicianSetting } from "../us-cms-physician/source";
import { CmsOptions, parseGeo, round2, usd } from "./cms";
import { ResolvedService, resolveService, Setting, tokens } from "./services";

export const INFO: SourceInfo = {
  id: "us-cms-medicare",
  country: "US",
  category: "doctor and hospital prices (what Medicare paid)",
  name: "Medicare payments by service and state (CMS: Physician & Other Practitioners; Inpatient Hospitals)",
  publisher: "Centers for Medicare & Medicaid Services (CMS)",
  what_is_recorded:
    "Two CMS files, by state and for the nation: doctors' and other practitioners' services by billing code, in an office or a facility (average Medicare allowed amount per service), " +
    "and hospital stays by MS-DRG (average total payment per stay). Averages only, with the number of services or discharges behind them; CMS leaves out anything derived from 10 or fewer beneficiaries.",
  price_type: "official_statistic",
  freshness: "Annual: one calendar year at a time (the 2024 data year was released in 2026); every answer states its data year",
  licence:
    "U.S. Government Works (the licence the Data.gov catalog lists for both datasets; no separate licence is stated on data.cms.gov). " +
    'CPT(R) codes and descriptions in the physician file are covered by the AMA licence: "CPT codes, descriptions and other data only are copyright 1995 - 2025 American Medical Association." ' +
    'and "CPT is a registered trademark of the American Medical Association (AMA)." (https://www.cms.gov/license/ama). ' +
    "ProofPrice passes on Medicare payment amounts and the code numbers a caller supplies, and writes its own plain labels; it does not copy the CMS/AMA code descriptions. " +
    "MS-DRG codes and titles in the inpatient file are the Medicare payment classification published by CMS (not AMA CPT).",
  licence_url: PHYSICIAN_INFO.licence_url,
  attribution:
    "Source: Centers for Medicare & Medicaid Services, Medicare Physician & Other Practitioners - by Geography and Service, and Medicare Inpatient Hospitals - by Geography and Service (data.cms.gov). " +
    "Amounts are what Medicare allowed or paid for fee-for-service patients, passed on as published. CPT is a registered trademark of the American Medical Association (AMA); CPT codes and descriptions are copyright AMA.",
  homepage: PHYSICIAN_INFO.homepage,
  limits:
    "What Medicare allowed or paid (Medicare Advantage is not included): Medicare-set rates, which are usually lower than private-insurance and cash prices, and not a quote. " +
    "Doctor's 'facility' figures are the doctor's fee only; the hospital's or surgery centre's fee is separate. Hospital-stay figures are the hospital's total payment and exclude the surgeon's fee. " +
    "Annual data, about 16 months old when released. CMS leaves out services and stays with 10 or fewer beneficiaries, so rare services and small states can be missing. What providers billed is a list price and is never shown as a price paid.",
};

export const SETTING_HELP = "office (a doctor's office or other non-facility), facility (a hospital outpatient department or surgery centre: the doctor's fee only) or inpatient (a hospital stay)";

/** "Office", "non-facility", "hospital stay", "outpatient" ... -> one of the three settings; null when empty. Throws InputError otherwise. */
export function normaliseSetting(raw: string | undefined): Setting | null {
  const s = (raw ?? "").trim().toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (!s) return null;
  if (/^(office|offices|non ?facility|nonfacility|clinic|doctors? office|physicians? office|doctor s office)$/.test(s)) return "office";
  if (/^(facility|outpatient|hospital outpatient|surgery cent(er|re)|surgical cent(er|re)|asc|ambulatory surgery cent(er|re))$/.test(s)) return "facility";
  if (/^(inpatient|in patient|hospital stay|hospital admission|admission|stay|hospitali[sz]ation)$/.test(s)) return "inpatient";
  throw new InputError(`setting must be ${SETTING_HELP}, or left out. Not recognised: ${raw}.`);
}

/** The plain-words table first; then, for words it does not know, a search of the MS-DRG titles in the inpatient file. */
export async function resolveRequest(raw: string | undefined, o: CmsOptions = {}): Promise<{ resolved: ResolvedService; searched: string | null }> {
  try {
    return { resolved: resolveService(raw), searched: null };
  } catch (e) {
    const text = (raw ?? "").trim();
    const words = tokens(text);
    // A single code-like token that was not understood is a typo, not words to search for.
    if (!(e instanceof InputError) || !words.length || (words.length === 1 && /\d/.test(words[0]))) throw e;
    const hits = await searchDrgTitles(words, o);
    if (!hits.length) throw e;
    const head = hits[0];
    const baseOf = (t: string) => t.replace(/\s+(WITH|WITHOUT)\s+.*$/i, "").trim();
    const drgs = [head.drg, ...hits.filter((h) => h.drg !== head.drg && baseOf(h.title) === baseOf(head.title)).map((h) => h.drg)].slice(0, 5);
    return { resolved: { input: text, how: "words", entry: null, codes: [], drgs, setting: "inpatient", label: `MS-DRG ${head.drg}` }, searched: text };
  }
}

function addNote(answer: PriceAnswer, note: string): PriceAnswer {
  const extra = { ...(answer.extra ?? {}) } as Record<string, unknown>;
  extra.notes = [...(Array.isArray(extra.notes) ? (extra.notes as string[]) : []), note];
  const statistic = answer.statistic ? { ...answer.statistic, note: [answer.statistic.note, note].filter(Boolean).join(" ") } : answer.statistic;
  return { ...answer, extra, ...(statistic ? { statistic } : {}) };
}

/** Best effort: what Medicare allowed the surgeon for a procedure whose hospital stay is the headline. Never fails the answer. */
async function surgeonsFee(codes: string[], state: ReturnType<typeof parseGeo>, o: CmsOptions): Promise<{ code: string; average: number; services: number } | null> {
  try {
    const code = codes[0];
    const rows = await fetchPhysician([code], state, o);
    const row = rows.find((r) => r.geo === state.desc && r.place === "F" && r.services >= MIN_PUBLISH);
    return row ? { code, average: row.allowed, services: Math.round(row.services) } : null;
  } catch {
    return null;
  }
}

export interface MedicalInput {
  service?: string;
  state?: string;
  setting?: string;
  baseUrl?: string;
}

/** One request -> the right CMS file -> one answer. Throws InputError for requests that cannot be understood. */
export async function medicalPrices(input: MedicalInput, o: CmsOptions = {}): Promise<PriceAnswer> {
  const geo = parseGeo(input.state, (m) => new InputError(m));
  const wanted = normaliseSetting(input.setting);
  const { resolved: r, searched } = await resolveRequest(input.service, o);

  let kind: "inpatient" | "physician";
  if (wanted === "inpatient") {
    if (!r.drgs.length) {
      throw new InputError(
        `setting=inpatient needs a hospital stay (an MS-DRG such as 'DRG 470', or a service like 'knee replacement' or 'pneumonia'); ${r.label} is a doctor's service billed in an office or a facility. Use setting=office or facility, or leave setting out.`,
      );
    }
    kind = "inpatient";
  } else if (wanted === "office" || wanted === "facility") {
    if (!r.codes.length) {
      throw new InputError(
        `setting=${wanted} needs a doctor's service (a billing code such as 99213, or a service like 'office visit'); ${r.label} is a hospital stay. Use setting=inpatient, or leave setting out.`,
      );
    }
    kind = "physician";
  } else {
    kind = r.setting === "inpatient" || !r.codes.length ? "inpatient" : "physician";
  }

  if (kind === "inpatient") {
    let answer = await medicareInpatient(
      { drgs: r.drgs, geo, label: r.entry?.label ?? null, requested: input.service?.trim(), settingAsked: wanted === "inpatient", baseUrl: input.baseUrl },
      o,
    );
    if (searched) {
      answer = addNote(answer, `Matched by searching the MS-DRG hospital-stay titles for '${searched}'; check that the group shown is the one you mean (the title is in extra.drg_title).`);
    }
    if (answer.status === "ok" && r.entry?.codes?.length) {
      const fee = await surgeonsFee(r.entry.codes, geo, o);
      if (fee) {
        answer = addNote(answer, `The surgeon's fee is billed separately: for code ${fee.code} Medicare allowed an average of ${usd(fee.average)} in a facility setting (${fee.services.toLocaleString("en-US")} services). Ask again with setting=facility for that figure.`);
        answer = { ...answer, extra: { ...answer.extra, surgeons_fee_billed_separately: { code: fee.code, setting: "facility", average_medicare_allowed_amount: round2(fee.average), services: fee.services } } };
      }
    }
    return answer;
  }

  const usual: PhysicianSetting | null = r.setting === "office" || r.setting === "facility" ? r.setting : null;
  let answer = await medicarePhysician(
    { codes: r.codes, geo, setting: wanted === "office" || wanted === "facility" ? wanted : usual, explicit: wanted !== null, group: r.entry?.label, requested: input.service?.trim(), baseUrl: input.baseUrl },
    o,
  );
  if (answer.status === "ok" && r.drgs.length && wanted !== null) {
    answer = addNote(answer, "This is the doctor's fee. The hospital's own payment for the stay is available with setting=inpatient.");
  }
  return answer;
}
