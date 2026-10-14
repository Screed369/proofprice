// Australia home sales: the router. One request in, one answer out.
//
//  - ABS Data API, mean price of residential dwellings by state and territory (./abs.ts): used for a state or territory, a city, a postcode and for
//    Australia as a whole. CC BY 4.0, no key. This is the only module.
//  - NSW Valuer General bulk property sales (suburb and postcode level prices): NOT built. The NSW Property Sales Information files are published
//    under Creative Commons BY-NC-ND 4.0 (non-commercial, no derivatives), which does not allow ProofPrice to build and serve aggregates from them.
//    If Valuation NSW gives written permission or publishes under an open licence, add a module here that answers a NSW suburb or postcode
//    from a harvest and route to it in `routeAustralia` before the ABS fallback. Until then a NSW suburb is answered with the NSW state figure,
//    and the answer says so.

import type { PriceAnswer } from "../../lib/answer";
import type { FetchOptions } from "../../lib/adapters";
import { absHomePrices } from "./abs";
import { resolvePlace } from "./places";

export { INFO } from "./info";

export interface AustraliaInput {
  town?: string;
  postcode?: string;
  property_type?: string;
  baseUrl?: string;
}

export async function routeAustralia(input: AustraliaInput, o: FetchOptions & { now?: Date; apiBase?: string } = {}): Promise<PriceAnswer> {
  const place = resolvePlace(input.town, input.postcode);
  return absHomePrices(place, { ...o, baseUrl: input.baseUrl, property_type: input.property_type });
}
