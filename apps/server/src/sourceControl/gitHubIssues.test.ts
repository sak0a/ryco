import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { decodeGitHubIssueListJson, decodeGitHubIssueDetailJson } from "./gitHubIssues.ts";

describe("decodeGitHubIssueListJson", () => {
  it("decodes a valid list with state normalization", () => {
    const raw = JSON.stringify([
      {
        number: 42,
        title: "Remove stale todos_manager.html",
        url: "https://github.com/owner/repo/issues/42",
        state: "OPEN",
        updatedAt: "2026-03-14T10:00:00Z",
        author: { login: "alice" },
        labels: [{ name: "bug" }, { name: "good-first-issue" }],
      },
    ]);
    const result = decodeGitHubIssueListJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success).toHaveLength(1);
    expect(result.success[0]?.number).toBe(42);
    expect(result.success[0]?.state).toBe("open");
    expect(result.success[0]?.author).toBe("alice");
    expect(result.success[0]?.labels).toEqual([{ name: "bug" }, { name: "good-first-issue" }]);
  });

  it("skips invalid entries silently", () => {
    const raw = JSON.stringify([
      { number: "not-a-number", title: "bad" },
      { number: 7, title: "ok", url: "https://x/7", state: "CLOSED" },
    ]);
    const result = decodeGitHubIssueListJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.map((i) => i.number)).toEqual([7]);
  });

  it("fails on non-JSON", () => {
    const result = decodeGitHubIssueListJson("{not json");
    expect(Result.isFailure(result)).toBe(true);
  });
});

describe("decodeGitHubIssueDetailJson", () => {
  it("decodes body and comments", () => {
    const raw = JSON.stringify({
      number: 42,
      title: "title",
      url: "https://x/42",
      state: "OPEN",
      body: "issue body",
      comments: [
        {
          id: "IC_kwDOA1B2C84AAAAB",
          author: { login: "bob" },
          body: "first",
          createdAt: "2026-03-14T10:00:00Z",
          reactionGroups: [
            { content: "THUMBS_UP", viewerHasReacted: true, users: { totalCount: 2 } },
            { content: "ROCKET", users: { totalCount: 1 } },
            { content: "HEART", users: { totalCount: 0 } },
          ],
        },
        { author: null, body: "second", createdAt: "2026-03-14T11:00:00Z" },
      ],
    });
    const result = decodeGitHubIssueDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.body).toBe("issue body");
    expect(result.success.comments).toHaveLength(2);
    expect(result.success.comments[0]?.id).toBe("IC_kwDOA1B2C84AAAAB");
    expect(result.success.comments[0]?.author).toBe("bob");
    expect(result.success.comments[0]?.reactions).toEqual([
      { content: "thumbs-up", count: 2, viewerHasReacted: true },
      { content: "rocket", count: 1 },
    ]);
    expect(result.success.comments[1]?.author).toBe("unknown");
  });

  it("preserves authorAssociation when present", () => {
    const raw = JSON.stringify({
      number: 42,
      title: "title",
      url: "https://x/42",
      state: "OPEN",
      body: "issue body",
      comments: [
        {
          author: { login: "bob" },
          authorAssociation: "OWNER",
          body: "first",
          createdAt: "2026-03-14T10:00:00Z",
        },
        {
          author: { login: "carol" },
          authorAssociation: "NONE",
          body: "second",
          createdAt: "2026-03-14T11:00:00Z",
        },
        {
          author: { login: "dave" },
          body: "no association",
          createdAt: "2026-03-14T12:00:00Z",
        },
      ],
    });
    const result = decodeGitHubIssueDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.comments[0]?.authorAssociation).toBe("OWNER");
    expect(result.success.comments[1]?.authorAssociation).toBe("NONE");
    expect(result.success.comments[2]?.authorAssociation).toBeUndefined();
  });
});
