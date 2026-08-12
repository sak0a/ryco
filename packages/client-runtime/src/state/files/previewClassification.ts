import { workspaceFileBasename } from "./paths.ts";

/**
 * "image" means RASTER only: those bytes come back from the node's binary read
 * and are handed to the platform image decoder. SVG and HTML are UTF-8 text
 * documents with their own renderers, so they are their own kinds — the kind
 * decides which RPC the screen issues as much as it decides what is drawn.
 */
export type WorkspaceFilePreviewKind = "text" | "markdown" | "image" | "svg" | "html" | "binary";

export type WorkspaceFileViewMode = "source" | "preview";

export type WorkspaceFileUnavailableReason =
  | "binary"
  | "oversized"
  | "encoding"
  | "not-file"
  | "missing"
  /** The node read the bytes but they are not an image format it will send. */
  | "unsupported-image"
  | "error";

export interface WorkspaceFileViewModeOverride {
  readonly path: string;
  readonly mode: WorkspaceFileViewMode;
}

/** Mirrors the node's text preview ceiling; it errors past it rather than truncating. */
export const WORKSPACE_FILE_PREVIEW_MAX_BYTES = 512 * 1024;

/**
 * Mirrors the node's binary read ceiling (contracts'
 * PROJECT_READ_FILE_BINARY_MAX_BYTES). Raster bytes travel base64-encoded, so
 * the ceiling is on the raw file and the node refuses past it with the same
 * wording the text limit uses.
 */
export const WORKSPACE_FILE_BINARY_PREVIEW_MAX_BYTES = 4 * 1024 * 1024;

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx", "markdown", "mdown"]);

/** Raster only — the node sniffs magic bytes and refuses anything it cannot type. */
const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "tiff",
  "webp",
]);

const HTML_EXTENSIONS = new Set(["htm", "html"]);

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
  if (extension === "svg") return "svg";
  if (HTML_EXTENSIONS.has(extension)) return "html";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (BINARY_EXTENSIONS.has(extension)) return "binary";
  return "text";
}

/**
 * Which read the screen owes the node for a kind.
 *
 * Raster bytes need the bounded binary read; SVG and HTML are UTF-8 documents
 * and ride the ordinary text read, so they are held to the 512 KiB text ceiling.
 */
export function workspaceFileReadTransport(
  kind: WorkspaceFilePreviewKind,
): "text" | "binary" | "none" {
  switch (kind) {
    case "image":
      return "binary";
    case "binary":
      return "none";
    default:
      return "text";
  }
}

/**
 * The mode a kind opens in when the user has not said otherwise.
 *
 * HTML is the odd one: it is the only preview that renders a document the node
 * did not author, so it opens as source and the render is opt-in. SVG has no
 * scripting surface at all, and a raster image has nothing but its preview.
 */
function defaultWorkspaceFileViewMode(
  kind: WorkspaceFilePreviewKind,
  markdownRendererAvailable: boolean,
): WorkspaceFileViewMode {
  switch (kind) {
    case "markdown":
      return markdownRendererAvailable ? "preview" : "source";
    case "image":
    case "svg":
      return "preview";
    default:
      return "source";
  }
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
  // A raster image has exactly one rendering, so there is no toggle to make an
  // override with and none may be honored — a stale one would blank the screen.
  if (input.kind === "image") return "preview";
  if (input.override !== null && input.override.path === input.path) return input.override.mode;
  return defaultWorkspaceFileViewMode(input.kind, input.markdownRendererAvailable);
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
  // One wording covers both ceilings: the node only varies the byte counts, so
  // a 4 MiB raster refusal classifies exactly like a 512 KiB text one.
  if (normalized.includes("too large to preview")) return "oversized";
  if (normalized.includes("binary files cannot be previewed")) return "binary";
  if (normalized.includes("not a supported image")) return "unsupported-image";
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
