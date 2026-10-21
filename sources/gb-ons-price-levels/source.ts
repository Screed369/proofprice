// United Kingdom: "Consumer prices price level distributions microdata" from the Office for National Statistics (ONS). Format checked
// live on 2026-10-14 through the GitHub probe and a Vercel preview. Once a month ONS publishes one .xlsx workbook per reference month,
// found through the ONS search API (https://api.beta.ons.gov.uk/v1/search) as an "adhocs" page whose file is
//   https://www.ons.gov.uk/file?uri=<page uri>/consumerpricespriceleveldistributionsmicrodata<YYYYMM>.xlsx   (about 1.8 MB)
// Tabs 3b to 3f hold, for about 200 grocery product types (COICOP divisions 1 and 2, one pack size each), one row per product and
// area: INDEX_DATE, ID_DESC, WEIGHT_SIZE, CS_ID, CS_DESC, COICOP5_ID, COICOP5_DESC, REGION_ID, REGION_DESC, MEAN, MEDIAN, MODE,
// VARIANCE, STD_DEV, Q1, Q3, MIN, MAX and then the share of observations in each price band. REGION_ID "[z]" is the whole UK;
// the others are the nine English regions, Northern Ireland, Scotland and Wales. Cells show "[x]" where there are fewer than ten
// observations or where publishing could disclose confidential information. Tab 3a is a lookup (which tab holds which product).
//
// Why not the ONS "price quotes" files: ONS no longer publishes individual price quotes for food and drink (COICOP divisions 1-2)
// since March 2026, because the food index is now built mainly from retailer scanner data. This workbook is its replacement for
// shelf-price levels. The figures are weighted summaries of the prices used to calculate CPI (local price collection plus
// scanner data); ONS publishes no count of observations, so answers carry sample_size null.
//
// We never download the workbook per request. The daily collector (harvest, on GitHub Actions) keeps the newest month in the price
// library, one item per product and pack size ("<ID_DESC>|<WEIGHT_SIZE>", mean as "<item>@mean"), one area per region ("ALL" = UK).

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError, fetchJson } from "../../lib/http";
import { periodRange } from "../../lib/adapters";
import { readLatestDay } from "../../lib/library/store";
import type { LibraryRow } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { ItemDef, exampleWords, matchItem } from "../../categories/groceries/items";
import { Cell, Sheet, readWorkbook } from "./xlsx";
import { NO_COUNT } from "../../lib/stats";

export const INFO: SourceInfo = {
  id: "gb-ons-price-levels",
  country: "GB (United Kingdom)",
  category: "groceries (shop price levels)",
  name: "Consumer prices: price level distributions of grocery products",
  publisher: "Office for National Statistics (ONS)",
  what_is_recorded:
    "For about 200 grocery, drink and tobacco product types (eggs, milk, bread, butter, cheese, chicken, mince, bananas, potatoes, rice, coffee, tea, beer, wine ...), each in one stated pack size, " +
    "the weighted median, mean, lower and upper quartile, lowest and highest shop price in a month, for the whole UK and for 12 regions and nations. Built by ONS from the prices it uses to calculate CPI: " +
    "prices recorded by price collectors in shops and online, combined with retailer scanner data. Summaries only, never an individual shop or shopper.",
  price_type: "official_statistic",
  freshness: "Monthly: ONS publishes each month's file about three to four weeks after the month ends (August 2026 appeared in late September); our copy is refreshed daily and each answer states its reference month",
  licence:
    "Open Government Licence v3.0. The ONS terms say: \"Most content on this website is subject to Crown copyright protection and is published under the Open Government Licence (OGL). " +
    "Some content is exempt from the OGL – check the list of exemptions. Reproduction of information is subject to the terms of the OGL and the UK Government Licensing Framework.\" " +
    "The OGL v3.0 lets you \"exploit the Information commercially and non-commercially for example, by combining it with other Information, or by including it in your own product or application\", " +
    "and asks that you acknowledge the source, by default with: \"Contains public sector information licensed under the Open Government Licence v3.0.\" The dataset's own page declares the OGL v3.0.",
  licence_url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  attribution:
    "Contains public sector information licensed under the Open Government Licence v3.0. Source: Office for National Statistics, Consumer Prices Price Level Distributions Microdata (official statistics in development), " +
    "https://www.ons.gov.uk/economy/inflationandpriceindices/datalist . Figures are passed on as published; ProofPrice is not endorsed by the ONS.",
  homepage: "https://www.ons.gov.uk/economy/inflationandpriceindices/datalist",
  limits:
    "One pack size per product type; the median, quartiles, lowest and highest are weighted summaries of the prices used for CPI (retailer scanner data covers about half of the grocery market, plus local price collection), " +
    "not every price in the market, and ONS warns they are likely to be biased as population measures. ONS says the monthly files should not be compared with each other (products, retailers and volumes change from month to month), " +
    "so no change on a year earlier is given. Regional figures are not published where fewer than ten observations stand behind them. ONS labels the data official statistics in development, not Accredited Official Statistics. " +
    "No count of observations is published.",
};

export const SEARCH_URL = "https://api.beta.ons.gov.uk/v1/search?q=price%20level%20distributions%20microdata&limit=20";
export const SITE_ROOT = "https://www.ons.gov.uk";
export const FILE_ROOT = "https://www.ons.gov.uk/file?uri=";
export const ONS_USER_AGENT = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

