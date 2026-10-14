// Places for the U.S. EIA weekly retail fuel prices: the national average, the PADD regions (Petroleum Administration for Defense
// Districts), the states and cities that EIA publishes, and the 50 states + DC with the PADD each belongs to, so a state EIA does
// not publish can still be pointed at its region. Area codes are EIA's own (the middle of its series keys, e.g. EMM_EPMR_PTE_SCA_DPG).

export type AreaKind = "national" | "padd" | "state" | "city";

export interface Area {
  /** What the price library stores: "ALL" for the national average, EIA's code for a region or city, the postal code for a state. */
  key: string;
  /** EIA's code in the series key: NUS, R10, SCA, YBOS ... */
  eia: string;
  name: string;
  kind: AreaKind;
  /** Postal code of the state a city is in. */
  state?: string;
  /** Plain-text spellings that select this place (lower case, letters and digits only, single spaces). */
  words: string[];
}

export interface StateDef {
  code: string;
  name: string;
  /** Library key of the (sub-)PADD region the state belongs to: R1X, R1Y, R1Z, R20, R30, R40 or R50. */
  padd: string;
}

/** The 50 states and DC, each in its PADD (1A New England, 1B Central Atlantic, 1C Lower Atlantic, 2 Midwest, 3 Gulf Coast, 4 Rocky Mountain, 5 West Coast). */
export const STATES: StateDef[] = [
  { code: "CT", name: "Connecticut", padd: "R1X" }, { code: "ME", name: "Maine", padd: "R1X" }, { code: "MA", name: "Massachusetts", padd: "R1X" },
  { code: "NH", name: "New Hampshire", padd: "R1X" }, { code: "RI", name: "Rhode Island", padd: "R1X" }, { code: "VT", name: "Vermont", padd: "R1X" },
  { code: "DE", name: "Delaware", padd: "R1Y" }, { code: "DC", name: "District of Columbia", padd: "R1Y" }, { code: "MD", name: "Maryland", padd: "R1Y" },
  { code: "NJ", name: "New Jersey", padd: "R1Y" }, { code: "NY", name: "New York", padd: "R1Y" }, { code: "PA", name: "Pennsylvania", padd: "R1Y" },
  { code: "FL", name: "Florida", padd: "R1Z" }, { code: "GA", name: "Georgia", padd: "R1Z" }, { code: "NC", name: "North Carolina", padd: "R1Z" },
  { code: "SC", name: "South Carolina", padd: "R1Z" }, { code: "VA", name: "Virginia", padd: "R1Z" }, { code: "WV", name: "West Virginia", padd: "R1Z" },
  { code: "IL", name: "Illinois", padd: "R20" }, { code: "IN", name: "Indiana", padd: "R20" }, { code: "IA", name: "Iowa", padd: "R20" },
  { code: "KS", name: "Kansas", padd: "R20" }, { code: "KY", name: "Kentucky", padd: "R20" }, { code: "MI", name: "Michigan", padd: "R20" },
  { code: "MN", name: "Minnesota", padd: "R20" }, { code: "MO", name: "Missouri", padd: "R20" }, { code: "NE", name: "Nebraska", padd: "R20" },
  { code: "ND", name: "North Dakota", padd: "R20" }, { code: "OH", name: "Ohio", padd: "R20" }, { code: "OK", name: "Oklahoma", padd: "R20" },
  { code: "SD", name: "South Dakota", padd: "R20" }, { code: "TN", name: "Tennessee", padd: "R20" }, { code: "WI", name: "Wisconsin", padd: "R20" },
  { code: "AL", name: "Alabama", padd: "R30" }, { code: "AR", name: "Arkansas", padd: "R30" }, { code: "LA", name: "Louisiana", padd: "R30" },
  { code: "MS", name: "Mississippi", padd: "R30" }, { code: "NM", name: "New Mexico", padd: "R30" }, { code: "TX", name: "Texas", padd: "R30" },
  { code: "CO", name: "Colorado", padd: "R40" }, { code: "ID", name: "Idaho", padd: "R40" }, { code: "MT", name: "Montana", padd: "R40" },
  { code: "UT", name: "Utah", padd: "R40" }, { code: "WY", name: "Wyoming", padd: "R40" },
  { code: "AK", name: "Alaska", padd: "R50" }, { code: "AZ", name: "Arizona", padd: "R50" }, { code: "CA", name: "California", padd: "R50" },
  { code: "HI", name: "Hawaii", padd: "R50" }, { code: "NV", name: "Nevada", padd: "R50" }, { code: "OR", name: "Oregon", padd: "R50" },
  { code: "WA", name: "Washington", padd: "R50" },
];

