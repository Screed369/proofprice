// France wholesale fruit and vegetable prices: FranceAgriMer, Réseau des Nouvelles des Marchés (RNM).
// Format checked 2026-10-22 from GitHub's servers (probe): GET https://rnm.franceagrimer.fr/prix?CAROTTE = 200 text/html UTF-8, ~51 KB, server-rendered, no key.
// One block per market: <tr class="staN"><td colspan="6"><strong><a href="/prix?M0096:MARCHE">Market name</a></strong> ... march&eacute; du 20/10/26 (cours Marché de producteurs)
//   <small>unit&eacute; : <span class="euro">&euro; HT</span> le kg* </small></td></tr>, then one <tr> per product label:
//   <td class="tdcotl"><a ...> CAROTTE Rhône-Alpes </a></td><td class="tdcotr"><strong>1.15</strong></td><td class="tdcotc"> =</td> mini, maxi, quantity.
// Stages (cours): Marché de producteurs, Expédition, Import, Grossistes, Détail. We drop Détail (shop prices), organic lines and lines not priced per kg (bunches, pieces).

import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";

export const BASE_URL = "https://rnm.franceagrimer.fr/prix?";
export const LEGAL_URL = "https://rnm.franceagrimer.fr/rnm/infolegal.shtml";

export const INFO: SourceInfo = {
  id: "fr-rnm-wholesale",
  country: "FR (France)",
  category: "wholesale-fresh-food (fruit and vegetables)",
  name: "RNM: wholesale and producer-market prices of fruit and vegetables",
  publisher: "FranceAgriMer, Réseau des Nouvelles des Marchés (RNM)",
  what_is_recorded:
    "For each market or production basin and day, the average price (and the lowest and highest) of a fruit or vegetable label as quoted by RNM surveyors, in euros excluding VAT per kilogram, at the producer-market, dispatch, import and wholesale stages.",
  price_type: "posted_price",
  freshness: "Daily on market days (each market line carries its own date); each answer states the dates its quotes apply to",
  licence: "FranceAgriMer licence ouverte: reuse allowed, commercial included, if the data is unaltered and the source is named",
  licence_url: LEGAL_URL,
  attribution:
    "Source: FranceAgriMer, Réseau des Nouvelles des Marchés (RNM), rnm.franceagrimer.fr. Prices in euros excluding VAT per kilogram; the median across market lines is calculated by ProofPrice from the published quotes.",
  homepage: "https://rnm.franceagrimer.fr/",
  limits:
    "Quotes collected by surveyors at markets and shippers, not individual sales and not shop prices. Posted, not paid prices. " +
    "Only lines priced per kilogram are used (bunches and pieces are left out), organic lines are left out, retail (Détail) lines are left out. Government may change the pages.",
};

export const METHOD =
  "France wholesale fruit and vegetables: for the product we read FranceAgriMer's RNM price page, keep the quotes per kilogram at the producer-market, dispatch, import and wholesale stages " +
  "(not retail, not organic, not bunches or pieces) from the last 7 days before the newest quote, and give the median of the quoted average prices across the market lines, with the lowest and highest quote. " +
  "These are posted market quotes, so there is no sample size and the range is not a 10th to 90th percentile.";

// ---------- products ----------

