import { randomUUID } from "node:crypto";
import { realpath as realpathPromise } from "node:fs/promises";

import { Data, Effect, FileSystem, Layer, Path } from "effect";
import { PROJECT_STAGE_FILE_MAX_BYTES } from "@ryco/contracts";

import {
  WorkspaceFileSystem,
  WorkspaceFileSystemError,
  type WorkspaceFileSystemShape,
} from "../Services/WorkspaceFileSystem.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspacePathOutsideRootError, WorkspacePaths } from "../Services/WorkspacePaths.ts";

const WORKSPACE_PREVIEW_MAX_BYTES = 512 * 1024;
const WORKSPACE_PREVIEW_TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const STAGED_FILE_ROOT = ".ryco/attachments";
const UNSAFE_PATH_SEGMENT_CHARS = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);

function isLikelyBinaryPreview(bytes: Uint8Array): boolean {
  return bytes.subarray(0, Math.min(bytes.length, 8_192)).includes(0);
}

function decodePreviewContents(bytes: Uint8Array): string | null {
  try {
    return WORKSPACE_PREVIEW_TEXT_DECODER.decode(bytes);
  } catch {
    return null;
  }
}

function toPosixPath(input: string): string {
  return input.replaceAll("\\", "/");
}

function replaceUnsafePathSegmentCharacters(input: string): string {
  let output = "";
  let previousWasReplacement = false;
  for (const char of input) {
    const unsafe = char.charCodeAt(0) < 0x20 || UNSAFE_PATH_SEGMENT_CHARS.has(char);
    if (unsafe) {
      if (!previousWasReplacement) {
        output += "-";
      }
      previousWasReplacement = true;
      continue;
    }
    output += char;
    previousWasReplacement = false;
  }
  return output;
}

function sanitizePathSegment(input: string, fallback: string): string {
  const sanitized = replaceUnsafePathSegmentCharacters(input.trim())
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/g, "")
    .replace(/[.-]+$/g, "")
    .slice(0, 80);
  return sanitized.length > 0 ? sanitized : fallback;
}

function splitSafeFileName(fileName: string): { base: string; extension: string } {
  const safeName = sanitizePathSegment(fileName, "file");
  const dotIndex = safeName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === safeName.length - 1) {
    return { base: safeName, extension: "" };
  }
  return {
    base: safeName.slice(0, dotIndex) || "file",
    extension: safeName.slice(dotIndex).slice(0, 24),
  };
}

function decodeBase64File(input: { dataBase64: string; sizeBytes: number }): Uint8Array | null {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.dataBase64)) {
    return null;
  }
  const bytes = Buffer.from(input.dataBase64, "base64");
  if (bytes.byteLength !== input.sizeBytes || bytes.byteLength > PROJECT_STAGE_FILE_MAX_BYTES) {
    return null;
  }
  return bytes;
}

class MissingRealPathError extends Data.TaggedError("MissingRealPathError") {}

function isEnoentError(cause: unknown): cause is NodeJS.ErrnoException {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}

