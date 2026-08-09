import {
  EnvironmentId,
  ProviderInstanceId,
  PullRequestId,
  type PullRequestAiAnalysis,
} from "@ryco/contracts";
import { DateTime, Option } from "effect";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  applyPullRequestSnapshot,
  applyPullRequestAiSnapshot,
  resetPullRequestStore,
  selectFederatedPullRequests,
  selectFederatedPullRequestAiAnalyses,
  selectPullRequestsForSubject,
  usePullRequestStore,
} from "./store.ts";
import { isPullRequestAiScheduleDue, selectScheduledPullRequestCandidates } from "./scheduler.ts";

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

const analysis = (pullRequestId: string, score: number): PullRequestAiAnalysis => ({
  pullRequestId: PullRequestId.make(pullRequestId),
  viewerKey: "viewer-a",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
  promptVersion: 1,
  schemaVersion: 1,
  sourceFingerprint: `fingerprint-${pullRequestId}`,
  sourceProviderUpdatedAt: Option.none(),
  depth: "shallow",
  priorityScore: score,
  priority: score >= 80 ? "urgent" : score >= 60 ? "high" : "normal",
  deterministicPriorityPoints: 30,
  modelPriorityPoints: Math.max(0, score - 30),
  priorityExplanation: "Review attention is required.",
  assessment: {
    pullRequestId: PullRequestId.make(pullRequestId),
    depth: "shallow",
    summary: "A concise summary.",
    implementationPhase: "active-implementation",
    attentionReason: "Review attention is required.",
    suggestedNextAction: "Review the changed files.",
    risk: "medium",
    riskEvidence: [],
    hotspots: [],
    riskPoints: 5,
    blockerPoints: 2,
    reviewImpactPoints: 5,
    timeSensitivityPoints: 2,
    implementationCompletenessPoints: 8,
    unresolvedDiscussionRiskPoints: 1,
    confidence: 70,
  },
  mergeReadiness: Option.none(),
  analyzedAt: DateTime.makeUnsafe("2026-08-08T12:00:00Z"),
  expiresAt: DateTime.makeUnsafe("2026-08-09T12:00:00Z"),
  isStale: false,
});

const aiConfiguration = {
  backgroundEnabled: true,
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
  intervalMinutes: 180 as const,
  maxPullRequests: 1,
  maxDeepAnalyses: 1,
  activeWindowDays: 14,
  includeDrafts: false,
  resourceMode: "balanced" as const,
};

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

  it("federates AI results and rejects retired analysis generations", () => {
    const local = EnvironmentId.make("local");
    const remote = EnvironmentId.make("remote");
    applyPullRequestAiSnapshot(local, {
      generation: 2,
      analyses: [analysis("pr_local", 82)],
      currentRun: Option.none(),
      latestRun: Option.none(),
      lastSuccessAt: Option.none(),
    });
    applyPullRequestAiSnapshot(remote, {
      generation: 1,
      analyses: [analysis("pr_remote", 64)],
      currentRun: Option.none(),
      latestRun: Option.none(),
      lastSuccessAt: Option.none(),
    });
    expect(
      Object.keys(selectFederatedPullRequestAiAnalyses(usePullRequestStore.getState())),
    ).toHaveLength(2);
    expect(
      applyPullRequestAiSnapshot(local, {
        generation: 1,
        analyses: [],
        currentRun: Option.none(),
        latestRun: Option.none(),
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

  it("selects bounded active candidates for scheduled analysis", () => {
    const local = EnvironmentId.make("local");
    const unread = item(local, "pr_unread", 1);
    const inactive = {
      ...item(local, "pr_inactive", 2),
      viewState: { ...item(local, "pr_inactive", 2).viewState, isUnread: false },
    };
    const candidates = selectScheduledPullRequestCandidates({
      environmentId: local,
      items: [inactive, unread],
      configuration: aiConfiguration,
      now: DateTime.toEpochMillis(DateTime.makeUnsafe("2026-08-09T12:00:00Z")),
    });
    expect(candidates.map((candidate) => candidate.pullRequest.identity.id)).toEqual([
      unread.pullRequest.identity.id,
    ]);
  });

  it("does not reschedule before the configured interval", () => {
    const now = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-08-09T12:00:00Z"));
    expect(
      isPullRequestAiScheduleDue({
        configuration: aiConfiguration,
        lastSuccessAt: Option.none(),
        lastAttemptAt: now - 60_000,
        now,
      }),
    ).toBe(false);
    expect(
      isPullRequestAiScheduleDue({
        configuration: aiConfiguration,
        lastSuccessAt: Option.some(DateTime.makeUnsafe("2026-08-09T08:00:00Z")),
        lastAttemptAt: undefined,
        now,
      }),
    ).toBe(true);
  });
});
