/**
 * ProviderInstanceRegistryHydration — derive a `ProviderInstanceConfigMap`
 * from `ServerSettings` and keep `ProviderInstanceRegistry` in sync with it.
 *
 * The server still reads two shapes:
 *
 *   1. `settings.providerInstances` — the new driver-agnostic map the
 *      registry expects. Keyed by `ProviderInstanceId`, values are
 *      `ProviderInstanceConfig` envelopes.
 *   2. `settings.providers.<kind>` — the legacy single-instance-per-driver
 *      fields (`providers.codex`, `providers.claudeAgent`, …). These are
 *      the source of truth for every deployment that hasn't been migrated
 *      yet to an explicit `providerInstances` entry.
 *
 * This module bridges (2) into (1) and wires the resulting map into a
 * mutable registry. For every built-in driver whose id is not already
 * present in `providerInstances` (keyed on
 * `defaultInstanceIdForDriver(driverKind)` — literally the driver kind as a
 * routing slug), we synthesize an envelope from the legacy field. The
 * registry decodes both flavours through the same `configSchema` and ends
 * up with one uniform `ProviderInstance` per entry.
 *
 * Explicit `providerInstances` entries always win — users can already
 * override the legacy `providers.<kind>` blob by authoring a
 * `providerInstances.codex` entry with a matching driver, and we don't
 * want the synthesized envelope to silently stomp their config.
 *
 * Hot-reload
 * ----------
 * On web/headless layer build we:
 *   1. Read the current `ServerSettings` once and use it to seed the
 *      registry's initial state via `ProviderInstanceRegistryMutableLayer`.
 *   2. Fork a daemon fiber (lifetime tied to the layer's scope) that
 *      subscribes to `ServerSettingsService.streamChanges` and calls
 *      `ProviderInstanceRegistryMutator.reconcile` on every emission.
 *
 * Desktop mode starts with an empty registry and defers the first settings
 * reconcile briefly in a scoped background fiber. The desktop shell already
 * shows a native preload surface, so backend HTTP readiness should not wait
 * on provider SDK imports and driver construction.
 *
 * Failures inside the watcher are logged and swallowed so a single bad
 * settings emission cannot kill the registry. Unknown drivers and invalid
 * configs already round-trip through the registry's own "unavailable"
 * shadow bucket.
 *
 * @module provider/Layers/ProviderInstanceRegistryHydration
 */
import {
  defaultInstanceIdForDriver,
  type ProviderInstanceConfig,
  type ProviderInstanceConfigMap,
  ServerSettings,
} from "@ryco/contracts";
import { Effect, Layer, Ref, Stream } from "effect";
import * as Semaphore from "effect/Semaphore";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { BUILT_IN_DRIVERS, type BuiltInDriversEnv } from "../builtInDrivers.ts";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";
import { ProviderInstanceRegistryMutator } from "../Services/ProviderInstanceRegistryMutator.ts";
import { ProviderInstanceRegistryMutableLayer } from "./ProviderInstanceRegistryLive.ts";

/**
 * Synthesize a `ProviderInstanceConfigMap` from a `ServerSettings` snapshot.
 *
 * Strategy:
 *   1. Copy all explicit `settings.providerInstances` entries verbatim.
 *   2. For each built-in driver whose `defaultInstanceIdForDriver(id)` key
 *      is *not* already in the explicit map, synthesize an entry from the
 *      matching legacy `settings.providers.<kind>` blob.
 *
 * The returned map is the input the registry consumes; pure & exported
 * separately so the hydration logic can be exercised by unit tests
 * without layering.
 */
export const deriveProviderInstanceConfigMap = (
  settings: ServerSettings,
): ProviderInstanceConfigMap => {
  const merged: Record<string, ProviderInstanceConfig> = { ...settings.providerInstances };

  for (const driver of BUILT_IN_DRIVERS) {
    const instanceId = defaultInstanceIdForDriver(driver.driverKind);
    if (instanceId in merged) {
      // Explicit `providerInstances` entry for this slot — user-authored
      // config always wins over the legacy mirror.
      continue;
    }

    // Only built-in drivers have a legacy mirror; the registry's
    // `providers` struct is keyed on the same literal slug as
    // `driverKind`. Access is dynamic (the driver kind is a branded string),
    // but it's constrained to `keyof settings.providers` by the union of
    // built-in driver kinds.
    const legacyKey = driver.driverKind as keyof ServerSettings["providers"];
    const legacyConfig = settings.providers[legacyKey];
    if (legacyConfig === undefined) {
      continue;
    }

    merged[instanceId] = {
      driver: driver.driverKind,
      config: legacyConfig,
    };
  }

  return merged as ProviderInstanceConfigMap;
};

/**
 * Layer that consumes `ProviderInstanceRegistryMutator` and forks a
 * settings-watcher fiber. The fiber's lifetime is tied to the enclosing
 * layer scope (process lifetime in production), so it is interrupted on
 * shutdown without leaking.
 *
 * Errors inside the watcher are logged and swallowed — the registry's own
 * "unavailable" bucket already absorbs unknown drivers and invalid
 * configs, so the only way the watcher could fail is a settings stream
 * tear-down, which logs and exits cleanly.
 */
