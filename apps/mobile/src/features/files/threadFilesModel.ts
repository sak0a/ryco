import type { WsConnectionUiState } from "@ryco/client-runtime/rpc";
import {
  buildWorkspaceFileSearchRows,
  buildWorkspaceFileTree,
  countWorkspaceFiles,
  defaultExpandedWorkspaceTreePaths,
  flattenWorkspaceFileTree,
  resolveThreadWorkspaceRoot,
  type VisibleWorkspaceFileTreeRow,
  type WorkspaceFileSearchRow,
} from "@ryco/client-runtime/state/files";
import type { Project, SidebarWorktreeSummary, Thread } from "@ryco/client-runtime/state/threads";
import type { ProjectListEntriesResult, ProjectSearchEntriesResult } from "@ryco/contracts";

// What the file-browser screen renders, decided without React Native so the
// precedence between "still syncing", "this thread has no checkout", "the node
// is unreachable" and "here is the tree" is settled in one testable place.
//
// The screen keeps the search box and the pull-to-refresh outside this model:
// both stay usable in every state, including the failures.

export interface ThreadFilesQueryState<T> {
  readonly data: T | null;
  readonly error: Error | null;
  readonly isLoading: boolean;
}

export interface ThreadFilesSearchState extends ThreadFilesQueryState<ProjectSearchEntriesResult> {
  /** The box holds a query the debounce has not sent to the node yet. */
  readonly isDebouncing: boolean;
}

export type ThreadFilesScreenModel =
  | { readonly state: "loading" }
  | { readonly state: "no-workspace" }
  | { readonly state: "offline-empty" }
  | { readonly state: "error"; readonly message: string; readonly canRetry: boolean }
  | { readonly state: "empty" }
  | {
      readonly state: "tree";
      readonly rows: readonly VisibleWorkspaceFileTreeRow[];
      /**
       * Top-level directories, for the screen to seed its expansion set with.
       * Carried on the model rather than recomputed by the screen so the tree is
       * built once per render.
       */
      readonly defaultExpanded: ReadonlySet<string>;
      readonly fileCount: number;
      /** The node capped its listing, so the tree is not the whole workspace. */
      readonly truncated: boolean;
      readonly offlineNotice: boolean;
    }
  | {
      readonly state: "search";
      readonly rows: readonly WorkspaceFileSearchRow[];
      readonly truncated: boolean;
      /** A request is in flight or waiting out the debounce. */
      readonly searching: boolean;
      readonly offlineNotice: boolean;
    };

export interface ThreadFilesScreenInput {
  /** False while the active environment's first shell snapshot is still landing. */
  readonly bootstrapComplete: boolean;
  readonly thread: Pick<Thread, "worktreePath"> | null;
  readonly project: Pick<Project, "cwd"> | null;
  readonly worktree: Pick<SidebarWorktreeSummary, "worktreePath"> | null;
  readonly entriesState: ThreadFilesQueryState<ProjectListEntriesResult>;
  readonly searchState: ThreadFilesSearchState;
  /** Already through `normalizeWorkspaceFileSearchQuery`; "" means tree view. */
  readonly normalizedQuery: string;
  readonly expanded: ReadonlySet<string>;
  readonly connectionUiState: WsConnectionUiState;
}

/**
 * Only "offline" earns the dead-end empty state. "reconnecting" and "connecting"
 * are states the supervisor is actively working its way out of, so they fall
 * through to loading and the retry button never appears for a socket that is
 * already coming back.
 */
function isOffline(connectionUiState: WsConnectionUiState): boolean {
  return connectionUiState === "offline";
}

function hasDegradedConnection(connectionUiState: WsConnectionUiState): boolean {
  return connectionUiState !== "connected";
}

export function buildThreadFilesScreenModel(input: ThreadFilesScreenInput): ThreadFilesScreenModel {
  const workspaceRoot = resolveThreadWorkspaceRoot({
    thread: input.thread,
    worktree: input.worktree,
    project: input.project,
  });

  if (workspaceRoot === null) {
    // A cold deep link reaches this screen before the shell snapshot names the
    // thread's project, so an unknown root is only "no workspace" once the
    // snapshot has actually landed.
    return input.bootstrapComplete ? { state: "no-workspace" } : { state: "loading" };
  }

  const offlineNotice = hasDegradedConnection(input.connectionUiState);

  if (input.normalizedQuery.length > 0) {
    const searching = input.searchState.isLoading || input.searchState.isDebouncing;
    const results = input.searchState.data;
    if (results !== null) {
      return {
        state: "search",
        rows: buildWorkspaceFileSearchRows(results.entries),
        truncated: results.truncated,
        searching,
        offlineNotice,
      };
    }
    if (searching) {
      return { state: "search", rows: [], truncated: false, searching: true, offlineNotice };
    }
    if (isOffline(input.connectionUiState)) return { state: "offline-empty" };
    if (input.searchState.error !== null) {
      return {
        state: "error",
        message: input.searchState.error.message,
        canRetry: !isOffline(input.connectionUiState),
      };
    }
    return { state: "search", rows: [], truncated: false, searching: false, offlineNotice };
  }

  const entries = input.entriesState.data;
  if (entries === null) {
    // Cached data outranks the connection, so this branch is the only one that
    // can dead-end: offline first, because an offline failure is more useful to
    // the reader than the socket error it produced.
    if (isOffline(input.connectionUiState)) return { state: "offline-empty" };
    if (input.entriesState.error !== null) {
      return {
        state: "error",
        message: input.entriesState.error.message,
        canRetry: !isOffline(input.connectionUiState),
      };
    }
    return { state: "loading" };
  }

  const nodes = buildWorkspaceFileTree(entries.entries);
  if (nodes.length === 0) return { state: "empty" };

  return {
    state: "tree",
    rows: flattenWorkspaceFileTree({ nodes, expanded: input.expanded }),
    defaultExpanded: defaultExpandedWorkspaceTreePaths(nodes),
    fileCount: countWorkspaceFiles(nodes),
    truncated: entries.truncated,
    offlineNotice,
  };
}
