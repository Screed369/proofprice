// Statistics kit: one spelling for every publisher's time codes.
// PxWeb writes months as 2026M09 (and quarters as 2026K3 in Nordic tables, 2026Q3 elsewhere), PxStat 202609, CBS OData 2026MM09
// and 20261012 for days, SDMX and Eurostat 2026-09 / 2026-Q3. The kit stores and compares periods as:
//   "2026" (year), "2026-S1" (half), "2026-Q3" (quarter), "2026-09" (month), "2026-10-12" (day).
// Pure functions, tested in tests/kits.test.ts.

/** Publisher time code -> kit period, or null when the code is not a period we understand (never guessed). */
export function normalisePeriod(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toUpperCase();
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})$/.exec(s))) return m[1];
  if ((m = /^(\d{4})JJ00$/.exec(s))) return m[1]; // CBS year
  if ((m = /^(\d{4})-?(?:M|MM)?(0[1-9]|1[0-2])$/.exec(s))) return `${m[1]}-${m[2]}`; // 2026-09, 202609, 2026M09, 2026MM09
  if ((m = /^(\d{4})M([1-9])$/.exec(s))) return `${m[1]}-0${m[2]}`; // 2026M9 (some PxWeb tables)
  if ((m = /^(\d{4})-?(?:Q|K|KW)0?([1-4])$/.exec(s))) return `${m[1]}-Q${m[2]}`; // 2026Q3, 2026K3, 2026-Q3, 2026KW03 (CBS)
  if ((m = /^(\d{4})-?(?:S|H|HJ)0?([12])$/.exec(s))) return `${m[1]}-S${m[2]}`; // 2026S1, 2026-S1, 2026H1, 2026HJ01
  if ((m = /^(\d{4})-?(0[1-9]|1[0-2])-?(0[1-9]|[12]\d|3[01])(?:T.*)?$/.exec(s))) return `${m[1]}-${m[2]}-${m[3]}`; // 20261012, 2026-10-12, 2026-10-12T00:00
  return null;
}

const d2 = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** First and last day of a kit period. */
export function periodBounds(p: string): { from: string; to: string } | null {
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})$/.exec(p))) return { from: `${m[1]}-01-01`, to: `${m[1]}-12-31` };
  if ((m = /^(\d{4})-S([12])$/.exec(p))) return m[2] === "1" ? { from: `${m[1]}-01-01`, to: `${m[1]}-06-30` } : { from: `${m[1]}-07-01`, to: `${m[1]}-12-31` };
  if ((m = /^(\d{4})-Q([1-4])$/.exec(p))) {
    const end = Number(m[2]) * 3;
    return { from: `${m[1]}-${d2(end - 2)}-01`, to: `${m[1]}-${d2(end)}-${d2(lastDay(Number(m[1]), end))}` };
  }
  if ((m = /^(\d{4})-(\d{2})$/.exec(p))) return { from: `${p}-01`, to: `${p}-${d2(lastDay(Number(m[1]), Number(m[2])))}` };
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return { from: p, to: p };
  return null;
}

/** The same period one year earlier ("2026-09" -> "2025-09", "2026-Q3" -> "2025-Q3", "2026-10-12" -> "2025-10-12"). */
export function yearEarlier(p: string): string | null {
  const m = /^(\d{4})(.*)$/.exec(p);
  return m && periodBounds(p) ? `${Number(m[1]) - 1}${m[2]}` : null;
}

/** The period just before ("2026-01" -> "2025-12", "2026-Q1" -> "2025-Q4", "2026" -> "2025"). Days are not stepped (null). */
export function previousOf(p: string): string | null {
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})$/.exec(p))) return String(Number(m[1]) - 1);
  if ((m = /^(\d{4})-S([12])$/.exec(p))) return m[2] === "2" ? `${m[1]}-S1` : `${Number(m[1]) - 1}-S2`;
  if ((m = /^(\d{4})-Q([1-4])$/.exec(p))) return m[2] !== "1" ? `${m[1]}-Q${Number(m[2]) - 1}` : `${Number(m[1]) - 1}-Q4`;
  if ((m = /^(\d{4})-(\d{2})$/.exec(p))) return m[2] !== "01" ? `${m[1]}-${d2(Number(m[2]) - 1)}` : `${Number(m[1]) - 1}-12`;
  return null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-09" -> "September 2026", "2026-Q3" -> "Q3 2026", "2026-S1" -> "first half of 2026", "2026-10-12" -> "12 October 2026". */
export function periodWords(p: string): string {
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p))) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  if ((m = /^(\d{4})-(\d{2})$/.exec(p))) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  if ((m = /^(\d{4})-Q([1-4])$/.exec(p))) return `Q${m[2]} ${m[1]}`;
  if ((m = /^(\d{4})-S([12])$/.exec(p))) return `${m[2] === "1" ? "first" : "second"} half of ${m[1]}`;
  return p;
}

/** Whole months between the end of a period and today (0 when the period has not ended). */
export function monthsSince(p: string, today: Date): number {
  const b = periodBounds(p);
  if (!b) return 0;
  const [y, mo] = b.to.split("-").map(Number);
  return Math.max(0, today.getUTCFullYear() * 12 + today.getUTCMonth() - (y * 12 + (mo - 1)));
}
