// CH produce: BLW/OFAG (Federal Office for Agriculture) monthly consumer prices of fruit, vegetables and potatoes, read from the
// LINDAS linked-data service (SPARQL POST, CSV answer, no key). Format checked live on 2026-11-04 (cube
// https://agriculture.ld.admin.ch/foag/cube/FruitsVegetablesPotatoes/Consumption_Price_Month, 2006-01 to 2026-09, CHF per kg or per piece).
// Terms: opendata.swiss "Open use" (terms_by: commercial use allowed, source must be named; page read 2026-11-04).
// Data method of every observation is "List price" (BLW's own collection of retail standard products): a POSTED price, never a receipt.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, retryOnce, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import { exampleWords, ItemDef, matchItem } from "../../categories/groceries/items";

export const ENDPOINT = "https://lindas.admin.ch/query";
const FOAG = "https://agriculture.ld.admin.ch/foag/";
const CUBE_OBS = FOAG + "cube/FruitsVegetablesPotatoes/Consumption_Price_Month/observation/";
const MONTH = "https://ld.admin.ch/time/month/";

export const INFO: SourceInfo = {
  id: "ch-blw-produce-prices",
  country: "CH (Switzerland)",
  category: "groceries (monthly consumer list prices of fruit, vegetables and potatoes)",
  name: "Marktzahlen Früchte, Gemüse und Kartoffeln: monatliche Konsumentenpreise (BLW / FOAG, via LINDAS)",
  publisher: "Bundesamt für Landwirtschaft BLW (Federal Office for Agriculture FOAG), published on opendata.swiss and LINDAS",
  what_is_recorded:
    "For about 60 fruit, vegetable and potato items (conventional and organic), the monthly consumer price in Swiss francs per kg or per piece for Switzerland " +
    "or one language region (German-, French- or Italian-speaking), compiled by the Federal Office for Agriculture from retail list prices. One published figure per item, month and region; never an individual shop or shopper.",
  price_type: "posted_price",
  freshness: "Monthly: BLW adds the newest month during the following month, and the answer names the month it covers",
  licence: "opendata.swiss terms of use, tier 'Open use' (terms_by): commercial use allowed, the source must be named (author, title, link)",
  licence_url: "https://opendata.swiss/terms-of-use#terms_by",
  attribution:
    "Source: Federal Office for Agriculture FOAG, 'Market figures fruit, vegetables, and potatoes - Monthly consumer prices' " +
    "(https://ckan.opendata.swiss/dataset/marktzahlen-fruchte-gemuse-und-kartoffeln-monatliche-konsumentenpreise), Open use. " +
    "ProofPrice selects the items and calculates the changes; the FOAG has not reviewed it.",
  homepage: "https://ckan.opendata.swiss/dataset/marktzahlen-fruchte-gemuse-und-kartoffeln-monatliche-konsumentenpreise",
  limits:
    "BLW 'list prices' of standard retail products, not receipts and not the price in any one shop; the data gives no count of prices behind a figure. " +
    "Only the items in this table are offered, for the conventional product unless organic is asked for; prices for loose goods are per kg, others per piece or bunch.",
};

export type Unit = "kg" | "piece" | "bunch";
export interface ProduceItem extends ItemDef {
  /** unit of the LINDAS price */
  u: Unit;
  /** LINDAS product number of the organic twin, when BLW lists one */
  organic: string | null;
}

const def = (code: string, organic: string | null, label: string, u: Unit, words: string[]): ProduceItem => ({
  code, organic, label, u, unit: u === "kg" ? "per kg" : u === "piece" ? "per piece" : "per bunch", words,
});

