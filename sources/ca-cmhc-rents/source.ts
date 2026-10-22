// Canada: average rents from the CMHC Rental Market Survey, for areas with a population of 10,000 and over, read from Statistics Canada's
// table 34-10-0133-01 through the key-free Web Data Service (WDS). Annual: the survey is taken in October and released in the following months.
// Geography x type of structure x type of unit (bachelor, 1, 2, 3+ bedrooms). One published average per cell, no distribution and no sample size,
// so every answer is an official statistic (measure "average", range fields null). Formats checked live on 2026-10-14 (see fixtures.ts).
// A request is two small WDS calls (table description, then one batch of the four unit sizes), cached in memory; no bulk file.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";
import {
  CubeMember, DataPoint, DataSeries, Poster, changePercent, coordinate, dimension, latestPeriods, loadCubeMeta, memberByName, monthOf,
  monthRange, monthWords, monthsBehind, newestUsable, roundTo, usable, wdsPost,
} from "../_ca-statcan/wds";
import { resolvePlace } from "../_ca-statcan/geo";

export const PRODUCT_ID = 34100133;
export const CMHC_LICENCE_URL = "https://www.cmhc-schl.gc.ca/about-us/terms-conditions/hmip-terms-conditions";
export const PRODUCT_NAME = "Rental Market Survey, average rents for areas with a population of 10,000 and over (Statistics Canada table 34-10-0133-01)";

export const INFO: SourceInfo = {
  id: "ca-cmhc-rents",
  country: "CA (Canada)",
  category: "rent (CMHC Rental Market Survey, average rents)",
  name: "CMHC average rents for areas with a population of 10,000 and over (Statistics Canada table 34-10-0133-01)",
  publisher: "Canada Mortgage and Housing Corporation (CMHC), distributed by Statistics Canada",
  what_is_recorded:
    "The average monthly rent of purpose-built rental units (apartments and rows of three or more units) in each Canadian town and city of 10,000 people or more, by number of bedrooms and type of structure, from CMHC's October Rental Market Survey. " +
    "One published average per area, structure type and unit size per year; never a tenancy or a landlord.",
  price_type: "official_statistic",
  freshness: "Annual: the October survey is released in the months after it (the October 2025 figures were released on 17 December 2025), and every answer states its survey month",
  licence:
    "CMHC licence agreement for the use of data. \"CMHC grants you a revocable worldwide, royalty-free, non-exclusive licence to: use, reproduce, publish, freely distribute, or sell the Information; " +
    "use, reproduce, publish, freely distribute, or sell Value-added Products; and, sub-licence any or all such rights, under terms consistent with this agreement.\" " +
    "Conditions: reproduce the Information accurately, acknowledge the source with the notice set out in the terms, do not suggest CMHC endorses the user, and do not use CMHC's name, crest or logos without written permission. " +
    "Those who receive the Information from us must agree to the same terms.",
  licence_url: CMHC_LICENCE_URL,
  attribution:
    `Source: Canada Mortgage and Housing Corporation (CMHC), ${PRODUCT_NAME} (survey month stated in each answer). This information is reproduced and distributed on an "as is" basis with the permission of CMHC. ` +
    `Adapted from Canada Mortgage and Housing Corporation, ${PRODUCT_NAME}. This does not constitute an endorsement by Canada Mortgage and Housing Corporation of this product.`,
  homepage: "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3410013301",
  limits:
    "Purpose-built rental apartments and rows of three or more units only: not houses, condominium units let out, secondary suites or rooms. Rents are those of units in the surveyed buildings in October (all units, not only new lettings), so they run below the asking rent of a vacant unit. " +
    "One published average per area, unit size and year: no range and no count of units. Cells CMHC cannot publish (too few units or too unreliable) are blank, and then we say so rather than guess. Only areas with 10,000 people or more are covered. " +
    "Annual, so the figure can be up to about two years old by the time the next survey is released.",
};

/** Bedroom count -> the table's "Type of unit" member. */
const UNIT_NAMES: { bedrooms: number; name: string; label: string }[] = [
  { bedrooms: 0, name: "Bachelor units", label: "bachelor (studio)" },
  { bedrooms: 1, name: "One bedroom units", label: "one-bedroom" },
  { bedrooms: 2, name: "Two bedroom units", label: "two-bedroom" },
  { bedrooms: 3, name: "Three bedroom units", label: "three-bedroom (or larger)" },
];
/** CMHC's own headline size when none is asked for. */
export const DEFAULT_BEDROOMS = 2;

const STRUCTURES = {
  any: { name: "Row and apartment structures of three units and over", label: "rows and apartments of three or more units" },
  apartment: { name: "Apartment structures of three units and over", label: "apartment buildings of three or more units" },
} as const;

