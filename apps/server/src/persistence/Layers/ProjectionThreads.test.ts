import { ProjectId, ProviderInstanceId, ThreadId } from "@ryco/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { runMigrations } from "../Migrations.ts";
import { ProjectionThreadRepository } from "../Services/ProjectionThreads.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionThreadRepositoryLive } from "./ProjectionThreads.ts";

const layer = it.layer(
  ProjectionThreadRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

const BASE_ROW = {
  threadId: ThreadId.make("thread-settlement"),
  projectId: ProjectId.make("project-1"),
  title: "Settlement",
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.4",
  },
  runtimeMode: "full-access",
  interactionMode: "default",
  tokenMode: "balanced",
  branch: null,
  worktreePath: null,
  worktreeId: null,
  manualStatusBucket: null,
  manualPosition: 0,
  latestTurnId: null,
  goal: null,
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  latestUserMessageAt: null,
  pendingApprovalCount: 0,
  pendingUserInputCount: 0,
  hasActionableProposedPlan: 0,
  deletedAt: null,
} as const;

layer("ProjectionThreadRepository settlement", (it) => {
  it.effect("round-trips and clears settlement state", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 52 });
      const repository = yield* ProjectionThreadRepository;

      yield* repository.upsert({
        ...BASE_ROW,
        settledOverride: "settled",
        settledAt: "2026-07-31T01:00:00.000Z",
      });
      const settled = yield* repository.getById({ threadId: BASE_ROW.threadId });
      assert.isTrue(Option.isSome(settled));
      if (Option.isSome(settled)) {
        assert.equal(settled.value.settledOverride, "settled");
        assert.equal(settled.value.settledAt, "2026-07-31T01:00:00.000Z");
      }

      yield* repository.upsert({
        ...BASE_ROW,
        settledOverride: "active",
        settledAt: null,
      });
      const active = yield* repository.getById({ threadId: BASE_ROW.threadId });
      assert.isTrue(Option.isSome(active));
      if (Option.isSome(active)) {
        assert.equal(active.value.settledOverride, "active");
        assert.isNull(active.value.settledAt);
      }
    }),
  );
});
