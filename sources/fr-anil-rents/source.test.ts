// Fixtures: real responses captured 2026-10-20 via the GitHub-hosted probe: agglomerations.json (group-by list), rows-paris-2p.json
// (all rows of Paris intra-muros for "Appart 2P"), resources.json (data.gouv.fr dataset listing).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, FALLBACK_RESOURCE_ID, RESOURCES_URL, chooseRow, frRent, listUrl, matchAgglomeration, parseAgglomerations, pickResource, rowsUrl, selection, RentRow } from "./source";

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8"));
const AGG = fx("agglomerations");
const PARIS = fx("rows-paris-2p");
const RES = fx("resources");

test("lists the observed agglomerations and drops bare codes", () => {
  const names = parseAgglomerations(AGG);
  assert.ok(names.includes("Agglomération de Toulouse"));
  assert.ok(!names.includes("L7500"));
  assert.equal(names.length, 51);
});

test("picks the newest agglomeration file from the dataset listing", () => {
  assert.deepEqual(pickResource(RES), { id: FALLBACK_RESOURCE_ID, year: 2025 });
  assert.equal(pickResource({ data: [] }), null);
});

test("town matching", () => {
  const names = parseAgglomerations(AGG);
  assert.equal(matchAgglomeration(names, "Paris"), "Paris intra-muros");
  assert.equal(matchAgglomeration(names, "Ile-de-France"), "Agglomération parisienne");
  assert.equal(matchAgglomeration(names, "toulouse"), "Agglomération de Toulouse");
  assert.equal(matchAgglomeration(names, "Besançon"), "Agglomération de Besançon");
  assert.equal(matchAgglomeration(names, "Marseille"), "Agglomérations d'Aix-Marseille et Arles");
  assert.throws(() => matchAgglomeration(names, "Morbihan"), /several observed areas/);
  assert.throws(() => matchAgglomeration(names, "Lyon"), /not one of the agglomerations/);
  assert.throws(() => matchAgglomeration(names, undefined), /give town/);
});

test("size and tenancy selection (French rooms include the living room)", () => {
  assert.equal(selection({ property_type: "apartment", bedrooms: 1 }).pieces, "Appart 2P");
  assert.equal(selection({ property_type: "apartment", bedrooms: 0 }).pieces, "Appart 1P");
  assert.equal(selection({ property_type: "apartment", bedrooms: 5 }).pieces, "Appart 4P+");
  assert.equal(selection({ property_type: "house", bedrooms: 2 }).pieces, "Maison 1-3P");
  assert.equal(selection({ property_type: "house", bedrooms: 3 }).pieces, "Maison 4P+");
  assert.equal(selection({ bedrooms: 2 }).pieces, "Ensemble 3P");
  assert.equal(selection({ property_type: "apartment" }).type, "Appartement");
  assert.equal(selection({ property_type: "apartment", bedrooms: 1, tenancy: "new" }).tenure, "1. Moins de 1 an");
  assert.throws(() => selection({ property_type: "room" }), /rooms are not published/);
  assert.throws(() => selection({ tenancy: "soon" }), /tenancy must be/);
});

test("row choice on the real Paris 2-room rows", () => {
  const rows = PARIS.data as RentRow[];
  const all = chooseRow(rows, selection({ property_type: "apartment", bedrooms: 1 }))!;
  assert.equal(all.loyer_mensuel_median, 1105);
  assert.equal(all.nombre_observations, 1384);
  const fresh = chooseRow(rows, selection({ property_type: "apartment", bedrooms: 1, tenancy: "new" }))!;
  assert.equal(fresh.loyer_mensuel_median, 1180);
  assert.equal(fresh.nombre_observations, 144);
  // a group the publisher left empty must not be chosen
  assert.equal(chooseRow(rows.filter((r) => r.epoque_construction_homogene === "4. Entre 1991-2005"), selection({})), null);
});

function fake(map: Record<string, unknown>) {
  return async (u: string) => {
    if (u in map) return map[u];
    throw new Error("unexpected url " + u);
  };
}