export interface CaRentInput {
  town?: string;
  postcode?: string;
  property_type?: string;
  house_type?: string;
  bedrooms?: number;
  baseUrl?: string;
}

export function caRentMethod(): string {
  return (
    "Canada rents: the average monthly rent of purpose-built rental units in the area from CMHC's October Rental Market Survey (Statistics Canada table 34-10-0133-01), for the unit size and structure type asked. " +
    "We read the newest survey years through the Web Data Service and pass on the published average and its survey month, with the change on the previous year; no range is calculated. " +
    "It is an average over all units in the surveyed buildings, not a list of rents and not the asking rent of a vacant unit."
  );
}

export interface RentCell {
  bedrooms: number;
  label: string;
  point: (DataPoint & { value: number }) | null;
  previous: { survey: string; value: number } | null;
}

/** The newest usable survey figure of one series and the figure of the survey a year before it. */
export function readCell(s: DataSeries | undefined, bedrooms: number, label: string): RentCell {
  const point = newestUsable(s);
  let previous: RentCell["previous"] = null;
  if (point && s) {
    const wantYear = Number(point.period.slice(0, 4)) - 1;
    const p = s.points.find((x) => Number(x.period.slice(0, 4)) === wantYear);
    if (usable(p)) previous = { survey: monthOf(p.survey), value: p.value };
  }
  return { bedrooms, label, point, previous };
}

const cad = (v: number) => fmtMoney(v, "CAD");

export interface RentQuestion {
  place: CubeMember;
  placeNote?: string;
  structure: keyof typeof STRUCTURES;
  head: RentCell;
  sizeAsked: boolean;
  sizeNote?: string;
  others: RentCell[];
  tableEnd: string | null;
  releaseTime: string | null;
  tableTitle?: string;
  baseUrl?: string;
  today?: Date;
}

export function caRentAnswer(q: RentQuestion): PriceAnswer {
  const st = STRUCTURES[q.structure];
  const query: Record<string, unknown> = {
    country: "CA",
    town: q.place.name,
    property_type: q.structure === "apartment" ? "apartment" : "any",
    bedrooms: q.head.bedrooms,
  };
  const base = { source: INFO, query, measure: "average" as const, currency: "CAD", unit: "per month", method: caRentMethod(), baseUrl: q.baseUrl };

  if (!q.head.point) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const sizes = q.others.filter((o) => o.point).map((o) => o.label);
    return {
      ...none,
      summary:
        `CMHC publishes no recent average rent for ${q.head.label} units in ${st.label} in ${q.place.name} (the figure is left blank when too few units were surveyed or it would be unreliable). ` +
        (sizes.length ? `It does publish: ${sizes.join(", ")}.` : "Try another unit size, another structure type or a nearby larger area."),
      extra: { ...(q.placeNote ? { place_note: q.placeNote } : {}) },
    };
  }

  const p = q.head.point;
  const month = monthOf(p.survey);
  const behind = monthsBehind(month, q.today ?? new Date());
  const yoy = q.head.previous
    ? { survey_month: q.head.previous.survey, value: q.head.previous.value, change_percent: changePercent(p.value, q.head.previous.value), change_amount: roundTo(p.value - q.head.previous.value, 0) }
    : null;
  const notes: string[] = [
    `The average rent of ${q.head.label} units in ${st.label} at CMHC's ${monthWords(month)} survey: an average over all surveyed units, not the asking rent of a vacant unit and not a single rent.`,
  ];
  if (!q.sizeAsked) notes.push(`No unit size was asked for, so this is CMHC's usual headline size, ${q.head.label}; the other sizes are in extra.sizes.`);
  if (q.sizeNote) notes.push(q.sizeNote);
  if (q.tableEnd && p.period.slice(0, 4) < q.tableEnd.slice(0, 4)) notes.push(`CMHC has no newer usable figure for this cell than ${monthWords(month)}.`);
  if (behind >= 18) notes.push(`Old data: the newest figure is from ${monthWords(month)}, ${behind} months ago.`);
  if (p.status === 7) notes.push("CMHC marks this figure E: use with caution.");
  if (q.placeNote) notes.push(q.placeNote);

  const notice =
    `Source: Canada Mortgage and Housing Corporation (CMHC), ${PRODUCT_NAME}, ${monthWords(month)}. This information is reproduced and distributed on an "as is" basis with the permission of CMHC. ` +
    `Adapted from Canada Mortgage and Housing Corporation, ${PRODUCT_NAME}, ${monthWords(month)}. This does not constitute an endorsement by Canada Mortgage and Housing Corporation of this product.`;

  return buildStatisticAnswer({
    ...base,
    value: p.value,
    period: monthRange(month),
    reference_period: month,
    note: notes.join(" "),
    describe: (v) =>
      `The average rent of ${q.head.label} units in ${st.label} in ${q.place.name} was ${cad(v)} a month at CMHC's ${monthWords(month)} survey. ` +
      (yoy
        ? yoy.change_percent === 0
          ? `That is unchanged from the survey a year earlier. `
          : `That is ${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than the survey a year earlier (${cad(yoy.value)} in ${monthWords(yoy.survey_month)}). `
        : "") +
      `This is an average of rents in surveyed buildings, not an asking rent.` +
      (behind >= 18 ? ` Old data: ${behind} months old.` : ""),
    extra: {
      country_name: "Canada",
      place: { name: q.place.name, wds_member_id: q.place.id },
      structure: { name: st.name, label: st.label },
      unit: { bedrooms: q.head.bedrooms, label: q.head.label },
      survey_month: month,
      survey_month_label: monthWords(month),
      change_on_previous_survey: yoy,
      ...(yoy ? {} : { change_on_previous_survey_unavailable: "CMHC published no figure for this cell at the previous year's survey." }),
      sizes: q.others.map((o) => ({
        bedrooms: o.bedrooms,
        label: o.label,
        average_rent_cad_per_month: o.point?.value ?? null,
        survey_month: o.point ? monthOf(o.point.survey) : null,
      })),
      what_this_is: "Average monthly rent of purpose-built rental units in the surveyed buildings in October, from CMHC's Rental Market Survey. Not an asking rent and not a single tenancy.",
      dataset: { name: q.tableTitle ?? "Canada Mortgage and Housing Corporation, average rents for areas with a population of 10,000 and over", table: "34-10-0133-01", url: INFO.homepage, released: p.releaseTime ?? q.releaseTime },
      attribution_notice: notice,
      ...(q.placeNote ? { place_note: q.placeNote } : {}),
    },
  });
}

