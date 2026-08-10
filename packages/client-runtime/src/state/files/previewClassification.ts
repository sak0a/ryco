import { workspaceFileBasename } from "./paths.ts";

export type WorkspaceFilePreviewKind = "text" | "markdown" | "image" | "binary";

export type WorkspaceFileViewMode = "source" | "preview";

export type WorkspaceFileUnavailableReason =
  | "binary"
  | "oversized"
  | "encoding"
  | "not-file"
  | "missing"
  | "error";

export interface WorkspaceFileViewModeOverride {
  readonly path: string;
  readonly mode: WorkspaceFileViewMode;
}

/** Mirrors the node's preview ceiling; the node errors past it rather than truncating. */
export const WORKSPACE_FILE_PREVIEW_MAX_BYTES = 512 * 1024;

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx", "markdown", "mdown"]);

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tiff",
  "webp",
]);

const BINARY_EXTENSIONS = new Set([
  // archives
  "7z",
  "bz2",
  "gz",
  "jar",
  "rar",
  "tar",
  "tgz",
  "xz",
  "zip",
  "zst",
  // media
  "avi",
  "flac",
  "m4a",
  "mkv",
  "mov",
  "mp3",
  "mp4",
  "ogg",
  "wav",
  "webm",
  // fonts
  "eot",
  "otf",
  "ttf",
  "woff",
  "woff2",
  // documents
  "doc",
  "docx",
  "pdf",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  // executables and opaque blobs
  "a",
  "bin",
  "class",
  "dat",
  "db",
  "dll",
  "dylib",
  "exe",
  "o",
  "pyc",
  "sqlite",
  "so",
  "wasm",
]);

const BINARY_BASENAMES = new Set([".ds_store"]);

/**
 * Decides what the file screen should do before any RPC. Unknown extensions
 * resolve to "text" on purpose: the node is the authority on binary/encoding
 * rejection, and these tables only exist to skip reads that are certain to be
 * useless (images, archives, media).
 */
export function classifyWorkspaceFilePath(path: string): WorkspaceFilePreviewKind {
  const basename = workspaceFileBasename(path).toLowerCase();
  if (BINARY_BASENAMES.has(basename)) return "binary";

  const dotIndex = basename.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === basename.length - 1) return "text";

  const extension = basename.slice(dotIndex + 1);
  if (MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (BINARY_EXTENSIONS.has(extension)) return "binary";
  return "text";
}

/**
 * The override only survives while the user stays on the file it was made for,
 * so opening another file falls back to that file's own default mode.
 */
export function resolveWorkspaceFileViewMode(input: {
  readonly path: string;
  readonly kind: WorkspaceFilePreviewKind;
  readonly markdownRendererAvailable: boolean;
  readonly override: WorkspaceFileViewModeOverride | null;
}): WorkspaceFileViewMode {
  if (input.override !== null && input.override.path === input.path) return input.override.mode;
  return input.kind === "markdown" && input.markdownRendererAvailable ? "preview" : "source";
}

/**
 * Maps the node's read failures onto the states the file screen renders. The
 * node reports these as plain messages, so matching is substring-based and
 * anything unrecognized degrades to the generic error state.
 */
export function classifyWorkspaceFileReadError(
  message: string | null | undefined,
): WorkspaceFileUnavailableReason {
  const normalized = message?.toLowerCase() ?? "";
  if (normalized.length === 0) return "error";
  if (normalized.includes("too large to preview")) return "oversized";
  if (normalized.includes("binary files cannot be previewed")) return "binary";
  if (normalized.includes("only utf-8 text files")) return "encoding";
  if (normalized.includes("only regular files")) return "not-file";
  if (
    normalized.includes("no such file") ||
    normalized.includes("not found") ||
    normalized.includes("enoent")
  ) {
    return "missing";
  }
  return "error";
}
