import type { WsConnectionUiState } from "@ryco/client-runtime/rpc";
import {
  classifyWorkspaceFilePath,
  classifyWorkspaceFileReadError,
  resolveThreadWorkspaceRoot,
  resolveWorkspaceFileViewMode,
  workspaceFileBasename,
  type WorkspaceFilePreviewKind,
  type WorkspaceFileUnavailableReason,
  type WorkspaceFileViewMode,
  type WorkspaceFileViewModeOverride,
} from "@ryco/client-runtime/state/files";
import type { Project, SidebarWorktreeSummary, Thread } from "@ryco/client-runtime/state/threads";
import type { ProjectReadFileResult } from "@ryco/contracts";

// What the single-file preview renders, decided without React Native.
//
// The kind and the view mode are derived HERE rather than passed in: the toggle
// default ("preview" for Markdown when the renderer exists) and the rule that an
// override dies when the user opens another file are the two things most likely
// to regress, and both belong to the same test file as the states they change.

/**
 * Beyond this the source view stops asking Shiki for tokens and stays plain.
 *
 * The node caps a preview at 512 KiB, which is still six figures of lines of
 * minified output; the highlighter yields between chunks so it would not freeze
 * the UI, but it would burn the CPU for minutes on a file nobody is reading
 * token colors in.
 */
export const WORKSPACE_SOURCE_HIGHLIGHT_MAX_LINES = 20_000;

export interface ThreadFileReadState {
  readonly data: ProjectReadFileResult | null;
  readonly error: Error | null;
  readonly isLoading: boolean;
}

export interface ThreadFileToggleModel {
  readonly visible: boolean;
  readonly mode: WorkspaceFileViewMode;
}

export interface ThreadFileHeaderModel {
  readonly title: string;
  /** Full workspace-relative path for the middle-truncated subtitle row. */
  readonly pathLabel: string;
  readonly toggle: ThreadFileToggleModel;
}

export type ThreadFileScreenBody =
  | { readonly state: "invalid-path" }
  | { readonly state: "no-workspace" }
  | { readonly state: "loading" }
  | { readonly state: "offline-empty" }
  /** Decided from the extension alone — these never reach the node. */
  | { readonly state: "unsupported"; readonly reason: "image" | "binary" }
  | {
      readonly state: "unavailable";
      readonly reason: WorkspaceFileUnavailableReason;
      /** The node's own message, kept for the diagnostic line under the copy. */
      readonly detail: string;
    }
  | { readonly state: "empty-file" }
  | {
      readonly state: "source";
      readonly lines: readonly string[];
      /** 0-based row to scroll to and tint, or null when no `?line=` was given. */
      readonly initialLineIndex: number | null;
      /** Longest line, for sizing the horizontal scroll surface. */
      readonly maxLineLength: number;
      readonly highlightable: boolean;
    }
  | { readonly state: "markdown"; readonly contents: string };

export interface ThreadFileScreenModel {
  readonly header: ThreadFileHeaderModel;
  readonly kind: WorkspaceFilePreviewKind;
  readonly viewMode: WorkspaceFileViewMode;
  readonly offlineNotice: boolean;
  readonly body: ThreadFileScreenBody;
}

export interface ThreadFileScreenInput {
  /** Already through `routeFilePathParam`; null means the route param was junk. */
  readonly path: string | null;
  /** Already through `routeLineParam`; 1-based. */
  readonly line: number | null;
  readonly bootstrapComplete: boolean;
  readonly thread: Pick<Thread, "worktreePath"> | null;
  readonly project: Pick<Project, "cwd"> | null;
  readonly worktree: Pick<SidebarWorktreeSummary, "worktreePath"> | null;
  readonly readState: ThreadFileReadState;
  readonly connectionUiState: WsConnectionUiState;
  readonly markdownRendererAvailable: boolean;
  readonly viewModeOverride: WorkspaceFileViewModeOverride | null;
}

/**
 * Splits the file for the source view.
 *
 * The node already normalizes line endings, so the CR handling is purely
 * defensive. The single trailing empty element a file ending in a newline
 * produces is dropped: it is a terminator, not a line, and showing it puts a
 * phantom last line number under every well-formed file.
 */
function splitSourceLines(contents: string): readonly string[] {
  const lines = contents.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

function longestLineLength(lines: readonly string[]): number {
  let longest = 0;
  for (const line of lines) {
    if (line.length > longest) longest = line.length;
  }
  return longest;
}

function resolveInitialLineIndex(line: number | null, lineCount: number): number | null {
  if (line === null || lineCount === 0) return null;
  // A stale deep link can point past the end of a file that has since shrunk;
  // anchoring on the last line beats refusing to scroll at all.
  return Math.min(line - 1, lineCount - 1);
}

function buildBody(
  input: ThreadFileScreenInput,
  kind: WorkspaceFilePreviewKind,
  viewMode: WorkspaceFileViewMode,
  workspaceRoot: string | null,
): ThreadFileScreenBody {
  if (input.path === null) return { state: "invalid-path" };
  if (workspaceRoot === null) {
    return input.bootstrapComplete ? { state: "no-workspace" } : { state: "loading" };
  }
  if (kind === "image" || kind === "binary") return { state: "unsupported", reason: kind };

  const file = input.readState.data;
  if (file === null) {
    if (input.connectionUiState === "offline") return { state: "offline-empty" };
    if (input.readState.error !== null) {
      return {
        state: "unavailable",
        reason: classifyWorkspaceFileReadError(input.readState.error.message),
        detail: input.readState.error.message,
      };
    }
    return { state: "loading" };
  }

  if (file.contents.length === 0) return { state: "empty-file" };
  if (kind === "markdown" && viewMode === "preview") {
    return { state: "markdown", contents: file.contents };
  }

  const lines = splitSourceLines(file.contents);
  return {
    state: "source",
    lines,
    initialLineIndex: resolveInitialLineIndex(input.line, lines.length),
    maxLineLength: longestLineLength(lines),
    highlightable: lines.length <= WORKSPACE_SOURCE_HIGHLIGHT_MAX_LINES,
  };
}

export function buildThreadFileScreenModel(input: ThreadFileScreenInput): ThreadFileScreenModel {
  const path = input.path;
  const kind = path === null ? "text" : classifyWorkspaceFilePath(path);
  const viewMode =
    path === null
      ? "source"
      : resolveWorkspaceFileViewMode({
          path,
          kind,
          markdownRendererAvailable: input.markdownRendererAvailable,
          override: input.viewModeOverride,
        });
  const workspaceRoot = resolveThreadWorkspaceRoot({
    thread: input.thread,
    worktree: input.worktree,
    project: input.project,
  });
  const body = buildBody(input, kind, viewMode, workspaceRoot);

  return {
    header: {
      title: path === null ? "File" : workspaceFileBasename(path),
      pathLabel: path ?? "",
      // Offered only where both renderings exist: a Markdown file whose contents
      // arrived, on a platform that has the native renderer. Everything else has
      // exactly one way to be shown, and a toggle that swaps nothing is worse
      // than no toggle.
      toggle: {
        visible:
          kind === "markdown" &&
          input.markdownRendererAvailable &&
          (body.state === "source" || body.state === "markdown"),
        mode: viewMode,
      },
    },
    kind,
    viewMode,
    offlineNotice: input.connectionUiState !== "connected",
    body,
  };
}

/** Kinds the node is worth asking about; the rest resolve from the path alone. */
export function shouldReadWorkspaceFile(kind: WorkspaceFilePreviewKind): boolean {
  return kind === "text" || kind === "markdown";
}
