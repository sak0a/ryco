import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@ryco/client-runtime";
import type { ProjectId } from "@ryco/contracts";
import type { DraftId, DraftThreadState } from "../../composerDraftStore";
import {
  DEFAULT_AGENT_TOKEN_MODE,
  DEFAULT_INTERACTION_MODE,
  type Project,
  type SidebarThreadSummary,
  type SidebarWorktreeSummary,
} from "../../types";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import {
  resolveThreadStatusPill,
  type SidebarStatusBucket,
  type ThreadStatusPill,
} from "../Sidebar.logic";
import type {
  SidebarTreeThread,
  SidebarWorktree,
  SidebarWorktreeOrigin,
} from "./hooks/useSidebarTree";

const STATUS_BUCKETS = new Set<SidebarStatusBucket>(["idle", "in_progress", "review", "done"]);
const WORKTREE_ORIGINS = new Set<SidebarWorktreeOrigin>([
  "main",
  "branch",
  "pr",
  "issue",
  "manual",
]);

export interface SidebarTreeAdapterInput {
  lastVisitedAtByThreadKey?: ReadonlyMap<string, string | null> | undefined;
  project: SidebarProjectSnapshot;
  threads: ReadonlyArray<SidebarThreadSummary>;
  worktrees?: ReadonlyArray<SidebarWorktreeSummary> | undefined;
}

export interface SidebarTreeAdapterOutput {
  project: Project;
  threads: ReadonlyArray<SidebarTreeThread>;
  worktrees: ReadonlyArray<SidebarWorktree>;
}

export function adaptProjectForSidebarTree(
  input: SidebarTreeAdapterInput,
): SidebarTreeAdapterOutput {
  const logicalProjectId = input.project.projectKey as ProjectId;
  const project: Project = {
    ...input.project,
    id: logicalProjectId,
  };
  const threads = input.threads.map((thread) =>
    adaptThreadForSidebarTree({
      lastVisitedAt:
        input.lastVisitedAtByThreadKey?.get(
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ) ?? null,
      logicalProjectId,
      thread,
    }),
  );
  const explicitWorktrees = readExplicitWorktrees(
    input.project,
    logicalProjectId,
    input.worktrees ?? [],
  );
  const synthesizedWorktrees = synthesizeWorktreesFromThreads({
    logicalProjectId,
    project: input.project,
    threads,
  });
  const worktreesById = new Map<string, SidebarWorktree>();
  for (const worktree of [...synthesizedWorktrees, ...explicitWorktrees]) {
    worktreesById.set(worktree.worktreeId, worktree);
  }

  return {
    project,
    threads,
    worktrees: [...worktreesById.values()],
  };
}

export function adaptDraftThreadsForSidebarProject(input: {
  draftThreadsByThreadKey: Readonly<Record<string, DraftThreadState>>;
  project: SidebarProjectSnapshot;
}): ReadonlyArray<SidebarTreeThread> {
  const memberProjectKeys = getSidebarProjectMemberKeys(input.project);

  return Object.entries(input.draftThreadsByThreadKey).flatMap(([draftId, draftThread]) => {
    if (!draftThreadBelongsToSidebarProject(draftThread, memberProjectKeys)) {
      return [];
    }
    return [
      adaptDraftThreadForSidebarTree({
        draftId: draftId as DraftId,
        logicalProjectId: input.project.projectKey as ProjectId,
        draftThread,
      }),
    ];
  });
}

export function createSidebarProjectDraftThreadsSelector(
  project: SidebarProjectSnapshot,
): (state: {
  readonly draftThreadsByThreadKey: Readonly<Record<string, DraftThreadState>>;
}) => ReadonlyArray<SidebarTreeThread> {
  const memberProjectKeys = getSidebarProjectMemberKeys(project);
  const logicalProjectId = project.projectKey as ProjectId;
  let previousMatches: ReadonlyArray<readonly [string, DraftThreadState]> = [];
  let previousRows: ReadonlyArray<SidebarTreeThread> = [];

  return (state) => {
    const matches: Array<readonly [string, DraftThreadState]> = [];
    for (const [draftId, draftThread] of Object.entries(state.draftThreadsByThreadKey)) {
      if (draftThreadBelongsToSidebarProject(draftThread, memberProjectKeys)) {
        matches.push([draftId, draftThread] as const);
      }
    }

    if (
      matches.length === previousMatches.length &&
      matches.every((match, index) => {
        const previous = previousMatches[index];
        return previous?.[0] === match[0] && previous[1] === match[1];
      })
    ) {
      return previousRows;
    }

    previousMatches = matches;
    previousRows = matches.map(([draftId, draftThread]) =>
      adaptDraftThreadForSidebarTree({
        draftId: draftId as DraftId,
        logicalProjectId,
        draftThread,
      }),
    );
    return previousRows;
  };
}

