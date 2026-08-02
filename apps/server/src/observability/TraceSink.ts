import { RotatingFileSink } from "@ryco/shared/logging";
import { Effect } from "effect";

import type { TraceRecord } from "./TraceRecord.ts";

const FLUSH_BUFFER_THRESHOLD = 32;
const DEFAULT_MAX_BUFFERED_BYTES = 1024 * 1024;
const DEFAULT_MAX_BUFFERED_RECORDS = 2_048;
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;
const MIN_RETRY_DELAY_MS = 250;

export interface TraceSinkOptions {
  readonly filePath: string;
  readonly maxBytes: number;
  readonly maxFiles: number;
  readonly batchWindowMs: number;
  readonly maxBufferedBytes?: number;
  readonly maxBufferedRecords?: number;
  readonly maxRetryDelayMs?: number;
}

export interface TraceSinkHealth {
  readonly bufferedBytes: number;
  readonly bufferedRecords: number;
  readonly maxBufferedBytes: number;
  readonly maxBufferedRecords: number;
  readonly droppedRecords: number;
  readonly writeFailures: number;
  readonly retryDelayMs: number;
  readonly lastWriteFailureAt: string | null;
}

export interface TraceSink {
  readonly filePath: string;
  push: (record: TraceRecord) => void;
  flush: Effect.Effect<void>;
  close: () => Effect.Effect<void>;
  health: () => TraceSinkHealth;
}

export const makeTraceSink = Effect.fn("makeTraceSink")(function* (options: TraceSinkOptions) {
  const sink = new RotatingFileSink({
    filePath: options.filePath,
    maxBytes: options.maxBytes,
    maxFiles: options.maxFiles,
    throwOnError: true,
  });

  const maxBufferedBytes = Math.max(
    0,
    Math.floor(options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES),
  );
  const maxBufferedRecords = Math.max(
    0,
    Math.floor(options.maxBufferedRecords ?? DEFAULT_MAX_BUFFERED_RECORDS),
  );
  const maxRetryDelayMs = Math.max(
    MIN_RETRY_DELAY_MS,
    Math.floor(options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS),
  );

  let buffer: Array<string> = [];
  let bufferedBytes = 0;
  let droppedRecords = 0;
  let writeFailures = 0;
  let retryDelayMs = 0;
  let lastWriteFailureAt: string | null = null;
  let flushTimeoutId: ReturnType<typeof setTimeout> | null = null;

  const clearScheduledFlush = () => {
    if (flushTimeoutId === null) {
      return;
    }

    clearTimeout(flushTimeoutId);
    flushTimeoutId = null;
  };

  const scheduleFlush = (delayMs: number) => {
    if (buffer.length === 0 || flushTimeoutId !== null) {
      return;
    }

    flushTimeoutId = setTimeout(() => {
      flushTimeoutId = null;
      flushUnsafe();
    }, delayMs);
    flushTimeoutId.unref?.();
  };

  const flushUnsafe = (flushOptions?: { readonly scheduleRetry?: boolean }) => {
    clearScheduledFlush();

    if (buffer.length === 0) {
      return;
    }

    const pendingRecords = buffer;
    const pendingBytes = bufferedBytes;
    const chunk = pendingRecords.join("");
    buffer = [];
    bufferedBytes = 0;

    try {
      sink.write(chunk);
      retryDelayMs = 0;
    } catch {
      buffer = pendingRecords.concat(buffer);
      bufferedBytes += pendingBytes;
      writeFailures += 1;
      lastWriteFailureAt = new Date().toISOString();
      retryDelayMs = Math.min(
        maxRetryDelayMs,
        retryDelayMs === 0 ? Math.max(MIN_RETRY_DELAY_MS, options.batchWindowMs) : retryDelayMs * 2,
      );
      if (flushOptions?.scheduleRetry !== false) {
        scheduleFlush(retryDelayMs);
      }
    }
  };

  const flush = Effect.sync(() => flushUnsafe()).pipe(Effect.withTracerEnabled(false));
  const close = Effect.sync(() => flushUnsafe({ scheduleRetry: false })).pipe(
    Effect.withTracerEnabled(false),
  );

  yield* Effect.addFinalizer(() =>
    Effect.sync(clearScheduledFlush).pipe(Effect.andThen(close), Effect.ignore),
  );

  return {
    filePath: options.filePath,
    push(record) {
      try {
        const serialized = `${JSON.stringify(record)}\n`;
        const serializedBytes = Buffer.byteLength(serialized);

        if (
          serializedBytes > maxBufferedBytes ||
          maxBufferedBytes === 0 ||
          maxBufferedRecords === 0
        ) {
          droppedRecords += 1;
          return;
        }

        while (
          buffer.length > 0 &&
          (bufferedBytes + serializedBytes > maxBufferedBytes ||
            buffer.length >= maxBufferedRecords)
        ) {
          const dropped = buffer.shift();
          if (dropped !== undefined) {
            bufferedBytes -= Buffer.byteLength(dropped);
            droppedRecords += 1;
          }
        }

        buffer.push(serialized);
        bufferedBytes += serializedBytes;
        if (retryDelayMs > 0) {
          scheduleFlush(retryDelayMs);
          return;
        }
        if (buffer.length >= FLUSH_BUFFER_THRESHOLD) {
          flushUnsafe();
          return;
        }
        if (options.batchWindowMs <= 0) {
          flushUnsafe();
          return;
        }
        scheduleFlush(options.batchWindowMs);
      } catch {
        droppedRecords += 1;
        return;
      }
    },
    flush,
    close: () => close,
    health: () => ({
      bufferedBytes,
      bufferedRecords: buffer.length,
      maxBufferedBytes,
      maxBufferedRecords,
      droppedRecords,
      writeFailures,
      retryDelayMs,
      lastWriteFailureAt,
    }),
  } satisfies TraceSink;
});
