/**
 * Read-only access to background-task output files for the Agents surface.
 *
 * Two file families, both produced by the Claude harness under a task's
 * `outputFile` handle:
 * - background shells write plain files under `<tmp>/claude-<uid>/…/tasks/`;
 * - agent tasks expose symlinks in the same directory whose realpath lands in
 *   `.claude/projects/…/subagents/agent-*.jsonl`.
 *
 * Containment rules mirror workflowScriptQuery: the resolved realpath must
 * live under an allowlisted root (the `.claude/projects` homes plus the
 * harness tmp dirs), only .output/.jsonl leaves are served, and reads are
 * windowed rather than failed. The client-supplied path is a hint from the
 * task's linkage fields; it is never trusted beyond these checks.
 *
 * Reads are tail-oriented: with no offset the window starts near the end of
 * large files (dev-server logs grow unbounded); a returned `nextOffset` lets
 * the client poll for appended output incrementally.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { OrchestrationGetTaskOutputError, type ServerSettings } from "@ryco/contracts";
import { Effect } from "effect";

import { workflowScriptRootsFromSettings } from "./workflowScriptQuery.ts";

/** Tail window when no offset is given. */
const TAIL_BYTE_CAP = 64 * 1024;
/** Upper bound for a single read, offset or not. */
const CHUNK_BYTE_CAP = 256 * 1024;

const OUTPUT_EXTENSIONS = new Set([".output", ".jsonl"]);

function harnessTmpRoots(): ReadonlyArray<string> {
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const names = uid === undefined ? ["claude"] : [`claude-${uid}`, "claude"];
  const bases = [...new Set(["/tmp", NodeOS.tmpdir()])];
  return bases.flatMap((base) => names.map((name) => NodePath.join(base, name)));
}

export function defaultTaskOutputRoots(): ReadonlyArray<string> {
  return [...workflowScriptRootsFromSettings(undefined), ...harnessTmpRoots()];
}

/**
 * Containment roots: every workflow-script root (agent-task outputs are
 * symlinks whose realpath lands under `.claude/projects`) plus the harness
 * tmp dirs where background shells write their plain output files.
 */
export function taskOutputRootsFromSettings(
  settings: Pick<ServerSettings, "providerInstances" | "providers"> | undefined,
): ReadonlyArray<string> {
  return [...new Set([...workflowScriptRootsFromSettings(settings), ...harnessTmpRoots()])];
}

export const readTaskOutput = Effect.fn("orchestration.readTaskOutput")(function* (input: {
  readonly outputPath: string;
  /** Byte offset from a prior read's nextOffset; omit to tail. */
  readonly offset?: number | undefined;
  /** Candidate containment roots; defaults to script homes + harness tmp. */
  readonly roots?: ReadonlyArray<string>;
}) {
  const requested = input.outputPath;

  if (!NodePath.isAbsolute(requested) || !OUTPUT_EXTENSIONS.has(NodePath.extname(requested))) {
    return yield* Effect.fail(
      new OrchestrationGetTaskOutputError({ reason: "invalid-path", outputPath: requested }),
    );
  }

  // Realpath every candidate root; roots that don't exist are skipped, but
  // if none resolve the read fails closed.
  const candidateRoots = input.roots ?? defaultTaskOutputRoots();
  const resolvedRoots: string[] = [];
  for (const root of candidateRoots) {
    const resolved = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(root),
      catch: () => undefined,
    }).pipe(Effect.catch(() => Effect.succeed(undefined)));
    if (typeof resolved === "string") {
      resolvedRoots.push(resolved);
    }
  }
  if (resolvedRoots.length === 0) {
    return yield* Effect.fail(
      new OrchestrationGetTaskOutputError({
        reason: "root-unavailable",
        outputPath: requested,
      }),
    );
  }

  // Realpath the FILE itself (not just its directory): agent-task outputs
  // are symlinks by design, so containment applies to the resolved target.
  const resolved = yield* Effect.tryPromise({
    try: () => NodeFSP.realpath(requested),
    catch: (cause) =>
      new OrchestrationGetTaskOutputError({
        reason: "not-found",
        outputPath: requested,
        cause,
      }),
  });

  const contained = resolvedRoots.some(
    (root) => resolved === root || resolved.startsWith(`${root}${NodePath.sep}`),
  );
  if (!contained) {
    return yield* Effect.fail(
      new OrchestrationGetTaskOutputError({ reason: "outside-root", outputPath: resolved }),
    );
  }
  if (!OUTPUT_EXTENSIONS.has(NodePath.extname(resolved))) {
    return yield* Effect.fail(
      new OrchestrationGetTaskOutputError({ reason: "invalid-path", outputPath: resolved }),
    );
  }

  // TOCTOU-safe read: open FIRST, then verify what was actually opened via
  // the file descriptor (same rationale as workflowScriptQuery).
  const offset = input.offset;
  const read = yield* Effect.tryPromise({
    try: async () => {
      const handle = await NodeFSP.open(resolved, "r");
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) {
          return { failure: "not-regular-file" as const };
        }
        const pathStat = await NodeFSP.lstat(resolved);
        if (stat.ino !== pathStat.ino || stat.dev !== pathStat.dev) {
          return { failure: "changed-during-read" as const };
        }
        const size = stat.size;
        // Offset reads continue a poll; offset past EOF (rotation, truncate)
        // clamps to EOF and yields an empty chunk rather than failing.
        const start =
          offset === undefined ? Math.max(0, size - TAIL_BYTE_CAP) : Math.min(offset, size);
        const length = Math.min(size - start, CHUNK_BYTE_CAP);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
        return {
          chunk: buffer.subarray(0, bytesRead).toString("utf8"),
          nextOffset: start + bytesRead,
          size,
          truncatedHead: offset === undefined && start > 0,
        };
      } finally {
        await handle.close();
      }
    },
    catch: (cause) =>
      new OrchestrationGetTaskOutputError({
        reason: "read-failed",
        outputPath: resolved,
        cause,
      }),
  });
  if ("failure" in read) {
    return yield* new OrchestrationGetTaskOutputError({
      reason: read.failure,
      outputPath: resolved,
    });
  }

  return {
    outputPath: resolved,
    chunk: read.chunk,
    nextOffset: read.nextOffset,
    size: read.size,
    truncatedHead: read.truncatedHead,
  };
});
