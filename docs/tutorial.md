# Tutorial — x402-recurring

A complete walkthrough: install, run the server, trigger a real 402, pay it on
either rail, and read the artifact you bought.

## 1. Install

```bash
git clone https://github.com/nirholas/x402-recurring
cd x402-recurring
npm install
```

Node 18 or newer.

## 2. Configure

```bash
cp .env.example .env
```

Everything already has a working default, so you can skip straight to step 3.
The variables that matter:

| Variable | Default | What it does |
|---|---|---|
| `PAY_TO_ADDRESS` | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` | EVM address paid on the Base rail |
| `SOLANA_PAY_TO_ADDRESS` | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` | Solana pubkey paid on the Solana rail |
| `NETWORK` | `base-sepolia` | `base` for EVM mainnet |
| `SOLANA_NETWORK` | `devnet` | `mainnet-beta` for Solana mainnet |
| `FACILITATOR_URL` | `https://x402.org/facilitator` | Verifies + settles the **EVM** rail |
| `SOLANA_FACILITATOR_URL` | `https://facilitator.payai.network` | Verifies + settles the **Solana** rail |
| `SIGNING_SECRET` | `dev-secret-change-me` | HMAC key for signed artifacts — change it |
| `PORT` | `4021` | HTTP port |

> The two `payTo` values above are the suite's own public receive addresses.
> **Set your own** if you want to be paid.

## 3. Run the server

```bash
npm run dev
```

The banner prints both rails:

```
x402-recurring listening on http://localhost:4021
  Pay in USDC on Base or Solana — your client picks the rail.
  rail 1  EVM     network=base-sepolia  payTo=0x40252CFDF8B20Ed757D61ff157719F33Ec332402
                  facilitator=https://x402.org/facilitator
  rail 2  Solana  network=solana-devnet  payTo=WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW
                  facilitator=https://facilitator.payai.network
```

## 4. Your first 402

Create a mandate first — that part is free:

```bash
curl -s -X POST http://localhost:4021/mandates \
  -H 'content-type: application/json' \
  -d '{"task":{"type":"counter"},"cadence":{"everySeconds":60},"pricePerRun":"$0.005","maxRuns":5}'
```

Take the `mandateId` from the signed document and call the paid route with no payment:

```bash
curl -s -i -X POST http://localhost:4021/execute/mnd_YOUR_ID \
  -H 'content-type: application/json' -d '{}'
```

You get `HTTP/1.1 402 Payment Required` and a body whose `accepts` array holds
**two** entries — one per rail. `maxAmountRequired` is in USDC base units
(6 decimals), so `1000` = $0.001.

## 5. Pay it

### EVM rail (`x402-fetch`)

```bash
PRIVATE_KEY=0xYourFundedBaseSepoliaKey npm run client
```

`x402-fetch` reads the 402, picks the `base-sepolia` entry, signs an EIP-3009
`transferWithAuthorization` for exactly `maxAmountRequired`, and retries with
the `X-PAYMENT` header. Get testnet USDC from the
[Circle faucet](https://faucet.circle.com/).

### Solana rail

Point any x402 Solana client at the same URL — it picks the `solana-devnet`
entry instead. Browser wallets (Phantom) go through the drop-in
[`@three-ws/x402-payment-modal`](https://www.npmjs.com/package/@three-ws/x402-payment-modal),
which reads the same 402 and handles the prepare/sign/encode round trip.

Note that the two rails use **different facilitators**. `https://x402.org/facilitator`
settles Base; Solana settlement goes to `SOLANA_FACILITATOR_URL`
(`https://facilitator.payai.network` by default). The server picks the right one
from the rail the payment arrived on. To check whether a facilitator handles a
network, ask it:

```bash
curl -s https://facilitator.payai.network/supported | jq '.kinds[] | select(.network | startswith("solana"))'
```

## 6. Read the artifact

The `200` body **is** the thing you bought — signed run report: run number, budget state, and the task artifact.
No callbacks, no polling for a later delivery.

The response also carries `X-PAYMENT-RESPONSE`, a base64 JSON receipt:

```json
{ "success": true, "rail": "evm", "network": "base-sepolia", "transaction": "0x…", "payer": "0x…" }
```

Every artifact is signed with HMAC-SHA256 over its canonical JSON. Check one:

```bash
curl -s -X POST http://localhost:4021/verify \
  -H 'content-type: application/json' -d @artifact.json
# {"valid":true}
```

## 7. Going to mainnet

```bash
NETWORK=base \
SOLANA_NETWORK=mainnet-beta \
PAY_TO_ADDRESS=0xYourRealAddress \
SOLANA_PAY_TO_ADDRESS=YourRealSolanaPubkey \
FACILITATOR_URL=https://your-mainnet-evm-facilitator \
SOLANA_FACILITATOR_URL=https://facilitator.payai.network \
SIGNING_SECRET=$(openssl rand -hex 32) \
npm run build && npm start
```

Mainnet USDC is real money: use mainnet-capable facilitators on **both** rails
(Coinbase CDP's for Base, for example; PayAI already lists `solana` mainnet),
set a real `SIGNING_SECRET`, and put the service behind TLS so the `resource`
URL in the 402 challenge matches what clients actually call.

## 8. Running the scheduler

`examples/scheduler.ts` is the client-side half of a standing order: it reads a
mandate's cadence and pays for one run per tick until the budget is exhausted.

```bash
PRIVATE_KEY=0x... RUNS=3 INTERVAL_SECONDS=10 npm run scheduler
```

That loop is deliberately on the client. Anything that pulls money on a
schedule from the server side is exactly what x402 removes.


## Next

- [API reference](api.md) — every route, schema and error
- [For AI agents](agents.md) — discovery, MCP, listing
- [skill.md](https://github.com/nirholas/x402-recurring/blob/main/skill.md) — the agent-facing contract
