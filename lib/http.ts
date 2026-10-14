// Fetch with a hard timeout so a slow government API never hangs an agent.

export async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 20000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)", ...(init.headers || {}) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new SourceError(`Source returned HTTP ${res.status}`, body.slice(0, 300), res.status);
    }
    return await res.json();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export class SourceError extends Error {
  detail?: string;
  /** HTTP status the official source answered with, when the failure was an HTTP error. */
  status?: number;
  constructor(message: string, detail?: string, status?: number) {
    super(message);
    this.detail = detail;
    this.status = status;
  }
}

/** Bad or missing input from the caller (HTTP 400), as opposed to an unreachable source (HTTP 502). */
export class InputError extends SourceError {}

// Wording of the messages that mean "the caller's input is wrong" even when a source threw a plain SourceError.
// Shared with errorResponse (lib/route-helpers.ts): these are 400s, never an outage.
export const INPUT_MESSAGE = /required|must be|Give a|Not yet/;

const OUTAGE_MESSAGE =
  /timed? ?out|timeout|HTTP (?:5\d\d|408|425|429)\b|could not reach|unreachable|not respond|limiting requests|temporarily|try again|fetch failed/i;
const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN", "EPIPE", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT"]);

/** True when a live official source timed out, could not be reached or answered with a server error (5xx, 408, 429),
 *  as opposed to the caller asking something wrong or the source changing its format. Only these are worth answering from
 *  our own copy of the data. */
export function isSourceOutage(err: unknown): boolean {
  const e = err as any;
  if (!e || e instanceof InputError) return false;
  if (e instanceof SourceError) {
    if (INPUT_MESSAGE.test(e.message)) return false;
    if (typeof e.status === "number") return e.status >= 500 || e.status === 408 || e.status === 425 || e.status === 429;
    return OUTAGE_MESSAGE.test(e.message);
  }
  // A raw network failure that escaped a source's own fetch code.
  if (e.name === "AbortError" || e.name === "TimeoutError") return true;
  if (NETWORK_CODES.has(String(e.cause?.code ?? e.code ?? ""))) return true;
  return e instanceof TypeError && /fetch failed/i.test(e.message);
}
