import type { EnvironmentId } from "@ryco/contracts";
import { Atom } from "effect/unstable/reactivity";

import { appAtomRegistry } from "./atomRegistry.ts";

export const KEY_SEP = "\u0000";
export const NOOP: () => void = () => undefined;

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export interface KeyedQueryControllerBase {
  readonly compositeKey: string;
  readonly environmentId: EnvironmentId;
  readonly family: string;
  readonly staleTime: number;
  readonly gcTime: number;
  readonly run: () => Promise<unknown>;
  subscriberCount: number;
  lastFetchedAt: number;
  lastAccessedAt: number;
  fetchToken: number;
  hasData: boolean;
  inFlightPromise: Promise<void> | null;
  gcTimer: ReturnType<typeof setTimeout> | null;
}

export interface KeyedQueryRegistryConfig<TState> {
  readonly labelPrefix: string;
  readonly initialState: TState;
  readonly buildFetchingState: (current: TState) => TState;
  readonly buildSuccessState: (data: unknown) => TState;
  readonly buildErrorState: (current: TState, error: Error) => TState;
  readonly selectPollData?: (state: TState) => unknown;
  readonly gcTime?: number;
  readonly maxEntries?: number;
  readonly onRunStart?: (controller: KeyedQueryControllerBase & Record<string, unknown>) => void;
  readonly onRunEnd?: (
    controller: KeyedQueryControllerBase & Record<string, unknown>,
    outcome: "success" | "error",
  ) => void;
  readonly shouldFetchOnWatch?: (
    controller: KeyedQueryControllerBase & Record<string, unknown>,
  ) => boolean;
}

export interface KeyedQueryRegistry<TState> {
  readonly KEY_SEP: typeof KEY_SEP;
  readonly knownStateKeys: Set<string>;
  readonly controllers: Map<string, KeyedQueryControllerBase & Record<string, unknown>>;
  readonly queryStateAtom: (compositeKey: string) => Atom.Atom<TState>;
  readonly EMPTY_QUERY_ATOM: Atom.Atom<TState>;
  readonly initialState: TState;
  readonly defaultGcTime: number;
  registerController(controller: KeyedQueryControllerBase & Record<string, unknown>): void;
  setQueryState(compositeKey: string, next: TState): void;
  getQueryState(compositeKey: string): TState;
  runController(controller: KeyedQueryControllerBase & Record<string, unknown>): Promise<void>;
  schedulePoll(controller: KeyedQueryControllerBase & Record<string, unknown>): void;
  clearPollTimer(controller: KeyedQueryControllerBase & Record<string, unknown>): void;
  touch(controller: KeyedQueryControllerBase & Record<string, unknown>): void;
  cancel(controller: KeyedQueryControllerBase & Record<string, unknown>): void;
  scheduleGc(controller: KeyedQueryControllerBase & Record<string, unknown>): void;
  evict(compositeKey: string): boolean;
  controllerKeys(filters?: {
    readonly environmentId?: EnvironmentId;
    readonly family?: string;
  }): ReadonlySet<string>;
  clearEnvironment(environmentId: EnvironmentId): void;
  resetForTests(): void;
}

interface KeyedQueryEnvironmentCleanup {
  clearEnvironment(environmentId: EnvironmentId): void;
}

const keyedQueryEnvironmentCleanups = new Set<KeyedQueryEnvironmentCleanup>();

export function clearKeyedQueriesForEnvironment(environmentId: EnvironmentId): void {
  for (const cleanup of keyedQueryEnvironmentCleanups) cleanup.clearEnvironment(environmentId);
}

