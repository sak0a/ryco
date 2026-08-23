import type {
  ModelSelection,
  OrchestrationSessionStatus,
  ProviderDriverKind,
  ProviderInteractionMode,
} from "@ryco/contracts";
import { modelSelectionRequiresContextHandoff } from "@ryco/shared/model";

import type { SessionPhase } from "../threads/types.ts";

export type ProviderSelectionPolicyReason =
  | "phone-tier"
  | "running"
  | "starting"
  | "connecting"
  | "local-dispatch"
  | "worktree-preparation"
  | "pending-approval"
  | "pending-input"
  | "queued-message"
  | "checkpoint-revert"
  | "mutation-unavailable"
  | "environment-unavailable";

export interface ProviderSelectionPolicy {
  readonly mode: "all-ready" | "continuation-only";
  readonly lockedProvider: ProviderDriverKind | null;
  readonly reason: ProviderSelectionPolicyReason | null;
}

/**
 * Shared policy for changing the provider behind an existing thread. Empty
 * threads remain configurable. Started threads expose every ready provider
 * only while the session is genuinely idle and mutation-ready.
 */
export function deriveProviderSelectionPolicy(input: {
  readonly threadStarted: boolean;
  readonly canonicalProvider: ProviderDriverKind | null;
  readonly phase: SessionPhase;
  readonly orchestrationStatus: OrchestrationSessionStatus | null;
  readonly isConnecting: boolean;
  readonly isSendBusy: boolean;
  readonly isPreparingWorktree: boolean;
  readonly hasPendingApproval: boolean;
  readonly hasPendingUserInput: boolean;
  readonly hasQueuedMessage: boolean;
  readonly isRevertingCheckpoint: boolean;
  readonly mutationAllowed: boolean;
  readonly environmentAvailable: boolean;
  readonly isPhoneTier: boolean;
}): ProviderSelectionPolicy {
  if (!input.threadStarted) {
    return { mode: "all-ready", lockedProvider: null, reason: null };
  }

  const reason: ProviderSelectionPolicyReason | null = input.isPhoneTier
    ? "phone-tier"
    : input.phase === "running" || input.orchestrationStatus === "running"
      ? "running"
      : input.orchestrationStatus === "starting"
        ? "starting"
        : input.phase === "connecting" || input.isConnecting
          ? "connecting"
          : input.isPreparingWorktree
            ? "worktree-preparation"
            : input.isSendBusy
              ? "local-dispatch"
              : input.hasPendingApproval
                ? "pending-approval"
                : input.hasPendingUserInput
                  ? "pending-input"
                  : input.hasQueuedMessage
                    ? "queued-message"
                    : input.isRevertingCheckpoint
                      ? "checkpoint-revert"
                      : !input.mutationAllowed
                        ? "mutation-unavailable"
                        : !input.environmentAvailable
                          ? "environment-unavailable"
                          : null;

  return reason === null
    ? { mode: "all-ready", lockedProvider: null, reason: null }
    : {
        mode: "continuation-only",
        lockedProvider: input.canonicalProvider,
        reason,
      };
}

/** Recheck provider-boundary eligibility at the moment a turn is sent. */
export function selectionAllowedAtSendBoundary(input: {
  readonly threadStarted: boolean;
  readonly policy: ProviderSelectionPolicy;
  readonly canonicalSelection: ModelSelection;
  readonly targetSelection: ModelSelection;
}): boolean {
  return (
    !input.threadStarted ||
    input.policy.mode === "all-ready" ||
    !modelSelectionRequiresContextHandoff(input)
  );
}

export function normalizeInteractionModeForProviderTarget(
  mode: ProviderInteractionMode,
  supportsAskMode: boolean,
): ProviderInteractionMode {
  return mode === "ask" && !supportsAskMode ? "default" : mode;
}
