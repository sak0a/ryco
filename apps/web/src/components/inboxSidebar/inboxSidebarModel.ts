import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@ryco/client-runtime/scoped";
import { PROVIDER_OPTIONS } from "@ryco/client-runtime/state/session";
import type {
  Project,
  SidebarThreadSummary,
  SidebarWorktreeSummary,
} from "@ryco/client-runtime/state/threads";
import {
  defaultInstanceIdForDriver,
  type EnvironmentId,
  type ProviderDriverKind,
  type ThreadId,
} from "@ryco/contracts";

export type InboxSidebarThreadState =
  | "needs-input"
  | "delivery-unknown"
  | "working"
  | "connecting"
  | "error"
  | "reconnecting"
  | "offline"
  | "idle";

export type InboxSidebarSectionKey = "active" | "needs-input" | "recent";
export type InboxSidebarStatusFilter = "all" | InboxSidebarSectionKey;

export interface InboxSidebarEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connectionState: "connected" | "connecting" | "reconnecting" | "offline";
  readonly stale: boolean;
  readonly staleDetail?: string;
  readonly role: "viewer" | "operator" | "owner" | "client" | null;
  readonly trust: "not-required" | "unknown" | "unverified" | "verified" | "identity-conflict";
  readonly deliveryUnknown: boolean;
}

export interface InboxSidebarRow {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly machineLabel: string;
  readonly projectLabel: string;
  readonly workspaceLabel: string;
  readonly contextLabel: string;
  readonly state: InboxSidebarThreadState;
  readonly statusLabel: string;
  readonly updatedAt: string;
  readonly providerDriver: ProviderDriverKind | null;
  readonly providerLabel: string | null;
  readonly trustLabel: "Not verified" | "Identity conflict" | null;
  readonly roleLabel: "Viewer" | null;
}

export interface InboxSidebarSection {
  readonly key: InboxSidebarSectionKey;
  readonly title: "Active now" | "Needs input" | "Recent";
  readonly rows: ReadonlyArray<InboxSidebarRow>;
}

export interface InboxSidebarFilters {
  readonly query: string;
  readonly environmentId: EnvironmentId | null;
  readonly status: InboxSidebarStatusFilter;
}

export interface BuildInboxSidebarInput {
  readonly projects: ReadonlyArray<Project>;
  readonly worktrees: ReadonlyArray<SidebarWorktreeSummary>;
  readonly threads: ReadonlyArray<SidebarThreadSummary>;
  readonly environments: ReadonlyArray<InboxSidebarEnvironment>;
  readonly filters: InboxSidebarFilters;
  readonly deliveryUnknownThreadKeys?: ReadonlySet<string>;
}

const ACTIVE_PRIORITY: Readonly<
  Record<Exclude<InboxSidebarThreadState, "idle" | "offline" | "needs-input">, number>
> = {
  "delivery-unknown": 0,
  error: 1,
  working: 2,
  connecting: 3,
  reconnecting: 4,
};

function resolveProviderDriver(thread: SidebarThreadSummary): ProviderDriverKind | null {
  const direct = thread.session?.provider ?? thread.providerDriver ?? null;
  if (direct) return direct;
  const instanceId = thread.modelSelection?.instanceId;
  if (!instanceId) return null;
  return (
    PROVIDER_OPTIONS.find((option) => defaultInstanceIdForDriver(option.value) === instanceId)
      ?.value ?? null
  );
}

function resolveThreadState(
  thread: SidebarThreadSummary,
  environment: InboxSidebarEnvironment | undefined,
  deliveryUnknownThreadKeys: ReadonlySet<string>,
): InboxSidebarThreadState {
  if (environment?.stale || environment?.connectionState === "offline") return "offline";
  if (
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.hasActionableProposedPlan
  ) {
    return "needs-input";
  }
  if (
    environment?.deliveryUnknown ||
    deliveryUnknownThreadKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)))
  ) {
    return "delivery-unknown";
  }
  if (thread.latestTurn?.state === "running" || thread.backgroundLiveness === "working") {
    return "working";
  }
  if (thread.session?.status === "connecting" || environment?.connectionState === "connecting") {
    return "connecting";
  }
  if (thread.session?.status === "error" || thread.latestTurn?.state === "error") return "error";
  if (environment?.connectionState === "reconnecting") return "reconnecting";
  return "idle";
}

function statusLabel(
  state: InboxSidebarThreadState,
  environment: InboxSidebarEnvironment | undefined,
): string {
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
      return environment?.staleDetail ?? "Offline";
    case "idle":
      return "Idle";
  }
}

