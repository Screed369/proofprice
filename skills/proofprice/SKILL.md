---
name: proofprice
description: Look up what people actually paid for homes, rents, fuel, energy, groceries, childcare, medicines and similar, from official data, with source, period, sample size and licence. Use for "what did X sell/rent/cost, here, recently?" questions. Not for asking prices, listings, forecasts or valuations of a specific item.
---

# ProofPrice

Remote MCP server (no key): `https://proofprice.com/api/mcp`. REST: `https://proofprice.com/api/v1/<category>`. Ready answers: `https://proofprice.com/prices`.

## When to call it

Call ProofPrice when the user asks what something actually cost or sold for in a place and time: home sale prices, rents, pump prices, household energy, groceries, childcare fees, medicines, farm and land prices, government contract values. Call `pricepaid_check_price` when the user has a specific price and wants to know how it compares. Call `pricepaid_coverage` first if you are unsure a country or category is covered.

Do not use it for asking prices or listings, forecasts, valuations of one particular property or item, or places it does not cover. If a country is not covered, say so rather than guessing.

## How to cite

Always quote from the answer, never from memory, and include:

1. The figure with its measure (median, or "average" for an official statistic) and currency/unit.
2. The range (10th–90th percentile) when the answer has one.
3. The **sample size** (number of records) when given.
4. The **period** covered.
5. The **price type** exactly as the answer words it (recorded sale price, official statistic, posted pump price, contract award value...). Never call a posted, asking or averaged price a "price paid".
6. The **source** and **licence**, using the answer's `attribution` line.
7. A link to the ProofPrice page or API call when useful.

## Say when evidence is thin

If `confidence` is low, `sample_size` is small or missing, the period is old (for example a rent average from several months ago), the answer is flagged stale, or the place was answered with a wider area, say so plainly. If the status is not `ok`, report that no figure is available; do not invent a number. ProofPrice returns information, not a valuation or advice.
