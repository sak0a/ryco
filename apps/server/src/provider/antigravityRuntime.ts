import * as fs from "node:fs";
import * as nodePath from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { AntigravitySettings, RuntimeMode } from "@ryco/contracts";
import { Data, Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { expandHomePath } from "../pathExpansion.ts";
import { collectUint8StreamText } from "../stream/collectUint8StreamText.ts";

const ANTIGRAVITY_CONVERSATIONS_RELATIVE_DIR = ".gemini/antigravity-cli/conversations";
const ANTIGRAVITY_OUTPUT_MAX_BYTES = 8 * 1024 * 1024;
const ANTIGRAVITY_POLL_INTERVAL_MS = 300;
const ANTIGRAVITY_ACTIVITY_INTERVAL_MS = 10_000;
const AUTO_MODEL = "auto";

export interface AntigravityConversationState {
  readonly conversationId?: string | undefined;
  readonly lastStepIdx: number;
}

export interface AntigravityPromptProcess {
  readonly kill: Effect.Effect<void, never>;
}

export interface AntigravityPromptResult {
  readonly text: string;
  readonly streamedText: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly conversationId?: string | undefined;
  readonly lastStepIdx: number;
}

export interface AntigravityPromptTextDelta {
  readonly text: string;
  readonly conversationId: string;
  readonly lastStepIdx: number;
}

export interface AntigravityPromptActivity {
  readonly summary: string;
  readonly elapsedMs: number;
  readonly conversationId?: string | undefined;
}

export class AntigravityRuntimeError extends Data.TaggedError("AntigravityRuntimeError")<{
  readonly operation: string;
  readonly detail: string;
  readonly cause?: unknown;
}> {}

function normalizeHomePath(
  settings: Pick<AntigravitySettings, "homePath">,
  environment: NodeJS.ProcessEnv,
): string {
  const configuredHome = settings.homePath.trim();
  if (configuredHome.length > 0) {
    return expandHomePath(configuredHome);
  }
  return environment.HOME ?? process.env.HOME ?? process.cwd();
}

export function makeAntigravityEnvironment(
  settings: Pick<AntigravitySettings, "homePath">,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const home = normalizeHomePath(settings, environment);
  return {
    ...environment,
    HOME: home,
  };
}

export function resolveAntigravityConversationsDir(
  settings: Pick<AntigravitySettings, "homePath">,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return nodePath.join(
    normalizeHomePath(settings, environment),
    ANTIGRAVITY_CONVERSATIONS_RELATIVE_DIR,
  );
}

export function splitAntigravityExtraArgs(extraArgs: string): ReadonlyArray<string> {
  return extraArgs.trim().length === 0 ? [] : extraArgs.trim().split(/\s+/u).filter(Boolean);
}

function hasExplicitPermissionFlag(args: ReadonlyArray<string>): boolean {
  return args.includes("--sandbox") || args.includes("--dangerously-skip-permissions");
}

function runtimePermissionArgs(
  runtimeMode: RuntimeMode,
  extraArgs: ReadonlyArray<string>,
): ReadonlyArray<string> {
  if (hasExplicitPermissionFlag(extraArgs)) {
    return [];
  }
  return runtimeMode === "full-access" ? ["--dangerously-skip-permissions"] : ["--sandbox"];
}

function shouldPassModel(model: string | null | undefined): model is string {
  const trimmed = model?.trim();
  return Boolean(trimmed && trimmed.toLowerCase() !== AUTO_MODEL);
}

export function buildAntigravityPromptArgs(input: {
  readonly settings: Pick<AntigravitySettings, "extraArgs" | "printTimeout">;
  readonly cwd: string;
  readonly prompt: string;
  readonly runtimeMode: RuntimeMode;
  readonly model?: string | null | undefined;
  readonly conversationId?: string | undefined;
}): ReadonlyArray<string> {
  const extraArgs = splitAntigravityExtraArgs(input.settings.extraArgs);
  return [
    "--add-dir",
    input.cwd,
    ...extraArgs,
    ...runtimePermissionArgs(input.runtimeMode, extraArgs),
    ...(input.settings.printTimeout.trim()
      ? ["--print-timeout", input.settings.printTimeout.trim()]
      : []),
    ...(shouldPassModel(input.model) ? ["--model", input.model.trim()] : []),
    ...(input.conversationId ? ["--conversation", input.conversationId] : []),
    "-p",
    input.prompt,
  ];
}

export function conversationSnapshot(conversationsDir: string): ReadonlySet<string> {
  let entries: ReadonlyArray<string>;
  try {
    entries = fs.readdirSync(conversationsDir);
  } catch {
    return new Set();
  }

  return new Set(
    entries.flatMap((entry) => {
      if (!entry.endsWith(".db")) {
        return [];
      }
      return [entry.slice(0, -".db".length)];
    }),
  );
}

export function newConversationId(
  conversationsDir: string,
  before: ReadonlySet<string>,
): string | undefined {
  const after = conversationSnapshot(conversationsDir);
  const created = [...after].filter((candidate) => !before.has(candidate));
  return created.length === 1 ? created[0] : undefined;
}

function readVarint(
  bytes: Uint8Array,
  offset: number,
): { readonly value: number; readonly nextOffset: number } | undefined {
  let result = 0;
  let shift = 0;
  for (let index = offset; index < bytes.length; index += 1) {
    if (shift >= 70) {
      return undefined;
    }
    const byte = bytes[index]!;
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) {
      return { value: result, nextOffset: index + 1 };
    }
    shift += 7;
  }
  return undefined;
}

