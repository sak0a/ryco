export type NativeIdentityOperation =
  | "attempt_cancel"
  | "email_start"
  | "email_verify"
  | "password_finish"
  | "password_reset_finish"
  | "password_reset_request"
  | "password_reset_verify"
  | "password_start"
  | "recovery_code"
  | "signup_passkey"
  | "signup_password"
  | "signup_username";

export type NativeIdentityTransactionPhase =
  | { readonly status: "idle" }
  | { readonly status: "running"; readonly operation: NativeIdentityOperation };

export type NativeIdentityTransactionErrorCode =
  | "cancelled"
  | "expired"
  | "invalid_origin"
  | "origin_changed"
  | "superseded";

const ERROR_MESSAGES: Readonly<Record<NativeIdentityTransactionErrorCode, string>> = {
  cancelled: "Authentication was cancelled.",
  expired: "The authentication request expired. Try again.",
  invalid_origin: "The Hub address is invalid.",
  origin_changed: "The selected Hub changed. Start again.",
  superseded: "A newer authentication request replaced this one.",
};

const CLOCK_SKEW_TOLERANCE_MS = 60_000;

export class NativeIdentityTransactionError extends Error {
  readonly code: NativeIdentityTransactionErrorCode;

  constructor(code: NativeIdentityTransactionErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name =
      code === "cancelled" || code === "origin_changed" || code === "superseded"
        ? "AbortError"
        : "NativeIdentityTransactionError";
    this.code = code;
  }
}

export interface NativeIdentityRunInput {
  readonly origin: string;
  readonly operation: NativeIdentityOperation;
  readonly expiresAt?: number;
  readonly signal?: AbortSignal;
}

export interface NativeIdentityTransactionCoordinator {
  readonly snapshot: () => NativeIdentityTransactionPhase;
  readonly subscribe: (listener: (snapshot: NativeIdentityTransactionPhase) => void) => () => void;
  readonly run: <T>(
    input: NativeIdentityRunInput,
    work: (signal: AbortSignal) => Promise<T>,
  ) => Promise<T>;
  readonly cancel: () => void;
  readonly selectOrigin: (origin: string) => void;
}

interface ActiveTransaction {
  readonly controller: AbortController;
  readonly generation: number;
  readonly operation: NativeIdentityOperation;
  readonly origin: string;
  cancellation: "cancelled" | "origin_changed" | "superseded" | null;
}

function canonicalOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new NativeIdentityTransactionError("invalid_origin");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.length === 0 ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new NativeIdentityTransactionError("invalid_origin");
  }
  return url.origin;
}

function assertNotExpired(expiresAt: number | undefined, now: number): void {
  if (expiresAt !== undefined && now - expiresAt > CLOCK_SKEW_TOLERANCE_MS) {
    throw new NativeIdentityTransactionError("expired");
  }
}

function cancellationError(active: ActiveTransaction): NativeIdentityTransactionError {
  return new NativeIdentityTransactionError(active.cancellation ?? "cancelled");
}

export function createNativeIdentityTransactionCoordinator(
  options: { readonly now?: () => number } = {},
): NativeIdentityTransactionCoordinator {
  const now = options.now ?? Date.now;
  const listeners = new Set<(snapshot: NativeIdentityTransactionPhase) => void>();
  let phase: NativeIdentityTransactionPhase = { status: "idle" };
  let active: ActiveTransaction | null = null;
  let generation = 0;
  let selectedOrigin: string | null = null;

  const publish = (next: NativeIdentityTransactionPhase): void => {
    phase = next;
    for (const listener of listeners) {
      try {
        listener(next);
      } catch {
        // Presentation observers cannot interrupt or retain authority over an
        // authentication transaction.
      }
    }
  };

  const abortActive = (reason: ActiveTransaction["cancellation"]): void => {
    if (!active) return;
    active.cancellation = reason;
    active.controller.abort();
  };

  return {
    snapshot: () => phase,
    subscribe: (listener) => {
      listeners.add(listener);
      listener(phase);
      return () => listeners.delete(listener);
    },
    run: async <T>(
      input: NativeIdentityRunInput,
      work: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> => {
      const origin = canonicalOrigin(input.origin);
      assertNotExpired(input.expiresAt, now());
      abortActive(active?.origin === origin ? "superseded" : "origin_changed");
      selectedOrigin = origin;
      const current: ActiveTransaction = {
        controller: new AbortController(),
        generation: ++generation,
        operation: input.operation,
        origin,
        cancellation: null,
      };
      active = current;
      const onCallerAbort = () => {
        if (active === current) {
          current.cancellation = "cancelled";
          current.controller.abort();
        }
      };
      if (input.signal?.aborted) onCallerAbort();
      else input.signal?.addEventListener("abort", onCallerAbort, { once: true });
      publish({ status: "running", operation: input.operation });

      try {
        if (current.controller.signal.aborted) throw cancellationError(current);
        let result: T;
        try {
          result = await work(current.controller.signal);
        } catch (error) {
          if (current.controller.signal.aborted || active !== current) {
            throw cancellationError(current);
          }
          throw error;
        }
        if (active !== current || current.controller.signal.aborted) {
          throw cancellationError(current);
        }
        if (selectedOrigin !== current.origin) {
          current.cancellation = "origin_changed";
          throw cancellationError(current);
        }
        assertNotExpired(input.expiresAt, now());
        return result;
      } finally {
        input.signal?.removeEventListener("abort", onCallerAbort);
        if (active === current) {
          active = null;
          publish({ status: "idle" });
        }
      }
    },
    cancel: () => abortActive("cancelled"),
    selectOrigin: (origin) => {
      const selected = canonicalOrigin(origin);
      selectedOrigin = selected;
      if (active && active.origin !== selected) abortActive("origin_changed");
    },
  };
}
