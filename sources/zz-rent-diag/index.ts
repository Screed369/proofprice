// TEMPORARY diagnostic source for a throwaway preview deployment. Never merged to main.
import { defineSource, str } from "../../lib/plugin";
import { fetchJson } from "../../lib/http";
import { readXlsx } from "../../categories/rent/xlsx";
import type { PriceAnswer } from "../../lib/answer";

const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

async function getBuf(url: string): Promise<{ status: number; buf: Buffer; type: string | null }> {
  const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") };
}

function wrap(extra: Record<string, unknown>): PriceAnswer {
  return { query: {}, status: "ok", price: null, sample_size: null, period: { from: null, to: null }, confidence: "low", price_type: "diag", as_of: "", source: {} as any, method: "", method_url: "", summary: "diag", notice: "", extra } as PriceAnswer;
}

async function nsw(): Promise<Record<string, unknown>> {
  const page = await getBuf("https://www.nsw.gov.au/housing-and-construction/rental-forms-surveys-and-data/rental-bond-data");
  const html = page.buf.toString("utf8");
  const links = [...html.matchAll(/<a href="([^"]+\.xlsx)"[^>]*title="Rental bond lodgement data - ([A-Za-z]+) (\d{4})"/g)].map((m) => ({ href: m[1], month: m[2], year: m[3] }));
  const out: Record<string, unknown> = { pageStatus: page.status, pageBytes: page.buf.length, links: links.slice(0, 3), linkCount: links.length };
  if (!links.length) return out;
  const file = await getBuf("https://www.nsw.gov.au" + links[0].href);
  out.fileStatus = file.status; out.fileType = file.type; out.fileBytes = file.buf.length;
  if (file.status === 200) {
    const t0 = Date.now();
    const sheets = readXlsx(file.buf);
    out.parseMs = Date.now() - t0;
    out.sheets = sheets.map((s) => ({ name: s.name, rowCount: s.rows.length, head: s.rows.slice(0, 8), tail: s.rows.slice(-2) }));
  }
  return out;
}

async function ons(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const list = await fetchJson("https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/priceindexofprivaterentsukmonthlypricestatistics/data", {}, 20000);
  const uri = list?.datasets?.[0]?.uri as string;
  const ed = await fetchJson("https://www.ons.gov.uk" + uri + "/data", {}, 20000);
  const file = ed?.downloads?.[0]?.file as string;
  const url = "https://www.ons.gov.uk/file?uri=" + uri + "/" + file;
  const t0 = Date.now();
  const f = await getBuf(url);
  out.downloadMs = Date.now() - t0;
  out.fileBytes = f.buf.length;
  const t1 = Date.now();
  const sheets = readXlsx(f.buf);
  out.parseMs = Date.now() - t1;
  const cover = sheets.find((s) => s.name === "Cover sheet");
  out.cover = cover?.rows.map((r) => r.join(" | ").slice(0, 900));
  const notes = sheets.find((s) => s.name === "Notes");
  out.notes = notes?.rows.map((r) => r.join(" | ").slice(0, 500));
  const t = sheets.find((s) => s.name === "Table 1")!;
  const hi = t.rows.findIndex((r) => r[0] === "Time period");
  out.header = t.rows[hi];
  const data = t.rows.slice(hi + 1);
  out.dataRows = data.length;
  const dates = new Set(data.map((r) => r[0]));
  out.maxDate = Math.max(...[...dates].filter((d): d is number => typeof d === "number"));
  const latest = out.maxDate as number;
  const latestRows = data.filter((r) => r[0] === latest);
  out.latestRowCount = latestRows.length;
  out.areaCodePrefixes = Object.fromEntries([...new Set(latestRows.map((r) => String(r[1]).slice(0, 3)))].map((p) => [p, latestRows.filter((r) => String(r[1]).startsWith(p)).length]));
  out.regions = [...new Set(latestRows.map((r) => r[3]))];
  out.manchester = data.filter((r) => String(r[2]).startsWith("Manchester") && (r[0] === latest || r[0] === latest - 31)).map((r) => r.slice(0, 20));
  out.sample = latestRows.slice(0, 6).map((r) => r.slice(0, 20));
  out.londonLikes = latestRows.filter((r) => /London|Westminster|Camden|Leeds|Bristol/.test(String(r[2]))).slice(0, 8).map((r) => r.slice(0, 20));
  out.nonNumericRentCount = latestRows.filter((r) => typeof r[7] !== "number").length;
  return out;
}

async function census(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [k, url] of Object.entries({
    austin: "https://api.census.gov/data/2024/acs/acs5?get=NAME,B25064_001E,B25064_001M&for=place:05000&in=state:48",
    states: "https://api.census.gov/data/2024/acs/acs5?get=NAME,B25064_001E&for=state:*",
    v2025: "https://api.census.gov/data/2025/acs/acs5?get=NAME,B25064_001E&for=state:48",
  })) {
    const r = await getBuf(url);
    out[k] = { status: r.status, type: r.type, bytes: r.buf.length, head: r.buf.toString("utf8").slice(0, 300) };
  }
  return out;
}

export default defineSource({
  info: {
    id: "zz-rent-diag", country: "ZZ", category: "rent", name: "diag", publisher: "diag", what_is_recorded: "diag", price_type: "transaction",
    freshness: "diag", licence: "diag", licence_url: "https://example.com/", attribution: "diag", homepage: "https://example.com/", limits: "diag",
  },
  category: "rent",
  countries: ["ZZ"],
  countryHelp: "ZZ = diagnostics",
  placeName: "diagnostics",
  status: "beta",
  examples: [{ params: { country: "ZZ", town: "nsw" } }],
  handle: async (p) => {
    const what = str(p.town);
    try {
      if (what === "nsw") return wrap(await nsw());
      if (what === "ons") return wrap(await ons());
      if (what === "census") return wrap(await census());
      return wrap({ usage: "town=nsw|ons|census" });
    } catch (e: any) {
      return wrap({ error: String(e?.message ?? e), detail: e?.detail ?? null, stack: String(e?.stack ?? "").slice(0, 600) });
    }
  },
});