/** Product slugs of rnm.franceagrimer.fr/prix?<SLUG> (from the vegetable and fruit index pages, 2026-10-22). Only products priced per kg in practice. */
export const SLUGS = [
  "AIL", "ARTICHAUT", "ASPERGE", "AUBERGINE", "AVOCAT", "BETTE", "BETTERAVE-ROUGE", "CAROTTE", "CELERI-BRANCHE", "CELERI-RAVE", "CHAMPIGNON-DE-PARIS", "CHICOREE",
  "CHOU", "CHOU-DE-BRUXELLES", "CHOU-FLEUR", "CONCOMBRE", "COURGE", "COURGETTE", "ECHALOTE", "ENDIVE", "EPINARD", "FENOUIL", "HARICOT", "HARICOT-VERT", "LAITUE",
  "MACHE", "MELON", "NAVET", "OIGNON", "PANAIS", "PASTEQUE", "PATATE-DOUCE", "POIREAU", "POIS", "POIVRON", "POMME-DE-TERRE", "POTIRON", "RADIS", "SALADES", "TOMATE", "TOPINAMBOUR",
  "ABRICOT", "AMANDE", "ANANAS", "BANANE", "CASSIS", "CERISE", "CITRON", "CLEMENTINE", "COING", "FIGUE", "FRAISE", "FRAMBOISE", "KIWI", "MANDARINE", "MANGUE", "MURE", "MYRTILLE",
  "NECTARINE", "NOISETTE", "NOIX", "ORANGE", "PECHE", "POIRE", "POMELOS", "POMME", "PRUNE", "RAISIN",
] as const;

/** English (and a few French) words to slugs. */
export const ALIASES: Record<string, string> = {
  garlic: "AIL", artichoke: "ARTICHAUT", asparagus: "ASPERGE", aubergine: "AUBERGINE", eggplant: "AUBERGINE", avocado: "AVOCAT", chard: "BETTE", beetroot: "BETTERAVE-ROUGE", beet: "BETTERAVE-ROUGE",
  carrot: "CAROTTE", carrots: "CAROTTE", celery: "CELERI-BRANCHE", celeriac: "CELERI-RAVE", mushroom: "CHAMPIGNON-DE-PARIS", mushrooms: "CHAMPIGNON-DE-PARIS", chicory: "CHICOREE",
  cabbage: "CHOU", "brussels sprouts": "CHOU-DE-BRUXELLES", sprouts: "CHOU-DE-BRUXELLES", cauliflower: "CHOU-FLEUR", cucumber: "CONCOMBRE", squash: "COURGE", pumpkin: "POTIRON",
  courgette: "COURGETTE", zucchini: "COURGETTE", shallot: "ECHALOTE", shallots: "ECHALOTE", endive: "ENDIVE", spinach: "EPINARD", fennel: "FENOUIL", beans: "HARICOT", "green beans": "HARICOT-VERT",
  "green bean": "HARICOT-VERT", lettuce: "LAITUE", "lamb's lettuce": "MACHE", melon: "MELON", turnip: "NAVET", onion: "OIGNON", onions: "OIGNON", parsnip: "PANAIS", watermelon: "PASTEQUE",
  "sweet potato": "PATATE-DOUCE", leek: "POIREAU", leeks: "POIREAU", peas: "POIS", pepper: "POIVRON", peppers: "POIVRON", "bell pepper": "POIVRON", potato: "POMME-DE-TERRE", potatoes: "POMME-DE-TERRE",
  radish: "RADIS", salad: "SALADES", salads: "SALADES", tomato: "TOMATE", tomatoes: "TOMATE", "jerusalem artichoke": "TOPINAMBOUR",
  apricot: "ABRICOT", almond: "AMANDE", pineapple: "ANANAS", banana: "BANANE", bananas: "BANANE", blackcurrant: "CASSIS", cherry: "CERISE", cherries: "CERISE", lemon: "CITRON", lemons: "CITRON",
  clementine: "CLEMENTINE", clementines: "CLEMENTINE", quince: "COING", fig: "FIGUE", figs: "FIGUE", strawberry: "FRAISE", strawberries: "FRAISE", raspberry: "FRAMBOISE", raspberries: "FRAMBOISE",
  kiwi: "KIWI", kiwis: "KIWI", kiwifruit: "KIWI", mandarin: "MANDARINE", mandarins: "MANDARINE", mango: "MANGUE", blackberry: "MURE", blackberries: "MURE", blueberry: "MYRTILLE", blueberries: "MYRTILLE",
  nectarine: "NECTARINE", nectarines: "NECTARINE", hazelnut: "NOISETTE", hazelnuts: "NOISETTE", walnut: "NOIX", walnuts: "NOIX", orange: "ORANGE", oranges: "ORANGE", peach: "PECHE", peaches: "PECHE",
  pear: "POIRE", pears: "POIRE", grapefruit: "POMELOS", apple: "POMME", apples: "POMME", plum: "PRUNE", plums: "PRUNE", grape: "RAISIN", grapes: "RAISIN",
};

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** The RNM slug for what the user asked: an English or French word, or a slug itself. Null when unknown. */
export function resolveProduct(asked: string): string | null {
  const a = strip(asked).toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!a) return null;
  if (ALIASES[a]) return ALIASES[a];
  const slug = a.toUpperCase().replace(/ /g, "-");
  if ((SLUGS as readonly string[]).includes(slug)) return slug;
  const noS = a.replace(/s$/, "");
  if (ALIASES[noS]) return ALIASES[noS];
  const slug2 = noS.toUpperCase().replace(/ /g, "-");
  if ((SLUGS as readonly string[]).includes(slug2)) return slug2;
  return null;
}

