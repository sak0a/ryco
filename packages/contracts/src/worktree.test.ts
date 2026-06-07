import { describe, expect, it } from "vite-plus/test";
import { Schema } from "effect";

import { CreateWorktreeIntent, Worktree, WorktreeId, WorktreeOrigin } from "./worktree.ts";

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
  });
});
