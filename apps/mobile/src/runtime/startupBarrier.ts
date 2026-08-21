/**
 * Cold-start ordering gate shared by the direct and hosted connection paths.
 *
 * The app shell must stay synchronous to render its launch surface, while the
 * snapshot cache is asynchronous. Callers therefore enqueue connection work
 * here; none of it runs until the one hydration attempt has settled. A failed
 * cache read is reported and treated as an empty cache rather than preventing
 * the app from connecting indefinitely.
 */

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

export interface MobileRuntimeStartupBarrier {
  readonly beginHydration: (
    hydrate: () => Promise<void>,
    onFailure: (error: unknown) => void,
  ) => Promise<void>;
  readonly runAfterHydration: (
    work: () => void | Promise<void>,
    onFailure: (error: unknown) => void,
  ) => void;
  readonly reset: () => void;
}

export function createMobileRuntimeStartupBarrier(): MobileRuntimeStartupBarrier {
  let generation = 0;
  let ready = createDeferred();
  let hydration: Promise<void> | null = null;

  const beginHydration = (
    hydrate: () => Promise<void>,
    onFailure: (error: unknown) => void,
  ): Promise<void> => {
    if (hydration) return hydration;
    hydration = Promise.resolve()
      .then(hydrate)
      .catch((error: unknown) => {
        onFailure(error);
      })
      .then(() => {
        ready.resolve();
      });
    return hydration;
  };

  const runAfterHydration = (
    work: () => void | Promise<void>,
    onFailure: (error: unknown) => void,
  ): void => {
    const scheduledGeneration = generation;
    void ready.promise
      .then(() => {
        if (generation !== scheduledGeneration) return;
        return work();
      })
      .catch(onFailure);
  };

  const reset = (): void => {
    generation += 1;
    // Release callbacks waiting on the retired generation; their generation
    // check prevents them from starting stale connections.
    ready.resolve();
    ready = createDeferred();
    hydration = null;
  };

  return { beginHydration, runAfterHydration, reset };
}

export const mobileRuntimeStartupBarrier = createMobileRuntimeStartupBarrier();
