import { EnvironmentId, PullRequestId } from "@ryco/contracts";
import { DateTime, Option } from "effect";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  applyPullRequestSnapshot,
  resetPullRequestStore,
  selectFederatedPullRequests,
  selectPullRequestsForSubject,
  usePullRequestStore,
} from "./store.ts";

const item = (environmentId: EnvironmentId, id: string, number: number) => ({
  pullRequest: {
    identity: {
      id: PullRequestId.make(id),
      environmentId,
      provider: "github" as const,
      host: "github.com",
      repositoryPath: "ryco/app",
      number,
    },
    repository: {
      canonicalKey: "github.com/ryco/app",
      host: "github.com",
      path: "ryco/app",
      displayName: "ryco/app",
    },
    title: `PR ${number}`,
    url: `https://github.com/ryco/app/pull/${number}`,
    state: "open" as const,
    isDraft: false,
    assignees: [],
    baseRefName: "main",
    headRefName: `feature/${number}`,
    labels: [],
    review: { disposition: "unknown" as const, requestedReviewers: [], approvedBy: [] },
    checks: { status: "unknown" as const, total: 0, passing: 0, failing: 0, pending: 0 },
    capabilities: {
      detail: true,
      comments: true,
      reviews: true,
      checks: true,
      commits: true,
      files: true,
      viewerIdentity: false,
    },
    freshness: {
      observedAt: DateTime.makeUnsafe("2026-08-08T12:00:00Z"),
      providerUpdatedAt: Option.none(),
      refreshGeneration: 1,
    },
  },
  associations: [],
  viewState: {
    pullRequestId: PullRequestId.make(id),
    isUnread: true,
    viewedAt: Option.none(),
    providerUpdatedAtWhenViewed: Option.none(),
  },
});

describe("pull request federation", () => {
  beforeEach(resetPullRequestStore);

  it("keeps the same repository number distinct across environments", () => {
    const local = EnvironmentId.make("local");
    const remote = EnvironmentId.make("remote");
    applyPullRequestSnapshot(local, {
      generation: 1,
      items: [item(local, "pr_local", 42)],
      coverage: [],
      lastSuccessAt: Option.none(),
    });
    applyPullRequestSnapshot(remote, {
      generation: 1,
      items: [item(remote, "pr_remote", 42)],
      coverage: [],
      lastSuccessAt: Option.none(),
    });
    expect(selectFederatedPullRequests(usePullRequestStore.getState())).toHaveLength(2);
  });

  it("rejects a retired generation", () => {
    const environmentId = EnvironmentId.make("local");
    applyPullRequestSnapshot(environmentId, {
      generation: 2,
      items: [item(environmentId, "pr_new", 2)],
      coverage: [],
      lastSuccessAt: Option.none(),
    });
    expect(
      applyPullRequestSnapshot(environmentId, {
        generation: 1,
        items: [item(environmentId, "pr_old", 1)],
        coverage: [],
        lastSuccessAt: Option.none(),
      }),
    ).toBe(false);
  });

  it("selects every active PR associated with a thread and preserves history elsewhere", () => {
    const environmentId = EnvironmentId.make("local");
    const first = item(environmentId, "pr_first", 41);
    const second = item(environmentId, "pr_second", 42);
    const threadId = "thread-many";
    const associated = [first, second].map((entry, index) =>
      Object.assign({}, entry, {
        associations: [
          {
            pullRequestId: entry.pullRequest.identity.id,
            subject: { kind: "thread" as const, threadId: threadId as never },
            relationship: index === 0 ? ("created" as const) : ("explicitly-attached" as const),
            evidence:
              index === 0 ? ("structured-provider-result" as const) : ("user-attachment" as const),
            createdAt: entry.pullRequest.freshness.observedAt,
            endedAt: Option.none(),
          },
        ],
      }),
    );
    applyPullRequestSnapshot(environmentId, {
      generation: 1,
      items: associated,
      coverage: [],
      lastSuccessAt: Option.none(),
    });

    expect(
      selectPullRequestsForSubject(usePullRequestStore.getState(), "thread", threadId),
    ).toHaveLength(2);
  });
});
