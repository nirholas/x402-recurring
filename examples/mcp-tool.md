# Expose x402-recurring as an MCP tool

Give Claude (Desktop, Code, or any MCP client) direct access to this service.
The agent pays per call over x402 — on the Base rail with an EVM key, or on the
Solana rail with a Solana keypair.

## 1. A minimal MCP server

```ts
// mcp-x402-recurring.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "x402-fetch";

const BASE = process.env.RECURRING_URL ?? "http://localhost:4021";
const payFetch = wrapFetchWithPayment(
  fetch,
  privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`),
);

const server = new McpServer({ name: "x402-recurring", version: "0.1.0" });

server.tool(
  "create_mandate",
  "Create a free signed standing-order mandate: task, cadence, price per run, budget.",
  {
    task: z.enum(["heartbeat", "counter", "digest"]),
    everySeconds: z.number().default(3600),
    pricePerRun: z.string().default("$0.005"),
    maxRuns: z.number().default(10),
  },
  async ({ task, everySeconds, pricePerRun, maxRuns }) => {
    const res = await fetch(`${BASE}/mandates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: { type: task }, cadence: { everySeconds }, pricePerRun, maxRuns }),
    });
    return { content: [{ type: "text", text: JSON.stringify(await res.json(), null, 2) }] };
  },
);

server.tool(
  "execute_mandate",
  "Execute one paid run of a mandate. Costs the mandate's pricePerRun in USDC. Returns the signed run report.",
  { mandateId: z.string(), payload: z.any().optional() },
  async ({ mandateId, payload }) => {
    const res = await payFetch(`${BASE}/execute/${mandateId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload }),
    });
    return { content: [{ type: "text", text: JSON.stringify(await res.json(), null, 2) }] };
  },
);

await server.connect(new StdioServerTransport());
```

```bash
npm i @modelcontextprotocol/sdk zod viem x402-fetch
```

## 2. Register it with Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "x402-recurring": {
      "command": "npx",
      "args": ["-y", "tsx", "/absolute/path/to/mcp-x402-recurring.ts"],
      "env": {
        "PRIVATE_KEY": "0xYourFundedBaseSepoliaKey",
        "RECURRING_URL": "http://localhost:4021"
      }
    }
  }
}
```

For Claude Code: `claude mcp add x402-recurring -- npx -y tsx /absolute/path/to/mcp-x402-recurring.ts`

## 3. Paying on Solana instead

`wrapFetchWithPayment` covers the EVM rail. For the Solana rail, swap it for an
x402 Solana client (or the browser modal's
[`/server` helpers](https://www.npmjs.com/package/@three-ws/x402-payment-modal))
and select the `solana-devnet` / `solana` entry from the 402 `accepts` array.
The tool definitions above do not change — only the fetch wrapper does.

## 4. Spending guardrails

Give the MCP server its own funded key with a small balance. Every route here is
sub-cent to a few cents, and the price is quoted in the 402 before anything is
signed, so an agent can refuse a call whose price exceeds its budget.

Full endpoint reference: [skill.md](https://github.com/nirholas/x402-recurring/blob/main/skill.md).
