import type { WsConnectionUiState } from "@ryco/client-runtime/rpc";
import {
  classifyWorkspaceFilePath,
  classifyWorkspaceFileReadError,
  resolveThreadWorkspaceRoot,
  resolveWorkspaceFileViewMode,
  workspaceFileBasename,
  workspaceFileReadTransport,
  type WorkspaceFilePreviewKind,
  type WorkspaceFileUnavailableReason,
  type WorkspaceFileViewMode,
  type WorkspaceFileViewModeOverride,
} from "@ryco/client-runtime/state/files";
import type { Project, SidebarWorktreeSummary, Thread } from "@ryco/client-runtime/state/threads";
import type { ProjectReadFileBinaryResult, ProjectReadFileResult } from "@ryco/contracts";

// What the single-file preview renders, decided without React Native.
//
// The kind and the view mode are derived HERE rather than passed in: the toggle
// defaults ("preview" for Markdown when the renderer exists, "source" for HTML
// because a page nobody on this device wrote is opt-in) and the rule that an
// override dies when the user opens another file are the things most likely to
// regress, and they belong to the same test file as the states they change.
//
// Two reads feed this: the UTF-8 text read for source, Markdown, SVG and HTML,
// and the bounded binary read for raster images. The screen decides which one to
// issue from `workspaceFileReadTransport`, and the corresponding state is the
// only one consulted here.

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

export interface ThreadFileBinaryReadState {
  readonly data: ProjectReadFileBinaryResult | null;
  readonly error: Error | null;
  readonly isLoading: boolean;
}

/** The renderings that can fail after the bytes arrived, in the view layer. */
export type ThreadFileRenderableKind = "image" | "svg" | "html";

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
  /** Decided from the extension alone — a known binary never reaches the node. */
  | { readonly state: "unsupported"; readonly reason: "binary" }
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
  | { readonly state: "markdown"; readonly contents: string }
  | {
      readonly state: "image";
      /**
       * Built from the mime type the node derived from the magic bytes. A data
       * URI keeps the bytes in the JS heap — there is no node URL to point an
       * image loader at, and nothing is written to disk.
       */
      readonly dataUri: string;
      readonly mimeType: string;
      readonly sizeBytes: number;
    }
  | { readonly state: "svg"; readonly markup: string }
  | { readonly state: "html"; readonly html: string }
  /** The bytes arrived but the renderer could not draw them. */
  | {
      readonly state: "render-failed";
      readonly kind: ThreadFileRenderableKind;
      /** Whether the failure has a source view to fall back to. */
      readonly canViewSource: boolean;
    };

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
  /** The raster read; consulted only for the image kind. */
  readonly binaryReadState: ThreadFileBinaryReadState;
  readonly connectionUiState: WsConnectionUiState;
  readonly markdownRendererAvailable: boolean;
  readonly viewModeOverride: WorkspaceFileViewModeOverride | null;
  /**
   * The file whose renderer reported a failure, or null. Path-scoped like the
   * view-mode override for the same reason: a failure belongs to one document,
   * and opening the next file must start from a clean slate.
   */
  readonly renderFailedPath: string | null;
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

/**
 * What a read that has produced nothing yet means.
 *
 * The offline dead-end outranks the error it caused: a socket that went away
 * mid-read reports as a failure, and "the node is unreachable" is both the truer
 * statement and the one with a useful action attached.
 */
function buildPendingReadBody(
  input: ThreadFileScreenInput,
  error: Error | null,
): ThreadFileScreenBody {
  if (input.connectionUiState === "offline") return { state: "offline-empty" };
  if (error !== null) {
    return {
      state: "unavailable",
      reason: classifyWorkspaceFileReadError(error.message),
      detail: error.message,
    };
  }
  return { state: "loading" };
}

function buildImageBody(input: ThreadFileScreenInput): ThreadFileScreenBody {
  const image = input.binaryReadState.data;
  if (image === null) return buildPendingReadBody(input, input.binaryReadState.error);
  // A raster image has no second rendering, so the failure is terminal here.
  if (input.renderFailedPath === input.path) {
    return { state: "render-failed", kind: "image", canViewSource: false };
  }
  return {
    state: "image",
    dataUri: `data:${image.mimeType};base64,${image.dataBase64}`,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
  };
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
  if (kind === "binary") return { state: "unsupported", reason: "binary" };
  if (kind === "image") return buildImageBody(input);

  const file = input.readState.data;
  if (file === null) return buildPendingReadBody(input, input.readState.error);

  if (file.contents.length === 0) return { state: "empty-file" };

  if (viewMode === "preview") {
    const renderFailed = input.renderFailedPath === input.path;
    if (kind === "markdown") return { state: "markdown", contents: file.contents };
    if (kind === "svg") {
      return renderFailed
        ? { state: "render-failed", kind: "svg", canViewSource: true }
        : { state: "svg", markup: file.contents };
    }
    if (kind === "html") {
      return renderFailed
        ? { state: "render-failed", kind: "html", canViewSource: true }
        : { state: "html", html: file.contents };
    }
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

/**
 * Whether to offer the mode toggle.
 *
 * Offered only where both renderings exist and there is something to show in
 * either: a Markdown file on a platform with the native renderer, or an SVG or
 * HTML file whose text arrived. A render failure keeps the control — switching
 * to source is the entire remedy. A raster image and every plain text file have
 * exactly one rendering, and a toggle that swaps nothing is worse than none.
 */
function resolveToggleVisibility(
  kind: WorkspaceFilePreviewKind,
  markdownRendererAvailable: boolean,
  body: ThreadFileScreenBody,
): boolean {
  switch (body.state) {
    case "source":
    case "markdown":
    case "svg":
    case "html":
    case "render-failed":
      break;
    default:
      return false;
  }
  switch (kind) {
    case "markdown":
      return markdownRendererAvailable;
    case "svg":
    case "html":
      return true;
    default:
      return false;
  }
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
      toggle: {
        visible: resolveToggleVisibility(kind, input.markdownRendererAvailable, body),
        mode: viewMode,
      },
    },
    kind,
    viewMode,
    offlineNotice: input.connectionUiState !== "connected",
    body,
  };
}

/**
 * Byte counts for the caption under an image preview. Binary units, because the
 * ceilings the node enforces are binary and a caption that disagrees with the
 * refusal message it precedes would be worse than no caption.
 */
export function formatWorkspaceFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib < 10 ? kib.toFixed(1) : Math.round(kib)} KB`;
  const mib = kib / 1024;
  return `${mib < 10 ? mib.toFixed(1) : Math.round(mib)} MB`;
}

/** Kinds the node is worth asking about; the rest resolve from the path alone. */
export function shouldReadWorkspaceFile(kind: WorkspaceFilePreviewKind): boolean {
  return workspaceFileReadTransport(kind) !== "none";
}

/**
 * Kinds whose bytes come over the bounded binary read rather than the UTF-8 one.
 * A kind is never read both ways: the two queries are mutually exclusive, so
 * only one of them is ever enabled for a given file.
 */
export function shouldReadWorkspaceFileAsBinary(kind: WorkspaceFilePreviewKind): boolean {
  return workspaceFileReadTransport(kind) === "binary";
}
