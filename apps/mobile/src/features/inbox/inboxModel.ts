import type {
  Project,
  SidebarThreadSummary,
  SidebarWorktreeSummary,
  ThreadInboxMutationBlocker,
} from "@ryco/client-runtime/state/threads";
import { buildThreadInbox } from "@ryco/client-runtime/state/threads";
import type { EnvironmentId, ThreadId } from "@ryco/contracts";
import type { ThreadSettlementBlocker } from "@ryco/shared/threadSettlement";

import { buildChangeRequestBadge, type ChangeRequestBadge } from "../../lib/changeRequestBadge";

export type InboxThreadState =
  | "needs-input"
  | "delivery-unknown"
  | "working"
  | "connecting"
  | "error"
  | "reconnecting"
  | "idle"
  | "settled";

export interface InboxEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connectionState: "connected" | "reconnecting" | "offline" | "read-only";
  readonly threadSettlementSupported?: boolean;
  readonly mutationReady?: boolean;
  readonly shellCurrent?: boolean;
}

export interface InboxThreadRow {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly nodeLabel: string;
  readonly projectLabel: string;
  readonly worktreeLabel: string;
  readonly contextLabel: string;
  readonly state: InboxThreadState;
  readonly statusLabel: string;
  readonly updatedAt: string;
  /**
   * The worktree's pull request / work item, when it has one. Last known state
   * — nothing refreshes it in the background. See changeRequestBadge.ts.
   */
  readonly changeRequest: ChangeRequestBadge | null;
  readonly attentionState: "active" | "settled";
  readonly canSettle: boolean;
  readonly settlementBlocker: ThreadSettlementBlocker | null;
  readonly mutationEnabled: boolean;
  readonly mutationBlocker: ThreadInboxMutationBlocker | null;
}

export interface InboxSection {
  readonly key: "active" | "settled";
  readonly title: "Active" | "Settled";
  readonly rows: ReadonlyArray<InboxThreadRow>;
}

export interface BuildInboxInput {
  readonly projects: ReadonlyArray<Project>;
  readonly worktrees: ReadonlyArray<SidebarWorktreeSummary>;
  readonly threads: ReadonlyArray<SidebarThreadSummary>;
  readonly environments: ReadonlyArray<InboxEnvironment>;
  readonly nodeScope?: EnvironmentId | null;
  readonly query?: string;
  readonly deliveryUnknownThreadIds?: ReadonlySet<string>;
  readonly localQueuedThreadIds?: ReadonlySet<string>;
  readonly nowMs: number;
}

function scopedKey(environmentId: EnvironmentId, id: string): string {
  return `${environmentId}:${id}`;
}

function threadState(
  thread: SidebarThreadSummary,
  environment: InboxEnvironment | undefined,
  deliveryUnknownThreadIds: ReadonlySet<string>,
): InboxThreadState {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return "needs-input";
  if (deliveryUnknownThreadIds.has(scopedKey(thread.environmentId, thread.id))) {
    return "delivery-unknown";
  }
  if (thread.latestTurn?.state === "running") return "working";
  if (thread.session?.status === "connecting") return "connecting";
  if (thread.session?.status === "error" || thread.latestTurn?.state === "error") return "error";
  if (environment?.connectionState === "reconnecting") return "reconnecting";
  return "idle";
}

function statusLabel(state: InboxThreadState): string {
  switch (state) {
    case "needs-input":
      return "Needs input";
    case "delivery-unknown":
      return "Check delivery";
    case "working":
      return "Working";
    case "connecting":
      return "Connecting";
    case "error":
      return "Error";
    case "reconnecting":
      return "Reconnecting";
    case "idle":
      return "Idle";
    case "settled":
      return "Settled";
  }
}

function timestamp(thread: SidebarThreadSummary): string {
  return thread.updatedAt ?? thread.latestUserMessageAt ?? thread.createdAt;
}

export function buildInboxSections(input: BuildInboxInput): ReadonlyArray<InboxSection> {
  const environmentById = new Map(
    input.environments.map((environment) => [environment.environmentId, environment] as const),
  );
  const deliveryUnknown = input.deliveryUnknownThreadIds ?? new Set<string>();
  const model = buildThreadInbox({
    projects: input.projects,
    worktrees: input.worktrees,
    threads: input.threads,
    environments: input.environments.map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
      threadSettlementSupported: environment.threadSettlementSupported ?? false,
      connected: environment.connectionState === "connected",
      mutationReady: environment.mutationReady ?? false,
      shellCurrent: environment.shellCurrent ?? false,
    })),
    localQueuedThreadKeys: input.localQueuedThreadIds,
    deliveryUnknownThreadKeys: deliveryUnknown,
    filters: {
      ...(input.nodeScope ? { environmentIds: [input.nodeScope] } : {}),
      text: input.query,
    },
    nowMs: input.nowMs,
  });

  const toRow = (entry: (typeof model.active)[number]): InboxThreadRow => {
    const thread = entry.thread!;
    const environment = environmentById.get(thread.environmentId);
    const nodeLabel = environment?.label || "Unknown node";
    const projectLabel = entry.project?.name || "Unknown project";
    const worktreeLabel =
      entry.worktree?.title || entry.worktree?.branch || thread.branch || "Local workspace";
    const state =
      entry.lifecycle.classification === "settled"
        ? "settled"
        : threadState(thread, environment, deliveryUnknown);
    return {
      key: entry.key,
      environmentId: thread.environmentId,
      threadId: thread.id,
      title: entry.title || "Untitled task",
      nodeLabel,
      projectLabel,
      worktreeLabel,
      contextLabel: `${nodeLabel} · ${projectLabel} · ${worktreeLabel}`,
      state,
      statusLabel: statusLabel(state),
      updatedAt: entry.lifecycle.effectiveSettlementTimestamp ?? timestamp(thread),
      changeRequest: buildChangeRequestBadge(entry.worktree),
      attentionState: entry.lifecycle.classification,
      canSettle: entry.lifecycle.eligibility.canSettle,
      settlementBlocker: entry.lifecycle.settlementBlocker,
      mutationEnabled: entry.mutationEnabled,
      mutationBlocker: entry.mutationBlocker,
    };
  };

  const active = model.active.map(toRow);
  const settled = model.settled.map(toRow);

  const sections: InboxSection[] = [];
  if (active.length > 0) sections.push({ key: "active", title: "Active", rows: active });
  if (settled.length > 0) sections.push({ key: "settled", title: "Settled", rows: settled });
  return sections;
}

export type InboxEmptyState = "connect-node" | "add-project" | "new-task" | "clear-filter" | null;

export function resolveInboxEmptyState(input: {
  readonly environmentCount: number;
  readonly projectCount: number;
  readonly threadCount: number;
  readonly hasFilter: boolean;
}): InboxEmptyState {
  if (input.environmentCount === 0) return "connect-node";
  if (input.projectCount === 0) return "add-project";
  if (input.threadCount === 0) return "new-task";
  if (input.hasFilter) return "clear-filter";
  return null;
}
