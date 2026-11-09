// Tests for the London TfL fare source. fixtures/*.json are REAL responses of
// https://api.tfl.gov.uk/StopPoint/940GZZLUKSX/FareTo/<code> downloaded 2026-11-09 (King's Cross to Victoria, Oxford Circus, Heathrow T5).
// Figures below are copied from those files, not computed by the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { INFO, STATIONS, answerFromFares, findStation, parseFares, tflFares } from "./source";

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8"));
const VIC = fx("ksx-vic"), HR5 = fx("ksx-hr5");

test("licence and type", () => {
  assert.equal(INFO.price_type, "posted_price");
  assert.match(INFO.attribution, /TfL Open Data/);
});

test("parses real adult fares", () => {
  const f = parseFares(VIC);
  assert.equal(f.payg.peak, 3.1);
  assert.equal(f.payg.offpeak, 3.0);
  assert.equal(f.cash, 7.0);
  assert.equal(f.start, "2026-11-01");
  assert.equal(f.end, "2027-11-01");
  assert.match(f.to, /Victoria/);
  const h = parseFares(HR5);
  assert.equal(h.payg.anytime, 5.9);
  assert.equal(h.payg.peak, undefined);
});

test("empty or odd responses", () => {
  assert.throws(() => parseFares([]), InputError);
  assert.throws(() => parseFares([{ rows: [{ passengerType: "Child", ticketsAvailable: [] }] }]), SourceError);
});

test("answers: peak, off-peak, cash, all-day fare", () => {
  const f = parseFares(VIC);
  const a = answerFromFares(f, {});
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "GBP");
  assert.equal(a.price!.value, 3.1);
  assert.equal(a.sample_size, null);
  assert.equal(answerFromFares(f, { time_of_day: "off-peak" }).price!.value, 3.0);
  assert.equal(answerFromFares(f, { ticket: "cash" }).price!.value, 7.0);
  assert.equal(answerFromFares(parseFares(HR5), { time_of_day: "off-peak" }).price!.value, 5.9);
  assert.throws(() => answerFromFares(f, { ticket: "bus" }), InputError);
  assert.throws(() => answerFromFares(f, { time_of_day: "night" }), InputError);
});

test("station names", () => {
  assert.equal(findStation("King's Cross", "x").code, "940GZZLUKSX");
  assert.equal(findStation("kings cross st pancras station", "x").code, "940GZZLUKSX");
  assert.equal(findStation("Heathrow", "x").code, "940GZZLUHR5");
  assert.equal(findStation("oxford circus underground station", "x").code, "940GZZLUOXC");
  assert.throws(() => findStation("Atlantis", "from_station"), InputError);
  assert.throws(() => findStation("Bond", "from_station"), (e: any) => e instanceof InputError && /Bond Street/.test(e.message));
  assert.equal(Object.keys(STATIONS).length, 20);
});

test("tflFares end to end with an injected loader", async () => {
  let asked = "";
  const a = await tflFares({ from_station: "King's Cross", to_station: "Victoria" }, async (u) => { asked = u; return VIC; });
  assert.equal(asked, "https://api.tfl.gov.uk/StopPoint/940GZZLUKSX/FareTo/940GZZLUVIC");
  assert.equal(a.price!.value, 3.1);
  await assert.rejects(tflFares({}), InputError);
  await assert.rejects(tflFares({ from_station: "Bank", to_station: "bank" }, async () => VIC), InputError);
  await assert.rejects(tflFares({ from_station: "Bank", to_station: "Victoria", fare_type: "child" }, async () => VIC), InputError);
});