function sectionKey(state: InboxSidebarThreadState): InboxSidebarSectionKey {
  if (state === "needs-input") return "needs-input";
  if (state === "idle" || state === "offline") return "recent";
  return "active";
}

function timestamp(thread: SidebarThreadSummary): string {
  return thread.updatedAt ?? thread.latestUserMessageAt ?? thread.createdAt;
}

function compareRecent(left: InboxSidebarRow, right: InboxSidebarRow): number {
  const delta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  if (Number.isFinite(delta) && delta !== 0) return delta;
  return left.key.localeCompare(right.key);
}

function compareActive(left: InboxSidebarRow, right: InboxSidebarRow): number {
  const leftPriority = ACTIVE_PRIORITY[left.state as keyof typeof ACTIVE_PRIORITY] ?? 0;
  const rightPriority = ACTIVE_PRIORITY[right.state as keyof typeof ACTIVE_PRIORITY] ?? 0;
  return leftPriority - rightPriority || compareRecent(left, right);
}

export function buildInboxSidebarSections(
  input: BuildInboxSidebarInput,
): ReadonlyArray<InboxSidebarSection> {
  const environmentById = new Map(
    input.environments.map((environment) => [environment.environmentId, environment] as const),
  );
  const projectByKey = new Map(
    input.projects.map(
      (project) =>
        [scopedProjectKey(scopeProjectRef(project.environmentId, project.id)), project] as const,
    ),
  );
  const worktreeByKey = new Map<string, SidebarWorktreeSummary>(
    input.worktrees.map(
      (worktree) => [`${worktree.environmentId}:${worktree.id}`, worktree] as const,
    ),
  );
  const deliveryUnknownThreadKeys = input.deliveryUnknownThreadKeys ?? new Set<string>();
  const normalizedQuery = input.filters.query.trim().toLocaleLowerCase();

  const rows: InboxSidebarRow[] = [];
  for (const thread of input.threads) {
    if (thread.archivedAt !== null) continue;
    if (input.filters.environmentId && thread.environmentId !== input.filters.environmentId) {
      continue;
    }
    const environment = environmentById.get(thread.environmentId);
    const project = projectByKey.get(
      scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
    );
    const worktree = thread.worktreeId
      ? worktreeByKey.get(`${thread.environmentId}:${thread.worktreeId}`)
      : undefined;
    const machineLabel = environment?.label ?? "Unknown machine";
    const projectLabel = project?.name ?? "Unknown project";
    const workspaceLabel =
      worktree?.title ?? worktree?.branch ?? thread.branch ?? "Local workspace";
    const contextLabel = `${machineLabel} · ${projectLabel} · ${workspaceLabel}`;
    if (
      normalizedQuery &&
      !`${thread.title} ${contextLabel}`.toLocaleLowerCase().includes(normalizedQuery)
    ) {
      continue;
    }
    const state = resolveThreadState(thread, environment, deliveryUnknownThreadKeys);
    const rowSection = sectionKey(state);
    if (input.filters.status !== "all" && input.filters.status !== rowSection) continue;
    const providerDriver = resolveProviderDriver(thread);
    rows.push({
      key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      environmentId: thread.environmentId,
      threadId: thread.id,
      title: thread.title || "Untitled task",
      machineLabel,
      projectLabel,
      workspaceLabel,
      contextLabel,
      state,
      statusLabel: statusLabel(state, environment),
      updatedAt: timestamp(thread),
      providerDriver,
      providerLabel:
        PROVIDER_OPTIONS.find((option) => option.value === providerDriver)?.label ??
        providerDriver ??
        null,
      trustLabel:
        environment?.trust === "unverified"
          ? "Not verified"
          : environment?.trust === "identity-conflict"
            ? "Identity conflict"
            : null,
      roleLabel: environment?.role === "viewer" ? "Viewer" : null,
    });
  }

  const active = rows.filter((row) => sectionKey(row.state) === "active").toSorted(compareActive);
  const needsInput = rows
    .filter((row) => sectionKey(row.state) === "needs-input")
    .toSorted(compareRecent);
  const recent = rows.filter((row) => sectionKey(row.state) === "recent").toSorted(compareRecent);

  return [
    ...(active.length > 0 ? [{ key: "active", title: "Active now", rows: active } as const] : []),
    ...(needsInput.length > 0
      ? [{ key: "needs-input", title: "Needs input", rows: needsInput } as const]
      : []),
    ...(recent.length > 0 ? [{ key: "recent", title: "Recent", rows: recent } as const] : []),
  ];
}
