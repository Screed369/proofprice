// Italian province names (and common English names) -> 2-letter province code (ISO 3166-2:IT, 107 provinces).
// Agents often ask area=Milano or area=Rome instead of area=MI; this turns those into the code MIMIT uses.
import { stripAccents } from "../../lib/fuels";

const PROVINCES: Record<string, string> = {
  AG: "Agrigento", AL: "Alessandria", AN: "Ancona", AO: "Aosta", AR: "Arezzo", AP: "Ascoli Piceno", AT: "Asti", AV: "Avellino",
  BA: "Bari", BT: "Barletta-Andria-Trani", BL: "Belluno", BN: "Benevento", BG: "Bergamo", BI: "Biella", BO: "Bologna", BZ: "Bolzano",
  BS: "Brescia", BR: "Brindisi", CA: "Cagliari", CL: "Caltanissetta", CB: "Campobasso", CE: "Caserta", CT: "Catania", CZ: "Catanzaro",
  CH: "Chieti", CO: "Como", CS: "Cosenza", CR: "Cremona", KR: "Crotone", CN: "Cuneo", EN: "Enna", FM: "Fermo", FE: "Ferrara",
  FI: "Firenze", FG: "Foggia", FC: "Forli-Cesena", FR: "Frosinone", GE: "Genova", GO: "Gorizia", GR: "Grosseto", IM: "Imperia",
  IS: "Isernia", SP: "La Spezia", AQ: "L'Aquila", LT: "Latina", LE: "Lecce", LC: "Lecco", LI: "Livorno", LO: "Lodi", LU: "Lucca",
  MC: "Macerata", MN: "Mantova", MS: "Massa-Carrara", MT: "Matera", ME: "Messina", MI: "Milano", MO: "Modena", MB: "Monza e Brianza",
  NA: "Napoli", NO: "Novara", NU: "Nuoro", OR: "Oristano", PD: "Padova", PA: "Palermo", PR: "Parma", PV: "Pavia", PG: "Perugia",
  PU: "Pesaro e Urbino", PE: "Pescara", PC: "Piacenza", PI: "Pisa", PT: "Pistoia", PN: "Pordenone", PZ: "Potenza", PO: "Prato",
  RG: "Ragusa", RA: "Ravenna", RC: "Reggio Calabria", RE: "Reggio Emilia", RI: "Rieti", RN: "Rimini", RM: "Roma", RO: "Rovigo",
  SA: "Salerno", SS: "Sassari", SV: "Savona", SI: "Siena", SR: "Siracusa", SO: "Sondrio", SU: "Sud Sardegna", TA: "Taranto",
  TE: "Teramo", TR: "Terni", TO: "Torino", TP: "Trapani", TN: "Trento", TV: "Treviso", TS: "Trieste", UD: "Udine", VA: "Varese",
  VE: "Venezia", VB: "Verbano-Cusio-Ossola", VC: "Vercelli", VR: "Verona", VV: "Vibo Valentia", VI: "Vicenza", VT: "Viterbo",
};

// English and short-form names people use.
const ALIASES: Record<string, string> = {
  rome: "RM", milan: "MI", florence: "FI", naples: "NA", turin: "TO", venice: "VE", genoa: "GE", padua: "PD", mantua: "MN",
  syracuse: "SR", "reggio di calabria": "RC", forli: "FC", cesena: "FC", "valle d'aosta": "AO", "aosta valley": "AO",
  "bolzano-bozen": "BZ", bozen: "BZ", "south tyrol": "BZ", monza: "MB", pesaro: "PU", urbino: "PU", andria: "BT", trani: "BT",
  barletta: "BT", verbania: "VB", "massa carrara": "MS", "forli cesena": "FC", "forli-cesena": "FC", "la spezia": "SP", laquila: "AQ",
};

const norm = (s: string) => stripAccents(s).toLowerCase().replace(/^(provincia|province|prov\.?|citta metropolitana|metropolitan city)\s+(di|of|del|della)\s+/, "").replace(/\s+/g, " ").trim();

const BY_NAME = new Map<string, string>();
for (const [code, name] of Object.entries(PROVINCES)) BY_NAME.set(norm(name), code);
for (const [alias, code] of Object.entries(ALIASES)) BY_NAME.set(norm(alias), code);

/** Turn an `area` value into a 2-letter province code. A 2-letter value is taken as a code; a known province name maps to its code;
 *  anything else is returned as `town` (a comune name) so the caller can match it against the station list. */
export function resolveItArea(area: string | undefined): { province?: string; town?: string } {
  const a = area?.trim();
  if (!a) return {};
  if (/^[A-Za-z]{2}$/.test(a)) return { province: a.toUpperCase() };
  const hit = BY_NAME.get(norm(a));
  if (hit) return { province: hit };
  return { town: a };
}
