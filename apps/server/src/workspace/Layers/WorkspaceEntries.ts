import * as OS from "node:os";
import fsPromises from "node:fs/promises";
import type { Dirent } from "node:fs";
import { execFile } from "node:child_process";

import { Cache, DateTime, Duration, Effect, Exit, Layer, Path } from "effect";

import { type FilesystemBrowseInput, type ProjectEntry } from "@ryco/contracts";
import { isExplicitRelativePath, isWindowsAbsolutePath } from "@ryco/shared/path";
import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
  type RankedSearchResult,
} from "@ryco/shared/searchRanking";

import { VcsDriverRegistry } from "../../vcs/VcsDriverRegistry.ts";
import {
  WorkspaceEntries,
  WorkspaceEntriesBrowseError,
  WorkspaceEntriesError,
  type WorkspaceEntriesShape,
} from "../Services/WorkspaceEntries.ts";
import { WorkspacePaths } from "../Services/WorkspacePaths.ts";
import { WorkspaceAccessPolicy } from "../Services/WorkspaceAccessPolicy.ts";

const WORKSPACE_CACHE_TTL_MS = 15_000;
const WORKSPACE_CACHE_MAX_KEYS = 4;
const WORKSPACE_INDEX_MAX_ENTRIES = 25_000;
const WORKSPACE_SCAN_READDIR_CONCURRENCY = 32;
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".convex",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "out",
  ".cache",
]);

interface WorkspaceIndex {
  scannedAt: number;
  entries: SearchableWorkspaceEntry[];
  truncated: boolean;
}

interface SearchableWorkspaceEntry extends ProjectEntry {
  normalizedPath: string;
  normalizedName: string;
}

type RankedWorkspaceEntry = RankedSearchResult<SearchableWorkspaceEntry>;

function toPosixPath(input: string): string {
  return input.replaceAll("\\", "/");
}

function expandHomePath(input: string, path: Path.Path): string {
  if (input === "~") {
    return OS.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(OS.homedir(), input.slice(2));
  }
  return input;
}

function parentPathOf(input: string): string | undefined {
  const separatorIndex = input.lastIndexOf("/");
  if (separatorIndex === -1) {
    return undefined;
  }
  return input.slice(0, separatorIndex);
}

function basenameOf(input: string): string {
  const separatorIndex = input.lastIndexOf("/");
  if (separatorIndex === -1) {
    return input;
  }
  return input.slice(separatorIndex + 1);
}

function toSearchableWorkspaceEntry(entry: ProjectEntry): SearchableWorkspaceEntry {
  const normalizedPath = entry.path.toLowerCase();
  return {
    ...entry,
    normalizedPath,
    normalizedName: basenameOf(normalizedPath),
  };
}

function scoreEntry(entry: SearchableWorkspaceEntry, query: string): number | null {
  if (!query) {
    return entry.kind === "directory" ? 0 : 1;
  }

  const { normalizedPath, normalizedName } = entry;

  const scores = [
    scoreQueryMatch({
      value: normalizedName,
      query,
      exactBase: 0,
      prefixBase: 2,
      includesBase: 5,
      fuzzyBase: 100,
    }),
    scoreQueryMatch({
      value: normalizedPath,
      query,
      exactBase: 1,
      prefixBase: 3,
      boundaryBase: 4,
      includesBase: 6,
      fuzzyBase: 200,
      boundaryMarkers: ["/"],
    }),
  ].filter((score): score is number => score !== null);

  if (scores.length === 0) {
    return null;
  }

  return Math.min(...scores);
}

function isPathInIgnoredDirectory(relativePath: string): boolean {
  const firstSegment = relativePath.split("/")[0];
  if (!firstSegment) return false;
  return IGNORED_DIRECTORY_NAMES.has(firstSegment);
}

function directoryAncestorsOf(relativePath: string): string[] {
  const segments = relativePath.split("/").filter((segment) => segment.length > 0);
  if (segments.length <= 1) return [];

  const directories: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    directories.push(segments.slice(0, index).join("/"));
  }
  return directories;
}

