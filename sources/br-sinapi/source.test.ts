// Fixtures national.json / states.json: real IBGE SIDRA answers for table 2296 (months 2026-08 and 2026-09), captured 2026-10-16 via the GitHub-hosted probe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, brSinapi, matchTerritory, parseSidra, pick, sidraUrl } from "./source";

const NAT = JSON.parse(readFileSync(new URL("./fixtures/national.json", import.meta.url), "utf8"));
const ST = JSON.parse(readFileSync(new URL("./fixtures/states.json", import.meta.url), "utf8"));

test("parses cells and skips the header object", () => {
  assert.equal(parseSidra(NAT).length, 6);
  assert.equal(parseSidra(ST).length, 4);
  assert.throws(() => parseSidra({ nope: 1 }), /needs updating/);
});

test("territory matching", () => {
  assert.equal(matchTerritory().national, true);
  assert.equal(matchTerritory("Brazil").code, "1");
  assert.equal(matchTerritory("SP").code, "35");
  assert.equal(matchTerritory("São Paulo").code, "35");
  assert.equal(matchTerritory("sao paulo").code, "35");
  assert.equal(matchTerritory("rio de janeiro").code, "33");
  assert.equal(matchTerritory("Bahia").name, "Bahia");
  assert.throws(() => matchTerritory("Atlantis"), /not a Brazilian state/);
});

test("url", () => {
  assert.equal(sidraUrl(matchTerritory()), "https://apisidra.ibge.gov.br/values/t/2296/n1/1/v/48,2119,2120/p/last%202");
  assert.match(sidraUrl(matchTerritory("SP")), /n3\/35\/v\/48/);
});

test("pick latest and previous", () => {
  const p = pick(parseSidra(NAT), "1", "48")!;
  assert.equal(p.month, "202609");
  assert.equal(p.value, 1999.73);
  assert.equal(p.previous?.value, 1993.76);
});

test("national answer", async () => {
  const calls: string[] = [];
  const a = await brSinapi({}, async (u) => (calls.push(u), NAT));
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 1999.73);
  assert.equal(a.price?.currency, "BRL");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.period?.from, "2026-09-01");
  assert.equal(a.period?.to, "2026-09-30");
  assert.equal((a.extra as any).by_component.labour, 872.56);
  assert.equal(calls.length, 1);
});

test("labour component and state", async () => {
  const a = await brSinapi({ component: "labour" }, async () => NAT);
  assert.equal(a.price?.value, 872.56);
  const s = await brSinapi({ area: "SP" }, async () => ST);
  assert.equal(s.price?.value, 2093.45);
  assert.equal((s.extra as any).previous_month.value, 2089.88);
});

test("bad input fails before fetching", async () => {
  await assert.rejects(brSinapi({ area: "Nowhere" }, async () => assert.fail("fetched")), /not a Brazilian state/);
  await assert.rejects(brSinapi({ component: "paint" }, async () => assert.fail("fetched")), /component must be/);
});

test("licence block is complete", () => {
  assert.equal(INFO.id, "br-sinapi");
  assert.match(INFO.licence_url, /^https:\/\//);
});
