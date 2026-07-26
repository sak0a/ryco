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
  readonly rows: ReadonlyArray<ProjectListRow>;
}

function scopedKey(environmentId: EnvironmentId, id: string): string {
  return `${environmentId}:${id}`;
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
        .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ??
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
    rows.sort((left, right) => {
      const delta = Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? "");
      if (Number.isFinite(delta) && delta !== 0) return delta;
      return left.title.localeCompare(right.title);
    });
    groups.push({
      environmentId: environment.environmentId,
      nodeLabel: environment.label,
      connectionState: environment.connectionState,
      rows,
    });
  }
  return groups;
}
