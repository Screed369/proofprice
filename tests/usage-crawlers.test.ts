// Usage meter: web crawlers are not customers (22 Oct 2026). Crawlers that follow the links on our public answer pages are counted in
// their own "crawlers" group (crawler_questions), not in real_questions; AI fetchers started by a person (ChatGPT-User, Claude-User,
// Perplexity-User, MistralAI-User) are real demand. Only a yes/no class is kept, never the user agent.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  BLOB_PREFIX, CRAWLER_CLIENT, flushUsage, isCrawlerUA, memoryStore, pendingSessionsSummary, recordUsage, reduceSessions, resetUsage,
  setUsageStore, summariseUsage, usageReport, visitorOf,
} from "../lib/usage";

const ON = { BLOB_READ_WRITE_TOKEN: "test-token-not-real" };
const DAY1 = new Date("2026-10-14T12:00:00Z");
const req = (ip: string, ua: string) =>
  new Request("https://proofprice.com/api/v1/fuel?country=ES", { headers: { "x-forwarded-for": `${ip}, 10.0.0.1`, "user-agent": ua } });

let mem = memoryStore();
beforeEach(() => {
  resetUsage(DAY1.getTime());
  mem = memoryStore();
  setUsageStore(mem);
});
const everythingWritten = () => mem.writes.map((w) => w.pathname + "\n" + w.body).join("\n");

test("isCrawlerUA: search, AI-training and SEO crawlers and generic bots are crawlers", () => {
  const crawlers = [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
    "Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    "anthropic-ai",
    "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
    "CCBot/2.0 (https://commoncrawl.org/faq/)",
    "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)",
    "Mozilla/5.0 (compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)",
    "Mozilla/5.0 (Macintosh) Version/17.0 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)",
    "Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)",
    "Mozilla/5.0 (compatible; DotBot/1.2; +https://opensiteexplorer.org/dotbot)",
    "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
    "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
    "DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)",
    "Mozilla/5.0 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)",
    "SomeNewCrawler/3.1",
    "my-spider",
    "research-bot/0.1",
  ];
  for (const ua of crawlers) assert.equal(isCrawlerUA(ua), true, ua);
});

test("isCrawlerUA: user-initiated AI fetchers, browsers, tools and apps are not crawlers", () => {
  const notCrawlers = [
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
    "Mozilla/5.0 (compatible; MistralAI-User/1.0; +https://docs.mistral.ai/robots)",
    "Mozilla/5.0 (compatible; DuckAssistBot/1.2; +http://duckduckgo.com/duckassistbot.html)",
    "claude-user",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "curl/8.4.0",
    "python-httpx/0.27",
    "claude-code/2.0",
    "node",
    "",
    undefined,
  ];
  for (const ua of notCrawlers) assert.equal(isCrawlerUA(ua), false, String(ua));
});

test("a crawler's hits are counted apart: crawler_questions, never real_questions; user-initiated AI fetchers stay real", async () => {
  const bot = visitorOf(req("192.0.2.31", "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)"))!;
  const gpt = visitorOf(req("192.0.2.32", "Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)"))!;
  const human = visitorOf(req("192.0.2.33", "Mozilla/5.0 Chrome/130"))!;
  const health = visitorOf(req("192.0.2.34", "UptimeRobot/2.0"))!;
  assert.deepEqual([bot.crawler, gpt.crawler, human.crawler, health.crawler], [true, false, false, false]); // a health checker stays a directory check
  for (let i = 0; i < 30; i++) recordUsage({ tool: "pricepaid_fuel_prices_now", country: "ES", key: "28 / diesel", status: "ok", visitor: bot }, DAY1, ON);
  recordUsage({ tool: "pricepaid_fuel_prices_now", country: "ES", key: "28 / diesel", status: "no_matches", visitor: bot }, DAY1, ON);
  for (let i = 0; i < 2; i++) recordUsage({ tool: "pricepaid_fuel_prices_now", country: "FR", key: "75 / diesel", status: "ok", visitor: gpt }, DAY1, ON);
  recordUsage({ tool: "pricepaid_rent_prices", country: "IE", key: "dublin", status: "ok", visitor: human }, DAY1, ON);
  assert.deepEqual(pendingSessionsSummary().map((s) => s.group).sort(), ["crawlers", "unnamed", "unnamed"]);
  await flushUsage(DAY1, ON);
  const r = await usageReport(DAY1, ON, mem);
  assert.equal(r.real_questions, 3, "ChatGPT-User and the visitor count; GPTBot does not");
  assert.equal(r.crawler_questions, 31);
  assert.equal(r.by_day![0].real_questions, 3);
  assert.equal(r.by_day![0].crawler_questions, 31);
  assert.equal(r.total_questions, 34, "legacy total still holds every row");
  assert.deepEqual(r.by_country_asked_about, [{ country: "FR", questions: 2 }, { country: "IE", questions: 1 }]);
  assert.deepEqual(r.questions_by_tool!.map((t) => [t.tool, t.questions]), [["pricepaid_fuel_prices_now", 2], ["pricepaid_rent_prices", 1]]);
  assert.deepEqual(r.top_unanswered, [], "a crawler's empty answer is not a demand gap");
  assert.ok(!r.clients!.other_apps.some((c) => c.client === CRAWLER_CLIENT) && !r.by_client!.some((c) => c.client === CRAWLER_CLIENT));
  assert.equal(r.sessions!.crawlers, 1);
  assert.equal(r.sessions!.real_apps, 2);
  assert.equal(r.sessions!.total, 3);
  assert.deepEqual(r.sessions!.by_group.crawlers, { sessions: 1, questions: 31, handshakes: 0 });
  assert.equal(r.by_day![0].sessions!.crawlers, 1);
  assert.match(r.fields!.crawler_questions, /crawlers/i);
});

