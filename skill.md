# x402-recurring — agent skill

Standing orders for agents. This service issues signed **mandate documents** (what task to run, how often, at what price per run, within what budget) and executes paid runs against them. Creating a mandate is free; every execution is paid per run via x402, and the run report — the purchased artifact — comes back in the same 200 response. There are no server-side pulls and no subscriptions: your client-side scheduler decides when to pay for the next run, and cancelling means simply not paying again.

**Base URL**: `{BASE_URL}` (self-hosted; e.g. `http://localhost:4021`)

## Endpoints

### POST /mandates — free
Create a signed mandate document (task, cadence, price per run, budget, expiry).

Request body:
```json
{
  "task": {
    "type": "heartbeat",
    "params": {
      "label": "nightly liveness"
    }
  },
  "cadence": {
    "everySeconds": 3600
  },
  "pricePerRun": "$0.005",
  "maxRuns": 10,
  "validDays": 30,
  "payer": "0xYourAgentWallet"
}
```

`pricePerRun` is clamped to `[$0.001, MAX_RUN_PRICE]` (default max `$0.10`). `payer` is free-form — an EVM address or a Solana pubkey both work.

Response `201`:
```json
{
  "mandateId": "mnd_9f0c2b41-3f2a-4d1e-9a77-0b5a1c3e77aa",
  "document": "x402-recurring/mandate",
  "task": {
    "type": "heartbeat",
    "params": {
      "label": "nightly liveness"
    }
  },
  "cadence": {
    "everySeconds": 3600
  },
  "pricePerRun": "$0.005",
  "maxRuns": 10,
  "payer": "0xAgentWalletOrSolanaPubkey",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "expiresAt": "2026-01-31T00:00:00.000Z",
  "status": "active",
  "runsCompleted": 0,
  "signature": "3f8a…hex hmac…",
  "algorithm": "HMAC-SHA256"
}
```

### POST /execute/:mandateId — $0.005 (per mandate — its own `pricePerRun`)
Execute one run of a mandate and return the signed run report.

Request body:
```json
{
  "payload": {
    "any": "json",
    "used_by": "the digest task"
  }
}
```

Response `200`:
```json
{
  "runId": "run_1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "document": "x402-recurring/run-report",
  "mandateId": "mnd_9f0c2b41-3f2a-4d1e-9a77-0b5a1c3e77aa",
  "runNumber": 3,
  "executedAt": "2026-01-03T00:00:00.000Z",
  "charged": "$0.005",
  "budget": {
    "maxRuns": 10,
    "runsCompleted": 3,
    "remainingRuns": 7
  },
  "artifact": {
    "taskType": "heartbeat",
    "alive": true,
    "serverTime": "2026-01-03T00:00:00.000Z",
    "serverUptimeSeconds": 8421,
    "label": "nightly liveness"
  },
  "signature": "9c1d…hex hmac…",
  "algorithm": "HMAC-SHA256",
  "payment": {
    "rail": "evm",
    "network": "base-sepolia",
    "transaction": "0xabc…",
    "payer": "0xPayer…",
    "amount": "5000"
  }
}
```

Task artifacts: `heartbeat` → liveness snapshot; `counter` → run-count progress; `digest` → sha256 + stats of the posted `payload`. The 402 quotes the mandate's exact `pricePerRun`, so the price you see is the price of this specific run.

### GET /mandates/:id — free
Current mandate document including status and runs completed.

Response `200`:
```json
{
  "mandateId": "mnd_9f0c2b41-3f2a-4d1e-9a77-0b5a1c3e77aa",
  "document": "x402-recurring/mandate",
  "task": {
    "type": "heartbeat",
    "params": {
      "label": "nightly liveness"
    }
  },
  "cadence": {
    "everySeconds": 3600
  },
  "pricePerRun": "$0.005",
  "maxRuns": 10,
  "payer": "0xAgentWalletOrSolanaPubkey",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "expiresAt": "2026-01-31T00:00:00.000Z",
  "status": "active",
  "runsCompleted": 3,
  "signature": "3f8a…hex hmac…",
  "algorithm": "HMAC-SHA256"
}
```

### GET /mandates — free
Summaries of every mandate this instance has issued.

Response `200`:
```json
{
  "mandates": [
    {
      "mandateId": "mnd_9f0c2b41-3f2a-4d1e-9a77-0b5a1c3e77aa",
      "status": "active",
      "pricePerRun": "$0.005",
      "runsCompleted": 3,
      "maxRuns": 10
    }
  ]
}
```

### POST /verify — free
Verify the HMAC-SHA256 signature of any artifact issued by this service.

Request body:
```json
{
  "mandateId": "mnd_9f0c2b41-3f2a-4d1e-9a77-0b5a1c3e77aa",
  "document": "x402-recurring/mandate",
  "task": {
    "type": "heartbeat",
    "params": {
      "label": "nightly liveness"
    }
  },
  "cadence": {
    "everySeconds": 3600
  },
  "pricePerRun": "$0.005",
  "maxRuns": 10,
  "payer": "0xAgentWalletOrSolanaPubkey",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "expiresAt": "2026-01-31T00:00:00.000Z",
  "status": "active",
  "runsCompleted": 0,
  "signature": "3f8a…hex hmac…",
  "algorithm": "HMAC-SHA256"
}
```

Response `200`:
```json
{
  "valid": true
}
```

### GET /health — free
Liveness probe.

Response `200`:
```json
{
  "ok": true,
  "service": "x402-recurring"
}
```

## Payment — dual rail

**Pay in USDC on Base or Solana — your client picks the rail.**

Every paid route answers an unpaid request with `402` and an `accepts` array
holding both rails:

```json
{
  "x402Version": 1,
  "accepts": [
    { "scheme": "exact", "network": "base-sepolia", "asset": "USDC (0x036CbD53842c5426634e7929541eC2318f3dCF7e)",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402", "maxAmountRequired": "<base units, 6 decimals>" },
    { "scheme": "exact", "network": "solana-devnet", "asset": "USDC (4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU)",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW", "maxAmountRequired": "<base units, 6 decimals>",
      "extra": { "feePayer": "<facilitator sponsor>" } }
  ]
}
```

- Protocol: **x402** (HTTP 402). Asset **USDC** on both rails.
- EVM networks: `base-sepolia` (default) or `base` (`NETWORK=base`).
- Solana networks: `solana-devnet` (default) or `solana` (`SOLANA_NETWORK=mainnet-beta`).
- Facilitator: `https://x402.org/facilitator` — verifies and settles **both** rails (override with `FACILITATOR_URL`).
- Pay via `x402-fetch` (EVM), a Solana x402 client, or any x402-capable client: call the route, read `402`, pick an entry from `accepts`, sign, retry with the `X-PAYMENT` header. You get the artifact in the `200` body plus an `X-PAYMENT-RESPONSE` header carrying the settlement receipt (`{ rail, network, transaction, payer }`).

## Error codes

| Status | Code | Meaning |
|---|---|---|
| 402 | — | Payment required — dual-rail x402 challenge with `accepts[]` |
| 404 | `MANDATE_NOT_FOUND` | Unknown mandateId (not charged) |
| 410 | `MANDATE_EXPIRED` | Mandate past `expiresAt` (not charged) |
| 410 | `MANDATE_EXHAUSTED` | All runs used (not charged) |
| 400 | `BAD_REQUEST` | Malformed body |

## Discovery

Machine-readable manifest: `{BASE_URL}/.well-known/x402` (lists both networks per resource).

## Contact

nichxbt@gmail.com
