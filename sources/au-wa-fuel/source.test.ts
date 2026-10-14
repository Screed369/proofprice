import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFuelWatchRss, resolveAuScope, auAnswer, auDailyRows, auHistoryKey, perthToday, scopeLabel } from "./source";

// Items copied from the live FuelWatch RSS feed (14 and 15 Oct 2026), trimmed to the tags we read (phone numbers,
// descriptions and opening hours dropped). Prices are cents per litre.
const dieselRss = `<rss version="2.0">
  <channel>
    <title>FuelWatch Prices For North of River</title>
    <link>https://www.fuelwatch.wa.gov.au/</link>
    <description>14/10/2026 - North of River</description>
    <language>en-us</language>
    <copyright>Copyright 2025 FuelWatch. All Rights Reserved.</copyright>
    <item>
      <title>253.3: Burk Mount Lawley</title>
      <brand>Burk</brand>
      <date>2026-10-14</date>
      <price>253.3</price>
      <trading-name>Burk Mount Lawley</trading-name>
      <location>MOUNT LAWLEY</location>
      <address>791 Beaufort St</address>
      <latitude>-31.92588700</latitude>
      <longitude>115.88022500</longitude>
      <restrictions></restrictions>
    </item>
    <item>
      <title>254.7: Vibe Wanneroo</title>
      <brand>Vibe</brand>
      <date>2026-10-14</date>
      <price>254.7</price>
      <trading-name>Vibe Wanneroo</trading-name>
      <location>WANNEROO</location>
      <address>964 Wanneroo Rd</address>
      <latitude>-31.75138200</latitude>
      <longitude>115.80342600</longitude>
      <restrictions></restrictions>
    </item>
    <item>
      <title>254.9: Atlas Fuel Wanneroo</title>
      <brand>Atlas</brand>
      <date>2026-10-14</date>
      <price>254.9</price>
      <trading-name>Atlas Fuel Wanneroo</trading-name>
      <location>WANNEROO</location>
      <address>951 Wanneroo Rd</address>
      <latitude>-31.75261500</latitude>
      <longitude>115.80343200</longitude>
      <restrictions></restrictions>
    </item>
    <item>
      <title>255.2: Vibe Beechboro</title>
      <brand>Vibe</brand>
      <date>2026-10-14</date>
      <price>255.2</price>
      <trading-name>Vibe Beechboro</trading-name>
      <location>BEECHBORO</location>
      <address>495 Beechboro Rd North</address>
      <latitude>-31.86900000</latitude>
      <longitude>115.92443900</longitude>
      <restrictions></restrictions>
    </item>
    <item>
      <title>255.3: Burk Landsdale</title>
      <brand>Burk</brand>
      <date>2026-10-14</date>
      <price>255.3</price>
      <trading-name>Burk Landsdale</trading-name>
      <location>LANDSDALE</location>
      <address>274 Gnangara Rd</address>
      <latitude>-31.79903000</latitude>
      <longitude>115.84712600</longitude>
      <restrictions></restrictions>
    </item>
  </channel>
</rss>
`;
// ULP: a members-only Costco item (South of River) plus three Fremantle-area items.
const ulpRss = `<rss version="2.0">
  <channel>
    <title>FuelWatch Prices For South of River</title>
    <link>https://www.fuelwatch.wa.gov.au/</link>
    <description>15/10/2026 - South of River</description>
    <language>en-us</language>
    <copyright>Copyright 2025 FuelWatch. All Rights Reserved.</copyright>
    <item>
      <title>224.7: Costco Perth Airport</title>
      <brand>Costco</brand>
      <date>2026-10-15</date>
      <price>224.7</price>
      <trading-name>Costco Perth Airport</trading-name>
      <location>PERTH AIRPORT</location>
      <address>142 Dunreath Dr</address>
      <latitude>-31.94037700</latitude>
      <longitude>115.95186900</longitude>
      <restrictions>Membership Required; </restrictions>
    </item>
    <item>
      <title>235.5: Liberty O'Connor</title>
      <brand>Liberty</brand>
      <date>2026-10-15</date>
      <price>235.5</price>
      <trading-name>Liberty O'Connor</trading-name>
      <location>O'CONNOR</location>
      <address>9 Pritchard St</address>
      <latitude>-32.06306500</latitude>
      <longitude>115.79201700</longitude>
      <restrictions></restrictions>
    </item>
    <item>
      <title>239.5: Ampol Rous Head</title>
      <brand>Ampol</brand>
      <date>2026-10-15</date>
      <price>239.5</price>
      <trading-name>Ampol Rous Head</trading-name>
      <location>NORTH FREMANTLE</location>
      <address>Cnr North Mole Dr &amp; Rous Head Rd</address>
      <latitude>-32.04114600</latitude>
      <longitude>115.73884400</longitude>
      <restrictions>Unmanned site (credit card charges may apply); </restrictions>
    </item>
    <item>
      <title>239.9: Shell Reddy Express Fremantle</title>
      <brand>Reddy Express</brand>
      <date>2026-10-15</date>
      <price>239.9</price>
      <trading-name>Shell Reddy Express Fremantle</trading-name>
      <location>FREMANTLE</location>
      <address>101 Hampton Rd</address>
      <latitude>-32.06323500</latitude>
      <longitude>115.75666300</longitude>
      <restrictions></restrictions>
    </item>
  </channel>
</rss>
`;

