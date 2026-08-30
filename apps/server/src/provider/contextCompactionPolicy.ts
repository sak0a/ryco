import type { ThreadTokenUsageSnapshot } from "@ryco/contracts";

export const CONTEXT_COMPACTION_TRIGGER_RATIO = 0.8;
export const CONTEXT_COMPACTION_REARM_RATIO = 0.65;

export type ContextCompactionPhase = "idle" | "requested" | "compacting" | "disabled";

export interface ContextCompactionPolicyState {
  readonly generation: number;
  readonly phase: ContextCompactionPhase;
  readonly armed: boolean;
}

export interface ContextCompactionDecision {
  readonly state: ContextCompactionPolicyState;
  readonly trigger: boolean;
  readonly windowTokens?: number;
}

export function initialContextCompactionPolicyState(
  generation: number,
): ContextCompactionPolicyState {
  return {
    generation,
    phase: "idle",
    armed: true,
  };
}

/**
 * Decides whether a context snapshot should arm automatic compaction.
 *
 * The lower rearm watermark prevents a repeated high-water snapshot from
 * creating another request after a completed or interrupted compaction. A
 * generation mismatch is always ignored so a late observation from a replaced
 * provider session cannot mutate the active one.
 */
export function observeContextCompaction(
  state: ContextCompactionPolicyState,
  input: {
    readonly generation: number;
    readonly usage: ThreadTokenUsageSnapshot;
  },
): ContextCompactionDecision {
  if (input.generation !== state.generation || state.phase === "disabled") {
    return { state, trigger: false };
  }

  const { usedTokens, maxTokens } = input.usage;
  if (
    maxTokens === undefined ||
    !Number.isFinite(maxTokens) ||
    maxTokens <= 0 ||
    !Number.isFinite(usedTokens) ||
    usedTokens < 0
  ) {
    return { state, trigger: false };
  }

  const ratio = usedTokens / maxTokens;
  if (state.phase !== "idle") {
    return { state, trigger: false };
  }
  if (!state.armed) {
    return ratio <= CONTEXT_COMPACTION_REARM_RATIO
      ? { state: { ...state, armed: true }, trigger: false }
      : { state, trigger: false };
  }
  if (ratio < CONTEXT_COMPACTION_TRIGGER_RATIO) {
    return { state, trigger: false };
  }

  return {
    state: {
      ...state,
      phase: "requested",
      armed: false,
    },
    trigger: true,
    windowTokens: Math.max(1, Math.floor(maxTokens * CONTEXT_COMPACTION_TRIGGER_RATIO)),
  };
}

export function markContextCompactionStarted(
  state: ContextCompactionPolicyState,
  generation: number,
): ContextCompactionPolicyState {
  if (generation !== state.generation || state.phase === "disabled") return state;
  return { ...state, phase: "compacting", armed: false };
}

export function settleContextCompaction(
  state: ContextCompactionPolicyState,
  generation: number,
): ContextCompactionPolicyState {
  if (generation !== state.generation || state.phase === "disabled") return state;
  return {
    ...state,
    phase: "idle",
    armed: false,
  };
}

export function disableContextCompaction(
  state: ContextCompactionPolicyState,
  generation: number,
): ContextCompactionPolicyState {
  if (generation !== state.generation) return state;
  return {
    ...state,
    phase: "disabled",
    armed: false,
  };
}