export function getProtoField(blob: Uint8Array, targetField: number): Uint8Array | undefined {
  let offset = 0;
  while (offset < blob.length) {
    const tag = readVarint(blob, offset);
    if (!tag) {
      return undefined;
    }
    offset = tag.nextOffset;

    const fieldNumber = Math.floor(tag.value / 8);
    const wireType = tag.value % 8;
    switch (wireType) {
      case 0: {
        const value = readVarint(blob, offset);
        if (!value) {
          return undefined;
        }
        offset = value.nextOffset;
        break;
      }
      case 1:
        offset += 8;
        break;
      case 2: {
        const length = readVarint(blob, offset);
        if (!length) {
          return undefined;
        }
        offset = length.nextOffset;
        const end = offset + length.value;
        if (end > blob.length) {
          return undefined;
        }
        if (fieldNumber === targetField) {
          return blob.subarray(offset, end);
        }
        offset = end;
        break;
      }
      case 5:
        offset += 4;
        break;
      default:
        return undefined;
    }
  }
  return undefined;
}

export function extractTextFromStepPayload(payload: Uint8Array): string | undefined {
  const field20 = getProtoField(payload, 20);
  if (!field20) {
    return undefined;
  }
  const field1 = getProtoField(field20, 1);
  if (!field1) {
    return undefined;
  }
  return new TextDecoder().decode(field1);
}

function isNarration(text: string): boolean {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trimStart())
    .filter((line) => line.length > 0);
  return lines.length > 0 && lines.every((line) => line.startsWith("I will"));
}

export function filterAntigravityNarration(
  parts: ReadonlyArray<string>,
  toolDisplay: string | undefined,
): string {
  const normalized = toolDisplay?.toLowerCase();
  const shouldFilter = normalized === "compact" || normalized === "none" || normalized === "off";
  if (!shouldFilter || parts.length <= 1) {
    return parts.join("\n");
  }
  const firstContentIndex = parts.findIndex((part) => !isNarration(part));
  const startIndex = firstContentIndex >= 0 ? firstContentIndex : Math.max(0, parts.length - 1);
  return parts.slice(startIndex).join("\n");
}

interface AntigravityResponseDelta {
  readonly text: string;
  readonly maxStepIdx: number;
}

function isSqliteTablePresent(db: DatabaseSync, tableName: string): boolean {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { count?: number | bigint } | undefined;
  return Number(row?.count ?? 0) > 0;
}

export function readAntigravityResponseDelta(input: {
  readonly conversationsDir: string;
  readonly conversationId: string;
  readonly afterStepIdx: number;
  readonly toolDisplay?: string | undefined;
}): AntigravityResponseDelta | undefined {
  const dbPath = nodePath.join(input.conversationsDir, `${input.conversationId}.db`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    if (!isSqliteTablePresent(db, "steps")) {
      return undefined;
    }

    const rows = db
      .prepare("SELECT idx, step_payload FROM steps WHERE idx > ? AND step_type = 15 ORDER BY idx")
      .all(input.afterStepIdx) as Array<{
      readonly idx: number | bigint;
      readonly step_payload: Uint8Array;
    }>;
    let maxStepIdx = input.afterStepIdx;
    const parts: Array<string> = [];
    for (const row of rows) {
      maxStepIdx = Math.max(maxStepIdx, Number(row.idx));
      const extracted = extractTextFromStepPayload(row.step_payload);
      if (extracted && extracted.length > 0) {
        parts.push(extracted);
      }
    }
    if (parts.length === 0) {
      return undefined;
    }
    return {
      text: filterAntigravityNarration(parts, input.toolDisplay),
      maxStepIdx,
    };
  } finally {
    db.close();
  }
}

