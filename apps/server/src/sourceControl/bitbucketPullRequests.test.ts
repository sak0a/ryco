import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { decodeBitbucketPullRequestDetailJson } from "./bitbucketPullRequests.ts";

describe("decodeBitbucketPullRequestDetailJson", () => {
  it("decodes summary.raw as body", () => {
    const raw = JSON.stringify({
      id: 12,
      title: "Add feature",
      state: "OPEN",
      summary: { raw: "PR body text" },
      source: { branch: { name: "feature/add" }, repository: { full_name: "owner/repo" } },
      destination: { branch: { name: "main" } },
      links: { html: { href: "https://bitbucket.org/owner/repo/pull-requests/12" } },
    });
    const result = decodeBitbucketPullRequestDetailJson(raw, []);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.body).toBe("PR body text");
    expect(result.success.number).toBe(12);
  });
});
