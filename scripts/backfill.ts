// Load past data into the price library: npm run backfill -- <source-id> <from YYYY-MM-DD> <to YYYY-MM-DD> [--dry-run]
// Runs on GitHub Actions (.github/workflows/backfill.yml). The source supplies backfill(); lib/library/backfill.ts writes it.
import { SOURCE_PLUGINS } from "../lib/registry";
import { applyBackfill, MAX_SOURCE_BYTES, MAX_TOTAL_BYTES, totalHistoryBytes } from "../lib/library/backfill";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const dryRun = process.argv.includes("--dry-run");
  const [id, from, to] = args;
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(from ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? "") || from > to) {
    console.error("Usage: npm run backfill -- <source-id> <from YYYY-MM-DD> <to YYYY-MM-DD> [--dry-run]");
    process.exit(2);
  }
  const src = SOURCE_PLUGINS.find((s) => s.info.id === id);
  if (!src) throw new Error(`Unknown source: ${id}`);
  if (!src.backfill) throw new Error(`Source ${id} has no backfill()`);
  console.log(`History before: ${(totalHistoryBytes() / 1048576).toFixed(3)} MB`);
  const result = await src.backfill(from, to);
  const rep = applyBackfill(id, result, { dryRun, from, to });
  console.log(JSON.stringify(rep, null, 2));
  console.log(`${dryRun ? "DRY RUN. " : ""}Added ${(rep.bytes_added / 1024).toFixed(1)} KB; ${id} history ${(rep.source_history_bytes / 1048576).toFixed(3)} MB of ${MAX_SOURCE_BYTES / 1048576} MB; all history ${(rep.total_history_bytes / 1048576).toFixed(3)} MB of ${MAX_TOTAL_BYTES / 1048576} MB`);
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
