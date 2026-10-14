// The example questions on the home page. Each one is paired with a REST request that really exists in the registry's
// example list, so the link always works. If the registry changes and a pairing disappears, we fall back to the
// registry's own first examples rather than show a dead link.

import { categoryById, exampleUrls } from "../registry";

export interface ExampleQuestion {
  question: string;
  path: string; // /api/v1/...
  tool: string; // the MCP tool that answers it
  source: string;
}

const PREFERRED: { question: string; path: string }[] = [
  { question: "What did second-hand homes in Dublin sell for?", path: "/api/v1/home-sales?country=IE&town=Dublin&property_type=second-hand" },
  { question: "What does diesel cost near postcode 75015 in Paris?", path: "/api/v1/fuel?country=FR&postcode=75015&fuel=diesel" },
  { question: "What did Singapore's Certificate of Entitlement for cars up to 1600cc (category A) go for?", path: "/api/v1/cars?country=SG&product=coe&vehicle_class=A" },
];

export function homeExamples(count = 3): ExampleQuestion[] {
  const known = exampleUrls();
  const out: ExampleQuestion[] = [];
  for (const p of PREFERRED) {
    const ex = known.find((e) => e.path === p.path);
    if (ex) out.push({ question: p.question, path: ex.path, tool: categoryById(ex.category)?.tool ?? "", source: ex.source });
  }
  for (const ex of known) {
    if (out.length >= count) break;
    if (out.some((o) => o.path === ex.path)) continue;
    out.push({ question: `Example request for ${ex.source}`, path: ex.path, tool: categoryById(ex.category)?.tool ?? "", source: ex.source });
  }
  return out.slice(0, count);
}
