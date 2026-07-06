import { describe, expect, it } from "vite-plus/test";
import { Schema } from "effect";

import { CreateWorktreeIntent, ItemActionWorkspacePlan, Worktree, WorktreeId, WorktreeOrigin } from "./worktree.ts";

describe("WorktreeId", () => {
  it("is a branded string", () => {
    const id = WorktreeId.make("worktree-abc");
    expect(typeof id).toBe("string");
  });
});

describe("WorktreeOrigin", () => {
  it("accepts the five legal kinds", () => {
    for (const kind of ["main", "branch", "pr", "issue", "manual"] as const) {
      expect(Schema.is(WorktreeOrigin)(kind)).toBe(true);
    }
    expect(Schema.is(WorktreeOrigin)("other")).toBe(false);
  });
});

describe("CreateWorktreeIntent (issue variant)", () => {
  const decode = Schema.decodeUnknownSync(CreateWorktreeIntent);

  it("accepts issue intent without branchName (existing callers)", () => {
    expect(decode({ kind: "issue", number: 42 })).toMatchObject({ kind: "issue", number: 42 });
  });

  it("accepts issue intent with branchName override", () => {
    expect(decode({ kind: "issue", number: 42, branchName: "fix/bug" })).toMatchObject({
      kind: "issue",
      number: 42,
      branchName: "fix/bug",
    });
  });

  it("accepts issue intent with baseBranch override", () => {
    expect(decode({ kind: "issue", number: 42, baseBranch: "release/next" })).toMatchObject({
      kind: "issue",
      number: 42,
      baseBranch: "release/next",
    });
  });

  it("rejects empty baseBranch", () => {
    expect(() => decode({ kind: "issue", number: 42, baseBranch: "" })).toThrow();
  });

  it("accepts optional issue metadata for branch generation", () => {
    expect(
      decode({
        kind: "issue",
        number: 42,
        title: "Fix reconnect handling",
        body: "Sessions should recover after restart.",
      }),
    ).toMatchObject({
      kind: "issue",
      number: 42,
      title: "Fix reconnect handling",
      body: "Sessions should recover after restart.",
    });
  });

  it("rejects empty branchName", () => {
    expect(() => decode({ kind: "issue", number: 42, branchName: "" })).toThrow();
  });

  it("accepts Jira work item intent metadata", () => {
    expect(
      decode({
        kind: "workItem",
        provider: "jira",
        key: "KAN-4",
        title: "SUPER TOLL",
        state: "open",
        url: "https://ryco-app.atlassian.net/browse/KAN-4",
        baseBranch: "main",
      }),
    ).toMatchObject({
      kind: "workItem",
      provider: "jira",
      key: "KAN-4",
      title: "SUPER TOLL",
      state: "open",
      baseBranch: "main",
    });
  });

  it("accepts Jira work item intent with an existing branch source", () => {
    expect(
      decode({
        kind: "workItem",
        provider: "jira",
        key: "KAN-4",
        title: "SUPER TOLL",
        branchSource: "existing",
        branchName: "feature/KAN-4-existing",
      }),
    ).toMatchObject({
      kind: "workItem",
      provider: "jira",
      key: "KAN-4",
      branchSource: "existing",
      branchName: "feature/KAN-4-existing",
    });
  });

  it("rejects empty Jira work item key", () => {
    expect(() => decode({ kind: "workItem", provider: "jira", key: "", title: "Story" })).toThrow();
  });
});

describe("Worktree", () => {
  it("decodes a row with origin=main and null worktreePath", () => {
    const decoded = Schema.decodeUnknownSync(Worktree)({
      worktreeId: "worktree-1",
      projectId: "project-1",
      branch: "main",
      worktreePath: null,
      origin: "main",
      prNumber: null,
      issueNumber: null,
      prTitle: null,
      issueTitle: null,
      createdAt: "2026-05-08T00:00:00.000Z",
      updatedAt: "2026-05-08T00:00:00.000Z",
      archivedAt: null,
      manualPosition: 0,
    });

    expect(decoded.origin).toBe("main");
    expect(decoded.worktreePath).toBeNull();
    expect(decoded.workItemKey).toBeNull();
  });

  it("decodes work item metadata", () => {
    const decoded = Schema.decodeUnknownSync(Worktree)({
      worktreeId: "worktree-jira-1",
      projectId: "project-1",
      branch: "KAN-4-super-toll",
      worktreePath: "/tmp/KAN-4-super-toll",
      origin: "issue",
      prNumber: null,
      issueNumber: null,
      prTitle: null,
      issueTitle: null,
      workItemProvider: "jira",
      workItemKey: "KAN-4",
      workItemTitle: "SUPER TOLL",
      workItemState: "open",
      workItemStateName: "Next to come",
      workItemUrl: "https://ryco-app.atlassian.net/browse/KAN-4",
      createdAt: "2026-05-08T00:00:00.000Z",
      updatedAt: "2026-05-08T00:00:00.000Z",
      archivedAt: null,
      manualPosition: 0,
    });

    expect(decoded.workItemProvider).toBe("jira");
    expect(decoded.workItemKey).toBe("KAN-4");
    expect(decoded.workItemStateName).toBe("Next to come");
  });
});

describe("item action workspace plan", () => {
  it("decodes each plan variant", () => {
    const reuse = Schema.decodeUnknownSync(ItemActionWorkspacePlan)({
      kind: "reuse-worktree",
      worktreeId: "worktree-1",
      worktreePath: "/tmp/worktrees/feature-x__abcde",
      branch: "feature/x",
    });
    expect(reuse.kind).toBe("reuse-worktree");

    const localMain = Schema.decodeUnknownSync(ItemActionWorkspacePlan)({
      kind: "local-main-checkout",
      branch: "feature/x",
    });
    expect(localMain.kind).toBe("local-main-checkout");

    const create = Schema.decodeUnknownSync(ItemActionWorkspacePlan)({
      kind: "create-worktree",
      plannedBranch: "feature/x",
    });
    expect(create.kind).toBe("create-worktree");
    if (create.kind === "create-worktree") {
      expect(create.plannedBranch).toBe("feature/x");
    }
  });

  it("rejects unknown plan kinds", () => {
    expect(() =>
      Schema.decodeUnknownSync(ItemActionWorkspacePlan)({ kind: "teleport" }),
    ).toThrow();
  });
});
