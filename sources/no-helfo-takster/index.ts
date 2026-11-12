// Manifest: Norway health service fee tariffs (Helsedirektoratet takster). Logic lives in ./source.ts.
// Free tier only (no licence stated on the page). State tariff fees, not paid prices.
import { defineSource, str } from "../../lib/plugin";
import { INFO, noMedicalPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "medical",
  countries: ["NO"],
  countryHelp: "NO = Norway (state tariff fees for doctors, psychologists, dentists and physiotherapists under the Helfo scheme, NOK; posted tariffs, not paid prices)",
  placeName: "Norway (state tariff fees for doctors, psychologists, dentists, physiotherapists)",
  status: "live",
  paramNotes: {
    service:
      "NO: a service in plain words ('consultation', 'cataract operation', 'ECG', 'psychologist', 'physiotherapy', 'dentist check-up'; Norwegian words work too: 'konsultasjon', 'katarakt') or a tariff code such as 'S2ad' (GP consultation) or 'K01a' (cataract operation). " +
      "Name the profession (doctor, psychologist, dentist, physiotherapist) to search only that tariff; doctors come first otherwise. Hospital stays have no Norwegian data here.",
    state: "NO: not used, leave out.",
    setting: "NO: not used, leave out.",
  },
  examples: [
    { params: { country: "NO", service: "cataract operation" } },
    { params: { country: "NO", service: "S2ad" }, smoke: false },
    { params: { country: "NO", service: "psychologist" }, smoke: false },
  ],
  method:
    "Norway: the fee set in the Helsedirektoratet tariff (takster) for the numbered service, with the part the state refunds, from the newest tariff file for each profession. " +
    "These are state tariff fees, not what patients paid: patients pay the difference, and private providers outside the scheme set their own prices.",
  handle: (p, ctx) => noMedicalPrices({ service: str(p.service), state: str(p.state), setting: str(p.setting), baseUrl: ctx.baseUrl }),
});