export function productHelp(): string {
  return [...new Set(Object.values(ALIASES))].length + " products, for example carrot, tomato, potato, onion, leek, cauliflower, apple, pear, orange, strawberry, peach (English or French names)";
}

// ---------- parsing ----------

export interface Quote {
  market: string;
  date: string; // ISO
  stage: string; // Producteurs / Expédition / Import / Grossistes
  label: string;
  price: number; // EUR excl. VAT per kg
  min: number | null;
  max: number | null;
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&euro;/g, "€")
    .replace(/&eacute;/g, "é").replace(/&egrave;/g, "è").replace(/&ecirc;/g, "ê").replace(/&agrave;/g, "à").replace(/&ocirc;/g, "ô").replace(/&ccedil;/g, "ç")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, " ")
    .trim();

const num = (s: string): number | null => {
  const t = decode(s).replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
};

export function parseDmy(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s.trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** All usable quotes of one product page. Throws SourceError when the page no longer has the expected table. */
export function parseProductPage(html: string): Quote[] {
  if (!html.includes('id="tabcotmar"') && !html.includes("tdcotl")) {
    throw new SourceError("FranceAgriMer changed the layout of its RNM price page (no price table found); this source needs updating.");
  }
  const out: Quote[] = [];
  const rows = html.split(/<tr\b/i).slice(1);
  let market = "";
  let date: string | null = null;
  let stage = "";
  let perKg = false;
  for (const raw of rows) {
    if (raw.includes("tdcotcolspan")) {
      const text = decode(raw.split("</td>")[0]);
      const anchor = /<a [^>]*>([^<]+)<\/a>/.exec(raw);
      market = anchor ? decode(anchor[1]) : "";
      const d = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*\(cours ([^)]+)\)/.exec(text);
      date = d ? parseDmy(d[1]) : null;
      stage = d ? d[2].trim() : "";
      perKg = /HT le kg/.test(text.replace(/\s+/g, " ")) || /€ HT le kg/.test(text);
      continue;
    }
    if (!raw.includes("tdcotl")) continue;
    const cells = raw.split(/<td\b/i).slice(1);
    if (cells.length < 5) continue;
    const label = decode(cells[0].replace(/^[^>]*>/, ""));
    const price = num(cells[1].replace(/^[^>]*>/, ""));
    const min = num(cells[3].replace(/^[^>]*>/, ""));
    const max = num(cells[4].replace(/^[^>]*>/, ""));
    if (!date || !perKg || price === null || price <= 0) continue;
    out.push({ market, date, stage, label, price, min: min !== null && min > 0 ? min : null, max: max !== null && max > 0 ? max : null });
  }
  return out;
}

