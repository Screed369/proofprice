// TEMPORARY diagnostic (never merged): can MIMIT be reached from Vercel region cdg1?
export const preferredRegion = "cdg1";
export const maxDuration = 30;
export const dynamic = "force-dynamic";
export async function GET() {
  const out: Record<string, unknown> = { region: "cdg1", vercel: process.env.VERCEL_REGION };
  for (const [k, u] of Object.entries({
    prices: "https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv",
    stations: "https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv",
  })) {
    const t = Date.now();
    try {
      const c = new AbortController();
      const timer = setTimeout(() => c.abort(), 9000);
      const r = await fetch(u, { signal: c.signal, headers: { "user-agent": "pricepaid-plug/0.1", range: "bytes=0-400" } });
      const txt = await r.text();
      clearTimeout(timer);
      out[k] = { status: r.status, ms: Date.now() - t, head: txt.slice(0, 200) };
    } catch (e) {
      out[k] = { error: String(e), cause: String((e as { cause?: unknown }).cause), ms: Date.now() - t };
    }
  }
  return Response.json(out);
}
