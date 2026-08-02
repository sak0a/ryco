import { scopedProjectKey, scopedThreadKey } from "@ryco/client-runtime/scoped";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorktreeId,
} from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadInbox,
  scopedInboxWorktreeKey,
  type BuildThreadInboxInput,
  type ThreadInboxDraftSummary,
  type ThreadInboxEnvironment,
} from "./threadInbox.ts";
import type { Project, SidebarThreadSummary, SidebarWorktreeSummary } from "./types.ts";

const environmentA = EnvironmentId.make("environment-a");
const environmentB = EnvironmentId.make("environment-b");
const projectId = ProjectId.make("project-1");
const worktreeId = WorktreeId.make("worktree-1");
const nowMs = Date.parse("2026-07-31T12:00:00.000Z");

function makeEnvironment(
  environmentId: EnvironmentId,
  overrides: Partial<ThreadInboxEnvironment> = {},
): ThreadInboxEnvironment {
  return {
    environmentId,
    label: environmentId === environmentA ? "Local" : "Remote",
    threadSettlementSupported: true,
    connected: true,
    mutationReady: true,
    shellCurrent: true,
    ...overrides,
  };
}

function makeProject(environmentId: EnvironmentId): Project {
  return {
    id: projectId,
    environmentId,
    name: environmentId === environmentA ? "Alpha" : "Beta",
    cwd: `/tmp/${environmentId}`,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    scripts: [],
  };
}

