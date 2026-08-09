import { EnvironmentId, PullRequestId, ThreadId } from "@ryco/contracts";
import { DateTime, Option } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { parsePullRequestRouteSearch } from "~/pullRequestRouteSearch";
import { filterPullRequestInbox } from "./pullRequestInboxViewModel.ts";

const makeItem = (number: number, repository: string, title: string) => ({
  pullRequest: {
    identity: {
      id: PullRequestId.make(`pr_${repository}_${number}`),
      environmentId: EnvironmentId.make("local"),
      provider: "github" as const,
      host: "github.com",
      repositoryPath: repository,
      number,
    },
    repository: {
      canonicalKey: `github.com/${repository}`,
      host: "github.com",
      path: repository,
      displayName: repository,
    },
    title,
    url: `https://github.com/${repository}/pull/${number}`,
    state: "open" as const,
    isDraft: false,
    author: "mira",
    assignees: [],
    baseRefName: "main",
    headRefName: "feature/search",
    labels: [],
    review: {
      disposition: "review-required" as const,
      requestedReviewers: ["alex"],
      approvedBy: [],
    },
    checks: { status: "passing" as const, total: 1, passing: 1, failing: 0, pending: 0 },
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
    pullRequestId: PullRequestId.make(`pr_${repository}_${number}`),
    isUnread: false,
    viewedAt: Option.none(),
    providerUpdatedAtWhenViewed: Option.none(),
  },
});

describe("pull request inbox view model", () => {
  it("searches repository, title, branch, author, reviewer, and number", () => {
    const items = [makeItem(42, "ryco/app", "Add canonical inbox")];
    for (const query of ["ryco/app", "canonical", "feature/search", "mira", "alex", "42"]) {
      expect(filterPullRequestInbox(items, parsePullRequestRouteSearch({ q: query }))).toHaveLength(
        1,
      );
    }
  });

  it("never collides same-number items from different repositories", () => {
    const items = [makeItem(42, "ryco/app", "App"), makeItem(42, "ryco/server", "Server")];
    expect(filterPullRequestInbox(items, parsePullRequestRouteSearch({ q: "42" }))).toHaveLength(2);
  });

  it("sorts Latest by provider update time without promoting unread items", () => {
    const olderUnread = makeItem(41, "ryco/app", "Older unread");
    const newerRead = makeItem(42, "ryco/app", "Newer read");
    olderUnread.viewState.isUnread = true;
    olderUnread.pullRequest.freshness.observedAt = DateTime.makeUnsafe("2026-08-08T10:00:00Z");
    newerRead.pullRequest.freshness.observedAt = DateTime.makeUnsafe("2026-08-08T12:00:00Z");

    expect(
      filterPullRequestInbox([olderUnread, newerRead], parsePullRequestRouteSearch({})).map(
        (item) => item.pullRequest.title,
      ),
    ).toEqual(["Newer read", "Older unread"]);
  });

  it("sorts Priority by cached AI score while Latest keeps chronological order", () => {
    const olderHighPriority = makeItem(41, "ryco/app", "Older high priority");
    const newerLowPriority = makeItem(42, "ryco/app", "Newer low priority");
    olderHighPriority.pullRequest.freshness.observedAt =
      DateTime.makeUnsafe("2026-08-08T10:00:00Z");
    newerLowPriority.pullRequest.freshness.observedAt = DateTime.makeUnsafe("2026-08-08T12:00:00Z");
    const analyses = {
      [olderHighPriority.pullRequest.identity.id]: { priorityScore: 88 },
      [newerLowPriority.pullRequest.identity.id]: { priorityScore: 35 },
    } as never;

    expect(
      filterPullRequestInbox(
        [newerLowPriority, olderHighPriority],
        parsePullRequestRouteSearch({ view: "priority" }),
        undefined,
        analyses,
      ).map((item) => item.pullRequest.title),
    ).toEqual(["Older high priority", "Newer low priority"]);
    expect(
      filterPullRequestInbox(
        [olderHighPriority, newerLowPriority],
        parsePullRequestRouteSearch({ view: "latest" }),
        undefined,
        analyses,
      ).map((item) => item.pullRequest.title),
    ).toEqual(["Newer low priority", "Older high priority"]);
  });

  it("keeps merged and closed history out of the active Priority view", () => {
    const open = makeItem(40, "ryco/app", "Open work");
    const mergedBase = makeItem(41, "ryco/app", "Merged history");
    const closedBase = makeItem(42, "ryco/app", "Closed history");
    const merged = {
      ...mergedBase,
      pullRequest: { ...mergedBase.pullRequest, state: "merged" as const },
    };
    const closed = {
      ...closedBase,
      pullRequest: { ...closedBase.pullRequest, state: "closed" as const },
    };

    expect(
      filterPullRequestInbox(
        [merged, open, closed],
        parsePullRequestRouteSearch({ view: "priority" }),
      ).map((item) => item.pullRequest.title),
    ).toEqual(["Open work"]);
    expect(
      filterPullRequestInbox(
        [merged, open, closed],
        parsePullRequestRouteSearch({ view: "latest" }),
      ),
    ).toHaveLength(3);
  });

  it("searches joined thread and worktree labels without storing them on the PR", () => {
    const item = makeItem(42, "ryco/app", "Inbox");
    const itemWithAssociation = {
      ...item,
      associations: [
        {
          pullRequestId: item.pullRequest.identity.id,
          subject: { kind: "thread" as const, threadId: ThreadId.make("thread-a") },
          relationship: "created" as const,
          evidence: "structured-provider-result" as const,
          createdAt: DateTime.makeUnsafe("2026-08-08T12:00:00Z"),
          endedAt: Option.none(),
        },
      ],
    };
    expect(
      filterPullRequestInbox(
        [itemWithAssociation],
        parsePullRequestRouteSearch({ q: "liquid glass" }),
        new Map([["thread:thread-a", "Liquid glass polish"]]),
      ),
    ).toHaveLength(1);
  });

  it("never guesses viewer-scoped inbox categories from author or reviewer names", () => {
    const unverified = makeItem(42, "ryco/app", "Inbox");
    expect(
      filterPullRequestInbox([unverified], parsePullRequestRouteSearch({ view: "review" })),
    ).toHaveLength(0);

    const verified = {
      ...unverified,
      pullRequest: {
        ...unverified.pullRequest,
        capabilities: { ...unverified.pullRequest.capabilities, viewerIdentity: true },
        viewer: { isAuthor: true, isAssignee: false, reviewRequested: true },
      },
    };
    expect(
      filterPullRequestInbox([verified], parsePullRequestRouteSearch({ view: "review" })),
    ).toHaveLength(1);
    expect(
      filterPullRequestInbox([verified], parsePullRequestRouteSearch({ view: "authored" })),
    ).toHaveLength(1);
    expect(
      filterPullRequestInbox([verified], parsePullRequestRouteSearch({ view: "assigned" })),
    ).toHaveLength(0);
  });
});
