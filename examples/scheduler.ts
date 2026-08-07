/**
 * Client-side scheduler — the "recurring" half of x402-recurring.
 *
 * The server never pulls money. Instead, this scheduler holds the mandate,
 * pays for each run on the mandate's cadence, and collects the signed run
 * reports. Stop it any time; nothing else gets charged.
 *
 * Usage:
 *   PRIVATE_KEY=0x... RUNS=3 npx tsx examples/scheduler.ts
 */
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "x402-fetch";

const BASE_URL = process.env.BASE_URL || "http://localhost:4021";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RUNS = Number(process.env.RUNS || 3);
const INTERVAL_SECONDS = Number(process.env.INTERVAL_SECONDS || 10);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!PRIVATE_KEY) {
    console.error("Set PRIVATE_KEY to a funded base-sepolia key.");
    process.exit(1);
  }
  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const payFetch = wrapFetchWithPayment(fetch, account);

  const mandate = await (
    await fetch(`${BASE_URL}/mandates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task: { type: "counter", params: { label: "scheduler demo" } },
        cadence: { everySeconds: INTERVAL_SECONDS },
        pricePerRun: "$0.005",
        maxRuns: RUNS,
        payer: account.address,
      }),
    })
  ).json();
  console.log(`Mandate ${mandate.mandateId}: ${RUNS} runs @ ${mandate.pricePerRun}, every ${INTERVAL_SECONDS}s`);

  const reports: unknown[] = [];
  for (let i = 1; i <= RUNS; i++) {
    const res = await payFetch(`${BASE_URL}/execute/${mandate.mandateId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      console.error(`Run ${i} failed:`, res.status, await res.text());
      break;
    }
    const report = (await res.json()) as { runNumber: number; charged: string; budget: { remainingRuns: number } };
    reports.push(report);
    console.log(`Run ${report.runNumber}/${RUNS} paid ${report.charged}, ${report.budget.remainingRuns} remaining`);
    if (i < RUNS) await sleep(INTERVAL_SECONDS * 1000);
  }

  console.log("\nCollected run reports:");
  console.log(JSON.stringify(reports, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
