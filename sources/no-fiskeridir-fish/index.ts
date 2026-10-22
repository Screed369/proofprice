// Manifest: Norway first-hand fish sales (Fiskeridirektoratet sales notes). Logic lives in ./source.ts.
// The daily collector streams the current year's file; requests are answered from the price library.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, fishHarvest, fishHistoryKey, fishPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-fresh-food",
  countries: ["NO"],
  countryHelp: "NO = Norway (Fiskeridirektoratet: first-hand prices fishers were paid per kg, from fish sales notes, newest 7 landing days)",
  placeName: "Norway",
  status: "live",
  paramNotes: {
    product:
      "Norway: a fish in English or Norwegian, e.g. cod (torsk), haddock (hyse), saithe (sei), herring (sild), mackerel (makrell), salmon (laks), halibut (kveite), shrimp (reker), king crab (kongekrabbe). " +
      "Prices are kroner per kg PAID TO THE FISHER, for one product form (the answer names it, e.g. gutted without head); other forms are listed.",
  },
  extraParams: {
    region: z.string().optional().describe("Norway fish only: landing county, e.g. 'Troms', 'Nordland', 'Møre og Romsdal'. Leave out for all Norway; a county needs 5 or more sales notes."),
  },
  examples: [
    { params: { country: "NO", product: "cod" } },
    { params: { country: "NO", product: "mackerel", region: "Møre og Romsdal" }, smoke: false },
  ],
  method:
    "Norway fish: Fiskeridirektoratet's open fish sales notes, streamed once a day into our price library; an answer is the median and 10th to 90th percentile of the price per kg paid to fishers for fish landed in Norway during the newest 7 landing days, one product form at a time, from 5 or more different sales notes.",
  handle: (p, ctx) => fishPrices({ product: str(p.product), region: str(p.region), baseUrl: ctx.baseUrl }),
  harvest: () => fishHarvest(),
  historyKey: (p) => fishHistoryKey({ product: str(p.product), region: str(p.region) }),
});