// Cap parallelism when probing directory entries for Finder-alias magic
// bytes. Each probe opens a file and reads 4 bytes, so on huge directories
// unbounded parallelism can saturate file descriptors and the kernel's I/O
// queue. Sixteen is a good middle ground — small enough to stay polite,
// large enough to overlap I/O latency.
const ALIAS_PROBE_CONCURRENCY = 16;

async function mapWithConcurrency<A, B>(
  items: readonly A[],
  concurrency: number,
  fn: (item: A, index: number) => Promise<B>,
): Promise<B[]> {
  if (items.length === 0) return [];
  const results: B[] = Array.from({ length: items.length });
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await fn(item, index);
    }
  };
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function isPermissionDeniedError(cause: unknown): boolean {
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? (cause as { readonly code?: unknown }).code
      : undefined;
  return code === "EACCES" || code === "EPERM";
}

// macOS Finder aliases are binary files (not symlinks). Modern ones (10.5+)
// are bookmark-format NSURL data and start with magic bytes "book". Pre-10.5
// "alis"-format aliases stored their type/creator metadata in the HFS
// FinderInfo extended attribute rather than the file body; detecting those
// would require reading `com.apple.FinderInfo`, which has no native Node API
// and is essentially extinct on modern installs. We intentionally only
// support modern bookmark aliases here.
const MACOS_BOOKMARK_ALIAS_MAGIC = "book";
// Real Finder bookmark files are tiny (typically well under 2 KB). Capping
// the probe at 64 KB lets us skip media, archives, binaries, etc. with a
// single cheap `stat` syscall in directories like ~/Downloads, instead of
// paying for an `open + read + close` on every file matching the prefix.
const MACOS_ALIAS_MAX_PROBE_BYTES = 64 * 1024;
// The script emits one resolved path per alias in argv order, using NUL as
// the terminator. POSIX paths cannot contain NUL bytes, so this is the only
// delimiter that is guaranteed to be unambiguous; tabs and newlines are legal
// in filenames and would break simpler formats.
const MACOS_ALIAS_RESOLVE_SCRIPT = `on run argv
  set results to ""
  set nul to ASCII character 0
  repeat with rawPath in argv
    set p to rawPath as string
    try
      tell application "Finder"
        set theTarget to original item of (POSIX file p as alias)
        set resolved to POSIX path of (theTarget as alias)
      end tell
      set results to results & resolved & nul
    on error
      set results to results & nul
    end try
  end repeat
  return results
end run`;