/** Plain text for matching: accents and punctuation gone, lower case, single spaces. */
export function plain(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const PUBLISHED_STATES = ["CA", "CO", "FL", "MA", "MN", "NY", "OH", "TX", "WA"];

const NATIONAL: Area = {
  key: "ALL", eia: "NUS", name: "United States", kind: "national",
  words: ["us", "usa", "u s", "u s a", "united states", "united states of america", "america", "national", "nationwide", "country", "all", "u s average", "us average"],
};

const PADDS: Area[] = [
  { key: "R10", eia: "R10", name: "East Coast (PADD 1)", kind: "padd", words: ["padd 1", "padd1", "east coast", "east coast padd 1"] },
  { key: "R1X", eia: "R1X", name: "New England (PADD 1A)", kind: "padd", words: ["padd 1a", "padd1a", "new england"] },
  { key: "R1Y", eia: "R1Y", name: "Central Atlantic (PADD 1B)", kind: "padd", words: ["padd 1b", "padd1b", "central atlantic", "mid atlantic"] },
  { key: "R1Z", eia: "R1Z", name: "Lower Atlantic (PADD 1C)", kind: "padd", words: ["padd 1c", "padd1c", "lower atlantic"] },
  { key: "R20", eia: "R20", name: "Midwest (PADD 2)", kind: "padd", words: ["padd 2", "padd2", "midwest", "mid west"] },
  { key: "R30", eia: "R30", name: "Gulf Coast (PADD 3)", kind: "padd", words: ["padd 3", "padd3", "gulf coast", "gulf"] },
  { key: "R40", eia: "R40", name: "Rocky Mountain (PADD 4)", kind: "padd", words: ["padd 4", "padd4", "rocky mountain", "rocky mountains", "rockies"] },
  { key: "R50", eia: "R50", name: "West Coast (PADD 5)", kind: "padd", words: ["padd 5", "padd5", "west coast", "west coast padd 5"] },
  {
    key: "R5XCA", eia: "R5XCA", name: "West Coast less California (PADD 5)", kind: "padd",
    words: ["west coast less california", "west coast except california", "west coast excluding california", "west coast ex california", "west coast without california", "padd 5 less california", "padd 5 except california", "padd 5 excluding california"],
  },
];

const stateName = (code: string) => STATES.find((s) => s.code === code)!.name;

const STATE_AREAS: Area[] = PUBLISHED_STATES.map((code) => ({
  key: code, eia: `S${code}`, name: stateName(code), kind: "state" as const, state: code,
  words: [plain(stateName(code)), code.toLowerCase()],
}));

interface CityDef { eia: string; name: string; state: string; words: string[] }
const CITY_DEFS: CityDef[] = [
  { eia: "YBOS", name: "Boston, MA", state: "MA", words: ["boston"] },
  { eia: "YORD", name: "Chicago", state: "IL", words: ["chicago"] },
  { eia: "YCLE", name: "Cleveland, OH", state: "OH", words: ["cleveland"] },
  { eia: "YDEN", name: "Denver", state: "CO", words: ["denver"] },
  { eia: "Y44HO", name: "Houston", state: "TX", words: ["houston"] },
  { eia: "Y05LA", name: "Los Angeles", state: "CA", words: ["los angeles"] },
  { eia: "YMIA", name: "Miami, FL", state: "FL", words: ["miami"] },
  { eia: "Y35NY", name: "New York City", state: "NY", words: ["new york city", "nyc", "new york ny", "new york city ny"] },
  { eia: "Y05SF", name: "San Francisco", state: "CA", words: ["san francisco", "sf"] },
  { eia: "Y48SE", name: "Seattle, WA", state: "WA", words: ["seattle"] },
];

const CITY_AREAS: Area[] = CITY_DEFS.map((c) => ({
  key: c.eia, eia: c.eia, name: c.name, kind: "city" as const, state: c.state,
  words: [...new Set(c.words.flatMap((w) => [w, `${w} ${c.state.toLowerCase()}`]))],
}));

/** Every area EIA publishes in its weekly retail price files (for at least one fuel). */
export const AREAS: Area[] = [NATIONAL, ...PADDS, ...STATE_AREAS, ...CITY_AREAS];

export function areaByEia(eia: string): Area | undefined {
  return AREAS.find((a) => a.eia === eia);
}
export function areaByKey(key: string): Area | undefined {
  return AREAS.find((a) => a.key === key);
}

/** What EIA publishes: gasoline for every area except "West Coast less California"; diesel only for the nation, the PADD regions and California. */
export function isPublished(areaKey: string, product: string): boolean {
  const a = areaByKey(areaKey);
  if (!a) return false;
  if (product !== "diesel") return areaKey !== "R5XCA";
  return a.kind === "national" || a.kind === "padd" || areaKey === "CA";
}

export const NATIONAL_AREA = NATIONAL;

export interface Place {
  /** What the caller typed (area, town), or null. */
  requested: string | null;
  /** The EIA area the text names, if EIA publishes one. */
  area: Area | null;
  /** The US state the place is in (a state, a city's state, or an unpublished state), if known. */
  state: StateDef | null;
  /** The PADD region of that state, for context. */
  padd: Area | null;
  /** Plain words about how the text was read, or why the national average is used. */
  note?: string;
}

function matchText(text: string): { area?: Area; state?: StateDef } | null {
  const t = plain(text);
  if (!t) return null;
  const area = AREAS.find((a) => a.words.includes(t) || plain(a.name) === t);
  if (area) return { area };
  const state = STATES.find((s) => plain(s.name) === t || s.code.toLowerCase() === t || (s.code === "DC" && ["d c", "washington dc", "washington d c"].includes(t)));
  if (state) return { state };
  return null;
}

/** Read the place a request names. area and town may each hold a state, a PADD region, a city or the nation; the city wins. */
export function resolvePlace(input: { area?: string; town?: string; postcode?: string }): Place {
  const texts = [input.town, input.area].map((s) => (s ?? "").trim()).filter(Boolean);
  const requested = texts.length ? texts.join(", ") : null;
  let hit: { area?: Area; state?: StateDef } | null = null;
  for (const t of texts) {
    hit = matchText(t) ?? (t.includes(",") ? matchText(t.split(",")[0]) : null);
    if (hit) break;
  }
  const notes: string[] = [];
  if (input.postcode && String(input.postcode).trim()) notes.push("EIA publishes no ZIP-code or postcode prices, so the postcode was not used.");
  let state: StateDef | null = null;
  if (hit?.area) {
    const code = hit.area.kind === "state" ? hit.area.key : hit.area.state;
    state = code ? STATES.find((s) => s.code === code) ?? null : null;
  } else if (hit?.state) state = hit.state;
  const padd = state ? areaByKey(state.padd) ?? null : hit?.area?.kind === "padd" ? hit.area : null;
  if (!hit && requested) notes.push(`"${requested}" was not recognised as a US state, a PADD region or one of the cities EIA publishes.`);
  return { requested, area: hit?.area ?? null, state, padd, note: notes.length ? notes.join(" ") : undefined };
}
