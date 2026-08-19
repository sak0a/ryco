import { describe, expect, it } from "vite-plus/test";
import { Result } from "effect";

import {
  buildGitHubPullRequestStackSummariesQuery,
  decodeGitHubAsyncMergeResultJson,
  decodeGitHubPullRequestStackPageJson,
  decodeGitHubPullRequestStackSummariesJson,
  normalizeGitHubPullRequestStackPages,
} from "./gitHubPullRequestStacks.ts";

function member(position: number, number: number) {
  return {
    position,
    pullRequest: {
      number,
      title: `PR ${number}`,
      url: `https://github.com/acme/ryco/pull/${number}`,
      headRefName: `stack/${number}`,
      baseRefName: position === 1 ? "main" : `stack/${number - 1}`,
      state: "OPEN",
      isDraft: false,
      mergedAt: null,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
    },
  };
}

function stackPage(input?: {
  entries?: ReadonlyArray<ReturnType<typeof member>>;
  selectedPosition?: number;
  size?: number;
  totalCount?: number;
  hasNextPage?: boolean;
  endCursor?: string | null;
}) {
  const entries = input?.entries ?? [member(1, 41), member(2, 42), member(3, 43)];
  const size = input?.size ?? 3;
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          stackEntry: { position: input?.selectedPosition ?? 2 },
          stack: {
            number: 7,
            size,
            baseRefName: "main",
            entries: {
              totalCount: input?.totalCount ?? size,
              nodes: entries,
              pageInfo: {
                hasNextPage: input?.hasNextPage ?? false,
                endCursor: input?.endCursor ?? null,
              },
            },
          },
        },
      },
    },
  });
}

function decodePage(raw: string) {
  const result = decodeGitHubPullRequestStackPageJson(raw);
  expect(Result.isSuccess(result)).toBe(true);
  if (!Result.isSuccess(result)) throw new Error(result.failure);
  return result.success;
}

describe("GitHub pull request stack decoding", () => {
  it("returns null for a verified standalone pull request", () => {
    const page = decodePage(
      JSON.stringify({
        data: { repository: { pullRequest: { stackEntry: null, stack: null } } },
      }),
    );
    const normalized = normalizeGitHubPullRequestStackPages([page], 42);
    expect(Result.isSuccess(normalized) && normalized.success).toBeNull();
  });

  it("normalizes a complete three-entry stack bottom-to-top", () => {
    const normalized = normalizeGitHubPullRequestStackPages([decodePage(stackPage())], 42);
    expect(Result.isSuccess(normalized)).toBe(true);
    if (!Result.isSuccess(normalized) || !normalized.success) return;
    expect(normalized.success.entries.map((entry) => entry.number)).toEqual([41, 42, 43]);
    expect(normalized.success.position).toBe(2);
  });

  it("combines paginated stack entries without truncating at one page", () => {
    const first = decodePage(
      stackPage({ entries: [member(1, 41), member(2, 42)], hasNextPage: true, endCursor: "c2" }),
    );
    const second = decodePage(stackPage({ entries: [member(3, 43)] }));
    const normalized = normalizeGitHubPullRequestStackPages([first, second], 42);
    expect(Result.isSuccess(normalized)).toBe(true);
    if (Result.isSuccess(normalized)) {
      expect(normalized.success?.entries.map((entry) => entry.position)).toEqual([1, 2, 3]);
    }
  });

  it("surfaces GraphQL errors even when data is also present", () => {
    const raw = JSON.parse(stackPage()) as Record<string, unknown>;
    raw.errors = [{ message: "stack preview unavailable" }];
    const decoded = decodeGitHubPullRequestStackPageJson(JSON.stringify(raw));
    expect(Result.isFailure(decoded)).toBe(true);
    if (Result.isFailure(decoded)) expect(decoded.failure).toContain("preview unavailable");
  });

  it("surfaces GraphQL errors even when GitHub omits the message", () => {
    const decoded = decodeGitHubPullRequestStackPageJson(
      JSON.stringify({ errors: [{}], data: null }),
    );
    expect(Result.isFailure(decoded)).toBe(true);
    if (Result.isFailure(decoded)) expect(decoded.failure).toContain("GraphQL returned errors");
  });

  it("rejects duplicate or missing positions", () => {
    const duplicate = normalizeGitHubPullRequestStackPages(
      [decodePage(stackPage({ entries: [member(1, 41), member(1, 42), member(3, 43)] }))],
      42,
    );
    const missing = normalizeGitHubPullRequestStackPages(
      [decodePage(stackPage({ entries: [member(1, 41), member(3, 42), member(4, 43)] }))],
      42,
    );
    expect(Result.isFailure(duplicate)).toBe(true);
    expect(Result.isFailure(missing)).toBe(true);
  });

  it("rejects a selected pull request at the wrong reported position", () => {
    const normalized = normalizeGitHubPullRequestStackPages(
      [decodePage(stackPage({ selectedPosition: 3 }))],
      42,
    );
    expect(Result.isFailure(normalized)).toBe(true);
  });
});

describe("GitHub stack summary decoding", () => {
  it("builds a bounded alias query and maps summaries by pull request number", () => {
    const query = buildGitHubPullRequestStackSummariesQuery([41, 42]);
    expect(query).toContain("pr_41: pullRequest(number: 41)");
    expect(query).toContain("pr_42: pullRequest(number: 42)");

    const decoded = decodeGitHubPullRequestStackSummariesJson(
      JSON.stringify({
        data: {
          repository: {
            pr_41: { stackEntry: null, stack: null },
            pr_42: {
              stackEntry: { position: 2 },
              stack: { number: 7, size: 3, baseRefName: "main" },
            },
          },
        },
      }),
      [41, 42],
    );
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(decoded.success.get(41)).toBeUndefined();
      expect(decoded.success.get(42)).toEqual({
        number: 7,
        size: 3,
        position: 2,
        baseRefName: "main",
      });
    }
  });
});

describe("GitHub async merge decoding", () => {
  it("decodes pending, merged, enqueued, and failed responses", () => {
    expect(
      decodeGitHubAsyncMergeResultJson(
        JSON.stringify({ status: "pending", details: { uuid: "merge-uuid", message: "working" } }),
      ),
    ).toMatchObject({ success: { status: "pending", uuid: "merge-uuid" } });
    expect(
      decodeGitHubAsyncMergeResultJson(
        JSON.stringify({ status: "merged", details: { sha: "abc", message: "merged" } }),
      ),
    ).toMatchObject({ success: { status: "merged" } });
    expect(
      decodeGitHubAsyncMergeResultJson(
        JSON.stringify({ status: "enqueued", details: { message: "queued" } }),
      ),
    ).toMatchObject({ success: { status: "enqueued" } });
    expect(
      decodeGitHubAsyncMergeResultJson(
        JSON.stringify({ status: "failed", details: { message: "rules failed" } }),
      ),
    ).toMatchObject({ success: { status: "failed", message: "rules failed" } });
  });

  it("rejects unknown statuses and missing detail objects", () => {
    expect(
      Result.isFailure(decodeGitHubAsyncMergeResultJson('{"status":"completed","details":{}}')),
    ).toBe(true);
    expect(Result.isFailure(decodeGitHubAsyncMergeResultJson('{"status":"pending"}'))).toBe(true);
  });
});