export async function isMacOSBookmarkAlias(filePath: string): Promise<boolean> {
  // Cheap stat prefilter: bookmark files are small, so anything outside the
  // plausible range can't be one and isn't worth opening.
  try {
    const stats = await fsPromises.stat(filePath);
    if (stats.size < 4 || stats.size > MACOS_ALIAS_MAX_PROBE_BYTES) return false;
  } catch {
    return false;
  }
  let handle: fsPromises.FileHandle | undefined;
  try {
    handle = await fsPromises.open(filePath, "r");
    const buffer = Buffer.alloc(4);
    const { bytesRead } = await handle.read(buffer, 0, 4, 0);
    if (bytesRead < 4) return false;
    return buffer.toString("ascii") === MACOS_BOOKMARK_ALIAS_MAGIC;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function resolveMacOSAliasTargets(
  aliasPaths: readonly string[],
): Promise<Map<string, string>> {
  if (process.platform !== "darwin" || aliasPaths.length === 0) {
    return new Map();
  }
  // The first osascript invocation on a given install triggers macOS's TCC
  // prompt to "control Finder". If the user doesn't click Allow immediately,
  // osascript blocks waiting for their response. A short timeout would kill
  // the subprocess before they can react and leave aliases silently missing
  // from the picker, so we use a generous ceiling. Subsequent calls are
  // effectively instantaneous.
  const stdout = await new Promise<string>((resolve) => {
    execFile(
      "osascript",
      ["-e", MACOS_ALIAS_RESOLVE_SCRIPT, "--", ...aliasPaths],
      { timeout: 30_000, maxBuffer: 1_024 * 1_024 },
      (error, out) => {
        if (error) {
          resolve("");
          return;
        }
        resolve(out);
      },
    );
  });
  const map = new Map<string, string>();
  // The script emits `<resolved>\0` for each argv entry (empty chunk for
  // unresolvable aliases). Split on NUL and match positionally to aliasPaths.
  const chunks = stdout.split("\0");
  for (let i = 0; i < aliasPaths.length; i += 1) {
    const aliasPath = aliasPaths[i];
    const resolved = chunks[i]?.replace(/\/$/, "") ?? "";
    if (aliasPath && resolved) {
      map.set(aliasPath, resolved);
    }
  }
  return map;
}

const resolveBrowseTarget = (
  input: FilesystemBrowseInput,
  pathService: Path.Path,
): Effect.Effect<string, WorkspaceEntriesBrowseError> =>
  Effect.gen(function* () {
    if (process.platform !== "win32" && isWindowsAbsolutePath(input.partialPath)) {
      return yield* new WorkspaceEntriesBrowseError({
        cwd: input.cwd,
        partialPath: input.partialPath,
        operation: "workspaceEntries.resolveBrowseTarget",
        detail: "Windows-style paths are only supported on Windows.",
      });
    }

    if (!isExplicitRelativePath(input.partialPath)) {
      return pathService.resolve(expandHomePath(input.partialPath, pathService));
    }

    if (!input.cwd) {
      return yield* new WorkspaceEntriesBrowseError({
        cwd: input.cwd,
        partialPath: input.partialPath,
        operation: "workspaceEntries.resolveBrowseTarget",
        detail: "Relative filesystem browse paths require a current project.",
      });
    }

    return pathService.resolve(expandHomePath(input.cwd, pathService), input.partialPath);
  });

export const makeWorkspaceEntries = Effect.gen(function* () {
  const path = yield* Path.Path;
  const vcsRegistry = yield* VcsDriverRegistry;
  const workspacePaths = yield* WorkspacePaths;
  const workspaceAccessPolicy = yield* WorkspaceAccessPolicy;

  const isInsideVcsWorkTree = (cwd: string): Effect.Effect<boolean> =>
    vcsRegistry.detect({ cwd }).pipe(
      Effect.map((handle) => handle !== null),
      Effect.catch(() => Effect.succeed(false)),
    );

  const filterVcsIgnoredPaths = (
    cwd: string,
    relativePaths: string[],
  ): Effect.Effect<string[], never> =>
    vcsRegistry.detect({ cwd }).pipe(
      Effect.flatMap((handle) =>
        handle
          ? handle.driver.filterIgnoredPaths(cwd, relativePaths).pipe(
              Effect.map((paths) => [...paths]),
              Effect.catch(() => Effect.succeed(relativePaths)),
            )
          : Effect.succeed(relativePaths),
      ),
      Effect.catch(() => Effect.succeed(relativePaths)),
    );

  const buildWorkspaceIndexFromVcs = Effect.fn("WorkspaceEntries.buildWorkspaceIndexFromVcs")(
    function* (cwd: string) {
      const vcs = yield* vcsRegistry.detect({ cwd }).pipe(Effect.catch(() => Effect.succeed(null)));
      if (!vcs) {
        return null;
      }

      const listedFiles = yield* vcs.driver
        .listWorkspaceFiles(cwd)
        .pipe(Effect.catch(() => Effect.succeed(null)));

      if (!listedFiles) {
        return null;
      }

      const listedPaths = [...listedFiles.paths]
        .map((entry) => toPosixPath(entry))
        .filter((entry) => entry.length > 0 && !isPathInIgnoredDirectory(entry));
      const filePaths = yield* vcs.driver.filterIgnoredPaths(cwd, listedPaths).pipe(
        Effect.map((paths) => [...paths]),
        Effect.catch(() => filterVcsIgnoredPaths(cwd, listedPaths)),
      );

      const directorySet = new Set<string>();
      for (const filePath of filePaths) {
        for (const directoryPath of directoryAncestorsOf(filePath)) {
          if (!isPathInIgnoredDirectory(directoryPath)) {
            directorySet.add(directoryPath);
          }
        }
      }

      const directoryEntries = [...directorySet]
        .toSorted((left, right) => left.localeCompare(right))
        .map(
          (directoryPath): ProjectEntry => ({
            path: directoryPath,
            kind: "directory",
            parentPath: parentPathOf(directoryPath),
          }),
        )
        .map(toSearchableWorkspaceEntry);
      const fileEntries = [...new Set(filePaths)]
        .toSorted((left, right) => left.localeCompare(right))
        .map(
          (filePath): ProjectEntry => ({
            path: filePath,
            kind: "file",
            parentPath: parentPathOf(filePath),
          }),
        )
        .map(toSearchableWorkspaceEntry);

      const now = yield* DateTime.now;
      const entries = [...directoryEntries, ...fileEntries];
      return {
        scannedAt: now.epochMilliseconds,
        entries: entries.slice(0, WORKSPACE_INDEX_MAX_ENTRIES),
        truncated: listedFiles.truncated || entries.length > WORKSPACE_INDEX_MAX_ENTRIES,
      };
    },
  );

  const readDirectoryEntries = Effect.fn("WorkspaceEntries.readDirectoryEntries")(function* (
    cwd: string,
    relativeDir: string,
  ): Effect.fn.Return<
    { readonly relativeDir: string; readonly dirents: Dirent[] | null },
    WorkspaceEntriesError
  > {
    return yield* Effect.tryPromise({
      try: async () => {
        const absoluteDir = relativeDir ? path.join(cwd, relativeDir) : cwd;
        const dirents = await fsPromises.readdir(absoluteDir, { withFileTypes: true });
        return { relativeDir, dirents };
      },
      catch: (cause) =>
        new WorkspaceEntriesError({
          cwd,
          operation: "workspaceEntries.readDirectoryEntries",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    }).pipe(
      Effect.catchIf(
        () => relativeDir.length > 0,
        () => Effect.succeed({ relativeDir, dirents: null }),
      ),
    );
  });

  const buildWorkspaceIndexFromFilesystem = Effect.fn(
    "WorkspaceEntries.buildWorkspaceIndexFromFilesystem",
  )(function* (cwd: string): Effect.fn.Return<WorkspaceIndex, WorkspaceEntriesError> {
    const shouldFilterWithGitIgnore = yield* isInsideVcsWorkTree(cwd);

    let pendingDirectories: string[] = [""];
    const entries: SearchableWorkspaceEntry[] = [];
    let truncated = false;

    while (pendingDirectories.length > 0 && !truncated) {
      const currentDirectories = pendingDirectories;
      pendingDirectories = [];

      const directoryEntries = yield* Effect.forEach(
        currentDirectories,
        (relativeDir) => readDirectoryEntries(cwd, relativeDir),
        { concurrency: WORKSPACE_SCAN_READDIR_CONCURRENCY },
      );

      const candidateEntriesByDirectory = directoryEntries.map((directoryEntry) => {
        const { relativeDir, dirents } = directoryEntry;
        if (!dirents) return [] as Array<{ dirent: Dirent; relativePath: string }>;

        dirents.sort((left, right) => left.name.localeCompare(right.name));
        const candidates: Array<{ dirent: Dirent; relativePath: string }> = [];
        for (const dirent of dirents) {
          if (!dirent.name || dirent.name === "." || dirent.name === "..") {
            continue;
          }
          if (dirent.isDirectory() && IGNORED_DIRECTORY_NAMES.has(dirent.name)) {
            continue;
          }
          if (!dirent.isDirectory() && !dirent.isFile()) {
            continue;
          }

          const relativePath = toPosixPath(
            relativeDir ? path.join(relativeDir, dirent.name) : dirent.name,
          );
          if (isPathInIgnoredDirectory(relativePath)) {
            continue;
          }
          candidates.push({ dirent, relativePath });
        }
        return candidates;
      });

      const candidatePaths = candidateEntriesByDirectory.flatMap((candidateEntries) =>
        candidateEntries.map((entry) => entry.relativePath),
      );
      const allowedPathSet = shouldFilterWithGitIgnore
        ? new Set(yield* filterVcsIgnoredPaths(cwd, candidatePaths))
        : null;

      for (const candidateEntries of candidateEntriesByDirectory) {
        for (const candidate of candidateEntries) {
          if (allowedPathSet && !allowedPathSet.has(candidate.relativePath)) {
            continue;
          }

          const entry = toSearchableWorkspaceEntry({
            path: candidate.relativePath,
            kind: candidate.dirent.isDirectory() ? "directory" : "file",
            parentPath: parentPathOf(candidate.relativePath),
          });
          entries.push(entry);

          if (candidate.dirent.isDirectory()) {
            pendingDirectories.push(candidate.relativePath);
          }

          if (entries.length >= WORKSPACE_INDEX_MAX_ENTRIES) {
            truncated = true;
            break;
          }
        }

        if (truncated) {
          break;
        }
      }
    }

    const now = yield* DateTime.now;
    return {
      scannedAt: now.epochMilliseconds,
      entries,
      truncated,
    };
  });

  const buildWorkspaceIndex = Effect.fn("WorkspaceEntries.buildWorkspaceIndex")(function* (
    cwd: string,
  ): Effect.fn.Return<WorkspaceIndex, WorkspaceEntriesError> {
    const vcsIndexed = yield* buildWorkspaceIndexFromVcs(cwd);
    if (vcsIndexed) {
      return vcsIndexed;
    }
    return yield* buildWorkspaceIndexFromFilesystem(cwd);
  });

  const workspaceIndexCache = yield* Cache.makeWith<string, WorkspaceIndex, WorkspaceEntriesError>(
    buildWorkspaceIndex,
    {
      capacity: WORKSPACE_CACHE_MAX_KEYS,
      timeToLive: (exit) =>
        Exit.isSuccess(exit) ? Duration.millis(WORKSPACE_CACHE_TTL_MS) : Duration.zero,
    },
  );

  const normalizeWorkspaceRoot = Effect.fn("WorkspaceEntries.normalizeWorkspaceRoot")(function* (
    cwd: string,
  ): Effect.fn.Return<string, WorkspaceEntriesError> {
    return yield* workspacePaths.normalizeWorkspaceRoot(cwd).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceEntriesError({
            cwd,
            operation: "workspaceEntries.normalizeWorkspaceRoot",
            detail: cause.message,
            cause,
          }),
      ),
    );
  });

  const invalidate: WorkspaceEntriesShape["invalidate"] = Effect.fn("WorkspaceEntries.invalidate")(
    function* (cwd) {
      const normalizedCwd = yield* normalizeWorkspaceRoot(cwd).pipe(
        Effect.catch(() => Effect.succeed(cwd)),
      );
      yield* Cache.invalidate(workspaceIndexCache, cwd);
      if (normalizedCwd !== cwd) {
        yield* Cache.invalidate(workspaceIndexCache, normalizedCwd);
      }
    },
  );

  const browse: WorkspaceEntriesShape["browse"] = Effect.fn("WorkspaceEntries.browse")(
    function* (input) {
      const resolvedInputPath = yield* resolveBrowseTarget(input, path);
      const endsWithSeparator = /[\\/]$/.test(input.partialPath) || input.partialPath === "~";
      const initialParentPath = endsWithSeparator
        ? resolvedInputPath
        : path.dirname(resolvedInputPath);
      const prefix = endsWithSeparator ? "" : path.basename(resolvedInputPath);

      yield* workspaceAccessPolicy
        .assertExistingPath({
          path: initialParentPath,
          operation: "filesystemBrowse",
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceEntriesBrowseError({
                cwd: input.cwd,
                partialPath: input.partialPath,
                operation: "workspaceEntries.browse.accessPolicy",
                detail: cause.message,
                cause,
              }),
          ),
        );

      // If the user typed a path whose last component is a macOS Finder alias
      // (e.g. `~/mongodb-test-alis/`), the entry is a regular file on disk and
      // readdir would fail. Resolve it to its target directory first so the
      // listing works and the returned parentPath reflects the real location.
      const resolvedParentPath = yield* Effect.promise(async () => {
        try {
          if (process.platform !== "darwin" || !endsWithSeparator) {
            return initialParentPath;
          }
          try {
            const stats = await fsPromises.lstat(initialParentPath);
            if (!stats.isFile()) return initialParentPath;
          } catch {
            return initialParentPath;
          }
          if (!(await isMacOSBookmarkAlias(initialParentPath))) {
            return initialParentPath;
          }
          const resolved = await resolveMacOSAliasTargets([initialParentPath]);
          return resolved.get(initialParentPath) ?? initialParentPath;
        } catch {
          // Defense in depth: alias resolution is best-effort; never let an
          // unexpected rejection here become an Effect defect.
          return initialParentPath;
        }
      });
      const parentPath = yield* workspaceAccessPolicy
        .assertExistingPath({
          path: resolvedParentPath,
          operation: "filesystemBrowse",
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceEntriesBrowseError({
                cwd: input.cwd,
                partialPath: input.partialPath,
                operation: "workspaceEntries.browse.accessPolicy",
                detail: cause.message,
                cause,
              }),
          ),
        );

      const dirents = yield* Effect.tryPromise({
        try: () => fsPromises.readdir(parentPath, { withFileTypes: true }),
        catch: (cause) =>
          new WorkspaceEntriesBrowseError({
            cwd: input.cwd,
            partialPath: input.partialPath,
            operation: "workspaceEntries.browse.readDirectory",
            detail: `Unable to browse '${parentPath}': ${cause instanceof Error ? cause.message : String(cause)}`,
            cause,
          }),
      }).pipe(
        Effect.catchIf(
          (error) => isPermissionDeniedError(error.cause),
          () => Effect.succeed([] as Dirent[]),
        ),
      );

      const showHidden = endsWithSeparator || prefix.startsWith(".");
      const lowerPrefix = prefix.toLowerCase();

      const isDarwin = process.platform === "darwin";

      const candidates = dirents.filter((dirent) => {
        if (!dirent.name.toLowerCase().startsWith(lowerPrefix)) return false;
        if (!showHidden && dirent.name.startsWith(".")) return false;
        if (dirent.isDirectory() || dirent.isSymbolicLink()) return true;
        // On macOS, regular files can be Finder aliases (binary bookmark
        // files). We detect them by magic bytes below before resolving.
        if (isDarwin && dirent.isFile()) return true;
        return false;
      });

      // Follow symlinks (e.g. ~/Dropbox -> ~/Library/CloudStorage/Dropbox) and
      // macOS Finder aliases so they show up in the picker alongside real
      // directories. Aliases are resolved in a single batched osascript call.
      const { resolved, aliasTargets } = yield* Effect.promise(async () => {
        try {
          const initial = await mapWithConcurrency(
            candidates,
            ALIAS_PROBE_CONCURRENCY,
            async (dirent) => {
              if (dirent.isDirectory()) {
                return { dirent, pointsToDirectory: true, isAlias: false };
              }
              if (dirent.isSymbolicLink()) {
                try {
                  const stats = await fsPromises.stat(path.join(parentPath, dirent.name));
                  return { dirent, pointsToDirectory: stats.isDirectory(), isAlias: false };
                } catch {
                  return { dirent, pointsToDirectory: false, isAlias: false };
                }
              }
              if (isDarwin && dirent.isFile()) {
                const fullPath = path.join(parentPath, dirent.name);
                if (await isMacOSBookmarkAlias(fullPath)) {
                  return { dirent, pointsToDirectory: false, isAlias: true };
                }
              }
              return { dirent, pointsToDirectory: false, isAlias: false };
            },
          );

          const aliasCandidatePaths = initial
            .filter((item) => item.isAlias)
            .map((item) => path.join(parentPath, item.dirent.name));
          const aliasTargets = await resolveMacOSAliasTargets(aliasCandidatePaths);

          const finalItems = await mapWithConcurrency(
            initial,
            ALIAS_PROBE_CONCURRENCY,
            async (item) => {
              if (!item.isAlias) return item;
              const aliasPath = path.join(parentPath, item.dirent.name);
              const target = aliasTargets.get(aliasPath);
              if (!target) return item;
              try {
                const stats = await fsPromises.stat(target);
                return { ...item, pointsToDirectory: stats.isDirectory() };
              } catch {
                return item;
              }
            },
          );

          return { resolved: finalItems, aliasTargets };
        } catch {
          // Defense in depth: alias/symlink resolution is best-effort. Fall
          // back to the raw dirent list without any target-directory
          // promotion rather than letting an unexpected rejection surface as
          // an Effect defect.
          return {
            resolved: candidates.map((dirent) => ({
              dirent,
              pointsToDirectory: dirent.isDirectory(),
              isAlias: false,
            })),
            aliasTargets: new Map<string, string>(),
          };
        }
      });

      return {
        parentPath,
        ...(workspaceAccessPolicy.accessRoot !== undefined
          ? { workspaceAccessRoot: workspaceAccessPolicy.accessRoot }
          : {}),
        entries: resolved
          .filter((item) => item.pointsToDirectory)
          .map(({ dirent, isAlias }) => {
            const joined = path.join(parentPath, dirent.name);
            const entry: {
              name: string;
              fullPath: string;
              isSymlink?: boolean;
              isAlias?: boolean;
            } = {
              name: dirent.name,
              fullPath: isAlias ? (aliasTargets.get(joined) ?? joined) : joined,
            };
            if (dirent.isSymbolicLink() || isAlias) entry.isSymlink = true;
            if (isAlias) entry.isAlias = true;
            return entry;
          })
          .toSorted((left, right) => left.name.localeCompare(right.name)),
      };
    },
  );

  const search: WorkspaceEntriesShape["search"] = Effect.fn("WorkspaceEntries.search")(
    function* (input) {
      const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
      return yield* Cache.get(workspaceIndexCache, normalizedCwd).pipe(
        Effect.map((index) => {
          const normalizedQuery = normalizeSearchQuery(input.query, {
            trimLeadingPattern: /^[@./]+/,
          });
          const limit = Math.max(0, Math.floor(input.limit));
          const rankedEntries: RankedWorkspaceEntry[] = [];
          let matchedEntryCount = 0;

          for (const entry of index.entries) {
            const score = scoreEntry(entry, normalizedQuery);
            if (score === null) {
              continue;
            }

            matchedEntryCount += 1;
            insertRankedSearchResult(
              rankedEntries,
              { item: entry, score, tieBreaker: entry.path },
              limit,
            );
          }

          return {
            entries: rankedEntries.map((candidate) => candidate.item),
            truncated: index.truncated || matchedEntryCount > limit,
          };
        }),
      );
    },
  );

  const listEntries: WorkspaceEntriesShape["listEntries"] = Effect.fn(
    "WorkspaceEntries.listEntries",
  )(function* (input) {
    const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
    return yield* Cache.get(workspaceIndexCache, normalizedCwd).pipe(
      Effect.map((index) => ({
        entries: index.entries.map(
          ({ normalizedName: _normalizedName, normalizedPath: _normalizedPath, ...entry }) => entry,
        ),
        truncated: index.truncated,
      })),
    );
  });

  return {
    browse,
    invalidate,
    listEntries,
    search,
  } satisfies WorkspaceEntriesShape;
});

export const WorkspaceEntriesLive = Layer.effect(WorkspaceEntries, makeWorkspaceEntries);