test("full answer for the exact Paris question, 2 rooms apartment", async () => {
  const f = fake({
    [RESOURCES_URL]: RES,
    [listUrl(FALLBACK_RESOURCE_ID)]: AGG,
    [rowsUrl(FALLBACK_RESOURCE_ID, "Paris intra-muros", "Appart 2P")]: PARIS,
  });
  const a = await frRent({ town: "Paris", property_type: "apartment", bedrooms: 1 }, f);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 1105);
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.unit, "per month");
  assert.equal(a.sample_size, 1384);
  assert.equal(a.price?.typical_low, null); // the publisher withholds the deciles for Paris
  assert.deepEqual(a.period, { from: "2025-01-01", to: "2025-12-31" });
  assert.equal(a.price_type, "official_statistic");
  assert.ok(a.source.licence.includes("Licence Ouverte"));
  assert.equal((a.extra as any).quartiles_per_month.q1, 928);
});

test("works when the dataset listing is down (falls back to the 2025 file)", async () => {
  const f = fake({
    [listUrl(FALLBACK_RESOURCE_ID)]: AGG,
    [rowsUrl(FALLBACK_RESOURCE_ID, "Paris intra-muros", "Appart 2P")]: PARIS,
  });
  const a = await frRent({ town: "Paris", property_type: "apartment", bedrooms: 1, tenancy: "new" }, f);
  assert.equal(a.price?.value, 1180);
  assert.equal(a.sample_size, 144);
});

test("under 5 observations is never shown", async () => {
  const thin = { ...PARIS, data: PARIS.data.map((r: RentRow) => ({ ...r, nombre_observations: 4 })) };
  const f = fake({ [RESOURCES_URL]: RES, [listUrl(FALLBACK_RESOURCE_ID)]: AGG, [rowsUrl(FALLBACK_RESOURCE_ID, "Paris intra-muros", "Appart 2P")]: thin });
  const a = await frRent({ town: "Paris", property_type: "apartment", bedrooms: 1 }, f);
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.equal(a.sample_size, null);
});

test("unknown town gives the list instead of a silent answer", async () => {
  const f = fake({ [RESOURCES_URL]: RES, [listUrl(FALLBACK_RESOURCE_ID)]: AGG });
  await assert.rejects(() => frRent({ town: "Lyon" }, f), /Available: Agglomération d'Ajaccio/);
});

test("licence is on the answer", () => {
  assert.ok(INFO.attribution.includes("Observatoires Locaux des Loyers"));
});

import { harvestRows, rentHistoryKey, rentItem, frRentHarvest } from "./source";

test("harvest rows: publisher counts, 5+ only, deciles kept", () => {
  const byArea = new Map<string, RentRow[]>([["Paris intra-muros", PARIS.data as RentRow[]]]);
  const { rows, year } = harvestRows(byArea);
  assert.equal(year, 2025);
  assert.ok(rows.length >= 1);
  for (const r of rows) {
    assert.ok(r.n >= 5 && r.median > 0 && r.low <= r.median + 1e-9 && r.high >= r.median - 1e-9);
    assert.equal(r.area, "Paris intra-muros");
  }
  assert.ok(rows.some((r) => r.item === "Appart 2P"));
});

test("history key matches the harvest item and refuses what is not stored", () => {
  const areas = parseAgglomerations(AGG);
  assert.deepEqual(rentHistoryKey({ town: "Toulouse", property_type: "apartment", bedrooms: 1 }, areas), { area: "Agglomération de Toulouse", item: "Appart 2P", label: "Agglomération de Toulouse" });
  assert.equal(rentHistoryKey({ town: "Paris" }, areas)?.item, "Tous");
  assert.equal(rentHistoryKey({ town: "Paris", tenancy: "new" }, areas), null);
  assert.equal(rentHistoryKey({ town: "Lyon" }, areas), null);
  assert.equal(rentHistoryKey({ town: "Paris" }, []), null);
  assert.equal(rentItem({ property_type: "room" }), null);
});

test("harvest end to end on fixtures", async () => {
  const fetcher = async (u: string) => {
    if (u === RESOURCES_URL) return RES;
    if (u.includes("groupby")) return AGG;
    if (u.includes("agglomeration__exact=Paris%20intra-muros")) return PARIS;
    return { data: [], links: {} };
  };
  const h = await frRentHarvest(fetcher);
  assert.equal(h.date, "2025-12-31");
  assert.equal(h.unit, "per month");
  assert.ok(h.rows.every((r) => r.area === "Paris intra-muros"));
  await assert.rejects(frRentHarvest(async (u) => (u === RESOURCES_URL ? RES : u.includes("groupby") ? AGG : { data: [], links: {} })), /no usable rows/);
});