/** The items: everyday words -> BLW product number (the number in https://agriculture.ld.admin.ch/foag/product/<n>). Labels are BLW's German names, read 2026-11-04. */
export const ITEMS: ProduceItem[] = [
  def("1253", "1107", "Bananas (Bananen)", "kg", ["bananas", "banana", "bananen"]),
  def("1258", null, "Blond oranges (Blondorangen)", "kg", ["oranges", "orange", "blond oranges"]),
  def("1268", null, "Clementines (Clementinen)", "kg", ["clementines", "clementine", "mandarins", "mandarin"]),
  def("1445", "1455", "Lemons (Zitronen)", "piece", ["lemons", "lemon", "zitronen"]),
  def("1024", "1081", "Kiwis (Kiwis)", "piece", ["kiwis", "kiwi", "kiwifruit", "kiwi fruit"]),
  def("1440", "1450", "Avocados (Avocados)", "piece", ["avocados", "avocado"]),
  def("1442", "1452", "Mangos (Mangos)", "piece", ["mangos", "mango", "mangoes"]),
  def("1439", null, "Pineapple (Ananas)", "piece", ["pineapple", "pineapples", "ananas"]),
  def("1061", "1091", "Gala apples, class I (Äpfel Gala I)", "kg", ["apples", "apple", "gala apples", "gala apple", "äpfel"]),
  def("1070", null, "Golden apples, class I (Äpfel Golden I)", "kg", ["golden apples", "golden apple", "golden delicious"]),
  def("1050", null, "Braeburn apples, class I (Äpfel Braeburn I)", "kg", ["braeburn apples", "braeburn apple", "braeburn"]),
  def("1039", null, "Boskoop apples, class I (Äpfel Boskoop I)", "kg", ["boskoop apples", "boskoop apple", "boskoop"]),
  def("1477", null, "Pink Lady apples (Äpfel Pink Lady)", "kg", ["pink lady apples", "pink lady apple", "pink lady"]),
  def("1173", null, "Williams pears, class I (Birnen Williams I)", "kg", ["pears", "pear", "williams pears", "williams pear"]),
  def("1136", null, "Conférence pears, class I (Birnen Conférence I)", "kg", ["conference pears", "conference pear", "conférence pears"]),
  def("1485", null, "Peaches (Pfirsiche)", "kg", ["peaches", "peach"]),
  def("1286", null, "Nectarines (Nektarinen)", "kg", ["nectarines", "nectarine"]),
  def("1238", null, "Apricots (Aprikosen)", "kg", ["apricots", "apricot"]),
  def("1018", "1075", "Plums (Zwetschgen)", "kg", ["plums", "plum", "zwetschgen"]),
  def("1215", null, "Cherries 24mm+ (Kirschen 24mm+)", "kg", ["cherries", "cherry"]),
  def("1012", null, "Seedless white grapes (Trauben weiss kernlos)", "kg", ["grapes", "grape", "white grapes"]),
  def("1271", null, "Strawberries, Swiss (Erdbeeren, Inland)", "kg", ["strawberries", "strawberry", "swiss strawberries"]),
  def("1270", null, "Strawberries, imported (Erdbeeren, Ausland)", "kg", ["imported strawberries"]),
  def("1277", "1127", "Raspberries (Himbeeren)", "kg", ["raspberries", "raspberry"]),
  def("1276", "1126", "Blueberries (Heidelbeeren)", "kg", ["blueberries", "blueberry"]),
  def("1027", null, "Galia melons (Melonen Galia)", "piece", ["melon", "melons", "galia melon"]),
  def("1011", "1067", "Vine tomatoes (Tomaten Rispe)", "kg", ["tomatoes", "tomato", "vine tomatoes", "vine tomato"]),
  def("1010", "1066", "Beef tomatoes (Tomaten Fleisch)", "kg", ["beef tomatoes", "beef tomato", "beefsteak tomatoes"]),
  def("1009", null, "Cherry tomatoes (Tomaten Cherry)", "kg", ["cherry tomatoes", "cherry tomato"]),
  def("1279", "1129", "Carrots (Karotten)", "kg", ["carrots", "carrot", "karotten"]),
  def("1028", "1086", "Cucumbers (Salatgurken)", "piece", ["cucumbers", "cucumber", "salatgurken"]),
  def("1015", "1073", "Courgettes (Zucchetti)", "kg", ["courgettes", "courgette", "zucchini", "zucchinis"]),
  def("1288", "1139", "Peppers (Peperoni)", "kg", ["peppers", "pepper", "bell peppers", "bell pepper", "capsicum"]),
  def("1019", "1076", "Yellow onions (Zwiebeln gelb)", "kg", ["onions", "onion", "yellow onions", "yellow onion"]),
  def("1029", "1087", "Spring onions (Bundzwiebeln)", "bunch", ["spring onions", "spring onion", "scallions", "scallion"]),
  def("1481", "1468", "Garlic, packed (Knoblauch abgepackt)", "kg", ["garlic"]),
  def("1273", "1122", "Firm-cooking potatoes (Festkochend: Linie grün)", "kg", ["potatoes", "potato", "waxy potatoes", "firm potatoes", "firm-cooking potatoes"]),
  def("1283", "1134", "Floury potatoes (Mehligkochend: Linie blau)", "kg", ["floury potatoes", "floury potato", "mashing potatoes", "baking potatoes"]),
  def("1289", "1140", "Raclette potatoes (Raclettekartoffeln)", "kg", ["raclette potatoes", "raclette potato"]),
  def("1437", null, "Sweet potatoes (Süsskartoffeln)", "kg", ["sweet potatoes", "sweet potato"]),
  def("1261", "1111", "Broccoli (Broccoli)", "kg", ["broccoli"]),
  def("1259", "1109", "Cauliflower (Blumenkohl)", "kg", ["cauliflower"]),
  def("1013", "1071", "White cabbage (Weisskabis)", "kg", ["cabbage", "white cabbage"]),
  def("1000", "1056", "Red cabbage (Rotkabis)", "kg", ["red cabbage"]),
  def("1014", "1072", "Savoy cabbage (Wirz)", "kg", ["savoy cabbage", "savoy"]),
  def("999", null, "Brussels sprouts (Rosenkohl)", "kg", ["brussels sprouts", "brussels sprout", "sprouts"]),
  def("1282", "1132", "Leeks (Lauch grün)", "kg", ["leeks", "leek"]),
  def("1280", "1130", "Celeriac (Knollensellerie)", "kg", ["celeriac", "celery root"]),
  def("1272", "1121", "Fennel (Fenchel)", "kg", ["fennel"]),
  def("1245", "1106", "Aubergines (Auberginen)", "kg", ["aubergines", "aubergine", "eggplant", "eggplants"]),
  def("1008", "1064", "Spinach (Spinat)", "kg", ["spinach"]),
  def("1001", "1057", "Rocket (Rucola)", "kg", ["rocket", "arugula"]),
  def("1264", "1114", "White mushrooms (Champignons weiss)", "kg", ["mushrooms", "mushroom", "white mushrooms", "champignons"]),
  def("1021", "1078", "Iceberg lettuce (Eisberg)", "piece", ["lettuce", "iceberg", "iceberg lettuce"]),
  def("1026", "1083", "Green butterhead lettuce (Kopfsalat grün)", "piece", ["butterhead lettuce", "green lettuce", "head lettuce"]),
  def("1025", "1082", "Kohlrabi (Kohlrabi)", "piece", ["kohlrabi"]),
  def("1030", null, "Radishes (Radieschen)", "bunch", ["radishes", "radish"]),
  def("1290", null, "Cooked beetroot (Randen gedämpft)", "kg", ["beetroot", "beetroots", "beets", "beet"]),
];

