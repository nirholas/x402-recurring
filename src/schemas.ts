/**
 * Per-route request/response schemas published in the x402 402 challenge.
 *
 * Generated from `openapi.json` so the discovery metadata and the runtime
 * challenge cannot drift apart: `accepts[].outputSchema.input` describes how to
 * call the route, `accepts[].outputSchema.output` describes what the paid 200
 * returns. Keys match the paywall route map in `server.ts` exactly.
 *
 * Update `openapi.json` first, then re-derive this file.
 */

/** x402 Bazaar-style schema pair carried by every accept entry. */
export type RouteSchema = {
  /** How to invoke the route: method, query params and/or JSON body fields. */
  input: Record<string, unknown>;
  /** JSON Schema of the paid 200 response body. */
  output: Record<string, unknown>;
};

export const ROUTE_SCHEMAS: Record<string, RouteSchema> = {
  "POST /execute/:mandateId": {
    "input": {
      "type": "http",
      "method": "POST",
      "pathParams": {
        "mandateId": {
          "type": "string",
          "description": "The `mandateId` from `POST /mandates`"
        }
      },
      "bodyType": "json",
      "bodyFields": {
        "payload": {
          "description": "Optional per-run input handed to the mandate's task (any JSON). Merged into the run artifact."
        }
      }
    },
    "output": {
      "type": "object",
      "properties": {
        "runId": {
          "type": "string"
        },
        "document": {
          "const": "x402-recurring/run-report"
        },
        "mandateId": {
          "type": "string"
        },
        "runNumber": {
          "type": "integer"
        },
        "executedAt": {
          "type": "string",
          "format": "date-time"
        },
        "charged": {
          "type": "string"
        },
        "budget": {
          "type": "object"
        },
        "artifact": {
          "type": "object"
        },
        "signature": {
          "type": "string"
        },
        "algorithm": {
          "const": "HMAC-SHA256"
        },
        "settlement": {
          "type": "object",
          "description": "x402 settlement receipt echoed alongside the artifact (rail, network, transaction, payer). Added after signing and excluded from signature verification."
        }
      }
    }
  },
};
