import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { decodeGitLabIssueDetailJson, decodeGitLabIssueListJson } from "./gitLabIssues.ts";

describe("decodeGitLabIssueListJson", () => {
  it("decodes a valid list and normalizes state", () => {
    const raw = JSON.stringify([
      {
        iid: 42,
        title: "Remove stale todos",
        web_url: "https://gitlab.com/owner/repo/-/issues/42",
        state: "opened",
        updated_at: "2026-03-14T10:00:00Z",
        author: { username: "alice" },
        labels: ["bug", "good-first-issue"],
      },
    ]);
    const result = decodeGitLabIssueListJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success).toHaveLength(1);
    expect(result.success[0]?.number).toBe(42);
    expect(result.success[0]?.state).toBe("open");
    expect(result.success[0]?.author).toBe("alice");
    expect(result.success[0]?.labels).toEqual(["bug", "good-first-issue"]);
  });

  it("treats 'closed' state literally and skips invalid entries", () => {
    const raw = JSON.stringify([
      { iid: "not-a-number", title: "bad" },
      {
        iid: 7,
        title: "ok",
        web_url: "https://gitlab.com/owner/repo/-/issues/7",
        state: "closed",
      },
    ]);
    const result = decodeGitLabIssueListJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.map((i) => i.number)).toEqual([7]);
    expect(result.success[0]?.state).toBe("closed");
  });

  it("fails on non-JSON", () => {
    const result = decodeGitLabIssueListJson("{not json");
    expect(Result.isFailure(result)).toBe(true);
  });
});

describe("decodeGitLabIssueDetailJson", () => {
  it("decodes description and notes as body + comments", () => {
    const raw = JSON.stringify({
      iid: 42,
      title: "title",
      web_url: "https://gitlab.com/owner/repo/-/issues/42",
      state: "opened",
      description: "issue body",
      notes: [
        {
          author: { username: "bob" },
          body: "first",
          created_at: "2026-03-14T10:00:00Z",
        },
        {
          author: null,
          body: "second",
          created_at: "2026-03-14T11:00:00Z",
        },
      ],
    });
    const result = decodeGitLabIssueDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.body).toBe("issue body");
    expect(result.success.comments).toHaveLength(2);
    expect(result.success.comments[0]?.author).toBe("bob");
    expect(result.success.comments[1]?.author).toBe("unknown");
  });
});
