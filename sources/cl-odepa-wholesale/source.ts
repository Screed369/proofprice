// Chile wholesale fruit and vegetable markets: daily prices and volumes per product, variety, quality and market, from ODEPA (Oficina de Estudios y Politicas Agrarias).
// Format checked 2026-10-24 from GitHub's servers (probes vc-cl5/7/8 and cl-whl-d1): CKAN at https://datos.odepa.gob.cl (package precios-mayoristas-de-frutas-y-hortalizas,
// licence_id cc-by). The 2026 file is datastore resource 580beca0-e87e-4dd4-9e8a-0bd92773f4a6 (one resource per year; datastore_search works, datastore_search_sql does NOT exist).
// Fields (all text): Fecha (ISO date), ID region, Region, Mercado, Subsector, Producto, "Variedad / Tipo", Calidad, "Unidad de comercializacion", Origen, Volumen,
// "Precio minimo", "Precio maximo", "Precio promedio" (decimal comma, CLP, volume-weighted per the publisher). One trading day holds about 770 rows.
// The unit is a pack price such as "$/bandeja 18 kilos", "$/saco 25 kilos", "$/caja 15 unidades", "$/unidad" or "$/kilo (en caja de 17 kilos)": we convert to CLP per kg or per unit.

import { InputError, SourceError } from "../../lib/http";
import { buildAnswer, PriceAnswer } from "../../lib/answer";
import { ckanSearch } from "../../lib/adapters";
import type { Fetcher } from "../../lib/adapters/common";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { summarise } from "../../lib/stats";
import { aggregateDaily } from "../../lib/library/aggregate";

export const SITE = "https://datos.odepa.gob.cl";
export const RESOURCE_2026 = "580beca0-e87e-4dd4-9e8a-0bd92773f4a6";
export const PAGE_URL = "https://datos.odepa.gob.cl/dataset/precios-mayoristas-de-frutas-y-hortalizas";
export const LICENCE_URL = "https://opendefinition.org/licenses/cc-by/";

export const INFO: SourceInfo = {
  id: "cl-odepa-wholesale",
  country: "CL (Chile)",
  category: "wholesale fruit and vegetable markets",
  name: "ODEPA Chile: wholesale prices and volumes of fruit and vegetables",
  publisher: "Oficina de Estudios y Politicas Agrarias (ODEPA), Ministerio de Agricultura, Chile",
  what_is_recorded:
    "The volume-weighted average price at which one product (variety and quality) traded in one wholesale market on one day, converted to Chilean pesos (CLP) per kilogram or per unit, with the volume traded.",
  price_type: "transaction",
  freshness: "Daily on working days, newest day is usually the previous working day",
  licence: "Creative Commons Attribution (CC BY)",
  licence_url: LICENCE_URL,
  attribution:
    "Source: ODEPA (Oficina de Estudios y Politicas Agrarias, Chile), Precios mayoristas de frutas y hortalizas (datos.odepa.gob.cl), CC BY. Prices are converted to CLP per kg or per unit and ranges are calculated by ProofPrice.",
  homepage: PAGE_URL,
  limits:
    "Wholesale prices between traders at nine regional wholesale markets and fairs (Lo Valledor, Vega Central, Femacal, La Palmera, Lagunitas, Talca, Chillan, Temuco, Concepcion, Arica), not shop prices and not farm-gate prices. " +
    "Every quality grade and variety is included, so the range shows grade differences as well as day-to-day changes. Prices quoted per bunch, dozen or other packs we cannot convert to kg or units are left out.",
};

export const METHOD =
  "Chile wholesale produce: the volume-weighted average prices (CLP) that ODEPA publishes for each product, variety, quality and market on each working day, converted from the pack price " +
  "(for example a 18 kg tray or a 25 kg sack) to CLP per kg, or per unit for products sold by the piece. We take every record of the newest three trading days and give the median, the 10th to 90th percentile and the lowest and highest; " +
  "a record is one variety and quality at one market on one day.";

// ---------- products and markets ----------

