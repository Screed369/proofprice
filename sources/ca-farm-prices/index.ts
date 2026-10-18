import { defineSource } from "../../lib/plugin";
import { SourceError } from "../../lib/http";
import { INFO } from "./source";
import { loadCubeMeta, latestPeriods, coordinate, wdsPost } from "../_ca-statcan/wds";
export default defineSource({
  info: INFO, category: "farm-gate-prices", countries: ["CA"], countryHelp: "CA", placeName: "Canada", status: "live", paramNotes: {},
  examples: [{ params: { country: "CA", product: "wheat" } }], method: "debug",
  handle: async (p) => {
    if (String(p.product) === "uom") {
      const vecs = [31212140,31212143,31212144,31212146,31212148,31212152,31212161,31212164,31212165,87007873,87007867].map((v) => ({ vectorId: v }));
      const info: any = await wdsPost("getSeriesInfoFromVector", vecs);
      const cs: any = await (await fetch("https://www150.statcan.gc.ca/t1/wds/rest/getCodeSets")).json();
      throw new SourceError(JSON.stringify({ info: info.map((x: any) => x.object), uom: cs.object?.uom, scalar: cs.object?.scalar }).slice(0, 9000));
    }
    if (String(p.product) === "data") {
      const geos = [8, 6]; const prods = [3, 14, 15, 18, 27, 37, 40, 41, 23, 1];
      const body = geos.flatMap((g) => prods.map((q) => ({ productId: 32100077, coordinate: coordinate([g, q]), latestN: 3 })));
      const d: any = await wdsPost("getDataFromCubePidCoordAndLatestNPeriods", body);
      const vecs = d.filter((x: any) => x.status === "SUCCESS").map((x: any) => ({ vectorId: x.object.vectorId }));
      const info: any = await wdsPost("getSeriesInfoFromVector", vecs);
      const meta: any = await wdsPost("getCubeMetadata", [{ productId: 32100077 }]);
      const o = meta[0].object; const keys = Object.keys(o).filter((k) => !["dimension", "footnote", "correspondenceFootnote"].includes(k));
      throw new SourceError(JSON.stringify({ keys: keys.map((k) => [k, typeof o[k] === "object" ? JSON.stringify(o[k]).slice(0, 300) : o[k]]), data: d.slice(0, 20).map((x: any) => ({ s: x.status, c: x.object.coordinate, v: x.object.vectorId, pts: x.object.vectorDataPoint })), info }).slice(0, 14000));
    }
    const m = await loadCubeMeta(32100077);
    let out = m.title + "|" + m.startDate + "|" + m.endDate + "|" + m.releaseTime + "\n";
    for (const d of m.dimensions) { out += `DIM ${d.position} ${d.name} n=${d.members.length}\n`; if (d.members.length < 60 || String(p.product)==="all") out += d.members.map(x=>`${x.id}|${x.name}|${x.parent}|${x.terminated?1:0}`).join("\n")+"\n"; }
    throw new SourceError(out);
  },
});
