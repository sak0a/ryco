import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { decodeBitbucketIssueDetailJson, decodeBitbucketIssueListJson } from "./bitbucketIssues.ts";

describe("decodeBitbucketIssueListJson", () => {
  it("decodes paged issues into normalized records", () => {
    const raw = JSON.stringify({
      values: [
        {
          id: 42,
          title: "Bug",
          state: "open",
          updated_on: "2026-03-14T10:00:00Z",
          reporter: { display_name: "Alice", username: "alice" },
          links: {
            html: { href: "https://bitbucket.org/owner/repo/issues/42" },
          },
        },
      ],
    });
    const result = decodeBitbucketIssueListJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success).toHaveLength(1);
    expect(result.success[0]?.number).toBe(42);
    expect(result.success[0]?.state).toBe("open");
    expect(result.success[0]?.author).toBe("alice");
  });

  it("normalizes 'closed', 'resolved', etc. states to 'closed'", () => {
    const raw = JSON.stringify({
      values: [
        {
          id: 7,
          title: "Done",
          state: "resolved",
          links: { html: { href: "https://bitbucket.org/owner/repo/issues/7" } },
        },
      ],
    });
    const result = decodeBitbucketIssueListJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success[0]?.state).toBe("closed");
  });
});

describe("decodeBitbucketIssueDetailJson", () => {
  it("decodes single issue with content body", () => {
    const raw = JSON.stringify({
      id: 42,
      title: "Detailed",
      state: "open",
      content: { raw: "issue body" },
      reporter: { username: "alice" },
      links: { html: { href: "https://bitbucket.org/owner/repo/issues/42" } },
    });
    const result = decodeBitbucketIssueDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.body).toBe("issue body");
    expect(result.success.comments).toEqual([]);
  });
});
