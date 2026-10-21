// Manifest: British Columbia (Canada) home sales, average declared value of residential property transfers (BC Property Transfer Tax data). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, bcHarvest, bcHomeSales } from "./source";
import { InputError } from "../../lib/http";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["CA"],
  countryHelp: "CA = Canada, British Columbia only (Property Transfer Tax data: average declared value of residential transfers, by municipality)",
  placeName: "British Columbia, Canada",
  status: "live",
  paramNotes: {
    town: "CA (British Columbia): a municipality, rural area or regional district, e.g. Kelowna, Victoria, Surrey, 'Prince George', 'Quesnel Rural', 'Greater Vancouver'. Omit for the whole province. Other provinces are not covered.",
    postcode: "CA: not supported; BC publishes by municipality, so give the municipality as town.",
    property_type: "CA: only 'any' (or leave out); BC does not split the value by house, condo or other kind.",
    months: "CA: up to 4 gives the latest 3 months, more gives the latest 12 months. By default the latest 3 months, widening to 12 when a place is quiet. The figure is an average of declared values, not a median.",
  },
  examples: [
    { params: { country: "CA", town: "Kelowna" } },
    { params: { country: "CA" }, smoke: false },
  ],
  method:
    "British Columbia: the collector reads the Ministry of Finance's monthly Property Transfer Tax files once a day into our price library; answers are the average declared fair market value per residential transfer (total value divided by number of transfers) over the latest 3 or 12 months, per municipality, regional district or the province, with the number of transfers as the sample size. An average of declared values, not a median or a receipt price; an area with fewer than 5 transfers gets no figure.",
  handle: (p, ctx) =>
    bcHomeSales({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl }),
  harvest: bcHarvest,
  // The library holds one average per window (no distribution), so daily snapshots would only repeat it: no history yet.
  historyKey: () => {
    throw new InputError("British Columbia: ProofPrice keeps no history of the Property Transfer Tax averages yet. Ask pricepaid_home_sales (/api/v1/home-sales) for the latest figure.");
  },
});
