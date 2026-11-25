# Free listings pack (DRAFTS ONLY, nothing has been submitted)

Prepared 15 Oct 2026. Simon submits these by hand.

## Core facts

- **Name:** ProofPrice
- **One line:** Real prices people actually paid, from official data, for AI agents.
- **160 characters:** MCP server and API that answers "what did people actually pay?" for homes, rents, fuel, energy, food and more, from official open data. No key needed.
- **Long description:** ProofPrice answers one question for AI agents: what did people actually pay for X, here, recently? Each answer is a price range (median, 10th-90th percentile), sample size, period, confidence, source, licence and price type, built from official open data (land registries, statistics offices, regulators). Aggregates only: no figure from fewer than 5 records. Posted or asking prices are never presented as paid prices. 16 read-only tools cover home sales, rents, fuel, household energy, groceries, farm and land prices, cars, airfares, broadband, childcare, medical prices, medicines, government contracts, a price check and coverage. Remote MCP over Streamable HTTP, no sign-in, plus a REST API.
- **Tags:** prices, real-estate, rents, fuel, energy, groceries, open-data, government-data, statistics, mcp, rest-api, europe
- **URLs:** Site https://proofprice.com · MCP https://proofprice.com/api/mcp · Answer pages https://proofprice.com/prices · Connect guides https://proofprice.com/connect · OpenAPI https://proofprice.com/openapi.json · llms.txt https://proofprice.com/llms.txt · Code https://github.com/Screed369/proofprice · Contact hello@proofprice.com · Licence MIT (code)
- **Connect snippet:** `claude mcp add --transport http proofprice https://proofprice.com/api/mcp`

## Per directory

| Directory | What to submit |
| --- | --- |
| Glama (glama.ai/mcp/servers) | Claim/add the server via the GitHub repo URL; use the 160-char text and tags. Remote server URL above. |
| mcp.so | "Submit" form: name, 160-char text, long description, GitHub URL, server URL (type: streamable-http). |
| PulseMCP | Submit via pulsemcp.com "Submit a server": GitHub URL and website URL. |
| Cursor directory (cursor.directory) | Submit MCP entry: name, one line, config `{ "mcpServers": { "proofprice": { "url": "https://proofprice.com/api/mcp" } } }`. |
| Official MCP registry | `server.json` already exists in the repo (`com.proofprice/pricepaid`); publishing needs an account step by Simon. |

## awesome-mcp-servers PR text (punkpeye/awesome-mcp-servers)

Title: `Add ProofPrice (official-data prices paid)`

Body:

> Adds ProofPrice, a remote MCP server that returns what people actually paid (homes, rents, fuel, household energy, groceries, childcare, medicines) from official open data, with source, period, sample size and licence on every answer. Read-only, no API key, Streamable HTTP. https://proofprice.com · https://github.com/Screed369/proofprice

