import { describe, expect, it } from "vite-plus/test";
import { DateTime, Option, Schema } from "effect";
import {
  truncateSourceControlDetailContent,
  SOURCE_CONTROL_DETAIL_BODY_MAX_BYTES,
  SOURCE_CONTROL_DETAIL_MAX_COMMENTS,
  SourceControlChangeRequestDetail,
  SourceControlAddCommentReactionInput,
  SourceControlIssueComment,
  SourceControlAssigneeCandidate,
  SourceControlAddChangeRequestCommentInput,
  SourceControlAddIssueCommentInput,
  SourceControlCreateIssueInput,
  SourceControlWorkflowRunListInput,
  SourceControlWorkflowRerunInput,
} from "./sourceControl.ts";

describe("truncateSourceControlDetailContent", () => {
  it("returns input unchanged when within caps", () => {
    const result = truncateSourceControlDetailContent({
      body: "short body",
      comments: [{ author: "a", body: "small", createdAt: new Date().toISOString() }],
    });
    expect(result.truncated).toBe(false);
    expect(result.body).toBe("short body");
    expect(result.comments).toHaveLength(1);
  });

  it("truncates body when over byte cap", () => {
    const big = "x".repeat(SOURCE_CONTROL_DETAIL_BODY_MAX_BYTES + 100);
    const result = truncateSourceControlDetailContent({ body: big, comments: [] });
    expect(result.truncated).toBe(true);
    expect(result.body.length).toBeLessThanOrEqual(SOURCE_CONTROL_DETAIL_BODY_MAX_BYTES);
  });

  it("does not split multi-byte characters at the byte cap", () => {
    const prefix = "x".repeat(SOURCE_CONTROL_DETAIL_BODY_MAX_BYTES - 1);
    const result = truncateSourceControlDetailContent({ body: `${prefix}\u{1f4be}`, comments: [] });
    expect(result.truncated).toBe(true);
    expect(result.body).toBe(prefix);
  });

  it("keeps only last N comments", () => {
    const comments = Array.from({ length: SOURCE_CONTROL_DETAIL_MAX_COMMENTS + 3 }, (_, i) => ({
      author: "a",
      body: `c${i}`,
      createdAt: new Date(2026, 0, i + 1).toISOString(),
    }));
    const result = truncateSourceControlDetailContent({ body: "ok", comments });
    expect(result.truncated).toBe(true);
    expect(result.comments).toHaveLength(SOURCE_CONTROL_DETAIL_MAX_COMMENTS);
    expect(result.comments[0]?.body).toBe(
      `c${comments.length - SOURCE_CONTROL_DETAIL_MAX_COMMENTS}`,
    );
  });

  it("preserves extra fields on each comment", () => {
    const comments = [
      {
        author: "a",
        body: "first",
        createdAt: "2026-03-14T10:00:00Z",
        authorAssociation: "OWNER",
      },
      {
        author: "b",
        body: "second",
        createdAt: "2026-03-14T11:00:00Z",
        authorAssociation: "MEMBER",
      },
    ];
    const result = truncateSourceControlDetailContent({ body: "body", comments });
    expect(result.comments[0]?.authorAssociation).toBe("OWNER");
    expect(result.comments[1]?.authorAssociation).toBe("MEMBER");
  });
});

