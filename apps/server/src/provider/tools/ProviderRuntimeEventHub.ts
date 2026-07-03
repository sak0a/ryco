import type { ProviderRuntimeEvent } from "@ryco/contracts";
import { Context, Effect, Layer, PubSub, Stream } from "effect";

export interface ProviderRuntimeEventHubShape {
  readonly publish: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly stream: Stream.Stream<ProviderRuntimeEvent>;
}

export class ProviderRuntimeEventHub extends Context.Service<
  ProviderRuntimeEventHub,
  ProviderRuntimeEventHubShape
>()("ryco/provider/tools/ProviderRuntimeEventHub") {}

export const ProviderRuntimeEventHubLive = Layer.effect(
  ProviderRuntimeEventHub,
  Effect.gen(function* () {
    const pubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    return {
      publish: (event) => PubSub.publish(pubSub, event).pipe(Effect.asVoid),
      stream: Stream.fromPubSub(pubSub),
    } satisfies ProviderRuntimeEventHubShape;
  }),
);
