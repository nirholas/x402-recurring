# Raw 402 → pay → 200 walkthrough (curl)

Start the server:

```bash
npm run dev
```

## 1. Create a mandate (free)

```bash
curl -s -X POST http://localhost:4021/mandates \
  -H 'content-type: application/json' \
  -d '{"task":{"type":"heartbeat"},"cadence":{"everySeconds":60},"pricePerRun":"$0.005","maxRuns":5,"payer":"0xAgent"}' | jq
```

Note the `mandateId` (e.g. `mnd_…`) in the signed mandate document.

## 2. Hit the paid route without payment → dual-rail 402

```bash
curl -s -i -X POST http://localhost:4021/execute/mnd_YOUR_ID \
  -H 'content-type: application/json' -d '{}'
```

`HTTP/1.1 402 Payment Required`, with **two** entries in `accepts` — one per rail:

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "5000",
      "resource": "http://localhost:4021/execute/mnd_…",
      "description": "Execute one run of mandate mnd_… (heartbeat)",
      "mimeType": "application/json",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "maxTimeoutSeconds": 120,
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": { "name": "USDC", "version": "2" }
    },
    {
      "scheme": "exact",
      "network": "solana-devnet",
      "maxAmountRequired": "5000",
      "resource": "http://localhost:4021/execute/mnd_…",
      "description": "Execute one run of mandate mnd_… (heartbeat)",
      "mimeType": "application/json",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "maxTimeoutSeconds": 120,
      "asset": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      "extra": { "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4" }
    }
  ]
}
```

`maxAmountRequired` is in USDC base units (6 decimals): `5000` = $0.005.
Pick either entry — the server accepts both.

## 3. Pay and retry

Building the `X-PAYMENT` header by hand means signing an EIP-3009
`transferWithAuthorization` (EVM) or a serialized SPL transfer (Solana). Use a
client instead:

```bash
PRIVATE_KEY=0x... npm run client      # one paid run, EVM rail
PRIVATE_KEY=0x... npm run scheduler   # recurring paid runs on the cadence
```

The retried request returns `200` with the signed run report in the body and an
`X-PAYMENT-RESPONSE` header carrying the settlement receipt:

```bash
# decode it
node -e 'console.log(JSON.parse(Buffer.from(process.argv[1],"base64").toString()))' "$HEADER"
# { success: true, rail: 'evm', network: 'base-sepolia', transaction: '0x…', payer: '0x…' }
```

## 4. Check mandate state and verify the artifact (free)

```bash
curl -s http://localhost:4021/mandates/mnd_YOUR_ID | jq '.status, .runsCompleted'
curl -s -X POST http://localhost:4021/verify \
  -H 'content-type: application/json' -d @report.json | jq
```
