// Readable names for the areas used as keys in the price library (library/<source>/daily/*.csv).
// The library stores codes (ES province "28", FR department "69", IT province "MI", IE county slug "cork",
// Dublin district "dublin-6"). The public answer pages need names people and AIs actually search for.
// Names live here, not in sources/, so a source folder stays about the data and this file stays about the website.

export const COUNTRY_NAMES: Record<string, string> = {
  ES: "Spain",
  FR: "France",
  GB: "England and Wales",
  IE: "Ireland",
  IT: "Italy",
  SG: "Singapore",
};

const REGION_NAMES = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

/** Our own names first (GB data covers England and Wales only), then the standard English country name. */
export function countryName(code: string): string {
  const c = code.toUpperCase();
  if (COUNTRY_NAMES[c]) return COUNTRY_NAMES[c];
  try {
    const n = REGION_NAMES?.of(c);
    if (n && n !== c) return n;
  } catch {
    // not a region code
  }
  return c;
}

/** lower-case ASCII slug: "A Coruña" -> "a-coruna", "Côte-d'Or" -> "cote-d-or". */
export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // letters that do not decompose: "København" -> "kobenhavn", not "k-benhavn"
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ß/g, "ss")
    .replace(/[đð]/g, "d")
    .replace(/ł/g, "l")
    .replace(/þ/g, "th")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type AreaKind = "country" | "province" | "department" | "county" | "district";

export interface AreaInfo {
  code: string; // the library key
  slug: string; // URL part
  name: string; // short name: "Madrid"
  local?: string; // other common spelling: "Sevilla"
  label: string; // for questions: "Madrid province", "Dublin 6", "County Cork"
  kind: AreaKind;
  parent?: string; // library key of the bigger area, e.g. "dublin" for "dublin-6"
  note?: string; // what the figure does and does not cover (national rows)
}

interface RawName {
  name: string;
  local?: string;
  bare?: true; // label is the name itself, without "province"
}

// ---------- Spain: provinces 01-52 (INE codes, as used by the Ministry's price feed) ----------
const ES: Record<string, RawName> = {
  "01": { name: "Álava", local: "Araba" },
  "02": { name: "Albacete" },
  "03": { name: "Alicante", local: "Alacant" },
  "04": { name: "Almería" },
  "05": { name: "Ávila" },
  "06": { name: "Badajoz" },
  "07": { name: "Balearic Islands", local: "Illes Balears", bare: true },
  "08": { name: "Barcelona" },
  "09": { name: "Burgos" },
  "10": { name: "Cáceres" },
  "11": { name: "Cádiz" },
  "12": { name: "Castellón", local: "Castelló" },
  "13": { name: "Ciudad Real" },
  "14": { name: "Córdoba" },
  "15": { name: "A Coruña", local: "La Coruña" },
  "16": { name: "Cuenca" },
  "17": { name: "Girona", local: "Gerona" },
  "18": { name: "Granada" },
  "19": { name: "Guadalajara" },
  "20": { name: "Gipuzkoa", local: "Guipúzcoa" },
  "21": { name: "Huelva" },
  "22": { name: "Huesca" },
  "23": { name: "Jaén" },
  "24": { name: "León" },
  "25": { name: "Lleida", local: "Lérida" },
  "26": { name: "La Rioja", bare: true },
  "27": { name: "Lugo" },
  "28": { name: "Madrid" },
  "29": { name: "Málaga" },
  "30": { name: "Murcia" },
  "31": { name: "Navarre", local: "Navarra", bare: true },
  "32": { name: "Ourense", local: "Orense" },
  "33": { name: "Asturias", bare: true },
  "34": { name: "Palencia" },
  "35": { name: "Las Palmas" },
  "36": { name: "Pontevedra" },
  "37": { name: "Salamanca" },
  "38": { name: "Santa Cruz de Tenerife" },
  "39": { name: "Cantabria", bare: true },
  "40": { name: "Segovia" },
  "41": { name: "Seville", local: "Sevilla" },
  "42": { name: "Soria" },
  "43": { name: "Tarragona" },
  "44": { name: "Teruel" },
  "45": { name: "Toledo" },
  "46": { name: "Valencia", local: "València" },
  "47": { name: "Valladolid" },
  "48": { name: "Bizkaia", local: "Vizcaya" },
  "49": { name: "Zamora" },
  "50": { name: "Zaragoza" },
  "51": { name: "Ceuta", bare: true },
  "52": { name: "Melilla", bare: true },
};

