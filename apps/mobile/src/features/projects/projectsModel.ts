import type {
  Project,
  SidebarThreadSummary,
  SidebarWorktreeSummary,
} from "@ryco/client-runtime/state/threads";
import type { EnvironmentId, ProjectId } from "@ryco/contracts";

export interface ProjectEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connectionState: "connected" | "reconnecting" | "offline" | "read-only";
  /** Wave 2 cache provenance — see InboxEnvironment (structurally identical). */
  readonly stale?: boolean;
  readonly staleDetail?: string;
}

export interface ProjectListRow {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly path: string;
  readonly worktreeCount: number;
  readonly activeThreadCount: number;
  readonly updatedAt: string | null;
}

export interface ProjectNodeGroup {
  readonly environmentId: EnvironmentId;
  readonly nodeLabel: string;
  readonly connectionState: ProjectEnvironment["connectionState"];
  /** Set for cache-provenance groups: the "Offline · last seen" header detail. */
  readonly staleDetail?: string;
  readonly rows: ReadonlyArray<ProjectListRow>;
}

export interface ProjectWorktreeGroup {
  readonly worktree: SidebarWorktreeSummary;
  readonly threads: ReadonlyArray<SidebarThreadSummary>;
}

export interface ProjectDetailModel {
  readonly project: Project;
  readonly environment: ProjectEnvironment | null;
  readonly activeWorktrees: ReadonlyArray<ProjectWorktreeGroup>;
  readonly archivedWorktrees: ReadonlyArray<ProjectWorktreeGroup>;
  readonly projectThreads: ReadonlyArray<SidebarThreadSummary>;
}

function scopedKey(environmentId: EnvironmentId, id: string): string {
  return `${environmentId}:${id}`;
}

function newestFirst(
  left: { readonly updatedAt?: string | undefined; readonly createdAt?: string | undefined },
  right: { readonly updatedAt?: string | undefined; readonly createdAt?: string | undefined },
): number {
  const leftTime = Date.parse(left.updatedAt ?? left.createdAt ?? "");
  const rightTime = Date.parse(right.updatedAt ?? right.createdAt ?? "");
  const delta = rightTime - leftTime;
  return Number.isFinite(delta) ? delta : 0;
}

export function buildProjectDetail(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projects: ReadonlyArray<Project>;
  readonly worktrees: ReadonlyArray<SidebarWorktreeSummary>;
  readonly threads: ReadonlyArray<SidebarThreadSummary>;
  readonly environments: ReadonlyArray<ProjectEnvironment>;
}): ProjectDetailModel | null {
  const project = input.projects.find(
    (candidate) =>
      candidate.environmentId === input.environmentId && candidate.id === input.projectId,
  );
  if (!project) return null;

  const worktrees = input.worktrees
    .filter(
      (worktree) =>
        worktree.environmentId === input.environmentId && worktree.projectId === input.projectId,
    )
    .toSorted(newestFirst);
  const threads = input.threads
    .filter(
      (thread) =>
        thread.environmentId === input.environmentId &&
        thread.projectId === input.projectId &&
        thread.archivedAt === null,
    )
    .toSorted(newestFirst);
  const threadsByWorktree = new Map<string, SidebarThreadSummary[]>();
  for (const thread of threads) {
    if (!thread.worktreeId) continue;
    const current = threadsByWorktree.get(thread.worktreeId) ?? [];
    current.push(thread);
    threadsByWorktree.set(thread.worktreeId, current);
  }
  const groups = worktrees.map((worktree) => ({
    worktree,
    threads: threadsByWorktree.get(worktree.id) ?? [],
  }));

  return {
    project,
    environment:
      input.environments.find((environment) => environment.environmentId === input.environmentId) ??
      null,
    activeWorktrees: groups.filter((group) => group.worktree.archivedAt === null),
    archivedWorktrees: groups.filter((group) => group.worktree.archivedAt !== null),
    projectThreads: threads.filter((thread) => !thread.worktreeId),
  };
}

export function buildProjectNodeGroups(input: {
  readonly projects: ReadonlyArray<Project>;
  readonly worktrees: ReadonlyArray<SidebarWorktreeSummary>;
  readonly threads: ReadonlyArray<SidebarThreadSummary>;
  readonly environments: ReadonlyArray<ProjectEnvironment>;
  readonly nodeScope?: EnvironmentId | null;
  readonly query?: string;
}): ReadonlyArray<ProjectNodeGroup> {
  const query = input.query?.trim().toLocaleLowerCase() ?? "";
  const worktreeCountByProject = new Map<string, number>();
  for (const worktree of input.worktrees) {
    if (worktree.archivedAt !== null) continue;
    const key = scopedKey(worktree.environmentId, worktree.projectId);
    worktreeCountByProject.set(key, (worktreeCountByProject.get(key) ?? 0) + 1);
  }
  const threadsByProject = new Map<string, SidebarThreadSummary[]>();
  for (const thread of input.threads) {
    if (thread.archivedAt !== null) continue;
    const key = scopedKey(thread.environmentId, thread.projectId);
    const threads = threadsByProject.get(key) ?? [];
    threads.push(thread);
    threadsByProject.set(key, threads);
  }

  const rowsByEnvironment = new Map<EnvironmentId, ProjectListRow[]>();
  for (const project of input.projects) {
    if (input.nodeScope && project.environmentId !== input.nodeScope) continue;
    if (query && !`${project.name} ${project.cwd}`.toLocaleLowerCase().includes(query)) continue;

    const key = scopedKey(project.environmentId, project.id);
    const threads = threadsByProject.get(key) ?? [];
    const updatedAt =
      threads
        .map((thread) => thread.updatedAt ?? thread.createdAt)
        .toSorted((left, right) => Date.parse(right) - Date.parse(left))[0] ??
      project.updatedAt ??
      project.createdAt ??
      null;
    const row: ProjectListRow = {
      key,
      environmentId: project.environmentId,
      projectId: project.id,
      title: project.name || "Untitled project",
      path: project.cwd,
      worktreeCount: worktreeCountByProject.get(key) ?? 0,
      activeThreadCount: threads.length,
      updatedAt,
    };
    const rows = rowsByEnvironment.get(project.environmentId) ?? [];
    rows.push(row);
    rowsByEnvironment.set(project.environmentId, rows);
  }

  const groups: ProjectNodeGroup[] = [];
  for (const environment of input.environments) {
    const rows = rowsByEnvironment.get(environment.environmentId) ?? [];
    if (rows.length === 0) continue;
    const sortedRows = rows.toSorted((left, right) => {
      const delta = Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? "");
      if (Number.isFinite(delta) && delta !== 0) return delta;
      return left.title.localeCompare(right.title);
    });
    groups.push({
      environmentId: environment.environmentId,
      nodeLabel: environment.label,
      connectionState: environment.connectionState,
      ...(environment.stale && environment.staleDetail
        ? { staleDetail: environment.staleDetail }
        : {}),
      rows: sortedRows,
    });
  }
  return groups;
}