const SettingsWatcherLive: Layer.Layer<
  never,
  never,
  ProviderInstanceRegistryMutator | ServerSettingsService
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const mutator = yield* ProviderInstanceRegistryMutator;
    const serverSettings = yield* ServerSettingsService;
    yield* serverSettings.streamChanges.pipe(
      Stream.runForEach((next) =>
        mutator
          .reconcile(deriveProviderInstanceConfigMap(next))
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logError("ProviderInstanceRegistry reconcile failed", cause),
            ),
          ),
      ),
      Effect.forkScoped,
    );
  }),
);

const DesktopSettingsReconcileLive: Layer.Layer<
  never,
  never,
  ProviderInstanceRegistryMutator | ServerSettingsService
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const mutator = yield* ProviderInstanceRegistryMutator;
    const serverSettings = yield* ServerSettingsService;
    const watcherVersion = yield* Ref.make(0);
    const reconcileSemaphore = yield* Semaphore.make(1);

    const reconcileLatest = (configMap: ProviderInstanceConfigMap) =>
      reconcileSemaphore.withPermits(1)(mutator.reconcile(configMap));

    yield* serverSettings.streamChanges.pipe(
      Stream.runForEach((next) =>
        Effect.gen(function* () {
          yield* Ref.update(watcherVersion, (version) => version + 1);
          yield* reconcileLatest(deriveProviderInstanceConfigMap(next));
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logError("ProviderInstanceRegistry reconcile failed", cause),
          ),
        ),
      ),
      Effect.forkScoped,
    );

    yield* Effect.gen(function* () {
      yield* Effect.sleep("100 millis");
      const startedAt = Date.now();
      const seedVersion = yield* Ref.get(watcherVersion);
      const initialSettings: ServerSettings | undefined = yield* serverSettings.getSettings.pipe(
        Effect.orElseSucceed(() => undefined),
      );
      const initialConfigMap =
        initialSettings === undefined
          ? ({} as ProviderInstanceConfigMap)
          : deriveProviderInstanceConfigMap(initialSettings);

      const didReconcile = yield* reconcileSemaphore.withPermits(1)(
        Effect.gen(function* () {
          const latestVersion = yield* Ref.get(watcherVersion);
          if (latestVersion !== seedVersion) {
            return false;
          }

          yield* mutator.reconcile(initialConfigMap);
          return true;
        }),
      );

      yield* Effect.logInfo("provider instance registry initial reconcile complete", {
        durationMs: Date.now() - startedAt,
        settingsLoaded: initialSettings !== undefined,
        explicitInstances: Object.keys(initialSettings?.providerInstances ?? {}).length,
        configuredInstances: Object.keys(initialConfigMap).length,
        skippedForNewerWatcherUpdate: !didReconcile,
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("ProviderInstanceRegistry initial reconcile failed", { cause }),
      ),
      Effect.forkScoped,
    );
  }),
);

/**
 * Hydrate `ProviderInstanceRegistry` from `ServerSettings` and keep it in
 * sync with subsequent `streamChanges` emissions.
 *
 * The Layer's two halves:
 *   - `ProviderInstanceRegistryMutableLayer` produces the registry +
 *     mutator from the initial config map. In desktop mode the initial map
 *     is intentionally empty and a sidecar fiber performs the first real
 *     reconcile shortly after HTTP startup can proceed.
 *   - `SettingsWatcherLive` consumes the mutator and runs a daemon fiber
 *     in the same scope.
 *
 * Composing via `Layer.provideMerge` makes the watcher's deps available
 * from the mutable layer while still surfacing the registry as an output.
 * The mutator tag is technically also exposed; only this module imports
 * it, so the visibility leak is harmless in practice.
 */
export const ProviderInstanceRegistryHydrationLive: Layer.Layer<
  ProviderInstanceRegistry,
  never,
  BuiltInDriversEnv | ServerConfig | ServerSettingsService
> = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const serverSettings = yield* ServerSettingsService;
    const initialSettings: ServerSettings | undefined =
      config.mode === "desktop"
        ? undefined
        : yield* serverSettings.getSettings.pipe(Effect.orElseSucceed(() => undefined));
    const initialConfigMap =
      initialSettings === undefined
        ? ({} as ProviderInstanceConfigMap)
        : deriveProviderInstanceConfigMap(initialSettings);
    if (config.mode !== "desktop") {
      yield* Effect.logInfo("provider instance registry hydration config resolved", {
        settingsLoaded: initialSettings !== undefined,
        explicitInstances: Object.keys(initialSettings?.providerInstances ?? {}).length,
        configuredInstances: Object.keys(initialConfigMap).length,
      });
    }

    const mutableLayer = ProviderInstanceRegistryMutableLayer({
      drivers: BUILT_IN_DRIVERS,
      configMap: initialConfigMap,
    });

    const sidecarLayer =
      config.mode === "desktop" ? DesktopSettingsReconcileLive : SettingsWatcherLive;

    return sidecarLayer.pipe(Layer.provideMerge(mutableLayer));
  }),
) as Layer.Layer<
  ProviderInstanceRegistry,
  never,
  BuiltInDriversEnv | ServerConfig | ServerSettingsService
>;