test("the crawler class is a yes/no only: the user agent and the IP address are never written", async () => {
  const bot = visitorOf(req("198.51.100.99", "Mozilla/5.0 (compatible; SecretCrawlerBot/9.9; +https://secret.example/bot)"))!;
  assert.ok(!JSON.stringify(bot).includes("SecretCrawler") && !JSON.stringify(bot).includes("198.51.100.99"));
  recordUsage({ tool: "pricepaid_fuel_prices_now", country: "ES", status: "ok", visitor: bot }, DAY1, ON);
  await flushUsage(DAY1, ON);
  const all = everythingWritten();
  for (const secret of ["SecretCrawler", "secret.example", "198.51.100.99", bot.pre]) assert.ok(!all.includes(secret), `${secret} was written`);
  assert.ok(all.includes('"g":"crawlers"') && all.includes(CRAWLER_CLIENT));
  assert.ok([...mem.files.keys()].some((p) => p.startsWith(BLOB_PREFIX)));
});

test("a crawler hit that arrives as a pure summary (rows only) is also kept out of real_questions", () => {
  const rows = [
    { day: "2026-10-14", tool: "pricepaid_fuel_prices_now", country: "ES", key: "28 / diesel", status: "ok" as const, client: CRAWLER_CLIENT, count: 2500 },
    { day: "2026-10-14", tool: "pricepaid_fuel_prices_now", country: "ES", key: "28 / diesel", status: "ok" as const, client: "", count: 4 },
  ];
  const r = summariseUsage([{ rows }], DAY1);
  assert.equal(r.real_questions, 4);
  assert.equal(r.crawler_questions, 2500);
});

test("old daily summaries without a crawlers group still report (backward compatible)", () => {
  const old = reduceSessions([{ h: "a", g: "named_apps", q: 1, hs: 0, tools: { t: 1 } }]);
  delete (old.by_group as Record<string, unknown>).crawlers;
  const r = summariseUsage([{ rows: [] }], DAY1, 30, 20, { sessions: { "2026-10-14": old } });
  assert.equal(r.sessions!.crawlers, 0);
  assert.equal(r.sessions!.real_apps, 1);
  assert.equal(r.by_day![0].sessions!.crawlers, 0);
});

// ---------- links to the live REST answer must not invite crawlers ----------

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? tsxFiles(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

test("every public-page link to a live /api/ answer carries rel=\"nofollow\"", () => {
  let checked = 0;
  for (const file of tsxFiles(join(process.cwd(), "app"))) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/<a\s[^>]*>/g)) {
      const tag = m[0];
      const answerLink = /href=\{[^}]*RestPath\}/.test(tag) || /href="\/api\/v1\/(?!usage|library)[^"]*"/.test(tag);
      if (!answerLink) continue;
      checked++;
      assert.match(tag, /rel="nofollow"/, `${file}: ${tag}`);
    }
  }
  assert.ok(checked >= 8, `expected to find the answer links, found ${checked}`);
});
