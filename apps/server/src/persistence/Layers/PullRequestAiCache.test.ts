import {
  EnvironmentId,
  ProviderInstanceId,
  PullRequestAiRunId,
  PullRequestId,
} from "@ryco/contracts";
import { assert, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Option } from "effect";

import { runMigrations } from "../Migrations.ts";
import { PullRequestAiCache } from "../Services/PullRequestAiCache.ts";
import { ProjectionPullRequestRepository } from "../Services/ProjectionPullRequests.ts";
import { PullRequestAiCacheLive } from "./PullRequestAiCache.ts";
import { ProjectionPullRequestRepositoryLive } from "./ProjectionPullRequests.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  Layer.mergeAll(ProjectionPullRequestRepositoryLive, PullRequestAiCacheLive).pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
  ),
);

const environmentId = EnvironmentId.make("local");
const pullRequestId = PullRequestId.make("pr_ai_cache");
const now = DateTime.makeUnsafe("2026-08-09T10:00:00Z");

const pullRequest = {
  identity: {
    id: pullRequestId,
    environmentId,
    provider: "github" as const,
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
  title: "Add AI PR intelligence",
  url: "https://github.com/ryco/app/pull/42",
  state: "open" as const,
  isDraft: false,
  assignees: [],
  baseRefName: "main",
  headRefName: "feature/ai-pr",
  labels: [],
  review: { disposition: "review-required" as const, requestedReviewers: [], approvedBy: [] },
  checks: { status: "passing" as const, total: 3, passing: 3, failing: 0, pending: 0 },
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
    observedAt: now,
    providerUpdatedAt: Option.some(now),
    refreshGeneration: 1,
  },
};

const assessment = {
  pullRequestId,
  depth: "deep" as const,
  summary: "Introduces cached, model-assisted pull request ranking.",
  implementationPhase: "review-ready" as const,
  attentionReason: "It changes the inbox decision surface.",
  suggestedNextAction: "Review the cache and authorization boundaries.",
  risk: "medium" as const,
  riskEvidence: ["Touches persistence and provider data."],
  hotspots: [
    {
      filePath: "apps/server/src/ws/pullRequestRpc.ts",
      title: "Cancellation lifecycle",
      explanation: "Verify interrupted runs always persist terminal state.",
      risk: "medium" as const,
    },
  ],
  riskPoints: 8,
  blockerPoints: 2,
  reviewImpactPoints: 8,
  timeSensitivityPoints: 2,
  implementationCompletenessPoints: 13,
  unresolvedDiscussionRiskPoints: 1,
  confidence: 82,
};

layer("PullRequestAiCache", (it) => {
  it.effect("round-trips viewer-scoped analysis and run state", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 45 });
      const projection = yield* ProjectionPullRequestRepository;
      const cache = yield* PullRequestAiCache;
      yield* projection.upsert(pullRequest);
      yield* cache.upsertAnalysis({
        pullRequestId,
        viewerKey: "viewer-a",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
        promptVersion: 1,
        schemaVersion: 1,
        sourceFingerprint: "fingerprint-a",
        sourceProviderUpdatedAt: Option.some(now),
        depth: "deep",
        priorityScore: 81,
        priority: "urgent",
        deterministicPriorityPoints: 42,
        modelPriorityPoints: 39,
        priorityExplanation: assessment.attentionReason,
        assessment,
        mergeReadiness: Option.some({
          score: 78,
          confidence: 84,
          insufficientEvidence: false,
          factors: [
            {
              kind: "checks",
              points: 25,
              possiblePoints: 25,
              known: true,
              explanation: "Checks pass.",
            },
          ],
          appliedCaps: [],
        }),
        analyzedAt: now,
        expiresAt: DateTime.add(now, { hours: 24 }),
        isStale: false,
      });
      yield* cache.upsertRun({
        id: PullRequestAiRunId.make("run-a"),
        environmentId,
        viewerKey: "viewer-a",
        scope: "view",
        pullRequestIds: [pullRequestId],
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
        resourceMode: "balanced",
        status: "ranking",
        progress: { planned: 1, ranked: 0, deepPlanned: 0, deepCompleted: 0, cached: 0, failed: 0 },
        startedAt: now,
        completedAt: Option.none(),
      });

      const snapshot = yield* cache.listSnapshot({ environmentId, viewerKey: "viewer-a" });
      assert.equal(snapshot.analyses.length, 1);
      assert.equal(
        snapshot.analyses[0]?.assessment.hotspots[0]?.filePath,
        "apps/server/src/ws/pullRequestRpc.ts",
      );
      assert.isTrue(Option.isSome(snapshot.analyses[0]!.mergeReadiness));
      assert.isTrue(Option.isSome(snapshot.currentRun));
      assert.isTrue(Option.isSome(snapshot.latestRun));

      const changedAt = DateTime.add(now, { minutes: 30 });
      yield* projection.upsert({
        ...pullRequest,
        freshness: {
          ...pullRequest.freshness,
          providerUpdatedAt: Option.some(changedAt),
          refreshGeneration: 2,
        },
      });
      const staleSnapshot = yield* cache.listSnapshot({
        environmentId,
        viewerKey: "viewer-a",
      });
      assert.isTrue(staleSnapshot.analyses[0]?.isStale ?? false);

      const otherViewer = yield* cache.listSnapshot({
        environmentId,
        viewerKey: "viewer-b",
      });
      assert.equal(otherViewer.analyses.length, 0);
      assert.isTrue(Option.isNone(otherViewer.currentRun));
      assert.isTrue(Option.isNone(otherViewer.latestRun));
    }),
  );
});
