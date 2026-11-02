export const maxDuration = 30;
export const dynamic = "force-dynamic";
export async function GET() {
  const t0 = Date.now();
  let result: Record<string, unknown> = { region: process.env.VERCEL_REGION };
  try {
    const r = await fetch("https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv", {
      headers: { "user-agent": "ProofPrice/0.3 (+https://proofprice.com; hello@proofprice.com)" },
      signal: AbortSignal.timeout(20000),
    });
    const txt = await r.text();
    result = { ...result, status: r.status, bytes: txt.length, head: txt.slice(0, 120) };
  } catch (e) {
    const err = e as { message?: string; cause?: { code?: string } };
    result = { ...result, error: err.message, code: err.cause?.code };
  }
  return Response.json({ ...result, ms: Date.now() - t0 });
}