test("AU: RSS parses, cents become dollars, entities decode, members-only stations are left out", () => {
  const diesel = parseFuelWatchRss(dieselRss);
  assert.equal(diesel.length, 5);
  assert.equal(diesel[0].price, 2.533);
  assert.equal(diesel[0].brand, "Burk");
  assert.equal(diesel[0].suburb, "MOUNT LAWLEY");
  assert.equal(diesel[0].date, "2026-10-14");
  const ulp = parseFuelWatchRss(ulpRss);
  assert.equal(ulp.length, 3); // Costco 'Membership Required' dropped
  assert.ok(!ulp.some((s) => s.brand === "Costco"));
  assert.equal(ulp[1].address, "Cnr North Mole Dr & Rous Head Rd");
  assert.equal(ulp[1].restrictions.startsWith("Unmanned site"), true); // unmanned is not a restriction on who may buy
  assert.throws(() => parseFuelWatchRss("<html>Not found</html>"), /Unexpected response/);
});

test("AU: scope resolution - Perth, state, region, suburb; postcode is explained", () => {
  assert.deepEqual(resolveAuScope({ area: "Perth" }), { kind: "perth" });
  assert.deepEqual(resolveAuScope({ town: "perth" }), { kind: "perth" });
  assert.deepEqual(resolveAuScope({ area: "Western Australia" }), { kind: "state" });
  assert.deepEqual(resolveAuScope({ area: "south of river" }), { kind: "region", id: 26, label: "Perth south of the river" });
  assert.deepEqual(resolveAuScope({ town: "Fremantle" }), { kind: "suburb", name: "FREMANTLE" });
  assert.deepEqual(resolveAuScope({ area: "Mount Lawley" }), { kind: "suburb", name: "MOUNT LAWLEY" });
  assert.throws(() => resolveAuScope({ postcode: "6160" }), /suburb, not postcode/);
  assert.throws(() => resolveAuScope({}), /Give a Western Australian suburb/);
  assert.equal(scopeLabel({ kind: "suburb", name: "NORTH FREMANTLE" }), "North Fremantle and neighbouring suburbs");
});