/** English name to the exact ODEPA "Producto" values. */
export const PRODUCTS: Record<string, string[]> = {
  avocado: ["Palta"], apple: ["Manzana"], lettuce: ["Lechuga"], tomato: ["Tomate"], lemon: ["Limón"], mandarin: ["Mandarina"], orange: ["Naranja"],
  onion: ["Cebolla"], potato: ["Papa"], "custard apple": ["Chirimoya"], strawberry: ["Frutilla"], "bell pepper": ["Pimiento"], mango: ["Mango"],
  pineapple: ["Piña"], cabbage: ["Repollo"], banana: ["Plátano"], broccoli: ["Brócoli"], cauliflower: ["Coliflor"], cucumber: ["Pepino ensalada"],
  pear: ["Pera"], carrot: ["Zanahoria"], garlic: ["Ajo"], zucchini: ["Zapallo italiano"], celery: ["Apio"], beetroot: ["Betarraga"], kiwi: ["Kiwi"],
  pumpkin: ["Zapallo"], chard: ["Acelga"], blueberry: ["Arándano (blue)"], watermelon: ["Sandia"], artichoke: ["Alcachofa"], coriander: ["Cilantro"],
  asparagus: ["Espárragos"], "sweet corn": ["Choclo"], eggplant: ["Berenjena"], spinach: ["Espinaca"], melon: ["Melón"], grapes: ["Uva"], cherry: ["Cereza"],
  grapefruit: ["Pomelo"], "green beans": ["Poroto verde"], peas: ["Arveja Verde"], "broad beans": ["Haba"], "sweet potato": ["Camote"], ginger: ["Jengibre"],
  parsley: ["Perejil"], chili: ["Ají"],
};

const ALIASES: Record<string, string> = {
  avocados: "avocado", palta: "avocado", apples: "apple", manzana: "apple", lettuces: "lettuce", lechuga: "lettuce", tomatoes: "tomato", tomate: "tomato",
  lemons: "lemon", limon: "lemon", mandarins: "mandarin", mandarina: "mandarin", oranges: "orange", naranja: "orange", onions: "onion", cebolla: "onion",
  potatoes: "potato", papa: "potato", papas: "potato", chirimoya: "custard apple", strawberries: "strawberry", frutilla: "strawberry", pepper: "bell pepper",
  peppers: "bell pepper", "bell peppers": "bell pepper", pimiento: "bell pepper", mangos: "mango", mangoes: "mango", pina: "pineapple", pineapples: "pineapple",
  repollo: "cabbage", cabbages: "cabbage", platano: "banana", bananas: "banana", brocoli: "broccoli", coliflor: "cauliflower", cucumbers: "cucumber",
  pepino: "cucumber", pears: "pear", pera: "pear", carrots: "carrot", zanahoria: "carrot", ajo: "garlic", courgette: "zucchini", "zapallo italiano": "zucchini",
  apio: "celery", beets: "beetroot", beet: "beetroot", betarraga: "beetroot", kiwis: "kiwi", squash: "pumpkin", zapallo: "pumpkin", acelga: "chard",
  blueberries: "blueberry", arandano: "blueberry", sandia: "watermelon", artichokes: "artichoke", alcachofa: "artichoke", cilantro: "coriander",
  esparragos: "asparagus", corn: "sweet corn", choclo: "sweet corn", aubergine: "eggplant", berenjena: "eggplant", espinaca: "spinach", melons: "melon",
  melon: "melon", grape: "grapes", uva: "grapes", cherries: "cherry", cereza: "cherry", pomelo: "grapefruit", "green bean": "green beans", beans: "green beans",
  "poroto verde": "green beans", pea: "peas", arveja: "peas", haba: "broad beans", camote: "sweet potato", "sweet potatoes": "sweet potato", jengibre: "ginger",
  perejil: "parsley", aji: "chili", chilli: "chili",
};

/** English market name to a lower-case, accent-free part of ODEPA's "Mercado" text. */
export const MARKETS: Record<string, string> = {
  "lo valledor": "lo valledor", santiago: "santiago", "vega central": "vega central", "vega mapocho": "vega central", femacal: "femacal", "la calera": "femacal",
  "la serena": "la serena", "la palmera": "la palmera", "puerto montt": "puerto montt", lagunitas: "lagunitas", talca: "talca", chillan: "chillan",
  temuco: "temuco", concepcion: "concepcion", arica: "arica",
};

export const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export interface Product { key: string; names: string[] }

export function resolveProduct(input: string): Product | null {
  const lc = plain(input);
  const key = PRODUCTS[lc] ? lc : ALIASES[lc];
  if (key && PRODUCTS[key]) return { key, names: PRODUCTS[key] };
  return null;
}

export function productHelp(): string {
  return Object.keys(PRODUCTS).join(", ");
}

export function unknownProduct(asked: string): string {
  return `Chile: '${asked}' is not one of the products we know. Use one of: ${productHelp()} (or the Spanish name such as palta, tomate, papa).`;
}

// ---------- parsing ----------

export type Basis = "kg" | "unit";
export interface Row { date: string; product: string; variety: string; quality: string; market: string; region: string; price: number; basis: Basis; volume: number }

