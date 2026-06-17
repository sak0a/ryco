import type { EnvironmentId } from "@ryco/contracts";
import { Atom } from "effect/unstable/reactivity";

import { appAtomRegistry } from "./atomRegistry";

export const KEY_SEP = "\u0000";
export const NOOP: () => void = () => undefined;

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export interface KeyedQueryControllerBase {
  readonly compositeKey: string;
  readonly environmentId: EnvironmentId;
  readonly staleTime: number;
  readonly run: () => Promise<unknown>;
  subscriberCount: number;
  lastFetchedAt: number;
  fetchToken: number;
  hasData: boolean;
}

export interface KeyedQueryRegistryConfig<TState> {
  readonly labelPrefix: string;
  readonly initialState: TState;
  readonly buildFetchingState: (current: TState) => TState;
  readonly buildSuccessState: (data: unknown) => TState;
  readonly buildErrorState: (current: TState, error: Error) => TState;
  readonly selectPollData?: (state: TState) => unknown;
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
  setQueryState(compositeKey: string, next: TState): void;
  getQueryState(compositeKey: string): TState;
  runController(controller: KeyedQueryControllerBase & Record<string, unknown>): Promise<void>;
  schedulePoll(controller: KeyedQueryControllerBase & Record<string, unknown>): void;
  clearPollTimer(controller: KeyedQueryControllerBase & Record<string, unknown>): void;
  resetForTests(): void;
}

export function createKeyedQueryRegistry<TState>(
  config: KeyedQueryRegistryConfig<TState>,
): KeyedQueryRegistry<TState> {
  const knownStateKeys = new Set<string>();
  const controllers = new Map<string, KeyedQueryControllerBase & Record<string, unknown>>();

  const queryStateAtom = Atom.family((compositeKey: string) => {
    knownStateKeys.add(compositeKey);
    return Atom.make<TState>(config.initialState).pipe(
      Atom.keepAlive,
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

  async function runController(
    controller: KeyedQueryControllerBase & Record<string, unknown>,
  ): Promise<void> {
    const token = ++controller.fetchToken;
    config.onRunStart?.(controller);
    const current = getQueryState(controller.compositeKey);
    setQueryState(controller.compositeKey, config.buildFetchingState(current));

    try {
      const data = await controller.run();
      if (token !== controller.fetchToken) {
        return;
      }
      config.onRunEnd?.(controller, "success");
      controller.hasData = true;
      controller.lastFetchedAt = Date.now();
      setQueryState(controller.compositeKey, config.buildSuccessState(data));
    } catch (error) {
      if (token !== controller.fetchToken) {
        return;
      }
      config.onRunEnd?.(controller, "error");
      setQueryState(
        controller.compositeKey,
        config.buildErrorState(getQueryState(controller.compositeKey), toError(error)),
      );
    }
    scheduleControllerPoll(controller);
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
      controller.fetchToken += 1;
    }
    controllers.clear();
    for (const compositeKey of knownStateKeys) {
      appAtomRegistry.set(queryStateAtom(compositeKey), config.initialState);
    }
    knownStateKeys.clear();
  }

  return {
    KEY_SEP,
    knownStateKeys,
    controllers,
    queryStateAtom,
    EMPTY_QUERY_ATOM,
    initialState: config.initialState,
    setQueryState,
    getQueryState,
    runController,
    schedulePoll: scheduleControllerPoll,
    clearPollTimer: clearControllerPollTimer,
    resetForTests,
  };
}

interface KeyedQueryDefinition<TInput, TData, TControllerFields extends Record<string, unknown>> {
  readonly label: string;
  readonly staleTime: number;
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
        staleTime: definition.staleTime,
        run: () => definition.run(input),
        subscriberCount: 0,
        lastFetchedAt: 0,
        fetchToken: 0,
        hasData: false,
        ...definition.createControllerFields(input),
      };
      registry.controllers.set(compositeKey, controller);
    }

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
        staleTime: definition.staleTime,
        run: () => definition.run(input),
        subscriberCount: 0,
        lastFetchedAt: 0,
        fetchToken: 0,
        hasData: false,
        pollTimer: null,
        resolveIntervalMs: null,
        ...definition.createControllerFields(input),
      };
      registry.controllers.set(compositeKey, controller);
    }

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
