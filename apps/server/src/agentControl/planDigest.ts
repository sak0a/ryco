import { createHash } from "node:crypto";

import {
  AGENT_CONTROL_PLAN_VERSION,
  AgentControlActionPlan,
  AgentControlPlanDigest,
} from "@ryco/contracts";
import { Schema } from "effect";

type JsonCompatible =
  | string
  | number
  | boolean
  | null
  | JsonCompatible[]
  | { [key: string]: JsonCompatible };

// Mirrors the contextHandoff stable-stringify: sorted keys, dropped
// `undefined` entries, non-finite numbers to null. Kept local so the digest
// module has no dependency on the orchestration domain; the two can move to
// a shared module if a third consumer appears.
function canonicalJsonValue(value: unknown): JsonCompatible {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalJsonValue);
  }
  if (value && typeof value === "object") {
    const result: Record<string, JsonCompatible> = {};
    for (const key of Object.keys(value).toSorted()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) {
        result[key] = canonicalJsonValue(entry);
      }
    }
    return result;
  }
  return null;
}

const encodePlan = Schema.encodeSync(AgentControlActionPlan);

/** Canonical wire-form JSON for a plan: encoded, key-sorted, deterministic. */
export function canonicalAgentControlPlanJson(plan: AgentControlActionPlan): string {
  return JSON.stringify(canonicalJsonValue(encodePlan(plan)));
}

/**
 * sha-256 over the versioned canonical plan payload. Accepting a proposal
 * authorizes exactly this digest; any plan change produces a new digest and
 * therefore requires a new request and a new approval.
 */
export function computeAgentControlPlanDigest(
  plan: AgentControlActionPlan,
): AgentControlPlanDigest {
  return AgentControlPlanDigest.make(
    createHash("sha256")
      .update(`${AGENT_CONTROL_PLAN_VERSION}:${canonicalAgentControlPlanJson(plan)}`, "utf8")
      .digest("hex"),
  );
}
