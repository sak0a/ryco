import * as Crypto from "node:crypto";

import type {
  NativeAuthorizationBrowserResult,
  NativeAuthorizationService,
} from "@ryco/client-runtime/platform";

const AUTHORIZATION_DEADLINE_MS = 5 * 60_000;

export type DesktopAuthorizationVariant = "development" | "preview" | "production";

export function desktopAuthorizationCallbackUri(variant: DesktopAuthorizationVariant): string {
  if (variant === "development") return "ryco-dev://hosted/complete";
  if (variant === "preview") return "ryco-preview://hosted/complete";
  return "ryco://hosted/complete";
}

interface PendingAuthorization {
  readonly callbackUri: string;
  readonly finish: (result: NativeAuthorizationBrowserResult) => void;
}

/** One in-memory callback rendezvous. URL validation still belongs to the shared handoff. */
export class DesktopAuthorizationCallbackBroker {
  #pending: PendingAuthorization | null = null;

  accept(rawUrl: string): boolean {
    const pending = this.#pending;
    if (pending === null) return false;
    try {
      const url = new URL(rawUrl);
      const base = `${url.protocol}//${url.host}${url.pathname}`;
      if (base !== pending.callbackUri) return false;
    } catch {
      return false;
    }
    pending.finish({ type: "success", url: rawUrl });
    return true;
  }

  async open(input: {
    readonly authorizationUrl: string;
    readonly callbackUri: string;
    readonly openExternal: (url: string) => Promise<void>;
    readonly signal?: AbortSignal;
  }): Promise<NativeAuthorizationBrowserResult> {
    if (input.signal?.aborted) return { type: "cancel" };
    this.#pending?.finish({ type: "cancel" });

    return await new Promise<NativeAuthorizationBrowserResult>((resolve, reject) => {
      let settled = false;
      const finish = (result: NativeAuthorizationBrowserResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", abort);
        if (this.#pending?.finish === finish) this.#pending = null;
        resolve(result);
      };
      const abort = () => finish({ type: "cancel" });
      const timer = setTimeout(abort, AUTHORIZATION_DEADLINE_MS);
      timer.unref();
      this.#pending = { callbackUri: input.callbackUri, finish };
      input.signal?.addEventListener("abort", abort, { once: true });
      if (input.signal?.aborted) {
        abort();
        return;
      }
      void input.openExternal(input.authorizationUrl).catch((cause: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", abort);
        if (this.#pending?.finish === finish) this.#pending = null;
        reject(cause);
      });
    });
  }

  cancel(): void {
    this.#pending?.finish({ type: "cancel" });
  }
}

export function createDesktopNativeAuthorization(input: {
  readonly variant: DesktopAuthorizationVariant;
  readonly deviceLabel: () => string;
  readonly broker: DesktopAuthorizationCallbackBroker;
  readonly openExternal: (url: string) => Promise<void>;
}): NativeAuthorizationService {
  const callbackUri = desktopAuthorizationCallbackUri(input.variant);
  return {
    callbackUri: () => callbackUri,
    deviceLabel: () => input.deviceLabel().trim().slice(0, 64),
    randomBytes: async (length) => Uint8Array.from(Crypto.randomBytes(length)),
    sha256: async (value) => Uint8Array.from(Crypto.createHash("sha256").update(value).digest()),
    openSystemBrowser: async (authorizationUrl, presentedCallbackUri, signal) => {
      if (presentedCallbackUri !== callbackUri) return { type: "cancel" };
      return await input.broker.open({
        authorizationUrl,
        callbackUri,
        openExternal: input.openExternal,
        ...(signal ? { signal } : {}),
      });
    },
  };
}

export function findDesktopAuthorizationCallback(
  values: readonly string[],
  callbackUri: string,
): string | null {
  for (const value of values) {
    try {
      const url = new URL(value);
      if (`${url.protocol}//${url.host}${url.pathname}` === callbackUri) return value;
    } catch {
      // Command-line values are not assumed to be URLs.
    }
  }
  return null;
}

export function resolveDesktopAuthorizationCallback(input: {
  readonly commandLine: readonly string[];
  readonly additionalData: unknown;
  readonly callbackUri: string;
}): string | null {
  const relayedCallback =
    typeof input.additionalData === "object" &&
    input.additionalData !== null &&
    "desktopAuthorizationCallback" in input.additionalData
      ? input.additionalData.desktopAuthorizationCallback
      : undefined;
  return findDesktopAuthorizationCallback(
    typeof relayedCallback === "string" ? [relayedCallback] : input.commandLine,
    input.callbackUri,
  );
}
