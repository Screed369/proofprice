// Place-name matching for the Canadian sources: turn what a person types ("Montreal", "Toronto, ON", "St. John's", "Kitchener")
// into one geography member of a Statistics Canada table. Pure functions, unit-tested in geo.test.ts.

import { InputError } from "../../lib/http";
import type { CubeMember } from "./wds";

/** Lower-case, no accents or punctuation, "St." and "Ste." spelled out: "St. John's" -> "saint johns", "Montréal" -> "montreal". */
export function plain(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w === "st" ? "saint" : w === "ste" ? "sainte" : w))
    .join(" ");
}

export const PROVINCES: { name: string; code: string; words: string[] }[] = [
  { name: "Newfoundland and Labrador", code: "NL", words: ["newfoundland and labrador", "newfoundland", "labrador", "nl", "nfld"] },
  { name: "Prince Edward Island", code: "PE", words: ["prince edward island", "pei", "pe"] },
  { name: "Nova Scotia", code: "NS", words: ["nova scotia", "ns"] },
  { name: "New Brunswick", code: "NB", words: ["new brunswick", "nb"] },
  { name: "Quebec", code: "QC", words: ["quebec", "qc", "pq", "que"] },
  { name: "Ontario", code: "ON", words: ["ontario", "on", "ont"] },
  { name: "Manitoba", code: "MB", words: ["manitoba", "mb"] },
  { name: "Saskatchewan", code: "SK", words: ["saskatchewan", "sk"] },
  { name: "Alberta", code: "AB", words: ["alberta", "ab"] },
  { name: "British Columbia", code: "BC", words: ["british columbia", "bc", "b c"] },
  { name: "Yukon", code: "YT", words: ["yukon", "yt"] },
  { name: "Northwest Territories", code: "NT", words: ["northwest territories", "nwt", "nt"] },
  { name: "Nunavut", code: "NU", words: ["nunavut", "nu"] },
];

export function provinceFor(word: string): (typeof PROVINCES)[number] | undefined {
  const w = plain(word);
  return PROVINCES.find((p) => p.words.includes(w));
}

/** Names Canadians use that are not the table's wording. Keys are plain(); values are exact member names. Only used when that member exists. */
export const PLACE_ALIASES: Record<string, string> = {
  ottawa: "Ottawa-Gatineau, Ontario part, Ontario/Quebec",
  gatineau: "Ottawa-Gatineau, Quebec part, Ontario/Quebec",
  "ottawa gatineau": "Ottawa-Gatineau, Ontario/Quebec",
  "quebec city": "Québec, Quebec",
  "montreal quebec": "Montréal, Quebec",
  "st johns": "St. John's, Newfoundland and Labrador",
  "saint johns": "St. John's, Newfoundland and Labrador",
  "saint johns newfoundland": "St. John's, Newfoundland and Labrador",
  waterloo: "Kitchener-Cambridge-Waterloo, Ontario",
  kitchener: "Kitchener-Cambridge-Waterloo, Ontario",
  cambridge: "Kitchener-Cambridge-Waterloo, Ontario",
  niagara: "St. Catharines-Niagara, Ontario",
  "niagara falls": "St. Catharines-Niagara, Ontario",
  abbotsford: "Abbotsford-Mission, British Columbia",
  sudbury: "Greater Sudbury, Ontario",
};

function nameOf(label: string): string {
  return plain(label.split(",")[0]);
}

function tokens(s: string): string[] {
  return s.split(" ").filter((t) => t && t !== "and");
}

export interface GeoMatch {
  member: CubeMember;
  /** Set when the place was found under another name (an alias or a part of a metropolitan area), so the answer can say so. */
  note?: string;
}

/**
 * Find the table's geography member for a place name. Order of attempts: an alias, the full label, the name before the first comma,
 * every word of a hyphenated or "A and B" name, then a name that starts with the words. A province in the text ("Toronto, ON") narrows
 * the choice. Throws InputError when nothing matches or when two places match and the text cannot tell them apart.
 * Members that are no longer published (terminated) are used only when nothing else matches.
 */
