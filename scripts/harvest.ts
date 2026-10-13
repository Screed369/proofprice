// The daily collector. Runs on GitHub Actions (.github/workflows/harvest.yml), never in the app.
// For every source with a harvest() function: fetch the official bulk data once, turn it into aggregate rows,
// and add them to the price library (library/<source>/). One failing source never stops the others.
// Usage: npm run harvest            (all sources)
//        npm run harvest -- es-fuel (one source)

import { SOURCE_PLUGINS } from "../lib/registry";
import { libraryDates, readMeta, writeDaily, writeMeta, SourceMeta } from "../lib/library/store";

const TIMEOUT_MS = 10 * 60 * 1000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
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
      const { rows } = writeDaily(id, result);
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
        last_error: null,
        note: result.note ?? null,
      });
      ok++;
      report.push(`OK   ${id}: ${rows} rows for ${result.date} (${dates.length} days held)`);
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