/** ONS shows "[x]" where a row has fewer than 10 observations, so every published figure rests on at least this many. It is not stored as a count: the library `n` is empty and answers report sample_size null. */
export const MIN_OBSERVATIONS = 10;
/** Months behind today after which an answer says "Old data". ONS normally lags by one to two months. */
export const OLD_AFTER_MONTHS = 5;

// ---------- regions ----------

export const NATIONAL = "ALL";

export interface Region {
  code: string;
  name: string;
  /** Other ways to name the region or nation itself. */
  words: string[];
  /** Cities and counties inside it: they map to the region and the answer says so. */
  places: string[];
}

export const REGIONS: Region[] = [
  { code: NATIONAL, name: "United Kingdom", words: ["uk", "u k", "united kingdom", "gb", "great britain", "britain", "national", "nationwide", "country", "all"], places: [] },
  { code: "E12000001", name: "North East England", words: ["north east", "northeast", "north east england"], places: ["newcastle", "sunderland", "durham", "middlesbrough", "gateshead"] },
  { code: "E12000002", name: "North West England", words: ["north west", "northwest", "north west england"], places: ["manchester", "liverpool", "preston", "blackpool", "carlisle", "lancashire", "cumbria"] },
  { code: "E12000003", name: "Yorkshire and the Humber", words: ["yorkshire", "yorkshire and the humber", "humber"], places: ["leeds", "sheffield", "bradford", "hull", "york"] },
  { code: "E12000004", name: "East Midlands", words: ["east midlands"], places: ["nottingham", "leicester", "derby", "lincoln", "northampton"] },
  { code: "E12000005", name: "West Midlands", words: ["west midlands"], places: ["birmingham", "coventry", "wolverhampton", "stoke", "stoke on trent"] },
  { code: "E12000006", name: "East of England", words: ["east of england", "east england", "east anglia"], places: ["norwich", "cambridge", "ipswich", "peterborough", "luton"] },
  { code: "E12000007", name: "London", words: ["london", "greater london"], places: [] },
  { code: "E12000008", name: "South East England", words: ["south east", "southeast", "south east england"], places: ["brighton", "southampton", "portsmouth", "oxford", "reading", "kent"] },
  { code: "E12000009", name: "South West England", words: ["south west", "southwest", "south west england"], places: ["bristol", "plymouth", "exeter", "bath", "cornwall", "devon"] },
  { code: "N99999999", name: "Northern Ireland", words: ["northern ireland", "ni"], places: ["belfast", "ulster"] },
  { code: "S99999999", name: "Scotland", words: ["scotland", "scottish"], places: ["edinburgh", "glasgow", "aberdeen", "dundee"] },
  { code: "W99999999", name: "Wales", words: ["wales", "welsh"], places: ["cardiff", "swansea", "newport"] },
];

/** "the United Kingdom", "Wales", "London": how a sentence names an area. */
export const inPlace = (r: Region) => (r.code === NATIONAL ? "the United Kingdom" : r.name);

function plain(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** "wales", "Manchester", "UK" -> the ONS area. A city or county maps to its region (ONS publishes regions, not cities) and the note says so. Throws InputError for anything else, including "England" (ONS publishes nine English regions, not England as a whole). */
export function resolveRegion(region?: string): { region: Region; note?: string } {
  const r = plain(region ?? "");
  if (!r) return { region: REGIONS[0] };
  const named = REGIONS.find((x) => plain(x.name) === r || x.words.includes(r));
  if (named) return { region: named };
  const placed = REGIONS.find((x) => x.places.includes(r));
  if (placed) return { region: placed, note: `ONS publishes prices for regions and nations, not cities or counties: "${region}" is in ${placed.name}.` };
  if (r === "england") {
    throw new InputError("ONS publishes prices for the whole UK and for nine English regions, Northern Ireland, Scotland and Wales, not for England as a whole. Give a region such as 'London' or 'North West', or leave region out for the UK.");
  }
  throw new InputError(`region must be one of: ${REGIONS.slice(1).map((x) => x.name).join(", ")} (or a large city, which maps to its region), or left out for the whole UK. Not recognised: ${region}.`);
}

// ---------- finding the newest release (pure) ----------

const MONTH_WORDS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_NAMES = MONTH_WORDS.map((m) => m.charAt(0).toUpperCase() + m.slice(1));
const RELEASE_URI = /^\/economy\/inflationandpriceindices\/adhocs\/\d+consumerpricespriceleveldistributionsmicrodata([a-z]+)(\d{4})$/i;

export interface Release {
  /** Reference month, YYYY-MM. */
  month: string;
  /** Page path on ons.gov.uk. */
  uri: string;
  title: string;
  released: string | null;
}

/** The monthly releases listed by the ONS search API, newest month first. Anything that is not a price level distributions page is ignored. */
export function releasesFromSearch(json: unknown): Release[] {
  const items = Array.isArray((json as any)?.items) ? ((json as any).items as any[]) : [];
  const out: Release[] = [];
  for (const it of items) {
    const uri = typeof it?.uri === "string" ? it.uri : "";
    const m = RELEASE_URI.exec(uri);
    if (!m) continue;
    const idx = MONTH_WORDS.indexOf(m[1].toLowerCase());
    if (idx < 0) continue;
    out.push({
      month: `${m[2]}-${String(idx + 1).padStart(2, "0")}`,
      uri,
      title: typeof it.title === "string" ? it.title : "",
      released: typeof it.release_date === "string" ? it.release_date : null,
    });
  }
  return out.sort((a, b) => b.month.localeCompare(a.month) || (b.released ?? "").localeCompare(a.released ?? ""));
}

/** The workbook's address: ONS names it after the month. */
export function fileUrl(r: Release): string {
  return `${FILE_ROOT}${r.uri}/consumerpricespriceleveldistributionsmicrodata${r.month.replace("-", "")}.xlsx`;
}

/** The download link that an ONS release page declares in its structured data ("contentUrl"), used if the usual file name ever changes. */
export function contentUrlFromPage(html: string): string | null {
  const m = /"contentUrl"\s*:\s*"([^"]+\.xlsx)"/i.exec(html);
  return m ? m[1] : null;
}