function makeThread(
  environmentId: EnvironmentId,
  threadId: string,
  overrides: Partial<SidebarThreadSummary> = {},
): SidebarThreadSummary {
  return {
    id: ThreadId.make(threadId),
    environmentId,
    projectId,
    title: threadId,
    interactionMode: "default",
    tokenMode: "balanced",
    session: null,
    createdAt: "2026-07-31T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    updatedAt: "2026-07-31T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    worktreeId: null,
    manualStatusBucket: null,
    manualPosition: 0,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function makeWorktree(
  environmentId: EnvironmentId,
  overrides: Partial<SidebarWorktreeSummary> = {},
): SidebarWorktreeSummary {
  return {
    id: worktreeId,
    environmentId,
    projectId,
    title: "Feature",
    branch: "feature/inbox",
    worktreePath: `/tmp/${environmentId}/worktree`,
    origin: "pr",
    prNumber: 42,
    issueNumber: null,
    prTitle: "Inbox",
    issueTitle: null,
    prState: "open",
    prIsDraft: false,
    issueState: null,
    workItemProvider: null,
    workItemKey: null,
    workItemTitle: null,
    workItemState: null,
    workItemStateName: null,
    workItemUrl: null,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T01:00:00.000Z",
    archivedAt: null,
    manualPosition: 0,
    ...overrides,
  };
}

function baseInput(overrides: Partial<BuildThreadInboxInput> = {}): BuildThreadInboxInput {
  return {
    projects: [makeProject(environmentA), makeProject(environmentB)],
    worktrees: [],
    threads: [],
    environments: [makeEnvironment(environmentA), makeEnvironment(environmentB)],
    nowMs,
    ...overrides,
  };
}

describe("thread inbox", () => {
  it("builds one global inbox while keeping identical worktree IDs environment-scoped", () => {
    const threadA = makeThread(environmentA, "thread-a", {
      worktreeId,
      worktreePath: `/tmp/${environmentA}/worktree`,
    });
    const threadB = makeThread(environmentB, "thread-b", {
      worktreeId,
      worktreePath: `/tmp/${environmentB}/worktree`,
    });
    const inbox = buildThreadInbox(
      baseInput({
        worktrees: [
          makeWorktree(environmentA, {
            prState: "merged",
            updatedAt: "2026-07-31T10:00:00.000Z",
          }),
          makeWorktree(environmentB, { prState: "open" }),
        ],
        threads: [threadA, threadB],
      }),
    );

    expect(inbox.active.map((entry) => entry.key)).toEqual([
      scopedThreadKey({ environmentId: environmentB, threadId: threadB.id }),
    ]);
    expect(inbox.settled.map((entry) => entry.key)).toEqual([
      scopedThreadKey({ environmentId: environmentA, threadId: threadA.id }),
    ]);
    expect(inbox.settled[0]?.worktree?.environmentId).toBe(environmentA);
  });

  it("keeps unsupported environment rows active and mutation-disabled", () => {
    const thread = makeThread(environmentB, "thread-unsupported", {
      settledOverride: "settled",
      settledAt: "2026-07-31T10:00:00.000Z",
    });
    const inbox = buildThreadInbox(
      baseInput({
        environments: [
          makeEnvironment(environmentB, {
            threadSettlementSupported: false,
          }),
        ],
        threads: [thread],
      }),
    );

    expect(inbox.active[0]?.thread).toBe(thread);
    expect(inbox.active[0]?.lifecycle.settlementBlocker).toBe("unsupported");
    expect(inbox.active[0]?.mutationBlocker).toBe("unsupported");
    expect(inbox.settled).toEqual([]);
  });

  it("automatically settles merged and closed PRs, then reopens them with the PR", () => {
    const thread = makeThread(environmentA, "thread-pr", {
      worktreeId,
      worktreePath: `/tmp/${environmentA}/worktree`,
    });
    const merged = buildThreadInbox(
      baseInput({
        threads: [thread],
        worktrees: [makeWorktree(environmentA, { prState: "merged" })],
      }),
    );
    const closed = buildThreadInbox(
      baseInput({
        threads: [thread],
        worktrees: [makeWorktree(environmentA, { prState: "closed" })],
      }),
    );
    const reopened = buildThreadInbox(
      baseInput({
        threads: [thread],
        worktrees: [makeWorktree(environmentA, { prState: "open" })],
      }),
    );

    expect(merged.settled).toHaveLength(1);
    expect(closed.settled).toHaveLength(1);
    expect(reopened.active).toHaveLength(1);
    expect(reopened.settled).toEqual([]);
  });

  it("excludes archived threads and worktrees before applying filters", () => {
    const archivedThread = makeThread(environmentA, "thread-archived", {
      archivedAt: "2026-07-31T10:00:00.000Z",
    });
    const archivedWorktreeThread = makeThread(environmentA, "thread-worktree-archived", {
      worktreeId,
    });
    const visible = makeThread(environmentB, "thread-visible");
    const inbox = buildThreadInbox(
      baseInput({
        threads: [archivedThread, archivedWorktreeThread, visible],
        worktrees: [
          makeWorktree(environmentA, {
            archivedAt: "2026-07-31T10:00:00.000Z",
          }),
        ],
        filters: { environmentIds: [environmentA] },
      }),
    );

    expect(inbox.active).toEqual([]);
    expect(inbox.settled).toEqual([]);
    expect(inbox.excludedCount).toBe(2);
  });

  it("keeps queue and delivery-unknown rows active", () => {
    const queued = makeThread(environmentA, "thread-queued", {
      settledOverride: "settled",
      settledAt: "2026-07-31T09:00:00.000Z",
    });
    const unknown = makeThread(environmentA, "thread-unknown", {
      settledOverride: "settled",
      settledAt: "2026-07-31T09:00:00.000Z",
    });
    const queuedKey = scopedThreadKey({
      environmentId: environmentA,
      threadId: queued.id,
    });
    const unknownKey = scopedThreadKey({
      environmentId: environmentA,
      threadId: unknown.id,
    });
    const inbox = buildThreadInbox(
      baseInput({
        threads: [queued, unknown],
        localQueuedThreadKeys: new Set([queuedKey]),
        deliveryUnknownThreadKeys: new Set([unknownKey]),
      }),
    );

    expect(inbox.active.map((entry) => entry.lifecycle.settlementBlocker).toSorted()).toEqual([
      "delivery-unknown",
      "local-queue",
    ]);
    expect(inbox.settled).toEqual([]);
  });

  it("keeps local drafts active and removes them once their promoted thread exists", () => {
    const realThread = makeThread(environmentA, "thread-real");
    const promotedTo = {
      environmentId: environmentA,
      threadId: realThread.id,
    };
    const draft: ThreadInboxDraftSummary = {
      environmentId: environmentA,
      threadId: ThreadId.make("thread-draft"),
      projectId,
      title: "Draft",
      createdAt: "2026-07-31T11:00:00.000Z",
      branch: null,
      worktreePath: null,
      promotedTo,
    };
    const beforePromotion = buildThreadInbox(baseInput({ drafts: [draft] }));
    const afterPromotion = buildThreadInbox(baseInput({ drafts: [draft], threads: [realThread] }));

    expect(beforePromotion.active).toHaveLength(1);
    expect(beforePromotion.active[0]).toMatchObject({
      isDraft: true,
      mutationEnabled: false,
      mutationBlocker: "client-draft",
    });
    expect(afterPromotion.active).toHaveLength(1);
    expect(afterPromotion.active[0]?.thread).toBe(realThread);
  });

  it("uses stable active ordering and settlement-time ordering", () => {
    const oldest = makeThread(environmentA, "thread-old", {
      createdAt: "2026-07-31T01:00:00.000Z",
    });
    const newest = makeThread(environmentA, "thread-new", {
      createdAt: "2026-07-31T03:00:00.000Z",
      updatedAt: "2026-07-31T11:59:00.000Z",
    });
    const pinned = makeThread(environmentB, "thread-pinned", {
      createdAt: "2026-07-31T00:00:00.000Z",
    });
    const settledEarly = makeThread(environmentA, "thread-settled-early", {
      settledOverride: "settled",
      settledAt: "2026-07-31T08:00:00.000Z",
    });
    const settledLate = makeThread(environmentA, "thread-settled-late", {
      settledOverride: "settled",
      settledAt: "2026-07-31T10:00:00.000Z",
    });
    const pinnedKey = scopedThreadKey({
      environmentId: pinned.environmentId,
      threadId: pinned.id,
    });
    const inbox = buildThreadInbox(
      baseInput({
        threads: [oldest, newest, pinned, settledEarly, settledLate],
        pinnedThreadKeys: [pinnedKey],
      }),
    );

    expect(inbox.active.map((entry) => entry.thread?.id)).toEqual([
      pinned.id,
      newest.id,
      oldest.id,
    ]);
    expect(inbox.settled.map((entry) => entry.thread?.id)).toEqual([
      settledLate.id,
      settledEarly.id,
    ]);
  });

  it("composes filters while retaining the currently routed settled row", () => {
    const settled = makeThread(environmentA, "thread-current", {
      title: "Needle",
      settledOverride: "settled",
      settledAt: "2026-07-31T10:00:00.000Z",
      worktreeId,
    });
    const key = scopedThreadKey({
      environmentId: settled.environmentId,
      threadId: settled.id,
    });
    const inbox = buildThreadInbox(
      baseInput({
        threads: [settled],
        worktrees: [makeWorktree(environmentA)],
        currentThreadKey: key,
        filters: {
          environmentIds: [environmentB],
          projectKeys: [
            scopedProjectKey({
              environmentId: environmentB,
              projectId,
            }),
          ],
          worktreeKeys: [scopedInboxWorktreeKey(environmentB, worktreeId)],
          text: "not present",
        },
      }),
    );

    expect(inbox.settled).toHaveLength(1);
    expect(inbox.settled[0]).toMatchObject({ key, current: true });
  });

  it("does not bypass filters for the currently routed active row", () => {
    const active = makeThread(environmentA, "thread-current-active", {
      title: "Current active thread",
    });
    const key = scopedThreadKey({
      environmentId: active.environmentId,
      threadId: active.id,
    });
    const inbox = buildThreadInbox(
      baseInput({
        threads: [active],
        currentThreadKey: key,
        filters: { text: "not present" },
      }),
    );

    expect(inbox.active).toEqual([]);
    expect(inbox.settled).toEqual([]);
  });
});
