import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS pull_request_ai_runs_active_environment_idx
    ON pull_request_ai_runs(environment_id)
    WHERE status IN ('planned', 'ranking', 'deep-analysis', 'cancelling')
  `;
});
