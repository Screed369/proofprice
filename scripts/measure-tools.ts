import { buildToolSpecs } from "../lib/mcp-tools";
import { z } from "zod";
const specs = buildToolSpecs();
let tot = 0; const rows: any[] = [];
for (const s of specs) {
  const c: any = s.config;
  const inp = JSON.stringify(z.toJSONSchema(c.inputSchema, { io: "input" }));
  const out = JSON.stringify(z.toJSONSchema(c.outputSchema, { io: "output", unrepresentable: "any" }));
  const n = (s.name.length + c.title.length + c.description.length + inp.length + out.length) / 4;
  tot += n; rows.push([Math.round(n), s.name, c.description.length, inp.length, out.length]);
}
rows.sort((a, b) => b[0] - a[0]);
console.log("tools", specs.length, "tokens~", Math.round(tot)); console.log(rows.slice(0, 5));
