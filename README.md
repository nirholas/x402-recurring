# x402-recurring

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![x402](https://img.shields.io/badge/payments-x402-0052ff.svg)](https://x402.org)
[![USDC on Base + Solana](https://img.shields.io/badge/USDC-Base%20%2B%20Solana-0052ff.svg)](https://x402.org)

**standing orders for agents** — Signed mandate documents plus a client-side scheduler that pays per run over x402 and collects signed run reports. No subscriptions, no stored cards, no server-side pulls.

## Why x402 for this

Recurring billing normally means handing a merchant pull-access to your money (cards, direct debit) and hoping cancellation works. With x402 the recurrence inverts: the **payer's** scheduler initiates every run with a per-request USDC micropayment, so the budget cap is enforced by not paying again. Each run returns its signed report in the same response — pay, get artifact, done.

## Pay in USDC on Base **or** Solana — your client picks the rail

Every paid route answers an unpaid request with a 402 whose `accepts` array
carries both rails:

| Rail | Networks | Asset | payTo |
|---|---|---|---|
| EVM | `base-sepolia` (default) · `base` | USDC | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` |
| Solana | `solana-devnet` (default) · `solana` | USDC | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` |

Both are verified and settled through the same facilitator
(`https://x402.org/facilitator`). On Solana, `extra.feePayer` is the
facilitator's sponsor account, so a payer needs only USDC — never SOL for gas.

## Quickstart

```bash
git clone https://github.com/nirholas/x402-recurring && cd x402-recurring
npm install
cp .env.example .env       # optional — every value has a working default
npm run dev

# in another terminal, the full paid flow on the EVM rail:
PRIVATE_KEY=0xYourFundedBaseSepoliaKey npm run client
```

```bash
# recurring paid runs on the mandate's cadence:
PRIVATE_KEY=0xYourFundedBaseSepoliaKey npm run scheduler
```

## API

| Route | Price | What you get back |
|---|---|---|
| `POST /mandates` | free | Signed mandate document |
| `POST /execute/:mandateId` | $0.005 (per mandate — its own `pricePerRun`) | Signed run report: run number, budget state, and the task artifact |
| `GET /mandates/:id` | free | Mandate status snapshot |
| `GET /mandates` | free | Mandate summaries |
| `POST /verify` | free | `{ valid: true | false }` |
| `GET /health` | free | `{ ok: true }` |
| `GET /.well-known/x402` | free | Machine-readable discovery manifest |

Built-in self-contained tasks: `heartbeat` (liveness snapshot), `counter` (progress across runs), `digest` (sha256 + stats of a posted payload).

## How x402 works here

1. Call a paid route with no payment → **402** with `accepts[]` quoting the exact price on **both** rails.
2. Your client picks a rail and signs: EIP-3009 `transferWithAuthorization` (EVM) or a serialized SPL transfer (Solana).
3. Retry with the `X-PAYMENT` header. The facilitator verifies and settles.
4. The server returns **the artifact in the 200 body**, plus `X-PAYMENT-RESPONSE` carrying `{ rail, network, transaction, payer }`.

Mainnet: `NETWORK=base`, `SOLANA_NETWORK=mainnet-beta`, and a mainnet-capable `FACILITATOR_URL`.

## Real backend / API keys

Fully self-contained — **no external APIs and no API keys**. State is file-based (`data/mandates.json`) and the built-in tasks compute their results locally.
Artifacts are signed with HMAC-SHA256 using `SIGNING_SECRET`; the dev default
(`dev-secret-change-me`) is public, so set your own in production.

## For AI agents

- **skill.md**: [skill.md](skill.md) — agent-facing endpoints, prices, schemas, error codes.
- **Discovery manifest**: [`/.well-known/x402`](public/.well-known/x402), served live by the app, listing **both networks per resource** — indexable by [x402scan.com](https://x402scan.com), the x402 Bazaar, and [agentic.market](https://agentic.market). List your deployment there so paying agents can find it.
- **MCP**: [examples/mcp-tool.md](examples/mcp-tool.md) — wrap these routes as MCP tools for Claude.
- **Raw flow**: [examples/curl.md](examples/curl.md) — the 402 → pay → 200 walkthrough by hand.

## Docs

Full docs on GitHub Pages: **https://nirholas.github.io/x402-recurring/** — [tutorial](docs/tutorial.md) · [API reference](docs/api.md) · [for agents](docs/agents.md)

Part of the [x402 Suite](https://github.com/nirholas/x402-suite).

## Support

nichxbt@gmail.com

## License

[Apache-2.0](LICENSE)
