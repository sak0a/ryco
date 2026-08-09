import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE pull_request_ai_analyses (
      pull_request_id TEXT NOT NULL REFERENCES projection_pull_requests(pull_request_id) ON DELETE CASCADE,
      viewer_key TEXT NOT NULL,
      provider_instance_id TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version INTEGER NOT NULL CHECK (prompt_version > 0),
      schema_version INTEGER NOT NULL CHECK (schema_version > 0),
      source_fingerprint TEXT NOT NULL,
      depth TEXT NOT NULL CHECK (depth IN ('shallow', 'deep')),
      priority_score INTEGER NOT NULL CHECK (priority_score BETWEEN 0 AND 100),
      analyzed_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      analysis_json TEXT NOT NULL,
      PRIMARY KEY(pull_request_id, viewer_key)
    )
  `;
  yield* sql`
    CREATE INDEX pull_request_ai_analyses_viewer_priority_idx
    ON pull_request_ai_analyses(viewer_key, priority_score DESC, analyzed_at DESC)
  `;
  yield* sql`
    CREATE INDEX pull_request_ai_analyses_fingerprint_idx
    ON pull_request_ai_analyses(viewer_key, pull_request_id, source_fingerprint)
  `;

  yield* sql`
    CREATE TABLE pull_request_ai_runs (
      run_id TEXT PRIMARY KEY NOT NULL,
      environment_id TEXT NOT NULL,
      viewer_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN (
        'planned', 'ranking', 'deep-analysis', 'cancelling', 'completed',
        'partially-completed', 'cancelled', 'failed'
      )),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      run_json TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX pull_request_ai_runs_viewer_started_idx
    ON pull_request_ai_runs(viewer_key, started_at DESC)
  `;
  yield* sql`
    CREATE TABLE pull_request_ai_meta (
      singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
      generation INTEGER NOT NULL CHECK (generation >= 0)
    )
  `;
  yield* sql`INSERT INTO pull_request_ai_meta(singleton, generation) VALUES (1, 0)`;
});
