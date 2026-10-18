// REST honesty: a place given under another name is used, and a name nobody reads is a 400, never an ok answer for something else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryById, exampleUrls, paramsFromQuery, assertKnownParams, locationParam } from "../lib/registry";
import { GET } from "../app/api/v1/[category]/route";

const hs = categoryById("home-sales")!;
const q = (s: string) => new URLSearchParams(s);

test("area, city and place are moved to the category's location parameter", () => {
  assert.equal(locationParam(hs), "town");
  assert.deepEqual(paramsFromQuery(hs, q("country=IE&area=Dublin")), { country: "IE", town: "Dublin" });
  assert.deepEqual(paramsFromQuery(hs, q("country=IE&city=Dublin")), { country: "IE", town: "Dublin" });
  assert.deepEqual(paramsFromQuery(hs, q("country=IE&place=Dublin")), { country: "IE", town: "Dublin" });
  // the category's own name wins and is never overwritten
  assert.deepEqual(paramsFromQuery(hs, q("country=IE&town=Cork")), { country: "IE", town: "Cork" });
});

test("a declared parameter is not treated as an alias (fuel has both area and town)", () => {
  const fuel = categoryById("fuel")!;
  const p = paramsFromQuery(fuel, q("country=ES&area=28&fuel=diesel"));
  assert.equal(p.area, "28");
  assert.equal(p.town, undefined);
});

test("an unknown parameter is rejected with the valid names", () => {
  const p = paramsFromQuery(hs, q("country=IE&suburb=Dublin"));
  assert.throws(() => assertKnownParams(hs, p), (e: any) => /Unknown parameter "suburb"/.test(e.message) && /town/.test(e.message) && /postcode/.test(e.message));
  assert.doesNotThrow(() => assertKnownParams(hs, paramsFromQuery(hs, q("country=IE&area=Dublin&months=12&department=x"))));
});

test("platform and tracking noise is ignored, not rejected", () => {
  const p = paramsFromQuery(hs, q("country=IE&town=Dublin&_vercel_share=abc&utm_source=x&fbclid=1&ppcheck=1"));
  assert.doesNotThrow(() => assertKnownParams(hs, p));
});

test("a category without a place says so", () => {
  const med = categoryById("medicines")!;
  assert.equal(locationParam(med), undefined);
  assert.throws(() => assertKnownParams(med, paramsFromQuery(med, q("country=GB&medicine=x&city=Leeds"))), /no place parameter/);
});

test("every example and answer-page request of every source passes the strict check", () => {
  for (const ex of exampleUrls()) {
    const cat = categoryById(ex.category)!;
    const p = paramsFromQuery(cat, new URLSearchParams(ex.path.split("?")[1] ?? ""));
    assert.doesNotThrow(() => assertKnownParams(cat, p), ex.path);
  }
});

test("REST route: the Dublin URL asks for Dublin, an unknown name is a 400", async () => {
  const bad = await GET(new Request("https://x.test/api/v1/home-sales?country=IE&suburb=Dublin"), { params: Promise.resolve({ category: "home-sales" }) });
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as any).error, /Unknown parameter "suburb"/);
});
