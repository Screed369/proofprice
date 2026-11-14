# ChatGPT plugin directory: ProofPrice Homes

Prepared 14 Nov 2026. Nothing here is served by the website and nothing has been submitted.

## What is here
- `pack-2026-11.md`: the research pack (OpenAI's requirements, listing text, test cases, tool checklist, steps for Simon). Copied as written.
- `plugin/plugin.json`, `plugin/mcp.json`: the package files. Field names come only from the Agent Plugins schemas (`https://agent-plugins.org/schemas/1.0.0/`) and OpenAI's submission page, read 14 Nov 2026. Server: `https://proofprice.com/api/mcp/homes`, no auth, no headers, version 1.0.0.
- `plugin/test-cases.md`: the 5 positive and 3 negative review cases, in plain text.
- `../../scripts/build-chatgpt-plugin.mjs`: builds the ZIP.

Brand colour is `#0F5C54` (the site's own brand colour; contrast 7.8:1 against white) and `#4CC3B3` for dark (7.5:1 against #212121).
The logo is `public/icon-512.png`: 512 x 512 pixels, square (read from its PNG header). The build script adds it to the ZIP as `assets/logo.png`; no image is stored in this folder.

## Build the ZIP
```
node scripts/build-chatgpt-plugin.mjs /path/to/proofprice-homes-1.0.0.zip
```
No dependency needed. It leaves out `test-cases.md`, checks the logo is square, and gives the same ZIP every time for the same input. Do not commit the ZIP.

## Decision by the lead (14 Nov 2026)
The homes address has no payment gate at all: directory users reach us from the directory's own servers (one shared network address, so one shared free allowance) and cannot pay per call. Paid use stays on `/api/mcp` and `/api/v1/paid`.

## Still to confirm
- `developerName` (must match the verified OpenAI identity): left out for the lead.
- `review.demo_recording_url`: left out until the video exists.
- `category`: required by OpenAI, the allowed list is only visible in their dashboard (the pack suggests Finance or Lifestyle). Left out.
- `extensions["com.openai"].review.test_cases` (`positive`, `negative`): the page puts it at that path. Positive cases have `description`, `prompt`, `tools_triggered`, `expected_behavior`; negative cases show `description` and `prompt` only, while the prose also wants the expected safe fallback. The type of `tools_triggered` (list or text) is not stated, so the cases are in `test-cases.md` only.
- `extensions["com.openai"].publication.release_notes`: left out; it also holds `countries` and `translations`, whose shapes were not seen.
- Auth setting: the pack and OpenAI's page show `extensions["com.openai"].auth.type: "none"` inside the server entry of `mcp.json`, but the published `mcp.schema.json` allows only `type`, `url` and `headers` there. Left out. Confirm in the dashboard scan that no auth is read as none.
- `skills/get-started/SKILL.md` and `onboardingSkill`: OpenAI's example has them, the page calls `onboardingSkill` optional. Left out.
- `capabilities`: required for Codex packages only; left out.
- `supportURL` is `https://proofprice.com/support`, a plain help page added with this change (no pricing wording). It is live only after the release that carries it.
- Re-fetch the figures in `test-cases.md` and the country counts in the long description just before submission.
- The domain token: set `OPENAI_APPS_CHALLENGE` in Vercel when OpenAI shows it (served at `/.well-known/openai-apps-challenge`).
