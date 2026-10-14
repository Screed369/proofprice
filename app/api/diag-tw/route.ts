// TEMPORARY diagnostic for the Taiwan sources. Lives only on branch diag/tw-home-sales. Never merge.
import { inflateRawSync } from "node:zlib";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";
const HOSTS = ["plvr.land.moi.gov.tw", "data.gov.tw"];

function entries(buf: Buffer) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip");
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: { name: string; method: number; csize: number; size: number; lho: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad cd");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    out.push({ name: buf.toString("utf8", p + 46, p + 46 + nl), method, csize, size, lho });
    p += 46 + nl + el + cl;
  }
  return out;
}
function read(buf: Buffer, e: { method: number; csize: number; lho: number }) {
  const start = e.lho + 30 + buf.readUInt16LE(e.lho + 26) + buf.readUInt16LE(e.lho + 28);
  const data = buf.subarray(start, start + e.csize);
  return e.method === 8 ? inflateRawSync(data) : Buffer.from(data);
}
function csv(text: string): string[][] {
  const out: string[][] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (!line) continue;
    while ((line.match(/"/g) || []).length % 2 === 1 && i + 1 < lines.length) line += "\n" + lines[++i];
    if (line.indexOf('"') < 0) { out.push(line.split(",")); continue; }
    const row: string[] = []; let f = ""; let q = false;
    for (let k = 0; k < line.length; k++) {
      const c = line[k];
      if (q) { if (c === '"' && line[k + 1] === '"') { f += '"'; k++; } else if (c === '"') q = false; else f += c; }
      else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else f += c;
    }
    row.push(f); out.push(row);
  }
  return out;
}
const top = (m: Map<string, number>, k = 60) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

async function get(url: string) {
  const u = new URL(url);
  if (!HOSTS.includes(u.hostname)) throw new Error("host not allowed");
  const t0 = Date.now();
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(240_000) });
  const buf = Buffer.from(await res.arrayBuffer());
  return { res, buf, ms: Date.now() - t0 };
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const task = q.get("task") ?? "";
  try {
    if (task === "text") {
      const { res, buf, ms } = await get(q.get("url")!);
      let t = buf.toString("utf8");
      const needle = q.get("find");
      if (needle) { const i = t.indexOf(needle); t = i >= 0 ? t.slice(i) : "NOT FOUND\n" + t.slice(0, 500); }
      t = t.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      return Response.json({ status: res.status, ms, bytes: buf.length, text: t.slice(Number(q.get("from") ?? 0), Number(q.get("from") ?? 0) + Number(q.get("len") ?? 8000)) });
    }
    if (task === "zipinfo") {
      const { res, buf, ms } = await get(q.get("url")!);
      let list: unknown = null;
      try { list = entries(buf).map((e) => `${e.name} ${e.size}`); } catch (e: any) { list = String(e.message) + " head=" + buf.subarray(0, 200).toString("utf8"); }
      return Response.json({ status: res.status, ms, bytes: buf.length, type: res.headers.get("content-type"), disp: res.headers.get("content-disposition"), list });
    }
    if (task === "stats") {
      // kind=a (sales) or c (rentals); url = a zip
      const kind = q.get("kind") ?? "a";
      const { res, buf, ms } = await get(q.get("url")!);
      const es = entries(buf).filter((e) => new RegExp(`^[a-z]_lvr_land_${kind}\\.csv$`, "i").test(e.name));
      const maps: Record<string, Map<string, number>> = {};
      const m = (k: string) => (maps[k] ??= new Map());
      let rows = 0;
      let header: string[] = [];
      const t1 = Date.now();
      const cityDistrict = new Map<string, number>();
      const dates: string[] = [];
      for (const e of es) {
        const rec = csv(read(buf, e).toString("utf8"));
        const h = rec[0]; header = h;
        const idx = (n: string) => h.indexOf(n);
        const col = (r: string[], n: string) => r[idx(n)] ?? "";
        for (const r of rec.slice(2)) {
          rows++;
          bump(m("object"), col(r, kind === "a" ? "交易標的" : "交易標的"));
          bump(m("type"), col(r, "建物型態"));
          bump(m("use"), col(r, "主要用途"));
          bump(m("zone"), col(r, "都市土地使用分區").slice(0, 16));
          bump(m("nonurban"), col(r, "非都市土地使用分區"));
          bump(m("nonurbanuse"), col(r, "非都市土地使用編定"));
          for (const part of col(r, "備註").split("；")) if (part) bump(m("notes"), part.replace(/\d+/g, "#").slice(0, 60));
          if (kind === "c") {
            bump(m("rtype"), col(r, "出租型態"));
            bump(m("rsvc"), col(r, "租賃住宅服務"));
          }
          const d = col(r, kind === "a" ? "交易年月日" : "租賃年月日");
          bump(m("datemonth"), d.slice(0, 5));
          bump(cityDistrict, e.name[0].toUpperCase() + "|" + col(r, "鄉鎮市區"));
          if (dates.length < 3) dates.push(d);
        }
      }
      return Response.json({
        status: res.status, ms, parseMs: Date.now() - t1, zipBytes: buf.length, files: es.map((e) => e.name), rows, header: header.join("|"), districts: cityDistrict.size,
        tables: Object.fromEntries(Object.entries(maps).map(([k, v]) => [k, top(v, k === "notes" ? 80 : 40)])),
      });
    }
    if (task === "filter") {
      const { buf } = await get(q.get("url")!);
      const district = q.get("district") ?? "大安區";
      const cityLetter = (q.get("city") ?? "a").toLowerCase();
      const from = q.get("from") ?? "1141001";
      const to = q.get("to") ?? "1150930";
      const kinds = ["a"];
      const stages: Record<string, { all: number[]; allUnit: number[]; dist: number[]; distUnit: number[] }> = {};
      const st = (k: string) => (stages[k] ??= { all: [], allUnit: [], dist: [], distUnit: [] });
      const dateByFlag = new Map<string, number>();
      const stage = (k: string, total: number, unit: number, isDist: boolean) => {
        const s = st(k); s.all.push(total); if (unit > 0) s.allUnit.push(unit);
        if (isDist) { s.dist.push(total); if (unit > 0) s.distUnit.push(unit); }
      };
      const pct = (a: number[], p: number) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return Math.round(s[lo] + (s[hi] - s[lo]) * (i - lo)); };
      const sum = (a: number[]) => ({ n: a.length, p10: pct(a, 0.1), med: pct(a, 0.5), p90: pct(a, 0.9) });
      for (const e of entries(buf).filter((e) => /^[a-z]_lvr_land_a\.csv$/i.test(e.name))) {
        const rec = csv(read(buf, e).toString("utf8"));
        const h = rec[0]; const ix = (n: string) => h.indexOf(n);
        for (const r of rec.slice(2)) {
          const g = (n: string) => r[ix(n)] ?? "";
          const d = g("交易年月日");
          if (d < from || d > to) continue;
          const obj = g("交易標的");
          if (obj !== "房地(土地+建物)" && obj !== "房地(土地+建物)+車位") continue;
          const t = g("建物型態");
          if (!/^(住宅大樓|華廈|公寓|透天厝|套房)/.test(t)) continue;
          if (g("主要用途") !== "住家用") continue;
          const total = Number(g("總價元")); const unit = Number(g("單價元平方公尺"));
          const isDist = e.name[0].toLowerCase() === cityLetter && g("鄉鎮市區") === district;
          const note = g("備註");
          stage("S0 residential", total, unit, isDist);
          const rel = note.includes("特殊關係");
          const pre = note.includes("預售屋、或土地及建物分件登記案件");
          const other = /協議價購|政府機關|標讓售|急買急賣|債權債務|毛胚|瑕疵|地上權|重建或重劃|畸零地|民情風俗|拍賣|法拍|地清/.test(note);
          bump(dateByFlag, (pre ? "pre " : "nopre ") + d.slice(0, 5));
          if (!rel) stage("S1 no relatives", total, unit, isDist);
          if (!rel && !other) stage("S2 no relatives/other", total, unit, isDist);
          if (!rel && !other && !pre) stage("S3 also no presale flag", total, unit, isDist);
          if (pre && !rel && !other) stage("S4 presale-flag only", total, unit, isDist);
        }
      }
      return Response.json({ district, from, to, stages: Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, { nation_total: sum(v.all), nation_unit: sum(v.allUnit), dist_total: sum(v.dist), dist_unit: sum(v.distUnit) }])), dateByFlag: top(dateByFlag, 60) });
    }
    return Response.json({ error: "unknown task" }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e), cause: String(e?.cause?.code ?? "") }, { status: 500 });
  }
}
