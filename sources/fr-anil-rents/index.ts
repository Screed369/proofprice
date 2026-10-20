// Manifest: France observed rents (Observatoires Locaux des Loyers, ANIL network, via data.gouv.fr). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, frRent } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["FR"],
  countryHelp: "FR = France (observed rents in about 50 agglomerations, local rent observatories)",
  placeName: "France",
  status: "live",
  paramNotes: {
    town: "FR: required. An observed agglomeration: 'Paris' (the city), 'Ile-de-France' (Paris agglomeration), 'Marseille', 'Toulouse', 'Nantes', 'Rennes', 'Strasbourg', 'Bordeaux', 'Montpellier' (about 50 areas; Lyon and Lille are not observed). A name that is not observed returns the full list.",
    postcode: "FR: not used; give the agglomeration as town.",
    property_type: "FR: apartment (flat), house or leave out for all homes. Single rooms are not published.",
    bedrooms: "FR: 0 (studio) to 3 or more; leave out for all sizes. France counts rooms including the living room, so 1 bedroom = 2 rooms (T2).",
    months: "FR: ignored; the figure is for the latest year published.",
  },
  extraParams: {
    tenancy: z.enum(["all", "new", "existing"]).optional().describe("FR only: all leases (default), new = leases signed in the last year (what a new tenant faces), existing = leases of one year or more. New leases are published per dwelling type, not per size."),
  },
  examples: [
    { params: { country: "FR", town: "Toulouse", property_type: "apartment", bedrooms: "1" } },
    { params: { country: "FR", town: "Paris" }, smoke: false },
  ],
  method:
    "France rents: the median monthly rent of leases observed by the local rent observatories (ANIL network) in the chosen agglomeration, with the publisher's own 10th-90th percentile and number of observations, from the national results on data.gouv.fr. Observed rents on real leases, not listing rents; groups under 5 observations are not shown.",
  handle: (p, ctx) =>
    frRent({
      town: str(p.town),
      property_type: str(p.property_type),
      bedrooms: num(p.bedrooms),
      tenancy: str(p.tenancy),
      baseUrl: ctx.baseUrl,
    }),
});
