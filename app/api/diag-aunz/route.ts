// THROWAWAY diagnostics for the au-nz builder (branch diag/au-nz). Never merged.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ALLOWED = ["www.tenancy.govt.nz", "www.mbie.govt.nz", "data.api.abs.gov.au", "services2.arcgis.com", "services.arcgis.com"];

export async function GET(req: Request) {
  const u = new URL(req.url);
  const target = u.searchParams.get("url") ?? "";
  let t: URL;
  try {
    t = new URL(target);
  } catch {
    return new Response("bad url", { status: 400 });
  }
  if (!ALLOWED.includes(t.hostname)) return new Response("host not allowed", { status: 403 });
  const mode = u.searchParams.get("mode") ?? "head";
  const n = Math.min(Number(u.searchParams.get("n") ?? 20000), 140000);
  const headers: Record<string, string> = { "user-agent": "ProofPrice-diag/1.0 (+https://proofprice.com; hello@proofprice.com)" };
  if (mode === "tail") headers.range = `bytes=-${n}`;
  const res = await fetch(t, { headers, signal: AbortSignal.timeout(50000) });
  const meta = `status ${res.status} type ${res.headers.get("content-type")} length ${res.headers.get("content-length")} range ${res.headers.get("content-range")}\n`;
  const text = await res.text();
  if (mode === "tail") return new Response(meta + `full body chars ${text.length}\n` + text.slice(-n), { headers: { "content-type": "text/plain; charset=utf-8" } });
  if (mode === "distinct") {
    // distinct values of the given 0-based CSV columns (simple split; fields here do not contain commas except quoted numbers)
    const cols = (u.searchParams.get("cols") ?? "0").split(",").map(Number);
    const rows = text.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
    const out: string[] = [meta, `rows ${rows.length}`, `header ${rows[0]}`];
    for (const c of cols) {
      const m = new Map<string, number>();
      for (const r of rows.slice(1)) {
        const v = r.split(",")[c] ?? "";
        m.set(v, (m.get(v) ?? 0) + 1);
      }
      out.push(`col ${c}: ${[...m.entries()].slice(0, 200).map(([k, v]) => `${k}=${v}`).join(" | ")}`);
    }
    return new Response(out.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (mode === "grep") {
    const pat = new RegExp(u.searchParams.get("re") ?? "^$");
    const lines = text.split(/\r?\n/).filter((l) => pat.test(l));
    return new Response(meta + lines.slice(0, n).join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(meta + text.slice(0, n), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
