export const dynamic = "force-dynamic";
const BASE = "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/ashi/13mu.px";
export async function GET() {
  const out: any = {};
  const meta = await (await fetch(BASE)).json();
  out.vars = meta.variables.map((v: any) => ({ code: v.code, n: v.values.length, first: v.values.slice(0, 3), last: v.values.slice(-3), texts: v.valueTexts.slice(0, 8), elim: v.elimination, time: v.time }));
  const [time, postal, type, contents] = meta.variables;
  const mk = (t: string[], p: string[], ty: string[], c: string[], fmt = "json-stat2") => ({ query: [
    { code: time.code, selection: { filter: "item", values: t } },
    { code: postal.code, selection: { filter: "item", values: p } },
    { code: type.code, selection: { filter: "item", values: ty } },
    { code: contents.code, selection: { filter: "item", values: c } } ], response: { format: fmt } });
  const lastT = time.values.slice(-5);
  const variants: Record<string, any> = {
    current: mk(lastT, ["00100"], type.values, contents.values),
    oneYear: mk(time.values.slice(-1), ["00100"], type.values, contents.values),
    oneType: mk(lastT, ["00100"], [type.values[0]], contents.values),
    onePrice: mk(lastT, ["00100"], type.values, [contents.values[0]]),
    csv: mk(lastT, ["00100"], type.values, contents.values, "csv"),
    jsonstat1: mk(lastT, ["00100"], type.values, contents.values, "json-stat"),
  };
  for (const [k, body] of Object.entries(variants)) {
    try {
      const r = await fetch(BASE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const t = await r.text();
      out[k] = { status: r.status, body: t.slice(0, 600), reqsample: k === "current" ? JSON.stringify(body) : undefined };
    } catch (e: any) { out[k] = { error: String(e) }; }
  }
  return Response.json(out);
}
