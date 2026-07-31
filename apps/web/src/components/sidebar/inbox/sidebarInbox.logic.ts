import type {
  ThreadInboxEntry,
  ThreadInboxMutationBlocker,
} from "@ryco/client-runtime/state/threads";
import type { ThreadSettlementBlocker } from "@ryco/shared/threadSettlement";

export const SETTLED_PAGE_SIZE = 20;
export const INBOX_VIRTUALIZATION_THRESHOLD = 40;

export function shouldVirtualizeInbox(visibleEntryCount: number): boolean {
  return visibleEntryCount > INBOX_VIRTUALIZATION_THRESHOLD;
}

export function visibleSettledEntries(
  entries: readonly ThreadInboxEntry[],
  visibleCount: number,
): readonly ThreadInboxEntry[] {
  return entries.slice(0, Math.max(SETTLED_PAGE_SIZE, visibleCount));
}

export function mutationBlockerLabel(blocker: ThreadInboxMutationBlocker | null): string | null {
  switch (blocker) {
    case "client-draft":
      return "Drafts can be settled after their first message is sent.";
    case "unsupported":
      return "This server version does not support thread settlement.";
    case "disconnected":
      return "Reconnect this environment to change the thread.";
    case "read-only":
      return "This environment is currently read-only.";
    case "shell-stale":
      return "Waiting for the latest thread list from this environment.";
    case null:
      return null;
  }
}

export function settlementBlockerLabel(blocker: ThreadSettlementBlocker | null): string | null {
  switch (blocker) {
    case "pending-approval":
      return "Resolve the pending approval before settling this thread.";
    case "pending-user-input":
      return "Answer the pending question before settling this thread.";
    case "session-starting":
    case "session-running":
      return "Wait for the running agent session to finish.";
    case "queued-turn":
    case "local-queue":
      return "Send or remove queued work before settling this thread.";
    case "delivery-unknown":
      return "Delivery state is uncertain; reconnect before settling.";
    case "unsupported":
      return "This server version does not support thread settlement.";
    case "thread-archived":
    case "thread-deleted":
    case "worktree-archived":
      return "Archived items are managed separately from the Inbox.";
    case null:
      return null;
  }
}

export function entryActionDisabledReason(entry: ThreadInboxEntry): string | null {
  const mutationReason = mutationBlockerLabel(entry.mutationBlocker);
  if (mutationReason) return mutationReason;
  if (entry.lifecycle.classification === "active" && !entry.lifecycle.eligibility.canSettle) {
    return settlementBlockerLabel(entry.lifecycle.eligibility.blocker);
  }
  return null;
}
