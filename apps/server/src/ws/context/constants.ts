export const PROVIDER_STATUS_DEBOUNCE_MS = 200;
export const SOURCE_CONTROL_LINKED_REFRESH_DEBOUNCE_MS = 5_000;
export const ORCHESTRATION_REPLAY_PAGE_MAX_LIMIT = 1_000;
export const ORCHESTRATION_LEGACY_REPLAY_MAX_EVENTS = ORCHESTRATION_REPLAY_PAGE_MAX_LIMIT;
export const ORCHESTRATION_LIVE_QUEUE_MAX_EVENTS = 1_000;
/**
 * Byte ceiling on a subscriber's queued-but-undrained live events. The event
 * count bound above cannot bound memory on its own (payload sizes vary), so a
 * subscriber that cannot drain also trips this budget. Tripping fails the
 * subscription (never silently drops frames) and the client resynchronizes
 * from snapshot + replay, the same recovery path as count overflow.
 */
export const ORCHESTRATION_LIVE_QUEUE_MAX_BYTES = 4 * 1024 * 1024;
/**
 * Burst window for progress-grade live frames (task/tool progress heartbeats,
 * streaming subagent messages, context-window gauges). Frames within a window
 * collapse to the latest per key before enqueue; every other frame passes
 * through immediately. 150ms keeps progress visibly live while collapsing
 * multi-hundred-Hz tick streams to ~7 frames/s per key.
 */
export const ORCHESTRATION_PROGRESS_COALESCE_WINDOW_MS = 150;
