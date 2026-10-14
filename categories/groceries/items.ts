// Shared helpers for the grocery tool: turn everyday words ("milk", "white bread", "pint of lager") into the standard item a
// statistics office measures. Each source keeps its own small table of items (the publisher's code, our plain definition,
// the unit and the everyday words); this file only does the matching, so every country answers the same words the same way.
// Pure functions, unit-tested in categories/groceries/items.test.ts.

export interface ItemDef {
  /** The publisher's own item code (CSO item code, BLS item_code ...). */
  code: string;
  /** Plain definition shown in answers, e.g. "Full-fat milk, per 2 litres". */
  label: string;
  /** The unit the price is for, e.g. "per 2 litres", "per lb (453.6 g)". */
  unit: string;
  /** Everyday words for this item, in any case, singular or plural. The first definition that lists a word is the default for it. */
  words: string[];
}

const STOP_WORDS = new Set(["a", "an", "the", "of", "for", "some", "my", "price", "prices", "cost", "costs", "average", "avg", "how", "much", "is", "are", "does", "do", "what", "in", "per", "one"]);

/** "Potatoes" -> "potato", "Berries" -> "berry", "eggs" -> "egg"; leaves "glass", "citrus", "swiss" alone. */
export function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (word.endsWith("oes")) return word.slice(0, -2);
  if (/(ch|sh|x|z|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("ss") || word.endsWith("us") || word.endsWith("is")) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/** Lower-case, strip accents and punctuation, drop filler words, make words singular: "A pint of Lagers!" -> "pint lager". */
export function normaliseWords(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9%]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP_WORDS.has(w))
    .map(singular)
    .join(" ");
}

function tokens(s: string): string[] {
  return normaliseWords(s).split(" ").filter(Boolean);
}

export interface ItemMatch {
  /** The definition that answers the question: the first exact word match, else the best partial match. */
  primary: ItemDef | null;
  /** Other definitions that the same words can mean (other pack sizes, cuts, brands), nearest first. */
  related: ItemDef[];
}

/**
 * Find the standard item for everyday words. 1) definitions that list the words exactly (table order, so the table's first
 * entry is the default); 2) definitions whose words or label contain every word asked for. Never guesses a loose match:
 * "sirloin steak" will not find "chicken".
 */
export function matchItem(defs: ItemDef[], raw: string): ItemMatch {
  const q = normaliseWords(raw);
  if (!q) return { primary: null, related: [] };
  const qTokens = q.split(" ");

  const exact = defs.filter((d) => d.words.some((w) => normaliseWords(w) === q));
  const partial = defs.filter((d) => {
    if (exact.includes(d)) return false;
    const have = new Set([...d.words.flatMap(tokens), ...tokens(d.label)]);
    return qTokens.every((t) => have.has(t));
  });
  const all = [...exact, ...partial];
  return { primary: all[0] ?? null, related: all.slice(1, 9) };
}

/** A short list of words an agent can ask for, one per definition (the first everyday word), for "not found" hints. */
export function exampleWords(defs: ItemDef[], max = 40): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of defs) {
    const w = d.words[0];
    if (!w || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}
