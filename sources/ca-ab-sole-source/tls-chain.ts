// The Alberta server sends only its own certificate and leaves out the intermediate one, so Node says UNABLE_TO_VERIFY_LEAF_SIGNATURE
// (browsers repair this by following the certificate's "CA Issuers" link). We do the same, safely: certificate checking stays ON,
// and a downloaded intermediate is trusted only if it is signed by a root already in Node's built-in list.
import https from "node:https";
import tls from "node:tls";
import { X509Certificate } from "node:crypto";

/** Pure: the "CA Issuers" URL out of Node's infoAccess text, e.g. "CA Issuers - URI:http://x/ca.crt\nOCSP - URI:...". */
export function caIssuersUrl(infoAccess: string | undefined): string | null {
  const m = /CA Issuers - URI:(https?:\/\/\S+)/i.exec(infoAccess ?? "");
  return m ? m[1] : null;
}

/** Pure: DER or PEM bytes to a PEM string (certificates are often published as DER). */
export function toPem(buf: Buffer): string {
  const text = buf.toString("latin1");
  if (text.includes("-----BEGIN CERTIFICATE-----")) return text;
  const b64 = buf.toString("base64").match(/.{1,64}/g)!.join("\n");
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
}

/** Pure: is this certificate signed by one of the given trusted roots? */
export function signedByAny(cert: X509Certificate, roots: X509Certificate[]): boolean {
  return roots.some((r) => { try { return cert.checkIssued(r) && cert.verify(r.publicKey); } catch { return false; } });
}

function getBytes(url: string, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : require("node:http");
    const req = mod.get(url, { timeout: timeoutMs }, (res: any) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

/** Reads the server's certificate WITHOUT sending any request (no data is trusted from it except the issuer link). */
function peerCert(host: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 20000 }, () => {
      const c = s.getPeerCertificate(false);
      s.end();
      resolve(c);
    });
    s.on("timeout", () => s.destroy(new Error("timeout")));
    s.on("error", reject);
  });
}

/** Finds the missing intermediate certificate(s) for a host and returns them as PEM, each one proven to chain to a built-in root. Up to 3 levels. */
export async function missingIntermediates(host: string): Promise<string[]> {
  const roots = tls.rootCertificates.map((p) => new X509Certificate(p));
  const found: X509Certificate[] = [];
  let leaf = await peerCert(host);
  let url = caIssuersUrl(leaf.infoAccess);
  const chain: string[] = [];
  const pending: X509Certificate[] = [];
  for (let depth = 0; depth < 3 && url; depth++) {
    const cert = new X509Certificate(toPem(await getBytes(url, 20000)));
    pending.push(cert);
    if (signedByAny(cert, roots) || signedByAny(cert, found)) {
      // proven to chain to a built-in root: keep this one and everything fetched below it
      for (const p of pending) { found.push(p); chain.push(p.toString()); }
      return chain;
    }
    url = caIssuersUrl((cert as any).infoAccess);
  }
  return [];
}

/** GET with normal certificate checking; if the only problem is the missing intermediate, add the proven intermediate and retry once. */
export async function getTextRepairingChain(url: string, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number; text: string }> {
  const once = (ca?: string[]) =>
    new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = https.get(url, { headers, timeout: timeoutMs, ...(ca ? { ca: [...tls.rootCertificates, ...ca] } : {}) }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
      req.on("error", reject);
    });
  try {
    return await once();
  } catch (err: any) {
    const code = String(err?.code ?? "");
    if (code !== "UNABLE_TO_VERIFY_LEAF_SIGNATURE" && code !== "UNABLE_TO_GET_ISSUER_CERT_LOCALLY") throw err;
    const extra = await missingIntermediates(new URL(url).hostname);
    if (!extra.length) throw err;
    return once(extra);
  }
}
