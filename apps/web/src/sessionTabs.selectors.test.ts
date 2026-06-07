import { describe, expect, it } from "vitest";
import type { DraftThreadState } from "./composerDraftStore";
import { createSessionTabsSelector, draftThreadToSidebarSummary } from "./sessionTabs.selectors";
import type { SidebarThreadSummary } from "./types";

function makeThread(overrides: Partial<SidebarThreadSummary>): SidebarThreadSummary {
  return {
    id: "t-1" as SidebarThreadSummary["id"],
    environmentId: "env-1" as SidebarThreadSummary["environmentId"],
    projectId: "p-1" as SidebarThreadSummary["projectId"],
    title: "Thread",
    interactionMode: "chat",
    session: null,
    createdAt: "2026-01-01T00:00:00Z",
    archivedAt: null,
    updatedAt: "2026-01-01T00:00:00Z",
    latestTurn: null,
    branch: "main",
    worktreePath: "/tmp/wt",
    worktreeId: "wt-1",
    manualStatusBucket: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  } as SidebarThreadSummary;
}

describe("createSessionTabsSelector", () => {
  it("filters by worktreeId, hides archived, sorts by updatedAt desc", () => {
    const select = createSessionTabsSelector();
    const threads: SidebarThreadSummary[] = [
      makeThread({ id: "a" as never, worktreeId: "wt-1", updatedAt: "2026-01-02T00:00:00Z" }),
      makeThread({
        id: "b" as never,
        worktreeId: "wt-2",
        worktreePath: "/tmp/other-wt",
        updatedAt: "2026-01-03T00:00:00Z",
      }),
      makeThread({ id: "c" as never, worktreeId: "wt-1", updatedAt: "2026-01-01T00:00:00Z" }),
      makeThread({
        id: "d" as never,
        worktreeId: "wt-1",
        archivedAt: "2026-01-04T00:00:00Z",
      }),
    ];
    const result = select(threads, { worktreeId: "wt-1", worktreePath: "/tmp/wt" });
    expect(result.map((item) => item.key.split(":").at(-1))).toEqual(["a", "c"]);
  });

  it("returns the same array reference when inputs are unchanged", () => {
    const select = createSessionTabsSelector();
    const threads = [makeThread({ id: "a" as never })];
    const r1 = select(threads, { worktreeId: "wt-1", worktreePath: "/tmp/wt" });
    const r2 = select(threads, { worktreeId: "wt-1", worktreePath: "/tmp/wt" });
    expect(r2).toBe(r1);
  });

  it("returns same item references when only non-tab fields change", () => {
    const select = createSessionTabsSelector();
    const t1 = makeThread({ id: "a" as never, latestUserMessageAt: null });
    const r1 = select([t1], { worktreeId: "wt-1", worktreePath: "/tmp/wt" });
    const t1Updated = { ...t1, latestUserMessageAt: "2026-01-02T00:00:00Z" };
    const r2 = select([t1Updated], { worktreeId: "wt-1", worktreePath: "/tmp/wt" });
    expect(r2[0]).toBe(r1[0]);
  });

  it("returns a new item reference when the bucket flips", () => {
    const select = createSessionTabsSelector();
    const idle = makeThread({ id: "a" as never });
    const working = {
      ...idle,
      session: {
        provider: "codex",
        status: "running",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        orchestrationStatus: "active",
      } as unknown as SidebarThreadSummary["session"],
    };
    const r1 = select([idle], { worktreeId: "wt-1", worktreePath: "/tmp/wt" });
    const r2 = select([working], { worktreeId: "wt-1", worktreePath: "/tmp/wt" });
    expect(r1[0]?.bucket).toBe("idle");
    expect(r2[0]?.bucket).toBe("in_progress");
    expect(r2[0]).not.toBe(r1[0]);
  });

  it("matches by worktreePath when worktreeId is missing on the thread", () => {
    const select = createSessionTabsSelector();
    const threads = [
      makeThread({ id: "x" as never, worktreeId: undefined, worktreePath: "/tmp/match" }),
      makeThread({ id: "y" as never, worktreeId: undefined, worktreePath: "/tmp/other" }),
    ];
    const result = select(threads, { worktreeId: "wt-1", worktreePath: "/tmp/match" });
    expect(result.map((item) => item.key.split(":").at(-1))).toEqual(["x"]);
  });

  it("includes draft threads adapted via draftThreadToSidebarSummary", () => {
    // Drafts ('empty sessions') live in composerDraftStore. Once converted
    // to a SidebarThreadSummary they should pass the selector and appear
    // alongside server threads.
    const select = createSessionTabsSelector();
    const serverThread = makeThread({
      id: "server-a" as never,
      worktreeId: "wt-1",
      worktreePath: "/tmp/wt",
    });
    const draft: DraftThreadState = {
      threadId: "draft-1" as DraftThreadState["threadId"],
      environmentId: "env-1" as DraftThreadState["environmentId"],
      projectId: "p-1" as DraftThreadState["projectId"],
      logicalProjectKey: "p-1",
      createdAt: "2026-01-02T00:00:00Z",
      runtimeMode: "local" as DraftThreadState["runtimeMode"],
      interactionMode: "default",
      branch: "main",
      worktreePath: "/tmp/wt",
      envMode: "local",
    };
    const draftSummary = draftThreadToSidebarSummary(draft);
    const result = select([serverThread, draftSummary], {
      worktreeId: "wt-1",
      worktreePath: "/tmp/wt",
    });
    const titles = result.map((item) => item.title).toSorted();
    expect(titles).toEqual(["Empty Session", "Thread"]);
  });

  it("groups main-worktree threads when filter has no worktreeId or path", () => {
    // Main-branch threads have worktreePath = null and worktreeId = null.
    // The sidebar treats them as members of a synthesized 'main' worktree;
    // the tab strip should do the same instead of returning empty.
    const select = createSessionTabsSelector();
    const threads = [
      makeThread({
        id: "m1" as never,
        worktreeId: null,
        worktreePath: null,
        branch: "main",
      }),
      makeThread({
        id: "m2" as never,
        worktreeId: null,
        worktreePath: null,
        branch: "main",
      }),
      makeThread({
        id: "wt" as never,
        worktreeId: "wt-1",
        worktreePath: "/tmp/feature",
        branch: "feature",
      }),
    ];
    const result = select(threads, { worktreeId: null, worktreePath: null });
    const ids = result.map((item) => item.key.split(":").at(-1)).toSorted();
    expect(ids).toEqual(["m1", "m2"]);
  });

  it("matches by worktreePath even when both sides have differing worktreeIds", () => {
    // Mirrors sidebar's belongsToWorktree behavior: new server-created
    // sessions can land with a fresh worktreeId despite sharing a path
    // with the active session. They must still appear in the tab strip.
    const select = createSessionTabsSelector();
    const threads = [
      makeThread({ id: "a" as never, worktreeId: "wt-1", worktreePath: "/tmp/wt" }),
      makeThread({ id: "b" as never, worktreeId: "wt-2", worktreePath: "/tmp/wt" }),
      makeThread({ id: "c" as never, worktreeId: "wt-3", worktreePath: "/tmp/different" }),
    ];
    const result = select(threads, { worktreeId: "wt-1", worktreePath: "/tmp/wt" });
    const ids = result.map((item) => item.key.split(":").at(-1)).toSorted();
    expect(ids).toEqual(["a", "b"]);
  });
});
