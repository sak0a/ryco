import { DateTime, Option, Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { EnvironmentId, ThreadId } from "./baseSchemas.ts";
import { PullRequestAssociation, PullRequestIdentity, PullRequestRecord } from "./pullRequest.ts";

const decodeIdentity = Schema.decodeUnknownSync(PullRequestIdentity);

describe("pull request contracts", () => {
  it("accepts repository-aware identities with nested namespaces", () => {
    expect(
      decodeIdentity({
        id: "pr_opaque",
        environmentId: EnvironmentId.make("env-local"),
        provider: "gitlab",
        host: "gitlab.example.com",
        repositoryPath: "platform/tools/ryco",
        number: 42,
      }),
    ).toMatchObject({ repositoryPath: "platform/tools/ryco", number: 42 });
  });

  it("rejects malformed hosts, repository paths, and non-positive numbers", () => {
    const base = {
      id: "pr_opaque",
      environmentId: EnvironmentId.make("env-local"),
      provider: "github" as const,
      host: "github.com",
      repositoryPath: "ryco/app",
      number: 42,
    };
    expect(() => decodeIdentity({ ...base, host: "https://github.com" })).toThrow();
    expect(() => decodeIdentity({ ...base, repositoryPath: "ryco" })).toThrow();
    expect(() => decodeIdentity({ ...base, number: 0 })).toThrow();
  });

  it("decodes records and keeps independent relationship evidence", () => {
    const now = DateTime.makeUnsafe("2026-08-08T12:00:00Z");
    const record = Schema.decodeUnknownSync(PullRequestRecord)({
      identity: {
        id: "pr_opaque",
        environmentId: EnvironmentId.make("env-local"),
        provider: "github",
        host: "github.com",
        repositoryPath: "ryco/app",
        number: 42,
      },
      repository: {
        canonicalKey: "github.com/ryco/app",
        host: "github.com",
        path: "ryco/app",
        displayName: "ryco/app",
      },
      title: "Canonical pull request inbox",
      url: "https://github.com/ryco/app/pull/42",
      state: "open",
      isDraft: false,
      assignees: [],
      baseRefName: "main",
      headRefName: "feature/inbox",
      labels: [],
      review: { disposition: "review-required", requestedReviewers: [], approvedBy: [] },
      checks: { status: "pending", total: 1, passing: 0, failing: 0, pending: 1 },
      capabilities: {
        detail: true,
        comments: true,
        reviews: true,
        checks: true,
        commits: true,
        files: true,
        viewerIdentity: false,
      },
      freshness: { observedAt: now, providerUpdatedAt: Option.some(now), refreshGeneration: 1 },
    });
    const association = Schema.decodeUnknownSync(PullRequestAssociation)({
      pullRequestId: record.identity.id,
      subject: { kind: "thread", threadId: ThreadId.make("thread-a") },
      relationship: "created",
      evidence: "structured-provider-result",
      createdAt: now,
      endedAt: Option.none(),
    });

    expect(record.identity.number).toBe(42);
    expect(association).toMatchObject({
      relationship: "created",
      evidence: "structured-provider-result",
    });
  });
});
