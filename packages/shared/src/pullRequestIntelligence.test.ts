import {
  EnvironmentId,
  PullRequestId,
  type PullRequestAiModelAssessment,
  type PullRequestInboxItem,
} from "@ryco/contracts";
import { DateTime, Option } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  buildPullRequestAiAnalysis,
  calculatePullRequestMergeReadiness,
  deterministicPullRequestPriorityPoints,
  pullRequestAiPriorityForScore,
  pullRequestAiSourceFingerprint,
} from "./pullRequestIntelligence.ts";

const environmentId = EnvironmentId.make("local");
const pullRequestId = PullRequestId.make("pr_test");

function item(overrides?: {
  readonly failing?: boolean;
  readonly changesRequested?: boolean;
  readonly draft?: boolean;
  readonly checkStatus?: PullRequestInboxItem["pullRequest"]["checks"]["status"];
  readonly reviewDisposition?: PullRequestInboxItem["pullRequest"]["review"]["disposition"];
}): PullRequestInboxItem {
  const observedAt = DateTime.makeUnsafe("2026-08-09T10:00:00Z");
  return {
    pullRequest: {
      identity: {
        id: pullRequestId,
        environmentId,
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
      title: "Add AI priority",
      url: "https://github.com/ryco/app/pull/42",
      state: "open",
      isDraft: overrides?.draft === true,
      author: "author",
      assignees: ["viewer"],
      baseRefName: "main",
      headRefName: "feature/ai",
      labels: [],
      review: {
        disposition:
          overrides?.reviewDisposition ??
          (overrides?.changesRequested ? "changes-requested" : "review-required"),
        requestedReviewers: ["viewer"],
        approvedBy: [],
      },
      checks: {
        status: overrides?.checkStatus ?? (overrides?.failing ? "failing" : "passing"),
        total: 2,
        passing: overrides?.failing ? 1 : 2,
        failing: overrides?.failing ? 1 : 0,
        pending: 0,
      },
      capabilities: {
        detail: true,
        comments: true,
        reviews: true,
        checks: true,
        commits: true,
        files: true,
        viewerIdentity: true,
      },
      viewer: { isAuthor: false, isAssignee: true, reviewRequested: true },
      freshness: {
        observedAt,
        providerUpdatedAt: Option.some(observedAt),
        refreshGeneration: 1,
      },
    },
    associations: [
      {
        pullRequestId,
        subject: { kind: "thread", threadId: "thread-ai" as never },
        relationship: "created",
        evidence: "structured-provider-result",
        createdAt: observedAt,
        endedAt: Option.none(),
      },
    ],
    viewState: {
      pullRequestId,
      isUnread: true,
      viewedAt: Option.none(),
      providerUpdatedAtWhenViewed: Option.none(),
    },
  };
}

const assessment: PullRequestAiModelAssessment = {
  pullRequestId,
  depth: "deep",
  summary: "Implements the AI priority workspace.",
  implementationPhase: "validation-cleanup",
  attentionReason: "Review requested with broad persistence changes.",
  suggestedNextAction: "Review the cache migration.",
  risk: "high",
  riskEvidence: ["Changes persistence and provider execution."],
  hotspots: [],
  riskPoints: 12,
  blockerPoints: 5,
  reviewImpactPoints: 8,
  timeSensitivityPoints: 3,
  implementationCompletenessPoints: 12,
  unresolvedDiscussionRiskPoints: 2,
  confidence: 82,
};

describe("pull request intelligence", () => {
  it("calculates deterministic attention signals and priority categories", () => {
    expect(deterministicPullRequestPriorityPoints(item())).toBe(45);
    expect(pullRequestAiPriorityForScore(79)).toBe("high");
    expect(pullRequestAiPriorityForScore(80)).toBe("urgent");
  });

  it("caps readiness when factual blockers exist", () => {
    const readiness = calculatePullRequestMergeReadiness({
      item: item({ failing: true, changesRequested: true }),
      mergeability: "mergeable",
      assessment,
    });
    expect(readiness?.score).toBeLessThanOrEqual(55);
    expect(readiness?.appliedCaps).toEqual(
      expect.arrayContaining([
        "Failing checks cap readiness at 55%.",
        "Requested changes cap readiness at 60%.",
      ]),
    );
  });

  it("marks readiness as insufficient when provider evidence is mostly unknown", () => {
    const unknownItem = item({ checkStatus: "unknown", reviewDisposition: "unknown" });
    const readiness = calculatePullRequestMergeReadiness({
      item: unknownItem,
      mergeability: "unknown",
      assessment,
    });
    expect(readiness?.insufficientEvidence).toBe(true);
  });

  it("builds a combined explainable analysis", () => {
    const analyzedAt = DateTime.makeUnsafe("2026-08-09T11:00:00Z");
    const result = buildPullRequestAiAnalysis({
      item: item(),
      viewerKey: "owner",
      modelSelection: { instanceId: "codex" as never, model: "gpt-5.4-mini" },
      assessment,
      mergeability: "mergeable",
      promptVersion: 1,
      schemaVersion: 1,
      sourceFingerprint: "source-v1",
      analyzedAt,
      expiresAt: DateTime.makeUnsafe("2026-08-10T11:00:00Z"),
    });
    expect(result.priority).toBe("high");
    expect(result.priorityScore).toBe(73);
    expect(Option.isSome(result.mergeReadiness)).toBe(true);
  });

  it("fingerprints object keys canonically", () => {
    expect(pullRequestAiSourceFingerprint({ a: 1, b: [2, 3] })).toBe(
      pullRequestAiSourceFingerprint({ b: [2, 3], a: 1 }),
    );
    expect(pullRequestAiSourceFingerprint({ a: 2 })).not.toBe(
      pullRequestAiSourceFingerprint({ a: 1 }),
    );
  });
});