/** "20500,0000" or "20500.5" to a number; NaN when it is not one. */
export function num(v: unknown): number {
  const s = String(v ?? "").trim().replace(/\s/g, "");
  if (!s) return NaN;
  return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
}

/**
 * Pack price to a price per kg or per unit. "$/kilo (en caja de 17 kilos)" is already per kg; "$/bandeja 18 kilos" is a tray of 18 kg; "$/caja 15 unidades" a box of 15 pieces;
 * "$/unidad" one piece. Anything else (bunches, dozens, plants) returns null.
 */
export function unitFactor(unit: string): { basis: Basis; divisor: number } | null {
  const u = plain(unit);
  if (/^\$\/kilo\b/.test(u)) return { basis: "kg", divisor: 1 };
  if (/^\$\/unidad\b/.test(u)) return { basis: "unit", divisor: 1 };
  const kg = /(\d+(?:[.,]\d+)?)\s*kilos?\b/.exec(u);
  if (kg) {
    const d = Number(kg[1].replace(",", "."));
    return d > 0 ? { basis: "kg", divisor: d } : null;
  }
  const un = /(\d+)\s*unidades\b/.exec(u);
  if (un && Number(un[1]) > 0) return { basis: "unit", divisor: Number(un[1]) };
  return null;
}

/** Usable rows from a datastore_search records list. Rows with a unit we cannot convert, zero price or no date are dropped. Throws SourceError on a changed layout. */
export function parseRecords(records: Record<string, any>[]): Row[] {
  const out: Row[] = [];
  let looksRight = records.length === 0;
  for (const r of records) {
    if (!r || typeof r !== "object") continue;
    if (r.Fecha !== undefined && r.Producto !== undefined && r["Precio promedio"] !== undefined && r["Unidad de comercializacion"] !== undefined) looksRight = true;
    const date = /^\d{4}-\d{2}-\d{2}/.test(String(r.Fecha ?? "")) ? String(r.Fecha).slice(0, 10) : null;
    const f = unitFactor(String(r["Unidad de comercializacion"] ?? ""));
    const p = num(r["Precio promedio"]);
    if (!date || !f || !(p > 0)) continue;
    const vol = num(r.Volumen);
    out.push({
      date,
      product: String(r.Producto ?? "").trim(),
      variety: String(r["Variedad / Tipo"] ?? "").trim(),
      quality: String(r.Calidad ?? "").trim(),
      market: String(r.Mercado ?? "").trim(),
      region: String(r.Region ?? "").trim(),
      price: Math.round((p / f.divisor) * 100) / 100,
      basis: f.basis,
      volume: vol > 0 ? vol : 0,
    });
  }
  if (!looksRight) throw new SourceError("ODEPA changed the layout of its wholesale price table (expected Fecha, Producto, Unidad de comercializacion, Precio promedio); this source needs updating.");
  return out;
}

// ---------- answer ----------

export interface Input { product?: string; market?: string; baseUrl?: string }

function marketMatch(market: string, asked: string): boolean {
  return plain(market).includes(asked);
}

export function answerFromRows(all: Row[], input: Input): PriceAnswer {
  const asked = (input.product ?? "").trim();
  if (!asked) throw new InputError("product is required, for example 'tomato', 'avocado', 'potato' or 'lettuce'.");
  const prod = resolveProduct(asked);
  if (!prod) throw new InputError(unknownProduct(asked));
  const marketAsked = input.market ? plain(input.market) : undefined;
  let needle: string | undefined;
  if (marketAsked) {
    needle = MARKETS[marketAsked] ?? (Object.values(MARKETS).some((v) => marketAsked.length >= 4 && v.includes(marketAsked)) ? marketAsked : undefined);
    if (!needle) throw new InputError(`Chile: market '${input.market}' is not one we know. Use one of: ${Object.keys(MARKETS).join(", ")}, or leave market out.`);
  }
  let rows = all.filter((r) => prod.names.includes(r.product) && (!needle || marketMatch(r.market, needle)));
  const kgRows = rows.filter((r) => r.basis === "kg");
  const unitRows = rows.filter((r) => r.basis === "unit");
  const dateSet = (xs: Row[]) => [...new Set(xs.map((r) => r.date))].sort().reverse();
  const pick = (xs: Row[]): Row[] => {
    const newest = xs.filter((r) => dateSet(xs).slice(0, 3).includes(r.date));
    return newest.length >= 5 ? newest : xs;
  };
  // per kg when there are 5 records for it, else per unit (lettuce, for example, is sold by the piece)
  const basis: Basis = pick(kgRows).length >= 5 || unitRows.length < 5 ? "kg" : "unit";
  const used = pick(basis === "kg" ? kgRows : unitRows);
  const usedDates = [...new Set(used.map((r) => r.date))].sort();
  const s = summarise(used.map((r) => r.price));
  const markets = [...new Set(used.map((r) => r.market))].sort();
  const vol = used.reduce((a, r) => a + r.volume, 0);
  const unitLabel = basis === "kg" ? "per kg" : "per unit";
  return buildAnswer({
    source: INFO,
    query: { country: "CL", product: prod.key, ...(marketAsked ? { market: input.market!.trim() } : {}) },
    summary: s,
    currency: "CLP",
    unit: unitLabel,
    period: { from: usedDates[0] ?? null, to: usedDates[usedDates.length - 1] ?? null },
    method: METHOD,
    describe: (x) => `Wholesale ${prod.key} in Chile: median ${x.median} CLP ${unitLabel} (typical ${x.low} to ${x.high}).`,
    baseUrl: input.baseUrl,
    extra: {
      note: "Wholesale market prices between traders: not what a shopper pays. All quality grades and varieties are included.",
      basis: unitLabel,
      markets,
      trading_days: usedDates,
      volume_traded: Math.round(vol),
      record: "price of one variety and quality at one market on one day",
      records_dropped_other_basis: basis === "kg" ? unitRows.length : kgRows.length,
    },
  });
}

