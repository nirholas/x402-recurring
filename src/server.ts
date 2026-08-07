import "dotenv/config";
import express from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { paywall, payToBanner, withSettlement } from "./payments.js";
import { ROUTE_SCHEMAS } from "./schemas.js";
import {
  createMandate,
  DEFAULT_RUN_PRICE,
  executeMandate,
  getMandate,
  listMandates,
  MandateError,
} from "./service.js";
import { verify } from "./sign.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 4021);

const app = express();
app.use(express.json({ limit: "256kb" }));

// ---- x402 paywall: POST /execute/:mandateId is priced per mandate ----------
// The price of a run is whatever the mandate says it is, so the 402 challenge
// quotes the true price of the thing being bought — on both rails.
//
// The challenge comes first, always. An unpaid request is answered with 402 and
// the full `accepts` array before the mandate id is looked at, so a discovery
// probe (or any agent) can read the payment terms of this route without owning
// a mandate. Whether the mandate exists, is active, or has budget left is the
// handler's business, after payment. Confirm a mandate with the free
// `GET /mandates/:id` before paying for a run.
app.use(
  paywall({
    "POST /execute/:mandateId": (req) => {
      const id = req.path.split("/")[2] || "";
      const mandate = getMandate(id);
      return {
        price: mandate?.pricePerRun ?? DEFAULT_RUN_PRICE,
        description: mandate
          ? `Execute one run of mandate ${id} (${mandate.task.type})`
          : "Execute one run of a mandate",
        outputSchema: ROUTE_SCHEMAS["POST /execute/:mandateId"],
      };
    },
  }),
);

// ---- Free routes ------------------------------------------------------------
app.get("/health", (_req, res) => res.json({ ok: true, service: "x402-recurring" }));

app.post("/mandates", (req, res) => {
  res.status(201).json(createMandate(req.body ?? {}));
});

app.get("/mandates", (_req, res) => res.json({ mandates: listMandates() }));

app.get("/mandates/:id", (req, res) => {
  const mandate = getMandate(req.params.id);
  if (!mandate) {
    return res.status(404).json({ error: "MANDATE_NOT_FOUND", message: `No mandate ${req.params.id}` });
  }
  res.json(mandate);
});

app.post("/verify", (req, res) => {
  const artifact = req.body;
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "POST a signed artifact as the JSON body" });
  }
  res.json({ valid: verify(artifact as Record<string, unknown>) });
});

// ---- Paid route -------------------------------------------------------------
app.post("/execute/:mandateId", (req, res) => {
  try {
    const report = executeMandate(req.params.mandateId, req.body?.payload);
    res.json(withSettlement(report, req));
  } catch (err) {
    if (err instanceof MandateError) {
      return res.status(err.statusCode).json({ error: err.code, message: err.message });
    }
    throw err;
  }
});

// ---- Static (includes /.well-known/x402) ------------------------------------
app.get("/.well-known/x402", (_req, res) => {
  res.type("application/json").send(readFileSync(path.join(ROOT, "public/.well-known/x402"), "utf8"));
});
app.use(express.static(path.join(ROOT, "public")));

app.listen(PORT, () => {
  console.log(`x402-recurring listening on http://localhost:${PORT}`);
  console.log("  Pay in USDC on Base or Solana — your client picks the rail.");
  for (const line of payToBanner()) console.log(line);
  console.log("  Paid routes:");
  console.log("    POST /execute/:mandateId   price set per mandate (default $0.005/run)");
  console.log("  Free routes:");
  console.log("    POST /mandates             create a signed mandate document");
  console.log("    GET  /mandates/:id         mandate status");
  console.log("    POST /verify               verify any signed artifact");
  console.log("    GET  /.well-known/x402     discovery manifest");
});
