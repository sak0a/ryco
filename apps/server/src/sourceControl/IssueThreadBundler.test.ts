import { describe, expect, it } from "vitest";
import {
  SOURCE_CONTROL_DETAIL_BODY_MAX_BYTES,
  SOURCE_CONTROL_DETAIL_COMMENT_BODY_MAX_BYTES,
} from "@ryco/contracts";

import { bundleIssueThread } from "./IssueThreadBundler.ts";

describe("bundleIssueThread", () => {
  it("formats issue title and body into a seed prompt", () => {
    const seed = bundleIssueThread({
      number: 42,
      title: "Add darkmode",
      body: "We should support a dark theme.",
      comments: [],
      url: "https://github.com/owner/repo/issues/42",
      author: "alice",
    });

    expect(seed).toMatch(/#42/u);
    expect(seed).toMatch(/Add darkmode/u);
    expect(seed).toMatch(/Author: alice/u);
    expect(seed).toMatch(/We should support a dark theme\./u);
  });

  it("truncates body over byte budget", () => {
    const long = "x".repeat(SOURCE_CONTROL_DETAIL_BODY_MAX_BYTES + 100);
    const seed = bundleIssueThread({
      number: 1,
      title: "t",
      body: long,
      comments: [],
      url: "https://example.com/1",
      author: "x",
    });

    expect(seed.length).toBeLessThan(long.length);
    expect(seed).toMatch(/\[truncated\]/u);
  });

  it("truncates comment bodies over byte budget", () => {
    const long = "x".repeat(SOURCE_CONTROL_DETAIL_COMMENT_BODY_MAX_BYTES + 100);
    const seed = bundleIssueThread({
      number: 1,
      title: "t",
      body: "b",
      comments: [{ author: "u", body: long, createdAt: "2026-05-08T00:00:00.000Z" }],
      url: "https://example.com/1",
      author: "x",
    });

    expect(seed.length).toBeLessThan(long.length + 100);
    expect(seed).toMatch(/\[truncated\]/u);
  });

  it("truncates comments to 5 maximum", () => {
    const comments = Array.from({ length: 10 }, (_, i) => ({
      author: "u",
      body: `comment ${i}`,
      createdAt: "2026-05-08T00:00:00.000Z",
    }));
    const seed = bundleIssueThread({
      number: 1,
      title: "t",
      body: "b",
      comments,
      url: "https://example.com/1",
      author: "x",
    });

    expect(seed.match(/^### Comment/gmu) ?? []).toHaveLength(5);
    expect(seed).toMatch(/\[truncated: showing 5 of 10 comments\]/u);
  });
});
