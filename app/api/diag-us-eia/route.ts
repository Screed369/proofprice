// TEMPORARY diagnostic route for the us-eia builder. Never merge. Parses an eia.gov spreadsheet and returns a compact view.
import { readXls } from "./xls";
import { readXlsx } from "../../../categories/rent/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const url = q.get("u") ?? "";
  if (!/^https:\/\/www\.eia\.gov\//.test(url)) return new Response("only eia.gov", { status: 400 });
  const res = await fetch(url, { headers: { "user-agent": "ProofPrice-verifier/1.0 (+https://proofprice.com; hello@proofprice.com)" } });
  const buf = Buffer.from(await res.arrayBuffer());
  const t0 = Date.now();
  let sheets;
  try {
    sheets = /\.xlsx$/i.test(url) ? readXlsx(buf) : readXls(buf);
  } catch (e: any) {
    return Response.json({ status: res.status, total: buf.length, error: String(e?.message ?? e), head: buf.subarray(0, 16).toString("hex") });
  }
  const ms = Date.now() - t0;
  const sheetQ = q.get("sheet");
  const from = Number(q.get("from") ?? 0);
  const to = Number(q.get("to") ?? 12);
  const cols = Number(q.get("cols") ?? 40);
  const list = sheets.map((s, i) => ({ i, name: s.name, rows: s.rows.length, width: Math.max(0, ...s.rows.slice(0, 50).map((r) => r.length)) }));
  if (sheetQ === null) return Response.json({ status: res.status, total: buf.length, parse_ms: ms, sheets: list });
  const sh = sheets.find((s, i) => s.name === sheetQ || String(i) === sheetQ);
  if (!sh) return Response.json({ error: "no such sheet", sheets: list });
  const ranges = q.get("ranges");
  if (ranges) {
    const out = ranges.split(",").map((rg) => {
      const [a, b] = rg.split("-").map(Number);
      return sh.rows.slice(a, b).map((r, k) => [a + k, ...r.slice(0, cols)]);
    });
    return Response.json({ sheet: sh.name, rows: sh.rows.length, out });
  }
  const tail = Number(q.get("tail") ?? 0);
  const rows = sh.rows.slice(from, to).map((r, k) => [from + k, ...r.slice(0, cols)]);
  const tailRows = tail ? sh.rows.slice(-tail).map((r, k) => [sh.rows.length - tail + k, ...r.slice(0, cols)]) : [];
  return Response.json({ status: res.status, total: buf.length, parse_ms: ms, sheet: sh.name, rows: sh.rows.length, slice: rows, tail: tailRows });
}
