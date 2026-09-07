/**
 * Provider event logger helper.
 *
 * Best-effort writer for observability logs. Each record is formatted as a
 * single effect-style text line in a thread-scoped file. Failures are
 * downgraded to warnings so provider runtime behavior is unaffected.
 */
import fs from "node:fs";
import path from "node:path";

import type { ThreadId } from "@ryco/contracts";
import { AsyncRotatingFileSink } from "@ryco/shared/logging";
import { Effect, SynchronizedRef } from "effect";

import { recordResourceAttribution } from "../../diagnostics/ResourceAttribution.ts";
import { toSafeThreadAttachmentSegment } from "../../attachmentStore.ts";
import { increment, providerEventLogRecordsDroppedTotal } from "../../observability/Metrics.ts";

/**
 * Age-based retention for the event log directory. Files that have not been
 * written for this long belong to threads nobody is debugging anymore;
 * rotation alone never deletes them, so without this sweep the directory
 * grows without bound (observed: 11 GB across 450+ threads).
 */
export const DEFAULT_EVENT_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const EVENT_LOG_FILE_PATTERN = /\.log(?:\.\d+)?$/;

/**
 * Best-effort deletion of `*.log` / `*.log.N` files in `directory` whose
 * mtime is older than the retention window. Returns the number of files
 * removed. Never fails: unreadable directories or races with rotation are
 * downgraded to a warning / skipped file.
 */
export const sweepStaleEventLogs = Effect.fn("sweepStaleEventLogs")(function* (
  directory: string,
  options?: { readonly maxAgeMs?: number; readonly now?: number },
): Effect.fn.Return<number> {
  const maxAgeMs = options?.maxAgeMs ?? DEFAULT_EVENT_LOG_RETENTION_MS;
  const cutoffMs = (options?.now ?? Date.now()) - maxAgeMs;
  const removed = yield* Effect.tryPromise(async () => {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !EVENT_LOG_FILE_PATTERN.test(entry.name)) {
        continue;
      }
      const filePath = path.join(directory, entry.name);
      try {
        const stats = await fs.promises.stat(filePath);
        if (stats.mtimeMs < cutoffMs) {
          await fs.promises.unlink(filePath);
          count += 1;
        }
      } catch {
        // Raced with rotation or a concurrent delete; skip the file.
      }
    }
    return count;
  }).pipe(
    Effect.catch((error) =>
      logWarning("failed to sweep stale provider event logs", { directory, error }).pipe(
        Effect.as(0),
      ),
    ),
  );
  if (removed > 0) {
    yield* Effect.logInfo("swept stale provider event logs", { directory, removed }).pipe(
      Effect.annotateLogs({ scope: LOG_SCOPE }),
    );
  }
  return removed;
});

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
// Rotation depth is per thread file, so the effective cap is
// `maxBytes * maxFiles * threads`. Keep the depth shallow: these are
// best-effort observability logs and deep history has no consumer.
const DEFAULT_MAX_FILES = 3;
const DEFAULT_BATCH_WINDOW_MS = 200;
const DEFAULT_MAX_QUEUE_SIZE = 2_048;
const GLOBAL_THREAD_SEGMENT = "_global";
const LOG_SCOPE = "provider-observability";

export type EventNdjsonStream = "native" | "canonical" | "orchestration";

export interface EventNdjsonLogger {
  readonly filePath: string;
  write: (event: unknown, threadId: ThreadId | null) => Effect.Effect<void>;
  close: () => Effect.Effect<void>;
}

export interface EventNdjsonLoggerOptions {
  readonly stream: EventNdjsonStream;
  readonly maxBytes?: number;
  readonly maxFiles?: number;
  readonly batchWindowMs?: number;
  readonly maxQueueSize?: number;
}

interface ThreadWriter {
  writeMessage: (message: string) => Effect.Effect<void>;
  close: () => Effect.Effect<void>;
}

interface LoggerState {
  readonly threadWriters: Map<string, ThreadWriter>;
  readonly failedSegments: Set<string>;
}

interface ThreadWriterState {
  readonly buffer: Array<string>;
  timer: ReturnType<typeof setTimeout> | undefined;
  activeFlush: Promise<void> | undefined;
  activeRecords: number;
  closed: boolean;
}

function logWarning(message: string, context: Record<string, unknown>): Effect.Effect<void> {
  return Effect.logWarning(message, context).pipe(Effect.annotateLogs({ scope: LOG_SCOPE }));
}

function resolveThreadSegment(raw: string | null | undefined): string {
  const normalized = typeof raw === "string" ? toSafeThreadAttachmentSegment(raw) : null;
  return normalized ?? GLOBAL_THREAD_SEGMENT;
}

