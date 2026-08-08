import {
  CommandId,
  EnvironmentId,
  EventId,
  ProjectId,
  PullRequestId,
  ThreadId,
} from "@ryco/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Option } from "effect";

import { ServerConfig } from "../../config.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ProjectionPullRequestRepository } from "../../persistence/Services/ProjectionPullRequests.ts";
import { ProjectAvatarStore } from "../../project/Services/ProjectAvatarStore.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";

const MockProjectAvatarStoreLive = Layer.succeed(ProjectAvatarStore, {
  write: () => Effect.die("ProjectAvatarStore.write not implemented in test"),
  read: () => Effect.succeed(null),
  remove: () => Effect.void,
});

const layer = OrchestrationProjectionPipelineLive.pipe(
  Layer.provideMerge(OrchestrationEventStoreLive),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "ryco-pr-projection-test-" })),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(MockProjectAvatarStoreLive),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(layer)("pull request orchestration projection", (it) => {
  it.effect("replays verified records and many-to-many association events", () =>
    Effect.gen(function* () {
      const pipeline = yield* OrchestrationProjectionPipeline;
      const repository = yield* ProjectionPullRequestRepository;
      const pullRequestId = PullRequestId.make("pr_event_projection");
      const observedAt = DateTime.makeUnsafe("2026-08-08T12:00:00Z");
      const environmentId = EnvironmentId.make("local");
      const record = {
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
        title: "Event-projected inbox",
        url: "https://github.com/ryco/app/pull/42",
        state: "open" as const,
        isDraft: false,
        assignees: [],
        baseRefName: "main",
        headRefName: "feature/inbox",
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
          observedAt,
          providerUpdatedAt: Option.none(),
          refreshGeneration: 1,
        },
      };
      const accessTarget = {
        pullRequestId,
        environmentId,
        projectId: ProjectId.make("project-a"),
        cwd: "/tmp/app",
        lastVerifiedAt: observedAt,
      };

      yield* pipeline.projectEvent({
        sequence: 1,
        eventId: EventId.make("evt-pr-observed"),
        aggregateKind: "pull-request",
        aggregateId: pullRequestId,
        type: "pull-request.observed",
        occurredAt: "2026-08-08T12:00:00.000Z",
        commandId: CommandId.make("cmd-pr-observed"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-pr-observed"),
        metadata: {},
        payload: { pullRequestId, record, accessTarget },
      });
      yield* pipeline.projectEvent({
        sequence: 2,
        eventId: EventId.make("evt-pr-associated"),
        aggregateKind: "pull-request",
        aggregateId: pullRequestId,
        type: "pull-request.association-recorded",
        occurredAt: "2026-08-08T12:01:00.000Z",
        commandId: CommandId.make("cmd-pr-associated"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-pr-associated"),
        metadata: {},
        payload: {
          pullRequestId,
          association: {
            pullRequestId,
            subject: { kind: "thread", threadId: ThreadId.make("thread-a") },
            relationship: "created",
            evidence: "structured-provider-result",
            createdAt: observedAt,
            endedAt: Option.none(),
          },
        },
      });

      assert.isTrue(Option.isSome(yield* repository.getById(pullRequestId)));
      assert.equal((yield* repository.listAccessTargets(pullRequestId)).length, 1);
      assert.equal((yield* repository.listAssociations(pullRequestId)).length, 1);
    }),
  );
});
