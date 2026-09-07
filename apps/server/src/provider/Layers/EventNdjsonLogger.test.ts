import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ThreadId } from "@ryco/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Metric } from "effect";

import { getResourceAttribution } from "../../diagnostics/ResourceAttribution.ts";
import { metricNames } from "../../observability/Metrics.ts";
import { hasMetricSnapshot } from "../../observability/testMetricSnapshots.ts";
import { makeEventNdjsonLogger, sweepStaleEventLogs } from "./EventNdjsonLogger.ts";

function parseLogLine(line: string) {
  const match = /^\[([^\]]+)\] ([A-Z]+): (.+)$/.exec(line);
  assert.notEqual(match, null);
  if (!match) {
    throw new Error(`invalid log line: ${line}`);
  }
  const observedAt = match[1];
  const stream = match[2];
  const payload = match[3];
  if (!observedAt || !stream || payload === undefined) {
    throw new Error(`invalid log line: ${line}`);
  }
  return {
    observedAt,
    stream,
    payload,
  };
}

describe("EventNdjsonLogger", () => {
  it.effect("writes effect-style lines to thread-scoped files", () =>
    Effect.gen(function* () {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-provider-log-"));
      const basePath = path.join(tempDir, "provider-native.ndjson");

      try {
        const attributedBefore = getResourceAttribution().find(
          (entry) => entry.component === "provider-native",
        );
        const logger = yield* makeEventNdjsonLogger(basePath, { stream: "native" });
        assert.notEqual(logger, undefined);
        if (!logger) {
          return;
        }

        yield* logger.write(
          { threadId: "provider-thread-1", id: "evt-1" },
          ThreadId.make("thread-1"),
        );
        yield* logger.write(
          { type: "turn.completed", threadId: "provider-thread-2", id: "evt-2" },
          ThreadId.make("thread-2"),
        );
        yield* logger.close();

        const threadOnePath = path.join(tempDir, "thread-1.native.log");
        const threadTwoPath = path.join(tempDir, "thread-2.native.log");
        assert.equal(fs.existsSync(threadOnePath), true);
        assert.equal(fs.existsSync(threadTwoPath), true);
        const attributedAfter = getResourceAttribution().find(
          (entry) => entry.component === "provider-native",
        );
        assert.equal(attributedAfter?.count, (attributedBefore?.count ?? 0) + 2);
        assert.equal(
          (attributedAfter?.logicalWriteBytes ?? 0) - (attributedBefore?.logicalWriteBytes ?? 0),
          fs.statSync(threadOnePath).size + fs.statSync(threadTwoPath).size,
        );

        const first = parseLogLine(fs.readFileSync(threadOnePath, "utf8").trim());
        const second = parseLogLine(fs.readFileSync(threadTwoPath, "utf8").trim());

        assert.equal(Number.isNaN(Date.parse(first.observedAt)), false);
        assert.equal(first.stream, "NTIVE");
        assert.equal(first.payload, '{"threadId":"provider-thread-1","id":"evt-1"}');

        assert.equal(Number.isNaN(Date.parse(second.observedAt)), false);
        assert.equal(second.stream, "NTIVE");
        assert.equal(
          second.payload,
          '{"type":"turn.completed","threadId":"provider-thread-2","id":"evt-2"}',
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }),
  );

  it.effect(
    "falls back to a global segment when orchestration thread id is missing or invalid",
    () =>
      Effect.gen(function* () {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-provider-log-"));
        const basePath = path.join(tempDir, "provider-canonical.ndjson");

        try {
          const logger = yield* makeEventNdjsonLogger(basePath, { stream: "orchestration" });
          assert.notEqual(logger, undefined);
          if (!logger) {
            return;
          }

          yield* logger.write({ id: "evt-no-thread" }, null);
          yield* logger.write({ id: "evt-invalid-thread" }, "!!!" as unknown as ThreadId);
          yield* logger.close();

          const globalPath = path.join(tempDir, "_global.log");
          assert.equal(fs.existsSync(globalPath), true);
          const lines = fs
            .readFileSync(globalPath, "utf8")
            .trim()
            .split("\n")
            .map((line) => parseLogLine(line));
          assert.equal(lines.length, 2);
          assert.equal(Number.isNaN(Date.parse(lines[0]?.observedAt ?? "")), false);
          assert.equal(Number.isNaN(Date.parse(lines[1]?.observedAt ?? "")), false);
          assert.equal(lines[0]?.stream, "CANON");
          assert.equal(lines[0]?.payload, '{"id":"evt-no-thread"}');
          assert.equal(lines[1]?.stream, "CANON");
          assert.equal(lines[1]?.payload, '{"id":"evt-invalid-thread"}');
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      }),
  );

  it.effect("serializes concurrent first writes for the same segment", () =>
    Effect.gen(function* () {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-provider-log-"));
      const basePath = path.join(tempDir, "provider-canonical.ndjson");

      try {
        const logger = yield* makeEventNdjsonLogger(basePath, {
          stream: "canonical",
          batchWindowMs: 0,
        });
        assert.notEqual(logger, undefined);
        if (!logger) {
          return;
        }

        yield* Effect.all(
          [
            logger.write({ id: "evt-concurrent-1" }, null),
            logger.write({ id: "evt-concurrent-2" }, null),
          ],
          { concurrency: "unbounded" },
        );
        yield* logger.close();

        const globalPath = path.join(tempDir, "_global.log");
        assert.equal(fs.existsSync(globalPath), true);
        const lines = fs
          .readFileSync(globalPath, "utf8")
          .trim()
          .split("\n")
          .map((line) => parseLogLine(line));

        assert.equal(lines.length, 2);
        assert.deepEqual(lines.map((line) => line.payload).toSorted(), [
          '{"id":"evt-concurrent-1"}',
          '{"id":"evt-concurrent-2"}',
        ]);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }),
  );

  it.effect("rotates per-thread files when max size is exceeded", () =>
    Effect.gen(function* () {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-provider-log-"));
      const basePath = path.join(tempDir, "provider-native.ndjson");

      try {
        const logger = yield* makeEventNdjsonLogger(basePath, {
          stream: "native",
          maxBytes: 120,
          maxFiles: 2,
        });
        assert.notEqual(logger, undefined);
        if (!logger) {
          return;
        }

        for (let index = 0; index < 10; index += 1) {
          yield* logger.write(
            {
              threadId: "provider-thread-rotate",
              id: `evt-${index}`,
              payload: "x".repeat(40),
            },
            ThreadId.make("thread-rotate"),
          );
        }
        yield* logger.close();

        const fileStem = "thread-rotate.native.log";
        const matchingFiles = fs
          .readdirSync(tempDir)
          .filter((entry) => entry === fileStem || entry.startsWith(`${fileStem}.`))
          .toSorted();

        assert.equal(
          matchingFiles.some((entry) => entry === `${fileStem}.1`),
          true,
        );
        assert.equal(
          matchingFiles.some((entry) => entry === fileStem || entry === `${fileStem}.2`),
          true,
        );
        assert.equal(
          matchingFiles.some((entry) => entry === `${fileStem}.3`),
          false,
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }),
  );

  it.effect("drops and counts records when the bounded logging queue is full", () =>
    Effect.gen(function* () {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "s3-provider-log-"));
      const basePath = path.join(tempDir, "provider-native.ndjson");

      try {
        const logger = yield* makeEventNdjsonLogger(basePath, {
          stream: "native",
          batchWindowMs: 100,
          maxQueueSize: 1,
        });
        assert.notEqual(logger, undefined);
        if (!logger) {
          return;
        }

        const attempts = 200;
        yield* Effect.all(
          Array.from({ length: attempts }, (_, index) =>
            logger.write({ id: `evt-drop-${index}` }, null),
          ),
          { concurrency: "unbounded", discard: true },
        );
        yield* logger.close();

        const snapshots = yield* Metric.snapshot;
        assert.equal(
          hasMetricSnapshot(snapshots, metricNames.providerEventLogRecordsDroppedTotal, {
            stream: "native",
            reason: "queue_full",
            maxQueueSize: "1",
          }),
          true,
        );

        const globalPath = path.join(tempDir, "_global.native.log");
        const lines = fs.existsSync(globalPath)
          ? fs.readFileSync(globalPath, "utf8").trim().split("\n").filter(Boolean)
          : [];
        assert.equal(lines.length < attempts, true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }),
  );
  it.effect("keeps native and canonical streams in separate per-thread files", () =>
    Effect.gen(function* () {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-provider-log-"));
      const basePath = path.join(tempDir, "events.log");

      try {
        const native = yield* makeEventNdjsonLogger(basePath, { stream: "native" });
        const canonical = yield* makeEventNdjsonLogger(basePath, { stream: "canonical" });
        assert.notEqual(native, undefined);
        assert.notEqual(canonical, undefined);
        if (!native || !canonical) {
          return;
        }

        const threadId = ThreadId.make("thread-split");
        yield* native.write({ id: "evt-native" }, threadId);
        yield* canonical.write({ id: "evt-canonical" }, threadId);
        yield* native.close();
        yield* canonical.close();

        const nativeLines = fs
          .readFileSync(path.join(tempDir, "thread-split.native.log"), "utf8")
          .trim()
          .split("\n")
          .map((line) => parseLogLine(line));
        const canonicalLines = fs
          .readFileSync(path.join(tempDir, "thread-split.log"), "utf8")
          .trim()
          .split("\n")
          .map((line) => parseLogLine(line));

        assert.deepEqual(
          nativeLines.map((line) => line.stream),
          ["NTIVE"],
        );
        assert.deepEqual(
          canonicalLines.map((line) => line.stream),
          ["CANON"],
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }),
  );

  it.effect("sweeps stale log files past the retention window", () =>
    Effect.gen(function* () {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-provider-log-"));
      const dayMs = 24 * 60 * 60 * 1000;
      const now = Date.now();

      try {
        const stale = path.join(tempDir, "old-thread.log");
        const staleRotated = path.join(tempDir, "old-thread.log.2");
        const fresh = path.join(tempDir, "fresh-thread.log");
        const unrelated = path.join(tempDir, "notes.txt");
        for (const file of [stale, staleRotated, fresh, unrelated]) {
          fs.writeFileSync(file, "x");
        }
        const staleTime = new Date(now - 40 * dayMs);
        fs.utimesSync(stale, staleTime, staleTime);
        fs.utimesSync(staleRotated, staleTime, staleTime);
        fs.utimesSync(unrelated, staleTime, staleTime);

        const removed = yield* sweepStaleEventLogs(tempDir, { maxAgeMs: 30 * dayMs, now });

        assert.equal(removed, 2);
        assert.equal(fs.existsSync(stale), false);
        assert.equal(fs.existsSync(staleRotated), false);
        assert.equal(fs.existsSync(fresh), true);
        // Non-log files are never touched, stale or not.
        assert.equal(fs.existsSync(unrelated), true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }),
  );

  it.effect("sweep of a missing directory is a no-op", () =>
    Effect.gen(function* () {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-provider-log-"));
      fs.rmSync(tempDir, { recursive: true, force: true });
      const removed = yield* sweepStaleEventLogs(tempDir);
      assert.equal(removed, 0);
    }),
  );
});
