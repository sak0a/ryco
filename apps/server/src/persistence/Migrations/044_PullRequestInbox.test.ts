import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("044_PullRequestInbox", (it) => {
  it.effect("creates the canonical PR, access, association, and viewer tables", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 44 });
      const rows = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'projection_pull_request%'
        ORDER BY name
      `;
      assert.deepStrictEqual(
        rows.map((row) => row.name),
        [
          "projection_pull_request_access_targets",
          "projection_pull_request_associations",
          "projection_pull_request_view_state",
          "projection_pull_requests",
        ],
      );
    }),
  );
});
