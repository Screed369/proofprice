import { defineSource, num, str } from "../../lib/plugin";
import { INFO, auctionPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "surplus-auctions",
  countries: ["FR"],
  countryHelp: "FR = France",
  placeName: "France (state auctions)",
  status: "beta",
  paramNotes: {
    what: "FR: 'cars', 'vans', 'motorbikes', 'bicycles', 'computers', 'furniture', 'jewellery', 'wine', or words from the brand, model or description ('renault clio').",
    state: "FR: the auction house city (CAV) such as 'Lyon', 'Marseille' or 'Toulouse'. The data is the 2024 file of French state auctions (seized, impounded and court sales).",
  },
  examples: [
    { params: { country: "FR", what: "cars" } },
    { params: { country: "FR", what: "renault clio", state: "Lyon" }, smoke: false },
  ],
  method: "France: median hammer price of lots sold at French state auctions (Enchères du Domaine, 2024), not retail prices.",
  handle: (p, ctx) => auctionPrices({ what: String(p.what), city: str(p.state), months: num(p.months) ?? 12, baseUrl: ctx.baseUrl }),
});
