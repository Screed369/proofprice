// TEMPORARY EXPLORER (never merged): reads ONS files from Vercel so their real format can be inspected.
import { defineSource } from "../../lib/plugin";
import { buildStatisticAnswer } from "../../lib/answer";
import { readWorkbook } from "./xlsx";

const INFO: any = {
  id: "gb-ons-price-quotes", country: "GB", category: "groceries", name: "explorer", publisher: "ONS", what_is_recorded: "x", price_type: "official_statistic",
  freshness: "x", licence: "OGL v3.0", licence_url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/", attribution: "x",
  homepage: "https://www.ons.gov.uk/", limits: "x",
};
const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

async function explore(item: string, arg: string) {
  if (item === "xlsx") {
    const url = arg || "https://www.ons.gov.uk/file?uri=/economy/inflationandpriceindices/adhocs/3607consumerpricespriceleveldistributionsmicrodataaugust2026/consumerpricespriceleveldistributionsmicrodata202608.xlsx";
    const res = await fetch(url, { headers: UA });
    const buf = Buffer.from(await res.arrayBuffer());
    const sheets = readWorkbook(buf);
    return { status: res.status, bytes: buf.length, sheets: sheets.map((s) => ({ name: s.name, rows: s.rows.length, head: s.rows.slice(0, 25).map((r) => r.slice(0, 40)) })) };
  }
  if (item === "sheet") {
    // arg = "<n>:<from>:<count>:<url?>"
    const [n, from, count, url] = arg.split("|");
    const u = url || "https://www.ons.gov.uk/file?uri=/economy/inflationandpriceindices/adhocs/3607consumerpricespriceleveldistributionsmicrodataaugust2026/consumerpricespriceleveldistributionsmicrodata202608.xlsx";
    const res = await fetch(u, { headers: UA });
    const buf = Buffer.from(await res.arrayBuffer());
    const sheets = readWorkbook(buf);
    const s = sheets[Number(n)];
    return { name: s.name, rows: s.rows.length, slice: s.rows.slice(Number(from), Number(from) + Number(count)).map((r) => r.slice(0, 40)) };
  }
  if (item === "quotes") {
    // arg = "<regex>|<url>"
    const [re, url] = arg.split("|");
    const res = await fetch(url, { headers: UA });
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    const counts = new Map<string, number>();
    const rx = new RegExp(re || ".", "i");
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(",");
      if (c.length < 14) continue;
      const k = `${c[1]}|${c[2]}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const all = [...counts.entries()];
    return { status: res.status, bytes: text.length, lines: lines.length, distinctCs: all.length, header: lines[0], matches: all.filter(([k]) => rx.test(k)).slice(0, 120), first: all.slice(0, 40) };
  }
  if (item === "find") {
    // arg = "<regex>|<sheet index list, comma>|<maxPerSheet>"
    const [re, sheetList, maxStr] = arg.split("~");
    const u = "https://www.ons.gov.uk/file?uri=/economy/inflationandpriceindices/adhocs/3607consumerpricespriceleveldistributionsmicrodataaugust2026/consumerpricespriceleveldistributionsmicrodata202608.xlsx";
    const res = await fetch(u, { headers: UA });
    const buf = Buffer.from(await res.arrayBuffer());
    const sheets = readWorkbook(buf);
    const rx = new RegExp(re, "i");
    const wanted = (sheetList || "2,3,4,5,6").split(",").map(Number);
    const max = Number(maxStr || 12);
    const out: any[] = [];
    for (const i of wanted) {
      const s = sheets[i];
      if (!s) continue;
      const hits: any[] = [];
      s.rows.forEach((r, ri) => {
        if (hits.length < max && r.some((c) => typeof c === "string" && rx.test(c))) hits.push({ row: ri, cells: r.slice(0, 18) });
      });
      out.push({ sheet: i, name: s.name, rows: s.rows.length, header: s.rows.slice(0, 5).map((r) => r.slice(0, 18)), hits });
    }
    return { sheets: out };
  }
  if (item === "links") {
    // arg = "<url>|<regex>"
    const [url, re] = arg.split("~");
    const res = await fetch(url, { headers: UA });
    const html = await res.text();
    const rx = new RegExp(re || "adhocs", "i");
    const found = new Set<string>();
    for (const m of html.matchAll(/href="([^"]+)"/g)) if (rx.test(m[1])) found.add(m[1]);
    return { status: res.status, bytes: html.length, links: [...found].slice(0, 60) };
  }
  if (item === "bls") {
    // arg = "<series id regex>~<last n lines per series>"
    const [re, nStr] = arg.split("~");
    const res = await fetch("https://download.bls.gov/pub/time.series/ap/ap.data.0.Current", { headers: { "user-agent": "ProofPrice/1.0 (hello@proofprice.com)" } });
    const text = await res.text();
    const rx = new RegExp(re);
    const keep = Number(nStr || 4);
    const bySeries = new Map<string, string[]>();
    let lineCount = 0;
    let head = "";
    for (const line of text.split(/\r?\n/)) {
      lineCount++;
      if (lineCount === 1) head = line;
      const id = line.split("\t")[0]?.trim() ?? "";
      if (!rx.test(id)) continue;
      const a = bySeries.get(id) ?? [];
      a.push(line);
      if (a.length > keep) a.shift();
      bySeries.set(id, a);
    }
    return { status: res.status, bytes: text.length, lineCount, head, series: [...bySeries.entries()].slice(0, 40) };
  }
  return { hint: "item must be xlsx | sheet | quotes" };
}

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["GB"],
  countryHelp: "GB = explorer",
  placeName: "the United Kingdom",
  status: "beta",
  examples: [{ params: { country: "GB", item: "eggs" } }],
  handle: async (p) => {
    const out = await explore(String(p.item), String(p.region ?? ""));
    return buildStatisticAnswer({ source: INFO, query: { country: "GB" }, value: 1, measure: "average", currency: "GBP", unit: "x", period: { from: null, to: null }, reference_period: "x", method: "x", describe: () => "explorer", extra: { out } });
  },
});
