import { describe, expect, it } from "vitest";

import {
  applyThreadShellSummaryTransition,
  pendingStateDelta,
  type ThreadShellSummaryState,
  userInputActivityPendingState,
} from "./threadShellSummaryProjection.ts";

describe("thread shell summary projection", () => {
  it("maintains counts and latest user message monotonically", () => {
    let state: ThreadShellSummaryState = {
      latestUserMessageAt: null,
      pendingApprovalCount: 0,
      pendingUserInputCount: 0,
      hasActionableProposedPlan: 0,
    };
    const approvalStates = new Map<string, boolean>();
    const userInputStates = new Map<string, boolean>();
    const userMessageTimes: string[] = [];
    let actionable = false;

    let seed = 0x5eed;
    const random = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return seed;
    };

    for (let index = 0; index < 500; index += 1) {
      const kind = random() % 4;
      if (kind === 0) {
        const timestamp = new Date(1_700_000_000_000 + (random() % 100_000)).toISOString();
        userMessageTimes.push(timestamp);
        state = applyThreadShellSummaryTransition(state, {
          latestUserMessageAt: timestamp,
        });
      } else if (kind === 1) {
        const requestId = `approval-${random() % 12}`;
        const wasPending = approvalStates.get(requestId) ?? false;
        const isPending = random() % 2 === 0;
        approvalStates.set(requestId, isPending);
        state = applyThreadShellSummaryTransition(state, {
          pendingApprovalDelta: pendingStateDelta(wasPending, isPending),
        });
      } else if (kind === 2) {
        const requestId = `input-${random() % 12}`;
        const wasPending = userInputStates.get(requestId) ?? false;
        const isPending = random() % 2 === 0;
        userInputStates.set(requestId, isPending);
        state = applyThreadShellSummaryTransition(state, {
          pendingUserInputDelta: pendingStateDelta(wasPending, isPending),
        });
      } else {
        actionable = !actionable;
        state = applyThreadShellSummaryTransition(state, {
          hasActionableProposedPlan: actionable,
        });
      }

      expect(state).toEqual({
        latestUserMessageAt: userMessageTimes.toSorted().at(-1) ?? null,
        pendingApprovalCount: [...approvalStates.values()].filter(Boolean).length,
        pendingUserInputCount: [...userInputStates.values()].filter(Boolean).length,
        hasActionableProposedPlan: Number(actionable),
      });
    }
  });

  it("recognizes only user-input activities that change pending state", () => {
    expect(userInputActivityPendingState({ kind: "user-input.requested", detail: null })).toBe(
      true,
    );
    expect(userInputActivityPendingState({ kind: "user-input.resolved", detail: null })).toBe(
      false,
    );
    expect(
      userInputActivityPendingState({
        kind: "provider.user-input.respond.failed",
        detail: "Unknown pending user-input request",
      }),
    ).toBe(false);
    expect(
      userInputActivityPendingState({
        kind: "provider.user-input.respond.failed",
        detail: "Temporary transport failure",
      }),
    ).toBeNull();
  });
});
