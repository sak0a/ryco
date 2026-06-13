import { Effect, Metric, Ref } from "effect";

import {
  metricAttributes,
  runtimeQueueDequeuesTotal,
  runtimeQueueDepth,
  runtimeQueueEnqueuesTotal,
  runtimeQueueHighWater,
} from "./Metrics.ts";

export interface ServerQueueMetrics {
  readonly recordEnqueued: (amount?: number) => Effect.Effect<void, never, never>;
  readonly recordDequeued: (amount?: number) => Effect.Effect<void, never, never>;
  readonly reset: Effect.Effect<void, never, never>;
}

const normalizeAmount = (amount: number | undefined): number => {
  if (amount === undefined) return 1;
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.floor(amount));
};

const updateGauge = (
  metric: Metric.Metric<number, unknown>,
  attributes: ReadonlyArray<[string, string]>,
  value: number,
): Effect.Effect<void, never, never> =>
  Metric.update(Metric.withAttributes(metric, attributes), value) as Effect.Effect<
    void,
    never,
    never
  >;

export const makeServerQueueMetrics = (
  attributes: Readonly<Record<string, unknown>>,
): Effect.Effect<ServerQueueMetrics, never, never> =>
  Effect.gen(function* () {
    const metricAttrs = metricAttributes(attributes);
    const depthRef = yield* Ref.make(0);
    const highWaterRef = yield* Ref.make(0);

    const recordDepth = (depth: number, highWater: number): Effect.Effect<void, never, never> =>
      Effect.all(
        [
          updateGauge(runtimeQueueDepth, metricAttrs, depth),
          updateGauge(runtimeQueueHighWater, metricAttrs, highWater),
        ],
        { discard: true },
      ) as Effect.Effect<void, never, never>;

    yield* recordDepth(0, 0);

    return {
      recordEnqueued: (amount): Effect.Effect<void, never, never> =>
        Effect.gen(function* () {
          const normalizedAmount = normalizeAmount(amount);
          if (normalizedAmount === 0) return;
          yield* Metric.update(
            Metric.withAttributes(runtimeQueueEnqueuesTotal, metricAttrs),
            normalizedAmount,
          );
          const depth = yield* Ref.updateAndGet(depthRef, (current) => current + normalizedAmount);
          const highWater = yield* Ref.updateAndGet(highWaterRef, (current) =>
            Math.max(current, depth),
          );
          yield* recordDepth(depth, highWater);
        }) as Effect.Effect<void, never, never>,
      recordDequeued: (amount): Effect.Effect<void, never, never> =>
        Effect.gen(function* () {
          const normalizedAmount = normalizeAmount(amount);
          if (normalizedAmount === 0) return;
          yield* Metric.update(
            Metric.withAttributes(runtimeQueueDequeuesTotal, metricAttrs),
            normalizedAmount,
          );
          const depth = yield* Ref.updateAndGet(depthRef, (current) =>
            Math.max(0, current - normalizedAmount),
          );
          const highWater = yield* Ref.get(highWaterRef);
          yield* recordDepth(depth, highWater);
        }) as Effect.Effect<void, never, never>,
      reset: Effect.gen(function* () {
        yield* Ref.set(depthRef, 0);
        yield* Ref.set(highWaterRef, 0);
        yield* recordDepth(0, 0);
      }) as Effect.Effect<void, never, never>,
    };
  }) as Effect.Effect<ServerQueueMetrics, never, never>;