function formatLoggerMessage(message: unknown): string {
  if (Array.isArray(message)) {
    return message.map((part) => (typeof part === "string" ? part : String(part))).join(" ");
  }
  return typeof message === "string" ? message : String(message);
}

function makeLogLine(streamLabel: string, message: string): string {
  return `[${new Date().toISOString()}] ${streamLabel}: ${formatLoggerMessage(message)}\n`;
}

function resolveStreamLabel(stream: EventNdjsonStream): string {
  switch (stream) {
    case "native":
      return "NTIVE";
    case "canonical":
    case "orchestration":
    default:
      return "CANON";
  }
}

const toLogMessage = Effect.fn("toLogMessage")(function* (
  event: unknown,
): Effect.fn.Return<string | undefined> {
  const serialized = yield* Effect.sync(() => {
    try {
      return { ok: true as const, value: JSON.stringify(event) };
    } catch (error) {
      return { ok: false as const, error };
    }
  });

  if (!serialized.ok) {
    yield* logWarning("failed to serialize provider event log record", {
      error: serialized.error,
    });
    return undefined;
  }

  if (typeof serialized.value !== "string") {
    return undefined;
  }

  return serialized.value;
});

const makeThreadWriter = Effect.fn("makeThreadWriter")(function* (input: {
  readonly filePath: string;
  readonly maxBytes: number;
  readonly maxFiles: number;
  readonly batchWindowMs: number;
  readonly maxQueueSize: number;
  readonly stream: EventNdjsonStream;
  readonly streamLabel: string;
}): Effect.fn.Return<ThreadWriter | undefined> {
  const sinkResult = yield* Effect.sync(() => {
    try {
      return {
        ok: true as const,
        sink: new AsyncRotatingFileSink({
          filePath: input.filePath,
          maxBytes: input.maxBytes,
          maxFiles: input.maxFiles,
          throwOnError: true,
        }),
      };
    } catch (error) {
      return { ok: false as const, error };
    }
  });

  if (!sinkResult.ok) {
    yield* logWarning("failed to initialize provider thread log file", {
      filePath: input.filePath,
      error: sinkResult.error,
    });
    return undefined;
  }

  const sink = sinkResult.sink;
  const services = yield* Effect.context();
  const runWarning = (effect: Effect.Effect<void>) => {
    Effect.runForkWith(services)(effect);
  };
  const state: ThreadWriterState = {
    buffer: [],
    timer: undefined,
    activeFlush: undefined,
    activeRecords: 0,
    closed: false,
  };

  const recordDropped = (reason: "queue_closed" | "queue_full") =>
    increment(providerEventLogRecordsDroppedTotal, {
      stream: input.stream,
      reason,
      maxQueueSize: input.maxQueueSize,
    });

  const flushBuffered = (): Promise<void> => {
    if (state.timer !== undefined) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }

    if (state.activeFlush) {
      return state.activeFlush;
    }
    if (state.buffer.length === 0) {
      return sink.flush();
    }

    const messages = state.buffer.splice(0, state.buffer.length);
    state.activeRecords = messages.length;
    let operation: Promise<void>;
    operation = (async () => {
      try {
        for (const message of messages) {
          const startedAt = performance.now();
          await sink.write(message);
          recordResourceAttribution(
            `provider-${input.stream}`,
            "append",
            0,
            Buffer.byteLength(message),
            performance.now() - startedAt,
          );
        }
      } catch (error) {
        runWarning(
          logWarning("provider event log batch flush failed", {
            filePath: input.filePath,
            error,
          }),
        );
      } finally {
        state.activeRecords = 0;
        state.activeFlush = undefined;
        if (!state.closed && state.buffer.length > 0) {
          scheduleFlush();
        }
      }
    })();
    state.activeFlush = operation;
    return operation;
  };

  const scheduleFlush = () => {
    if (state.timer !== undefined) {
      return;
    }

    state.timer = setTimeout(() => {
      void flushBuffered();
    }, input.batchWindowMs);
    if (typeof state.timer === "object" && "unref" in state.timer) {
      state.timer.unref();
    }
  };

  const enqueueLine = (line: string): "queue_closed" | "queue_full" | undefined => {
    if (state.closed) {
      return "queue_closed";
    }

    if (state.buffer.length + state.activeRecords >= input.maxQueueSize) {
      return "queue_full";
    }

    state.buffer.push(line);
    scheduleFlush();
    return undefined;
  };

  const closeAsync = async () => {
    state.closed = true;
    if (state.timer !== undefined) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
    if (state.activeFlush) {
      await state.activeFlush;
    }
    await flushBuffered();
    await sink.flush();
  };

  const flushOnWriteFailure = (error: unknown) =>
    logWarning("provider event log enqueue failed", {
      filePath: input.filePath,
      error,
    });

  const safelyEnqueueLine = (line: string) =>
    Effect.sync(() => {
      try {
        return enqueueLine(line);
      } catch (error) {
        runWarning(flushOnWriteFailure(error));
        return "queue_full" as const;
      }
    });

  const safelyClose = Effect.promise(async () => {
    try {
      await closeAsync();
    } catch (error) {
      runWarning(
        logWarning("provider event log close failed", {
          filePath: input.filePath,
          error,
        }),
      );
    }
  });

  return {
    writeMessage(message: string) {
      return Effect.gen(function* () {
        const droppedReason = yield* safelyEnqueueLine(makeLogLine(input.streamLabel, message));
        if (droppedReason) {
          yield* recordDropped(droppedReason);
        }
      });
    },
    close() {
      return safelyClose;
    },
  } satisfies ThreadWriter;
});

