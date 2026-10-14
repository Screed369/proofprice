// Australian places for the ABS state/territory table: the 8 states and territories, Australia as a whole, well-known cities and towns that
// belong to exactly one state, and the Australia Post postcode ranges. The ABS publishes this table (RES_DWELL_ST) for states and territories
// only, so every place resolves to one of them.

import { InputError } from "../../lib/http";

/** ABS REGION codes of dataflow RES_DWELL_ST. */
export type RegionCode = "AUS" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";

export interface Region {
  code: RegionCode;
  name: string;
  /** Usual abbreviation, e.g. "NSW". */
  abbr: string;
}

export const REGIONS: Region[] = [
  { code: "AUS", name: "Australia", abbr: "AUS" },
  { code: "1", name: "New South Wales", abbr: "NSW" },
  { code: "2", name: "Victoria", abbr: "VIC" },
  { code: "3", name: "Queensland", abbr: "QLD" },
  { code: "4", name: "South Australia", abbr: "SA" },
  { code: "5", name: "Western Australia", abbr: "WA" },
  { code: "6", name: "Tasmania", abbr: "TAS" },
  { code: "7", name: "Northern Territory", abbr: "NT" },
  { code: "8", name: "Australian Capital Territory", abbr: "ACT" },
];
const byCode = (c: RegionCode) => REGIONS.find((r) => r.code === c)!;

/** Fold a name for matching: lower case, no diacritics, punctuation as single spaces. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Well-known places that lie in exactly one state or territory (names that exist in several states, such as Richmond, are left out on purpose). */
const CITIES: Record<string, string[]> = {
  "1": [
    "sydney", "parramatta", "newcastle", "wollongong", "central coast", "penrith", "liverpool", "blacktown", "bondi", "manly", "chatswood", "campbelltown",
    "dubbo", "orange", "tamworth", "wagga wagga", "albury", "coffs harbour", "port macquarie", "lismore", "bathurst", "gosford", "hornsby", "bankstown",
    "cronulla", "surry hills", "randwick", "burwood", "castle hill", "sutherland", "ryde", "blue mountains", "byron bay", "nowra", "goulburn", "queanbeyan",
  ],
  "2": [
    "melbourne", "geelong", "ballarat", "bendigo", "shepparton", "mildura", "wodonga", "warrnambool", "frankston", "dandenong", "st kilda", "footscray",
    "box hill", "craigieburn", "werribee", "sunbury", "traralgon", "wangaratta", "mornington", "south yarra", "brunswick", "fitzroy",
  ],
  "3": [
    "brisbane", "gold coast", "sunshine coast", "cairns", "townsville", "toowoomba", "mackay", "rockhampton", "bundaberg", "ipswich", "logan",
    "surfers paradise", "hervey bay", "noosa", "redcliffe", "caboolture", "southport", "maroochydore", "gladstone", "mount isa", "fortitude valley",
  ],
  "4": ["adelaide", "mount gambier", "whyalla", "port augusta", "murray bridge", "glenelg", "port lincoln", "victor harbor", "elizabeth", "salisbury"],
  "5": ["perth", "fremantle", "mandurah", "bunbury", "geraldton", "kalgoorlie", "albany", "rockingham", "joondalup", "busselton", "broome", "armadale", "cottesloe"],
  "6": ["hobart", "launceston", "devonport", "burnie", "kingston tas", "glenorchy"],
  "7": ["darwin", "alice springs", "palmerston", "katherine", "nhulunbuy"],
  "8": ["canberra", "belconnen", "tuggeranong", "gungahlin", "woden"],
};

const WHOLE = ["australia", "au", "aus", "all australia", "whole country", "the whole country", "national", "nationwide", "country", "all"];
const STATE_WORDS: Record<string, RegionCode> = {
  "new south wales": "1", nsw: "1",
  victoria: "2", vic: "2",
  queensland: "3", qld: "3",
  "south australia": "4", sa: "4",
  "western australia": "5", wa: "5",
  tasmania: "6", tas: "6",
  "northern territory": "7", nt: "7",
  "australian capital territory": "8", act: "8",
};
const ABBR_TAIL = /\s(nsw|vic|qld|sa|wa|tas|nt|act|new south wales|victoria|queensland|south australia|western australia|tasmania|northern territory|australian capital territory)$/;

const CITY_INDEX = new Map<string, RegionCode>();
for (const [code, names] of Object.entries(CITIES)) for (const n of names) CITY_INDEX.set(fold(n), code as RegionCode);