export async function caRent(input: CaRentInput, post?: Poster, today = new Date()): Promise<PriceAnswer> {
  const asked = (input.town ?? "").trim();
  if (!asked) {
    throw new InputError("Canada: town is required. Give a town or city of 10,000 people or more, for example Toronto, Montréal, Vancouver, Calgary or Ottawa.");
  }
  const pt = input.property_type;
  if (pt === "house" || pt === "room") {
    throw new InputError("Canada: CMHC's survey covers purpose-built rental apartments and rows of three or more units only, not houses or rooms. Use property_type apartment (or leave it out).");
  }
  if (input.bedrooms !== undefined && (!Number.isInteger(input.bedrooms) || input.bedrooms < 0)) throw new InputError("bedrooms must be 0 (bachelor), 1, 2 or 3 (three or more).");

  const meta = await loadCubeMeta(PRODUCT_ID, post);
  const geo = dimension(meta, 1, "Geography");
  const structs = dimension(meta, 2, "Type of structure");
  const units = dimension(meta, 3, "Type of unit");

  const place = resolvePlace(geo.members, asked, "a town or city of 10,000 people or more, for example Toronto, Montréal, Vancouver, Calgary or Ottawa");
  const structure: keyof typeof STRUCTURES = pt === "apartment" ? "apartment" : "any";
  const structId = memberByName(structs, STRUCTURES[structure].name)?.id;
  if (!structId) throw new SourceError(`Statistics Canada changed table 34-10-0133-01 (no structure type "${STRUCTURES[structure].name}"); this source needs updating.`);
  const unitIds = UNIT_NAMES.map((u) => {
    const m = memberByName(units, u.name);
    if (!m) throw new SourceError(`Statistics Canada changed table 34-10-0133-01 (no unit type "${u.name}"); this source needs updating.`);
    return m.id;
  });

  const sizeAsked = input.bedrooms !== undefined;
  const wanted = sizeAsked ? Math.min(input.bedrooms as number, 3) : DEFAULT_BEDROOMS;
  const sizeNote = sizeAsked && (input.bedrooms as number) > 3 ? "CMHC's largest size is three bedrooms or more, so that is what is shown." : undefined;

  const series = await latestPeriods(PRODUCT_ID, unitIds.map((u) => coordinate([place.member.id, structId, u])), 6, post);
  const cells = UNIT_NAMES.map((u, i) => readCell(series[i], u.bedrooms, u.label));
  const head = cells.find((c) => c.bedrooms === wanted)!;
  return caRentAnswer({
    place: place.member, placeNote: place.note, structure, head, sizeAsked, sizeNote, others: cells, tableEnd: meta.endDate,
    releaseTime: meta.releaseTime, tableTitle: meta.title, baseUrl: input.baseUrl, today,
  });
}