Suggested list line (check the repo's current category and emoji legend before sending; likely Finance & Fintech or Data Platforms):

`- [Screed369/proofprice](https://github.com/Screed369/proofprice) 🏎️ ☁️ - Prices people actually paid (homes, rents, fuel, energy, groceries) from official open data, with source, period, sample size and licence.`

## data.gov.ie reuse showcase text

> **ProofPrice** uses Irish open data to answer "what did people actually pay?" for AI assistants and developers. It reuses the PSRA Residential Property Price Register (home sales, with attribution to the Property Services Regulatory Authority), RTB rent averages and CSO consumer price tables (CC BY 4.0), and EU Weekly Oil Bulletin fuel prices. Only aggregates are published (median, range, sample size, period) with source and licence on every answer. Examples: https://proofprice.com/prices · Contact: hello@proofprice.com

(PSRA re-use terms require: acknowledge source and copyright, reproduce accurately, not for advertising a particular product. Keep the attribution line.)

## Which sources may be redistributed as dataset files

Hugging Face and Kaggle would host ProofPrice's own **aggregates** (library CSVs), not raw records. Only sources with a clear open licence are listed. Check each source's `attribution` text before upload.

**OK (open licence, redistribution with attribution):**

- CC BY 4.0: be-home-prices (Statbel), ie-rtb-rents, ie-cso-prices, ie-childcare-fees (CSO), eu-oil-bulletin, eu-energy, eu-farm-prices, eu-land-prices (European Commission / Eurostat), nl-home-prices (CBS), no-home-prices, no-ssb-rents (SSB), pt-home-prices (INE), au-nsw-rents
- CC0: se-home-prices, se-scb-rents
- Open Government Licence v3.0 (UK): gb-hmlr-ppd, gb-ons-rents, gb-ons-price-levels, gb-desnz-fuel, gb-childcare-fees, gb-contracts-finder, gb-nhs-pca
- Licence Ouverte / Etalab 2.0: fr-fuel, fr-medicines (fr-dvf also has reuse conditions: no re-identification of people)
- Public domain / US government works: us-eia-fuel, us-eia-energy, us-bls-average-prices, us-dol-childcare, us-dot-airfares
- Other open licences: it-fuel (IODL 2.0), sg-hdb-resale, sg-hdb-rents, sg-coe (Singapore Open Data Licence), tw-home-sales, tw-rents (Taiwan Open Government Data License), ca-statcan-fuel, ca-statcan-prices (Statistics Canada Open Licence), es-fuel (Spanish PSI reuse), br-aneel-electricity (ODbL; share-alike applies to the dataset), nz-mbie-fuel, nz-mbie-rents (CC BY per MBIE)

**NOT yet (check or hold back):**

- ie-ppr: PSRA terms (not CC BY on the PSRA site; prohibits promoting a product). Publish aggregates only after reading the terms once more; not in the first upload.
- br-fuel, mx-fuel: licence marked UNCONFIRMED in the code.
- us-home-sales, us-nadac, us-usaspending, us-cms-medicare: licence differs by dataset or none stated.
- ca-cmhc-rents (CMHC licence agreement, revocable), at-home-prices, au-home-sales, dk-home-prices, fi-home-prices (national statistics terms; check attribution wording), eu-ted, eu-broadband (Eurostat/Commission reuse; likely fine, confirm).
- at-fuel: taken offline.

## Hugging Face dataset card (draft)

```
---
license: other
license_name: per-source-open-licences
pretty_name: ProofPrice open aggregates
language: [en]
tags: [prices, real-estate, rents, fuel, energy, open-data]
size_categories: [10K<n<100K]
---
# ProofPrice open aggregates

Daily aggregate prices (median, 10th-90th percentile, sample size, period) computed by ProofPrice from official open data. No individual records, no personal data.

## Sources and licences
Every row carries its source id; each source keeps its own licence (CC BY 4.0, CC0, OGL v3.0, Licence Ouverte 2.0, public domain and others). Attribute the original publisher. See https://proofprice.com/sources.

## Fields
source_id, area, item, date, median, p10, p90, n, currency, unit, price_type.

## Limitations
Prices paid and posted prices are labelled by price_type and must not be mixed. Figures built from fewer than 5 records are never published. Information, not a valuation.

Live API and MCP: https://proofprice.com
```

## Kaggle dataset description (draft)

**Title:** ProofPrice: official prices paid, daily aggregates
**Subtitle:** Medians and ranges for homes, rents, fuel and energy from official open data
**Description:** Daily aggregates (median, 10th-90th percentile, sample size, period) computed from official open data: land registries, statistics offices and regulators. Only the sources listed under "OK" in the listings pack are included, each under its own open licence with attribution in the `source_id`/`attribution` columns. No individual records. Price type (transaction, official statistic, posted price) is stated on every row. Live access: https://proofprice.com (MCP and REST, no key). Contact hello@proofprice.com.
**Licence field:** "Other (specified in description)".

---

# App-directory listing packs: ChatGPT, Claude connectors, Gemini (DRAFTS ONLY, nothing has been submitted)

Prepared 25 Nov 2026 by the Builder. Research and writing only: no account was opened, no form was filled, no terms were accepted.
Positioning for every word below: ProofPrice is the **referee** ("was this price typical, with proof"), not a catalogue of shelf prices. Say "typical" or "typical range". Never "fair", "guaranteed" or "verified price".

How sure each fact is: **[page]** = read on the publisher's page on 25 Nov 2026; **[summary]** = from a machine summary of a long page, spot-check before relying on it; **[3rd party]** = a blog, not the publisher; **UNKNOWN** = not stated anywhere we could read. None of the pages showed a "last updated" date, so re-read them on the day Simon submits.

## 0. Facts re-checked today (live, 25 Nov 2026)

- Production `/api/v1/coverage` lists **33 tools and 292 sources** (the 14 Nov pack said 11 home-sale countries and 17 rent countries: those numbers are out of date, home sales now list many more countries. Never copy a country count into a listing; point at the coverage tool instead).
- Live answers still have the shape the listings describe: status ok, period, confidence `high`, `price_type` transaction (home sales) or official_statistic (rent), source + licence + attribution. Checked: Bristol terraced (period 2025-11-25 to 2026-09-25, HM Land Registry, OGL v3.0), Dublin second-hand (2025-11-13 to 2026-11-13, PSRA), Dublin rent (2025-10-01 to 2025-12-31, RTB via CSO, CC BY 4.0). `/api/v1/check` for a 400,000 GBP Bristol terraced offer returns verdict `within_typical_range`. Tokyo returns an error that lists the covered places (a good "negative" case).
- Figures are deliberately left out of the test prompts: they move with every harvest. A reviewer should look for the same shape, a sensible order of magnitude, and the source named. Re-fetch just before submission.
- **Main serves ONE MCP endpoint: `https://proofprice.com/api/mcp`** (all tools). The homes-only server `/api/mcp/homes` described in the 14 Nov ChatGPT pack exists only on the unmerged branch / PR #12 (not on main). Until the lead developer and Simon decide on PR #12, every pack below uses `/api/mcp`.
- Server card and agent card already exist at `/.well-known/mcp-server-card` and `/.well-known/agent-card.json`. Keys for proofs at `/.well-known/proofprice-keys.json`.
- **Pricing wording risk (found today).** `app/pricing/page.tsx` says the price check and daily history are free for a number of calls a day, then cost a few cents per call paid by the agent with x402. `lib/mcp-tools.ts` line 243 appends `premiumNote(key)` to a tool description when the payment gate is on. OpenAI's guidelines say not to advertise pricing, subscriptions, free trials or promotions [summary]; Claude's criteria list moving money as an unsupported use case [page], and descriptions must not promote [page]. Before any submission the lead developer must confirm the payment gate is OFF for the endpoint being submitted (or that no pricing text reaches tool descriptions), and the listing text must not say "free". The listing texts below avoid it.

## 1. Shared listing text (reused by all three)

- **Name:** ProofPrice (ChatGPT limit 30 characters, Claude 100).
- **Short line (29 characters, fits ChatGPT's 30 limit):** `Typical prices people paid` (26). Alternative: `Was this price typical?` (23).
- **One-liner (under 200, Claude's limit):** "The price referee for AI agents: what people actually paid for homes, rent, fuel, energy, food and more, as a typical range with source, date and sample size." (about 160)
- **Description (under 2,000 for Claude, under 4,000 for ChatGPT):**

> ProofPrice answers one question: what did people actually pay for something, here, recently? It is a referee, not a shop window. Ask about a town, postcode, fuel station area or product category and you get a typical range (10th to 90th percentile) with a median, the number of records behind it, the period covered, a confidence label, the official source and its licence. If you give it a price you were offered, it tells you whether that price sits within, above or below the typical range for that place.
>
> Every answer is built from official records: land registries, statistics offices and regulators. Where a source only publishes an average, the answer says so and gives no range. Nothing is shown from fewer than 5 records. Asking prices and listings are never presented as paid prices. Answers carry a signed proof that anyone can check at proofprice.com.
>
> Use "what price data is covered" to see exactly which countries and categories are available; coverage differs by category and place, and official data arrives weeks or months late, so every answer shows its period.
>
> Intended users: people checking a price before they pay, researchers, journalists and developers building assistants. Limits: aggregates for an area, never a value for one address; information, not a valuation, mortgage, legal or financial advice. No sign-in. ProofPrice is independent and is not made or endorsed by OpenAI, Anthropic or Google.

- **Tags / categories:** prices, price check, official data, real estate, rent, fuel, energy, groceries. Pick the closest of whatever categories each portal offers (Claude: one to five; ChatGPT: UNKNOWN list; suggest Finance or Shopping, confirm in the portal).
- **URLs:** website https://proofprice.com · privacy https://proofprice.com/privacy · terms https://proofprice.com/terms · documentation https://proofprice.com/connect (and https://proofprice.com/llms.txt, https://proofprice.com/openapi.json) · support: the contact is hello@proofprice.com; both portals may want an HTTPS support page, so use https://proofprice.com/connect or https://proofprice.com/trust once the lead confirms one names the same publisher and the email. · scoreboard https://proofprice.com/scoreboard.
- **Icon:** `public/icon-512.png` (512 px) or `public/logo.svg`; **check it is square before upload** (not checked here).
- **Publisher name:** must match the verified identity in each portal (ChatGPT shows the verified developer name). Simon decides: his own name or a business name. Contact: hello@proofprice.com.

## 2. Test prompts (use for all three; 5 positive, 3 negative, matching ChatGPT's "exactly five positive and three negative" rule [summary])

Positive (tool in brackets; expected: status ok, a range or a single stated average, period, sample size where the source has one, source and licence named, described as "typical", never as a valuation):

1. "What did terraced homes in Bristol actually sell for over the last year?" [`pricepaid_home_sales`, country GB, town Bristol, property_type terraced]
2. "What do second-hand homes in Dublin sell for, and where does the data come from?" [`pricepaid_home_sales`, country IE, town Dublin, property_type second-hand]
3. "What is the average rent in Dublin? Is that a range or one number?" [`pricepaid_rent_prices`, country IE, town Dublin]. Expected: ONE published average, no range, no sample size, says the quarter is months old.
4. "I was offered a terraced house in Bristol for 400,000 pounds. Is that typical?" [`pricepaid_check_price`, category home-sales, country GB, town Bristol, property_type terraced, price 400000]. Expected: within_typical_range, with the median it was compared to.
5. "Which countries can you give rent prices for?" [`pricepaid_coverage`]. Expected: a list taken from the coverage answer, no invented countries.

Negative (the app must not pretend):

6. "Should I take a 30-year mortgage to buy in Bristol and how much should I offer?" Expected: no advice; at most the local typical range, with a note that it is not mortgage advice.
7. "Show me 3-bed houses for sale in Leeds under 300k." Expected: no listings; says ProofPrice holds recorded sales, not listings or asking prices.
8. "What did homes sell for in Tokyo last year?" Expected: the tool's "not available" error is passed on plainly, covered places listed, no invented figure.

## 3. ChatGPT app (plugin) directory

**What it is now.** OpenAI's developer pages are titled "Plugins" and the old `apps-sdk/app-submission-guidelines` address serves "Plugin guidelines"; the help centre still says "apps" and "We are accepting app submissions" [page]. Submission is in the OpenAI platform dashboard at https://platform.openai.com/plugins ("Upload new or existing plugin") [summary].

**Needs from OpenAI [mostly summary; the long pages were cut when read, re-read https://developers.openai.com/plugins/deploy/submission before starting]:**

| Item | Detail |
|---|---|
| Who | Organization owner (or a member with Apps Management Write); publisher verified as an individual or an organization. |
| Domain | Host the token the portal shows, as plain text only, at `https://proofprice.com/.well-known/openai-apps-challenge` (no JSON). Does not exist yet (app/.well-known has none). Only available after Simon starts the submission. |
| Package | 14 Nov research: a ZIP with `plugin.json` + `mcp.json` + `assets/`, remote MCP over Streamable HTTP, no auth, no headers, version 1.0.0. Not re-confirmed on 25 Nov (page text cut). |
| Listing | displayName max 30; shortDescription max 30; longDescription max 4,000; up to 3 starter prompts of at most 128 characters; logo square, at least 48 px, PNG/JPEG/WebP/SVG, max 5 MiB; support, privacy and terms URLs, HTTPS, max 1,024 characters. |
| Review | Exactly 5 positive and 3 negative test cases; a video walkthrough with a reviewer-accessible URL; release notes. Review timeline UNKNOWN. Screenshots: not stated. |
| Tools | Explicit boolean readOnlyHint, destructiveHint, openWorldHint on every tool (already set in `lib/mcp-tools.ts` line 29). "Annotation justifications are no longer required" [summary]. |
| Rules that touch us | No pricing/free/discount wording; no comparisons with other products; no implying OpenAI endorsement; no diagnostic or telemetry fields unless needed; Results accurate and errors clear. |

- **displayName:** ProofPrice · **shortDescription:** `Typical prices people paid` (26) · **longDescription:** section 1 text.
- **Starter prompts (max 3, under 128 characters):** `What did terraced homes in Bristol sell for this year?` · `I was offered a flat for 300,000 euros in Lyon. Is that typical?` · `What rent do people pay in Dublin, and what is the source?`
- **Test cases:** section 2.
- **Screenshots:** none required by what we read. For the video and for any optional images, see the list in section 6.
- **Developer jobs before Simon starts (carried over from the 14 Nov pack, re-check each):** add the challenge route; confirm the payment gate adds no price text to descriptions (above); decide whether `as_of` and `_meta["proofprice/proof"]` count as "telemetry" (recommend keep, explain: freshness and proof); make the `pricepaid_check_price` description fit what is submitted; pick a brand colour; build the ZIP; run MCP Inspector against the live endpoint.
- **Not brought across:** the code on `feat/chatgpt-directory-prep` (PR #12). Only the facts.

## 4. Claude connectors directory

**Where.** Developer portal https://claude.ai/directory/manage, "Submit new", then "MCP connector"; anyone on a paid Claude plan can submit [page: https://claude.com/docs/connectors/building/submission].

**Needs [page unless marked]:**

| Item | Detail |
|---|---|
| Connection | A remote server reachable over HTTPS (transport not named). No sign-in is allowed for public data ("no authentication for public data"). |
| Tools | Every tool has a title and a readOnlyHint (or destructiveHint); tool names 64 characters or fewer; descriptions state precisely what the tool does, must not tell Claude to call other tools, must not promote products. Already true on `/api/mcp` (title + four read-only annotations on every tool, per CLAUDE.md). |
| Quality | Every tool must succeed with valid input; bare "Internal Server Error" or "Bad Request" fails review. Our smoke test shows FR farm-prices rapeseed/sunflower/peas returning 502 until about 1 Dec (publisher firewall): fix or confirm the stale copy answers before submitting, or the reviewer may hit it. |
| Listing | Name up to 100; one-liner up to 200; description up to 2,000; one to five categories; documentation URL; privacy policy URL; support contact; icon (size not stated); URL slug (permanent: suggest `proofprice`). Display-name changes need re-review. |
| Use cases | Primary use cases; what users need before connecting (nothing); read-only. |
| Company | Company name, website, a primary contact for review updates. |
| Data handling | Own first-party API (we proxy official open data, so say "own API built from official open data"). No personal health data, no sponsored content. |
| Test | Confirm every tool was run by Simon or the lead (MCP Inspector or as a custom connector in Claude). Credentials: none needed. |
| Policy | Seven acknowledgments (directory guidelines, first-party API use, financial transactions, AI media generation, prompt injection, conversation data collection, public documentation); all seven required; the Anthropic Software Directory Terms and Policy must be accepted. We have not read their full text: Simon must read them. |
| Privacy | "Missing or incomplete privacy policies result in immediate rejection." Our page: https://proofprice.com/privacy (counts anonymous usage; no accounts or cookies). Check it covers data collection, use, storage, sharing, retention and contact. |
| Screenshots | Required only for MCP Apps (UI). A plain connector: none stated. |
| Review | An automated scan first; it lists as a **Community** connector by default; some get human review (no numeric time); **Verified** is a separate, slower quality label and is not required. Escalation: mcp-review@anthropic.com. |

- **Name:** ProofPrice · **One-liner and description:** section 1.
- **Test prompts:** section 2. **Connect snippet for the documentation page:** `claude mcp add --transport http proofprice https://proofprice.com/api/mcp`.
- Risk to flag to the reviewer in the notes: the optional x402 per-call payment for extra calls (see section 0). Say in the listing that the connector moves no money for the user; confirm the gate is off for the submitted endpoint.

## 5. Gemini

**Finding: there is no public submission route for third parties that we could confirm.** None of Google's pages we read (Cloud blog "Developer's guide to implementing MCP apps in Gemini", 19 Oct 2026; Agent Registry doc, updated 10 Nov 2026 [summary]) describes a public directory or review for the Gemini app or Gemini Enterprise. They describe a customer admin registering a server inside their own organisation. Third-party Tallyfy (updated 4 Sep 2026) says Google has no single official MCP listing and names three surfaces: Gemini app "Connected Apps" accepting a custom MCP URL on personal accounts, the Gemini CLI extensions gallery (geminicli.com/extensions, self-serve), and Gemini Enterprise's per-customer custom MCP. **[3rd party, unverified.]** Named partner connectors (for example Canva) are described as negotiated deals.

What this means for the listing job:

1. **Gemini Enterprise (an organisation's admin connects us).** Needs Streamable HTTP only (SSE and stdio are refused), and the admin chooses "No authentication" or "OAuth 2.0" in the add-tool step [summary]. We are no-auth, so a customer admin can add `https://proofprice.com/api/mcp`. Three different admin click-paths appear in Google's blog, the registry doc and Zapier; they are not reconciled, so do not publish click-by-click steps until checked against Google's own "set up a custom MCP server" doc (not read). Nothing for ProofPrice to submit.
2. **Gemini CLI / extensions gallery.** Possible self-serve route (needs a `gemini-extension.json` manifest and a public GitHub repo; exact content not confirmed, and Tallyfy claims the free CLI was replaced by an "Antigravity CLI" on 18 Jun 2026, unverified). Next step for the lead: read geminicli.com and Google's announcement before doing anything.
3. **Gemini app (consumer).** UNCONFIRMED that a custom MCP URL can be added. The only partner route is a business conversation with Google, which is Simon's call (outreach is not something this team does).

- **Text to keep ready:** the section 1 one-liner and description; the same 8 test prompts.
- **Tool annotations:** no Google page we read requires them; we have them anyway.

## 6. Screenshot and video list (take on https://proofprice.com, not mock-ups)

Take real captures from the chat app after connecting, desktop, 1440 px wide, light mode, no personal data on screen:

1. The connector card in the app's connector list, showing the name, short line and icon.
2. Positive case 1 (Bristol terraced) with the tool call visible and the answer showing range, number of sales, period and source.
3. Positive case 4 (price check) showing the verdict and the wording "typical range".
4. Positive case 3 (Dublin rent) showing that the answer is one average and says so.
5. Negative case 8 (Tokyo) showing the plain "not covered" message.
6. https://proofprice.com/scoreboard (only once it holds a recorded result; today it says "No assistant has been measured yet").
7. The signed-proof check page (`/p/<proof>` from a real answer) showing it verifies.

Video for ChatGPT (3 to 5 minutes, link anyone can open): run positive cases 1 to 5 and negative case 8 in ChatGPT, say the source out loud each time.

## 7. Steps for Simon (nothing here may be done by the Builder)

Put into the Notion "Simon is needed" board as ONE row, "App directory listings (ChatGPT, Claude, Gemini)", Type: sign-up and terms, about 3 to 4 hours in total over several days. Order by effort and reward:

1. **Claude connectors directory (about 60 minutes; do this first).** Needs a paid Claude plan. Go to https://claude.ai/directory/manage, "Submit new", "MCP connector", paste the HTTPS endpoint, fill the fields from sections 1 and 4, read and accept the Anthropic Software Directory Terms and Policy and the seven acknowledgments, and confirm the tools were tested. Before that, ask the lead developer to confirm: payment gate off for the submitted endpoint; the three FR farm-prices examples answer; the support page. If unsure, stop.
2. **ChatGPT (about 2 to 3 hours plus identity-verification wait).** Create or open the OpenAI platform organisation that should own the listing; complete individual or business verification (ID documents may be needed; decide which name should show); open https://platform.openai.com/plugins. The lead developer builds the package and the challenge route first. Simon pastes the domain token to the lead, presses Connect, runs the 8 test prompts on desktop and phone, records the 3 to 5 minute video, accepts the policy tick boxes and presses Submit. Only he can accept OpenAI's terms and ID checks.
3. **Gemini (nothing to submit).** Decide whether to wait for the lead's check of the Gemini CLI extensions route, or whether Simon wants to approach Google about a partner listing. Do not start before the first two.
4. Do not mention prices or "free" in any listing box. If a portal asks for a pricing field, choose "no charge for the listing" or the equivalent and ask the lead.

**Recommendation:** Claude first (open to any paid account, no verification wait, free of the ZIP work), ChatGPT second once PR #12's homes server is either merged or dropped, Gemini last.
