# ProofPrice

**What did people actually pay for X, here, recently?** ProofPrice answers that one question for AI agents: a price range (median, 10th–90th percentile), sample size, period, confidence, source and licence, built from official open data.

- Live: https://proofprice.com
- Ready answers for people and crawlers: https://proofprice.com/prices
- MCP server (Streamable HTTP, no key, no sign-in): `https://proofprice.com/api/mcp`
- REST API: `https://proofprice.com/api/v1/<category>` ([openapi.json](https://proofprice.com/openapi.json), [llms.txt](https://proofprice.com/llms.txt))

## The promise

- **Official data only.** Official open data, licensed data or partner data. Nothing scraped against a site's terms.
- **Aggregates only.** No figure comes from fewer than 5 records and no individual's home or purchase is shown.
- **Licence on every answer.** Each answer carries its source, attribution, licence and a price type, so asking prices, posted prices and official averages are never passed off as paid prices.
- Information, not a valuation or advice.

## Tools (16)

| Tool | Answers |
| --- | --- |
| `pricepaid_home_sales` | What homes actually sold for in a town or area |
| `pricepaid_rent_prices` | Rents tenants actually pay or have agreed |
| `pricepaid_fuel_prices_now` | Current pump prices near a place |
| `pricepaid_energy_prices` | Household electricity and gas prices |
| `pricepaid_grocery_prices` | Grocery and everyday prices (milk, bread, eggs, ...) |
| `pricepaid_farm_prices` | Farm and wholesale food prices |
| `pricepaid_land_prices` | Farmland prices and rents |
| `pricepaid_car_prices` | Car-related prices actually paid |
| `pricepaid_airfare_prices` | Airfares paid |
| `pricepaid_broadband_prices` | Mobile and broadband prices |
| `pricepaid_childcare_prices` | Childcare fees |
| `pricepaid_medical_prices` | Doctor and hospital prices paid |
| `pricepaid_medicine_prices` | Official pharmacy prices of medicines |
| `pricepaid_contract_prices` | What public buyers paid in government contracts |
| `pricepaid_check_price` | Check a proposed price against the recorded evidence |
| `pricepaid_coverage` | What is covered: countries, categories, sources |

A history tool appears automatically once the price library holds enough days of data. Coverage grows as sources are added; call `pricepaid_coverage` for the current list.

## Connect

**Claude (claude.ai / desktop):** Customize > Connectors > Add custom connector > `https://proofprice.com/api/mcp` (no sign-in).

**Claude Code:**

```bash
claude mcp add --transport http proofprice https://proofprice.com/api/mcp
```

**Cursor** (`.cursor/mcp.json`):

```json
{ "mcpServers": { "proofprice": { "url": "https://proofprice.com/api/mcp" } } }
```

**VS Code / GitHub Copilot** (`.vscode/mcp.json`):

```json
{ "servers": { "proofprice": { "type": "http", "url": "https://proofprice.com/api/mcp" } } }
```

**curl:**

```bash
curl "https://proofprice.com/api/v1/home-sales?country=IE&town=Dublin&property_type=second-hand"
```

More clients (ChatGPT, Windsurf, OpenAI and other SDKs): https://proofprice.com/connect

## Agent skill

[`skills/proofprice/SKILL.md`](skills/proofprice/SKILL.md) tells an agent when to call ProofPrice and how to cite the answer.

## Develop

```bash
npm ci && npm test && npm run typecheck && npm run build
```

One folder per data source in `sources/<id>/`, one folder per category in `categories/<id>/`; the registry builds the tools, REST routes, coverage, OpenAPI and `llms.txt` from them. See `CLAUDE.md` and `sources/_template/README.md`.

## Licence

Code: [MIT](LICENSE). Data: each source's own licence, stated on every answer.

Contact: hello@proofprice.com
