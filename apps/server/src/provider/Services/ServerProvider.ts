import type { ServerProvider } from "@ryco/contracts";
import type { Effect, Stream } from "effect";
import type { ProviderMaintenanceCapabilities } from "../providerMaintenance.ts";

export interface ServerProviderShape {
  readonly maintenanceCapabilities: ProviderMaintenanceCapabilities;
  readonly getSnapshot: Effect.Effect<ServerProvider>;
  /**
   * Refresh only when the managed snapshot's freshness window has elapsed.
   * Concurrent callers join the same in-flight refresh.
   */
  readonly revalidate: Effect.Effect<ServerProvider>;
  readonly refresh: Effect.Effect<ServerProvider>;
  readonly streamChanges: Stream.Stream<ServerProvider>;
}