export function createKeyedQueryRegistry<TState>(
  config: KeyedQueryRegistryConfig<TState>,
): KeyedQueryRegistry<TState> {
  const defaultGcTime = Math.max(0, config.gcTime ?? 5 * 60_000);
  const maxEntries = Math.max(1, Math.floor(config.maxEntries ?? 256));
  const knownStateKeys = new Set<string>();
  const controllers = new Map<string, KeyedQueryControllerBase & Record<string, unknown>>();
  const controllerKeysByEnvironment = new Map<EnvironmentId, Set<string>>();
  const controllerKeysByFamily = new Map<string, Set<string>>();

  const queryStateAtom = Atom.family((compositeKey: string) => {
    knownStateKeys.add(compositeKey);
    return Atom.make<TState>(config.initialState).pipe(
      Atom.setIdleTTL(defaultGcTime),
      Atom.withLabel(`${config.labelPrefix}:${compositeKey}`),
    );
  });

  const EMPTY_QUERY_ATOM = Atom.make<TState>(config.initialState).pipe(
    Atom.keepAlive,
    Atom.withLabel(`${config.labelPrefix}:null`),
  );

  function setQueryState(compositeKey: string, next: TState): void {
    appAtomRegistry.set(queryStateAtom(compositeKey), next);
  }

  function getQueryState(compositeKey: string): TState {
    return appAtomRegistry.get(queryStateAtom(compositeKey));
  }

  function clearControllerGcTimer(
    controller: KeyedQueryControllerBase & Record<string, unknown>,
  ): void {
    if (controller.gcTimer !== null) {
      clearTimeout(controller.gcTimer);
      controller.gcTimer = null;
    }
  }

  function removeIndexValue<K>(index: Map<K, Set<string>>, key: K, compositeKey: string): void {
    const keys = index.get(key);
    if (!keys) return;
    keys.delete(compositeKey);
    if (keys.size === 0) index.delete(key);
  }

  function evict(compositeKey: string): boolean {
    const controller = controllers.get(compositeKey);
    if (!controller || controller.subscriberCount > 0 || controller.inFlightPromise !== null) {
      return false;
    }
    clearControllerPollTimer(controller);
    clearControllerGcTimer(controller);
    controller.fetchToken += 1;
    controllers.delete(compositeKey);
    removeIndexValue(controllerKeysByEnvironment, controller.environmentId, compositeKey);
    removeIndexValue(controllerKeysByFamily, controller.family, compositeKey);
    if (knownStateKeys.delete(compositeKey)) {
      appAtomRegistry.set(queryStateAtom(compositeKey), config.initialState);
    }
    return true;
  }

  function evictToCapacity(): void {
    if (controllers.size <= maxEntries) return;
    const candidates = [...controllers.values()]
      .filter(
        (controller) => controller.subscriberCount === 0 && controller.inFlightPromise === null,
      )
      .toSorted((left, right) => left.lastAccessedAt - right.lastAccessedAt);
    for (const controller of candidates) {
      if (controllers.size <= maxEntries) break;
      evict(controller.compositeKey);
    }
  }

  function scheduleControllerGc(
    controller: KeyedQueryControllerBase & Record<string, unknown>,
  ): void {
    clearControllerGcTimer(controller);
    if (controller.subscriberCount > 0 || controller.inFlightPromise !== null) return;
    if (controller.gcTime === 0) {
      evict(controller.compositeKey);
      return;
    }
    controller.gcTimer = setTimeout(() => {
      controller.gcTimer = null;
      evict(controller.compositeKey);
    }, controller.gcTime);
  }

  function touchController(controller: KeyedQueryControllerBase & Record<string, unknown>): void {
    controller.lastAccessedAt = Date.now();
    clearControllerGcTimer(controller);
  }

  function registerController(
    controller: KeyedQueryControllerBase & Record<string, unknown>,
  ): void {
    controllers.set(controller.compositeKey, controller);
    const environmentKeys = controllerKeysByEnvironment.get(controller.environmentId) ?? new Set();
    environmentKeys.add(controller.compositeKey);
    controllerKeysByEnvironment.set(controller.environmentId, environmentKeys);
    const familyKeys = controllerKeysByFamily.get(controller.family) ?? new Set();
    familyKeys.add(controller.compositeKey);
    controllerKeysByFamily.set(controller.family, familyKeys);
    evictToCapacity();
  }

  function controllerKeys(filters?: {
    readonly environmentId?: EnvironmentId;
    readonly family?: string;
  }): ReadonlySet<string> {
    const byEnvironment = filters?.environmentId
      ? controllerKeysByEnvironment.get(filters.environmentId)
      : undefined;
    const byFamily = filters?.family ? controllerKeysByFamily.get(filters.family) : undefined;
    if (filters?.environmentId && !byEnvironment) return new Set();
    if (filters?.family && !byFamily) return new Set();
    if (byEnvironment && byFamily) {
      const smaller = byEnvironment.size <= byFamily.size ? byEnvironment : byFamily;
      const larger = smaller === byEnvironment ? byFamily : byEnvironment;
      return new Set([...smaller].filter((key) => larger.has(key)));
    }
    return new Set(byEnvironment ?? byFamily ?? controllers.keys());
  }

  async function runController(
    controller: KeyedQueryControllerBase & Record<string, unknown>,
  ): Promise<void> {
    if (controller.inFlightPromise) return controller.inFlightPromise;
    touchController(controller);
    const token = ++controller.fetchToken;
    const promise = (async () => {
      config.onRunStart?.(controller);
      const current = getQueryState(controller.compositeKey);
      setQueryState(controller.compositeKey, config.buildFetchingState(current));

      try {
        const data = await controller.run();
        if (
          token !== controller.fetchToken ||
          controllers.get(controller.compositeKey) !== controller
        ) {
          return;
        }
        config.onRunEnd?.(controller, "success");
        controller.hasData = true;
        controller.lastFetchedAt = Date.now();
        setQueryState(controller.compositeKey, config.buildSuccessState(data));
      } catch (error) {
        if (
          token !== controller.fetchToken ||
          controllers.get(controller.compositeKey) !== controller
        ) {
          return;
        }
        config.onRunEnd?.(controller, "error");
        setQueryState(
          controller.compositeKey,
          config.buildErrorState(getQueryState(controller.compositeKey), toError(error)),
        );
      }
    })();
    controller.inFlightPromise = promise;
    try {
      await promise;
    } finally {
      const isCurrentRun = controller.inFlightPromise === promise;
      if (isCurrentRun) controller.inFlightPromise = null;
      if (isCurrentRun && controllers.get(controller.compositeKey) === controller) {
        scheduleControllerPoll(controller);
        scheduleControllerGc(controller);
        evictToCapacity();
      }
    }
  }

  function cancelController(controller: KeyedQueryControllerBase & Record<string, unknown>): void {
    clearControllerPollTimer(controller);
    controller.fetchToken += 1;
    controller.inFlightPromise = null;
  }

  function clearControllerPollTimer(
    controller: KeyedQueryControllerBase & Record<string, unknown>,
  ): void {
    const timer = controller.pollTimer as ReturnType<typeof setTimeout> | null | undefined;
    if (timer !== null && timer !== undefined) {
      clearTimeout(timer);
      controller.pollTimer = null;
    }
  }

  function scheduleControllerPoll(
    controller: KeyedQueryControllerBase & Record<string, unknown>,
  ): void {
    clearControllerPollTimer(controller);
    if (controller.subscriberCount <= 0) {
      return;
    }
    const resolveIntervalMs = controller.resolveIntervalMs as
      | ((data: unknown) => number | false)
      | null
      | undefined;
    if (!resolveIntervalMs) {
      return;
    }
    const state = getQueryState(controller.compositeKey);
    const interval = resolveIntervalMs(
      config.selectPollData ? config.selectPollData(state) : state,
    );
    if (interval === false || interval <= 0) {
      return;
    }
    controller.pollTimer = setTimeout(() => {
      controller.pollTimer = null;
      void runController(controller);
    }, interval);
  }

  function resetForTests(): void {
    for (const controller of controllers.values()) {
      clearControllerPollTimer(controller);
      clearControllerGcTimer(controller);
      controller.fetchToken += 1;
    }
    controllers.clear();
    controllerKeysByEnvironment.clear();
    controllerKeysByFamily.clear();
    for (const compositeKey of knownStateKeys) {
      appAtomRegistry.set(queryStateAtom(compositeKey), config.initialState);
    }
    knownStateKeys.clear();
  }

  function clearEnvironment(environmentId: EnvironmentId): void {
    const removedKeys = new Set<string>();
    for (const compositeKey of controllerKeys({ environmentId })) {
      const controller = controllers.get(compositeKey);
      if (!controller) continue;
      clearControllerPollTimer(controller);
      clearControllerGcTimer(controller);
      controller.fetchToken += 1;
      controllers.delete(compositeKey);
      removeIndexValue(controllerKeysByFamily, controller.family, compositeKey);
      removedKeys.add(compositeKey);
    }
    controllerKeysByEnvironment.delete(environmentId);
    for (const compositeKey of knownStateKeys) {
      if (
        !removedKeys.has(compositeKey) &&
        !compositeKey.startsWith(`${environmentId}${KEY_SEP}`)
      ) {
        continue;
      }
      appAtomRegistry.set(queryStateAtom(compositeKey), config.initialState);
      knownStateKeys.delete(compositeKey);
    }
  }

  const registry: KeyedQueryRegistry<TState> = {
    KEY_SEP,
    knownStateKeys,
    controllers,
    queryStateAtom,
    EMPTY_QUERY_ATOM,
    initialState: config.initialState,
    defaultGcTime,
    registerController,
    setQueryState,
    getQueryState,
    runController,
    schedulePoll: scheduleControllerPoll,
    clearPollTimer: clearControllerPollTimer,
    touch: touchController,
    cancel: cancelController,
    scheduleGc: scheduleControllerGc,
    evict,
    controllerKeys,
    clearEnvironment,
    resetForTests,
  };
  keyedQueryEnvironmentCleanups.add(registry);
  return registry;
}