/** Australia Post postcode ranges (the 4-digit postcode -> state or territory). Returns null for a number that is not an Australian postcode. */
export function postcodeRegion(postcode: string): Region | null {
  if (!/^\d{4}$/.test(postcode)) return null;
  const n = Number(postcode);
  const within = (lo: number, hi: number) => n >= lo && n <= hi;
  let code: RegionCode | null = null;
  if (within(200, 299) || within(2600, 2618) || within(2900, 2920)) code = "8";
  else if (within(800, 999)) code = "7";
  else if (within(1000, 2599) || within(2619, 2899) || within(2921, 2999)) code = "1";
  else if (within(3000, 3999) || within(8000, 8999)) code = "2";
  else if (within(4000, 4999) || within(9000, 9999)) code = "3";
  else if (within(5000, 5999)) code = "4";
  else if (within(6000, 6797) || within(6800, 6999)) code = "5";
  else if (within(7000, 7999)) code = "6";
  return code ? byCode(code) : null;
}

export type Level = "country" | "state" | "city" | "postcode";
export interface Place {
  /** The state, territory or Australia that holds the figure. */
  region: Region;
  /** What the caller named. */
  level: Level;
  /** The name or postcode the caller gave ("Parramatta", "2150"), or "" when no place was given. */
  asked: string;
  notes: string[];
}

const HELP =
  "The ABS publishes this table for Australia and each state and territory only. Name a state or territory (New South Wales, Victoria, Queensland, South Australia, Western Australia, Tasmania, Northern Territory, Australian Capital Territory) " +
  "or a major city or 4-digit postcode (answered with its state), or leave town out for Australia as a whole.";

/** Resolve town and postcode to the state or territory that holds the figure. Throws InputError if neither is recognised. */
export function resolvePlace(town?: string, postcode?: string): Place {
  const t = (town ?? "").trim();
  const pc = (postcode ?? "").trim();
  const notes: string[] = [];
  const pcRegion = pc ? postcodeRegion(pc) : null;
  if (pc && !pcRegion) {
    if (!t) throw new InputError(`"${pc}" is not an Australian postcode (four digits, 0200 to 9999). ${HELP}`);
    notes.push(`The postcode "${pc}" was not recognised as an Australian postcode and was ignored.`);
  }

  if (t) {
    const hit = resolveName(t);
    if (hit) {
      if (pcRegion && pcRegion.code !== hit.region.code) {
        notes.push(`The postcode ${pc} lies in ${pcRegion.name}, but "${t}" lies in ${hit.region.name}; the answer follows the town name.`);
      } else if (pc && pcRegion) {
        notes.push(`The postcode ${pc} was not needed: the figure is the same for the whole of ${hit.region.name}.`);
      }
      return { ...hit, notes };
    }
    if (pcRegion) {
      notes.push(`"${t}" was not recognised as a state, territory or major city, so the postcode ${pc} was used.`);
      return { region: pcRegion, level: "postcode", asked: pc, notes };
    }
    throw new InputError(`No Australian state, territory or major city called "${t}" is known to this source. ${HELP}`);
  }
  if (pcRegion) return { region: pcRegion, level: "postcode", asked: pc, notes };
  return { region: byCode("AUS"), level: "country", asked: "", notes };
}

function resolveName(raw: string): Omit<Place, "notes"> | null {
  const key = fold(raw);
  if (!key) return { region: byCode("AUS"), level: "country", asked: "" };
  if (WHOLE.includes(key)) return { region: byCode("AUS"), level: "country", asked: raw };
  const state = STATE_WORDS[key];
  if (state) return { region: byCode(state), level: "state", asked: raw };
  // A postcode after the name ("Sydney 2000", "Surry Hills NSW 2010") is not part of the name.
  const name = key.replace(/\s\d{4}$/, "");
  const city = CITY_INDEX.get(name);
  if (city) return { region: byCode(city), level: "city", asked: raw };
  // "Parramatta NSW", "Melbourne, Victoria": the state at the end decides.
  const tail = ABBR_TAIL.exec(name);
  if (tail) return { region: byCode(STATE_WORDS[tail[1]]), level: "city", asked: raw };
  // "Sydney 2000", "Surry Hills NSW 2010": a 4-digit postcode inside the text.
  const embedded = /(?:^|\s)(\d{4})(?:\s|$)/.exec(key);
  if (embedded) {
    const r = postcodeRegion(embedded[1]);
    if (r) return { region: r, level: "postcode", asked: raw };
  }
  return null;
}
