// Tells IndexNow-supporting search engines (Bing, Yandex, Seznam, Naver...) which public pages changed.
// No account or signup: the key file lives at public/<key>.txt and proves we own the site.
// Usage: tsx scripts/indexnow.ts [--all] [--dry-run]. Default: pages whose last-modified day is today or yesterday (UTC).
// Never fails the harvest: it always exits 0 (the workflow step is also continue-on-error).
import { readdirSync } from "node:fs";
import { buildSitemap } from "../lib/open-book";
import { SITE_URL } from "../lib/site/constants";

const ENDPOINT = "https://api.indexnow.org/indexnow";

function keyFromPublic(): string | null {
  const f = readdirSync("public").find((n) => /^[0-9a-f]{32}\.txt$/.test(n));
  return f ? f.replace(/\.txt$/, "") : null;
}

export function changedUrls(all: boolean, now = new Date()): string[] {
  const cutoff = new Date(now.getTime() - 36 * 3600 * 1000);
  return buildSitemap(SITE_URL, now)
    .filter((e) => e.url.startsWith(SITE_URL) && !/\.(txt|json)$/.test(e.url))
    .filter((e) => all || (e.lastModified ? new Date(e.lastModified) >= cutoff : false))
    .map((e) => e.url);
}

async function main() {
  const key = keyFromPublic();
  if (!key) return console.log("indexnow: no key file in public/, nothing sent.");
  const urlList = changedUrls(process.argv.includes("--all"));
  console.log(`indexnow: ${urlList.length} changed URLs`);
  if (!urlList.length || process.argv.includes("--dry-run")) return;
  const host = new URL(SITE_URL).host;
  for (let i = 0; i < urlList.length; i += 9000) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key, keyLocation: `${SITE_URL}/${key}.txt`, urlList: urlList.slice(i, i + 9000) }),
    });
    console.log(`indexnow: batch ${i / 9000 + 1} -> HTTP ${res.status}`);
  }
}

main().catch((e) => console.log("indexnow: skipped,", e instanceof Error ? e.message : e)).finally(() => process.exit(0));