function getSidebarProjectMemberKeys(project: SidebarProjectSnapshot): ReadonlySet<string> {
  return new Set(
    project.memberProjects.map((member) =>
      scopedProjectKey(scopeProjectRef(member.environmentId, member.id)),
    ),
  );
}

function draftThreadBelongsToSidebarProject(
  draftThread: DraftThreadState,
  memberProjectKeys: ReadonlySet<string>,
): boolean {
  if (draftThread.promotedTo != null) {
    return false;
  }
  return memberProjectKeys.has(
    scopedProjectKey(scopeProjectRef(draftThread.environmentId, draftThread.projectId)),
  );
}

function adaptThreadForSidebarTree(input: {
  lastVisitedAt: string | null;
  logicalProjectId: ProjectId;
  thread: SidebarThreadSummary;
}): SidebarTreeThread {
  const extra = input.thread as SidebarThreadSummary & {
    manualBucket?: unknown;
    manualStatusBucket?: unknown;
    statusBucket?: unknown;
    statusPill?: unknown;
    worktreeId?: unknown;
  };
  const statusPill =
    isThreadStatusPill(extra.statusPill) || extra.statusPill === null
      ? extra.statusPill
      : resolveThreadStatusPill({
          thread: {
            ...input.thread,
            ...(input.lastVisitedAt ? { lastVisitedAt: input.lastVisitedAt } : {}),
          },
        });

  return {
    ...input.thread,
    projectId: input.logicalProjectId,
    manualStatusBucket:
      readStatusBucket(extra.manualStatusBucket) ??
      readStatusBucket(extra.manualBucket) ??
      readStatusBucket(extra.statusBucket) ??
      null,
    sourceProjectId: input.thread.projectId,
    statusPill,
    worktreeId: typeof extra.worktreeId === "string" ? extra.worktreeId : null,
  };
}

function adaptDraftThreadForSidebarTree(input: {
  draftId: DraftId;
  logicalProjectId: ProjectId;
  draftThread: DraftThreadState;
}): SidebarTreeThread {
  return {
    archivedAt: null,
    branch: input.draftThread.branch,
    createdAt: input.draftThread.createdAt,
    draftId: input.draftId,
    environmentId: input.draftThread.environmentId,
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    id: input.draftThread.threadId,
    interactionMode: input.draftThread.interactionMode ?? DEFAULT_INTERACTION_MODE,
    tokenMode: input.draftThread.tokenMode ?? DEFAULT_AGENT_TOKEN_MODE,
    latestTurn: null,
    latestUserMessageAt: null,
    manualStatusBucket: null,
    parentSubagentId: null,
    parentThreadId: null,
    projectId: input.logicalProjectId,
    session: null,
    sourceProjectId: input.draftThread.projectId,
    statusPill: null,
    threadKind: "normal",
    title: "Empty Session",
    updatedAt: input.draftThread.createdAt,
    visibility: "normal",
    worktreePath: input.draftThread.worktreePath,
  };
}

function readExplicitWorktrees(
  project: SidebarProjectSnapshot,
  logicalProjectId: ProjectId,
  worktrees: ReadonlyArray<SidebarWorktreeSummary>,
): SidebarWorktree[] {
  const candidates: unknown[] = [...worktrees];
  const members: unknown[] = [project, ...project.memberProjects];
  for (const member of members) {
    const extra = member as Project & {
      sidebarWorktrees?: unknown;
      worktrees?: unknown;
    };
    if (Array.isArray(extra.worktrees)) {
      for (const worktree of extra.worktrees) {
        candidates.push(worktree);
      }
    }
    if (Array.isArray(extra.sidebarWorktrees)) {
      for (const worktree of extra.sidebarWorktrees) {
        candidates.push(worktree);
      }
    }
  }

  return candidates.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") {
      return [];
    }
    const record = candidate as Record<string, unknown>;
    const branch = readString(record.branch);
    if (!branch) {
      return [];
    }
    const worktreePath = readNullableString(record.worktreePath);
    const origin = readWorktreeOrigin(record.origin) ?? (worktreePath === null ? "main" : "manual");
    const worktreeId =
      readString(record.worktreeId) ??
      readString(record.id) ??
      buildWorktreeId({
        branch,
        fallbackIndex: index,
        origin,
        projectId: logicalProjectId,
        worktreePath,
      });

    return [
      {
        archivedAt: readNullableString(record.archivedAt),
        branch,
        issueNumber: readNumber(record.issueNumber),
        manualPosition: readNumber(record.manualPosition),
        origin,
        prNumber: readNumber(record.prNumber),
        prState: readPullRequestState(record.prState),
        prIsDraft: readNullableBoolean(record.prIsDraft),
        issueState: readIssueState(record.issueState),
        workItemProvider: readWorkItemProvider(record.workItemProvider),
        workItemKey: readNullableString(record.workItemKey),
        workItemTitle: readNullableString(record.workItemTitle),
        workItemState: readWorkItemState(record.workItemState),
        workItemStateName: readNullableString(record.workItemStateName),
        workItemUrl: readNullableString(record.workItemUrl),
        projectId: logicalProjectId,
        title: readNullableString(record.title),
        updatedAt: readString(record.updatedAt),
        worktreeId,
        worktreePath,
      },
    ];
  });
}

