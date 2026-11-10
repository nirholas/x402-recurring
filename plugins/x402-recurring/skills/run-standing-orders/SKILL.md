---
name: run-standing-orders
description: Create signed mandate documents for recurring paid agent tasks and execute paid runs against them over x402. Use when an agent needs a standing order with a per-run price, a run budget and signed run reports.
---

# x402-recurring standing orders

A mandate is a signed document: task, cadence, price per run, run budget, expiry. Creating one is free. Each run is a separate paid call, so the agent's own scheduler decides when to pay for the next run and cancelling means not paying again. Task types: `heartbeat` (liveness snapshot), `counter` (run-count progress), `digest` (sha256 and stats of the posted payload).

## Run the server

The repo is a self-hosted Express service. It is not published to npm, so run it from a clone.

```bash
git clone https://github.com/nirholas/x402-recurring && cd x402-recurring
npm install
cp .env.example .env   # optional: the defaults run out of the box
npm run dev            # listens on http://localhost:4021 (override with PORT)
```

Set `PAY_TO_ADDRESS` (Base) and `SOLANA_PAY_TO_ADDRESS` (Solana) in `.env` to receive payments yourself.
Other env vars in `.env.example`: `SIGNING_SECRET` (HMAC key for signed documents), `MAX_RUN_PRICE` (cap on `pricePerRun`, default $0.10), `DATA_DIR`.
`GET http://localhost:4021/.well-known/x402` lists every route with its price, and `GET /health` is the liveness probe.

## Routes

| Route | Price | Purpose |
|---|---|---|
| `POST /mandates` | free | Create a mandate. Body: `task` (`type`, `params`), `cadence` (`everySeconds`), `pricePerRun` (e.g. `"$0.005"`, clamped to $0.001 up to `MAX_RUN_PRICE`), `maxRuns`, `validDays`, `payer` (EVM address or Solana pubkey) |
| `GET /mandates` | free | Summaries of every mandate |
| `GET /mandates/:id` | free | One mandate with `status` and `runsCompleted` |
| `POST /execute/:mandateId` | the mandate's `pricePerRun` | Run once. Body `{"payload": {...}}`. Returns the signed run report |
| `POST /verify` | free | Check the HMAC-SHA256 signature of any document the service issued |

Errors: 404 `MANDATE_NOT_FOUND`, 410 `MANDATE_EXPIRED`, 410 `MANDATE_EXHAUSTED`. The 402 for `/execute` is returned before the mandate lookup, so check the mandate with the free `GET /mandates/:id` first.

The full request and response schemas are in `skill.md` at the repo root (the running server also serves it at `GET /skill.md`).

## Paying

Paid routes answer an unpaid request with HTTP 402 and an `accepts` array with one entry per rail (USDC on Base and USDC on Solana). A client picks an entry, signs, and retries with the `X-PAYMENT` header. The 200 body carries the artifact and an `X-PAYMENT-RESPONSE` header carries the settlement receipt. Any x402 client works (`x402-fetch` with `viem` on the EVM rail). Each paid call spends real USDC on whichever network the server is configured for (`NETWORK`, `SOLANA_NETWORK`), so show the user the route, price and network and get a yes before paying.

## Worked example

```bash
curl -s -X POST http://localhost:4021/mandates -H 'content-type: application/json' \
  -d '{"task":{"type":"heartbeat","params":{"label":"nightly"}},"cadence":{"everySeconds":3600},"pricePerRun":"$0.005","maxRuns":10,"validDays":30,"payer":"0xYourAgentWallet"}'
# note mandateId from the 201, then confirm it is active (free)
curl -s http://localhost:4021/mandates/<mandateId>
```

Then, after the user approves the $0.005 spend, pay `POST /execute/<mandateId>` with an x402 client. The repo ships `npm run scheduler` (`examples/scheduler.ts`) and `npm run client` (`examples/agent-client.ts`) as reference clients.