// ---------- France: departments (prefecture codes; Corsica is 2A and 2B) ----------
const FR: Record<string, RawName> = {
  "01": { name: "Ain" },
  "02": { name: "Aisne" },
  "03": { name: "Allier" },
  "04": { name: "Alpes-de-Haute-Provence" },
  "05": { name: "Hautes-Alpes" },
  "06": { name: "Alpes-Maritimes" },
  "07": { name: "Ardèche" },
  "08": { name: "Ardennes" },
  "09": { name: "Ariège" },
  "10": { name: "Aube" },
  "11": { name: "Aude" },
  "12": { name: "Aveyron" },
  "13": { name: "Bouches-du-Rhône" },
  "14": { name: "Calvados" },
  "15": { name: "Cantal" },
  "16": { name: "Charente" },
  "17": { name: "Charente-Maritime" },
  "18": { name: "Cher" },
  "19": { name: "Corrèze" },
  "21": { name: "Côte-d'Or" },
  "22": { name: "Côtes-d'Armor" },
  "23": { name: "Creuse" },
  "24": { name: "Dordogne" },
  "25": { name: "Doubs" },
  "26": { name: "Drôme" },
  "27": { name: "Eure" },
  "28": { name: "Eure-et-Loir" },
  "29": { name: "Finistère" },
  "2A": { name: "Corse-du-Sud" },
  "2B": { name: "Haute-Corse" },
  "30": { name: "Gard" },
  "31": { name: "Haute-Garonne" },
  "32": { name: "Gers" },
  "33": { name: "Gironde" },
  "34": { name: "Hérault" },
  "35": { name: "Ille-et-Vilaine" },
  "36": { name: "Indre" },
  "37": { name: "Indre-et-Loire" },
  "38": { name: "Isère" },
  "39": { name: "Jura" },
  "40": { name: "Landes" },
  "41": { name: "Loir-et-Cher" },
  "42": { name: "Loire" },
  "43": { name: "Haute-Loire" },
  "44": { name: "Loire-Atlantique" },
  "45": { name: "Loiret" },
  "46": { name: "Lot" },
  "47": { name: "Lot-et-Garonne" },
  "48": { name: "Lozère" },
  "49": { name: "Maine-et-Loire" },
  "50": { name: "Manche" },
  "51": { name: "Marne" },
  "52": { name: "Haute-Marne" },
  "53": { name: "Mayenne" },
  "54": { name: "Meurthe-et-Moselle" },
  "55": { name: "Meuse" },
  "56": { name: "Morbihan" },
  "57": { name: "Moselle" },
  "58": { name: "Nièvre" },
  "59": { name: "Nord" },
  "60": { name: "Oise" },
  "61": { name: "Orne" },
  "62": { name: "Pas-de-Calais" },
  "63": { name: "Puy-de-Dôme" },
  "64": { name: "Pyrénées-Atlantiques" },
  "65": { name: "Hautes-Pyrénées" },
  "66": { name: "Pyrénées-Orientales" },
  "67": { name: "Bas-Rhin" },
  "68": { name: "Haut-Rhin" },
  "69": { name: "Rhône" },
  "70": { name: "Haute-Saône" },
  "71": { name: "Saône-et-Loire" },
  "72": { name: "Sarthe" },
  "73": { name: "Savoie" },
  "74": { name: "Haute-Savoie" },
  "75": { name: "Paris" },
  "76": { name: "Seine-Maritime" },
  "77": { name: "Seine-et-Marne" },
  "78": { name: "Yvelines" },
  "79": { name: "Deux-Sèvres" },
  "80": { name: "Somme" },
  "81": { name: "Tarn" },
  "82": { name: "Tarn-et-Garonne" },
  "83": { name: "Var" },
  "84": { name: "Vaucluse" },
  "85": { name: "Vendée" },
  "86": { name: "Vienne" },
  "87": { name: "Haute-Vienne" },
  "88": { name: "Vosges" },
  "89": { name: "Yonne" },
  "90": { name: "Territoire de Belfort" },
  "91": { name: "Essonne" },
  "92": { name: "Hauts-de-Seine" },
  "93": { name: "Seine-Saint-Denis" },
  "94": { name: "Val-de-Marne" },
  "95": { name: "Val-d'Oise" },
  "971": { name: "Guadeloupe" },
  "972": { name: "Martinique" },
  "973": { name: "Guyane" },
  "974": { name: "La Réunion" },
  "976": { name: "Mayotte" },
};

