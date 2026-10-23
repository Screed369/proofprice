import { test } from "node:test";
import assert from "node:assert/strict";
import { OFGEM_FRAGMENT } from "./fixtures";
import { capAnswer, htmlToText, ofgemCap, parseCapPage } from "./source";

// Fixture: real HTML copied from the Ofgem page on 2026-10-23.
const page = () => parseCapPage(OFGEM_FRAGMENT);
const close = (a: number | null | undefined, b: number, digits = 4) => assert.ok(typeof a === "number" && Math.abs(a - b) < 10 ** -digits, `${a} is not close to ${b}`);

test("Ofgem page: reads the heading, both columns and both fuels", () => {
  const p = page();
  assert.deepEqual(p.period, { label: "1 October to 31 December 2026", from: "2026-10-01", to: "2026-12-31" });
  assert.equal(p.previous_period?.from, "2026-07-01");
  assert.deepEqual(p.electricity, { unit: 26.32, standing: 54.83, previous: { unit: 26.11, standing: 57.19 } });
  assert.deepEqual(p.gas, { unit: 7.97, standing: 29.68, previous: { unit: 7.33, standing: 29.04 } });
  assert.equal(p.annual_typical_gbp, 1723);
  assert.equal(p.not_comparable, true);
  assert.match(p.vat_note ?? "", /5% VAT on gas/);
});

test("Ofgem page: works when the page shows only the current period", () => {
  const one = OFGEM_FRAGMENT
    .replace(/<th>\s*<p>Energy price cap per unit and standing charge&nbsp;<\/p>\s*<p>1 July to 30 September 2026&nbsp;<\/p>\s*<\/th>/, "")
    .replace(/<td>\s*<p>26\.11[\s\S]*?<\/td>/, "")
    .replace(/<td>\s*<p>7\.33[\s\S]*?<\/td>/, "");
  const p = parseCapPage(one);
  assert.equal(p.electricity.unit, 26.32);
  assert.equal(p.electricity.previous, null);
  assert.equal(p.previous_period, null);
});

test("Ofgem page: refuses a page whose table and heading disagree", () => {
  const bad = OFGEM_FRAGMENT.replace("Energy price cap from 1 October to 31 December 2026</h2>", "Energy price cap from 1 January to 31 March 2027</h2>");
  assert.notEqual(bad, OFGEM_FRAGMENT);
  assert.throws(() => parseCapPage(bad), /needs updating/);
});

test("Ofgem page: refuses an absurd figure", () => {
  assert.throws(() => parseCapPage(OFGEM_FRAGMENT.replace("26.32", "2632")), /look wrong|no Electricity row/);
});

test("htmlToText: turns tags and entities into plain text", () => {
  assert.equal(htmlToText("<p>a&nbsp;b</p><script>x()</script>"), "a b");
});

test("electricity: unit rate in pounds per kWh, labelled a posted cap, no sample size", () => {
  const a = capAnswer(page(), { energy: "electricity" });
  assert.equal(a.status, "ok");
  close(a.price?.value, 0.2632);
  assert.equal(a.price?.currency, "GBP");
  assert.equal(a.price?.unit, "per kWh");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.sample_size, null);
  assert.match(a.summary, /26\.32 pence per kWh/);
  assert.match(a.summary, /54\.83 pence a day/);
  assert.match(a.summary, /not what each household was recorded paying/);
  assert.equal((a.extra as any).standing_charge_pence_per_day, 54.83);
  assert.match(a.source.licence, /Open Government Licence/);
});

test("gas: previous cap and change", () => {
  const a = capAnswer(page(), { energy: "gas" });
  close(a.price?.value, 0.0797);
  assert.match(a.summary, /previous cap was 7\.33 pence/);
  close((a.extra as any).previous_period.change_percent, 8.7, 1);
});

test("electricity: says the change is not like for like and leaves it out of the summary", () => {
  const a = capAnswer(page(), { energy: "electricity" });
  assert.doesNotMatch(a.summary, /previous cap was/);
  assert.match(JSON.stringify(a), /not like for like/);
});

test("request: aliases, taxes and consumption_band", async () => {
  const load = async () => page();
  close((await ofgemCap({ energy: "Mains gas" }, load)).price?.value, 0.0797);
  await assert.rejects(ofgemCap({ energy: "oil" }, load), /must be/);
  await assert.rejects(ofgemCap({ energy: "gas", taxes: "none" }, load), /taxes must be/);
  const a = await ofgemCap({ energy: "gas", taxes: "all", consumption_band: "DC" }, load);
  assert.match(JSON.stringify(a), /consumption_band was ignored/);
});
