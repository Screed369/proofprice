// Manifest: Indonesia daily staple-food prices in traditional markets (Bank Indonesia PIHPS Nasional). Logic lives in ./source.ts.
// Served free only: the publisher states no licence (all rights reserved), so this source is not on the cleared-for-paid list.
import { defineSource, str } from "../../lib/plugin";
import { INFO, ITEMS, idBiPihps } from "./source";
import { matchItem } from "../../categories/groceries/items";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["ID"],
  countryHelp: "ID = Indonesia (Bank Indonesia PIHPS: daily average market prices of 10 staple foods, national or by province)",
  placeName: "Indonesia",
  status: "live",
  paramNotes: {
    item:
      "ID: a staple food in English or Indonesian: rice (beras), chicken (ayam), beef (sapi), eggs (telur), shallots, garlic, red chilli (cabai), bird's-eye chilli (cabai rawit), cooking oil (minyak goreng), sugar (gula). " +
      "Varieties such as medium rice, curly chilli or premium sugar are listed in the answer. Prices are rupiah per kg.",
    region: "ID: one of the 34 provinces ('DKI Jakarta', 'Jawa Barat', 'Bali', 'West Java'...); leave out for the national average.",
  },
  examples: [
    { params: { country: "ID", item: "rice" } },
    { params: { country: "ID", item: "eggs", region: "Jawa Barat" }, smoke: false },
  ],
  method:
    "Indonesia (groceries): the daily average price of staple foods in traditional markets published by Bank Indonesia's PIHPS Nasional, for the newest full day, with the change on a week and a year earlier. " +
    "We pass on the published average; it comes from a market price survey, not receipts.",
  // Shares ID with un-wfp-food-prices: this source answers the staple foods PIHPS lists; WFP keeps every other item.
  // PLATFORM TASK: un-wfp-food-prices needs the matching serves() (not PIHPS staples) before this branch can merge.
  serves: (p) => matchItem(ITEMS, String(p.item ?? "")).primary !== null,
  handle: (p, ctx) => idBiPihps({ item: String(p.item ?? ""), region: str(p.region), baseUrl: ctx.baseUrl }),
});
