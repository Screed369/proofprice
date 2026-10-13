# ProofPrice (code name: pricepaid) — guide for every Claude session

ProofPrice answers one question for AI agents worldwide: **"what did people actually pay for X, here, recently?"**
It returns a price range (median, 10th–90th percentile, sample size, period, confidence, source, licence) built
from real transactions: official open data now, verified receipts (DKIM-sealed order emails) later.
Owner: Simon (non-technical founder). Domain: proofprice.com (bought, in Simon's Vercel team, not yet attached).

## Before you do anything
1. Read the **Operating Manual** in Notion (page "Operating Manual" under "ProofPrice HQ",
   HQ page id `3f82f9b0e5e3811a90b6d43ce5df30b7`). It holds the rules, the work queues and your job.
2. Use ONLY the Notion connector named **Notion** (workspace "simon creedon's Space").
   Never use any other Notion connector.

## Hard rules (never break)
- Never send emails/messages, post publicly, sign up for anything, request API keys, accept terms, or spend money.
  Put the item in the Notion "Decisions for Simon" database instead.
- Vercel: only team `team_aA8mJfk06IyGR8nthAJ2934p` (slug `simons-projects-48308c36`), project
  `prj_QttQGk5REFfJdONYFp5U95PDVp4H` (name `pricepaid-plug`). Never touch any other project.
- Only use data we are allowed to use: official open data, licensed data, partner data, verified receipts.
  No scraping that breaks a site's terms. Asking prices are never presented as paid prices.
- Aggregates only for anything about people's homes or purchases. No figure from fewer than 5 records.
- Never commit secrets. There are none in this repo; keep it that way.

## Code map
- `app/api/mcp/route.ts` — MCP server (mcp-handler 2.x, stateless Streamable HTTP). Tools: `pricepaid_home_sales`,
  `pricepaid_fuel_prices_now`, `pricepaid_coverage`. Descriptions follow "Use this when… / Do not use for…".
- `app/api/v1/*` — REST API mirrors the MCP tools (`home-sales`, `fuel`, `coverage`, `receipts/verify`, `receipts/sender-check`).
- `lib/tools.ts` — routes a request to the right country source. Add new countries here.
- `lib/sources.ts` — registry of every source: licence, attribution, limits. Every new source MUST be added here.
- `lib/sources/*.ts` — one file per source (uk, sg, frfuel, frdvf, esfuel, itfuel). Pure parse functions are exported and unit-tested.
- `lib/answer.ts` + `lib/stats.ts` — the one answer format and the statistics. Do not change the answer shape without a Decision.
- `lib/receipts/*` — DKIM receipt verifier (mailauth + mailparser).
- `tests/*.test.ts` — node:test via tsx. Fixtures copy the REAL live format (note the date you checked it).

## How to add a source (the Builder recipe)
1. Facts first: the Notion Source Pipeline row must have verified facts (exact URL, fields, sample rows, licence).
2. Write `lib/sources/<id>.ts` with exported pure parsers + one async `<id>Now/Sales` function returning `buildAnswer(...)`.
3. Add the registry entry in `lib/sources.ts`, route it in `lib/tools.ts`, extend the MCP schema enums and REST params,
   add an example on `app/page.tsx`, and a method note on `app/method/page.tsx` if needed.
4. Add tests with a fixture copied from the live format. `npm test` and `npx tsc --noEmit` must pass. `npm run build` must pass.
5. Commit on a branch `src/<id>`, push, deploy a preview, test it live (see below), then merge to `main`.

## Commands
- `npm ci` (or `npm install`) · `npm test` · `npx tsc --noEmit` · `npm run build`
- The workspace shell usually cannot reach government sites; test live behaviour through a Vercel deployment.

## Deploying and testing
- Preferred: push to GitHub, then deploy with the Vercel connector `create_deployment` using
  `gitSource {type:"github", org:"Screed369", repo:"proofprice", ref:"<branch>"}` and `project` = the project id above
  (target `production` only from `main` after every check passes).
- The deployment is protected by Vercel Authentication: test with the Vercel connector tool `web_fetch_vercel_url`.
- Production smoke tests (all must return status "ok"):
  `/api/v1/coverage`, `/api/v1/fuel?country=FR&postcode=75015&fuel=diesel`, `/api/v1/fuel?country=ES&area=42&fuel=diesel`,
  `/api/v1/fuel?country=IT&area=MI&fuel=diesel`, `/api/v1/home-sales?country=GB&town=Bristol&property_type=terraced`,
  `/api/v1/home-sales?country=FR&postcode=69003&property_type=apartment`, `/api/v1/home-sales?country=SG&town=Tampines`.
- If production breaks, redeploy the last good deployment and log it in Notion (Run Log + Source Pipeline status "Broken").
