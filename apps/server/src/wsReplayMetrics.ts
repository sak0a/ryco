import { Effect, Metric, Ref } from "effect";

import { metricAttributes } from "./observability/Metrics.ts";

export type WsReplayStreamKind = "shell" | "thread";

export const wsReplayMetricNames = {
  replayDepth: "t3_ws_orchestration_replay_depth",
  liveBufferDepth: "t3_ws_orchestration_live_buffer_depth",
  liveBufferHighWater: "t3_ws_orchestration_live_buffer_high_water",
  liveBufferOverflowsTotal: "t3_ws_orchestration_live_buffer_overflows_total",
  replayLag: "t3_ws_orchestration_replay_lag",
} as const;

export const wsOrchestrationReplayDepth = Metric.gauge(wsReplayMetricNames.replayDepth, {
  description:
    "Current persisted orchestration event replay depth for a replayable WebSocket subscription.",
});

export const wsOrchestrationLiveBufferDepth = Metric.gauge(wsReplayMetricNames.liveBufferDepth, {
  description:
    "Current live orchestration event buffer depth for a replayable WebSocket subscription.",
});

export const wsOrchestrationLiveBufferHighWater = Metric.gauge(
  wsReplayMetricNames.liveBufferHighWater,
  {
    description:
      "Highest observed live orchestration event buffer depth for a replayable WebSocket subscription.",
  },
);

export const wsOrchestrationLiveBufferOverflowsTotal = Metric.counter(
  wsReplayMetricNames.liveBufferOverflowsTotal,
  {
    description:
      "Total live orchestration event buffer overflows that forced replayable WebSocket subscription resync.",
    incremental: true,
  },
);

export const wsOrchestrationReplayLag = Metric.gauge(wsReplayMetricNames.replayLag, {
  description:
    "Sequence lag between the latest live event observed and the latest replay/live event drained by a replayable WebSocket subscription.",
});

export interface WsReplayMetrics {
  readonly recordReplayEvent: (sequence: number) => Effect.Effect<void>;
  readonly recordLiveEnqueued: (sequence: number) => Effect.Effect<void>;
  readonly recordLiveDequeued: (sequence: number) => Effect.Effect<void>;
  readonly recordLiveOverflow: (sequence: number, capacity: number) => Effect.Effect<void>;
  readonly reset: Effect.Effect<void>;
}

interface ActiveReplayMetricState {
  readonly stream: WsReplayStreamKind;
  readonly replayDepth: Ref.Ref<number>;
  readonly latestLiveSequence: Ref.Ref<number>;
  readonly lastDrainedSequence: Ref.Ref<number>;
  readonly liveBufferDepth: Ref.Ref<number>;
  readonly liveBufferHighWater: Ref.Ref<number>;
}

// Only active subscriptions live here. Published metric labels are limited to
// the two stream kinds, so reconnects cannot grow the global metric registry.
const activeReplayMetricStates = new Map<string, ActiveReplayMetricState>();

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
    const attributes = metricAttributes({ stream: input.stream });
    const replayDepth = yield* Ref.make(0);
    const latestLiveSequence = yield* Ref.make(snapshotSequence);
    const lastDrainedSequence = yield* Ref.make(snapshotSequence);
    const liveBufferDepth = yield* Ref.make(0);
    const liveBufferHighWater = yield* Ref.make(0);

    const state = {
      stream: input.stream,
      replayDepth,
      latestLiveSequence,
      lastDrainedSequence,
      liveBufferDepth,
      liveBufferHighWater,
    } satisfies ActiveReplayMetricState;
    activeReplayMetricStates.set(input.subscriptionId, state);

    const publishAggregate = Effect.gen(function* () {
      const activeStates = [...activeReplayMetricStates.values()].filter(
        (candidate) => candidate.stream === input.stream,
      );
      const values = yield* Effect.forEach(activeStates, (candidate) =>
        Effect.all({
          replayDepth: Ref.get(candidate.replayDepth),
          latestLiveSequence: Ref.get(candidate.latestLiveSequence),
          lastDrainedSequence: Ref.get(candidate.lastDrainedSequence),
          liveBufferDepth: Ref.get(candidate.liveBufferDepth),
          liveBufferHighWater: Ref.get(candidate.liveBufferHighWater),
        }),
      );
      const liveDepthTotal = values.reduce((total, value) => total + value.liveBufferDepth, 0);
      const replayDepthMax = values.reduce(
        (largest, value) => Math.max(largest, value.replayDepth),
        0,
      );
      const liveHighWaterMax = values.reduce(
        (largest, value) => Math.max(largest, value.liveBufferHighWater),
        0,
      );
      const replayLagMax = values.reduce(
        (largest, value) =>
          Math.max(largest, Math.max(0, value.latestLiveSequence - value.lastDrainedSequence)),
        0,
      );

      yield* Effect.all(
        [
          updateGauge(wsOrchestrationReplayDepth, attributes, replayDepthMax),
          updateGauge(wsOrchestrationReplayLag, attributes, replayLagMax),
          updateGauge(wsOrchestrationLiveBufferDepth, attributes, liveDepthTotal),
          updateGauge(wsOrchestrationLiveBufferHighWater, attributes, liveHighWaterMax),
        ],
        { discard: true },
      );
    });

    yield* publishAggregate;

    const markDrained = (sequence: number) =>
      Ref.update(lastDrainedSequence, (current) =>
        Math.max(current, normalizeSequence(sequence)),
      ).pipe(Effect.andThen(publishAggregate));

    return {
      recordReplayEvent: (sequence) =>
        Ref.set(replayDepth, Math.max(0, normalizeSequence(sequence) - snapshotSequence)).pipe(
          Effect.andThen(markDrained(sequence)),
        ),
      recordLiveEnqueued: (sequence) =>
        Effect.gen(function* () {
          yield* Ref.update(latestLiveSequence, (current) =>
            Math.max(current, normalizeSequence(sequence)),
          );
          const depth = yield* Ref.updateAndGet(liveBufferDepth, (current) => current + 1);
          yield* Ref.updateAndGet(liveBufferHighWater, (current) => Math.max(current, depth));
          yield* publishAggregate;
        }),
      recordLiveDequeued: (sequence) =>
        Effect.gen(function* () {
          yield* Ref.updateAndGet(liveBufferDepth, (current) => Math.max(0, current - 1));
          yield* markDrained(sequence);
        }),
      recordLiveOverflow: (sequence, capacity) =>
        Effect.gen(function* () {
          const normalizedSequence = normalizeSequence(sequence);
          const normalizedCapacity = Math.max(0, Math.floor(capacity));
          yield* Ref.update(latestLiveSequence, (current) => Math.max(current, normalizedSequence));
          yield* Ref.set(liveBufferDepth, normalizedCapacity);
          yield* Ref.updateAndGet(liveBufferHighWater, (current) =>
            Math.max(current, normalizedCapacity),
          );
          yield* Effect.all(
            [updateGauge(wsOrchestrationLiveBufferOverflowsTotal, attributes, 1), publishAggregate],
            { discard: true },
          );
        }),
      reset: Effect.sync(() => {
        if (activeReplayMetricStates.get(input.subscriptionId) === state) {
          activeReplayMetricStates.delete(input.subscriptionId);
        }
      }).pipe(Effect.andThen(publishAggregate)),
    };
  });