// ---------- Italy: provinces by their two-letter code (sigla) ----------
const IT: Record<string, RawName> = {
  AG: { name: "Agrigento" },
  AL: { name: "Alessandria" },
  AN: { name: "Ancona" },
  AO: { name: "Aosta Valley", local: "Valle d'Aosta", bare: true },
  AP: { name: "Ascoli Piceno" },
  AQ: { name: "L'Aquila" },
  AR: { name: "Arezzo" },
  AT: { name: "Asti" },
  AV: { name: "Avellino" },
  BA: { name: "Bari" },
  BG: { name: "Bergamo" },
  BI: { name: "Biella" },
  BL: { name: "Belluno" },
  BN: { name: "Benevento" },
  BO: { name: "Bologna" },
  BR: { name: "Brindisi" },
  BS: { name: "Brescia" },
  BT: { name: "Barletta-Andria-Trani" },
  BZ: { name: "Bolzano", local: "Bozen" },
  CA: { name: "Cagliari" },
  CB: { name: "Campobasso" },
  CE: { name: "Caserta" },
  CH: { name: "Chieti" },
  CL: { name: "Caltanissetta" },
  CN: { name: "Cuneo" },
  CO: { name: "Como" },
  CR: { name: "Cremona" },
  CS: { name: "Cosenza" },
  CT: { name: "Catania" },
  CZ: { name: "Catanzaro" },
  EN: { name: "Enna" },
  FC: { name: "Forlì-Cesena" },
  FE: { name: "Ferrara" },
  FG: { name: "Foggia" },
  FI: { name: "Florence", local: "Firenze" },
  FM: { name: "Fermo" },
  FR: { name: "Frosinone" },
  GE: { name: "Genoa", local: "Genova" },
  GO: { name: "Gorizia" },
  GR: { name: "Grosseto" },
  IM: { name: "Imperia" },
  IS: { name: "Isernia" },
  KR: { name: "Crotone" },
  LC: { name: "Lecco" },
  LE: { name: "Lecce" },
  LI: { name: "Livorno" },
  LO: { name: "Lodi" },
  LT: { name: "Latina" },
  LU: { name: "Lucca" },
  MB: { name: "Monza and Brianza", local: "Monza e Brianza" },
  MC: { name: "Macerata" },
  ME: { name: "Messina" },
  MI: { name: "Milan", local: "Milano" },
  MN: { name: "Mantua", local: "Mantova" },
  MO: { name: "Modena" },
  MS: { name: "Massa-Carrara" },
  MT: { name: "Matera" },
  NA: { name: "Naples", local: "Napoli" },
  NO: { name: "Novara" },
  NU: { name: "Nuoro" },
  OR: { name: "Oristano" },
  PA: { name: "Palermo" },
  PC: { name: "Piacenza" },
  PD: { name: "Padua", local: "Padova" },
  PE: { name: "Pescara" },
  PG: { name: "Perugia" },
  PI: { name: "Pisa" },
  PN: { name: "Pordenone" },
  PO: { name: "Prato" },
  PR: { name: "Parma" },
  PT: { name: "Pistoia" },
  PU: { name: "Pesaro and Urbino", local: "Pesaro e Urbino" },
  PV: { name: "Pavia" },
  PZ: { name: "Potenza" },
  RA: { name: "Ravenna" },
  RC: { name: "Reggio Calabria" },
  RE: { name: "Reggio Emilia" },
  RG: { name: "Ragusa" },
  RI: { name: "Rieti" },
  RM: { name: "Rome", local: "Roma" },
  RN: { name: "Rimini" },
  RO: { name: "Rovigo" },
  SA: { name: "Salerno" },
  SI: { name: "Siena" },
  SO: { name: "Sondrio" },
  SP: { name: "La Spezia" },
  SR: { name: "Syracuse", local: "Siracusa" },
  SS: { name: "Sassari" },
  SU: { name: "South Sardinia", local: "Sud Sardegna" },
  SV: { name: "Savona" },
  TA: { name: "Taranto" },
  TE: { name: "Teramo" },
  TN: { name: "Trento" },
  TO: { name: "Turin", local: "Torino" },
  TP: { name: "Trapani" },
  TR: { name: "Terni" },
  TS: { name: "Trieste" },
  TV: { name: "Treviso" },
  UD: { name: "Udine" },
  VA: { name: "Varese" },
  VB: { name: "Verbano-Cusio-Ossola" },
  VC: { name: "Vercelli" },
  VE: { name: "Venice", local: "Venezia" },
  VI: { name: "Vicenza" },
  VR: { name: "Verona" },
  VT: { name: "Viterbo" },
  VV: { name: "Vibo Valentia" },
};