/** Sales regions. LINDAS ids: Switzerland is sales-region/1, the three language regions L4-10005..7. */
export const REGIONS: Record<string, { id: string; name: string; words: string[] }> = {
  CH: { id: "1", name: "Switzerland", words: ["", "ch", "switzerland", "swiss", "national", "schweiz", "suisse", "svizzera", "all"] },
  D: { id: "L4-10005", name: "German-speaking Switzerland (D-CH)", words: ["d-ch", "dch", "german", "german-speaking", "deutschschweiz", "zurich", "bern", "basel"] },
  F: { id: "L4-10006", name: "French-speaking Switzerland (F-CH)", words: ["f-ch", "fch", "french", "french-speaking", "romandie", "suisse romande", "geneva", "lausanne"] },
  I: { id: "L4-10007", name: "Italian-speaking Switzerland (I-CH)", words: ["i-ch", "ich", "italian", "italian-speaking", "ticino", "tessin", "svizzera italiana"] },
};

export function findRegion(raw?: string): { key: string; id: string; name: string } {
  const k = (raw ?? "").trim().toLowerCase();
  for (const [key, r] of Object.entries(REGIONS)) if (r.words.includes(k)) return { key, id: r.id, name: r.name };
  throw new InputError('region must be "Switzerland" (leave it out), "D-CH" (German-speaking), "F-CH" (French-speaking) or "I-CH" (Italian-speaking, Ticino).');
}

export interface Point { month: string; price: number; organic: boolean }

