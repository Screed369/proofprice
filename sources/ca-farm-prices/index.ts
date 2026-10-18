import { defineSource } from "../../lib/plugin";
import { SourceError } from "../../lib/http";
import { INFO } from "./source";
import { loadCubeMeta, latestPeriods, coordinate } from "../_ca-statcan/wds";
export default defineSource({
  info: INFO, category: "farm-gate-prices", countries: ["CA"], countryHelp: "CA", placeName: "Canada", status: "live", paramNotes: {},
  examples: [{ params: { country: "CA", product: "wheat" } }], method: "debug",
  handle: async (p) => {
    const m = await loadCubeMeta(32100077);
    let out = m.title + "|" + m.startDate + "|" + m.endDate + "|" + m.releaseTime + "\n";
    for (const d of m.dimensions) { out += `DIM ${d.position} ${d.name} n=${d.members.length}\n`; if (d.members.length < 60 || String(p.product)==="all") out += d.members.map(x=>`${x.id}|${x.name}|${x.parent}|${x.terminated?1:0}`).join("\n")+"\n"; }
    throw new SourceError(out);
  },
});
