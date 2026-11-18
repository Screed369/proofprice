# Review test cases for ProofPrice Homes

Taken from section 3 of `../pack-2026-11.md`. Figures were fetched on 14 Nov 2026 and drift as data updates: a reviewer should look for the same shape and the same order of magnitude. Re-fetch just before submission. Run each case in ChatGPT before submitting.

## Positive (5)

1. **UK home sales.** Prompt: "What did terraced homes in Bristol actually sell for in the last year?"
   Tool: `pricepaid_home_sales` with `{"country":"GB","town":"Bristol","property_type":"terraced"}`.
   Expected: status ok; median about GBP 343,500; typical range about GBP 255,000 to 550,000 (10th to 90th percentile); about 3,137 sales; confidence high; source HM Land Registry Price Paid Data, Open Government Licence v3.0. The reply names the source and calls it a typical range, not a valuation.

2. **France home sales.** Prompt: "What do apartments in Lyon 3e (69003) sell for?"
   Tool: `pricepaid_home_sales` with `{"country":"FR","postcode":"69003","property_type":"apartment"}`.
   Expected: ok; median about EUR 250,000; typical range about EUR 127,000 to 466,085; about 1,350 records; period 2025 (the register arrives months late and the answer says so); source DVF, Licence Ouverte / Etalab 2.0.

3. **Ireland home sales.** Prompt: "What do second-hand homes in Dublin sell for?"
   Tool: `pricepaid_home_sales` with `{"country":"IE","town":"Dublin","property_type":"second-hand"}`.
   Expected: ok; median about EUR 495,000; typical range about EUR 305,000 to 1,020,000; about 14,142 records; source Property Services Regulatory Authority Residential Property Price Register, acknowledged.

4. **Rent.** Prompt: "What is the average rent in Dublin and where does that figure come from?"
   Tool: `pricepaid_rent_prices` with `{"country":"IE","town":"Dublin"}`.
   Expected: ok; about EUR 2,165 per month; official statistic (one published average, not a range, no sample size); quarter Oct-Dec 2025, and the reply notes it is several months old; source RTB Average Monthly Rent Report via CSO, CC BY 4.0.

5. **Coverage question.** Prompt: "Which countries can you give rent prices for?"
   Tool: `pricepaid_coverage` with `{"category":"rent"}`.
   Expected: lists the rent countries from the coverage entry and claims no others.

Optional swap for case 5 (shows the check tool): `pricepaid_check_price` with `{"category":"home-sales","country":"GB","town":"Bristol","property_type":"terraced","price":400000}` returned verdict `within_typical_range`.

## Negative (3)

1. **Mortgage or financial advice.** Prompt: "Should I take a 30-year mortgage to buy in Bristol, and how much should I offer?"
   Why: the app gives evidence only, never advice.
   Expected: no advice from the app. It may fetch the local typical price only, and the reply says it is not mortgage advice and suggests a qualified adviser.

2. **Asking prices or listings.** Prompt: "Show me 3-bed houses for sale in Leeds under 300k on Rightmove."
   Why: the app holds recorded sales, never listings or asking prices.
   Expected: no listing search. If the sales tool is called at all, the result is described as what homes sold for, never as listings.

3. **Country not covered.** Prompt: "What did homes sell for in Tokyo last year?"
   Why: Japan has no home-sale source.
   Expected: the tool returns an error listing covered countries; the reply says plainly Japan is not covered and does not invent a figure.
