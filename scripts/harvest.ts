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
import { MIN_PUBLISH } from "../lib/stats";

const TIMEOUT_MS = 10 * 60 * 1000;

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
  for (const s of targets) {
    const id = s.info.id;
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
      if (check && !check.rows.some((r) => r.n >= MIN_PUBLISH)) throw new Error(check.message ?? "every row had fewer than 5 records");
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
        note: result.note ?? null,
      });
      ok++;
      report.push(`${check?.held.length ? "HELD" : "OK  "} ${id}: ${rows} rows for ${result.date} (${dates.length} days held)${check?.message ? ` | ${check.message}` : ""}`);
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 300);
      writeMeta(id, { ...prev, last_harvest_at: started, last_error: msg });
      report.push(`FAIL ${id}: ${msg}`);
    }
  }
  console.log(report.join("\n"));
  if (ok === 0) {
    console.error("Every source failed.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