/** "2026-09" shifted by n months. */
export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function buildQuery(def: ProduceItem, regionId: string, fromMonth: string): string {
  const ids = [def.code, ...(def.organic ? [def.organic] : [])].map((n) => `<${FOAG}product/${n}>`).join(" ");
  const D = FOAG + "dimension/";
  return (
    "SELECT ?product ?month ?price ?unit WHERE {\n" +
    "  GRAPH ?g { ?obs a <https://cube.link/Observation> ;\n" +
    `    <${D}date> ?month ; <${FOAG}measure/price> ?price ; <${D}product> ?product ; <${D}unit> ?unit ;\n` +
    `    <${D}sales-region> <${FOAG}sales-region/${regionId}> .\n` +
    `    FILTER(STRSTARTS(STR(?obs), "${CUBE_OBS}"))\n` +
    `    FILTER(STR(?month) >= "${MONTH}${fromMonth}")\n` +
    `    VALUES ?product { ${ids} } }\n` +
    "} ORDER BY ?month"
  );
}

/** Minimal CSV reader (quotes, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); if (row.some((x) => x !== "")) rows.push(row); }
  return rows;
}

/** Parse the SELECT result (header: product,month,price,unit) for one item. Rows of other products, bad numbers or a different unit are dropped. */
export function parsePoints(csv: string, def: ProduceItem): Point[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];
  const head = rows[0].map((h) => h.trim());
  const ix = (n: string) => head.indexOf(n);
  for (const n of ["product", "month", "price", "unit"]) if (ix(n) < 0) throw new SourceError("BLW answer has an unexpected layout", `missing column ${n}`);
  const unitIri = FOAG + "unit/" + (def.u === "kg" ? "1" : def.u === "piece" ? "2" : "3");
  const out: Point[] = [];
  for (const r of rows.slice(1)) {
    const product = (r[ix("product")] ?? "").slice((FOAG + "product/").length);
    const month = (r[ix("month")] ?? "").replace(MONTH, "");
    const price = Number(r[ix("price")]);
    if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(price) || price <= 0) continue;
    if ((r[ix("unit")] ?? "") !== unitIri) continue;
    if (product === def.code) out.push({ month, price, organic: false });
    else if (def.organic && product === def.organic) out.push({ month, price, organic: true });
  }
  return out;
}

const chf = (v: number) => `${v.toFixed(2)} CHF`;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthWords = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const change = (from: number | undefined, to: number) =>
  from === undefined || from === 0 ? null : { change_percent: Math.round(((to - from) / from) * 1000) / 10 };

export interface ChProduceQuery { item?: string; region?: string; organic?: string; baseUrl?: string; today?: Date }

function wantsOrganic(raw?: string, item?: string): boolean {
  const s = `${raw ?? ""} ${item ?? ""}`.toLowerCase();
  return /\b(true|yes|1|organic|bio)\b/.test(s);
}

