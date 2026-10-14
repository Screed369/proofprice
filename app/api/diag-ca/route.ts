// TEMPORARY diagnostics (branch diag/ca-statcan only; never merged). Reads Statistics Canada WDS and full-table CSVs.
import { unzipAll } from "../../../categories/rent/xlsx";

export const maxDuration = 60;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f.replace(/\r$/, "")); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const STD = new Set(["REF_DATE", "GEO", "DGUID", "UOM", "UOM_ID", "SCALAR_FACTOR", "SCALAR_ID", "VECTOR", "COORDINATE", "VALUE", "STATUS", "SYMBOL", "TERMINATED", "DECIMALS"]);

export async function GET(req: Request) {
  const u = new URL(req.url);
  const op = u.searchParams.get("op") ?? "csv";
  const pid = u.searchParams.get("pid") ?? "";
  const UA = { "user-agent": "ProofPrice/1.0 (hello@proofprice.com)" };
  try {
    if (op === "meta") {
      const r = await fetch("https://www150.statcan.gc.ca/t1/wds/rest/getCubeMetadata", {
        method: "POST", headers: { "content-type": "application/json", ...UA }, body: JSON.stringify([{ productId: Number(pid) }]),
      });
      const text = await r.text();
      return new Response(text.slice(0, 200000), { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (op === "wds") {
      // generic POST: path + body json
      const path = u.searchParams.get("path") ?? "";
      const body = u.searchParams.get("body") ?? "[]";
      const r = await fetch(`https://www150.statcan.gc.ca/t1/wds/rest/${path}`, {
        method: "POST", headers: { "content-type": "application/json", ...UA }, body,
      });
      const text = await r.text();
      return new Response(text.slice(0, 300000), { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (op === "wdsget") {
      const path = u.searchParams.get("path") ?? "";
      const r = await fetch(`https://www150.statcan.gc.ca/t1/wds/rest/${path}`, { headers: UA });
      const text = await r.text();
      return new Response(text.slice(0, 300000), { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    // csv ops
    const zr = await fetch(`https://www150.statcan.gc.ca/n1/tbl/csv/${pid}-eng.zip`, { headers: UA });
    if (!zr.ok) return new Response(`zip HTTP ${zr.status}`, { status: 502 });
    const files = unzipAll(Buffer.from(await zr.arrayBuffer()));
    const names = [...files.keys()];
    const metaText = files.get(`${pid}_MetaData.csv`)?.toString("utf8") ?? "";
    if (op === "metacsv") return new Response(metaText.slice(0, 200000), { headers: { "content-type": "text/plain; charset=utf-8" } });
    const csv = parseCsv(files.get(`${pid}.csv`)!.toString("utf8").replace(/^﻿/, ""));
    const head = csv[0];
    const idx = (n: string) => head.indexOf(n);
    const data = csv.slice(1).filter((r) => r.length === head.length);
    const dims = head.filter((h) => !STD.has(h));
    const out: Record<string, unknown> = { names, header: head, rows: data.length, dims };
    const dates = [...new Set(data.map((r) => r[idx("REF_DATE")]))].sort();
    out.dates = { count: dates.length, first: dates[0], last10: dates.slice(-10) };
    const distinct = (col: string) => [...new Set(data.map((r) => r[idx(col)]))];
    out.distinct = Object.fromEntries([...dims, "GEO", "UOM", "SCALAR_FACTOR", "STATUS", "SYMBOL", "TERMINATED", "DECIMALS"].map((d) => [d, distinct(d).slice(0, 400)]));
    const last = dates[dates.length - 1];
    const lastRows = data.filter((r) => r[idx("REF_DATE")] === last);
    out.lastRows = lastRows.length;
    out.lastRowsSample = lastRows.slice(0, Number(u.searchParams.get("n") ?? 60)).map((r) => r.join("|"));
    const filterGeo = u.searchParams.get("geo");
    const filterRef = u.searchParams.get("ref");
    if (filterGeo || filterRef) {
      out.filtered = data
        .filter((r) => (!filterGeo || r[idx("GEO")].includes(filterGeo)) && (!filterRef || r[idx("REF_DATE")].startsWith(filterRef)))
        .slice(0, Number(u.searchParams.get("n") ?? 200))
        .map((r) => r.join("|"));
    }
    out.metaCsv = metaText.slice(0, 20000);
    return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch (e: any) {
    return new Response(`ERR ${e?.message ?? e}`, { status: 500 });
  }
}
