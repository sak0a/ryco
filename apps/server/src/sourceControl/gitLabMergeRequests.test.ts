import { describe, expect, it } from "vitest";
import { Result } from "effect";
import {
  decodeGitLabMergeRequestDetailJson,
  decodeGitLabMergeRequestListJson,
} from "./gitLabMergeRequests.ts";

describe("decodeGitLabMergeRequestListJson (sanity for existing list shape)", () => {
  it("decodes minimal MR list", () => {
    const raw = JSON.stringify([
      {
        iid: 1,
        title: "MR title",
        web_url: "https://gitlab.com/owner/repo/-/merge_requests/1",
        target_branch: "main",
        source_branch: "feature/x",
        state: "opened",
      },
    ]);
    const result = decodeGitLabMergeRequestListJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
  });
});

describe("decodeGitLabMergeRequestDetailJson", () => {
  it("decodes description and notes as body + comments", () => {
    const raw = JSON.stringify({
      iid: 12,
      title: "Add feature",
      web_url: "https://gitlab.com/owner/repo/-/merge_requests/12",
      target_branch: "main",
      source_branch: "feature/add",
      state: "opened",
      description: "MR body text",
      notes: [
        {
          author: { username: "reviewer" },
          body: "looks good",
          created_at: "2026-03-01T10:00:00Z",
        },
      ],
    });
    const result = decodeGitLabMergeRequestDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.number).toBe(12);
    expect(result.success.body).toBe("MR body text");
    expect(result.success.comments).toHaveLength(1);
    expect(result.success.comments[0]?.author).toBe("reviewer");
  });

  it("handles missing description / notes gracefully", () => {
    const raw = JSON.stringify({
      iid: 13,
      title: "no body",
      web_url: "https://gitlab.com/owner/repo/-/merge_requests/13",
      target_branch: "main",
      source_branch: "feature/empty",
      state: "merged",
    });
    const result = decodeGitLabMergeRequestDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.body).toBe("");
    expect(result.success.comments).toEqual([]);
  });
});
