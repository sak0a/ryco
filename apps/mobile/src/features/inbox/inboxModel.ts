import type {
  Project,
  SidebarThreadSummary,
  SidebarWorktreeSummary,
} from "@ryco/client-runtime/state/threads";
import type { EnvironmentId, ThreadId } from "@ryco/contracts";

import { buildChangeRequestBadge, type ChangeRequestBadge } from "../../lib/changeRequestBadge";
import { NODE_TRUST_UNVERIFIED_LABEL, type NodeTrust } from "../home/nodeTrustModel";

export type InboxThreadState =
  | "needs-input"
  | "delivery-unknown"
  | "working"
  | "connecting"
  | "error"
  | "reconnecting"
  | "offline"
  | "idle";

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
}

export interface InboxSection {
  readonly key: "active" | "recent";
  readonly title: "Active now" | "Recent";
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
}

const ACTIVE_PRIORITY: Readonly<Record<Exclude<InboxThreadState, "idle" | "offline">, number>> = {
  "needs-input": 0,
  "delivery-unknown": 1,
  error: 2,
  working: 3,
  connecting: 4,
  reconnecting: 5,
};

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
  }
}

function timestamp(thread: SidebarThreadSummary): string {
  return thread.updatedAt ?? thread.latestUserMessageAt ?? thread.createdAt;
}

function compareRecent(left: InboxThreadRow, right: InboxThreadRow): number {
  const delta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  if (Number.isFinite(delta) && delta !== 0) return delta;
  return left.key.localeCompare(right.key);
}

export function buildInboxSections(input: BuildInboxInput): ReadonlyArray<InboxSection> {
  const environmentById = new Map(
    input.environments.map((environment) => [environment.environmentId, environment] as const),
  );
  const projectById = new Map(
    input.projects.map(
      (project) => [scopedKey(project.environmentId, project.id), project] as const,
    ),
  );
  const worktreeById = new Map(
    input.worktrees.map(
      (worktree) => [scopedKey(worktree.environmentId, worktree.id), worktree] as const,
    ),
  );
  const query = input.query?.trim().toLocaleLowerCase() ?? "";
  const deliveryUnknown = input.deliveryUnknownThreadIds ?? new Set<string>();

  const rows: InboxThreadRow[] = [];
  for (const thread of input.threads) {
    if (thread.archivedAt !== null) continue;
    if (input.nodeScope && thread.environmentId !== input.nodeScope) continue;

    const environment = environmentById.get(thread.environmentId);
    const project = projectById.get(scopedKey(thread.environmentId, thread.projectId));
    const worktree = thread.worktreeId
      ? worktreeById.get(scopedKey(thread.environmentId, thread.worktreeId))
      : undefined;
    const nodeLabel = environment?.label || "Unknown machine";
    const projectLabel = project?.name || "Unknown project";
    const worktreeLabel = worktree?.title || worktree?.branch || thread.branch || "Local workspace";
    const contextLabel = `${nodeLabel} · ${projectLabel} · ${worktreeLabel}`;

    if (
      query &&
      !`${thread.title} ${nodeLabel} ${projectLabel} ${worktreeLabel}`
        .toLocaleLowerCase()
        .includes(query)
    ) {
      continue;
    }

    const state = threadState(thread, environment, deliveryUnknown);
    rows.push({
      key: scopedKey(thread.environmentId, thread.id),
      environmentId: thread.environmentId,
      threadId: thread.id,
      title: thread.title || "Untitled task",
      nodeLabel,
      projectLabel,
      worktreeLabel,
      contextLabel,
      state,
      statusLabel:
        state === "offline" ? (environment?.staleDetail ?? "Offline") : statusLabel(state),
      updatedAt: timestamp(thread),
      changeRequest: buildChangeRequestBadge(worktree),
      trustLabel: environment?.trust === "unverified" ? NODE_TRUST_UNVERIFIED_LABEL : null,
      roleLabel: environment?.role === "viewer" ? "Viewer" : null,
    });
  }

  // Stale-environment rows are never "active now" — last-known state sorts
  // with the recents, however lively its cached fields look.
  const active = rows
    .filter((row) => row.state !== "idle" && row.state !== "offline")
    .toSorted((left, right) => {
      const priority =
        ACTIVE_PRIORITY[left.state as Exclude<InboxThreadState, "idle" | "offline">] -
        ACTIVE_PRIORITY[right.state as Exclude<InboxThreadState, "idle" | "offline">];
      return priority || compareRecent(left, right);
    });
  const recent = rows
    .filter((row) => row.state === "idle" || row.state === "offline")
    .toSorted(compareRecent);

  const sections: InboxSection[] = [];
  if (active.length > 0) sections.push({ key: "active", title: "Active now", rows: active });
  if (recent.length > 0) sections.push({ key: "recent", title: "Recent", rows: recent });
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
