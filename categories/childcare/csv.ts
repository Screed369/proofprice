// Small helpers shared by the childcare sources that read CSV files: a quote-aware CSV parser and a text download with a hard timeout.
import { SourceError } from "../../lib/http";

/** Parse CSV text (RFC 4180 style: quoted fields, doubled quotes, CRLF or LF, optional BOM) into rows of strings. Blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

/** A CSV as objects keyed by the header names (trimmed). */
export function csvObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

/** GET a URL as text with a hard timeout. Throws SourceError (HTTP status kept, so outages are recognised). */
export async function fetchText(url: string, init: RequestInit = {}, timeoutMs = 20000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)", ...(init.headers || {}) },
    });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, (await res.text().catch(() => "")).slice(0, 300), res.status);
    return await res.text();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

/** A number from a published cell: "1,764" -> 1764, "6.86" -> 6.86, "[u] 18" -> 18 (the marker is read separately), "x" / "[u]" / "*" -> null. */
export function cellNumber(s: string | undefined): number | null {
  if (s === undefined) return null;
  const m = /^(?:\[u\]\s*)?(-?\d[\d,]*(?:\.\d+)?)(?:\s*\[u\])?$/.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** True when the publisher flags a cell as low reliability ("[u]"). */
export const isUnreliable = (s: string | undefined): boolean => /\[u\]/i.test(s ?? "");
