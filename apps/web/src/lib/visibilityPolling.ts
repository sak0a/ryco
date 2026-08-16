import type { AppLifecycleService } from "@ryco/client-runtime/platform";

export interface VisibilityAwarePoller {
  readonly refresh: () => Promise<void>;
  readonly stop: () => void;
}

export function createVisibilityAwarePoller(input: {
  readonly lifecycle: AppLifecycleService;
  readonly run: () => Promise<unknown>;
  readonly resolveDelayMs: () => number | false;
  readonly runImmediately?: boolean;
  readonly jitterRatio?: number;
  readonly random?: () => number;
  readonly setTimeout?: typeof globalThis.setTimeout;
  readonly clearTimeout?: typeof globalThis.clearTimeout;
}): VisibilityAwarePoller {
  const setTimer = input.setTimeout ?? globalThis.setTimeout;
  const clearTimer = input.clearTimeout ?? globalThis.clearTimeout;
  const random = input.random ?? Math.random;
  const jitterRatio = Math.max(0, Math.min(0.5, input.jitterRatio ?? 0));
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let stopped = false;

  const clearScheduled = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };
  const schedule = () => {
    clearScheduled();
    if (stopped || !input.lifecycle.isForeground()) return;
    const baseDelay = input.resolveDelayMs();
    if (baseDelay === false || baseDelay <= 0) return;
    const jitter = baseDelay * jitterRatio * (random() * 2 - 1);
    const delay = Math.max(1, Math.round(baseDelay + jitter));
    timer = setTimer(() => {
      timer = null;
      void refresh();
    }, delay);
  };
  const refresh = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    clearScheduled();
    if (inFlight) return inFlight;
    const promise = Promise.resolve()
      .then(input.run)
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        if (inFlight === promise) inFlight = null;
        schedule();
      });
    inFlight = promise;
    return promise;
  };
  const unsubscribe = input.lifecycle.subscribe((event) => {
    if (event === "background") {
      clearScheduled();
      return;
    }
    if (
      (event === "foreground" || event === "resume" || event === "online") &&
      input.lifecycle.isForeground()
    ) {
      void refresh();
    }
  });

  if (input.runImmediately ?? true) void refresh();
  else schedule();

  return {
    refresh,
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearScheduled();
      unsubscribe();
    },
  };
}
