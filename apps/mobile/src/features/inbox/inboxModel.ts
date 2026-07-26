import type {
  Project,
  SidebarThreadSummary,
  SidebarWorktreeSummary,
} from "@ryco/client-runtime/state/threads";
import type { EnvironmentId, ThreadId } from "@ryco/contracts";

export type InboxThreadState =
  | "needs-input"
  | "delivery-unknown"
  | "working"
  | "connecting"
  | "error"
  | "reconnecting"
  | "idle";

export interface InboxEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connectionState: "connected" | "reconnecting" | "offline" | "read-only";
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

const ACTIVE_PRIORITY: Readonly<Record<Exclude<InboxThreadState, "idle">, number>> = {
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
    const nodeLabel = environment?.label || "Unknown node";
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
      statusLabel: statusLabel(state),
      updatedAt: timestamp(thread),
    });
  }

  const active = rows
    .filter((row) => row.state !== "idle")
    .sort((left, right) => {
      const priority =
        ACTIVE_PRIORITY[left.state as Exclude<InboxThreadState, "idle">] -
        ACTIVE_PRIORITY[right.state as Exclude<InboxThreadState, "idle">];
      return priority || compareRecent(left, right);
    });
  const recent = rows.filter((row) => row.state === "idle").sort(compareRecent);

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
