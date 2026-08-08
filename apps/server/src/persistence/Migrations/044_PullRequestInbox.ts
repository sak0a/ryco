import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE projection_pull_requests (
      pull_request_id TEXT PRIMARY KEY NOT NULL,
      environment_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      host TEXT NOT NULL,
      repository_path TEXT NOT NULL,
      repository_key TEXT NOT NULL,
      number INTEGER NOT NULL CHECK (number > 0),
      state TEXT NOT NULL CHECK (state IN ('open', 'closed', 'merged')),
      is_draft INTEGER NOT NULL CHECK (is_draft IN (0, 1)),
      title TEXT NOT NULL,
      author TEXT,
      provider_updated_at TEXT,
      observed_at TEXT NOT NULL,
      refresh_generation INTEGER NOT NULL CHECK (refresh_generation >= 0),
      record_json TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX projection_pull_requests_identity_idx
    ON projection_pull_requests(environment_id, provider, host, repository_path, number)
  `;
  yield* sql`
    CREATE INDEX projection_pull_requests_inbox_idx
    ON projection_pull_requests(environment_id, state, provider_updated_at DESC, observed_at DESC)
  `;
  yield* sql`
    CREATE INDEX projection_pull_requests_repository_idx
    ON projection_pull_requests(environment_id, repository_key, number)
  `;

  yield* sql`
    CREATE TABLE projection_pull_request_access_targets (
      access_target_id INTEGER PRIMARY KEY AUTOINCREMENT,
      pull_request_id TEXT NOT NULL REFERENCES projection_pull_requests(pull_request_id) ON DELETE CASCADE,
      environment_id TEXT NOT NULL,
      project_id TEXT,
      cwd TEXT NOT NULL,
      remote_url TEXT,
      last_verified_at TEXT NOT NULL,
      UNIQUE(pull_request_id, cwd)
    )
  `;
  yield* sql`
    CREATE INDEX projection_pull_request_access_environment_idx
    ON projection_pull_request_access_targets(environment_id, last_verified_at DESC)
  `;

  yield* sql`
    CREATE TABLE projection_pull_request_associations (
      association_id INTEGER PRIMARY KEY AUTOINCREMENT,
      pull_request_id TEXT NOT NULL REFERENCES projection_pull_requests(pull_request_id) ON DELETE CASCADE,
      subject_kind TEXT NOT NULL CHECK (subject_kind IN ('thread', 'worktree')),
      subject_id TEXT NOT NULL,
      relationship TEXT NOT NULL CHECK (relationship IN (
        'created', 'opened-existing', 'current-branch', 'explicitly-attached', 'mentioned', 'inspected'
      )),
      evidence TEXT NOT NULL CHECK (evidence IN (
        'structured-provider-result', 'branch-reconciliation', 'user-attachment',
        'structured-thread-context', 'verified-textual-reference', 'verified-legacy-backfill'
      )),
      created_at TEXT NOT NULL,
      ended_at TEXT
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX projection_pull_request_active_association_idx
    ON projection_pull_request_associations(pull_request_id, subject_kind, subject_id, relationship)
    WHERE ended_at IS NULL
  `;
  yield* sql`
    CREATE INDEX projection_pull_request_association_subject_idx
    ON projection_pull_request_associations(subject_kind, subject_id, ended_at, created_at DESC)
  `;
  yield* sql`
    CREATE INDEX projection_pull_request_association_pr_idx
    ON projection_pull_request_associations(pull_request_id, ended_at, created_at DESC)
  `;

  yield* sql`
    CREATE TABLE projection_pull_request_view_state (
      pull_request_id TEXT NOT NULL REFERENCES projection_pull_requests(pull_request_id) ON DELETE CASCADE,
      viewer_key TEXT NOT NULL,
      viewed_at TEXT,
      provider_updated_at_when_viewed TEXT,
      marked_unread_at TEXT,
      PRIMARY KEY(pull_request_id, viewer_key)
    )
  `;
  yield* sql`
    CREATE INDEX projection_pull_request_viewer_unread_idx
    ON projection_pull_request_view_state(viewer_key, marked_unread_at, viewed_at)
  `;
});
