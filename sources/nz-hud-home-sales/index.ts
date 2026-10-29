// Manifest: New Zealand home sales (Ministry of Housing and Urban Development, Property and sales statistics, CC BY 4.0). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, nzHarvest, nzHomeSales } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["NZ"],
  countryHelp: "NZ = New Zealand (official median sale prices of residential sales by area, monthly)",
  placeName: "New Zealand",
  status: "live",
  paramNotes: {
    town:
      "NZ: a city or territorial authority ('Wellington', 'Christchurch', 'Hamilton', 'Queenstown-Lakes', 'Far North'), an Auckland local board ('Howick', 'Albert-Eden'), a region ('Canterbury', 'Otago', 'Wellington region'), or leave out for New Zealand. A name that is both a city and a region (Wellington, Auckland) gives the city; add 'region' for the region. Macrons are optional ('Taupo').",
    postcode: "NZ: not supported; the publisher gives figures by area, so give the area as town.",
    property_type: "NZ: leave out or 'any'. The publisher gives one figure for all residential sales (houses, apartments and other dwellings together).",
    months: "NZ: 1 gives the month, 2 to 6 the 3-month figure, 7 or more (and the default 12) the 12-month rolling figure. Small areas often have no monthly price, so the answer falls back to a wider window and says so.",
  },
  examples: [
    { params: { country: "NZ", town: "Wellington" } },
    { params: { country: "NZ", town: "Queenstown-Lakes", months: "3" }, smoke: false },
    { params: { country: "NZ" }, smoke: false },
  ],
  method:
    "New Zealand: the median sale price, lower and upper quartile and number of residential sales that HUD publishes per area (the country, 17 regions, 67 territorial authorities, 21 Auckland local boards) for a month, a 3-month and a 12-month window, from the District Valuation Roll; we collect the newest period once a day and answer from that copy.",
  handle: (p, ctx) => nzHomeSales({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl }),
  harvest: () => nzHarvest(),
  referenceDates: true,
  // HUD rewrites its whole series every month and the library keeps only the newest period, so daily snapshots would only repeat it: no history yet.
  historyKey: () => null,
  noHistory: "New Zealand: ProofPrice keeps only the newest month of HUD's sale statistics and no history of it yet. Ask pricepaid_home_sales (/api/v1/home-sales) for the newest figure.",
});
