// The daily collector. Runs on GitHub Actions (.github/workflows/harvest.yml), never in the app.
// For every source with a harvest() function: fetch the official bulk data once, turn it into aggregate rows,
// and add them to the price library (library/<source>/). One failing source never stops the others.
// Before a day is written, the data checker (lib/library/check.ts) compares each key with its previous value: a median above 3x or
// below a third, or a change of currency or unit, is not published (the previous value stays) and is recorded in meta.json last_error.
// Usage: npm run harvest                          (all sources)
//        npm run harvest -- es-fuel               (one source)
//        npm run harvest -- --accept-changes es-fuel   (accept a real jump or unit change once: skips the data checker)

import { SOURCE_PLUGINS } from "../lib/registry";
import { dataCheck, previousByKey } from "../lib/library/check";
import { libraryDates, readMeta, writeDaily, writeMeta, SourceMeta } from "../lib/library/store";
import { passesGate } from "../lib/stats";

const TIMEOUT_MS = 10 * 60 * 1000;
// A source that already failed on its previous harvest (a known outage) runs after the healthy ones, and the
// whole run stops starting sources at DEADLINE_MS, so a few hanging outages can never push the workflow past its 60-minute limit
// (the scheduled run of 29 Oct 09:54 UTC was cancelled at the old 45-minute limit with pl-bzp-contracts, gb-ukhpi and others timing out in a row).
// Worst case: ~5 min setup (npm ci + npm test) + 36 min of sources + one last source of up to TIMEOUT_MS (10 min) = 51 min < 60.
const DEADLINE_MS = 36 * 60 * 1000;

function knownOutage(prev: SourceMeta | null): boolean {
  return !!(prev?.last_error && prev.last_harvest_at && !prev.last_error.startsWith("Data check held back"));
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const acceptChanges = process.argv.includes("--accept-changes");
  const targets = SOURCE_PLUGINS.filter((s) => s.harvest && (only.length === 0 || only.includes(s.info.id)));
  if (!targets.length) {
    console.log("Nothing to harvest.");
    return;
  }
  let ok = 0;
  const report: string[] = [];
  const runStart = Date.now();
  // healthy sources first, known outages last (stable within each group)
  const ordered = [...targets].sort((a, b) => Number(knownOutage(readMeta(a.info.id))) - Number(knownOutage(readMeta(b.info.id))));
  for (const s of ordered) {
    const id = s.info.id;
    if (Date.now() - runStart > DEADLINE_MS) {
      report.push(`SKIP ${id}: not started, the run's ${DEADLINE_MS / 60000}-minute budget was used up (it is collected on the next run)`);
      continue;
    }
    const started = new Date().toISOString();
    const prev: SourceMeta = readMeta(id) ?? {
      source: id, currency: null, unit: null, first_date: null, last_date: null, days: 0,
      last_harvest_at: null, last_rows: 0, last_ok_at: null, last_error: null,
    };
    try {
      const result = await withTimeout(s.harvest!(), TIMEOUT_MS, id);
      if (!result.rows.length) throw new Error("harvest returned no rows");
      // the data checker: a first harvest has no previous values, so it passes untouched
      const check = acceptChanges ? null : dataCheck({ result, prevMeta: prev, previous: previousByKey(id, result.date) });
      if (check?.unitChange) throw new Error(check.unitChange);
      if (check && !check.rows.some((r) => passesGate(r.n))) throw new Error(check.message ?? "every row had fewer than 5 records");
      const { rows } = writeDaily(id, check ? { ...result, rows: check.rows } : result);
      if (!rows) throw new Error("every row had fewer than 5 records");
      const dates = libraryDates(id);
      writeMeta(id, {
        source: id,
        currency: result.currency,
        unit: result.unit,
        first_date: dates[0] ?? null,
        last_date: dates[dates.length - 1] ?? null,
        days: dates.length,
        last_harvest_at: started,
        last_rows: rows,
        last_ok_at: started,
        last_error: check?.message ?? null,
        note: [result.note, check?.accepted.length ? `Data check accepted a level shift: ${check.accepted.slice(0, 3).join("; ")}${check.accepted.length > 3 ? `; and ${check.accepted.length - 3} more` : ""}.` : null].filter(Boolean).join(" ") || null,
        ...(check && Object.keys(check.heldStreak).length ? { held_streak: check.heldStreak } : {}),
      });
      ok++;
      report.push(`${check?.held.length ? "HELD" : "OK  "} ${id}: ${rows} rows for ${result.date} (${dates.length} days held)${check?.message ? ` | ${check.message}` : ""}`);
    } catch (e: any) {
      // SourceError keeps the network cause (ENOTFOUND, certificate errors, UND_ERR_CONNECT_TIMEOUT) in `detail`; put short ones in the
      // recorded error so "Could not reach the official source" always says why (pt-ine-rents / pt-home-prices hid theirs, 27-28 Oct).
      const detail = typeof e?.detail === "string" && /^[\w .:()'/-]{1,80}$/.test(e.detail) && !String(e.message).includes(e.detail) ? ` (${e.detail})` : "";
      const msg = `${String(e?.message ?? e)}${detail}`.slice(0, 300);
      writeMeta(id, { ...prev, last_harvest_at: started, last_error: msg });
      // A source that was already failing on the previous harvest is a known outage (recorded in meta.json and /api/v1/library, and
      // in Notion by the Monitor): it is reported as DOWN and does not count towards the workflow's "more than 3 new failures" alarm.
      report.push(`${prev.last_error && prev.last_harvest_at && !prev.last_error.startsWith("Data check held back") ? "DOWN" : "FAIL"} ${id}: ${msg}`);
    }
  }
  console.log(report.join("\n"));
  if (ok === 0 && targets.length) {
    console.error("Every source failed.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
