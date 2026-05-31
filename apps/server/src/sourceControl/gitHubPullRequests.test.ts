import { describe, expect, it } from "vitest";
import { Option, Result } from "effect";
import {
  decodeGitHubPullRequestListJson,
  decodeGitHubPullRequestJson,
  decodeGitHubPullRequestDetailJson,
  parseLinkedIssueNumbers,
} from "./gitHubPullRequests.ts";

describe("decodeGitHubPullRequestListJson", () => {
  it("decodes a valid list with state normalization", () => {
    const raw = JSON.stringify([
      {
        number: 42,
        title: "Add feature",
        url: "https://github.com/owner/repo/pull/42",
        baseRefName: "main",
        headRefName: "feature/add",
        state: "OPEN",
        mergedAt: null,
      },
    ]);
    const result = decodeGitHubPullRequestListJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success).toHaveLength(1);
    expect(result.success[0]?.number).toBe(42);
    expect(result.success[0]?.state).toBe("open");
  });

  it("skips invalid entries silently", () => {
    const raw = JSON.stringify([
      { number: "not-a-number", title: "bad" },
      {
        number: 7,
        title: "ok",
        url: "https://x/7",
        baseRefName: "main",
        headRefName: "fix/ok",
        state: "CLOSED",
      },
    ]);
    const result = decodeGitHubPullRequestListJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.map((p) => p.number)).toEqual([7]);
  });

  it("fails on non-JSON", () => {
    const result = decodeGitHubPullRequestListJson("{not json");
    expect(Result.isFailure(result)).toBe(true);
  });
});

describe("decodeGitHubPullRequestJson", () => {
  it("decodes a single PR", () => {
    const raw = JSON.stringify({
      number: 42,
      title: "My PR",
      url: "https://github.com/owner/repo/pull/42",
      baseRefName: "main",
      headRefName: "feature/my-pr",
      state: "OPEN",
      mergedAt: null,
    });
    const result = decodeGitHubPullRequestJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.number).toBe(42);
    expect(result.success.state).toBe("open");
  });
});