interface KeyedQueryDefinition<TInput, TData, TControllerFields extends Record<string, unknown>> {
  readonly label: string;
  readonly staleTime: number;
  readonly gcTime?: number;
  readonly isEnabled: (input: TInput) => boolean;
  readonly buildKey: (input: TInput) => string;
  readonly resolveEnvironmentId: (input: TInput) => EnvironmentId;
  readonly createControllerFields: (input: TInput) => TControllerFields;
  readonly run: (input: TInput) => Promise<TData>;
}

export interface KeyedQueryByKey<TInput, _TData, TState> {
  readonly keyOf: (input: TInput) => string | null;
  readonly watch: (input: TInput) => () => void;
  readonly refresh: (compositeKey: string | null) => void;
  readonly refreshAsync: (compositeKey: string | null) => Promise<TState>;
  readonly getAtom: (compositeKey: string | null) => Atom.Atom<TState>;
  readonly getSnapshot: (compositeKey: string | null) => TState;
}

export function defineKeyedQueryByKey<
  TInput,
  TData,
  TState,
  TControllerFields extends Record<string, unknown>,
>(
  registry: KeyedQueryRegistry<TState>,
  definition: KeyedQueryDefinition<TInput, TData, TControllerFields>,
  shouldFetchOnWatch: (controller: KeyedQueryControllerBase & Record<string, unknown>) => boolean,
): KeyedQueryByKey<TInput, TData, TState> {
  function keyOf(input: TInput): string | null {
    if (!definition.isEnabled(input)) {
      return null;
    }
    return `${definition.label}${KEY_SEP}${definition.buildKey(input)}`;
  }

  function getAtom(compositeKey: string | null): Atom.Atom<TState> {
    return (
      compositeKey === null ? registry.EMPTY_QUERY_ATOM : registry.queryStateAtom(compositeKey)
    ) as Atom.Atom<TState>;
  }

  function getSnapshot(compositeKey: string | null): TState {
    if (compositeKey === null) {
      return registry.initialState;
    }
    return registry.getQueryState(compositeKey);
  }

  function watch(input: TInput): () => void {
    const compositeKey = keyOf(input);
    if (compositeKey === null) {
      return NOOP;
    }

    let controller = registry.controllers.get(compositeKey);
    if (!controller) {
      controller = {
        compositeKey,
        environmentId: definition.resolveEnvironmentId(input),
        family: definition.label,
        staleTime: definition.staleTime,
        gcTime: Math.max(0, definition.gcTime ?? registry.defaultGcTime),
        run: () => definition.run(input),
        subscriberCount: 0,
        lastFetchedAt: 0,
        lastAccessedAt: Date.now(),
        fetchToken: 0,
        hasData: false,
        inFlightPromise: null,
        gcTimer: null,
        ...definition.createControllerFields(input),
      };
      registry.registerController(controller);
    }

    registry.touch(controller);
    controller.subscriberCount += 1;
    if (shouldFetchOnWatch(controller)) {
      void registry.runController(controller);
    }

    return () => {
      const current = registry.controllers.get(compositeKey);
      if (!current) {
        return;
      }
      current.subscriberCount = Math.max(0, current.subscriberCount - 1);
      registry.scheduleGc(current);
    };
  }

  function refresh(compositeKey: string | null): void {
    if (compositeKey === null) {
      return;
    }
    const controller = registry.controllers.get(compositeKey);
    if (!controller) {
      return;
    }
    controller.lastFetchedAt = 0;
    void registry.runController(controller);
  }

  async function refreshAsync(compositeKey: string | null): Promise<TState> {
    if (compositeKey === null) {
      return registry.initialState;
    }
    const controller = registry.controllers.get(compositeKey);
    if (!controller) {
      return registry.getQueryState(compositeKey);
    }
    controller.lastFetchedAt = 0;
    await registry.runController(controller);
    return registry.getQueryState(compositeKey);
  }

  return { keyOf, watch, refresh, refreshAsync, getAtom, getSnapshot };
}