// ---------- daily copy (stale-if-error) ----------

const NATIONAL_STRUCTURES = ["any", "apartment"] as const;
/** The library item for one structure type and unit size: plain words, so a stored copy reads on its own. */
export const rentItem = (structure: keyof typeof STRUCTURES, bedrooms: number) =>
  `${STRUCTURES[structure].label}, ${UNIT_NAMES.find((u) => u.bedrooms === bedrooms)!.label}`;

export interface RentSeriesRef {
  place: string;
  structure: keyof typeof STRUCTURES;
  bedrooms: number;
  data: DataSeries | undefined;
}

/** Pure: one library row per area, structure type and unit size for the newest CMHC survey any series has; series that lag behind it are left out.
 *  Each row is one published average: n is NO_COUNT (no unit count is published) and the range fields repeat the figure. */
export function rentHarvestRows(series: RentSeriesRef[]): HarvestResult {
  const latest = series.map((s) => ({ ...s, point: newestUsable(s.data) })).filter((s) => s.point);
  if (!latest.length) throw new SourceError("Statistics Canada table 34-10-0133-01 returned no usable average rent");
  const month = latest.map((s) => monthOf(s.point!.survey)).sort().pop()!;
  const rows = latest
    .filter((s) => monthOf(s.point!.survey) === month)
    .map((s) => ({
      area: s.place,
      item: rentItem(s.structure, s.bedrooms),
      n: NO_COUNT,
      median: s.point!.value,
      low: s.point!.value,
      high: s.point!.value,
      min: s.point!.value,
      max: s.point!.value,
    }));
  return {
    date: monthRange(month).to,
    currency: "CAD",
    unit: "per month",
    rows,
    note: `CMHC Rental Market Survey of ${monthWords(month)} (Statistics Canada table 34-10-0133-01): average monthly rent of purpose-built rental units by area, structure type and unit size. Published averages, not counts of units (no count is published).`,
  };
}

export async function caRentHarvest(post: Poster = wdsPost): Promise<HarvestResult> {
  const meta = await loadCubeMeta(PRODUCT_ID, post);
  const geo = dimension(meta, 1, "Geography");
  const structs = dimension(meta, 2, "Type of structure");
  const units = dimension(meta, 3, "Type of unit");
  const wanted: { place: string; structure: keyof typeof STRUCTURES; bedrooms: number; coord: string }[] = [];
  for (const structure of NATIONAL_STRUCTURES) {
    const sid = memberByName(structs, STRUCTURES[structure].name)?.id;
    if (!sid) throw new SourceError(`Statistics Canada changed table 34-10-0133-01 (no structure type "${STRUCTURES[structure].name}"); this source needs updating.`);
    for (const u of UNIT_NAMES) {
      const uid = memberByName(units, u.name)?.id;
      if (!uid) throw new SourceError(`Statistics Canada changed table 34-10-0133-01 (no unit type "${u.name}"); this source needs updating.`);
      for (const g of geo.members.filter((m) => !m.terminated)) wanted.push({ place: g.name, structure, bedrooms: u.bedrooms, coord: coordinate([g.id, sid, uid]) });
    }
  }
  const got: DataSeries[] = [];
  for (let i = 0; i < wanted.length; i += 50) got.push(...(await latestPeriods(PRODUCT_ID, wanted.slice(i, i + 50).map((w) => w.coord), 2, post)));
  return rentHarvestRows(wanted.map((w, i) => ({ place: w.place, structure: w.structure, bedrooms: w.bedrooms, data: got[i] })));
}

/** Where a request lives in the library, without asking Statistics Canada: places come from the areas of our newest stored day. */
export function rentHistoryKey(
  p: { town?: string; property_type?: string; bedrooms?: number },
  areas: string[],
): { area: string; item: string; label: string } | null {
  if (!p.town || !areas.length) return null;
  if (p.property_type === "house" || p.property_type === "room") return null;
  if (p.bedrooms !== undefined && (!Number.isInteger(p.bedrooms) || p.bedrooms < 0)) return null;
  const members: CubeMember[] = areas.map((name, i) => ({ id: i + 1, name, parent: null, terminated: false }));
  try {
    const place = resolvePlace(members, p.town, "a town or city of 10,000 people or more").member;
    const structure: keyof typeof STRUCTURES = p.property_type === "apartment" ? "apartment" : "any";
    const bedrooms = p.bedrooms !== undefined ? Math.min(p.bedrooms, 3) : DEFAULT_BEDROOMS;
    return { area: place.name, item: rentItem(structure, bedrooms), label: place.name };
  } catch {
    return null;
  }
}
