import { Effect, Context, Layer } from "effect";
import type { DetectedServer, DetectedServerEvent } from "@ryco/contracts";
import { Registry, type RegistryRegisterInput } from "../Layers/Registry.ts";

export interface DetectedServerRegistryShape {
  readonly registerOrUpdate: (input: RegistryRegisterInput) => Effect.Effect<DetectedServer>;
  readonly publishLog: (serverId: string, data: string) => Effect.Effect<void>;
  readonly remove: (serverId: string) => Effect.Effect<void>;
  readonly subscribe: (
    threadId: string,
    listener: (e: DetectedServerEvent) => void,
  ) => Effect.Effect<() => void>;
  readonly getCurrent: (threadId: string) => Effect.Effect<ReadonlyArray<DetectedServer>>;
  readonly findById: (serverId: string) => Effect.Effect<DetectedServer | undefined>;
}

export class DetectedServerRegistry extends Context.Service<
  DetectedServerRegistry,
  DetectedServerRegistryShape
>()("s3/detectedServers/Services/DetectedServerRegistry") {}

export const DetectedServerRegistryLive = Layer.succeed(
  DetectedServerRegistry,
  (() => {
    const r = new Registry();
    return {
      registerOrUpdate: (input) => Effect.sync(() => r.registerOrUpdate(input)),
      publishLog: (id, data) => Effect.sync(() => r.publishLog(id, data)),
      remove: (id) => Effect.sync(() => r.remove(id)),
      subscribe: (tid, listener) => Effect.sync(() => r.subscribe(tid, listener)),
      getCurrent: (tid) => Effect.sync(() => r.getCurrent(tid)),
      findById: (id) => Effect.sync(() => r.findById(id)),
    };
  })(),
);
