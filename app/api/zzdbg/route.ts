export const dynamic = "force-dynamic";
const U = "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/ashi/13mu.px";
const q = (t: string[], p: string[], ty: string[], c: string[], extra: object = {}) => ({ query: [
  { code: "timeperiod_y", selection: { filter: "item", values: t } },
  { code: "postinumeroalue_4_20220101", selection: { filter: "item", values: p } },
  { code: "talotyyppi_6_20131021", selection: { filter: "item", values: ty } },
  { code: "contentscode", selection: { filter: "item", values: c } }], response: { format: "json-stat2" }, ...extra });
async function go(name: string, body: unknown) {
  try { const r = await fetch(U, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const t = await r.text(); return { name, status: r.status, body: t.slice(0, 300) }; } catch (e) { return { name, err: String(e) }; }
}
export async function GET() {
  const out = [];
  out.push(await go("orig", q(["2021","2022","2023","2024","2025"], ["00100"], ["1","2","3"], ["keskihinta_aritm_nw","lkm_julk20"])));
  out.push(await go("one-year", q(["2025"], ["00100"], ["1"], ["keskihinta_aritm_nw"])));
  out.push(await go("noprice", q(["2025"], ["00100"], ["1"], ["lkm_julk20"])));
  out.push(await go("tampere-style 5 types", q(["2025"], ["00100"], ["1","2","3","5"], ["keskihinta_aritm_nw","lkm_julk20"])));
  out.push(await go("no format", { query: q(["2025"], ["00100"], ["1"], ["keskihinta_aritm_nw"]).query }));
  out.push(await go("csv", q(["2025"], ["00100"], ["1"], ["keskihinta_aritm_nw"], {}) && { ...q(["2025"], ["00100"], ["1"], ["keskihinta_aritm_nw"]), response: { format: "csv" } }));
  return Response.json(out);
}
