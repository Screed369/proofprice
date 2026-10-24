// France DVF: places the daily collector stores (stale-if-error copy and /history). Static, so a request can be matched to its
// library key without a network call (the geo API is slow from Vercel). Codes are INSEE commune codes; DVF does not cover
// Alsace-Moselle, so Strasbourg, Metz and Mulhouse are not here.

export interface FrPlace {
  code: string; // INSEE commune code (city level); for cities with arrondissements this is the city code
  dep: string;
  name: string;
  aliases?: string[];
}

export const FR_CITIES: FrPlace[] = [
  { code: "75056", dep: "75", name: "Paris" },
  { code: "69123", dep: "69", name: "Lyon" },
  { code: "13055", dep: "13", name: "Marseille" },
  { code: "31555", dep: "31", name: "Toulouse" },
  { code: "06088", dep: "06", name: "Nice" },
  { code: "44109", dep: "44", name: "Nantes" },
  { code: "34172", dep: "34", name: "Montpellier" },
  { code: "33063", dep: "33", name: "Bordeaux" },
  { code: "59350", dep: "59", name: "Lille" },
  { code: "35238", dep: "35", name: "Rennes" },
  { code: "51454", dep: "51", name: "Reims" },
  { code: "42218", dep: "42", name: "Saint-Étienne", aliases: ["St Etienne"] },
  { code: "83137", dep: "83", name: "Toulon" },
  { code: "76351", dep: "76", name: "Le Havre" },
  { code: "38185", dep: "38", name: "Grenoble" },
  { code: "21231", dep: "21", name: "Dijon" },
  { code: "49007", dep: "49", name: "Angers" },
  { code: "30189", dep: "30", name: "Nîmes" },
  { code: "69266", dep: "69", name: "Villeurbanne" },
  { code: "63113", dep: "63", name: "Clermont-Ferrand" },
  { code: "72181", dep: "72", name: "Le Mans" },
  { code: "13001", dep: "13", name: "Aix-en-Provence", aliases: ["Aix"] },
  { code: "29019", dep: "29", name: "Brest" },
  { code: "37261", dep: "37", name: "Tours" },
  { code: "80021", dep: "80", name: "Amiens" },
  { code: "87085", dep: "87", name: "Limoges" },
  { code: "74010", dep: "74", name: "Annecy" },
  { code: "66136", dep: "66", name: "Perpignan" },
  { code: "92012", dep: "92", name: "Boulogne-Billancourt" },
  { code: "25056", dep: "25", name: "Besançon" },
  { code: "45234", dep: "45", name: "Orléans" },
  { code: "76540", dep: "76", name: "Rouen" },
  { code: "14118", dep: "14", name: "Caen" },
  { code: "54395", dep: "54", name: "Nancy" },
  { code: "78646", dep: "78", name: "Versailles" },
  { code: "06029", dep: "06", name: "Cannes" },
  { code: "06004", dep: "06", name: "Antibes" },
  { code: "17300", dep: "17", name: "La Rochelle" },
  { code: "64445", dep: "64", name: "Pau" },
  { code: "64102", dep: "64", name: "Bayonne" },
  { code: "64122", dep: "64", name: "Biarritz" },
  { code: "84007", dep: "84", name: "Avignon" },
];

export interface FrArrondissement {
  code: string; // INSEE code of the arrondissement municipal
  dep: string;
  postcode: string;
  city: string; // city INSEE code
  name: string;
}

const ordinal = (n: number) => (n === 1 ? "1er" : `${n}e`);

function arrondissements(city: string, dep: string, cityName: string, count: number, codeBase: number, postBase: number): FrArrondissement[] {
  return Array.from({ length: count }, (_, i) => ({
    code: String(codeBase + i + 1),
    dep,
    postcode: String(postBase + i + 1).padStart(5, "0"),
    city,
    name: `${cityName} ${ordinal(i + 1)} arrondissement`,
  }));
}

export const FR_ARRONDISSEMENTS: FrArrondissement[] = [
  ...arrondissements("75056", "75", "Paris", 20, 75100, 75000),
  ...arrondissements("69123", "69", "Lyon", 9, 69380, 69000),
  ...arrondissements("13055", "13", "Marseille", 16, 13200, 13000),
];

/** Lower case, no accents, letters and digits only separated by single spaces. */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function findCity(town: string): FrPlace | null {
  const t = norm(town);
  if (!t) return null;
  return FR_CITIES.find((c) => norm(c.name) === t || (c.aliases ?? []).some((a) => norm(a) === t)) ?? null;
}

export function findArrondissementByPostcode(postcode: string): FrArrondissement | null {
  const cp = postcode.replace(/\D/g, "").slice(0, 5);
  return FR_ARRONDISSEMENTS.find((a) => a.postcode === cp) ?? null;
}

export function arrondissementsOf(cityCode: string): FrArrondissement[] {
  return FR_ARRONDISSEMENTS.filter((a) => a.city === cityCode);
}
