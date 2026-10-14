// TEMPORARY diagnostic for the Taiwan sources. Lives only on branch diag/tw-run. Never merge.
import { fetchReleases, selectReleases, download, cityFiles, listZip, readZipEntry, parseTable, decodeCsv, windowStart } from "../../../sources/tw-home-sales/moi";
import { twHomeSalesHarvest, twHomeSales, parseSales, newStats, snapshotFromRows } from "../../../sources/tw-home-sales/source";
import { twRentsHarvest, twRents, parseRentals } from "../../../sources/tw-rents/source";
import { rowsToCsv } from "../../../lib/library/store";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const top = (m: Map<string, number>, k = 50) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const task = q.get("task") ?? "";
  const t0 = Date.now();
  try {
    if (task === "releases") {
      const all = await fetchReleases();
      const today = new Date().toISOString().slice(0, 10);
      const from = windowStart(today, 26);
      return Response.json({
        ms: Date.now() - t0,
        from,
        all: all.slice(0, 12),
        sales: selectReleases(all, "sales", from).map((r) => r.id),
        rents: selectReleases(all, "rents", from).map((r) => r.id),
      });
    }
    if (task === "sales" || task === "rents") {
      const kind = task === "sales" ? "a" : "c";
      const all = await fetchReleases();
      const today = new Date().toISOString().slice(0, 10);
      let chosen = selectReleases(all, task, windowStart(today, 26));
      const limit = Number(q.get("limit") ?? 0);
      if (limit) chosen = chosen.slice(0, limit);
      const seen = new Set<string>();
      const stats = newStats();
      const phrases = new Map<string, number>();
      const kinds = new Map<string, number>();
      const services = new Map<string, number>();
      let kept = 0;
      let memMax = 0;
      const perRelease: unknown[] = [];
      for (const rel of chosen) {
        const tr = Date.now();
        const buf = await download(rel.url);
        const files = cityFiles(listZip(buf), kind);
        let n = 0;
        for (const f of files) {
          const table = parseTable(decodeCsv(readZipEntry(buf, f.entry)));
          const iNote = table.col("備註");
          const iUse = table.col("主要用途");
          const iObj = table.col("交易標的");
          const iKind = table.col("出租型態");
          const iSvc = table.col("租賃住宅服務");
          for (const r of table.rows) {
            if ((r[iUse] ?? "").trim() === "住家用" && (r[iObj] ?? "").includes(kind === "a" ? "房地" : "租賃房屋")) {
              for (const p of (r[iNote] ?? "").split(/[；;]/).map((s) => s.trim()).filter(Boolean)) bump(phrases, p.replace(/\d+/g, "N").slice(0, 60));
              if (iKind >= 0) bump(kinds, r[iKind] ?? "");
              if (iSvc >= 0) bump(services, r[iSvc] ?? "");
            }
          }
          const before = stats.kept;
          const got = task === "sales" ? parseSales(table, f.code, { seen, stats, today }) : parseRentals(table, f.code, { seen, stats, today });
          kept += got.length;
          n += stats.kept - before;
        }
        memMax = Math.max(memMax, process.memoryUsage().rss);
        perRelease.push({ id: rel.id, bytes: buf.length, files: files.length, kept: n, ms: Date.now() - tr, salesTo: rel.salesTo, rentTo: rel.rentTo });
      }
      return Response.json({ task, ms: Date.now() - t0, releases: perRelease, kept, stats, rssMB: Math.round(memMax / 1e6), kinds: top(kinds), services: top(services), phrases: top(phrases, 70) });
    }
    if (task === "uses") {
      const all = await fetchReleases();
      const rel = selectReleases(all, "sales", "2026-01-01").find((r) => r.id === (q.get("id") ?? "115S3"))!;
      const buf = await download(rel.url);
      const out: Record<string, unknown> = {};
      for (const kind of ["a", "c"] as const) {
        const uses = new Map<string, number>();
        const types = new Map<string, number>();
        const objs = new Map<string, number>();
        const useByType = new Map<string, number>();
        const svcByUse = new Map<string, number>();
        for (const f of cityFiles(listZip(buf), kind)) {
          const table = parseTable(decodeCsv(readZipEntry(buf, f.entry)));
          const iU = table.col("主要用途"), iT = table.col("建物型態"), iO = table.col("交易標的"), iS = table.col("租賃住宅服務"), iN = table.col("備註");
          for (const r of table.rows) {
            const pre = kind === "a" && (r[iN] ?? "").includes("預售屋");
            bump(uses, (pre ? "[presale] " : "") + (r[iU] ?? "").slice(0, 20));
            bump(types, (r[iT] ?? "").slice(0, 14));
            bump(objs, (r[iO] ?? "").slice(0, 20));
            bump(useByType, `${(r[iU] ?? "").slice(0, 10)} | ${(r[iT] ?? "").slice(0, 6)}`);
            if (iS >= 0) bump(svcByUse, `${(r[iU] ?? "").slice(0, 10)} | ${(r[iS] ?? "").slice(0, 10)}`);
          }
        }
        out[kind] = { uses: top(uses, 25), types: top(types, 20), objs: top(objs, 12), useByType: top(useByType, 30), svcByUse: top(svcByUse, 20) };
      }
      return Response.json({ id: rel.id, ...out });
    }
    if (task === "harvest-sales" || task === "harvest-rents") {
      const deps = { fetchReleases, download, stored: () => null, now: () => new Date() };
      const res = task === "harvest-sales" ? await twHomeSalesHarvest(deps) : await twRentsHarvest(deps);
      const csv = rowsToCsv(res.rows.map((r) => ({ ...r, date: res.date })));
      const snap = snapshotFromRows(res.date, res.rows);
      const asks = (q.get("asks") ?? "Taipei|Da'an, Taipei|New Taipei|Taichung|Kaohsiung|Tainan|Taoyuan|Hsinchu City||Taiwan").split("|");
      const answers: unknown[] = [];
      for (const town of asks) {
        try {
          const a = task === "harvest-sales" ? await twHomeSales({ town }, { snapshot: snap }) : await twRents({ town }, { snapshot: snap });
          answers.push({ town, status: a.status, n: a.sample_size, price: a.price, period: a.period, summary: a.summary, m2: (a.extra as any)?.price_per_m2 ?? (a.extra as any)?.rent_per_m2_per_month });
        } catch (e: any) {
          answers.push({ town, error: String(e?.message ?? e) });
        }
      }
      const items = new Map<string, number>();
      for (const r of res.rows) bump(items, r.item.split(":").slice(0, task === "harvest-sales" ? 1 : 2).join(":"));
      const levels = { district: res.rows.filter((r) => r.area.includes("|")).length, city: res.rows.filter((r) => !r.area.includes("|") && r.area !== "ALL").length, national: res.rows.filter((r) => r.area === "ALL").length };
      return Response.json({ task, ms: Date.now() - t0, date: res.date, rows: res.rows.length, csvBytes: csv.length, levels, items: top(items, 40), note: res.note, answers, rssMB: Math.round(process.memoryUsage().rss / 1e6) });
    }
    return Response.json({ error: "unknown task" }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e), stack: String(e?.stack ?? "").slice(0, 800), ms: Date.now() - t0 }, { status: 500 });
  }
}
