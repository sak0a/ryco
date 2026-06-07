import { describe, expect, it } from "vitest";
import { Result } from "effect";

import {
  decodeForgejoCommentListJson,
  decodeForgejoIssueDetailJson,
  decodeForgejoIssueListJson,
} from "./forgejoIssues.ts";

describe("decodeForgejoIssueListJson", () => {
  it("decodes Forgejo issues and skips pull requests from the issues endpoint", () => {
    const raw = JSON.stringify([
      {
        number: 42,
        title: "Bug",
        state: "open",
        html_url: "https://codeberg.org/owner/repo/issues/42",
        updated_at: "2026-03-14T10:00:00Z",
        user: { login: "alice" },
        labels: [{ name: "bug", color: "cc0000", description: "Defect" }],
        assignees: [{ login: "bob" }],
        comments: 2,
      },
      {
        number: 43,
        title: "PR from issue list",
        pull_request: {},
      },
    ]);

    const result = decodeForgejoIssueListJson(raw);

    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success).toHaveLength(1);
    expect(result.success[0]).toMatchObject({
      number: 42,
      title: "Bug",
      state: "open",
      author: "alice",
      assignees: ["bob"],
      commentsCount: 2,
    });
    expect(result.success[0]?.labels).toEqual([
      { name: "bug", color: "cc0000", description: "Defect" },
    ]);
  });
});

describe("decodeForgejoIssueDetailJson", () => {
  it("decodes single issue bodies", () => {
    const raw = JSON.stringify({
      number: 42,
      title: "Detailed",
      state: "closed",
      body: "issue body",
      html_url: "https://codeberg.org/owner/repo/issues/42",
      user: { username: "alice" },
    });

    const result = decodeForgejoIssueDetailJson(raw);

    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.body).toBe("issue body");
    expect(result.success.state).toBe("closed");
    expect(result.success.author).toBe("alice");
  });
});

describe("decodeForgejoCommentListJson", () => {
  it("decodes issue and pull request comments", () => {
    const raw = JSON.stringify([
      {
        user: { login: "alice" },
        body: "Looks good",
        created_at: "2026-03-14T10:00:00Z",
      },
    ]);

    const result = decodeForgejoCommentListJson(raw);

    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success).toEqual([
      {
        author: "alice",
        body: "Looks good",
        createdAt: "2026-03-14T10:00:00Z",
      },
    ]);
  });
});
