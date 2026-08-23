import { EnvironmentId, type OrchestrationShellSnapshot } from "@ryco/contracts";
import { scopeThreadRef } from "@ryco/client-runtime/scoped";
import { describe, expect, it } from "vite-plus/test";

import {
  demoteEnvironmentStateToCachedSnapshot,
  hydrateEnvironmentStateFromCache,
  selectBootstrapCompleteForEnvironment,
  selectCacheHydratedEnvironmentIds,
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  selectSidebarWorktreesAcrossEnvironments,
  selectThreadByRef,
  setThreadError,
  syncServerShellSnapshot,
  type AppState,
  type CachedEnvironmentShellSnapshot,
  type Project,
  type SidebarThreadSummary,
  type ThreadShell,
  type ThreadSession,
} from "./store.ts";

const ENV_A = EnvironmentId.make("env-cache-a");
const ENV_B = EnvironmentId.make("env-cache-b");

const EMPTY_STATE: AppState = { activeEnvironmentId: null, environmentStateById: {} };

function project(environmentId: EnvironmentId, id: string): Project {
  return {
    id: id as never,
    environmentId,
    name: id,
    cwd: `/${id}`,
    defaultModelSelection: null,
    scripts: [],
  };
}

function shell(environmentId: EnvironmentId, id: string, projectId: string): ThreadShell {
  return {
    id: id as never,
    environmentId,
    codexThreadId: null,
    projectId: projectId as never,
    title: id,
    modelSelection: { model: "claude" } as never,
    runtimeMode: "full-access",
    interactionMode: "default",
    error: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    archivedAt: null,
    branch: null,
    worktreePath: null,
  };
}