describe("decodeGitHubPullRequestDetailJson", () => {
  it("decodes body and comments", () => {
    const raw = JSON.stringify({
      number: 42,
      title: "My PR",
      url: "https://github.com/owner/repo/pull/42",
      baseRefName: "main",
      headRefName: "feature/my-pr",
      state: "OPEN",
      mergedAt: null,
      body: "PR body text",
      comments: [
        { author: { login: "alice" }, body: "looks good", createdAt: "2026-03-14T10:00:00Z" },
        { author: null, body: "second comment", createdAt: "2026-03-14T11:00:00Z" },
      ],
    });
    const result = decodeGitHubPullRequestDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.body).toBe("PR body text");
    expect(result.success.comments).toHaveLength(2);
    expect(result.success.comments[0]?.author).toBe("alice");
    expect(result.success.comments[1]?.author).toBe("unknown");
  });

  it("handles missing body and comments", () => {
    const raw = JSON.stringify({
      number: 1,
      title: "PR",
      url: "https://x/1",
      baseRefName: "main",
      headRefName: "fix",
      state: "OPEN",
    });
    const result = decodeGitHubPullRequestDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.body).toBe("");
    expect(result.success.comments).toHaveLength(0);
    expect(result.success.linkedIssueNumbers).toEqual([]);
  });

  it("parses linked issue numbers from PR body", () => {
    const raw = JSON.stringify({
      number: 5,
      title: "Multi-link",
      url: "https://x/5",
      baseRefName: "main",
      headRefName: "feature/linked",
      state: "OPEN",
      body: "Closes #12. Also fixes #34, resolves #56.",
    });
    const result = decodeGitHubPullRequestDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.linkedIssueNumbers).toEqual([12, 34, 56]);
  });

  it("preserves authorAssociation when present", () => {
    const raw = JSON.stringify({
      number: 42,
      title: "My PR",
      url: "https://github.com/owner/repo/pull/42",
      baseRefName: "main",
      headRefName: "feature/my-pr",
      state: "OPEN",
      mergedAt: null,
      body: "PR body",
      comments: [
        {
          author: { login: "alice" },
          authorAssociation: "OWNER",
          body: "looks good",
          createdAt: "2026-03-14T10:00:00Z",
        },
        {
          author: { login: "bob" },
          body: "no association",
          createdAt: "2026-03-14T11:00:00Z",
        },
      ],
    });
    const result = decodeGitHubPullRequestDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.comments[0]?.authorAssociation).toBe("OWNER");
    expect(result.success.comments[1]?.authorAssociation).toBeUndefined();
  });

  it("interleaves PR review bodies into the comments stream with reviewState", () => {
    const raw = JSON.stringify({
      number: 14,
      title: "Feature/branch toolbar terminal label",
      url: "https://github.com/owner/repo/pull/14",
      baseRefName: "main",
      headRefName: "feature/x",
      state: "OPEN",
      mergedAt: null,
      body: "PR body",
      comments: [
        { author: { login: "bob" }, body: "general comment", createdAt: "2026-03-14T11:00:00Z" },
      ],
      reviews: [
        {
          author: { login: "alice" },
          authorAssociation: "MEMBER",
          state: "APPROVED",
          body: "LGTM",
          submittedAt: "2026-03-14T10:00:00Z",
        },
        {
          author: { login: "carol" },
          state: "CHANGES_REQUESTED",
          body: "",
          submittedAt: "2026-03-14T12:00:00Z",
        },
        {
          author: { login: "dave" },
          state: "COMMENTED",
          body: "Some thoughts",
          submittedAt: "2026-03-14T13:00:00Z",
        },
      ],
    });
    const result = decodeGitHubPullRequestDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.comments).toHaveLength(3);
    expect(result.success.comments[0]?.author).toBe("alice");
    expect(result.success.comments[0]?.reviewState).toBe("approved");
    expect(result.success.comments[0]?.authorAssociation).toBe("MEMBER");
    expect(result.success.comments[1]?.author).toBe("bob");
    expect(result.success.comments[1]?.reviewState).toBeUndefined();
    expect(result.success.comments[2]?.author).toBe("dave");
    expect(result.success.comments[2]?.reviewState).toBe("commented");
  });

  it("preserves label colors when present", () => {
    const raw = JSON.stringify({
      number: 1,
      title: "Has labels",
      url: "https://x/1",
      baseRefName: "main",
      headRefName: "feature/labels",
      state: "OPEN",
      labels: [
        { name: "bug", color: "d73a4a", description: "Something is broken" },
        { name: "feature" },
        { name: "vouch:trusted", color: "0e8a16" },
      ],
    });
    const result = decodeGitHubPullRequestDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.labels).toEqual([
      { name: "bug", color: "d73a4a", description: "Something is broken" },
      { name: "feature" },
      { name: "vouch:trusted", color: "0e8a16" },
    ]);
  });

  it("parses changed files, additions, deletions", () => {
    const raw = JSON.stringify({
      number: 14,
      title: "Big PR",
      url: "https://github.com/owner/repo/pull/14",
      baseRefName: "main",
      headRefName: "feature/x",
      state: "OPEN",
      mergedAt: null,
      additions: 3825,
      deletions: 188,
      changedFiles: 55,
      files: [
        { path: "apps/web/src/app.tsx", additions: 12, deletions: 3 },
        { path: "apps/server/src/main.ts", additions: 5, deletions: 0 },
      ],
    });
    const result = decodeGitHubPullRequestDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.additions).toBe(3825);
    expect(result.success.deletions).toBe(188);
    expect(result.success.changedFiles).toBe(55);
    expect(result.success.files).toHaveLength(2);
    expect(result.success.files[0]?.path).toBe("apps/web/src/app.tsx");
    expect(result.success.files[0]?.additions).toBe(12);
    expect(result.success.files[0]?.deletions).toBe(3);
  });

  it("parses requested reviewers and commits", () => {
    const raw = JSON.stringify({
      number: 14,
      title: "Feature/branch toolbar terminal label",
      url: "https://github.com/owner/repo/pull/14",
      baseRefName: "main",
      headRefName: "feature/branch-toolbar-terminal-label",
      state: "OPEN",
      mergedAt: null,
      body: "What changed",
      reviewRequests: [{ login: "alice" }, { login: "coderabbitai[bot]" }],
      commits: [
        {
          oid: "abcd1234deadbeefabcd1234deadbeefabcd1234",
          messageHeadline: "Add toolbar label",
          authors: [{ login: "sak0a" }],
          committedDate: "2026-03-14T10:00:00Z",
        },
        {
          oid: "ef0011223344556677889900aabbccddeeff0011",
          messageHeadline: "Fix typo",
          authors: [{ login: "sak0a" }],
          committedDate: "2026-03-14T11:00:00Z",
        },
      ],
    });
    const result = decodeGitHubPullRequestDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.reviewers).toEqual(["alice", "coderabbitai[bot]"]);
    expect(result.success.commits).toHaveLength(2);
    expect(result.success.commits[0]?.oid).toBe("abcd1234deadbeefabcd1234deadbeefabcd1234");
    expect(result.success.commits[0]?.shortOid).toBe("abcd123");
    expect(result.success.commits[0]?.messageHeadline).toBe("Add toolbar label");
    expect(result.success.commits[0]?.author).toBe("sak0a");
    expect(result.success.commits[0]?.committedDate).toBe("2026-03-14T10:00:00Z");
  });

  it("decodes integer comments count from list output", () => {
    const raw = JSON.stringify([
      {
        number: 9,
        title: "Counted",
        url: "https://x/9",
        baseRefName: "main",
        headRefName: "feature/c",
        state: "OPEN",
        comments: 7,
      },
    ]);
    const result = decodeGitHubPullRequestListJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success[0]?.commentsCount).toBe(7);
  });

  it("ignores malformed check rollup timestamps", () => {
    const raw = JSON.stringify([
      {
        number: 10,
        title: "Check dates",
        url: "https://x/10",
        baseRefName: "main",
        headRefName: "feature/check-dates",
        state: "OPEN",
        statusCheckRollup: [
          {
            __typename: "CheckRun",
            name: "CI",
            status: "COMPLETED",
            conclusion: "SUCCESS",
            startedAt: "not-a-date",
            completedAt: "2026-05-31T12:00:00Z",
          },
        ],
      },
    ]);
    const result = decodeGitHubPullRequestListJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(Option.isNone(result.success[0]?.checkRollup?.[0]?.startedAt ?? Option.none())).toBe(
      true,
    );
    expect(Option.isSome(result.success[0]?.checkRollup?.[0]?.completedAt ?? Option.none())).toBe(
      true,
    );
  });
});

describe("parseLinkedIssueNumbers", () => {
  it("matches all close/fix/resolve verb forms", () => {
    expect(parseLinkedIssueNumbers("Closes #1, fixed #2, resolve #3")).toEqual([1, 2, 3]);
  });

  it("dedupes repeated numbers", () => {
    expect(parseLinkedIssueNumbers("Fixes #5 and closes #5")).toEqual([5]);
  });

  it("ignores unrelated # references", () => {
    expect(parseLinkedIssueNumbers("See #7 for context. Closes #8.")).toEqual([8]);
  });

  it("returns empty for empty body", () => {
    expect(parseLinkedIssueNumbers("")).toEqual([]);
  });
});
