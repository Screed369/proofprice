// One fuel vocabulary for every country, so an agent can ask the same question everywhere.
export const FUELS = ["diesel", "petrol95", "petrol98", "e10", "e85", "lpg", "methane", "heating_oil", "propane"] as const;
export type Fuel = (typeof FUELS)[number];

export const FUEL_LABEL: Record<Fuel, string> = {
  diesel: "Diesel",
  petrol95: "Unleaded 95",
  petrol98: "Unleaded 98",
  e10: "Unleaded 95-E10",
  e85: "E85 bioethanol",
  lpg: "LPG (autogas)",
  methane: "Compressed natural gas (CNG)",
  heating_oil: "Home heating oil (residential)",
  propane: "Propane (residential)",
};

// Older French names still accepted.
const ALIASES: Record<string, Fuel> = {
  gazole: "diesel",
  gasoil: "diesel",
  gasolio: "diesel",
  gasoleo: "diesel",
  sp95: "petrol95",
  benzina: "petrol95",
  petrol: "petrol95",
  unleaded: "petrol95",
  gasoline: "petrol95",
  sp98: "petrol98",
  gplc: "lpg",
  gpl: "lpg",
  glp: "lpg",
  autogas: "lpg",
  cng: "methane",
  metano: "methane",
  gnc: "methane",
  heatingoil: "heating_oil",
  homeheatingoil: "heating_oil",
  heatingfuel: "heating_oil",
};

export function normaliseFuel(raw: string): Fuel | null {
  const f = raw.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if ((FUELS as readonly string[]).includes(f)) return f as Fuel;
  return ALIASES[f] ?? null;
}

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
}
