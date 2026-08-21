import type { EnvironmentId, ThreadId } from "@ryco/contracts";

/**
 * Mounted mobile work that makes a hosted environment non-evictable.
 *
 * This intentionally mirrors the small refcounted shape used by t3code's
 * mobile background-activity scopes, but the vocabulary is Ryco's. A scope is
 * retained by the mounted surface that consumes it and released by that
 * surface's cleanup; inbox rendering and prefetch never create one.
 */
export type MobileHostedConnectionScope =
  | { readonly type: "thread-detail"; readonly threadId: ThreadId }
  | { readonly type: "vcs-status"; readonly cwd: string }
  | { readonly type: "provider-status"; readonly instanceId?: string };

export interface RetainedMobileHostedConnectionScope {
  readonly environmentId: EnvironmentId;
  readonly scope: MobileHostedConnectionScope;
  readonly refCount: number;
}

export const MOBILE_SCOPE_REPORT_INTERVAL_MS = 25_000;
export const MOBILE_SCOPE_LEASE_TTL_MS = 45_000;

export interface MobileHostedScopeLeaseReport {
  readonly observedAt: number;
  readonly ttlMs: typeof MOBILE_SCOPE_LEASE_TTL_MS;
  readonly scopes: ReadonlyArray<RetainedMobileHostedConnectionScope>;
}

export interface MobileHostedScopeLeaseDiagnostics {
  readonly observedAt: number | null;
  readonly ttlMs: typeof MOBILE_SCOPE_LEASE_TTL_MS;
  readonly activeScopeCount: number;
  readonly retainedEnvironmentCount: number;
}

let scopeLeaseDiagnostics: MobileHostedScopeLeaseDiagnostics = {
  observedAt: null,
  ttlMs: MOBILE_SCOPE_LEASE_TTL_MS,
  activeScopeCount: 0,
  retainedEnvironmentCount: 0,
};

/** Aggregate-only staging seam: no environment, thread, cwd, or payload identifiers. */
export function recordMobileHostedScopeLeaseReport(report: MobileHostedScopeLeaseReport): void {
  scopeLeaseDiagnostics = {
    observedAt: report.observedAt,
    ttlMs: report.ttlMs,
    activeScopeCount: report.scopes.length,
    retainedEnvironmentCount: new Set(report.scopes.map((entry) => entry.environmentId)).size,
  };
}

export function readMobileHostedScopeLeaseDiagnostics(): MobileHostedScopeLeaseDiagnostics {
  return scopeLeaseDiagnostics;
}

export interface MobileHostedScopeLeaseStore {
  readonly retain: (environmentId: EnvironmentId, scope: MobileHostedConnectionScope) => () => void;
  readonly list: (
    environmentId?: EnvironmentId,
  ) => ReadonlyArray<RetainedMobileHostedConnectionScope>;
  readonly isEnvironmentRetained: (environmentId: EnvironmentId) => boolean;
  readonly subscribe: (listener: () => void) => () => void;
  readonly startReporter: (input: {
    readonly report: (report: MobileHostedScopeLeaseReport) => void;
    readonly now?: () => number;
    readonly setTimeout?: (callback: () => void, delayMs: number) => unknown;
    readonly clearTimeout?: (timer: unknown) => void;
  }) => () => void;
  readonly reset: () => void;
}

function stableScopeKey(environmentId: EnvironmentId, scope: MobileHostedConnectionScope): string {
  switch (scope.type) {
    case "thread-detail":
      return JSON.stringify([environmentId, scope.type, scope.threadId]);
    case "vcs-status":
      return JSON.stringify([environmentId, scope.type, scope.cwd]);
    case "provider-status":
      return JSON.stringify([environmentId, scope.type, scope.instanceId ?? null]);
  }
}

export function createMobileHostedScopeLeaseStore(): MobileHostedScopeLeaseStore {
  const retained = new Map<string, RetainedMobileHostedConnectionScope>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of Array.from(listeners)) listener();
  };

  const list = (environmentId?: EnvironmentId) =>
    Array.from(retained.values()).filter(
      (entry) => environmentId === undefined || entry.environmentId === environmentId,
    );

  return {
    retain(environmentId, scope) {
      const key = stableScopeKey(environmentId, scope);
      const current = retained.get(key);
      retained.set(key, {
        environmentId,
        scope,
        refCount: (current?.refCount ?? 0) + 1,
      });
      if (!current) notify();

      let released = false;
      return () => {
        if (released) return;
        released = true;
        const active = retained.get(key);
        if (!active) return;
        if (active.refCount > 1) {
          retained.set(key, { ...active, refCount: active.refCount - 1 });
          return;
        }
        retained.delete(key);
        notify();
      };
    },
    list,
    isEnvironmentRetained: (environmentId) => list(environmentId).length > 0,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    startReporter(input) {
      const now = input.now ?? (() => Date.now());
      const schedule =
        input.setTimeout ??
        ((callback: () => void, delayMs: number) => globalThis.setTimeout(callback, delayMs));
      const cancel =
        input.clearTimeout ??
        ((timer: unknown) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>));
      let stopped = false;
      let timer: unknown = null;
      let queued = false;
      const emit = () => {
        if (stopped) return;
        queued = false;
        input.report({
          observedAt: now(),
          ttlMs: MOBILE_SCOPE_LEASE_TTL_MS,
          scopes: list(),
        });
      };
      const request = () => {
        if (queued || stopped) return;
        queued = true;
        if (typeof globalThis.queueMicrotask === "function") globalThis.queueMicrotask(emit);
        else void Promise.resolve().then(emit);
      };
      const tick = () => {
        if (stopped) return;
        emit();
        timer = schedule(tick, MOBILE_SCOPE_REPORT_INTERVAL_MS);
      };
      const unsubscribe = this.subscribe(request);
      emit();
      timer = schedule(tick, MOBILE_SCOPE_REPORT_INTERVAL_MS);
      return () => {
        if (stopped) return;
        stopped = true;
        unsubscribe();
        if (timer !== null) cancel(timer);
      };
    },
    reset() {
      if (retained.size === 0) return;
      retained.clear();
      notify();
    },
  };
}

export const mobileHostedConnectionScopes = createMobileHostedScopeLeaseStore();

/** Capacity-assessment arithmetic, kept executable for the PR evidence. */
export function measureHostedLeaseReconnectTraffic(input: {
  readonly clients: number;
  readonly bound: number;
  readonly retainedEnvironmentsPerClient: number;
}): {
  readonly unleasedReconnects: number;
  readonly leasedReconnects: number;
  readonly unleasedShellStreams: number;
  readonly leasedShellStreams: number;
  readonly reduction: number;
} {
  const unleasedReconnects = input.clients * input.bound;
  const leasedReconnects =
    input.clients * Math.min(input.bound, input.retainedEnvironmentsPerClient);
  return {
    unleasedReconnects,
    leasedReconnects,
    // Every environment connection unconditionally owns one shell stream
    // (`connection/connection.ts`). Releasing a connection releases that
    // stream, so connection count is an exact baseline-stream measurement.
    unleasedShellStreams: unleasedReconnects,
    leasedShellStreams: leasedReconnects,
    reduction:
      unleasedReconnects === 0 ? 0 : (unleasedReconnects - leasedReconnects) / unleasedReconnects,
  };
}
