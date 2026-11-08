export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const out: Record<string, unknown> = { region: process.env.VERCEL_REGION ?? null };
  for (const [k, url] of Object.entries({
    prices: "https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv",
  })) {
    const t0 = Date.now();
    try {
      const c = new AbortController();
      const timer = setTimeout(() => c.abort(), 20000);
      const res = await fetch(url, { signal: c.signal, headers: { "user-agent": "pricepaid-plug/0.1", range: "bytes=0-600" } });
      const txt = await res.text();
      clearTimeout(timer);
      out[k] = { status: res.status, ms: Date.now() - t0, head: txt.slice(0, 300) };
    } catch (e: any) {
      out[k] = { error: String(e?.message), cause: String(e?.cause?.code ?? e?.cause ?? ""), ms: Date.now() - t0 };
    }
  }
  return Response.json(out);
}
