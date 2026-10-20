# x402 rehearsal (local, testnet, no money)

Proves the payment gate end to end with the OFFICIAL x402 client (`@x402/core`, `@x402/evm`): free allowance, 402 reply, payment built by the client, verified, answered, settled. Nothing here touches a real wallet or a real facilitator: the pay-to address is a public dummy, the paying key is made fresh in memory, and a local mock facilitator checks the EIP-3009 signature itself.

This folder is NOT part of the app build (its own package.json; the app does not import it).

```
# 1. once: npm ci && (cd scripts/x402-rehearsal && npm i)
# 2. dump the Canadian rent fixture (so a paid call can return a real answer without reaching statcan.gc.ca)
npx tsx -e 'import {RENT_META,RENT_DATA} from "./sources/ca-cmhc-rents/fixtures"; require("fs").writeFileSync("/tmp/fx.json", JSON.stringify({meta:RENT_META,data:RENT_DATA}))'
# 3. start the app with the gate on (testnet, dummy pay-to, mock facilitator on :3112)
FIXTURE_JSON=/tmp/fx.json NODE_OPTIONS="--require $PWD/scripts/x402-rehearsal/fixture-preload.cjs" \
PROOFPRICE_X402_ENABLED=true PROOFPRICE_X402_PAY_TO=0x000000000000000000000000000000000000dEaD \
PROOFPRICE_X402_NETWORK=base-sepolia PROOFPRICE_X402_FACILITATOR_URL=http://localhost:3112 npx next dev -p 3111
# 4. in another shell (restart the app between runs: the free allowance lives in its memory)
cd scripts/x402-rehearsal && node rehearse.mjs
```
