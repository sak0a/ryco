import { ProjectId, WorktreeId } from "@ryco/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { runMigrations } from "../Migrations.ts";
import { ProjectionWorktreeRepository } from "../Services/ProjectionWorktrees.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionWorktreeRepositoryLive } from "./ProjectionWorktrees.ts";

const layer = it.layer(
  ProjectionWorktreeRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProjectionWorktreeRepository", (it) => {
  it.effect("upsert + getById round-trips a row", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 37 });
      const repo = yield* ProjectionWorktreeRepository;

      const id = WorktreeId.make("worktree-test");
      yield* repo.upsert({
        worktreeId: id,
        projectId: ProjectId.make("project-x"),
        title: null,
        branch: "main",
        worktreePath: null,
        origin: "main",
        prNumber: null,
        issueNumber: null,
        prTitle: null,
        issueTitle: null,
        prState: null,
        prIsDraft: null,
        issueState: null,
        createdAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z",
        archivedAt: null,
        manualPosition: 0,
      });

      const row = yield* repo.getById({ worktreeId: id });
      assert.isTrue(Option.isSome(row));
      if (Option.isSome(row)) {
        assert.equal(row.value.branch, "main");
        assert.equal(row.value.origin, "main");
      }
    }),
  );

  it.effect("updateMeta changes the persisted title", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 37 });
      const repo = yield* ProjectionWorktreeRepository;

      const id = WorktreeId.make("worktree-title-test");
      yield* repo.upsert({
        worktreeId: id,
        projectId: ProjectId.make("project-x"),
        title: null,
        branch: "main",
        worktreePath: null,
        origin: "main",
        prNumber: null,
        issueNumber: null,
        prTitle: null,
        issueTitle: null,
        prState: null,
        prIsDraft: null,
        issueState: null,
        createdAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z",
        archivedAt: null,
        manualPosition: 0,
      });

      yield* repo.updateMeta({
        worktreeId: id,
        title: "Renamed Worktree",
        updatedAt: "2026-05-08T01:00:00.000Z",
      });

      const row = yield* repo.getById({ worktreeId: id });
      assert.isTrue(Option.isSome(row));
      if (Option.isSome(row)) {
        assert.equal(row.value.title, "Renamed Worktree");
        assert.equal(row.value.updatedAt, "2026-05-08T01:00:00.000Z");
      }
    }),
  );

  it.effect("findByOrigin returns the matching open worktree", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 37 });
      const repo = yield* ProjectionWorktreeRepository;

      yield* repo.upsert({
        worktreeId: WorktreeId.make("wt-pr-42"),
        projectId: ProjectId.make("project-x"),
        title: null,
        branch: "feat/x",
        worktreePath: "/tmp/wt",
        origin: "pr",
        prNumber: 42,
        issueNumber: null,
        prTitle: "Add x",
        issueTitle: null,
        prState: null,
        prIsDraft: null,
        issueState: null,
        createdAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z",
        archivedAt: null,
        manualPosition: 0,
      });

      const found = yield* repo.findByOrigin({
        projectId: ProjectId.make("project-x"),
        kind: "pr",
        number: 42,
      });
      assert.equal(found, "wt-pr-42");
    }),
  );

  it.effect("findByOrigin ignores archived worktrees", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 37 });
      const repo = yield* ProjectionWorktreeRepository;

      yield* repo.upsert({
        worktreeId: WorktreeId.make("wt-pr-42-archived"),
        projectId: ProjectId.make("project-archived"),
        title: null,
        branch: "feat/x",
        worktreePath: "/tmp/wt",
        origin: "pr",
        prNumber: 42,
        issueNumber: null,
        prTitle: null,
        issueTitle: null,
        prState: null,
        prIsDraft: null,
        issueState: null,
        createdAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z",
        archivedAt: "2026-05-09T00:00:00.000Z",
        manualPosition: 0,
      });

      const found = yield* repo.findByOrigin({
        projectId: ProjectId.make("project-archived"),
        kind: "pr",
        number: 42,
      });
      assert.isNull(found);
    }),
  );

  it.effect("round-trips pr_state, pr_is_draft, issue_state", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 37 });
      const repo = yield* ProjectionWorktreeRepository;

      yield* repo.upsert({
        worktreeId: WorktreeId.make("w-1"),
        projectId: ProjectId.make("proj"),
        title: "Feature 1",
        branch: "feature/1",
        worktreePath: "/tmp/feature-1",
        origin: "pr",
        prNumber: 123,
        issueNumber: 7,
        prTitle: "Feature 1 PR",
        issueTitle: "Feature 1 issue",
        prState: "merged",
        prIsDraft: false,
        issueState: "closed",
        createdAt: "2026-05-17T00:00:00.000Z",
        updatedAt: "2026-05-17T00:00:00.000Z",
        archivedAt: null,
        manualPosition: 0,
      });

      const round = yield* repo.getById({ worktreeId: WorktreeId.make("w-1") });
      assert.isTrue(Option.isSome(round));
      if (Option.isSome(round)) {
        assert.equal(round.value.prState, "merged");
        assert.equal(round.value.prIsDraft, false);
        assert.equal(round.value.issueState, "closed");
      }
    }),
  );

  it.effect("round-trips prIsDraft true", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 37 });
      const repo = yield* ProjectionWorktreeRepository;

      yield* repo.upsert({
        worktreeId: WorktreeId.make("w-draft"),
        projectId: ProjectId.make("proj"),
        title: "Draft PR",
        branch: "feature/draft",
        worktreePath: "/tmp/draft",
        origin: "pr",
        prNumber: 99,
        issueNumber: null,
        prTitle: "Draft PR",
        issueTitle: null,
        prState: "open",
        prIsDraft: true,
        issueState: null,
        createdAt: "2026-05-17T00:00:00.000Z",
        updatedAt: "2026-05-17T00:00:00.000Z",
        archivedAt: null,
        manualPosition: 0,
      });

      const round = yield* repo.getById({ worktreeId: WorktreeId.make("w-draft") });
      assert.isTrue(Option.isSome(round));
      if (Option.isSome(round)) {
        assert.equal(round.value.prState, "open");
        assert.equal(round.value.prIsDraft, true);
      }
    }),
  );

  it.effect("round-trips null state fields", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 37 });
      const repo = yield* ProjectionWorktreeRepository;

      yield* repo.upsert({
        worktreeId: WorktreeId.make("w-null"),
        projectId: ProjectId.make("proj"),
        title: null,
        branch: "main",
        worktreePath: null,
        origin: "main",
        prNumber: null,
        issueNumber: null,
        prTitle: null,
        issueTitle: null,
        prState: null,
        prIsDraft: null,
        issueState: null,
        createdAt: "2026-05-17T00:00:00.000Z",
        updatedAt: "2026-05-17T00:00:00.000Z",
        archivedAt: null,
        manualPosition: 0,
      });

      const round = yield* repo.getById({ worktreeId: WorktreeId.make("w-null") });
      assert.isTrue(Option.isSome(round));
      if (Option.isSome(round)) {
        assert.equal(round.value.prState, null);
        assert.equal(round.value.prIsDraft, null);
        assert.equal(round.value.issueState, null);
      }
    }),
  );

  it.effect("findActiveByLinkedNumber finds non-archived worktrees by PR number", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 37 });
      const repo = yield* ProjectionWorktreeRepository;

      yield* repo.upsert({
        worktreeId: WorktreeId.make("w-pr-active"),
        projectId: ProjectId.make("proj-a"),
        title: null,
        branch: "feature/pr",
        worktreePath: "/tmp/pr",
        origin: "pr",
        prNumber: 999,
        issueNumber: null,
        prTitle: "PR",
        issueTitle: null,
        prState: "open",
        prIsDraft: false,
        issueState: null,
        createdAt: "2026-05-17T00:00:00.000Z",
        updatedAt: "2026-05-17T00:00:00.000Z",
        archivedAt: null,
        manualPosition: 0,
      });

      yield* repo.upsert({
        worktreeId: WorktreeId.make("w-pr-archived"),
        projectId: ProjectId.make("proj-b"),
        title: null,
        branch: "feature/pr-archived",
        worktreePath: "/tmp/pr-archived",
        origin: "pr",
        prNumber: 999,
        issueNumber: null,
        prTitle: "PR archived",
        issueTitle: null,
        prState: "open",
        prIsDraft: false,
        issueState: null,
        createdAt: "2026-05-17T00:00:00.000Z",
        updatedAt: "2026-05-17T00:00:00.000Z",
        archivedAt: "2026-05-17T01:00:00.000Z",
        manualPosition: 0,
      });

      const ids = yield* repo.findActiveByLinkedNumber({
        projectId: ProjectId.make("proj-a"),
        kind: "pr",
        number: 999,
      });
      assert.equal(ids.length, 1);
      assert.equal(ids[0], "w-pr-active");
    }),
  );

  it.effect("findActiveByLinkedNumber returns empty when no match", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 37 });
      const repo = yield* ProjectionWorktreeRepository;

      const ids = yield* repo.findActiveByLinkedNumber({
        projectId: ProjectId.make("proj-a"),
        kind: "issue",
        number: 12345,
      });
      assert.equal(ids.length, 0);
    }),
  );
});