test("AU: answer is in Australian dollars per litre, dated, with the right caveats", () => {
  const a = auAnswer(parseFuelWatchRss(dieselRss), { fuel: "diesel", scope: { kind: "perth" }, query: { area: "Perth" }, today: "2026-10-14" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "AUD");
  assert.equal(a.price!.unit, "per litre");
  assert.equal(a.sample_size, 5);
  assert.equal(a.price_type, "posted_pump_price");
  assert.deepEqual(a.period, { from: "2026-10-14", to: "2026-10-14" });
  assert.match(a.summary, /Diesel in Perth \(metropolitan area\)/);
  assert.match(a.summary, /A\$2\./);
  assert.equal((a.extra as any).price_cycle_note, undefined); // diesel has no price cycle
  assert.deepEqual(Object.keys((a.extra as any).cheapest_stations[0]).sort(), ["address", "brand", "date", "name", "price", "suburb"]);
  // old data is flagged plainly
  const old = auAnswer(parseFuelWatchRss(dieselRss), { fuel: "diesel", scope: { kind: "state" }, query: { area: "WA" }, today: "2026-10-20" });
  assert.match(old.summary, /WARNING: the newest price date is 2026-10-14/);
  // fewer than 5 stations: no figure; and the Perth unleaded cycle note appears
  const thin = auAnswer(parseFuelWatchRss(ulpRss), { fuel: "petrol95", scope: { kind: "perth" }, query: { area: "Perth" }, today: "2026-10-15" });
  assert.equal(thin.status, "insufficient_data");
  assert.equal(thin.price, null);
  assert.match(String((thin.extra as any).price_cycle_note), /seven-day cycle/);
  assert.match(a.source.licence, /All Rights Reserved/);
});

test("AU: perthToday uses Perth time (UTC+8)", () => {
  assert.equal(perthToday(new Date("2026-10-14T16:02:00Z")), "2026-10-15");
  assert.equal(perthToday(new Date("2026-10-14T15:59:00Z")), "2026-10-14");
});

test("AU: library rows for the state, Perth and suburbs, and history keys", () => {
  const many = (suburb: string, n: number, base: number) =>
    Array.from({ length: n }, (_, i) => ({ brand: "B", name: "N", suburb, address: "A", price: base + i / 100, date: "2026-10-15", restrictions: "" }));
  const day = auDailyRows(
    { diesel: [...many("FREMANTLE", 5, 2.4), ...many("WANNEROO", 2, 2.5)], petrol95: many("FREMANTLE", 5, 2.2) },
    { diesel: many("FREMANTLE", 6, 2.4) },
  );
  assert.equal(day.date, "2026-10-15");
  const keys = day.rows.map((r) => `${r.area}/${r.item}/${r.n}`);
  // WANNEROO has 2 stations here: the row exists but the library store drops anything under 5 records.
  assert.deepEqual(keys, ["ALL/diesel/7", "ALL/petrol95/5", "FREMANTLE/diesel/5", "FREMANTLE/petrol95/5", "PERTH/diesel/6", "WANNEROO/diesel/2"]);
  assert.deepEqual(auHistoryKey({ area: "Perth", fuel: "diesel" }), { area: "PERTH", item: "diesel", label: "Perth (metropolitan area)" });
  assert.equal(auHistoryKey({ fuel: "petrol95" })!.area, "ALL");
  assert.equal(auHistoryKey({ town: "Fremantle", fuel: "diesel" })!.area, "FREMANTLE");
  assert.equal(auHistoryKey({ postcode: "6160", fuel: "diesel" }), null);
  assert.equal(auHistoryKey({ area: "Perth", fuel: "methane" }), null);
});

test("AU: live answer end to end with a stubbed feed (Perth = the three metropolitan regions)", async () => {
  const { auFuelNow } = await import("./source");
  const realFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (u: any) => {
    urls.push(String(u));
    return new Response(dieselRss, { status: 200 });
  }) as typeof fetch;
  try {
    const a = await auFuelNow({ area: "Perth", fuel: "diesel" });
    assert.equal(a.status, "ok");
    assert.equal(urls.length, 3);
    assert.ok(urls.every((u) => u.includes("Product=4")));
    assert.deepEqual(urls.map((u) => Number(new URL(u).searchParams.get("Region"))).sort(), [25, 26, 27]);
    assert.equal(a.sample_size, 15);
    await assert.rejects(auFuelNow({ area: "Perth", fuel: "methane" }), /not published for Western Australia/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
