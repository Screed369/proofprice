// The words of a ready answer page, built from the request it answers: a short label (heading and URL) and the question.
// A source can set both itself (PageSpec.label / PageSpec.question). When it does not, they are built here from the category and
// the request parameters, so a new source gets readable pages without anyone editing this file. A category this file does not
// know yet gets a plain generic wording built from its noun and the parameter values.

import { FUEL_LABEL, normaliseFuel } from "../fuels";
import { slugify } from "./areas";

export interface WordingInput {
  categoryId: string;
  /** The category's plural noun, e.g. "Rents paid". Used by the generic wording. */
  categoryNoun: string;
  countryName: string;
  /** REST query parameters of the request, including country. */
  params: Record<string, string>;
  /** The source's paramNotes. Read for codes like "'9' = Wien" so a code is shown by its name. */
  notes?: Record<string, string>;
  /** Wording the source set itself. */
  label?: string;
  question?: string;
}

export interface Wording {
  label: string;
  question: string;
}

/** How a fuel reads inside a question ("unleaded 95 petrol"). */
export const FUEL_PHRASE: Record<string, string> = {
  diesel: "diesel",
  petrol95: "unleaded 95 petrol",
  petrol98: "unleaded 98 petrol",
  e10: "unleaded 95-E10 petrol",
  e85: "E85 bioethanol",
  lpg: "LPG (autogas)",
  methane: "compressed natural gas (CNG)",
};

const THE = new Set(["Netherlands", "United States", "United Kingdom", "Philippines", "United Arab Emirates", "Czech Republic", "Gambia", "Bahamas"]);