describe("SourceControlChangeRequestDetail", () => {
  it("decodes rich Bitbucket pull request detail fields", () => {
    const updatedAt = DateTime.fromDateUnsafe(new Date("2026-05-12T12:00:00.000Z"));
    const commentCreatedAt = DateTime.fromDateUnsafe(new Date("2026-05-12T11:00:00.000Z"));

    const decoded = Schema.decodeUnknownSync(SourceControlChangeRequestDetail)({
      provider: "bitbucket",
      number: 42,
      title: "PROJ-123 add Atlassian workflow",
      url: "https://bitbucket.org/acme/ryco/pull-requests/42",
      baseRefName: "main",
      headRefName: "feature/proj-123",
      state: "open",
      updatedAt: Option.some(updatedAt),
      isDraft: false,
      mergeability: "conflicting",
      author: "Alice",
      assignees: ["Bob"],
      labels: [{ name: "backend", color: "0052cc" }],
      commentsCount: 2,
      body: "Adds a richer Bitbucket and Jira workflow.",
      comments: [
        {
          author: "Reviewer",
          body: "Looks good.",
          createdAt: commentCreatedAt,
        },
      ],
      truncated: false,
      linkedIssueNumbers: [17],
      linkedWorkItemKeys: ["PROJ-123"],
      reviewers: ["Reviewer"],
      participants: [
        {
          displayName: "Reviewer",
          username: "reviewer",
          role: "REVIEWER",
          approved: true,
        },
      ],
      tasksCount: 1,
      commits: [
        {
          oid: "abcdef123456",
          shortOid: "abcdef1",
          messageHeadline: "PROJ-123 add workflow",
          author: "Alice",
        },
      ],
      additions: 120,
      deletions: 12,
      changedFiles: 4,
      files: [
        { path: "apps/server/src/sourceControl/BitbucketApi.ts", additions: 80, deletions: 4 },
      ],
    });

    expect(decoded.linkedWorkItemKeys).toEqual(["PROJ-123"]);
    expect(decoded.mergeability).toBe("conflicting");
    expect(decoded.participants?.[0]?.approved).toBe(true);
    expect(decoded.tasksCount).toBe(1);
  });
});

describe("SourceControlIssueComment", () => {
  it("decodes optional structured author role metadata", () => {
    const createdAt = DateTime.fromDateUnsafe(new Date("2026-05-12T11:00:00.000Z"));
    const decoded = Schema.decodeUnknownSync(SourceControlIssueComment)({
      author: "alice",
      body: "I opened this.",
      createdAt,
      authorAssociation: "OWNER",
      authorRole: {
        primary: "author",
        isOriginalAuthor: true,
        isRepositoryOwner: true,
        isRepositoryMaintainer: false,
      },
    });

    expect(decoded.authorRole).toEqual({
      primary: "author",
      isOriginalAuthor: true,
      isRepositoryOwner: true,
      isRepositoryMaintainer: false,
    });
  });

  it("decodes optional comment ids and reactions", () => {
    const createdAt = DateTime.fromDateUnsafe(new Date("2026-05-12T11:00:00.000Z"));
    const decoded = Schema.decodeUnknownSync(SourceControlIssueComment)({
      id: "IC_kwDOA1B2C84AAAAB",
      author: "alice",
      body: "Nice.",
      createdAt,
      reactions: [
        { content: "thumbs-up", count: 3, viewerHasReacted: true },
        { content: "rocket", count: 1 },
      ],
    });

    expect(decoded.id).toBe("IC_kwDOA1B2C84AAAAB");
    expect(decoded.reactions).toEqual([
      { content: "thumbs-up", count: 3, viewerHasReacted: true },
      { content: "rocket", count: 1 },
    ]);
    expect(() =>
      Schema.decodeUnknownSync(SourceControlIssueComment)({
        id: "IC_kwDOA1B2C84AAAAB",
        author: "alice",
        body: "Nice.",
        createdAt,
        reactions: [{ content: "invalid", count: 1 }],
      }),
    ).toThrow();
  });
});

describe("SourceControlAssigneeCandidate", () => {
  it("requires login; optional displayName and avatarUrl", () => {
    const decode = Schema.decodeUnknownSync(SourceControlAssigneeCandidate);
    expect(decode({ login: "alice" })).toEqual({ login: "alice" });
    expect(decode({ login: "alice", displayName: "Alice", avatarUrl: "https://x" })).toEqual({
      login: "alice",
      displayName: "Alice",
      avatarUrl: "https://x",
    });
    expect(() => decode({ login: "" })).toThrow();
  });
});

describe("SourceControlCreateIssueInput", () => {
  it("requires cwd + title; body may be empty; worktree is optional", () => {
    const decode = Schema.decodeUnknownSync(SourceControlCreateIssueInput);
    expect(decode({ cwd: "/repo", title: "Bug", body: "" })).toEqual({
      cwd: "/repo",
      title: "Bug",
      body: "",
    });
    expect(
      decode({
        cwd: "/repo",
        title: "Bug",
        body: "details",
        labels: ["bug"],
        assignees: ["alice"],
        worktree: { enabled: true, branchName: "fix/bug" },
      }),
    ).toMatchObject({ worktree: { enabled: true, branchName: "fix/bug" } });
    expect(() => decode({ cwd: "", title: "Bug", body: "" })).toThrow();
    expect(() => decode({ cwd: "/repo", title: "", body: "" })).toThrow();
  });
});