function fallbackTextFromStdout(
  stdout: string,
  toolDisplay: string | undefined,
): string | undefined {
  const parts = stdout
    .split(/\n\n/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return undefined;
  }
  return filterAntigravityNarration(parts, toolDisplay).trim();
}

function appendAntigravityText(base: string, delta: string | undefined): string {
  if (!delta || delta.length === 0) {
    return base;
  }
  if (base.length === 0) {
    return delta;
  }
  return `${base}\n${delta}`;
}

export const runAntigravityPrompt = Effect.fn("runAntigravityPrompt")(function* (input: {
  readonly settings: AntigravitySettings;
  readonly cwd: string;
  readonly prompt: string;
  readonly runtimeMode: RuntimeMode;
  readonly model?: string | null | undefined;
  readonly state: AntigravityConversationState;
  readonly environment?: NodeJS.ProcessEnv | undefined;
  readonly onProcessStart?:
    | ((process: AntigravityPromptProcess) => Effect.Effect<void, never>)
    | undefined;
  readonly onProcessExit?: Effect.Effect<void, never> | undefined;
  readonly onTextDelta?:
    | ((delta: AntigravityPromptTextDelta) => Effect.Effect<void, never>)
    | undefined;
  readonly onActivity?:
    | ((activity: AntigravityPromptActivity) => Effect.Effect<void, never>)
    | undefined;
  readonly pollIntervalMs?: number | undefined;
  readonly activityIntervalMs?: number | undefined;
}): Effect.fn.Return<
  AntigravityPromptResult,
  AntigravityRuntimeError,
  ChildProcessSpawner.ChildProcessSpawner
> {
  return yield* Effect.gen(function* () {
    const environment = makeAntigravityEnvironment(
      input.settings,
      input.environment ?? process.env,
    );
    const runtimeContext = yield* Effect.context<never>();
    const runFork = Effect.runForkWith(runtimeContext);
    const conversationsDir = resolveAntigravityConversationsDir(input.settings, environment);
    let observedConversationId = input.state.conversationId;
    let observedStepIdx = input.state.lastStepIdx;
    let streamedText = "";
    let lastActivityAt = Date.now();
    const startedAt = lastActivityAt;
    const beforeSnapshot =
      input.state.conversationId === undefined ? conversationSnapshot(conversationsDir) : undefined;
    const args = buildAntigravityPromptArgs({
      settings: input.settings,
      cwd: input.cwd,
      prompt: input.prompt,
      runtimeMode: input.runtimeMode,
      model: input.model,
      conversationId: input.state.conversationId,
    });

    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner
      .spawn(
        ChildProcess.make(input.settings.binaryPath || "agy", [...args], {
          cwd: input.cwd,
          env: environment,
          shell: process.platform === "win32",
        }),
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new AntigravityRuntimeError({
              operation: "spawn",
              detail: `Failed to spawn Antigravity CLI: ${cause.message}`,
              cause,
            }),
        ),
      );
    const processHandle: AntigravityPromptProcess = {
      kill: child.kill({ killSignal: "SIGTERM", forceKillAfter: "1 second" }).pipe(Effect.ignore),
    };
    if (input.onProcessStart) {
      yield* input.onProcessStart(processHandle);
    }
    yield* Effect.addFinalizer(() =>
      processHandle.kill.pipe(Effect.andThen(input.onProcessExit ?? Effect.void)),
    );

    const emitActivity = (summary: string) =>
      input.onActivity
        ? input.onActivity({
            summary,
            elapsedMs: Math.max(0, Date.now() - startedAt),
            ...(observedConversationId ? { conversationId: observedConversationId } : {}),
          })
        : Effect.void;

    const pollForConversationDelta = Effect.gen(function* () {
      const now = Date.now();
      if (observedConversationId === undefined && beforeSnapshot !== undefined) {
        const discoveredConversationId = newConversationId(conversationsDir, beforeSnapshot);
        if (discoveredConversationId !== undefined) {
          observedConversationId = discoveredConversationId;
          yield* emitActivity("Antigravity conversation started");
        }
      }

      const conversationIdForRead = observedConversationId;
      if (input.onTextDelta !== undefined && conversationIdForRead !== undefined) {
        const delta = yield* Effect.sync(() => {
          try {
            return readAntigravityResponseDelta({
              conversationsDir,
              conversationId: conversationIdForRead,
              afterStepIdx: observedStepIdx,
              toolDisplay: environment.OPENAB_TOOL_DISPLAY,
            });
          } catch {
            return undefined;
          }
        });

        if (delta !== undefined && delta.text.trim().length > 0) {
          observedStepIdx = delta.maxStepIdx;
          streamedText = appendAntigravityText(streamedText, delta.text);
          yield* input.onTextDelta({
            text: delta.text,
            conversationId: conversationIdForRead,
            lastStepIdx: observedStepIdx,
          });
        }
      }

      const activityIntervalMs = input.activityIntervalMs ?? ANTIGRAVITY_ACTIVITY_INTERVAL_MS;
      if (input.onActivity !== undefined && now - lastActivityAt >= activityIntervalMs) {
        lastActivityAt = now;
        yield* emitActivity("Antigravity is still running");
      }
    });

    let stopPolling: (() => void) | undefined;
    if (input.onTextDelta !== undefined || input.onActivity !== undefined) {
      let pollInFlight = false;
      let pollingStopped = false;
      const runPoll = () => {
        if (pollInFlight || pollingStopped) {
          return;
        }
        pollInFlight = true;
        runFork(
          pollForConversationDelta.pipe(
            Effect.catchDefect(() => Effect.void),
            Effect.ensuring(
              Effect.sync(() => {
                pollInFlight = false;
              }),
            ),
          ),
        );
      };
      runPoll();
      const pollInterval = setInterval(
        runPoll,
        input.pollIntervalMs ?? ANTIGRAVITY_POLL_INTERVAL_MS,
      );
      stopPolling = () => {
        pollingStopped = true;
        clearInterval(pollInterval);
      };
      yield* Effect.addFinalizer(() => Effect.sync(() => stopPolling?.()));
    }

    const [stdoutResult, stderrResult, exitCode] = yield* Effect.all(
      [
        collectUint8StreamText({
          stream: child.stdout,
          maxBytes: ANTIGRAVITY_OUTPUT_MAX_BYTES,
        }).pipe(Effect.map((collected) => collected.text)),
        collectUint8StreamText({
          stream: child.stderr,
          maxBytes: ANTIGRAVITY_OUTPUT_MAX_BYTES,
        }).pipe(Effect.map((collected) => collected.text)),
        child.exitCode.pipe(Effect.map(Number)),
        Stream.run(Stream.empty, child.stdin).pipe(Effect.ignore),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.map(([stdout, stderr, exitCode]) => [stdout, stderr, exitCode] as const),
      Effect.mapError(
        (cause) =>
          new AntigravityRuntimeError({
            operation: "collect-output",
            detail: "Failed to collect Antigravity CLI output.",
            cause,
          }),
      ),
    );
    stopPolling?.();

    const stderr = stderrResult.trim();
    if (exitCode !== 0 && stdoutResult.trim().length === 0) {
      return yield* new AntigravityRuntimeError({
        operation: "prompt",
        detail:
          stderr.length > 0
            ? `Antigravity CLI failed: ${stderr}`
            : `Antigravity CLI exited with code ${exitCode}.`,
      });
    }

    const conversationId =
      observedConversationId ??
      input.state.conversationId ??
      (beforeSnapshot ? newConversationId(conversationsDir, beforeSnapshot) : undefined);

    const delta =
      conversationId === undefined
        ? undefined
        : yield* Effect.try({
            try: () =>
              readAntigravityResponseDelta({
                conversationsDir,
                conversationId,
                afterStepIdx: observedStepIdx,
                toolDisplay: environment.OPENAB_TOOL_DISPLAY,
              }),
            catch: (cause) =>
              new AntigravityRuntimeError({
                operation: "read-conversation",
                detail: "Failed to read Antigravity conversation database.",
                cause,
              }),
          });

    if (delta !== undefined) {
      observedStepIdx = delta.maxStepIdx;
    }
    const text = appendAntigravityText(
      streamedText,
      delta?.text ??
        (conversationId === undefined
          ? fallbackTextFromStdout(stdoutResult, environment.OPENAB_TOOL_DISPLAY)
          : undefined),
    );

    if (!text || text.trim().length === 0) {
      return yield* new AntigravityRuntimeError({
        operation: "extract-response",
        detail:
          conversationId === undefined
            ? "Antigravity responded but Ryco could not bind a conversation or read stdout."
            : "Antigravity responded but response extraction failed. The conversation DB schema may have changed.",
      });
    }

    return {
      text: text.trim(),
      streamedText: streamedText.trim(),
      stdout: stdoutResult,
      stderr: stderrResult,
      exitCode,
      ...(conversationId ? { conversationId } : {}),
      lastStepIdx: observedStepIdx,
    };
  }).pipe(Effect.scoped);
});
