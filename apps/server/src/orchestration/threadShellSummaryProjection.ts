export interface ThreadShellSummaryState {
  readonly latestUserMessageAt: string | null;
  readonly pendingApprovalCount: number;
  readonly pendingUserInputCount: number;
  readonly hasActionableProposedPlan: number;
}

export interface ThreadShellSummaryTransition {
  readonly latestUserMessageAt?: string;
  readonly pendingApprovalDelta?: number;
  readonly pendingUserInputDelta?: number;
  readonly hasActionableProposedPlan?: boolean;
}

export function pendingStateDelta(wasPending: boolean, isPending: boolean): number {
  return Number(isPending) - Number(wasPending);
}

export function applyThreadShellSummaryTransition(
  state: ThreadShellSummaryState,
  transition: ThreadShellSummaryTransition,
): ThreadShellSummaryState {
  const candidateLatestUserMessageAt = transition.latestUserMessageAt;
  return {
    latestUserMessageAt:
      candidateLatestUserMessageAt !== undefined &&
      (state.latestUserMessageAt === null ||
        candidateLatestUserMessageAt > state.latestUserMessageAt)
        ? candidateLatestUserMessageAt
        : state.latestUserMessageAt,
    pendingApprovalCount: Math.max(
      0,
      state.pendingApprovalCount + (transition.pendingApprovalDelta ?? 0),
    ),
    pendingUserInputCount: Math.max(
      0,
      state.pendingUserInputCount + (transition.pendingUserInputDelta ?? 0),
    ),
    hasActionableProposedPlan:
      transition.hasActionableProposedPlan === undefined
        ? state.hasActionableProposedPlan
        : Number(transition.hasActionableProposedPlan),
  };
}

export function userInputActivityPendingState(input: {
  readonly kind: string;
  readonly detail: string | null;
}): boolean | null {
  if (input.kind === "user-input.requested") {
    return true;
  }
  if (input.kind === "user-input.resolved") {
    return false;
  }
  const detail = input.detail?.toLowerCase() ?? null;
  if (
    input.kind === "provider.user-input.respond.failed" &&
    detail !== null &&
    (detail.includes("stale pending user-input request") ||
      detail.includes("unknown pending user-input request"))
  ) {
    return false;
  }
  return null;
}