/** "in Ireland", "in the Netherlands". */
export function inCountry(name: string): string {
  return `in ${THE.has(name) ? "the " : ""}${name}`;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Reads a code's name from the source's own parameter note: area "9" with the note "(... '9' = Wien)" -> "Wien". */
export function nameFromNotes(notes: Record<string, string> | undefined, key: string, value: string): string | null {
  const note = notes?.[key];
  if (!note || !value) return null;
  const m = new RegExp(`['"‘’]${escapeRe(value)}['"‘’]\\s*=\\s*([^,;()]+)`, "i").exec(note);
  const name = m ? clean(m[1]) : "";
  return name || null;
}

const PLACE_KEYS = ["town", "city", "municipality", "area", "region", "county", "state", "province", "department", "buyer_area"];

/** The place a request is about, in words: the first place-like parameter, with codes read from the source's notes. */
export function placeOf(params: Record<string, string>, notes?: Record<string, string>): string | null {
  for (const k of PLACE_KEYS) {
    const v = clean(params[k]);
    if (v) return nameFromNotes(notes, k, v) ?? (/^\d+$/.test(v) ? `${k.replace(/_/g, " ")} ${v}` : v);
  }
  const pc = clean(params.postcode);
  return pc ? `postcode ${pc}` : null;
}

const TYPE_NOUN: Record<string, string> = {
  any: "homes",
  all: "homes",
  apartment: "flats",
  flat: "flats",
  condo: "condos",
  house: "houses",
  room: "rooms",
  "second-hand": "second-hand homes",
  new: "new homes",
  detached: "detached houses",
  terraced: "terraced houses",
  "semi-detached": "semi-detached houses",
};

/** "2-bedroom flats", "terraced houses", "homes". */
function homesNoun(p: Record<string, string>): string {
  const house = clean(p.house_type).toLowerCase();
  const type = clean(p.property_type).toLowerCase();
  let noun = (house && TYPE_NOUN[house]) || TYPE_NOUN[type] || (type ? `${type} homes` : "homes");
  const bedrooms = clean(p.bedrooms);
  if (bedrooms !== "" && /^\d+$/.test(bedrooms)) noun = `${bedrooms === "0" ? "studio" : `${bedrooms}-bedroom`} ${noun}`;
  return noun;
}

const KNOWN_ALWAYS = new Set(["country", "months", "quarters", "days"]);

/** Parameters this wording did not use, as "flat type 4 ROOM": nothing a source added is lost from the label. */
function extras(p: Record<string, string>, used: string[]): string {
  const skip = new Set([...KNOWN_ALWAYS, ...used]);
  return Object.entries(p)
    .filter(([k, v]) => !skip.has(k) && clean(v))
    .map(([k, v]) => {
      const name = k.replace(/_/g, " ");
      const value = clean(v);
      return /^\d+$/.test(value) ? `${value} ${name}` : `${name} ${value.toLowerCase()}`;
    })
    .join(", ");
}

function window_(p: Record<string, string>): string {
  const m = clean(p.months);
  return /^\d+$/.test(m) ? `last ${m} months` : "";
}

const join = (...parts: (string | undefined | false | null)[]) => parts.filter((x): x is string => !!x && x.trim() !== "").join(", ");

type Make = (i: WordingInput, place: string | null, where: string) => { label: string; question: string; used: string[] };

const MAKERS: Record<string, Make> = {
  fuel: (i, place, where) => {
    const key = normaliseFuel(clean(i.params.fuel));
    const name = key ? FUEL_LABEL[key] : clean(i.params.fuel) || "Fuel";
    const phrase = key ? FUEL_PHRASE[key] : clean(i.params.fuel) || "fuel";
    const served = clean(i.params.service) === "served";
    return {
      label: `${name}${served ? " (attended service)" : ""} ${place ? `in ${place}` : where}`,
      question: `What does ${phrase}${served ? " with attended service" : ""} cost ${place ? `in ${place}` : where} today?`,
      used: ["fuel", "service", ...PLACE_KEYS, "postcode"],
    };
  },
  "home-sales": (i, place, where) => {
    const noun = homesNoun(i.params);
    return {
      label: `${cap(noun)} ${place ? `in ${place}` : where}`,
      question: `What did ${noun} sell for ${place ? `in ${place}` : where}?`,
      used: ["property_type", "house_type", "bedrooms", ...PLACE_KEYS, "postcode"],
    };
  },
  rent: (i, place, where) => {
    const noun = homesNoun(i.params);
    return {
      label: `Rent for ${noun} ${place ? `in ${place}` : where}`,
      question: `What is the typical rent for ${noun} ${place ? `in ${place}` : where}?`,
      used: ["property_type", "house_type", "bedrooms", ...PLACE_KEYS, "postcode"],
    };
  },
  groceries: (i, place, where) => {
    const item = clean(i.params.item);
    return {
      label: `${cap(item || "Groceries")}${clean(i.params.region) ? ` in ${clean(i.params.region)}` : ""}`,
      question: `What is the price of ${item || "a grocery item"} in the shops ${clean(i.params.region) ? `in ${clean(i.params.region)}` : where}?`,
      used: ["item", "region"],
    };
  },
  contracts: (i, place, where) => {
    const what = clean(i.params.what);
    const area = clean(i.params.buyer_area);
    return {
      label: `${cap(what || "Public contracts")}${area ? ` (${area})` : ""}`,
      question: `What did public buyers ${where} pay for ${what || "contracts"}${area ? ` around ${area}` : ""}?`,
      used: ["what", "buyer_area", "cpv"],
    };
  },
  flights: (i) => {
    const from = clean(i.params.from);
    const to = clean(i.params.to);
    return {
      label: to ? `${from} to ${to}` : `Flights from ${from}`,
      question: to ? `What do people pay for a flight from ${from} to ${to}?` : `What is the average airfare out of ${from}?`,
      used: ["from", "to"],
    };
  },
  medical: (i, place, where) => {
    const service = clean(i.params.service);
    const state = clean(i.params.state);
    return {
      label: `${cap(service || "Medical service")}${state ? ` in ${state}` : ""}`,
      question: `What is paid for ${service || "a medical service"} ${state ? `in ${state}` : where}?`,
      used: ["service", "state", "setting"],
    };
  },
  medicines: (i, place, where) => {
    const medicine = clean(i.params.medicine);
    return {
      label: cap(medicine || "Medicine"),
      question: `What is the price of ${medicine || "a medicine"} ${where}?`,
      used: ["medicine"],
    };
  },
  energy: (i, place, where) => {
    const energy = clean(i.params.energy) || "energy";
    return {
      label: `${cap(energy)} for households`,
      question: `What do households ${where} pay for ${energy}?`,
      used: ["energy", "consumption_band", "taxes"],
    };
  },
  "farm-prices": (i, place, where) => {
    const product = clean(i.params.product);
    return {
      label: cap(product || "Farm product"),
      question: `What do farmers and wholesalers ${where} get for ${product || "farm produce"}?`,
      used: ["product"],
    };
  },
  "land-prices": (i, place, where) => {
    const rent = clean(i.params.measure) === "rent";
    const region = clean(i.params.region);
    const type = clean(i.params.land_type);
    return {
      label: `Farmland ${rent ? "rent" : "price"}${region ? `, ${region}` : ""}${type ? ` (${type})` : ""}`,
      question: `${rent ? "What does it cost to rent farmland per hectare" : "What does farmland sell for per hectare"} ${region ? `in region ${region}` : where}${type ? ` (${type})` : ""}?`,
      used: ["measure", "region", "land_type"],
    };
  },
  cars: (i, place, where) => {
    const product = clean(i.params.product).toLowerCase();
    const cls = clean(i.params.vehicle_class);
    if (product && product !== "coe") return generic(i, where);
    return {
      label: `Certificate of Entitlement${cls ? ` category ${cls}` : ""}`,
      question: `What did a Certificate of Entitlement${cls ? ` (category ${cls})` : ""} go for ${where}?`,
      used: ["product", "vehicle_class"],
    };
  },
};

/** Plain wording for a category this file does not know: its noun and the parameter values. */
function generic(i: WordingInput, where: string): { label: string; question: string; used: string[] } {
  const values = Object.entries(i.params)
    .filter(([k, v]) => !KNOWN_ALWAYS.has(k) && clean(v))
    .map(([, v]) => clean(v));
  const label = values.length ? values.join(", ") : i.countryName;
  return {
    label: cap(label),
    question: `What do the official ${i.categoryNoun.toLowerCase()} say for ${label} ${where}?`,
    used: Object.keys(i.params),
  };
}

/** The label and the question of one page. Explicit wording from the source always wins. */
export function wordingFor(i: WordingInput): Wording {
  const where = inCountry(i.countryName);
  const place = placeOf(i.params, i.notes);
  const made = (MAKERS[i.categoryId] ?? ((x: WordingInput, _p: string | null, w: string) => generic(x, w)))(i, place, where);
  const more = extras(i.params, made.used);
  const window = window_(i.params);
  const label = clean(i.label) || join(made.label, more, window);
  let question = clean(i.question);
  if (!question) {
    // What the wording did not use (a parameter only one source has, a time window) still belongs in the question.
    question = made.question.replace(/\?$/, "") + (more ? ` (${more})` : "") + (window ? ` over the ${window}` : "") + "?";
  }
  if (!/\?$/.test(question)) question += "?";
  return { label, question };
}

/** The URL part of a label. */
export function slugOf(label: string): string {
  return slugify(label).slice(0, 80).replace(/-+$/, "") || "overview";
}