describe("SourceControlAddIssueCommentInput", () => {
  it("requires cwd, reference, and a non-blank body without trimming Markdown", () => {
    const decode = Schema.decodeUnknownSync(SourceControlAddIssueCommentInput);
    expect(
      decode({
        cwd: "/repo",
        reference: "42",
        body: "    code block\n\nLooks good.\n",
        clientMutationId: "mutation-1",
      }),
    ).toEqual({
      cwd: "/repo",
      reference: "42",
      body: "    code block\n\nLooks good.\n",
      clientMutationId: "mutation-1",
    });
    expect(() => decode({ cwd: "/repo", reference: "42", body: "" })).toThrow();
    expect(() => decode({ cwd: "/repo", reference: "42", body: "   " })).toThrow();
    expect(() => decode({ cwd: "", reference: "42", body: "x" })).toThrow();
    expect(() => decode({ cwd: "/repo", reference: "", body: "x" })).toThrow();
  });
});

describe("SourceControlAddChangeRequestCommentInput", () => {
  it("validates PR comment bodies the same way as issue comments", () => {
    const decode = Schema.decodeUnknownSync(SourceControlAddChangeRequestCommentInput);
    expect(
      decode({
        cwd: "/repo",
        reference: "42",
        body: "> quoted\n\n**ship it**",
      }),
    ).toEqual({
      cwd: "/repo",
      reference: "42",
      body: "> quoted\n\n**ship it**",
    });
    expect(() => decode({ cwd: "/repo", reference: "42", body: "\n\t" })).toThrow();
  });
});

describe("SourceControlAddCommentReactionInput", () => {
  it("requires a GitHub comment id and supported reaction content", () => {
    const decode = Schema.decodeUnknownSync(SourceControlAddCommentReactionInput);
    expect(
      decode({
        cwd: "/repo",
        reference: "42",
        commentId: "IC_kwDOA1B2C84AAAAB",
        content: "heart",
      }),
    ).toEqual({
      cwd: "/repo",
      reference: "42",
      commentId: "IC_kwDOA1B2C84AAAAB",
      content: "heart",
    });
    expect(() =>
      decode({ cwd: "/repo", reference: "42", commentId: "", content: "heart" }),
    ).toThrow();
    expect(() =>
      decode({ cwd: "/repo", reference: "42", commentId: "IC_1", content: "invalid" }),
    ).toThrow();
  });
});

describe("SourceControlWorkflowRunListInput", () => {
  it("accepts commit-specific workflow run lookups", () => {
    const decode = Schema.decodeUnknownSync(SourceControlWorkflowRunListInput);
    expect(
      decode({
        cwd: "/repo",
        commitSha: "abcdef1234567890",
        limit: 10,
      }),
    ).toEqual({
      cwd: "/repo",
      commitSha: "abcdef1234567890",
      limit: 10,
    });
  });

  it("accepts branch-scoped workflow run lookups without a pull request", () => {
    const decode = Schema.decodeUnknownSync(SourceControlWorkflowRunListInput);
    expect(
      decode({
        cwd: "/repo",
        branch: "main",
        limit: 20,
      }),
    ).toEqual({
      cwd: "/repo",
      branch: "main",
      limit: 20,
    });
  });
});

describe("SourceControlWorkflowRerunInput", () => {
  it("decodes run-level and job-level rerun requests", () => {
    const decode = Schema.decodeUnknownSync(SourceControlWorkflowRerunInput);
    expect(decode({ cwd: "/repo", runId: "123", target: "failed-jobs" })).toEqual({
      cwd: "/repo",
      runId: "123",
      target: "failed-jobs",
    });
    expect(decode({ cwd: "/repo", runId: "123", target: "job", jobId: "456" })).toEqual({
      cwd: "/repo",
      runId: "123",
      target: "job",
      jobId: "456",
    });
    expect(() => decode({ cwd: "/repo", runId: "123", target: "job" })).toThrow();
  });
});

// Note: The merged result type that includes worktree output lives in
// packages/contracts/src/rpc.ts (Task 10), because GitCreateWorktreeForProjectOutput
// is declared there. No separate result type is needed in sourceControl.ts.
