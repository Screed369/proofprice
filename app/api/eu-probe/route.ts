// TEMPORARY preview-only experiment (Repairer 1 Nov 2026): can a Frankfurt (fra1) function reach MIMIT?
// Fixed URLs only, no user input. Never merged to main.
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TARGETS: Record<string, string> = {
  mimit: "https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv",
  ine: "https://www.ine.pt/ine/json_indicador/pindica.jsp?op=2&varcd=0012311&Dim1=T&lang=EN",
};

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("t") ?? "mimit";
  const url = TARGETS[key];
  if (!url) return Response.json({ error: "unknown" }, { status: 400 });
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "ProofPrice/0.3 (+https://proofprice.com; hello@proofprice.com)", Range: "bytes=0-399" },
      signal: AbortSignal.timeout(40000),
    });
    const body = (await r.text()).slice(0, 300);
    return Response.json({ key, status: r.status, ms: Date.now() - t0, region: process.env.VERCEL_REGION, head: body });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    return Response.json({ key, error: err.message, code: err.cause?.code, ms: Date.now() - t0, region: process.env.VERCEL_REGION });
  }
}