function summary(
  environmentId: EnvironmentId,
  id: string,
  projectId: string,
): SidebarThreadSummary {
  return {
    id: id as never,
    environmentId,
    projectId: projectId as never,
    title: id,
    interactionMode: "default",
    session: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

function cachedSnapshot(environmentId: EnvironmentId): CachedEnvironmentShellSnapshot {
  return {
    capturedAt: 1_755_000_000_000,
    projects: [project(environmentId, "project-1")],
    worktrees: [],
    threads: [
      {
        shell: shell(environmentId, "thread-1", "project-1"),
        summary: summary(environmentId, "thread-1", "project-1"),
      },
    ],
  };
}

const EMPTY_WIRE_SNAPSHOT = {
  snapshotSequence: 1,
  projects: [],
  worktrees: [],
  threads: [],
  updatedAt: "2026-08-20T00:00:00.000Z",
} as unknown as OrchestrationShellSnapshot;

describe("cache hydration", () => {
  it("keeps shell readiness and thread errors scoped when raw ids collide", () => {
    let state = hydrateEnvironmentStateFromCache(EMPTY_STATE, cachedSnapshot(ENV_A), ENV_A);
    state = hydrateEnvironmentStateFromCache(state, cachedSnapshot(ENV_B), ENV_B);

    expect(selectBootstrapCompleteForEnvironment(state, ENV_A)).toBe(false);
    expect(selectBootstrapCompleteForEnvironment(state, ENV_B)).toBe(false);

    state = setThreadError(state, scopeThreadRef(ENV_B, "thread-1" as never), "node B failed");

    expect(selectThreadByRef(state, scopeThreadRef(ENV_A, "thread-1" as never))?.error).toBeNull();
    expect(selectThreadByRef(state, scopeThreadRef(ENV_B, "thread-1" as never))?.error).toBe(
      "node B failed",
    );

    state = syncServerShellSnapshot(state, EMPTY_WIRE_SNAPSHOT, ENV_A);
    expect(selectBootstrapCompleteForEnvironment(state, ENV_A)).toBe(true);
    expect(selectBootstrapCompleteForEnvironment(state, ENV_B)).toBe(false);
  });

  it("renders the union of hydrated environments through the across-environment selectors", () => {
    let state = hydrateEnvironmentStateFromCache(EMPTY_STATE, cachedSnapshot(ENV_A), ENV_A);
    state = hydrateEnvironmentStateFromCache(state, cachedSnapshot(ENV_B), ENV_B);

    expect(selectProjectsAcrossEnvironments(state).map((row) => row.environmentId)).toEqual([
      ENV_A,
      ENV_B,
    ]);
    expect(selectSidebarThreadsAcrossEnvironments(state).map((row) => row.environmentId)).toEqual([
      ENV_A,
      ENV_B,
    ]);
    expect(selectSidebarWorktreesAcrossEnvironments(state)).toEqual([]);
    expect(selectCacheHydratedEnvironmentIds(state)).toEqual([ENV_A, ENV_B]);
    expect(state.environmentStateById[ENV_A]?.bootstrapComplete).toBe(false);
    expect(state.environmentStateById[ENV_A]?.hydratedFromCacheAt).toBe(1_755_000_000_000);
    expect(
      state.environmentStateById[ENV_A]?.sidebarThreadSummaryById["thread-1" as never]
        ?.modelSelection,
    ).toEqual(
      state.environmentStateById[ENV_A]?.threadShellById["thread-1" as never]?.modelSelection,
    );
  });

  it("is a no-op when the environment already has state — live data wins the race", () => {
    const live = syncServerShellSnapshot(EMPTY_STATE, EMPTY_WIRE_SNAPSHOT, ENV_A);
    const hydrated = hydrateEnvironmentStateFromCache(live, cachedSnapshot(ENV_A), ENV_A);
    expect(hydrated).toBe(live);
    expect(selectProjectsAcrossEnvironments(hydrated)).toEqual([]);
  });

  it("drops rows whose embedded environmentId does not match the hydration target", () => {
    const foreign: CachedEnvironmentShellSnapshot = {
      capturedAt: 1,
      projects: [project(ENV_B, "project-x")],
      worktrees: [],
      threads: [
        {
          shell: shell(ENV_B, "thread-x", "project-x"),
          summary: summary(ENV_B, "thread-x", "project-x"),
        },
      ],
    };
    const state = hydrateEnvironmentStateFromCache(EMPTY_STATE, foreign, ENV_A);
    expect(selectProjectsAcrossEnvironments(state)).toEqual([]);
    expect(selectSidebarThreadsAcrossEnvironments(state)).toEqual([]);
  });

  it("clears cache provenance when a live shell snapshot is applied", () => {
    let state = hydrateEnvironmentStateFromCache(EMPTY_STATE, cachedSnapshot(ENV_A), ENV_A);
    state = syncServerShellSnapshot(state, EMPTY_WIRE_SNAPSHOT, ENV_A);
    expect(state.environmentStateById[ENV_A]?.hydratedFromCacheAt).toBeUndefined();
    expect(state.environmentStateById[ENV_A]?.bootstrapComplete).toBe(true);
    expect(selectCacheHydratedEnvironmentIds(state)).toEqual([]);
  });

  it("demotes a live environment to last-known state, dropping sessions and liveness", () => {
    const session: ThreadSession = {
      provider: "claudeAgent" as never,
      status: "ready",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      orchestrationStatus: "idle" as never,
    };
    let state = hydrateEnvironmentStateFromCache(EMPTY_STATE, cachedSnapshot(ENV_A), ENV_A);
    const environmentState = state.environmentStateById[ENV_A];
    if (!environmentState) throw new Error("missing environment state");
    state = {
      ...state,
      environmentStateById: {
        ...state.environmentStateById,
        [ENV_A]: {
          ...environmentState,
          bootstrapComplete: true,
          hydratedFromCacheAt: undefined,
          threadSessionById: { ["thread-1" as never]: session },
          sidebarThreadSummaryById: {
            ["thread-1" as never]: {
              ...summary(ENV_A, "thread-1", "project-1"),
              session,
              backgroundLiveness: "working",
            },
          },
        },
      },
    };

    const demoted = demoteEnvironmentStateToCachedSnapshot(state, ENV_A, 42);
    const demotedEnvironment = demoted.environmentStateById[ENV_A];
    expect(demotedEnvironment?.bootstrapComplete).toBe(false);
    expect(demotedEnvironment?.hydratedFromCacheAt).toBe(42);
    expect(demotedEnvironment?.threadSessionById["thread-1" as never]).toBeNull();
    expect(demotedEnvironment?.sidebarThreadSummaryById["thread-1" as never]).toMatchObject({
      session: null,
      backgroundLiveness: null,
    });
    // Rows stay rendered — demotion never blanks the environment.
    expect(selectSidebarThreadsAcrossEnvironments(demoted)).toHaveLength(1);
  });

  it("demote is a no-op for an unknown environment", () => {
    expect(demoteEnvironmentStateToCachedSnapshot(EMPTY_STATE, ENV_A, 1)).toBe(EMPTY_STATE);
  });
});
