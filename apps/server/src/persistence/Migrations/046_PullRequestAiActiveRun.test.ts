import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));
const partialUpgradeLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("046_PullRequestAiActiveRun", (it) => {
  it.effect("adds the one-active-run-per-environment constraint after migration 45", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 45 });

      const before = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name = 'pull_request_ai_runs_active_environment_idx'
      `;
      assert.deepStrictEqual(before, []);

      yield* runMigrations({ toMigrationInclusive: 46 });
      const after = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name = 'pull_request_ai_runs_active_environment_idx'
      `;
      assert.deepStrictEqual(after, [{ name: "pull_request_ai_runs_active_environment_idx" }]);
    }),
  );
});

partialUpgradeLayer("046_PullRequestAiActiveRun partial upgrade", (it) => {
  it.effect("accepts databases where the active-run index was created before migration 46", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 45 });
      yield* sql`
        CREATE UNIQUE INDEX pull_request_ai_runs_active_environment_idx
        ON pull_request_ai_runs(environment_id)
        WHERE status IN ('planned', 'ranking', 'deep-analysis', 'cancelling')
      `;

      yield* runMigrations({ toMigrationInclusive: 46 });

      const indexes = yield* sql<{
        readonly name: string;
        readonly sql: string;
      }>`
        SELECT name, sql FROM sqlite_master
        WHERE type = 'index' AND name = 'pull_request_ai_runs_active_environment_idx'
      `;
      assert.strictEqual(indexes.length, 1);
      assert.match(indexes[0]?.sql ?? "", /CREATE UNIQUE INDEX/);
    }),
  );
});