export function resolvePlace(members: CubeMember[], input: string, what: string): GeoMatch {
  const raw = input.trim();
  const q = plain(raw);
  if (!q) throw new InputError(`A place is required: ${what}.`);
  const live = members.filter((m) => !m.terminated);
  const pools = [live, members];

  // A bare province or territory is not a place in these tables (unless a city has the same name: "Quebec" is also Québec city).
  const prov = provinceFor(raw);
  if (prov && !raw.includes(",") && !members.some((m) => nameOf(m.name) === q)) {
    const inProv = live.filter((m) => plain(m.name).includes(plain(prov.name)) && m.name.toLowerCase() !== prov.name.toLowerCase());
    const shown = inProv.slice(0, 12).map((m) => m.name);
    throw new InputError(
      `'${input}' is a province or territory; this table is by town or city. ` +
        (shown.length ? `In ${prov.name} it has: ${shown.join("; ")}${inProv.length > shown.length ? `; and ${inProv.length - shown.length} more` : ""}.` : `Give a town or city in ${prov.name}.`),
    );
  }

  // "Toronto, ON" / "Toronto, Ontario": split off a trailing province.
  let namePart = q;
  let province: (typeof PROVINCES)[number] | undefined;
  if (raw.includes(",")) {
    const bits = raw.split(",");
    const last = bits[bits.length - 1];
    const p = provinceFor(last);
    if (p) {
      province = p;
      namePart = plain(bits.slice(0, -1).join(","));
    }
  }
  const inProvince = (m: CubeMember) => !province || plain(m.name).includes(plain(province.name)) || (province.name === "Quebec" && /quebec/.test(plain(m.name)));

  const aliasName = PLACE_ALIASES[namePart] ?? PLACE_ALIASES[q];
  if (aliasName) {
    const hit = pools.map((p) => p.find((m) => m.name.toLowerCase() === aliasName.toLowerCase())).find(Boolean);
    if (hit) return { member: hit, note: hit.name.toLowerCase() !== raw.toLowerCase() ? `'${input}' is covered by the area '${hit.name}'.` : undefined };
  }

  for (const pool of pools) {
    const cands = pool.filter(inProvince);
    const steps: ((m: CubeMember) => boolean)[] = [
      (m) => plain(m.name) === q || plain(m.name) === namePart,
      (m) => nameOf(m.name) === namePart,
      (m) => {
        const t = tokens(namePart);
        const have = new Set(tokens(nameOf(m.name)));
        return t.length > 0 && t.every((x) => have.has(x));
      },
      (m) => nameOf(m.name).startsWith(namePart + " "),
    ];
    for (const test of steps) {
      const hits = cands.filter(test);
      if (hits.length === 1) {
        const member = hits[0];
        const exact = nameOf(member.name) === namePart || plain(member.name) === q;
        return { member, note: exact ? undefined : `'${input}' is covered by the area '${member.name}'.` };
      }
      if (hits.length > 1) {
        // Several members with the same name (parts of one area, or an old and a new entry): prefer a single published one.
        const published = hits.filter((m) => !m.terminated);
        if (published.length === 1) return { member: published[0] };
        const names = [...new Set(hits.map((m) => m.name))];
        if (names.length === 1) return { member: hits[0] };
        throw new InputError(`'${input}' matches several areas (${names.slice(0, 6).join("; ")}). Say which one, for example '${names[0]}'.`);
      }
    }
  }

  const first = namePart.split(" ")[0];
  const near = live.filter((m) => plain(m.name).includes(first)).slice(0, 6).map((m) => m.name);
  throw new InputError(
    `'${input}' is not a place in this table.` + (near.length ? ` Did you mean: ${near.join("; ")}?` : ` Give ${what}.`),
  );
}
