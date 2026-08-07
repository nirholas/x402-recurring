/**
 * Mandate + execution logic for x402-recurring.
 *
 * A mandate is a signed standing-order document: what task to run, how often,
 * at what price per run, and within what budget. Creating a mandate is free.
 * Each execution is paid per run at the mandate's own price via x402 — the
 * server never pulls funds; the client-side scheduler pays every run.
 */
import { createHash, randomUUID } from "node:crypto";
import { resignInPlace, signArtifact, type Signed } from "./sign.js";
import { loadStore, saveStore } from "./store.js";

export type TaskType = "heartbeat" | "counter" | "digest";

export interface MandateTask {
  type: TaskType;
  /** Free-form params recorded in the mandate (e.g. a label). */
  params?: Record<string, unknown>;
}

export interface Cadence {
  /** Suggested seconds between runs — enforced by the client-side scheduler. */
  everySeconds: number;
}

export interface Mandate {
  mandateId: string;
  document: "x402-recurring/mandate";
  task: MandateTask;
  cadence: Cadence;
  pricePerRun: string;
  maxRuns: number;
  payer: string;
  createdAt: string;
  expiresAt: string;
  status: "active" | "exhausted" | "expired";
  runsCompleted: number;
}

export interface RunReport {
  runId: string;
  document: "x402-recurring/run-report";
  mandateId: string;
  runNumber: number;
  executedAt: string;
  charged: string;
  budget: { maxRuns: number; runsCompleted: number; remainingRuns: number };
  artifact: Record<string, unknown>;
}

const MIN_PRICE = 0.001;
const MAX_PRICE = Number(process.env.MAX_RUN_PRICE || "0.10");
const DEFAULT_PRICE = 0.005;

/**
 * The price quoted for a run whose mandate cannot be priced yet — an id that is
 * unknown, or one whose mandate is no longer active. The paywall must answer
 * with a 402 challenge before it looks anything up (see server.ts), so it needs
 * a price it can quote without a mandate in hand; this is the same default a
 * mandate gets when it is created without an explicit `pricePerRun`.
 */
export const DEFAULT_RUN_PRICE = `$${DEFAULT_PRICE.toFixed(3)}`;
const TASK_TYPES: TaskType[] = ["heartbeat", "counter", "digest"];

type MandateStore = Record<string, Signed<Mandate>>;

let mandates: MandateStore = loadStore<MandateStore>("mandates", {});
const startedAt = Date.now();

function persist(): void {
  saveStore("mandates", mandates);
}

export function parseMoney(input: unknown, fallback: number): number {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string") {
    const n = Number(input.replace(/^\$/, ""));
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function toMoney(n: number): string {
  return `$${n.toFixed(Math.max(3, (String(n).split(".")[1] || "").length))}`;
}

export class MandateError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function createMandate(body: Record<string, unknown>): Signed<Mandate> {
  const taskInput = (body.task || {}) as Partial<MandateTask>;
  const type = TASK_TYPES.includes(taskInput.type as TaskType)
    ? (taskInput.type as TaskType)
    : "heartbeat";

  const price = Math.min(
    Math.max(parseMoney(body.pricePerRun ?? body.maxPricePerRun, DEFAULT_PRICE), MIN_PRICE),
    MAX_PRICE,
  );
  const maxRuns = Math.min(Math.max(Math.trunc(Number(body.maxRuns) || 10), 1), 10_000);
  const everySeconds = Math.max(Math.trunc(Number((body.cadence as Cadence | undefined)?.everySeconds) || 3600), 1);
  const days = Math.min(Math.max(Number(body.validDays) || 30, 1), 365);

  const mandate: Mandate = {
    mandateId: `mnd_${randomUUID()}`,
    document: "x402-recurring/mandate",
    task: { type, params: taskInput.params ?? {} },
    cadence: { everySeconds },
    pricePerRun: toMoney(price),
    maxRuns,
    payer: typeof body.payer === "string" ? body.payer : "unspecified",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
    status: "active",
    runsCompleted: 0,
  };
  const signed = signArtifact(mandate);
  mandates[mandate.mandateId] = signed;
  persist();
  return signed;
}

export function getMandate(id: string): Signed<Mandate> | undefined {
  const m = mandates[id];
  if (!m) return undefined;
  if (m.status === "active" && new Date(m.expiresAt).getTime() < Date.now()) {
    m.status = "expired";
    resignInPlace(m); // the stored document changed — its signature must follow
    persist();
  }
  return m;
}

function runTask(mandate: Mandate, runNumber: number, payload: unknown): Record<string, unknown> {
  switch (mandate.task.type) {
    case "heartbeat":
      return {
        taskType: "heartbeat",
        alive: true,
        serverTime: new Date().toISOString(),
        serverUptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        label: mandate.task.params?.label ?? null,
      };
    case "counter": {
      return {
        taskType: "counter",
        count: runNumber,
        remaining: mandate.maxRuns - runNumber,
        percentComplete: Math.round((runNumber / mandate.maxRuns) * 100),
      };
    }
    case "digest": {
      const canonical = JSON.stringify(payload ?? null);
      return {
        taskType: "digest",
        payloadSha256: createHash("sha256").update(canonical).digest("hex"),
        payloadBytes: Buffer.byteLength(canonical),
        payloadType: Array.isArray(payload) ? "array" : payload === null ? "null" : typeof payload,
        itemCount: Array.isArray(payload)
          ? payload.length
          : payload && typeof payload === "object"
            ? Object.keys(payload).length
            : null,
      };
    }
  }
}

/**
 * Executes one paid run. The x402 payment has already settled by the time this
 * runs, so the report — the purchased artifact — is returned in this response.
 */
export function executeMandate(id: string, payload: unknown): Signed<RunReport> {
  const mandate = getMandate(id);
  if (!mandate) throw new MandateError(404, "MANDATE_NOT_FOUND", `No mandate ${id}`);
  if (mandate.status === "expired")
    throw new MandateError(410, "MANDATE_EXPIRED", `Mandate ${id} expired at ${mandate.expiresAt}`);
  if (mandate.status === "exhausted" || mandate.runsCompleted >= mandate.maxRuns)
    throw new MandateError(410, "MANDATE_EXHAUSTED", `Mandate ${id} has used all ${mandate.maxRuns} runs`);

  mandate.runsCompleted += 1;
  if (mandate.runsCompleted >= mandate.maxRuns) mandate.status = "exhausted";
  resignInPlace(mandate); // runsCompleted/status moved — re-sign the document
  persist();

  const report: RunReport = {
    runId: `run_${randomUUID()}`,
    document: "x402-recurring/run-report",
    mandateId: mandate.mandateId,
    runNumber: mandate.runsCompleted,
    executedAt: new Date().toISOString(),
    charged: mandate.pricePerRun,
    budget: {
      maxRuns: mandate.maxRuns,
      runsCompleted: mandate.runsCompleted,
      remainingRuns: mandate.maxRuns - mandate.runsCompleted,
    },
    artifact: runTask(mandate, mandate.runsCompleted, payload),
  };
  return signArtifact(report);
}

export function listMandates(): Array<Pick<Mandate, "mandateId" | "status" | "pricePerRun" | "runsCompleted" | "maxRuns">> {
  return Object.values(mandates).map(({ mandateId, status, pricePerRun, runsCompleted, maxRuns }) => ({
    mandateId,
    status,
    pricePerRun,
    runsCompleted,
    maxRuns,
  }));
}
