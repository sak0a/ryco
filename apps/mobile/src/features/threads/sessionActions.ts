import type { EnvironmentApi } from "@ryco/contracts";
import {
  type ApprovalRequestId,
  type ProviderApprovalDecision,
  type ThreadId,
} from "@ryco/contracts";

import { newCommandId } from "../../lib/ids";

// §3-15: pure thread session-action dispatch wrappers, ported from
// apps/web/src/hooks/chatSessionActions.ts. Each dispatches an orchestration
// command through the EnvironmentApi seam (§3-12); no forked runtime logic. The
// revert guard is adapted from web's localApi.dialogs.confirm to a plain confirm
// callback (mobile drives it through ConfirmDialogHost).

export async function interruptThreadTurn(api: EnvironmentApi, threadId: ThreadId): Promise<void> {
  await api.orchestration.dispatchCommand({
    type: "thread.turn.interrupt",
    commandId: newCommandId(),
    threadId,
    createdAt: new Date().toISOString(),
  });
}

export async function respondToThreadApproval(input: {
  api: EnvironmentApi;
  threadId: ThreadId;
  requestId: ApprovalRequestId;
  decision: ProviderApprovalDecision;
}): Promise<void> {
  await input.api.orchestration.dispatchCommand({
    type: "thread.approval.respond",
    commandId: newCommandId(),
    threadId: input.threadId,
    requestId: input.requestId,
    decision: input.decision,
    createdAt: new Date().toISOString(),
  });
}

export async function respondToThreadUserInput(input: {
  api: EnvironmentApi;
  threadId: ThreadId;
  requestId: ApprovalRequestId;
  answers: Record<string, unknown>;
}): Promise<void> {
  await input.api.orchestration.dispatchCommand({
    type: "thread.user-input.respond",
    commandId: newCommandId(),
    threadId: input.threadId,
    requestId: input.requestId,
    answers: input.answers,
    createdAt: new Date().toISOString(),
  });
}

export async function revertThreadToTurnCount(input: {
  api: EnvironmentApi;
  threadId: ThreadId;
  turnCount: number;
}): Promise<void> {
  await input.api.orchestration.dispatchCommand({
    type: "thread.checkpoint.revert",
    commandId: newCommandId(),
    threadId: input.threadId,
    turnCount: input.turnCount,
    createdAt: new Date().toISOString(),
  });
}

export type RevertThreadCheckpointGuardFailure =
  | { type: "missing-api" }
  | { type: "environment-unavailable"; label: string }
  | { type: "turn-in-progress" }
  | { type: "user-cancelled" };

export type RevertThreadCheckpointResult =
  | { ok: true }
  | { ok: false; reason: RevertThreadCheckpointGuardFailure };

export async function revertThreadCheckpointWithGuards(input: {
  api: EnvironmentApi | null;
  thread: { id: ThreadId } | null;
  turnCount: number;
  environmentUnavailable: boolean;
  environmentUnavailableLabel: string | null;
  turnInProgress: boolean;
  confirmMessage: string;
  confirm: (message: string) => Promise<boolean>;
}): Promise<RevertThreadCheckpointResult> {
  if (!input.api || !input.thread) {
    return { ok: false, reason: { type: "missing-api" } };
  }
  if (input.environmentUnavailable) {
    return {
      ok: false,
      reason: {
        type: "environment-unavailable",
        label: input.environmentUnavailableLabel ?? "environment",
      },
    };
  }
  if (input.turnInProgress) {
    return { ok: false, reason: { type: "turn-in-progress" } };
  }
  const confirmed = await input.confirm(input.confirmMessage);
  if (!confirmed) {
    return { ok: false, reason: { type: "user-cancelled" } };
  }
  await revertThreadToTurnCount({
    api: input.api,
    threadId: input.thread.id,
    turnCount: input.turnCount,
  });
  return { ok: true };
}
