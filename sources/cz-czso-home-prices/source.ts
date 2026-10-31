// Czechia average purchase prices of flats and family houses (CZK per m2), from the Czech Statistical Office (CZSO / ČSÚ).
// Format checked live on 2026-10-31 through the GitHub probe: plain GET, JSON-stat 2.0, no key, 3.6 KB (fixture.json is that response).
// What CZSO publishes: one figure per year and property type for the whole country, built from cadastre (CUZK) purchase records.
// It is an official annual statistic: no sample size, no range. Answered live (tiny file), no harvest.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError } from "../../lib/http";
import { fetchJsonStat, JsonStatTable } from "../../lib/adapters";
import type { FetchOptions } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";

export const SELECTION_URL = "https://csu.gov.cz/datastat/api/dotaz/data/vybery/uzivatelske/33c89c2e-cd9c-4e2c-afbf-3118becda449?jazyk=en";

export const INFO: SourceInfo = {
  id: "cz-czso-home-prices",
  country: "CZ",
  category: "home-sales (official statistic: average purchase price per square metre)",
  name: "Average purchase prices of real estate (CZSO table CEN04T01), flats and family houses",
  publisher: "Czech Statistical Office (CZSO, Český statistický úřad), from cadastre purchase records of the Czech Office for Surveying, Mapping and Cadastre (ČÚZK)",
  what_is_recorded:
    "For the whole of Czechia and each year, the average purchase price in CZK per square metre of flats and of family houses bought, compiled by CZSO from cadastre records. One published figure per year and type; never individual sales.",
  price_type: "official_statistic",
  freshness: "Annual; the 2025 figures were published on 15 July 2026. Each answer states its year.",
  licence: "Creative Commons Attribution 4.0 International (CC BY 4.0); CZSO requires the licence terms to be mentioned",
  licence_url: "https://csu.gov.cz/conditions_for_use_and_further_dissemination",
  attribution:
    "Source: Czech Statistical Office (CZSO), Average purchase prices of real estate and real estate price indices (CEN04T01), https://csu.gov.cz/prices-of-real-estate, licensed under CC BY 4.0 " +
    "(https://csu.gov.cz/conditions_for_use_and_further_dissemination). Year-on-year changes are calculated by ProofPrice.",
  homepage: "https://csu.gov.cz/prices-of-real-estate",
  limits:
    "One national average per year and property type (flats, family houses); no town, region or postcode, no range and no sample size (CZSO does not publish how many sales stand behind a figure). " +
    "Annual, so it lags: the newest year is the last full calendar year. Prague is far dearer than the national average.",
};

export const KINDS = {
  flat: { code: "7432J02", yoy: "6144J02", label: "flats", singular: "flat" },
  house: { code: "7432J01", yoy: "6144J01", label: "family houses", singular: "family house" },
} as const;
export type Kind = keyof typeof KINDS;

export interface CzPoint { year: string; value: number }
export interface CzReading {
  kind: Kind;
  latest: CzPoint;
  previous: (CzPoint & { change_percent: number }) | null;
  series: CzPoint[];
  published: string | null;
}

const roundTo = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Pick one indicator's yearly series from the parsed table; the newest year with a positive value is the headline. Null if none. */
export function readCz(table: JsonStatTable, kind: Kind): CzReading | null {
  const code = KINDS[kind].code;
  const series = table.rows
    .filter((r) => r.IndicatorType === code && typeof r.value === "number" && Number.isFinite(r.value) && r.value > 0)
    .map((r) => ({ year: String(r.CasR), value: r.value as number }))
    .sort((a, b) => a.year.localeCompare(b.year));
  if (!series.length) return null;
  const latest = series[series.length - 1];
  const prev = series.find((p) => Number(p.year) === Number(latest.year) - 1);
  return {
    kind,
    latest,
    previous: prev ? { ...prev, change_percent: roundTo(((latest.value - prev.value) / prev.value) * 100, 1) } : null,
    series,
    published: table.updated ? table.updated.slice(0, 10) : null,
  };
}

const czk = (v: number) => Math.round(v).toLocaleString("en-US");

export function czAnswer(reading: CzReading | null, other: CzReading | null, q: { kind: Kind; baseUrl?: string; ignoredTown?: string }): PriceAnswer {
  const k = KINDS[q.kind];
  const method =
    "The Czech Statistical Office publishes once a year the average purchase price per square metre of flats and of family houses in Czechia, compiled from cadastre purchase records (table CEN04T01). " +
    "ProofPrice returns the latest published year unchanged, with the change from the year before and the earlier years. It is a national average statistic: no range is calculated and CZSO does not say how many sales are behind it.";
  const base = { source: INFO, query: { country: "CZ", property_type: q.kind }, measure: "average" as const, currency: "CZK", unit: "per m2", method, baseUrl: q.baseUrl };
  if (!reading) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `CZSO holds no average purchase price for ${k.label} in Czechia.` };
  }
  const notes = ["Official national annual average per square metre from cadastre purchase records, not a list of sales and not a price for a particular home."];
  if (q.ignoredTown) notes.push(`CZSO publishes no figure for "${q.ignoredTown}"; this is the national average (Prague is much dearer).`);
  return buildStatisticAnswer({
    ...base,
    value: reading.latest.value,
    period: { from: `${reading.latest.year}-01-01`, to: `${reading.latest.year}-12-31` },
    reference_period: reading.latest.year,
    published: reading.published,
    note: notes.join(" "),
    describe: (v) =>
      `CZSO's average purchase price of ${k.label} in Czechia was ${czk(v)} CZK per square metre in ${reading.latest.year}.` +
      (reading.previous ? ` That is ${Math.abs(reading.previous.change_percent)}% ${reading.previous.change_percent >= 0 ? "higher" : "lower"} than in ${reading.previous.year} (${czk(reading.previous.value)}).` : ""),
    extra: {
      property_type: q.kind,
      reference_period_label: `calendar year ${reading.latest.year}`,
      change_from_previous_year: reading.previous ? { year: reading.previous.year, value: reading.previous.value, change_percent: reading.previous.change_percent } : null,
      yearly_series: reading.series,
      ...(other ? { other_type: { property_type: other.kind, year: other.latest.year, value: other.latest.value, unit: "CZK per m2" } } : {}),
      dataset: { table: "CEN04T01", api_url: SELECTION_URL, updated: reading.published },
    },
  });
}

/** "flat", "house", "any" or empty -> Kind. Any/empty gives flats (the more common purchase). */
export function parseKind(v: string | undefined): { kind: Kind; any: boolean } {
  const s = (v ?? "").trim().toLowerCase();
  if (!s || s === "any" || s === "flat" || s === "flats" || s === "apartment") return { kind: "flat", any: !s || s === "any" };
  if (s === "house" || s === "houses" || s === "family house") return { kind: "house", any: false };
  throw new InputError(`Czechia has average prices for property_type flat or house (or leave out for flats). Not: ${v}.`);
}

export async function czHomePrices(input: { property_type?: string; town?: string; baseUrl?: string }, o: FetchOptions = {}): Promise<PriceAnswer> {
  const { kind } = parseKind(input.property_type);
  const table = await fetchJsonStat(SELECTION_URL, o);
  const reading = readCz(table, kind);
  const otherKind: Kind = kind === "flat" ? "house" : "flat";
  return czAnswer(reading, readCz(table, otherKind), { kind, baseUrl: input.baseUrl, ignoredTown: input.town?.trim() || undefined });
}