// ---------- reading the workbook (pure) ----------

export interface ParsedLevels {
  /** Reference month, YYYY-MM, from the INDEX_DATE column. */
  month: string;
  rows: DailyRow[];
  products: number;
  /** Rows ONS withheld ("[x]"). */
  withheld: number;
}

const num = (c: Cell | undefined): number | null => (typeof c === "number" && Number.isFinite(c) ? c : null);
const text = (c: Cell | undefined): string => (c === null || c === undefined ? "" : String(c).trim());

function libraryRow(area: string, item: string, n: number, median: number, low: number, high: number, min: number, max: number): DailyRow {
  return { area, item, n, median, low, high, min, max };
}

/**
 * Every data tab (a header row starting INDEX_DATE) of the workbook into library rows: for each product and area the median (low = lower
 * quartile, high = upper quartile, min, max) as item "<ID_DESC>|<WEIGHT_SIZE>" and the mean as "<item>@mean". Columns are found by their
 * header names. Rows ONS withheld ("[x]") are skipped. The newest INDEX_DATE wins if a file ever holds more than one month.
 */
export function parsePriceLevels(sheets: Sheet[]): ParsedLevels {
  type Found = { month: string; area: string; item: string; mean: number | null; median: number; q1: number; q3: number; min: number; max: number };
  const found: Found[] = [];
  let withheld = 0;
  for (const sheet of sheets) {
    const hi = sheet.rows.findIndex((r) => text(r[0]) === "INDEX_DATE");
    if (hi < 0) continue;
    const col = new Map<string, number>();
    sheet.rows[hi].forEach((h, i) => {
      const k = text(h);
      if (k && !col.has(k)) col.set(k, i);
    });
    const need = ["INDEX_DATE", "ID_DESC", "WEIGHT_SIZE", "REGION_ID", "MEDIAN", "Q1", "Q3", "MIN", "MAX"];
    const lacking = need.filter((k) => !col.has(k));
    if (lacking.length) throw new SourceError(`ONS price level tab ${sheet.name} lacks columns: ${lacking.join(", ")}`);
    const at = (r: Cell[], k: string) => r[col.get(k)!];
    for (const r of sheet.rows.slice(hi + 1)) {
      const date = num(at(r, "INDEX_DATE"));
      const id = text(at(r, "ID_DESC"));
      if (date === null || !id) continue;
      const m = /^(\d{4})(0[1-9]|1[0-2])$/.exec(String(date));
      if (!m) continue;
      const median = num(at(r, "MEDIAN"));
      const q1 = num(at(r, "Q1"));
      const q3 = num(at(r, "Q3"));
      const min = num(at(r, "MIN"));
      const max = num(at(r, "MAX"));
      if (median === null || median <= 0 || q1 === null || q3 === null || min === null || max === null) {
        withheld++;
        continue;
      }
      const regionId = text(at(r, "REGION_ID"));
      found.push({
        month: `${m[1]}-${m[2]}`,
        area: regionId === "[z]" || !regionId ? NATIONAL : regionId,
        item: `${id}|${text(at(r, "WEIGHT_SIZE"))}`,
        mean: col.has("MEAN") ? num(at(r, "MEAN")) : null,
        median,
        q1,
        q3,
        min,
        max,
      });
    }
  }
  const month = found.reduce((a, f) => (f.month > a ? f.month : a), "");
  const rows: DailyRow[] = [];
  const products = new Set<string>();
  for (const f of found) {
    if (f.month !== month) continue;
    rows.push(libraryRow(f.area, f.item, NO_COUNT, f.median, f.q1, f.q3, f.min, f.max));
    if (f.mean !== null && f.mean > 0) rows.push(libraryRow(f.area, `${f.item}@mean`, NO_COUNT, f.mean, f.mean, f.mean, f.mean, f.mean));
    products.add(f.item);
  }
  rows.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
  return { month, rows, products: products.size, withheld };
}

// ---------- the daily collector ----------

export interface HarvestIo {
  /** The ONS search API response (JSON). */
  search(): Promise<unknown>;
  /** The workbook at a URL, or null if it cannot be fetched or is not a workbook. */
  workbook(url: string): Promise<Sheet[] | null>;
  /** The HTML of an ONS page. */
  page(url: string): Promise<string>;
}

