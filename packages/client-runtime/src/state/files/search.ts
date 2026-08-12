import type { ProjectEntry } from "@ryco/contracts";

import {
  normalizeWorkspaceRelativePath,
  workspaceFileBasename,
  workspaceFileParentPath,
} from "./paths.ts";

/** Kept well under the contract's 200 so a broad query stays a single readable screen. */
export const WORKSPACE_FILE_SEARCH_LIMIT = 80;

export const WORKSPACE_FILE_SEARCH_DEBOUNCE_MS = 250;

/** Contract cap on `ProjectSearchEntriesInput.query`. */
export const WORKSPACE_FILE_SEARCH_QUERY_MAX_LENGTH = 256;

export interface WorkspaceFileSearchRow {
  readonly path: string;
  readonly name: string;
  readonly parentPath: string | null;
  readonly kind: "file" | "directory";
}

/**
 * Shapes raw input into something the node accepts: the contract demands a
 * trimmed, non-empty query of at most 256 characters, and an empty result means
 * "no search" rather than "search for nothing".
 */
export function normalizeWorkspaceFileSearchQuery(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length <= WORKSPACE_FILE_SEARCH_QUERY_MAX_LENGTH) return trimmed;
  return trimmed.slice(0, WORKSPACE_FILE_SEARCH_QUERY_MAX_LENGTH).trim();
}

/**
 * Search results stay in the node's ranked order — the tree builder's ordering
 * would destroy the ranking. Paths that fail normalization are dropped, and
 * duplicates collapse so the list keys stay unique.
 */
export function buildWorkspaceFileSearchRows(
  entries: ReadonlyArray<ProjectEntry>,
): readonly WorkspaceFileSearchRow[] {
  const rows: WorkspaceFileSearchRow[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const path = normalizeWorkspaceRelativePath(entry.path);
    if (path === null || seen.has(path)) continue;
    seen.add(path);
    rows.push({
      path,
      name: workspaceFileBasename(path),
      parentPath: workspaceFileParentPath(path),
      kind: entry.kind,
    });
  }

  return rows;
}
