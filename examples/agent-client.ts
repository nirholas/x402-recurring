/**
 * Full x402 flow: create a mandate (free), then pay for one execution and
 * print the signed run report plus the X-PAYMENT-RESPONSE settlement header.
 *
 * Usage:
 *   PRIVATE_KEY=0x... BASE_URL=http://localhost:4021 npx tsx examples/agent-client.ts
 */
import { privateKeyToAccount } from "viem/accounts";
import { decodeXPaymentResponse, wrapFetchWithPayment } from "x402-fetch";

const BASE_URL = process.env.BASE_URL || "http://localhost:4021";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

async function main() {
  if (!PRIVATE_KEY) {
    console.error("Set PRIVATE_KEY to a funded base-sepolia key (USDC + a little ETH).");
    process.exit(1);
  }
  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const payFetch = wrapFetchWithPayment(fetch, account);

  // 1. Create a mandate — free, no payment involved.
  const mandateRes = await fetch(`${BASE_URL}/mandates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      task: { type: "heartbeat", params: { label: "demo standing order" } },
      cadence: { everySeconds: 60 },
      pricePerRun: "$0.005",
      maxRuns: 5,
      payer: account.address,
    }),
  });
  const mandate = await mandateRes.json();
  console.log("Mandate created:\n", JSON.stringify(mandate, null, 2));

  // 2. Execute one run — x402-fetch handles the 402 → pay → retry dance.
  const runRes = await payFetch(`${BASE_URL}/execute/${mandate.mandateId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!runRes.ok) {
    console.error("Execution failed:", runRes.status, await runRes.text());
    process.exit(1);
  }
  const report = await runRes.json();
  console.log("\nSigned run report (the purchased artifact):\n", JSON.stringify(report, null, 2));

  const paymentHeader = runRes.headers.get("x-payment-response");
  if (paymentHeader) {
    console.log("\nX-PAYMENT-RESPONSE (settlement):\n", decodeXPaymentResponse(paymentHeader));
  }

  // 3. Verify the artifact signature server-side (free).
  const verifyRes = await fetch(`${BASE_URL}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report),
  });
  console.log("\nSignature valid:", (await verifyRes.json()).valid);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/* ---------------------------------------------------------------------------
 * Paying on the Solana rail instead
 * ---------------------------------------------------------------------------
 * Every paid route here answers with a DUAL-RAIL 402: `accepts` holds one
 * base-sepolia entry and one solana-devnet entry. `wrapFetchWithPayment` above
 * picks the EVM one. To pay from a Solana wallet, pick the other entry and
 * build the `X-PAYMENT` envelope yourself:
 *
 *   import {
 *     prepareSolanaCheckout,
 *     encodeX402Payment,
 *   } from "@three-ws/x402-payment-modal/server";
 *
 *   const res = await fetch(url, { method: "POST" });          // 402
 *   const { accepts } = await res.json();
 *   const accept = accepts.find((a) => a.network.startsWith("solana"));
 *
 *   // 1. server-side helper builds the SPL transferChecked the buyer signs.
 *   //    accept.extra.feePayer sponsors the SOL fee, so you need only USDC.
 *   const { tx_base64 } = await prepareSolanaCheckout({
 *     accept, buyer: myPubkey, rpcUrl: process.env.SOLANA_RPC_URL,
 *   });
 *
 *   // 2. sign tx_base64 with your keypair / Phantom.
 *   const signedTxBase64 = await signWithWallet(tx_base64);
 *
 *   // 3. wrap it into the x402 envelope and retry.
 *   const { x_payment } = encodeX402Payment({
 *     accept, signedTxBase64, resourceUrl: url,
 *   });
 *   const paid = await fetch(url, { method: "POST", headers: { "X-PAYMENT": x_payment } });
 *
 * In a browser the drop-in modal does all three steps for you:
 *   <script type="module" src="https://unpkg.com/@three-ws/x402-payment-modal"></script>
 *
 * The raw dual-rail 402 body, for reference:
 *
 *   $ curl -s -i -X POST http://localhost:4021/execute/mnd_…
 *   HTTP/1.1 402 Payment Required
 *   {
 *     "x402Version": 1,
 *     "error": "X-PAYMENT header is required",
 *     "accepts": [
 *       { "scheme": "exact", "network": "base-sepolia",  "asset": "0x036CbD…dCF7e",
 *         "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402", "maxAmountRequired": "5000" },
 *       { "scheme": "exact", "network": "solana-devnet", "asset": "4zMMC9…ncDU",
 *         "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW", "maxAmountRequired": "5000",
 *         "extra": { "feePayer": "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5" } }
 *     ]
 *   }
 * ------------------------------------------------------------------------- */
