import { EnvironmentId, ProjectId, PullRequestId, ThreadId } from "@ryco/contracts";
import { assert, it } from "@effect/vitest";
import { DateTime, Effect, Fiber, Layer, Option, Stream } from "effect";

import { runMigrations } from "../Migrations.ts";
import {
  ProjectionPullRequestRepository,
  PullRequestViewerKey,
} from "../Services/ProjectionPullRequests.ts";
import { ProjectionPullRequestRepositoryLive } from "./ProjectionPullRequests.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ProjectionPullRequestRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

const makeRecord = (id: string, repositoryPath: string) => ({
  identity: {
    id: PullRequestId.make(id),
    environmentId: EnvironmentId.make("local"),
    provider: "github" as const,
    host: "github.com",
    repositoryPath,
    number: 42,
  },
  repository: {
    canonicalKey: `github.com/${repositoryPath}`,
    host: "github.com",
    path: repositoryPath,
    displayName: repositoryPath,
  },
  title: `PR in ${repositoryPath}`,
  url: `https://github.com/${repositoryPath}/pull/42`,
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
    observedAt: DateTime.makeUnsafe("2026-08-08T12:00:00Z"),
    providerUpdatedAt: Option.none(),
    refreshGeneration: 1,
  },
});

layer("ProjectionPullRequestRepository", (it) => {
  it.effect("keeps same-number PRs in different repositories and many-to-many links", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 44 });
      const repo = yield* ProjectionPullRequestRepository;
      const app = makeRecord("pr_app", "ryco/app");
      const server = makeRecord("pr_server", "ryco/server");
      yield* repo.upsert(app);
      yield* repo.upsert(server);
      yield* repo.upsertAccessTarget({
        pullRequestId: app.identity.id,
        environmentId: app.identity.environmentId,
        projectId: ProjectId.make("project-app"),
        cwd: "/tmp/app",
        lastVerifiedAt: app.freshness.observedAt,
      });
      for (const threadId of ["thread-a", "thread-b"]) {
        yield* repo.recordAssociation({
          pullRequestId: app.identity.id,
          subject: { kind: "thread", threadId: ThreadId.make(threadId) },
          relationship: "explicitly-attached",
          evidence: "user-attachment",
          createdAt: app.freshness.observedAt,
          endedAt: Option.none(),
        });
      }
      const inbox = yield* repo.listInbox(PullRequestViewerKey.make("viewer-a"));
      assert.equal(inbox.items.length, 2);
      assert.equal(
        inbox.items.find((item) => item.pullRequest.identity.id === app.identity.id)?.associations
          .length,
        2,
      );
      assert.isTrue(inbox.items.every((item) => item.viewState.isUnread));
      const targets = yield* repo.listAccessTargets(app.identity.id);
      assert.equal(targets[0]?.cwd, "/tmp/app");
    }),
  );

  it.effect("rejects stale provider generations and isolates viewer state", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 44 });
      const repo = yield* ProjectionPullRequestRepository;
      const record = makeRecord("pr_generation", "ryco/generation");
      yield* repo.upsert({ ...record, freshness: { ...record.freshness, refreshGeneration: 2 } });
      const accepted = yield* repo.upsert(record);
      assert.isFalse(accepted);
      yield* repo.markViewed({
        pullRequestId: record.identity.id,
        viewerKey: PullRequestViewerKey.make("viewer-a"),
        viewedAt: record.freshness.observedAt,
      });
      const viewed = yield* repo.listInbox(PullRequestViewerKey.make("viewer-a"));
      const other = yield* repo.listInbox(PullRequestViewerKey.make("viewer-b"));
      assert.isFalse(
        viewed.items.find((item) => item.pullRequest.identity.id === record.identity.id)?.viewState
          .isUnread ?? true,
      );
      assert.isTrue(
        other.items.find((item) => item.pullRequest.identity.id === record.identity.id)?.viewState
          .isUnread ?? false,
      );
    }),
  );

  it.effect("preserves temporal branch history and rejects older provider data", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 44 });
      const repo = yield* ProjectionPullRequestRepository;
      const record = makeRecord("pr_history", "ryco/history");
      const providerUpdatedAt = DateTime.makeUnsafe("2026-08-08T11:30:00Z");
      yield* repo.upsert({
        ...record,
        freshness: {
          ...record.freshness,
          providerUpdatedAt: Option.some(providerUpdatedAt),
          refreshGeneration: 2,
        },
      });
      const olderAccepted = yield* repo.upsert({
        ...record,
        title: "Stale title",
        freshness: {
          ...record.freshness,
          providerUpdatedAt: Option.some(DateTime.makeUnsafe("2026-08-08T11:00:00Z")),
          refreshGeneration: 3,
        },
      });
      assert.isFalse(olderAccepted);

      const subject = { kind: "thread" as const, threadId: ThreadId.make("thread-history") };
      yield* repo.recordAssociation({
        pullRequestId: record.identity.id,
        subject,
        relationship: "created",
        evidence: "structured-provider-result",
        createdAt: record.freshness.observedAt,
        endedAt: Option.none(),
      });
      yield* repo.recordAssociation({
        pullRequestId: record.identity.id,
        subject,
        relationship: "current-branch",
        evidence: "branch-reconciliation",
        createdAt: record.freshness.observedAt,
        endedAt: Option.none(),
      });
      yield* repo.endAssociation({
        pullRequestId: record.identity.id,
        subject,
        relationship: "current-branch",
        endedAt: DateTime.makeUnsafe("2026-08-08T12:30:00Z"),
      });
      const associations = yield* repo.listAssociations(record.identity.id);
      assert.equal(associations.length, 2);
      assert.isTrue(
        Option.isNone(
          associations.find((association) => association.relationship === "created")!.endedAt,
        ),
      );
      assert.isTrue(
        Option.isSome(
          associations.find((association) => association.relationship === "current-branch")!
            .endedAt,
        ),
      );
    }),
  );

  it.effect("publishes committed projection changes for inbox subscribers", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 44 });
      const repo = yield* ProjectionPullRequestRepository;
      const nextChange = yield* Stream.runHead(repo.streamChanges).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* repo.upsert(makeRecord("pr_stream", "ryco/stream"));
      assert.isTrue(Option.isSome(yield* Fiber.join(nextChange)));
    }),
  );
});
