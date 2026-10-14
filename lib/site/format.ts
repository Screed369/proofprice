// Small, locale-independent formatting helpers for the website (same output on every server and in tests).

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-10-14" -> "14 October 2026". Returns the input unchanged if it is not an ISO date. */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}

/** "2026-10-14" -> "14 Oct 2026". */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month.slice(0, 3)} ${m[1]}` : iso;
}

/** "2026-10-14T08:44:07.430Z" -> "14 Oct 2026, 08:44 UTC". */
export function dateTimeUtc(iso: string | null | undefined): string {
  if (!iso) return "never";
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${shortDate(m[1])}, ${m[2]} UTC` : iso;
}

/** Whole days from one ISO date (or timestamp) to another; null if either is missing or invalid. */
export function daysBetween(fromIso: string | null | undefined, toIso: string | null | undefined): number | null {
  if (!fromIso || !toIso) return null;
  const a = Date.parse(fromIso.length === 10 ? `${fromIso}T00:00:00Z` : fromIso);
  const b = Date.parse(toIso.length === 10 ? `${toIso}T00:00:00Z` : toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** Same rule the Irish source uses: the date `months` before `last` (YYYY-MM-DD). */
export function monthsBefore(last: string, months: number): string {
  const e = new Date(last + "T00:00:00Z");
  e.setUTCMonth(e.getUTCMonth() - months);
  return e.toISOString().slice(0, 10);
}

/** "1 source", "2 sources". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Integer with thousands separators, the same everywhere: 43207 -> "43,207". */
export function int(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A price with a fixed number of decimals, e.g. fuel at 3 decimals: 1.92 -> "€1.920". */
export function moneyFixed(v: number, currency: string, digits: number): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  } catch {
    return `${v.toFixed(digits)} ${currency}`;
  }
}