const normalizePositiveInt = (value: number | undefined, fallback: number): number =>
  value === undefined || !Number.isFinite(value) ? fallback : Math.max(1, Math.floor(value));

export const makeEventNdjsonLogger = Effect.fn("makeEventNdjsonLogger")(function* (
  filePath: string,
  options: EventNdjsonLoggerOptions,
): Effect.fn.Return<EventNdjsonLogger | undefined> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const batchWindowMs = options.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS;
  const maxQueueSize = normalizePositiveInt(options.maxQueueSize, DEFAULT_MAX_QUEUE_SIZE);
  const streamLabel = resolveStreamLabel(options.stream);

  const directoryReady = yield* Effect.sync(() => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      return true;
    } catch (error) {
      return { ok: false as const, error };
    }
  });
  if (directoryReady !== true) {
    yield* logWarning("failed to create provider event log directory", {
      filePath,
      error: directoryReady.error,
    });
    return undefined;
  }

  const stateRef = yield* SynchronizedRef.make<LoggerState>({
    threadWriters: new Map(),
    failedSegments: new Set(),
  });

  const resolveThreadWriter = Effect.fn("resolveThreadWriter")(function* (
    threadSegment: string,
  ): Effect.fn.Return<ThreadWriter | undefined> {
    return yield* SynchronizedRef.modifyEffect(stateRef, (state) => {
      if (state.failedSegments.has(threadSegment)) {
        return Effect.succeed([undefined, state] as const);
      }

      const existing = state.threadWriters.get(threadSegment);
      if (existing) {
        return Effect.succeed([existing, state] as const);
      }

      // The native and canonical streams write distinct files. Sharing one
      // path would put two `AsyncRotatingFileSink`s (with independent byte
      // counters) on the same file, interleaving streams and breaking
      // rotation accounting.
      const streamSuffix = options.stream === "native" ? ".native" : "";
      return makeThreadWriter({
        filePath: path.join(path.dirname(filePath), `${threadSegment}${streamSuffix}.log`),
        maxBytes,
        maxFiles,
        batchWindowMs,
        maxQueueSize,
        stream: options.stream,
        streamLabel,
      }).pipe(
        Effect.map((writer) => {
          if (!writer) {
            const nextFailedSegments = new Set(state.failedSegments);
            nextFailedSegments.add(threadSegment);
            return [
              undefined,
              {
                ...state,
                failedSegments: nextFailedSegments,
              },
            ] as const;
          }

          const nextThreadWriters = new Map(state.threadWriters);
          nextThreadWriters.set(threadSegment, writer);
          return [
            writer,
            {
              ...state,
              threadWriters: nextThreadWriters,
            },
          ] as const;
        }),
      );
    });
  });

  const write = Effect.fn("write")(function* (event: unknown, threadId: ThreadId | null) {
    const threadSegment = resolveThreadSegment(threadId);
    const message = yield* toLogMessage(event);
    if (!message) {
      return;
    }

    const writer = yield* resolveThreadWriter(threadSegment);
    if (!writer) {
      return;
    }

    yield* writer.writeMessage(message);
  });

  const close = Effect.fn("close")(function* () {
    yield* SynchronizedRef.modifyEffect(stateRef, (state) =>
      Effect.gen(function* () {
        for (const writer of state.threadWriters.values()) {
          yield* writer.close();
        }

        return [
          undefined,
          {
            threadWriters: new Map<string, ThreadWriter>(),
            failedSegments: new Set<string>(),
          },
        ] as const;
      }),
    );
  });

  return {
    filePath,
    write,
    close,
  } satisfies EventNdjsonLogger;
});
