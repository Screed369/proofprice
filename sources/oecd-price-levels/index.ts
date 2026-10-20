// Manifest: OECD / Eurostat PPP programme, price level indices by country and spending group. Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { COUNTRIES, INFO, SPEND_HELP, oecdPriceLevel } from "./source";

export default defineSource({
  info: INFO,
  category: "price-levels",
  countries: Object.keys(COUNTRIES),
  countryHelp:
    "Countries as ISO codes: " + Object.entries(COUNTRIES).map(([c, v]) => `${c} = ${v.name}`).join(", ") +
    ". OECD/Eurostat PPP survey: one price level index per country, year and spending group, whole country.",
  placeName: "47 countries (the 38 OECD members plus Bulgaria, Cyprus, Malta, Romania and some Balkan states)",
  status: "live",
  paramNotes: {
    spend: `OECD: ${SPEND_HELP}. The index is for the whole country, not a city.`,
    compare_to: "OECD: 'OECD' (default, OECD average = 100), 'USA' (United States = 100) or 'EU' (EU-27 average = 100).",
  },
  examples: [
    { params: { country: "IE", spend: "food" } },
    { params: { country: "CH" }, smoke: false },
    { params: { country: "ES", spend: "housing", compare_to: "EU" }, smoke: false },
  ],
  method:
    "Price levels: the price level index of the OECD/Eurostat PPP programme (OECD = 100, or the USA or the EU-27), for household consumption and about 25 everyday spending groups, one figure per country and year. " +
    "We pass on the published index and the PPP rate and calculate the gap to the comparison average and the rank among surveyed countries; it is an index from a price survey, not a receipt or a range.",
  handle: async (p, ctx) => {
    if (p.spend === "__debug") {
      const url = "https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_PPP@DF_PPP,1.1/IRL.A.PL.A0101.IX.OECD?lastNObservations=1&format=csvfilewithlabels";
      const variants: Record<string, Record<string, string>> = {
        curlish: { "user-agent": "ProofPrice-verifier/1.0 (+https://proofprice.com; hello@proofprice.com)", accept: "*/*" },
        defaults: {},
        lang: { "user-agent": "pricepaid-plug/0.1", "accept-language": "en" },
        csvAccept: { "user-agent": "curl/8.5.0", accept: "application/vnd.sdmx.data+csv" },
      };
      const out: Record<string, string> = {};
      for (const [k, h] of Object.entries(variants)) {
        try { const r = await fetch(url, { headers: h }); out[k] = r.status + " " + (await r.text()).slice(0, 80).replace(/\s+/g, " "); } catch (e: any) { out[k] = "ERR " + (e?.cause?.code ?? e?.message); }
      }
      throw new Error("DEBUG " + JSON.stringify(out));
    }
    return handleReal(p, ctx);
  },
});
const handleReal = (p: any, ctx: any) => oecdPriceLevel({ country: String(p.country), spend: str(p.spend), compare_to: str(p.compare_to), baseUrl: ctx.baseUrl });