export interface KeyedQueryByInput<TInput, TData, TState> {
  readonly targetKey: (input: TInput) => string | null;
  readonly atomFor: (input: TInput) => Atom.Atom<TState>;
  readonly snapshotFor: (input: TInput) => TState;
  readonly watch: (
    input: TInput,
    resolveIntervalMs?: (data: TData | null) => number | false,
  ) => () => void;
  readonly updateData: (input: TInput, updater: (current: TData | null) => TData | null) => void;
}

export function defineKeyedQueryByInput<
  TInput,
  TData,
  TState,
  TControllerFields extends Record<string, unknown>,
>(
  registry: KeyedQueryRegistry<TState>,
  definition: KeyedQueryDefinition<TInput, TData, TControllerFields>,
  shouldFetchOnWatch: (controller: KeyedQueryControllerBase & Record<string, unknown>) => boolean,
): KeyedQueryByInput<TInput, TData, TState> {
  function compositeKeyFor(input: TInput): string | null {
    if (!definition.isEnabled(input)) {
      return null;
    }
    return `${definition.label}${KEY_SEP}${definition.buildKey(input)}`;
  }

  function atomFor(input: TInput): Atom.Atom<TState> {
    const compositeKey = compositeKeyFor(input);
    return (
      compositeKey === null ? registry.EMPTY_QUERY_ATOM : registry.queryStateAtom(compositeKey)
    ) as Atom.Atom<TState>;
  }

  function snapshotFor(input: TInput): TState {
    const compositeKey = compositeKeyFor(input);
    if (compositeKey === null) {
      return registry.initialState;
    }
    return registry.getQueryState(compositeKey);
  }

  function watch(
    input: TInput,
    resolveIntervalMs?: (data: TData | null) => number | false,
  ): () => void {
    const compositeKey = compositeKeyFor(input);
    if (compositeKey === null) {
      return NOOP;
    }

    let controller = registry.controllers.get(compositeKey);
    if (!controller) {
      controller = {
        compositeKey,
        environmentId: definition.resolveEnvironmentId(input),
        family: definition.label,
        staleTime: definition.staleTime,
        gcTime: Math.max(0, definition.gcTime ?? registry.defaultGcTime),
        run: () => definition.run(input),
        subscriberCount: 0,
        lastFetchedAt: 0,
        lastAccessedAt: Date.now(),
        fetchToken: 0,
        hasData: false,
        inFlightPromise: null,
        gcTimer: null,
        pollTimer: null,
        resolveIntervalMs: null,
        ...definition.createControllerFields(input),
      };
      registry.registerController(controller);
    }

    registry.touch(controller);
    controller.resolveIntervalMs = resolveIntervalMs ?? null;
    controller.subscriberCount += 1;
    if (shouldFetchOnWatch(controller)) {
      void registry.runController(controller);
    } else if (controller.hasData) {
      registry.schedulePoll(controller);
    }

    return () => {
      const current = registry.controllers.get(compositeKey);
      if (!current) {
        return;
      }
      current.subscriberCount = Math.max(0, current.subscriberCount - 1);
      if (current.subscriberCount <= 0) {
        registry.clearPollTimer(current);
        registry.scheduleGc(current);
      }
    };
  }

  function updateData(input: TInput, updater: (current: TData | null) => TData | null): void {
    const compositeKey = compositeKeyFor(input);
    if (compositeKey === null) {
      return;
    }
    const current = registry.getQueryState(compositeKey) as TState & { data: TData | null };
    const next = updater(current.data);
    if (next === current.data) {
      return;
    }
    registry.setQueryState(compositeKey, {
      ...current,
      data: next,
      isLoading: false,
      isFetching: false,
      error: null,
    } as TState);
    const controller = registry.controllers.get(compositeKey);
    if (controller) {
      controller.hasData = next !== null;
      registry.schedulePoll(controller);
    }
  }

  return { targetKey: compositeKeyFor, atomFor, snapshotFor, watch, updateData };
}
