// THROWAWAY diagnostic (branch diag/childcare only, never merged): fetch an official file from Vercel's servers and show its shape.
import { NextRequest } from "next/server";
import { constants, inflateRawSync } from "node:zlib";
import { readXlsx, unzipAll } from "../../../categories/rent/xlsx";
import { openWorkbook, streamSheet } from "../../../sources/us-dol-childcare/xlsx-stream";

export const maxDuration = 60;
const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const url = q.get("url") ?? "";
  if (!/^https:\/\/[a-z0-9.-]+\//i.test(url)) return Response.json({ error: "give https url" }, { status: 400 });
  const mode = q.get("mode") ?? "text";
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (mode === "xmlhead") {
    const buf1 = Buffer.from(await res.arrayBuffer());
    const wb = openWorkbook(buf1, q.get("sheet") ?? undefined);
    const e = wb.dir.get(wb.sheetPath)!;
    const k = Number(q.get("k") ?? 200000);
    const off = Number(q.get("offset") ?? 0);
    const len = Number(q.get("len") ?? 6000);
    const xml = inflateRawSync(buf1.subarray(e.start, e.start + Math.min(e.csize, k)), { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8");
    return Response.json({ sheet: wb.sheetTitle, entry: e, inflated: xml.length, shared: wb.shared.length, text: xml.slice(off, off + len) });
  }
  if (mode === "stream") {
    const t0 = Date.now();
    const buf0 = Buffer.from(await res.arrayBuffer());
    const wb = openWorkbook(buf0, q.get("sheet") ?? undefined);
    const maxRows = Number(q.get("max") ?? 30);
    const skip = Number(q.get("skip") ?? 0);
    const grep0 = q.get("grep");
    const re0 = grep0 ? new RegExp(grep0, "i") : null;
    const out: { n: number; cells: unknown[] }[] = [];
    let header: string[] = [];
    let seenRows = 0;
    let lastRow = 0;
    const total = await streamSheet(buf0, wb.dir.get(wb.sheetPath)!, wb.shared, (cells, n) => {
      seenRows++;
      lastRow = n;
      if (seenRows <= skip) return;
      if (n === 1) header = cells.map((c) => String(c ?? ""));
      if (re0 && n > 1 && !re0.test(cells.slice(0, 5).map((c) => String(c ?? "")).join("|"))) return;
      const colsQ = q.get("cols");
      if (colsQ) {
        const idx = colsQ.split(",").map((nm) => header.indexOf(nm));
        out.push({ n, cells: idx.map((i) => (i >= 0 ? cells[i] ?? null : "?")) });
      } else out.push({ n, cells });
      if (out.length >= maxRows && q.get("count") !== "1") return false;
    });
    return Response.json({ sheet: wb.sheetTitle, bytes: buf0.length, entry: wb.dir.get(wb.sheetPath), seenRows, total, lastRow, ms: Date.now() - t0, rows: out });
  }
  const meta = { status: res.status, type: res.headers.get("content-type"), len: res.headers.get("content-length"), final: res.url };
  const buf = Buffer.from(await res.arrayBuffer());
  const grep = q.get("grep");
  const re = grep ? new RegExp(grep, "i") : null;
  if (mode === "head") return Response.json({ ...meta, bytes: buf.length });
  if (mode === "text") {
    const text = buf.toString("utf8");
    const off = Number(q.get("offset") ?? 0);
    const len = Number(q.get("len") ?? 20000);
    if (re) {
      const out: string[] = [];
      const g = new RegExp(re.source, "gi");
      let m: RegExpExecArray | null;
      const ctx = Number(q.get("ctx") ?? 150);
      while ((m = g.exec(text)) && out.length < Number(q.get("max") ?? 40)) out.push(text.slice(Math.max(0, m.index - ctx), m.index + m[0].length + ctx));
      return Response.json({ ...meta, bytes: buf.length, matches: out });
    }
    return Response.json({ ...meta, bytes: buf.length, text: text.slice(off, off + len) });
  }
  if (mode === "zip") {
    const files = unzipAll(buf);
    const name = q.get("entry");
    if (name) {
      const e = files.get(name);
      const off = Number(q.get("offset") ?? 0);
      const len = Number(q.get("len") ?? 20000);
      return Response.json({ ...meta, entry: name, size: e?.length ?? null, text: e ? e.toString("utf8").slice(off, off + len) : null });
    }
    return Response.json({ ...meta, entries: [...files].map(([n, b]) => ({ n, size: b.length })) });
  }
  if (mode === "xlsx") {
    const sheets = readXlsx(buf);
    const sh = q.get("sheet");
    if (sh === null) {
      return Response.json({ ...meta, bytes: buf.length, sheets: sheets.map((s) => ({ name: s.name, rows: s.rows.length, cols: Math.max(0, ...s.rows.slice(0, 50).map((r) => r.length)) })) });
    }
    const s = sheets.find((x) => x.name === sh) ?? sheets[Number(sh)];
    if (!s) return Response.json({ error: "no such sheet", sheets: sheets.map((x) => x.name) });
    const from = Number(q.get("from") ?? 0);
    const to = Number(q.get("to") ?? from + 10);
    if (re) {
      const hits = s.rows.map((r, i) => ({ i, r })).filter((x) => re.test(x.r.map((c) => String(c ?? "")).join("|"))).slice(0, Number(q.get("max") ?? 30));
      return Response.json({ sheet: s.name, rows: s.rows.length, header: s.rows.slice(from, to), hits });
    }
    return Response.json({ sheet: s.name, rows: s.rows.length, data: s.rows.slice(from, to) });
  }
  return Response.json({ error: "unknown mode" }, { status: 400 });
}
