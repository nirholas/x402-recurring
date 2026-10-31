/**
 * A payment for a mandate that cannot deliver a run must never settle, and
 * two payments for the last run must not both settle. The facilitator here is
 * a local HTTP server that counts /settle calls.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

let facilitator: Server;
let settleCalls = 0;
let app: Server;
let base = "";
let mod: { createMandate: (b: Record<string, unknown>) => { mandateId: string } };

before(async () => {
  facilitator = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url?.endsWith("/verify")) return res.end(JSON.stringify({ isValid: true, payer: "0xabc" }));
      if (req.url?.endsWith("/settle")) {
        settleCalls += 1;
        return setTimeout(() => res.end(JSON.stringify({ success: true, transaction: "0xtx", network: "base-sepolia", payer: "0xabc" })), 50);
      }
      res.end(JSON.stringify({ kinds: [] }));
    });
  });
  await new Promise<void>((r) => facilitator.listen(0, r));
  const url = `http://127.0.0.1:${(facilitator.address() as AddressInfo).port}`;
  process.env.FACILITATOR_URL = url;
  process.env.SOLANA_FACILITATOR_URL = url;
  process.env.DATA_DIR = `${process.env.TMPDIR || "/tmp"}/x402-recurring-test-${process.pid}`;
  process.env.PORT = "0";

  const express = (await import("express")).default;
  const { paywall } = await import("../src/payments.js");
  const service = await import("../src/service.js");
  mod = service;
  const server = express();
  server.use(express.json());
  server.use(
    paywall({
      "POST /execute/:mandateId": (req) => {
        const id = req.path.split("/")[2] || "";
        return { price: "$0.005", description: "run", reserve: () => service.reserveRun(id) };
      },
    }),
  );
  server.post("/execute/:mandateId", (req, res) => {
    try {
      res.json(service.executeMandate(req.params.mandateId, undefined, true));
    } catch (e) {
      const err = e as { statusCode?: number; code?: string };
      res.status(err.statusCode ?? 500).json({ error: err.code });
    }
  });
  app = server.listen(0);
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});

after(() => {
  app.close();
  facilitator.close();
});

const payment = () =>
  Buffer.from(
    JSON.stringify({
      x402Version: 1,
      scheme: "exact",
      network: "base-sepolia",
      payload: {
        signature: `0x${"00".repeat(65)}`,
        authorization: {
          from: "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
          to: "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
          value: "5000",
          validAfter: "0",
          validBefore: "9999999999",
          nonce: `0x${"11".repeat(32)}`,
        },
      },
    }),
  ).toString("base64");

const pay = (id: string) => fetch(`${base}/execute/${id}`, { method: "POST", headers: { "X-PAYMENT": payment(), "content-type": "application/json" }, body: "{}" });

test("payment for an unknown mandate is refused with 404 and never settles", async () => {
  settleCalls = 0;
  const res = await pay("mnd_does-not-exist");
  assert.equal(res.status, 404);
  assert.equal(settleCalls, 0);
});

test("two concurrent payments for the last run settle once", async () => {
  settleCalls = 0;
  const { mandateId } = mod.createMandate({ maxRuns: 1 });
  const results = await Promise.all([pay(mandateId), pay(mandateId)]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 410]);
  assert.equal(settleCalls, 1);
});

test("an exhausted mandate is refused with 410 and never settles", async () => {
  const { mandateId } = mod.createMandate({ maxRuns: 1 });
  assert.equal((await pay(mandateId)).status, 200);
  settleCalls = 0;
  assert.equal((await pay(mandateId)).status, 410);
  assert.equal(settleCalls, 0);
});
