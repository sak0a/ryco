import type { NativeAuthorizationPhase } from "./onboardingModel";

export interface NativeAuthorizationPhaseSnapshot {
  readonly phase: NativeAuthorizationPhase;
  readonly revision: number;
}

export interface NativeAuthorizationPhaseReporter {
  readonly opening: () => void;
  readonly waiting: () => void;
  readonly cancelled: () => void;
  readonly idle: () => void;
}

export interface NativeAuthorizationPhaseStore extends NativeAuthorizationPhaseReporter {
  readonly getSnapshot: () => NativeAuthorizationPhaseSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
}

export function createNativeAuthorizationPhaseStore(): NativeAuthorizationPhaseStore {
  let snapshot: NativeAuthorizationPhaseSnapshot = { phase: "idle", revision: 0 };
  const listeners = new Set<() => void>();
  const publish = (phase: NativeAuthorizationPhase) => {
    if (snapshot.phase === phase) return;
    snapshot = { phase, revision: snapshot.revision + 1 };
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    opening: () => publish("opening"),
    waiting: () => publish("waiting"),
    cancelled: () => publish("cancelled"),
    idle: () => publish("idle"),
  };
}

/** One presentation-only phase source for the single native handoff adapter. */
export const mobileNativeAuthorizationPhaseStore = createNativeAuthorizationPhaseStore();