export const defaultIo: HarvestIo = {
  search: () => fetchJson(SEARCH_URL, { headers: { "user-agent": ONS_USER_AGENT } }, 30000),
  workbook: async (url) => {
    try {
      const res = await fetch(url, { headers: { "user-agent": ONS_USER_AGENT }, signal: AbortSignal.timeout(120000) });
      if (!res.ok) return null;
      return readWorkbook(Buffer.from(await res.arrayBuffer()));
    } catch {
      return null;
    }
  },
  page: async (url) => {
    const res = await fetch(url, { headers: { "user-agent": ONS_USER_AGENT }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new SourceError(`ONS page returned HTTP ${res.status}`);
    return res.text();
  },
};

/** Download the newest price level distributions workbook (falling back to the one before it if the newest cannot be read) and return its figures as one library month. */
export async function gbHarvest(io: HarvestIo = defaultIo): Promise<HarvestResult> {
  const releases = releasesFromSearch(await io.search());
  if (!releases.length) throw new SourceError("The ONS search lists no price level distributions release");
  const problems: string[] = [];
  for (const rel of releases.slice(0, 3)) {
    let sheets = await io.workbook(fileUrl(rel));
    if (!sheets) {
      const href = contentUrlFromPage(await io.page(SITE_ROOT + rel.uri).catch(() => ""));
      if (href) sheets = await io.workbook(href);
    }
    if (!sheets) {
      problems.push(`${rel.month}: workbook not available`);
      continue;
    }
    const parsed = parsePriceLevels(sheets);
    if (!parsed.rows.length) {
      problems.push(`${rel.month}: no usable rows`);
      continue;
    }
    return {
      date: `${parsed.month}-01`,
      currency: "GBP",
      unit: "per pack size or weight in the item key",
      rows: parsed.rows,
      note:
        `ONS price level distributions for ${parsed.month}: ${parsed.products} product types, medians with lower and upper quartile (low/high), lowest and highest (min/max); the mean is held as item@mean. ` +
        `${parsed.withheld} product-area rows were withheld by ONS ([x]). ONS publishes no count of observations: the library stores no count.`,
    };
  }
  throw new SourceError(`Could not read an ONS price level distributions workbook (${problems.join("; ")})`);
}

// ---------- the items: everyday words -> ONS product types ----------

const D = (code: string, label: string, words: string): ItemDef => ({ code, label, unit: "", words: words.split("|") });

/** Everyday words for the product types people ask about, in priority order (the first entry that lists a word is its default). code = ONS ID_DESC. Other product types are found by their own ONS names. */
export const CURATED: ItemDef[] = [
  D("EGGS - FREE-RANGE", "Free-range eggs", "eggs|egg|free range eggs|dozen eggs|12 eggs|large eggs"),
  D("MILK - COW'S (WHOLE, FRESH)", "Whole milk, fresh", "milk|whole milk|full fat milk|fresh milk|cow milk|4 pints of milk|pint of milk"),
  D("MILK - COW'S (SEMI-SKIMMED, FRESH)", "Semi-skimmed milk, fresh", "semi skimmed milk|semi skimmed|semiskimmed milk|low fat milk|lowfat milk|reduced fat milk|2 pints of milk"),
  D("MILK - OAT", "Oat milk", "oat milk|oat drink"),
  D("MILK - FLAVOURED", "Flavoured milk", "flavoured milk|chocolate milk|milkshake"),
  D("BUTTER - DAIRY (BLOCK OR TUB)", "Butter, block or tub", "butter|block of butter|salted butter|unsalted butter"),
  D("BUTTER - DAIRY (SPREADABLE)", "Butter, spreadable", "spreadable butter"),
  D("MARGARINE - VEGETABLE", "Vegetable margarine", "margarine|marge"),
  D("CHEESE - CHEDDAR", "Cheddar cheese", "cheese|cheddar|cheddar cheese|block of cheese"),
  D("CHEESE - BRIE", "Brie", "brie"),
  D("CHEESE - REGIONAL (E.G. CHESHIRE, RED LEICESTER)", "Regional cheese (e.g. Cheshire, Red Leicester)", "red leicester|cheshire cheese|regional cheese|leicester cheese"),
  D("CHEESE - PARMESAN AND SIMILAR PRODUCTS", "Parmesan and similar cheese", "parmesan|parmigiano"),
  D("CHEESE - SPREADABLE", "Spreadable cheese", "cream cheese|spreadable cheese|soft cheese"),
  D("CREAM - POURING AND COOKING (E.G. SINGLE, WHIPPING)", "Cream, pouring and cooking", "cream|double cream|single cream|whipping cream"),
  D("YOGHURT - FLAVOURED", "Yoghurt, flavoured", "yoghurt|yogurt|flavoured yoghurt"),
  D("BREAD - SLICED WHITE", "Sliced white bread", "bread|white bread|sliced bread|sliced white bread|loaf|loaf of bread|white loaf"),
  D("BREAD - SLICED WHOLEMEAL OR BROWN", "Sliced wholemeal or brown bread", "brown bread|wholemeal bread|wholemeal|wholegrain bread|whole wheat bread|sliced brown bread"),
  D("BREAD - UNSLICED WHITE", "Unsliced white bread", "unsliced bread|unsliced white bread|crusty loaf|bloomer|cob"),
  D("BREAD - ROLLS, BAPS OR BUNS", "Bread rolls, baps or buns", "rolls|bread rolls|baps|buns|burger buns"),
  D("RICE - BASMATI OR JASMINE", "Basmati or jasmine rice", "rice|basmati rice|jasmine rice|long grain rice"),
  D("PASTA - DRY", "Dry pasta", "pasta|dry pasta|spaghetti|penne|fusilli|macaroni"),
  D("FLOUR - SELF-RAISING", "Self-raising flour", "flour|self raising flour|plain flour"),
  D("SUGAR - WHITE", "White sugar", "sugar|white sugar|granulated sugar"),
  D("OATS OR PORRIDGE", "Oats or porridge", "oats|porridge|porridge oats"),
  D("CEREAL - NON-SUGARY", "Breakfast cereal, non-sugary", "cereal|breakfast cereal|cornflakes"),
  D("CEREAL - SUGARY", "Breakfast cereal, sugary", "sugary cereal"),
  D("BAKED BEANS", "Baked beans", "baked beans|beans"),
  D("PEANUT BUTTER", "Peanut butter", "peanut butter"),
  D("JAM OR CONSERVE", "Jam or conserve", "jam|marmalade|conserve"),
  D("HONEY", "Honey", "honey"),
  D("OIL - OLIVE", "Olive oil", "olive oil|oil|cooking oil"),
  D("OIL - RAPESEED", "Rapeseed oil", "rapeseed oil|vegetable oil"),
  D("CONDIMENTS - TOMATO KETCHUP", "Tomato ketchup", "ketchup|tomato ketchup"),
  D("CONDIMENTS - MAYONNAISE", "Mayonnaise", "mayonnaise|mayo"),
  D("TOMATOES - CANNED OR JARRED", "Canned tomatoes", "canned tomatoes|tinned tomatoes|chopped tomatoes"),
  D("SOUP - CANNED OR TINNED", "Canned soup", "soup|canned soup|tinned soup"),
  D("HOUMOUS", "Houmous", "houmous|hummus"),
  D("CHICKEN - WHOLE", "Whole chicken", "chicken|whole chicken|roast chicken|fresh chicken"),
  D("CHICKEN - FILLET OR STEAK", "Chicken fillet or steak", "chicken breast|chicken breasts|chicken fillet|chicken fillets|chicken steak"),
  D("CHICKEN - NUGGETS", "Chicken nuggets", "nuggets|chicken nuggets"),
  D("BEEF - MINCED OR DICED", "Minced or diced beef", "beef mince|mince|minced beef|ground beef|diced beef|beef|stewing beef"),
  D("BEEF - STEAK OR CHOPS", "Beef steak or chops", "steak|beef steak|sirloin|sirloin steak|rump steak|fillet steak"),
  D("BEEF - JOINTS", "Beef joint", "beef joint|roast beef|joint of beef|topside"),
  D("BEEF - BURGERS", "Beef burgers", "burgers|beef burgers|burger"),
  D("PORK SAUSAGES", "Pork sausages", "sausages|sausage|pork sausages"),
  D("PORK - BACON (E.G. JOINT, RASHER)", "Bacon", "bacon|bacon rashers|rashers"),
  D("PORK - STEAK OR CHOPS", "Pork steak or chops", "pork|pork chops|pork chop|pork steak"),
  D("PORK - GAMMON (E.G. JOINT, RASHER)", "Gammon", "gammon|gammon joint"),
  D("PORK OR HAM - COOKED (E.G. SLICES, CHUNKS, OR PIECES)", "Cooked pork or ham", "ham|cooked ham|sliced ham"),
  D("LAMB - STEAKS, CHOPS OR FILLETS", "Lamb steaks, chops or fillets", "lamb|lamb chops|lamb steak"),
  D("FISH - FRESH SALMON", "Fresh salmon", "salmon|fresh salmon|salmon fillet"),
  D("FISH - FRESH COD", "Fresh cod", "cod|fresh cod|cod fillet"),
  D("FISH - CANNED TUNA", "Canned tuna", "tuna|canned tuna|tinned tuna"),
  D("FISH - SMOKED SALMON OR TROUT", "Smoked salmon or trout", "smoked salmon"),
  D("SEAFOOD - FROZEN PRAWNS AND SHRIMPS", "Frozen prawns and shrimps", "prawns|frozen prawns|shrimp"),
  D("FISH - BREADED OR BATTERED (E.G. FINGERS AND GOUJONS)", "Breaded or battered fish (fingers, goujons)", "fish fingers|fish finger"),
  D("BANANAS", "Bananas", "bananas|banana"),
  D("APPLES - NOT COOKING", "Eating apples", "apples|apple|eating apples"),
  D("PEARS", "Pears", "pears|pear"),
  D("ORANGES", "Oranges", "oranges|orange"),
  D("LEMONS", "Lemons", "lemons|lemon"),
  D("GRAPES", "Grapes", "grapes|grape"),
  D("STRAWBERRIES", "Strawberries", "strawberries|strawberry"),
  D("BLUEBERRIES", "Blueberries", "blueberries|blueberry"),
  D("AVOCADOS", "Avocados", "avocados|avocado"),
  D("POTATOES - WHITE", "White potatoes", "potatoes|potato|white potatoes"),
  D("POTATOES - BAKING (EXCL. FROZEN)", "Baking potatoes", "baking potatoes|jacket potatoes"),
  D("POTATOES - BABY, NEW OR SALAD", "Baby, new or salad potatoes", "new potatoes|baby potatoes|salad potatoes"),
  D("POTATOES - SWEET", "Sweet potatoes", "sweet potatoes|sweet potato"),
  D("TOMATOES", "Tomatoes, fresh", "tomatoes|tomato|fresh tomatoes"),
  D("CARROTS", "Carrots", "carrots|carrot"),
  D("ONIONS", "Onions", "onions|onion"),
  D("CUCUMBER", "Cucumber", "cucumber"),
  D("LETTUCE", "Lettuce", "lettuce"),
  D("BROCCOLI", "Broccoli", "broccoli"),
  D("CAULIFLOWER", "Cauliflower", "cauliflower"),
  D("CABBAGE", "Cabbage", "cabbage"),
  D("PEPPERS", "Peppers", "peppers|pepper"),
  D("MUSHROOMS", "Mushrooms", "mushrooms|mushroom"),
  D("PEAS - FROZEN", "Frozen peas", "peas|frozen peas"),
  D("CRISPS - POTATO, INDIVIDUAL PACKS", "Potato crisps, individual packs", "crisps|potato crisps|packet of crisps"),
  D("FROZEN POTATO CHIPS AND WEDGES (INCL. SWEET)", "Frozen potato chips and wedges", "chips|frozen chips|oven chips|fries"),
  D("COFFEE - INSTANT", "Instant coffee", "coffee|instant coffee"),
  D("COFFEE - PODS OR CAPSULES", "Coffee pods or capsules", "coffee pods|coffee capsules"),
  D("TEA - UNFLAVOURED, BAGS", "Tea bags, unflavoured", "tea|tea bags|teabags|black tea"),
  D("COLA - FULL SUGAR, BOTTLES", "Cola, full sugar, bottles", "cola|coke|fizzy drink|soft drink|soda"),
  D("FRUIT JUICE - NOT FROM CONCENTRATE", "Fruit juice, not from concentrate", "fruit juice|juice|orange juice"),
  D("WATER - STILL", "Still water", "water|still water|bottled water"),
  D("BEER - LAGER", "Lager (multipack)", "beer|lager"),
  D("BEER - ALE (EXCL. PALE ALES AND IPAS)", "Ale, bottled", "ale|bottled ale"),
  D("BEER - STOUT/PORTER", "Stout or porter", "stout|guinness|porter"),
  D("BEER - MILD (E.G. BITTER, PALE ALE, IPAS)", "Bitter, pale ale or IPA (multipack)", "bitter|pale ale|ipa"),
  D("WINE - RED", "Red wine", "wine|red wine"),
  D("WINE - WHITE", "White wine", "white wine"),
  D("WINE - ROSE", "Rosé wine", "rose wine|rose"),
  D("WINE - SPARKLING (INCL. PROSECCO)", "Sparkling wine (incl. prosecco)", "prosecco|sparkling wine"),
  D("CHAMPAGNE", "Champagne", "champagne"),
  D("SPIRITS - WHISKY", "Whisky", "whisky|whiskey|scotch"),
  D("SPIRITS - GIN", "Gin", "gin"),
  D("SPIRITS - VODKA", "Vodka", "vodka"),
  D("SPIRITS - RUM", "Rum", "rum"),
  D("SPIRITS - BRANDY AND COGNAC", "Brandy and cognac", "brandy|cognac"),
  D("CIDER - APPLE", "Apple cider", "cider|apple cider"),
  D("CHOCOLATE - PLAIN OR FLAVOURED", "Chocolate, plain or flavoured", "chocolate|chocolate bar"),
  D("ICE CREAM - TUBS (INCL. YOGHURT)", "Ice cream tubs", "ice cream"),
  D("BISCUITS - SWEET (EXCL. COOKIES)", "Sweet biscuits", "biscuits|biscuit"),
  D("PIZZA", "Pizza", "pizza"),
  D("BABY FORMULA", "Baby formula", "baby formula|formula milk|infant formula"),
];

/** "OIL - RAPESEED" -> "Oil, rapeseed" for a product type that has no everyday-word entry. */
export function prettyName(idDesc: string): string {
  const s = idDesc.toLowerCase().replace(/ - /g, ", ").replace(/\bipas\b/g, "IPAs").replace(/\bipa\b/g, "IPA");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "12 pack" -> "pack of 12"; "1000 g" -> "1 kg"; "2272 ml" -> "2272 ml (4 pints)"; "each" -> "each". */
export function sizeWords(size: string): string {
  const s = size.trim();
  if (/^each$/i.test(s)) return "each";
  let m = /^(\d+)\s*pack$/i.exec(s);
  if (m) return `pack of ${m[1]}`;
  m = /^(\d+(?:\.\d+)?)\s*g$/i.exec(s);
  if (m) {
    const g = Number(m[1]);
    return g >= 1000 && g % 1000 === 0 ? `${g / 1000} kg` : `${g} g`;
  }
  m = /^(\d+(?:\.\d+)?)\s*ml$/i.exec(s);
  if (m) {
    const ml = Number(m[1]);
    if (ml >= 1000 && ml % 1000 === 0) return ml === 1000 ? "1 litre" : `${ml / 1000} litres`;
    return ml % 568 === 0 ? `${ml} ml (${ml / 568} ${ml === 568 ? "pint" : "pints"})` : `${ml} ml`;
  }
  return s;
}

/** The unit text for a price: "per kg", "per pack of 12", "each". */
export function unitFor(size: string): string {
  const w = sizeWords(size);
  if (w === "each") return "each";
  return `per ${w.replace(/^1 (kg|litre)$/, "$1")}`;
}

// ---------- the newest month held in the price library ----------

export interface Stat {
  mean: number | null;
  median: number;
  q1: number;
  q3: number;
  min: number;
  max: number;
}

export interface Product {
  idDesc: string;
  size: string;
  byArea: Map<string, Stat>;
}

export interface Held {
  /** Library date, YYYY-MM-01. */
  date: string;
  month: string;
  /** ID_DESC -> product. */
  products: Map<string, Product>;
}

/** Group the library's newest day into products: "<ID_DESC>|<WEIGHT_SIZE>" rows hold the median, "...@mean" rows the mean. */
export function indexDay(day: { date: string; rows: LibraryRow[] }): Held {
  const products = new Map<string, Product>();
  const means = new Map<string, number>();
  for (const r of day.rows) {
    if (r.item.endsWith("@mean")) means.set(`${r.area}\u0000${r.item.slice(0, -5)}`, r.median);
  }
  for (const r of day.rows) {
    if (r.item.endsWith("@mean")) continue;
    const cut = r.item.lastIndexOf("|");
    if (cut < 0) continue;
    const idDesc = r.item.slice(0, cut);
    const size = r.item.slice(cut + 1);
    let p = products.get(idDesc);
    if (!p) products.set(idDesc, (p = { idDesc, size, byArea: new Map() }));
    p.byArea.set(r.area, { mean: means.get(`${r.area}\u0000${r.item}`) ?? null, median: r.median, q1: r.low, q3: r.high, min: r.min, max: r.max });
  }
  return { date: day.date, month: day.date.slice(0, 7), products };
}

/** The curated everyday-word entries that ONS currently publishes, then every other product type under its own ONS name. */
export function defsFor(held: Held): ItemDef[] {
  const curated = CURATED.filter((d) => held.products.has(d.code));
  const known = new Set(curated.map((d) => d.code));
  const rest = [...held.products.keys()]
    .filter((id) => !known.has(id))
    .sort()
    .map((id) => ({ code: id, label: prettyName(id), unit: "", words: [id.toLowerCase()] }));
  return [...curated, ...rest];
}

// ---------- the answer (pure) ----------

export interface GbReading {
  def: ItemDef;
  product: Product;
  region: Region;
  stat: Stat;
  month: string;
  /** The same item in every area ONS published it for. */
  areas: { region: Region; stat: Stat }[];
}

export interface GbQuery {
  item: string;
  region?: string;
  baseUrl?: string;
  today?: Date;
}

const gbp = (v: number) => `£${v.toFixed(2)}`;

export function monthWords(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : month;
}

export function monthsBehind(month: string, today: Date): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? today.getUTCFullYear() * 12 + today.getUTCMonth() - (Number(m[1]) * 12 + Number(m[2]) - 1) : 0;
}

/** "Free-range eggs, pack of 12": the product type and the one pack size ONS prices it in. */
export function definitionOf(def: ItemDef, size: string): string {
  return `${def.label}, ${sizeWords(size)}`;
}

export function gbMethod(): string {
  return (
    "The Office for National Statistics publishes each month the prices behind its consumer price index for about 200 grocery product types, as summaries per product and pack size: the weighted median, mean, " +
    "lower and upper quartile, lowest and highest price, for the whole UK and for 12 regions and nations. The prices come from price collectors in shops and online combined with retailer scanner data. " +
    "ProofPrice copies the file once a day and returns the published median for the newest month, unchanged, with the other published statistics alongside. ONS publishes no count of observations " +
    "(it withholds any figure with fewer than ten) and advises against comparing months, so there is no change on a year earlier. These are shelf prices used for the index, not receipts."
  );
}

const CAVEAT_NOTE =
  "ONS labels these official statistics in development. They describe the prices used to calculate CPI (retailer scanner data, about half of the grocery market, plus local price collection), not every price in the market, and ONS advises against comparing months.";

const NO_YEAR_ON_YEAR =
  "ONS says its monthly price-level files should not be used for direct comparisons between months, because the mix of products, retailers and transaction volumes changes. For the change in prices over a year, see ONS consumer price inflation statistics.";

export function gbAnswer(
  reading: GbReading | null,
  def: ItemDef | null,
  related: { def: ItemDef; size: string }[],
  q: GbQuery,
  held: Held | null,
  regionAsked: Region,
  regionNote?: string,
): PriceAnswer {
  const query: Record<string, unknown> = { country: "GB", item: q.item, ...(q.region ? { region: q.region } : {}) };
  const base = { source: INFO, query, measure: "median" as const, currency: "GBP", method: gbMethod(), baseUrl: q.baseUrl };

  if (!def || !reading) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const product = def && held ? held.products.get(def.code) : undefined;
    const when = held ? ` for ${monthWords(held.month)}` : "";
    const hint = def
      ? `ONS publishes no figure${when} for "${definitionOf(def, product?.size ?? "")}" in ${inPlace(regionAsked)} (it withholds figures with fewer than ten observations)${regionAsked.code === NATIONAL ? "" : "; try the UK figure by leaving region out"}.`
      : `ONS's price level data has no product type for "${q.item}".`;
    return {
      ...none,
      summary: `${hint} Try one of: ${exampleWords(held ? defsFor(held) : CURATED, 24).join(", ")}.`,
      extra: {
        available_items: exampleWords(held ? defsFor(held) : CURATED, 60),
        ...(product ? { available_regions: [...product.byArea.keys()].map((c) => REGIONS.find((r) => r.code === c)?.name ?? c) } : {}),
        ...(regionNote ? { region_note: regionNote } : {}),
      },
    };
  }

  const r = reading;
  const today = q.today ?? new Date();
  const behind = monthsBehind(r.month, today);
  const definition = definitionOf(r.def, r.product.size);
  const unit = unitFor(r.product.size);
  const s = r.stat;
  const notes = [CAVEAT_NOTE];
  if (behind >= OLD_AFTER_MONTHS) notes.push(`Old data: the newest ONS file we hold is for ${monthWords(r.month)}, ${behind} months ago.`);
  if (regionNote) notes.push(regionNote);

  const extra: Record<string, unknown> = {
    country_name: "United Kingdom",
    area: { code: r.region.code, name: r.region.name },
    item: { ons_product_type: r.product.idDesc, definition, pack: sizeWords(r.product.size), unit, asked_for: q.item },
    what_this_is:
      "Weighted summary of the shop prices ONS uses to calculate CPI for this product type: local price collection (in shops and online) combined with retailer scanner data. Not a receipt and not the price at any one shop.",
    reference_month: r.month,
    reference_month_label: monthWords(r.month),
    statistics: {
      median: s.median,
      mean: s.mean,
      lower_quartile: s.q1,
      upper_quartile: s.q3,
      lowest: s.min,
      highest: s.max,
      note: "Lower and upper quartile are the 25th and 75th percentiles: half of the weighted prices lie between them. Lowest and highest are after ONS removed outliers.",
    },
    observations: "At least 10 (ONS withholds any figure with fewer than 10 observations). The exact number is not published.",
    change_on_year_earlier: null,
    change_on_year_earlier_unavailable: NO_YEAR_ON_YEAR,
    other_areas: r.areas.filter((a) => a.region.code !== r.region.code).map((a) => ({ area: a.region.name, code: a.region.code, median: a.stat.median, mean: a.stat.mean })),
    other_definitions: related.map((d) => ({ item: d.def.words[0], definition: definitionOf(d.def, d.size), unit: unitFor(d.size) })),
    ons_cautions: [
      "Official statistics in development, not Accredited Official Statistics.",
      "Regional figures describe prices within the region and do not add up to the national figure (ONS notes 15 and 16).",
      "The mean here is not comparable with the average prices in the ONS Shopping Prices Comparison Tool (note 18).",
      "Quartiles, lowest and highest are likely to be biased as population measures because the data were designed to measure inflation (notes 20 and 21).",
    ],
    dataset: { name: "ONS Consumer Prices Price Level Distributions Microdata", url: INFO.homepage },
    ...(regionNote ? { region_note: regionNote } : {}),
  };

  const where = inPlace(r.region);
  return buildStatisticAnswer({
    ...base,
    value: s.median,
    unit,
    period: periodRange(r.month) ?? { from: null, to: null },
    reference_period: r.month,
    note: notes.join(" "),
    describe: (v) =>
      `In ${where} the median shop price of "${definition}" was ${gbp(v)} in ${monthWords(r.month)} ` +
      `(half of the prices ran from ${gbp(s.q1)} to ${gbp(s.q3)}${s.mean !== null ? `; mean ${gbp(s.mean)}` : ""}; ONS consumer price index data from price collectors and retailer scanner data, not receipts). ` +
      "ONS advises against comparing these monthly figures with other months, so no change on a year earlier is given." +
      (behind >= OLD_AFTER_MONTHS ? ` Old data: the newest ONS file we hold is for ${monthWords(r.month)}.` : ""),
    extra,
  });
}

// ---------- the request ----------

export async function gbOnsPriceLevels(input: GbQuery): Promise<PriceAnswer> {
  const item = input.item?.trim();
  if (!item) throw new InputError("item is required: an everyday item such as 'eggs', 'milk' or 'butter'.");
  const { region, note } = resolveRegion(input.region);
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("Not yet available: ProofPrice collects the ONS price level data daily; data appears after the next collection.");
  const held = indexDay(day);
  const m = matchItem(defsFor(held), item);
  if (!m.primary) return gbAnswer(null, null, [], input, held, region, note);
  const product = held.products.get(m.primary.code)!;
  const stat = product.byArea.get(region.code);
  if (!stat) return gbAnswer(null, m.primary, [], input, held, region, note);
  const areas = REGIONS.filter((r) => product.byArea.has(r.code)).map((r) => ({ region: r, stat: product.byArea.get(r.code)! }));
  const related = m.related.map((d) => ({ def: d, size: held.products.get(d.code)?.size ?? "" }));
  return gbAnswer({ def: m.primary, product, region, stat, month: held.month, areas }, m.primary, related, input, held, region, note);
}
