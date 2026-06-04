import { Effect, Metric, Ref } from "effect";

import { metricAttributes } from "./observability/Metrics.ts";

export type WsReplayStreamKind = "shell" | "thread";

export const wsOrchestrationReplayDepth = Metric.gauge("t3_ws_orchestration_replay_depth", {
  description:
    "Current persisted orchestration event replay depth for a replayable WebSocket subscription.",
});

export const wsOrchestrationLiveBufferDepth = Metric.gauge(
  "t3_ws_orchestration_live_buffer_depth",
  {
    description:
      "Current live orchestration event buffer depth for a replayable WebSocket subscription.",
  },
);

export const wsOrchestrationLiveBufferHighWater = Metric.gauge(
  "t3_ws_orchestration_live_buffer_high_water",
  {
    description:
      "Highest observed live orchestration event buffer depth for a replayable WebSocket subscription.",
  },
);

export const wsOrchestrationReplayLag = Metric.gauge("t3_ws_orchestration_replay_lag", {
  description:
    "Sequence lag between the latest live event observed and the latest replay/live event drained by a replayable WebSocket subscription.",
});

export interface WsReplayMetrics {
  readonly recordReplayEvent: (sequence: number) => Effect.Effect<void>;
  readonly recordLiveEnqueued: (sequence: number) => Effect.Effect<void>;
  readonly recordLiveDequeued: (sequence: number) => Effect.Effect<void>;
  readonly reset: Effect.Effect<void>;
}

const normalizeSequence = (sequence: number): number =>
  Number.isFinite(sequence) ? Math.max(0, Math.floor(sequence)) : 0;

const updateGauge = (
  metric: Metric.Metric<number, unknown>,
  attributes: ReadonlyArray<[string, string]>,
  value: number,
) => Metric.update(Metric.withAttributes(metric, attributes), value);

export const makeWsReplayMetrics = (input: {
  readonly stream: WsReplayStreamKind;
  readonly subscriptionId: string;
  readonly snapshotSequence: number;
}): Effect.Effect<WsReplayMetrics> =>
  Effect.gen(function* () {
    const snapshotSequence = normalizeSequence(input.snapshotSequence);
    const attributes = metricAttributes({
      stream: input.stream,
      subscriptionId: input.subscriptionId,
    });
    const latestLiveSequence = yield* Ref.make(snapshotSequence);
    const lastDrainedSequence = yield* Ref.make(snapshotSequence);
    const liveBufferDepth = yield* Ref.make(0);
    const liveBufferHighWater = yield* Ref.make(0);

    const recordLag = Effect.gen(function* () {
      const latest = yield* Ref.get(latestLiveSequence);
      const drained = yield* Ref.get(lastDrainedSequence);
      yield* updateGauge(wsOrchestrationReplayLag, attributes, Math.max(0, latest - drained));
    });

    const recordLiveBuffer = (depth: number, highWater: number) =>
      Effect.all(
        [
          updateGauge(wsOrchestrationLiveBufferDepth, attributes, depth),
          updateGauge(wsOrchestrationLiveBufferHighWater, attributes, highWater),
        ],
        { discard: true },
      );

    yield* Effect.all(
      [
        updateGauge(wsOrchestrationReplayDepth, attributes, 0),
        updateGauge(wsOrchestrationReplayLag, attributes, 0),
        recordLiveBuffer(0, 0),
      ],
      { discard: true },
    );

    const markDrained = (sequence: number) =>
      Ref.update(lastDrainedSequence, (current) =>
        Math.max(current, normalizeSequence(sequence)),
      ).pipe(Effect.andThen(recordLag));

    return {
      recordReplayEvent: (sequence) =>
        Effect.all(
          [
            updateGauge(
              wsOrchestrationReplayDepth,
              attributes,
              Math.max(0, normalizeSequence(sequence) - snapshotSequence),
            ),
            markDrained(sequence),
          ],
          { discard: true },
        ),
      recordLiveEnqueued: (sequence) =>
        Effect.gen(function* () {
          yield* Ref.update(latestLiveSequence, (current) =>
            Math.max(current, normalizeSequence(sequence)),
          );
          const depth = yield* Ref.updateAndGet(liveBufferDepth, (current) => current + 1);
          const highWater = yield* Ref.updateAndGet(liveBufferHighWater, (current) =>
            Math.max(current, depth),
          );
          yield* recordLiveBuffer(depth, highWater);
          yield* recordLag;
        }),
      recordLiveDequeued: (sequence) =>
        Effect.gen(function* () {
          const depth = yield* Ref.updateAndGet(liveBufferDepth, (current) =>
            Math.max(0, current - 1),
          );
          const highWater = yield* Ref.get(liveBufferHighWater);
          yield* recordLiveBuffer(depth, highWater);
          yield* markDrained(sequence);
        }),
      reset: Effect.all(
        [
          updateGauge(wsOrchestrationReplayDepth, attributes, 0),
          updateGauge(wsOrchestrationLiveBufferDepth, attributes, 0),
          updateGauge(wsOrchestrationLiveBufferHighWater, attributes, 0),
          updateGauge(wsOrchestrationReplayLag, attributes, 0),
        ],
        { discard: true },
      ),
    };
  });
