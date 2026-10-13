// TEMPLATE. Exampleland pump prices from <publisher>'s open feed (format checked live on <date>).
import { fetchJson, SourceError } from "../../lib/http";
import { summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "_template", // must equal the folder name
  country: "XX",
  category: "fuel (pump prices)",
  name: "Official dataset name",
  publisher: "Publishing body",
  what_is_recorded: "What one record is.",
  price_type: "posted_pump_price",
  freshness: "Daily",
  licence: "Licence name and version",
  licence_url: "https://example.org/licence",
  attribution: "Exact attribution line the licence asks for.",
  homepage: "https://example.org/dataset",
  limits: "What this data does not cover.",
};

/** Pure parser: export it and unit-test it against a fixture copied from the live format. */
export function parseExample(json: any): number[] {
  if (!Array.isArray(json?.items)) throw new SourceError("Unexpected response from <publisher>");
  return json.items.map((r: any) => Number(r.price)).filter((v: number) => Number.isFinite(v) && v > 0);
}

export async function exampleNow(input: { area?: string; fuel: string; baseUrl?: string }): Promise<PriceAnswer> {
  if (!input.area) throw new SourceError("Give an Exampleland region code as area.");
  const json = await fetchJson(`https://example.org/api?region=${encodeURIComponent(input.area)}`);
  const s = summarise(parseExample(json));
  return buildAnswer({
    source: INFO,
    query: { country: "XX", area: input.area, fuel: input.fuel },
    summary: s,
    currency: "EUR",
    unit: "per litre",
    period: { from: null, to: null },
    method: "Median and 10th–90th percentile of ...",
    describe: (x) => `Diesel in region ${input.area} costs a median of ${fmtMoney(x.median, "EUR")} per litre.`,
    baseUrl: input.baseUrl,
  });
}