/** Wholesale-stage, conventional, per-kg quotes only. */
export function usable(q: Quote[]): Quote[] {
  return q.filter(
    (x) =>
      x.stage !== "Détail" &&
      !/\((la|le|les|l') /i.test(x.label) && // "(la botte)", "(la pièce)": not priced per kg
      !/biologique|\bbio\b/i.test(`${x.label} ${x.market}`),
  );
}

export function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

function isoMinusDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function answerFromQuotes(quotes: Quote[], input: { product: string; slug: string; baseUrl?: string }): PriceAnswer {
  const use = usable(quotes);
  const base = { source: INFO, query: { country: "FR", product: input.product, item: input.slug }, currency: "EUR", method: METHOD, baseUrl: input.baseUrl };
  if (!use.length) {
    return buildStatisticAnswer({
      ...base, value: null, measure: "median", unit: "per kg", period: { from: null, to: null }, reference_period: "", describe: () => "",
      extra: { note: `RNM has no wholesale quote per kilogram for '${input.product}' at the moment (retail, organic, bunch and piece lines are not used).` },
    });
  }
  const newest = use.map((x) => x.date).sort().reverse()[0];
  const from = isoMinusDays(newest, 7);
  // Keep the latest quote per market line, newest 7 days only.
  const latest = new Map<string, Quote>();
  for (const x of use) {
    if (x.date < from) continue;
    const k = `${x.market}\u0000${x.label}\u0000${x.stage}`;
    const cur = latest.get(k);
    if (!cur || x.date > cur.date) latest.set(k, x);
  }
  const q = [...latest.values()];
  const prices = q.map((x) => x.price);
  const value = median(prices);
  const oldest = q.map((x) => x.date).sort()[0];
  const stages: Record<string, { quotes: number; median: number }> = {};
  for (const st of [...new Set(q.map((x) => x.stage))]) {
    const p = q.filter((x) => x.stage === st).map((x) => x.price);
    stages[st] = { quotes: p.length, median: r2(median(p)) };
  }
  const name = input.product.trim().toLowerCase();
  const sample = [...q].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12).map((x) => ({
    market: x.market, label: x.label, stage: x.stage, date: x.date, price_eur_per_kg: x.price, lowest: x.min, highest: x.max,
  }));
  return buildStatisticAnswer({
    ...base,
    value,
    measure: "median",
    unit: "per kg",
    period: { from: oldest, to: newest },
    reference_period: newest,
    min: Math.min(...prices),
    max: Math.max(...prices),
    describe: (x) => `Wholesale ${name} in France: median quoted price EUR ${x} per kg excluding VAT across ${q.length} market quotes (${oldest} to ${newest}).`,
    ending: "Posted market quotes from FranceAgriMer's RNM; the median is calculated by ProofPrice.",
    note: "Quoted wholesale and producer-market prices excluding VAT, not shop prices and not paid prices. Retail, organic, bunch and piece lines are left out.",
    extra: {
      quote_count: q.length,
      markets: new Set(q.map((x) => x.market)).size,
      newest_quote_date: newest,
      oldest_quote_date: oldest,
      by_stage: stages,
      quotes: sample,
      price_basis: "posted market quote, EUR excluding VAT per kg",
      lowest_quote: Math.min(...prices),
      highest_quote: Math.max(...prices),
      rnm_page: BASE_URL + input.slug,
    },
  });
}

// ---------- fetch ----------

export async function fetchPage(slug: string, timeoutMs = 25000): Promise<string> {
  const url = BASE_URL + slug;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, "", res.status);
    return await res.text();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export async function frWholesale(
  input: { product?: string; baseUrl?: string },
  fetcher: (slug: string) => Promise<string> = (s) => fetchPage(s),
): Promise<PriceAnswer> {
  const asked = (input.product ?? "").trim();
  if (!asked) throw new InputError("product is required, for example 'carrot', 'tomato', 'potato', 'apple' or 'strawberry'.");
  const slug = resolveProduct(asked);
  if (!slug) {
    return buildStatisticAnswer({
      source: INFO, query: { country: "FR", product: asked }, currency: "EUR", method: METHOD, baseUrl: input.baseUrl,
      value: null, measure: "median", unit: "per kg", period: { from: null, to: null }, reference_period: "", describe: () => "",
      extra: { note: `No French wholesale product matches '${asked}'. Try ${productHelp()}.` },
    });
  }
  return answerFromQuotes(parseProductPage(await fetcher(slug)), { product: asked, slug, baseUrl: input.baseUrl });
}
