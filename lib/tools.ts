// Shared tool logic used by both the MCP plug and the REST API, so answers are identical.

import { ukHomeSales, UK_PROPERTY_TYPES, UkPropertyType } from "./sources/uk";
import { sgHomeSales } from "./sources/sg";
import { frHomeSales } from "./sources/frdvf";
import { frFuelNow, FrFuel } from "./sources/frfuel";
import { esFuelNow } from "./sources/esfuel";
import { itFuelNow } from "./sources/itfuel";
import { Fuel, FUELS, normaliseFuel } from "./fuels";
import { SOURCES } from "./sources";
import { PriceAnswer } from "./answer";
import { SourceError } from "./http";

export async function homeSales(input: {
  country: string;
  town?: string;
  postcode?: string;
  postcode_district?: string;
  property_type?: string;
  flat_type?: string;
  months?: number;
  baseUrl?: string;
}): Promise<PriceAnswer> {
  const c = input.country.toUpperCase();
  if (c === "FR" || c === "FRANCE") {
    if (!input.town?.trim() && !input.postcode?.trim()) throw new SourceError("A French town or postcode is required.");
    return frHomeSales(input);
  }
  if (!input.town?.trim()) throw new SourceError("A town is required.");
  const town = input.town;
  if (c === "GB" || c === "UK" || c === "ENGLAND" || c === "WALES") {
    const pt = (input.property_type ?? "any").toLowerCase();
    if (!UK_PROPERTY_TYPES.includes(pt as UkPropertyType)) {
      throw new SourceError(`property_type must be one of: ${UK_PROPERTY_TYPES.join(", ")}`);
    }
    return ukHomeSales({ ...input, town, property_type: pt as UkPropertyType });
  }
  if (c === "SG" || c === "SINGAPORE") return sgHomeSales({ ...input, town });
  throw new SourceError(`Home sales are available for GB (England & Wales), FR and SG so far. Not yet: ${input.country}.`);
}

const FR_NAME: Partial<Record<Fuel, FrFuel>> = {
  diesel: "gazole",
  petrol95: "sp95",
  petrol98: "sp98",
  e10: "e10",
  e85: "e85",
  lpg: "gplc",
};

export async function fuelNow(input: {
  country: string;
  postcode?: string;
  department?: string;
  area?: string;
  town?: string;
  fuel: string;
  service?: string;
  baseUrl?: string;
}): Promise<PriceAnswer> {
  const c = input.country.toUpperCase();
  const fuel = normaliseFuel(input.fuel ?? "");
  if (!fuel) throw new SourceError(`fuel must be one of: ${FUELS.join(", ")}`);
  if (c === "FR" || c === "FRANCE") {
    const fr = FR_NAME[fuel];
    if (!fr) throw new SourceError(`Fuel '${fuel}' is not published for France.`);
    return frFuelNow({ postcode: input.postcode, department: input.department ?? input.area, fuel: fr, baseUrl: input.baseUrl });
  }
  if (c === "ES" || c === "SPAIN") {
    return esFuelNow({ postcode: input.postcode, area: input.area ?? input.department, town: input.town, fuel, baseUrl: input.baseUrl });
  }
  if (c === "IT" || c === "ITALY") {
    const service = input.service === "served" ? "served" : "self";
    return itFuelNow({ area: input.area, town: input.town, fuel, service, baseUrl: input.baseUrl });
  }
  throw new SourceError(`Live fuel prices are available for FR, ES and IT so far. Not yet: ${input.country}.`);
}

export function coverage() {
  return {
    service: "Price Paid plug (v0, private test)",
    purpose: "Real prices actually paid, from official records, in one place for AI agents.",
    tools: [
      { name: "pricepaid_home_sales", countries: ["GB (England & Wales)", "FR", "SG"] },
      { name: "pricepaid_fuel_prices_now", countries: ["FR", "ES", "IT"] },
    ],
    sources: Object.values(SOURCES),
    rules: [
      "Every answer is a range with its sample size, period, confidence, source and licence.",
      "No figure is published from fewer than 5 records.",
      "Aggregates only: no individual addresses or personal data are returned for home sales.",
      "Information, not a valuation or offer.",
    ],
    coming_next: ["Verified used-phone receipts", "More countries: Taiwan, South Korea, Japan, NSW (Australia)", "Live fuel: South Korea"],
  };
}
