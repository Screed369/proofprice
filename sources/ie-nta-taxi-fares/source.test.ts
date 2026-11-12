// Tests for the Irish taxi maximum fares. fixtures/si479-schedule.txt is the real text of S.I. No. 479/2024 (Irish Statute Book, fetched 2026-11-12).
// The first test parses the Schedule text and checks the typed table in source.ts says the same; the others check fares worked out from it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError } from "../../lib/http";
import { EXTRAS, INFO, RATES, answerFromTariff, maxFare, parseRate } from "./source";

const TEXT = readFileSync(new URL("./fixtures/si479-schedule.txt", import.meta.url), "utf8").replace(/[|\n]+/g, " ").replace(/\s+/g, " ");

function section(start: string, end: string): string {
  const i = TEXT.indexOf(start);
  const j = TEXT.indexOf(end, i + 1);
  assert.ok(i >= 0 && j > i, `section ${start}`);
  return TEXT.slice(i, j);
}
const c = (v: number) => Math.round(v * 100) / 100;
const eur = (s: string, label: string): number => {
  const m = s.match(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^€]*€\\s?([0-9]+\\.[0-9]+)"));
  assert.ok(m, `no amount after ${label}`);
  return Number(m![1]);
};
const after = (s: string, label: string): number => {
  const m = s.match(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+([0-9,]+(?:\\.[0-9]+)?)"));
  assert.ok(m, `no number after ${label}`);
  return Number(m![1].replace(/,/g, ""));
};

test("licence and type", () => {
  assert.match(INFO.licence, /CC|Creative Commons/);
  assert.equal(INFO.price_type, "posted_price");
  assert.match(TEXT, /come into operation on 01 December 2024/);
});

test("the typed table equals the Schedule text", () => {
  const std = section("Standard Rate:", "Premium Rate:");
  const pre = section("Premium Rate:", "Special Rate for Weekend");
  const spe = section("Special Rate for Weekend", "Extra metered charges");
  for (const [txt, r] of [[std, RATES.standard], [pre, RATES.premium]] as const) {
    assert.equal(eur(txt, "Initial Charge Monetary Value"), r.initial_eur);
    assert.equal(after(txt, "Distance Allowance"), r.initial_m);
    const a = txt.slice(txt.indexOf("Tariff A Monetary Unit"), txt.indexOf("Tariff B Monetary Unit"));
    const b = txt.slice(txt.indexOf("Tariff B Monetary Unit"));
    assert.equal(eur(a, "Monetary Unit"), r.step_eur);
    assert.equal(after(a, "Distance Allowance"), r.a_m);
    assert.equal(eur(a, "Hourly Tariff"), r.hourly_a);
    assert.equal(eur(a, "Tariff per km"), r.tariff_a_per_km);
    assert.equal(after(a, "Maximum Unit Increments on Tariff A"), r.a_max_units);
    assert.equal(after(b, "Distance Allowance"), r.b_m);
    assert.equal(eur(b, "Hourly Tariff"), r.hourly_b);
    assert.equal(eur(b, "Tariff per km"), r.tariff_b_per_km);
  }
  assert.equal(eur(spe, "Initial Charge Monetary Value"), RATES.special.initial_eur);
  const sa = spe.slice(spe.indexOf("Tariff A Monetary Unit"));
  assert.equal(after(sa, "Distance Allowance"), RATES.special.a_m);
  assert.equal(eur(sa, "Tariff per km"), RATES.special.tariff_a_per_km);
  assert.equal(eur(sa, "Hourly Tariff"), RATES.special.hourly_a);
  assert.equal(eur(TEXT, "Booking Fee"), EXTRAS.booking_fee_eur);
  assert.equal(eur(TEXT, "after the first (or, after the first free child, for each additional two children under 12 years of age)"), EXTRAS.additional_passenger_eur);
  assert.match(TEXT, /up to a maximum of €140\.00/);
});

test("fare arithmetic: initial charge, Tariff A steps, change to Tariff B", () => {
  assert.equal(maxFare(RATES.standard, 0), 4.4);
  assert.equal(maxFare(RATES.standard, 0.5), 4.4); // inside the initial 500 m
  assert.equal(maxFare(RATES.standard, 0.6), 4.6); // first step
  // 10 km: 9,500 m after the initial charge / 151.5 m = 62.7 -> 63 steps of EUR 0.20 = 12.60; plus 4.40 = 17.00 (tariff 1.32/km gives 16.94 before rounding up)
  assert.equal(maxFare(RATES.standard, 10), 17);
  // Tariff A runs for 96 steps (EUR 19.20, total 23.60) over 14,544 m after the initial 500 m; then Tariff B at 116.3 m per step
  assert.equal(maxFare(RATES.standard, 15.044), 23.6);
  assert.equal(maxFare(RATES.standard, 25), c(4.4 + 0.2 * (96 + Math.ceil((24500 - 96 * 151.5) / 116.3))));
  assert.equal(maxFare(RATES.premium, 10), c(5.4 + 0.2 * Math.ceil(9500 / 110.5)));
  assert.equal(maxFare(RATES.special, 10), c(5.4 + 0.2 * Math.ceil(9500 / 90.9)));
  // the exact per-km tariff is within one step of the stepped fare for distances inside Tariff A
  for (const km of [2, 5, 8, 12]) {
    const exact = 4.4 + 1.32 * (km - 0.5);
    assert.ok(Math.abs(maxFare(RATES.standard, km) - exact) <= 0.2 + 1e-9, `${km} km`);
  }
});

test("answer: 10 km standard", () => {
  const a = answerFromTariff({ distance_km: 10 });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.value, 17);
  assert.equal(a.price!.min, 4.4);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "posted_price");
  assert.match(a.summary, /maximum/i);
  assert.match(a.source.attribution, /Oireachtas/);
  assert.equal(a.period.from, "2024-12-01");
  assert.equal((a.extra as any).initial_charge_eur, 4.4);
});

test("answer: default distance and premium rate", () => {
  assert.equal(answerFromTariff({}).query.distance_km, 5);
  const a = answerFromTariff({ distance_km: 5, taxi_rate: "Premium" });
  assert.equal(a.price!.value, c(5.4 + 0.2 * Math.ceil(4500 / 110.5)));
  assert.equal(a.query.taxi_rate, "premium");
});

test("input errors say what to give", () => {
  assert.throws(() => answerFromTariff({ distance_km: -1 }), InputError);
  assert.throws(() => answerFromTariff({ distance_km: 900 }), InputError);
  assert.throws(() => answerFromTariff({ distance_km: 5, taxi_rate: "gold" }), (e: any) => e instanceof InputError && /standard/.test(e.message));
  assert.throws(() => answerFromTariff({ fare_type: "student" }), InputError);
  assert.equal(parseRate("rate 2"), "premium");
  assert.equal(parseRate(undefined), "standard");
});
