// French department names -> INSEE codes (metropolitan 01-95 incl. 2A/2B, overseas 971-976), so area=Gironde works like area=33.
// Agents ask by name far more often than by code. Match is accent-, case- and punctuation-insensitive.
export const FR_DEPARTMENT_NAMES: Record<string, string> = {
  "01": "Ain",
  "02": "Aisne",
  "03": "Allier",
  "04": "Alpes-de-Haute-Provence",
  "05": "Hautes-Alpes",
  "06": "Alpes-Maritimes",
  "07": "Ardèche",
  "08": "Ardennes",
  "09": "Ariège",
  "10": "Aube",
  "11": "Aude",
  "12": "Aveyron",
  "13": "Bouches-du-Rhône",
  "14": "Calvados",
  "15": "Cantal",
  "16": "Charente",
  "17": "Charente-Maritime",
  "18": "Cher",
  "19": "Corrèze",
  "21": "Côte-d'Or",
  "22": "Côtes-d'Armor",
  "23": "Creuse",
  "24": "Dordogne",
  "25": "Doubs",
  "26": "Drôme",
  "27": "Eure",
  "28": "Eure-et-Loir",
  "29": "Finistère",
  "2A": "Corse-du-Sud",
  "2B": "Haute-Corse",
  "30": "Gard",
  "31": "Haute-Garonne",
  "32": "Gers",
  "33": "Gironde",
  "34": "Hérault",
  "35": "Ille-et-Vilaine",
  "36": "Indre",
  "37": "Indre-et-Loire",
  "38": "Isère",
  "39": "Jura",
  "40": "Landes",
  "41": "Loir-et-Cher",
  "42": "Loire",
  "43": "Haute-Loire",
  "44": "Loire-Atlantique",
  "45": "Loiret",
  "46": "Lot",
  "47": "Lot-et-Garonne",
  "48": "Lozère",
  "49": "Maine-et-Loire",
  "50": "Manche",
  "51": "Marne",
  "52": "Haute-Marne",
  "53": "Mayenne",
  "54": "Meurthe-et-Moselle",
  "55": "Meuse",
  "56": "Morbihan",
  "57": "Moselle",
  "58": "Nièvre",
  "59": "Nord",
  "60": "Oise",
  "61": "Orne",
  "62": "Pas-de-Calais",
  "63": "Puy-de-Dôme",
  "64": "Pyrénées-Atlantiques",
  "65": "Hautes-Pyrénées",
  "66": "Pyrénées-Orientales",
  "67": "Bas-Rhin",
  "68": "Haut-Rhin",
  "69": "Rhône",
  "70": "Haute-Saône",
  "71": "Saône-et-Loire",
  "72": "Sarthe",
  "73": "Savoie",
  "74": "Haute-Savoie",
  "75": "Paris",
  "76": "Seine-Maritime",
  "77": "Seine-et-Marne",
  "78": "Yvelines",
  "79": "Deux-Sèvres",
  "80": "Somme",
  "81": "Tarn",
  "82": "Tarn-et-Garonne",
  "83": "Var",
  "84": "Vaucluse",
  "85": "Vendée",
  "86": "Vienne",
  "87": "Haute-Vienne",
  "88": "Vosges",
  "89": "Yonne",
  "90": "Territoire de Belfort",
  "91": "Essonne",
  "92": "Hauts-de-Seine",
  "93": "Seine-Saint-Denis",
  "94": "Val-de-Marne",
  "95": "Val-d'Oise",
  "971": "Guadeloupe",
  "972": "Martinique",
  "973": "Guyane",
  "974": "La Réunion",
  "976": "Mayotte",
};

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
const BY_NAME = new Map<string, string>();
for (const [code, name] of Object.entries(FR_DEPARTMENT_NAMES)) BY_NAME.set(norm(name), code);
// Common English / alternative spellings agents use.
for (const [alias, code] of Object.entries({
  "corsica south": "2A", "south corsica": "2A", "upper corsica": "2B", "haute corse": "2B", "corse du sud": "2A",
  "reunion": "974", "la reunion": "974", "french guiana": "973", "guiana": "973", "bouches du rhone": "13",
  "seine et marne": "77", "paris department": "75",
}) as [string, string][]) BY_NAME.set(norm(alias), code);

/** A department given as a code ('69', '2A', '971') or a name ('Rhône', 'rhone', 'Côte-d'Or'): the INSEE code, or null. */
export function frDepartmentCode(input: string): string | null {
  const t = input.trim();
  if (/^(\d{2,3}|2[AB])$/i.test(t)) return t.toUpperCase();
  const withoutPrefix = t.replace(/^(d[eé]partement|dept\.?|dep\.?)\s+(du |de la |de l'|des |de |d')?/i, "");
  return BY_NAME.get(norm(withoutPrefix)) ?? BY_NAME.get(norm(t)) ?? null;
}

/** French regions by name (French and English spellings agents use) -> INSEE region code used by the price library ("R84" ...). */
const REGION_BY_NAME = new Map<string, string>();
for (const [alias, code] of Object.entries({
  "auvergne rhone alpes": "R84", "auvergne": "R84", "rhone alpes": "R84",
  "bourgogne franche comte": "R27", "bourgogne": "R27", "burgundy": "R27", "franche comte": "R27",
  "bretagne": "R53", "brittany": "R53",
  "centre val de loire": "R24", "centre": "R24",
  "corse": "R94", "corsica": "R94",
  "grand est": "R44", "alsace": "R44", "lorraine": "R44", "champagne ardenne": "R44",
  "hauts de france": "R32", "nord pas de calais": "R32", "picardie": "R32", "picardy": "R32",
  "ile de france": "R11", "paris region": "R11", "region parisienne": "R11",
  "normandie": "R28", "normandy": "R28",
  "nouvelle aquitaine": "R75", "aquitaine": "R75", "limousin": "R75", "poitou charentes": "R75",
  "occitanie": "R76", "languedoc roussillon": "R76", "midi pyrenees": "R76",
  "pays de la loire": "R52", "pays de loire": "R52",
  "provence alpes cote d azur": "R93", "paca": "R93", "provence": "R93", "cote d azur": "R93",
}) as [string, string][]) REGION_BY_NAME.set(norm(alias), code);

/** A region given by name ('Bretagne', 'Île-de-France', 'Occitanie', 'Brittany', 'PACA'): its library code ("R53"), or null.
 *  Department names win: 'Corse-du-Sud' is a department, 'Corse' the region. */
export function frRegionCode(input: string): string | null {
  const t = input.trim();
  if (!t || frDepartmentCode(t)) return null;
  return REGION_BY_NAME.get(norm(t.replace(/^(r[eé]gion|region)\s+(du |de la |de l'|des |de |d')?/i, ""))) ?? REGION_BY_NAME.get(norm(t)) ?? null;
}
