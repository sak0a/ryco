import type {
  Project,
  SidebarThreadSummary,
  SidebarWorktreeSummary,
  ThreadInboxMutationBlocker,
} from "@ryco/client-runtime/state/threads";
import { buildThreadInbox } from "@ryco/client-runtime/state/threads";
import type { EnvironmentId, ThreadId } from "@ryco/contracts";
import type { ThreadSettlementBlocker } from "@ryco/shared/threadSettlement";
import {
  describeThreadPriorityFocus,
  type ThreadPriorityFocusMetadata,
} from "@ryco/shared/threadPriority";

import { buildChangeRequestBadge, type ChangeRequestBadge } from "../../lib/changeRequestBadge";
import {
  builtInProviderDriverForInstanceId,
  providerDisplayLabel,
} from "../../lib/providerDisplay";
import { NODE_TRUST_UNVERIFIED_LABEL, type NodeTrust } from "../home/nodeTrustModel";

export type InboxThreadState =
  | "needs-input"
  | "delivery-unknown"
  | "working"
  | "connecting"
  | "error"
  | "reconnecting"
  | "offline"
  | "idle"
  | "settled";

export interface InboxEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connectionState: "connected" | "reconnecting" | "offline" | "read-only";
  /**
   * Wave 2: set when this environment's rows are cache-provenance — hydrated
   * from the snapshot cache or demoted after disconnect, with no live snapshot
   * since. Stale rows render as last-known state, never as live, with
   * `staleDetail` carrying the Hub-presence-derived "Offline · last seen" text.
   */
  readonly stale?: boolean;
  readonly staleDetail?: string;
  /**
   * Wave 4: the effective role on this environment — the hosted/roster role, or
   * the direct plane's `"client"` / `"owner"`. Absent when the plane reports
   * none; it is never defaulted, because "no role known" and "viewer" differ in
   * exactly what the user may do.
   */
  readonly role?: "viewer" | "operator" | "owner" | "client";
  /**
   * Wave 4: per-node E2EE trust, DISPLAY ONLY (see `nodeTrustModel.ts`). Absent
   * whenever this device has no evidence to claim from — never defaulted to
   * `"unverified"`, which would be a fabricated claim.
   */
  readonly trust?: NodeTrust;
  /** Wave 3b: this environment, not the whole app, has an unconfirmed send. */
  readonly deliveryUnknown?: boolean;
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
  /**
   * Wave 4: the node this row lives on is one the owner has not verified, in
   * client-runtime's own words. `null` means no claim — either the node is
   * verified or this device holds no evidence either way. It never replaces
   * {@link statusLabel}: staleness and trust are independent facts about the
   * row and compose beside each other.
   */
  readonly trustLabel: string | null;
  /**
   * Wave 4: a quiet neutral marker, surfaced only for `viewer` — the one role
   * that changes what the user may do here. Owner and operator render nothing;
   * a badge on every row would be provenance turned into noise. The word
   * matches HubNodeSection's `ROLE_LABELS`.
   */
  readonly roleLabel: "Viewer" | null;
  /** Current provider brand for the task; null renders the neutral mark. */
  readonly providerDriver: string | null;
  readonly providerLabel: string | null;
  readonly focus: ThreadPriorityFocusMetadata | null;
  readonly focusTitle: string | null;
  readonly focusDetail: string | null;
  readonly focusAiGenerated: boolean;
  readonly attentionState: "active" | "settled";
  readonly canSettle: boolean;
  readonly settlementBlocker: ThreadSettlementBlocker | null;
  readonly mutationEnabled: boolean;
  readonly mutationBlocker: ThreadInboxMutationBlocker | null;
}

export interface InboxSection {
  readonly key: "focus" | "active" | "settled";
  readonly title: "Focus" | "Active" | "Settled";
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
  readonly pinnedThreadKeys?: ReadonlySet<string> | ReadonlyArray<string>;
  readonly aiFocusEnabled?: boolean;
  readonly nowMs?: number;
}

function scopedKey(environmentId: EnvironmentId, id: string): string {
  return `${environmentId}:${id}`;
}

function threadState(
  thread: SidebarThreadSummary,
  environment: InboxEnvironment | undefined,
  deliveryUnknownThreadIds: ReadonlySet<string>,
): InboxThreadState {
  // A stale environment's rows are last-known state: nothing on them may
  // present as live activity (or as actionable), whatever the cached fields
  // claim. Sourced from Hub presence via the environment row, not WS status.
  if (environment?.stale) return "offline";
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return "needs-input";
  if (
    environment?.deliveryUnknown === true ||
    deliveryUnknownThreadIds.has(scopedKey(thread.environmentId, thread.id))
  ) {
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
    case "offline":
      return "Offline";
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
  const inbox = buildThreadInbox({
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
    pinnedThreadKeys: input.pinnedThreadKeys,
    aiFocusEnabled: input.aiFocusEnabled ?? false,
    filters: {
      ...(input.nodeScope ? { environmentIds: [input.nodeScope] } : {}),
      text: input.query,
    },
    nowMs: input.nowMs ?? Date.now(),
  });

  const toRow = (entry: (typeof inbox.active)[number]): InboxThreadRow => {
    const thread = entry.thread!;
    const environment = environmentById.get(thread.environmentId);
    const nodeLabel = environment?.label || "Unknown machine";
    const projectLabel = entry.project?.name || "Unknown project";
    const worktreeLabel =
      entry.worktree?.title || entry.worktree?.branch || thread.branch || "Local workspace";
    const contextLabel = `${nodeLabel} · ${projectLabel} · ${worktreeLabel}`;
    const state =
      entry.lifecycle.classification === "settled"
        ? "settled"
        : threadState(thread, environment, deliveryUnknown);
    const providerDriver =
      thread.session?.provider ??
      thread.providerDriver ??
      builtInProviderDriverForInstanceId(thread.modelSelection?.instanceId);
    const focusExplanation = entry.focus === null ? null : describeThreadPriorityFocus(entry.focus);
    return {
      key: entry.key,
      environmentId: thread.environmentId,
      threadId: thread.id,
      title: entry.title || "Untitled task",
      nodeLabel,
      projectLabel,
      worktreeLabel,
      contextLabel,
      state,
      statusLabel:
        state === "offline" ? (environment?.staleDetail ?? "Offline") : statusLabel(state),
      updatedAt: entry.lifecycle.effectiveSettlementTimestamp ?? timestamp(thread),
      changeRequest: buildChangeRequestBadge(entry.worktree),
      trustLabel: environment?.trust === "unverified" ? NODE_TRUST_UNVERIFIED_LABEL : null,
      roleLabel: environment?.role === "viewer" ? "Viewer" : null,
      providerDriver,
      providerLabel: providerDisplayLabel(providerDriver),
      focus: entry.focus,
      focusTitle: focusExplanation?.title ?? null,
      focusDetail: focusExplanation?.detail ?? null,
      focusAiGenerated: focusExplanation?.aiGenerated ?? false,
      attentionState: entry.lifecycle.classification,
      canSettle: entry.lifecycle.eligibility.canSettle,
      settlementBlocker: entry.lifecycle.settlementBlocker,
      mutationEnabled: entry.mutationEnabled,
      mutationBlocker: entry.mutationBlocker,
    };
  };

  const focus = inbox.focus.map(toRow);
  const active = inbox.active.map(toRow);
  const settled = inbox.settled.map(toRow);

  const sections: InboxSection[] = [];
  if (focus.length > 0) sections.push({ key: "focus", title: "Focus", rows: focus });
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
