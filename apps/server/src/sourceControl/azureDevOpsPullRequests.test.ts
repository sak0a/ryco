import { describe, expect, it } from "vitest";
import { Result } from "effect";
import {
  decodeAzureDevOpsPullRequestDetailJson,
  decodeAzureDevOpsPullRequestThreadsJson,
} from "./azureDevOpsPullRequests.ts";

describe("decodeAzureDevOpsPullRequestDetailJson", () => {
  it("decodes description as body and flattens thread comments", () => {
    const raw = JSON.stringify({
      pullRequestId: 99,
      title: "Add feature",
      description: "PR body text",
      status: "active",
      sourceRefName: "refs/heads/feature/add",
      targetRefName: "refs/heads/main",
      repository: {
        webUrl: "https://dev.azure.com/org/proj/_git/repo",
        name: "repo",
      },
      threads: [
        {
          comments: [
            {
              author: { displayName: "Reviewer", uniqueName: "rev@example.com" },
              content: "looks good",
              publishedDate: "2026-03-01T10:00:00Z",
            },
          ],
        },
      ],
    });
    const result = decodeAzureDevOpsPullRequestDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.number).toBe(99);
    expect(result.success.body).toBe("PR body text");
    expect(result.success.comments[0]?.author).toBe("rev@example.com");
  });

  it("skips comments from threads marked as deleted", () => {
    const raw = JSON.stringify({
      pullRequestId: 100,
      title: "Add feature",
      description: "body",
      status: "active",
      sourceRefName: "refs/heads/feature/add",
      targetRefName: "refs/heads/main",
      threads: [
        {
          isDeleted: true,
          comments: [
            {
              author: { uniqueName: "removed@example.com" },
              content: "should be filtered",
              publishedDate: "2026-03-01T10:00:00Z",
            },
          ],
        },
        {
          isDeleted: false,
          comments: [
            {
              author: { uniqueName: "kept@example.com" },
              content: "kept",
              publishedDate: "2026-03-01T11:00:00Z",
            },
          ],
        },
      ],
    });
    const result = decodeAzureDevOpsPullRequestDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.comments).toHaveLength(1);
    expect(result.success.comments[0]?.author).toBe("kept@example.com");
    expect(result.success.comments[0]?.body).toBe("kept");
  });
});

describe("decodeAzureDevOpsPullRequestThreadsJson", () => {
  it("returns an empty list for an empty input string", () => {
    const result = decodeAzureDevOpsPullRequestThreadsJson("");
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success).toEqual([]);
  });

  it("skips comments from threads marked as deleted and falls back to displayName", () => {
    const raw = JSON.stringify([
      {
        isDeleted: true,
        comments: [
          {
            author: { uniqueName: "removed@example.com" },
            content: "should be filtered",
            publishedDate: "2026-03-01T10:00:00Z",
          },
        ],
      },
      {
        isDeleted: false,
        comments: [
          {
            author: { displayName: "Alice" },
            content: "kept",
            publishedDate: "2026-03-01T12:00:00Z",
          },
          {
            author: { displayName: "Bob" },
            content: "   ",
            publishedDate: "2026-03-01T12:30:00Z",
          },
        ],
      },
    ]);
    const result = decodeAzureDevOpsPullRequestThreadsJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success).toHaveLength(1);
    expect(result.success[0]?.author).toBe("Alice");
    expect(result.success[0]?.body).toBe("kept");
    expect(result.success[0]?.createdAt).toBe("2026-03-01T12:00:00Z");
  });
});