/** Newest records of one product: ODEPA has no SQL, so ask datastore_search for the product (exact name), newest first. About 40 records a day, so 400 covers 8 to 10 days. */
export async function fetchProduct(names: string[], fetcher?: Fetcher): Promise<Row[]> {
  const parts = await Promise.all(
    names.map((n) => ckanSearch(SITE, { resourceId: RESOURCE_2026, filters: { Producto: n }, sort: "_id desc", limit: 400, includeTotal: false }, { fetcher, timeoutMs: 25000 })),
  );
  return parts.flatMap((p) => parseRecords(p.records));
}

export async function clWholesale(input: Input, fetcher?: Fetcher): Promise<PriceAnswer> {
  if (!input.product) throw new InputError("product is required, for example 'tomato', 'avocado', 'potato' or 'lettuce'.");
  const prod = resolveProduct(input.product);
  if (!prod) throw new InputError(unknownProduct(input.product)); // no network call for a product we cannot match
  return answerFromRows(await fetchProduct(prod.names, fetcher), input);
}

// ---------- daily collector ----------

/** One national row per known product for one trading day, in CLP per kg: median/percentiles over the day's records. Products with under 5 per-kg records are left out. */
export function harvestFromRows(rows: Row[], date: string): HarvestResult {
  const day = rows.filter((r) => r.date === date && r.basis === "kg");
  const records: { area: string; item: string; price: number }[] = [];
  for (const [key, names] of Object.entries(PRODUCTS)) for (const r of day) if (names.includes(r.product)) records.push({ area: "ALL", item: key, price: r.price });
  const out = aggregateDaily(records, false).filter((x) => x.n >= 5);
  if (!out.length) throw new SourceError(`ODEPA wholesale table had no usable per-kg records for ${date} (or a changed layout).`);
  return {
    date,
    currency: "CLP",
    unit: "per kg",
    rows: out,
    note: `Median, 10th to 90th percentile of the records (one per variety, quality and market) on ${date}, converted to CLP per kg. Products sold by the piece are not stored.`,
  };
}

export async function clHarvest(fetcher?: Fetcher): Promise<HarvestResult> {
  // the newest ~2 days: 1,500 rows, newest first; take the newest date that holds a full day (a day has ~770 rows)
  const res = await ckanSearch(SITE, { resourceId: RESOURCE_2026, sort: "_id desc", limit: 1500, includeTotal: false }, { fetcher, timeoutMs: 30000 });
  const rows = parseRecords(res.records);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.date, (counts.get(r.date) ?? 0) + 1);
  const dates = [...counts.keys()].sort().reverse();
  const full = dates.find((d) => (counts.get(d) ?? 0) >= 100) ?? dates[0];
  if (!full) throw new SourceError("ODEPA wholesale table returned no records.");
  return harvestFromRows(rows, full);
}

export function clHistoryKey(p: { country: string; product: string }): { area: string; item: string; label: string } | null {
  if (String(p.country).trim().toUpperCase() !== "CL") return null;
  const prod = resolveProduct(String(p.product ?? ""));
  if (!prod) return null;
  return { area: "ALL", item: prod.key, label: `Chile wholesale ${prod.key}` };
}