// ---------- Ireland: counties (library key = lower-case county name) and Dublin postal districts ----------
export const IE_COUNTY_NAMES = [
  "Carlow", "Cavan", "Clare", "Cork", "Donegal", "Dublin", "Galway", "Kerry", "Kildare", "Kilkenny", "Laois",
  "Leitrim", "Limerick", "Longford", "Louth", "Mayo", "Meath", "Monaghan", "Offaly", "Roscommon", "Sligo",
  "Tipperary", "Waterford", "Westmeath", "Wexford", "Wicklow",
];

/** "dublin-6" -> "Dublin 6"; "dublin-6w" -> "Dublin 6W"; null when the key is not a Dublin postal district (1-24, plus 6W). */
export function dublinDistrictName(key: string): string | null {
  const m = /^dublin-(\d{1,2})(w?)$/.exec(key);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1 || n > 24) return null;
  return `Dublin ${n}${m[2].toUpperCase()}`;
}

// ---------- the one lookup the website uses ----------

export const NATIONAL_KEY = "ALL";

const NATIONAL: Record<string, { name: string; label: string; slug: string; note?: string }> = {
  // Spain's national row leaves out the Canary Islands, Ceuta and Melilla (different fuel taxes); say so.
  "es-fuel": {
    name: "Spain",
    label: "Spain (mainland and the Balearic Islands)",
    slug: "spain",
    note: "The national figure covers mainland Spain and the Balearic Islands. The Canary Islands, Ceuta and Melilla have different fuel taxes, so they are left out of it; they have their own province pages.",
  },
  "fr-fuel": {
    name: "France",
    label: "metropolitan France",
    slug: "france",
    note: "The national figure covers metropolitan France, not the overseas departments.",
  },
  "it-fuel": { name: "Italy", label: "Italy", slug: "italy" },
  "ie-ppr": { name: "Ireland", label: "Ireland", slug: "ireland" },
};

function fromRaw(code: string, raw: RawName, kind: AreaKind, label: string): AreaInfo {
  return { code, slug: slugify(raw.name), name: raw.name, ...(raw.local ? { local: raw.local } : {}), label, kind };
}

/** Readable info for a library area key of one source, or null if we have no name for it (the page is then skipped). */
export function areaFor(sourceId: string, code: string): AreaInfo | null {
  if (code === NATIONAL_KEY) {
    const n = NATIONAL[sourceId];
    return n ? { code, slug: n.slug, name: n.name, label: n.label, kind: "country", ...(n.note ? { note: n.note } : {}) } : null;
  }
  switch (sourceId) {
    case "es-fuel": {
      const raw = ES[code];
      return raw ? fromRaw(code, raw, "province", raw.bare ? raw.name : `${raw.name} province`) : null;
    }
    case "fr-fuel": {
      const raw = FR[code.toUpperCase()];
      return raw ? fromRaw(code.toUpperCase(), raw, "department", `${raw.name} (department ${code.toUpperCase()})`) : null;
    }
    case "it-fuel": {
      const raw = IT[code.toUpperCase()];
      return raw ? fromRaw(code.toUpperCase(), raw, "province", raw.bare ? raw.name : `${raw.name} province`) : null;
    }
    case "ie-ppr": {
      const county = IE_COUNTY_NAMES.find((c) => c.toLowerCase() === code);
      if (county) return { code, slug: code, name: county, label: `County ${county}`, kind: "county" };
      const district = dublinDistrictName(code);
      if (district) return { code, slug: code, name: district, label: district, kind: "district", parent: "dublin" };
      return null;
    }
    default:
      return null;
  }
}

/** Every named code for a source (used by tests to prove the maps are complete for what the library holds). */
export function knownAreaCodes(sourceId: string): string[] {
  switch (sourceId) {
    case "es-fuel":
      return Object.keys(ES);
    case "fr-fuel":
      return Object.keys(FR);
    case "it-fuel":
      return Object.keys(IT);
    case "ie-ppr":
      return IE_COUNTY_NAMES.map((c) => c.toLowerCase());
    default:
      return [];
  }
}
