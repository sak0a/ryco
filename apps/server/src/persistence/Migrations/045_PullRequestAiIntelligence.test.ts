import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("045_PullRequestAiIntelligence", (it) => {
  it.effect("creates the derived PR analysis cache tables", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 45 });
      const rows = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'pull_request_ai_%'
        ORDER BY name
      `;
      assert.deepStrictEqual(
        rows.map((row) => row.name),
        ["pull_request_ai_analyses", "pull_request_ai_meta", "pull_request_ai_runs"],
      );
    }),
  );
});
