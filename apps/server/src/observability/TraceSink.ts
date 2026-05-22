import { RotatingFileSink } from "@ryco/shared/logging";
import { Effect } from "effect";

import type { TraceRecord } from "./TraceRecord.ts";

const FLUSH_BUFFER_THRESHOLD = 32;

export interface TraceSinkOptions {
  readonly filePath: string;
  readonly maxBytes: number;
  readonly maxFiles: number;
  readonly batchWindowMs: number;
}

export interface TraceSink {
  readonly filePath: string;
  push: (record: TraceRecord) => void;
  flush: Effect.Effect<void>;
  close: () => Effect.Effect<void>;
}

export const makeTraceSink = Effect.fn("makeTraceSink")(function* (options: TraceSinkOptions) {
  const sink = new RotatingFileSink({
    filePath: options.filePath,
    maxBytes: options.maxBytes,
    maxFiles: options.maxFiles,
  });

  let buffer: Array<string> = [];
  let flushTimeoutId: ReturnType<typeof setTimeout> | null = null;

  const clearScheduledFlush = () => {
    if (flushTimeoutId === null) {
      return;
    }

    clearTimeout(flushTimeoutId);
    flushTimeoutId = null;
  };

  const flushUnsafe = () => {
    clearScheduledFlush();

    if (buffer.length === 0) {
      return;
    }

    const chunk = buffer.join("");
    buffer = [];

    try {
      sink.write(chunk);
    } catch {
      buffer.unshift(chunk);
    }
  };

  const scheduleFlush = () => {
    if (buffer.length === 0 || flushTimeoutId !== null) {
      return;
    }

    if (options.batchWindowMs <= 0) {
      flushUnsafe();
      return;
    }

    flushTimeoutId = setTimeout(() => {
      flushTimeoutId = null;
      flushUnsafe();
    }, options.batchWindowMs);
    flushTimeoutId.unref?.();
  };

  const flush = Effect.sync(flushUnsafe).pipe(Effect.withTracerEnabled(false));

  yield* Effect.addFinalizer(() =>
    Effect.sync(clearScheduledFlush).pipe(Effect.andThen(flush), Effect.ignore),
  );

  return {
    filePath: options.filePath,
    push(record) {
      try {
        buffer.push(`${JSON.stringify(record)}\n`);
        if (buffer.length >= FLUSH_BUFFER_THRESHOLD) {
          flushUnsafe();
          return;
        }
        scheduleFlush();
      } catch {
        return;
      }
    },
    flush,
    close: () => flush,
  } satisfies TraceSink;
});