function readPullRequestState(value: unknown): "open" | "closed" | "merged" | null {
  return value === "open" || value === "closed" || value === "merged" ? value : null;
}

function readIssueState(value: unknown): "open" | "closed" | null {
  return value === "open" || value === "closed" ? value : null;
}

function readWorkItemProvider(value: unknown): "jira" | null {
  return value === "jira" ? value : null;
}

function readWorkItemState(
  value: unknown,
): "open" | "in_progress" | "done" | "closed" | "unknown" | null {
  return value === "open" ||
    value === "in_progress" ||
    value === "done" ||
    value === "closed" ||
    value === "unknown"
    ? value
    : null;
}

function readNullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function synthesizeWorktreesFromThreads(input: {
  logicalProjectId: ProjectId;
  project: SidebarProjectSnapshot;
  threads: ReadonlyArray<SidebarTreeThread>;
}): SidebarWorktree[] {
  const worktreesByKey = new Map<string, SidebarWorktree>();
  const ensureWorktree = (thread: SidebarTreeThread | null, fallbackIndex: number) => {
    const worktreePath = thread?.worktreePath ?? null;
    const branch =
      thread?.branch ?? (worktreePath === null ? "main" : finalPathSegment(worktreePath));
    const origin: SidebarWorktreeOrigin = worktreePath === null ? "main" : "branch";
    const worktreeId =
      thread?.worktreeId ??
      buildWorktreeId({
        branch,
        fallbackIndex,
        origin,
        projectId: input.logicalProjectId,
        worktreePath,
      });
    const existing = worktreesByKey.get(worktreeId);
    const updatedAt = thread?.updatedAt ?? thread?.createdAt ?? input.project.updatedAt;
    if (existing) {
      worktreesByKey.set(worktreeId, {
        ...existing,
        updatedAt: maxIso(existing.updatedAt, updatedAt),
      });
      return;
    }
    worktreesByKey.set(worktreeId, {
      archivedAt: null,
      branch,
      manualPosition: worktreePath === null ? 0 : fallbackIndex + 1,
      origin,
      projectId: input.logicalProjectId,
      title: null,
      updatedAt,
      worktreeId,
      worktreePath,
    });
  };

  ensureWorktree(null, 0);
  input.threads.forEach((thread, index) => ensureWorktree(thread, index));
  return [...worktreesByKey.values()];
}

function buildWorktreeId(input: {
  branch: string;
  fallbackIndex: number;
  origin: SidebarWorktreeOrigin;
  projectId: ProjectId;
  worktreePath: string | null;
}): string {
  const location = input.worktreePath ?? input.branch;
  return `${input.origin}:${input.projectId}:${location || input.fallbackIndex}`;
}

function readStatusBucket(value: unknown): SidebarStatusBucket | null {
  return typeof value === "string" && STATUS_BUCKETS.has(value as SidebarStatusBucket)
    ? (value as SidebarStatusBucket)
    : null;
}

function readWorktreeOrigin(value: unknown): SidebarWorktreeOrigin | null {
  return typeof value === "string" && WORKTREE_ORIGINS.has(value as SidebarWorktreeOrigin)
    ? (value as SidebarWorktreeOrigin)
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isThreadStatusPill(value: unknown): value is ThreadStatusPill {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<ThreadStatusPill>;
  return (
    typeof record.label === "string" &&
    typeof record.colorClass === "string" &&
    typeof record.dotClass === "string" &&
    typeof record.pulse === "boolean"
  );
}

function finalPathSegment(path: string | null): string {
  if (!path) {
    return "worktree";
  }
  return path.split(/[\\/]/).findLast((part) => part.length > 0) ?? path;
}

function maxIso(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isNaN(leftMs)) return right;
  if (Number.isNaN(rightMs)) return left;
  return rightMs > leftMs ? right : left;
}
