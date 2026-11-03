// Manifest: Taiwan rice prices (Ministry of Agriculture national average daily retail, wholesale and paddy prices). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, twHarvest, twHistoryKey, twRicePrices } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["TW"],
  countryHelp: "TW = Taiwan (Ministry of Agriculture: national average daily rice prices, retail, wholesale and paddy)",
  placeName: "Taiwan",
  status: "live",
  paramNotes: {
    item:
      "TW: rice only. 'rice' = retail japonica white rice (NT$ per kg); also indica rice, soft indica rice, glutinous rice, long glutinous rice; " +
      "'wholesale rice' (and wholesale indica / glutinous rice) in NT$ per 100 kg; 'paddy' (unhusked rice, also indica / glutinous paddy) in NT$ per 100 kg.",
    region: "TW: national averages only; a region is ignored and the answer says so.",
  },
  examples: [
    { params: { country: "TW", item: "rice" } },
    { params: { country: "TW", item: "wholesale rice" }, smoke: false },
    { params: { country: "TW", item: "glutinous rice" }, smoke: false },
  ],
  method:
    "Taiwan (groceries): the national average daily price of rice that the Agriculture and Food Agency (Ministry of Agriculture) publishes, retail per kg, wholesale and paddy per 100 kg, for each variety, with the changes on a month and a year earlier. We pass on the published average and its date; it is a statistic, not receipts.",
  handle: (p, ctx) => twRicePrices({ item: String(p.item ?? ""), region: str(p.region), baseUrl: ctx.baseUrl }),
  harvest: () => twHarvest(),
  historyKey: (p) => twHistoryKey({ item: str(p.item) }),
  referenceDates: true,
  nominalCounts: true,
});
