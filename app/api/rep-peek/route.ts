// THROWAWAY probe (Repairer 3 Nov): never merge. Reads an xlsx from METI and dumps sheet names + first rows.
import zlib from 'node:zlib';
export const runtime = 'nodejs';
export const preferredRegion = 'hnd1';
export const maxDuration = 30;

function unzip(buf: Buffer): Record<string, Buffer> {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Record<string, Buffer> = {};
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(lho + 26), lelen = buf.readUInt16LE(lho + 28);
    const data = buf.subarray(lho + 30 + lnlen + lelen, lho + 30 + lnlen + lelen + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    p += 46 + nlen + elen + clen;
  }
  return out;
}

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams.get('u') ?? '';
  if (!/^https:\/\/www\.enecho\.meti\.go\.jp\/statistics\/petroleum_and_lpgas\/pl007\//.test(u)) return Response.json({ error: 'bad url' }, { status: 400 });
  try {
    const r = await fetch(u, { headers: { 'user-agent': 'ProofPrice-verifier/1.0 (+https://proofprice.com; hello@proofprice.com)' }, signal: AbortSignal.timeout(20000) });
    const ct = r.headers.get('content-type');
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok || !/\.xlsx$/i.test(u)) return Response.json({ status: r.status, ct, len: buf.length, head: buf.toString('utf8', 0, 3000) });
    const z = unzip(buf);
    const names = Object.keys(z);
    const wb = z['xl/workbook.xml']?.toString('utf8') ?? '';
    const ss = (z['xl/sharedStrings.xml']?.toString('utf8') ?? '').match(/<t[^>]*>[^<]*<\/t>/g)?.slice(0, 80).map((s) => s.replace(/<[^>]+>/g, '')) ?? [];
    const sheets = names.filter((n) => n.startsWith('xl/worksheets/sheet')).map((n) => ({ n, head: z[n].toString('utf8', 0, 3500) }));
    return Response.json({ status: r.status, ct, len: buf.length, names, workbook: wb.slice(0, 1500), sharedStrings: ss, sheets: sheets.slice(0, 2) });
  } catch (e) {
    return Response.json({ error: String(e), cause: String((e as any)?.cause) }, { status: 502 });
  }
}