export const makeWorkspaceFileSystem = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries;

  const toWorkspaceFileSystemError = (
    input: { cwd: string; relativePath: string },
    operation: string,
  ) => {
    return (cause: unknown) =>
      new WorkspaceFileSystemError({
        cwd: input.cwd,
        relativePath: input.relativePath,
        operation,
        detail: cause instanceof Error ? cause.message : String(cause),
        cause,
      });
  };

  const resolveRealWorkspaceTargetPath = Effect.fn(
    "WorkspaceFileSystem.resolveRealWorkspaceTargetPath",
  )(function* (input: { cwd: string; relativePath: string }, absolutePath: string) {
    const missingSegments: Array<string> = [];
    let candidatePath = absolutePath;

    while (true) {
      const realCandidatePath = yield* Effect.tryPromise({
        try: () => realpathPromise(candidatePath),
        catch: (cause) =>
          isEnoentError(cause)
            ? new MissingRealPathError()
            : toWorkspaceFileSystemError(input, "workspaceFileSystem.realpath.target")(cause),
      }).pipe(Effect.catchTag("MissingRealPathError", () => Effect.succeed(null)));

      if (realCandidatePath !== null) {
        return missingSegments.length === 0
          ? realCandidatePath
          : path.join(realCandidatePath, ...missingSegments);
      }

      const parentPath = path.dirname(candidatePath);
      if (parentPath === candidatePath) {
        return yield* new WorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.realpath.target",
          detail: `Unable to resolve workspace target path: ${absolutePath}`,
        });
      }

      missingSegments.unshift(path.basename(candidatePath));
      candidatePath = parentPath;
    }
  });

  const ensureResolvedPathStaysWithinWorkspace = Effect.fn(
    "WorkspaceFileSystem.ensureResolvedPathStaysWithinWorkspace",
  )(function* (input: { cwd: string; relativePath: string }, absolutePath: string) {
    const normalizedWorkspaceRoot = yield* workspacePaths
      .normalizeWorkspaceRoot(input.cwd)
      .pipe(
        Effect.mapError(toWorkspaceFileSystemError(input, "workspaceFileSystem.workspaceRoot")),
      );
    const realWorkspaceRoot = yield* Effect.tryPromise({
      try: () => realpathPromise(normalizedWorkspaceRoot),
      catch: toWorkspaceFileSystemError(input, "workspaceFileSystem.realpath.root"),
    });
    const realTargetPath = yield* resolveRealWorkspaceTargetPath(input, absolutePath);
    const relativeToRoot = toPosixPath(path.relative(realWorkspaceRoot, realTargetPath));
    if (
      relativeToRoot.length === 0 ||
      relativeToRoot === "." ||
      relativeToRoot.startsWith("../") ||
      relativeToRoot === ".." ||
      path.isAbsolute(relativeToRoot)
    ) {
      return yield* new WorkspacePathOutsideRootError({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });
    }
  });

  const readFile: WorkspaceFileSystemShape["readFile"] = Effect.fn("WorkspaceFileSystem.readFile")(
    function* (input) {
      const target = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });

      yield* ensureResolvedPathStaysWithinWorkspace(input, target.absolutePath);

      const fileInfo = yield* fileSystem
        .stat(target.absolutePath)
        .pipe(
          Effect.mapError(toWorkspaceFileSystemError(input, "workspaceFileSystem.readFile.stat")),
        );
      if (fileInfo.type !== "File") {
        return yield* new WorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.readFile.stat",
          detail: "Only regular files can be previewed.",
        });
      }

      const fileSize =
        typeof fileInfo.size === "bigint"
          ? Number(fileInfo.size)
          : typeof fileInfo.size === "number"
            ? fileInfo.size
            : 0;
      if (fileSize > WORKSPACE_PREVIEW_MAX_BYTES) {
        return yield* new WorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.readFile.sizeLimit",
          detail: `File is too large to preview (${fileSize} bytes). Limit is ${WORKSPACE_PREVIEW_MAX_BYTES} bytes.`,
        });
      }

      const bytes = yield* fileSystem
        .readFile(target.absolutePath)
        .pipe(
          Effect.mapError(toWorkspaceFileSystemError(input, "workspaceFileSystem.readFile.read")),
        );
      if (isLikelyBinaryPreview(bytes)) {
        return yield* new WorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.readFile.binaryCheck",
          detail: "Binary files cannot be previewed.",
        });
      }

      const contents = decodePreviewContents(bytes);
      if (contents === null) {
        return yield* new WorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.readFile.decode",
          detail: "Only UTF-8 text files can be previewed.",
        });
      }

      return {
        relativePath: target.relativePath,
        contents,
      };
    },
  );

  const writeFile: WorkspaceFileSystemShape["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    yield* ensureResolvedPathStaysWithinWorkspace(input, target.absolutePath);

    yield* fileSystem
      .makeDirectory(path.dirname(target.absolutePath), { recursive: true })
      .pipe(
        Effect.mapError(toWorkspaceFileSystemError(input, "workspaceFileSystem.makeDirectory")),
      );
    yield* fileSystem
      .writeFileString(target.absolutePath, input.contents)
      .pipe(Effect.mapError(toWorkspaceFileSystemError(input, "workspaceFileSystem.writeFile")));
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: target.relativePath };
  });

  const stageFileReference: WorkspaceFileSystemShape["stageFileReference"] = Effect.fn(
    "WorkspaceFileSystem.stageFileReference",
  )(function* (input) {
    const bytes = decodeBase64File({
      dataBase64: input.dataBase64,
      sizeBytes: input.sizeBytes,
    });
    if (!bytes) {
      return yield* new WorkspaceFileSystemError({
        cwd: input.cwd,
        operation: "workspaceFileSystem.stageFileReference.decode",
        detail: "Staged file payload is invalid.",
      });
    }

    const scopeSegment = sanitizePathSegment(input.scopeId, "draft");
    const { base, extension } = splitSafeFileName(input.name);
    const relativePath = toPosixPath(
      path.join(STAGED_FILE_ROOT, scopeSegment, `${base}-${randomUUID().slice(0, 8)}${extension}`),
    );
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath,
    });

    yield* ensureResolvedPathStaysWithinWorkspace(
      { cwd: input.cwd, relativePath },
      target.absolutePath,
    );

    yield* fileSystem
      .makeDirectory(path.dirname(target.absolutePath), { recursive: true })
      .pipe(
        Effect.mapError(
          toWorkspaceFileSystemError(
            { cwd: input.cwd, relativePath },
            "workspaceFileSystem.stageFileReference.makeDirectory",
          ),
        ),
      );
    yield* fileSystem
      .writeFile(target.absolutePath, bytes)
      .pipe(
        Effect.mapError(
          toWorkspaceFileSystemError(
            { cwd: input.cwd, relativePath },
            "workspaceFileSystem.stageFileReference.writeFile",
          ),
        ),
      );
    yield* workspaceEntries.invalidate(input.cwd);

    return { relativePath: target.relativePath, sizeBytes: bytes.byteLength };
  });

  return { readFile, writeFile, stageFileReference } satisfies WorkspaceFileSystemShape;
});

export const WorkspaceFileSystemLive = Layer.effect(WorkspaceFileSystem, makeWorkspaceFileSystem);
