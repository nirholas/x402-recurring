# API reference — x402-recurring

Base URL: `http://localhost:4021` in development.

All paid routes speak **x402** and offer **two rails** — USDC on Base (EVM) and
USDC on Solana. The 402 challenge lists both; your client picks one. The
purchased artifact is always in the `200` body.

| Route | Price | Returns |
|---|---|---|
| `POST /mandates` | free | Signed mandate document |
| `POST /execute/:mandateId` | $0.005 (per mandate — its own `pricePerRun`) | Signed run report: run number, budget state, and the task artifact |
| `GET /mandates/:id` | free | Mandate status snapshot |
| `GET /mandates` | free | Mandate summaries |
| `POST /verify` | free | `{ valid: true | false }` |
| `GET /health` | free | `{ ok: true }` |

Every artifact is signed: `signature` is an HMAC-SHA256 (hex) over the
canonical JSON of the artifact minus `signature`/`algorithm`, keyed by
`SIGNING_SECRET`. `POST /verify` re-checks it for free.

---

## POST /mandates

**Price**: free  
**Returns**: Signed mandate document

Create a signed mandate document (task, cadence, price per run, budget, expiry).

### Body parameters

| Name | Type | Default | Description |
|---|---|---|---|
| `task.type` | `heartbeat`\|`counter`\|`digest` | `heartbeat` | Which built-in task the mandate runs |
| `task.params` | object | `{}` | Recorded verbatim in the signed mandate (e.g. a label) |
| `cadence.everySeconds` | integer | 3600 | Suggested gap between runs — enforced by the client scheduler |
| `pricePerRun` | string | `$0.005` | Price charged per execution, clamped by `MAX_RUN_PRICE` |
| `maxRuns` | integer | 10 | Hard budget: runs allowed before the mandate is exhausted |
| `validDays` | integer | 30 | Days until `expiresAt` |
| `payer` | string | `unspecified` | Wallet the mandate is issued for (EVM address or Solana pubkey) |

### Example request

```bash
curl -s -X POST http://localhost:4021/mandates \
  -H 'content-type: application/json' \
  -d '{"task":{"type":"heartbeat"},"cadence":{"everySeconds":3600},"pricePerRun":"$0.005","maxRuns":10}'
```

### Example response (`201`)

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

---

## POST /execute/:mandateId

**Price**: $0.005 (per mandate — its own `pricePerRun`) — USDC on Base or Solana  
**Returns**: Signed run report: run number, budget state, and the task artifact

Execute one run of a mandate and return the signed run report.

### Path parameters

| Name | Description |
|---|---|
| `mandateId` | The `mandateId` from `POST /mandates` |

### Example request

```bash
# unpaid → 402 with both rails
curl -s -i -X POST http://localhost:4021/execute/mnd_YOUR_ID -H 'content-type: application/json' -d '{}'

# paid (EVM rail)
PRIVATE_KEY=0x... npm run client
```

### Example response (`200`)

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
  "settlement": {
    "rail": "evm",
    "network": "base-sepolia",
    "transaction": "0xabc…",
    "payer": "0xPayer…",
    "amount": "5000"
  }
}
```

### Unpaid (`402`)

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "5000",
      "resource": "http://localhost:4021/execute/:mandateId",
      "description": "Execute one run of a mandate and return the signed run report.",
      "mimeType": "application/json",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "maxTimeoutSeconds": 120,
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": {
        "name": "USDC",
        "version": "2"
      }
    },
    {
      "scheme": "exact",
      "network": "solana-devnet",
      "maxAmountRequired": "5000",
      "resource": "http://localhost:4021/execute/:mandateId",
      "description": "Execute one run of a mandate and return the signed run report.",
      "mimeType": "application/json",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "maxTimeoutSeconds": 120,
      "asset": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      "extra": {
        "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4"
      }
    }
  ]
}
```

### Errors

| Status | Code | Meaning |
|---|---|---|
| 404 | `MANDATE_NOT_FOUND` | Unknown mandateId |
| 410 | `MANDATE_EXPIRED` | Mandate past its expiry |
| 410 | `MANDATE_EXHAUSTED` | All runs used |

The 402 challenge is returned before the mandate is looked up — the route can be
priced and discovered without owning a mandate — which also means payment settles
before the run is attempted. Payment settles before the run is attempted, so check the mandate with the free `GET /mandates/:id` first.

---

## GET /mandates/:id

**Price**: free  
**Returns**: Mandate status snapshot

Current mandate document including status and runs completed.

### Path parameters

| Name | Description |
|---|---|
| `id` | The mandateId |

### Example request

```bash
curl -s http://localhost:4021/mandates/mnd_YOUR_ID
```

### Example response (`200`)

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

### Errors

| Status | Code | Meaning |
|---|---|---|
| 404 | `MANDATE_NOT_FOUND` | Unknown mandateId |

---

## GET /mandates

**Price**: free  
**Returns**: Mandate summaries

Summaries of every mandate this instance has issued.

### Example request

```bash
curl -s http://localhost:4021/mandates
```

### Example response (`200`)

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

---

## POST /verify

**Price**: free  
**Returns**: `{ valid: true | false }`

Verify the HMAC-SHA256 signature of any artifact issued by this service.

### Example request

```bash
curl -s -X POST http://localhost:4021/verify -H 'content-type: application/json' -d @report.json
```

### Example response (`200`)

```json
{
  "valid": true
}
```

---

## GET /health

**Price**: free  
**Returns**: `{ ok: true }`

Liveness probe.

### Example request

```bash
curl -s http://localhost:4021/health
```

### Example response (`200`)

```json
{
  "ok": true,
  "service": "x402-recurring"
}
```


---

## Payment headers

| Header | Direction | Meaning |
|---|---|---|
| `X-PAYMENT` | request | Base64 x402 payload. EVM: signed EIP-3009 authorization. Solana: signed serialized transaction. |
| `X-PAYMENT-RESPONSE` | response | Base64 `{ success, rail, network, transaction, payer }` settlement receipt. |

Paid responses also echo that receipt in the body under `settlement`, purely for
convenience. It is attached **after** the artifact is signed and is excluded from
signature verification, so you can post a whole paid response body straight to
`POST /verify` and still get `{ "valid": true }`.

## Global error shape

```json
{ "error": "CODE", "message": "human readable explanation" }
```