/** Pure: build the answer from the parsed points of one item. */
export function chProduceAnswer(points: Point[], def: ProduceItem | null, related: ProduceItem[], q: ChProduceQuery): PriceAnswer {
  const region = findRegion(q.region);
  const query: Record<string, unknown> = { country: "CH", item: q.item, ...(q.region?.trim() ? { region: q.region } : {}) };
  const method =
    `Switzerland produce: the monthly consumer price that the Federal Office for Agriculture (BLW) publishes for the item, ${region.name}, newest month, in CHF. ` +
    "A BLW list price for a standard retail product, not a receipt and not a count of paid prices.";
  const base = { source: INFO, query, measure: "average" as const, currency: "CHF", method, baseUrl: q.baseUrl };
  const organic = wantsOrganic(q.organic, undefined) && !!def?.organic;
  const mine = def ? points.filter((p) => p.organic === organic) : [];
  if (!def || mine.length === 0) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: def?.unit ?? "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const hint = def
      ? `BLW's data holds no ${organic ? "organic " : ""}price for "${def.label}" in the recent months we asked for.`
      : `BLW's fruit, vegetable and potato list has no standard item for "${q.item}".`;
    return { ...none, summary: `${hint} Try one of: ${exampleWords(ITEMS, 30).join(", ")}.`, extra: { available_items: exampleWords(ITEMS, 80) } };
  }
  const byMonth = new Map(mine.map((p) => [p.month, p.price]));
  const month = [...byMonth.keys()].sort().pop()!;
  const latest = byMonth.get(month)!;
  const prev = byMonth.get(shiftMonth(month, -1));
  const yearAgo = byMonth.get(shiftMonth(month, -12));
  const orgTwin = !organic && def.organic ? points.filter((p) => p.organic && p.month === month).map((p) => p.price)[0] : undefined;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = q.today ?? new Date();
  const behind = (today.getUTCFullYear() - y) * 12 + (today.getUTCMonth() + 1 - m);
  const yoy = change(yearAgo, latest);
  const mom = change(prev, latest);
  const notes: string[] = ["BLW 'list price' of a standard retail product: a posted price, not a receipt."];
  if (behind >= 4) notes.push(`Old data: the newest month BLW has published for this item is ${monthWords(month)}, ${behind} months ago.`);
  const label = `${def.label}${organic ? ", organic" : ""}`;
  return buildStatisticAnswer({
    ...base,
    value: latest,
    unit: def.unit.replace("per ", "per "),
    period: { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` },
    reference_period: month,
    note: notes.join(" "),
    evidence: { label: "Published list price", meaning: "A monthly consumer price that the Federal Office for Agriculture compiles from retail list prices of standard products; no count of prices is published." },
    describe: (v) =>
      `In ${region.name} the BLW consumer list price of "${label}" was ${chf(v)} ${def.unit} in ${monthWords(month)}.` +
      (yoy && yearAgo !== undefined
        ? yoy.change_percent === 0
          ? ` That is unchanged from ${monthWords(shiftMonth(month, -12))} (${chf(yearAgo)}).`
          : ` That is ${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than a year earlier (${chf(yearAgo)}).`
        : " No price for the same month a year earlier is available."),
    extra: {
      country_name: "Switzerland",
      item: { code: def.code, definition: def.label, unit: def.unit, organic, asked_for: q.item },
      region: region.name,
      what_this_is: "Monthly consumer list price compiled by the Federal Office for Agriculture (BLW) for a standard retail product. A posted price, not a receipt and not the price at any one shop.",
      reference_month: month,
      reference_month_label: monthWords(month),
      change_on_year_earlier: yoy && yearAgo !== undefined ? { reference_month: shiftMonth(month, -12), value: yearAgo, ...yoy } : null,
      change_on_previous_month: mom && prev !== undefined ? { reference_month: shiftMonth(month, -1), value: prev, ...mom } : null,
      ...(orgTwin !== undefined ? { organic_price_same_month: orgTwin } : {}),
      ...(def.organic && !organic ? { organic_available: 'Add organic=true (or "organic" in the item) for the organic product.' } : {}),
      other_definitions: related.map((d) => ({ item: d.words[0], definition: d.label, unit: d.unit })),
      dataset: { title: "Market figures fruit, vegetables, and potatoes - Monthly consumer prices", url: INFO.homepage },
    },
  });
}

const ATTEMPT_MS = 9000;

async function postSparql(query: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { accept: "text/csv", "content-type": "application/x-www-form-urlencoded", "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)" },
      body: new URLSearchParams({ query }).toString(),
    });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, (await res.text().catch(() => "")).slice(0, 300), res.status);
    return await res.text();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", ENDPOINT);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export async function chProducePrices(q: ChProduceQuery, today: Date = new Date()): Promise<PriceAnswer> {
  const item = q.item?.trim();
  if (!item) throw new InputError("item is required: a fruit, vegetable or potato such as 'tomatoes', 'apples', 'bananas' or 'potatoes'.");
  const region = findRegion(q.region);
  const organicWanted = wantsOrganic(q.organic, item);
  const cleaned = item.replace(/\b(organic|bio)\b/gi, " ").replace(/\s+/g, " ").trim() || item;
  const m = matchItem(ITEMS, cleaned);
  const def = m.primary as ProduceItem | null;
  if (!def) return chProduceAnswer([], null, [], { ...q, today });
  const ym = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
  const csv = await retryOnce(() => postSparql(buildQuery(def, region.id, shiftMonth(ym, -16)), ATTEMPT_MS));
  return chProduceAnswer(parsePoints(csv, def), def, m.related as ProduceItem[], { ...q, organic: organicWanted ? "true" : q.organic, today });
}
