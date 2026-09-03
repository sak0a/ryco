/**
 * Bounds the `data` payload persisted with tool lifecycle activities.
 *
 * Tool activities are stored verbatim in the orchestration event log and the
 * activity projection, and both keep rows forever. Uncapped tool output
 * (terminal output, MCP results) dominated the state database — hundreds of
 * kilobytes per row for outputs no client ever renders in full. This module
 * caps every oversized string inside `data` to a bounded head + tail with an
 * elision marker, preserving payload structure so client folds keep working.
 *
 * Item types whose payloads are only useful when intact are exempt:
 *   - `image_view` carries base64 image bytes; truncation would corrupt them.
 *   - `file_change` carries structured diffs that clients re-render; a
 *     truncated hunk would display as a broken diff.
 */

/** Strings longer than this are truncated. */
export const ACTIVITY_DATA_STRING_CAP = 16_000;

const HEAD_CHARS = 10_000;
const TAIL_CHARS = 5_000;
const MAX_DEPTH = 16;

const EXEMPT_ITEM_TYPES = new Set(["image_view", "file_change"]);

function capString(value: string): string {
  if (value.length <= ACTIVITY_DATA_STRING_CAP) {
    return value;
  }
  const truncated = value.length - HEAD_CHARS - TAIL_CHARS;
  return `${value.slice(0, HEAD_CHARS)}\n… [${truncated.toLocaleString("en-US")} chars truncated] …\n${value.slice(value.length - TAIL_CHARS)}`;
}

function capValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return capString(value);
  }
  if (depth >= MAX_DEPTH || value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((entry) => {
      const capped = capValue(entry, depth + 1);
      if (capped !== entry) changed = true;
      return capped;
    });
    return changed ? next : value;
  }
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const capped = capValue(entry, depth + 1);
    if (capped !== entry) changed = true;
    next[key] = capped;
  }
  return changed ? next : value;
}

/**
 * Returns `data` with every oversized string truncated, or the same
 * reference when nothing needed truncation.
 */
export function capActivityData(itemType: unknown, data: unknown): unknown {
  if (typeof itemType === "string" && EXEMPT_ITEM_TYPES.has(itemType)) {
    return data;
  }
  return capValue(data, 0);
}
