import type {
  NativeAuthorizationBrowserResult,
  NativeAuthorizationService,
} from "@ryco/client-runtime/platform";

import {
  mobileNativeAuthorizationPhaseStore,
  type NativeAuthorizationPhaseReporter,
} from "../features/onboarding/nativeAuthorizationState";
import { readMobileAppVariant, readMobileDeviceLabel, type MobileAppVariant } from "./config";

type CryptoModule = typeof import("expo-crypto");
type WebBrowserModule = typeof import("expo-web-browser");

const CALLBACK_URIS: Readonly<Record<MobileAppVariant, string>> = {
  development: "ryco-dev://hosted/complete",
  preview: "ryco-preview://hosted/complete",
  production: "ryco://hosted/complete",
};

export interface MobileNativeAuthorizationDependencies {
  readonly variant: () => MobileAppVariant;
  readonly deviceLabel: () => string;
  readonly loadCrypto: () => Promise<CryptoModule>;
  readonly loadBrowser: () => Promise<WebBrowserModule>;
  readonly phase?: NativeAuthorizationPhaseReporter;
}

export function mobileAuthorizationCallbackUri(variant: MobileAppVariant): string {
  return CALLBACK_URIS[variant];
}

function browserResult(
  result: Awaited<ReturnType<WebBrowserModule["openAuthSessionAsync"]>>,
): NativeAuthorizationBrowserResult {
  if (result.type === "success" && typeof result.url === "string") {
    return { type: "success", url: result.url };
  }
  if (result.type === "locked") return { type: "locked" };
  return { type: result.type === "dismiss" ? "dismiss" : "cancel" };
}

async function openBrowser(
  browser: WebBrowserModule,
  authorizationUrl: string,
  callbackUri: string,
  signal?: AbortSignal,
  phase?: NativeAuthorizationPhaseReporter,
): Promise<NativeAuthorizationBrowserResult> {
  if (signal?.aborted) {
    phase?.cancelled();
    return { type: "cancel" };
  }

  const pending = browser.openAuthSessionAsync(authorizationUrl, callbackUri, {
    // Reusing the system browser's Hub session is the purpose of this handoff.
    // The app never reads that cookie store and adopts only a one-time code.
    preferEphemeralSession: false,
    preferUniversalLinks: false,
  });
  phase?.waiting();
  if (!signal) {
    try {
      const result = browserResult(await pending);
      if (result.type === "cancel" || result.type === "dismiss") phase?.cancelled();
      else phase?.idle();
      return result;
    } catch (cause) {
      phase?.idle();
      throw cause;
    }
  }

  return await new Promise<NativeAuthorizationBrowserResult>((resolve, reject) => {
    let settled = false;
    const finish = (result: NativeAuthorizationBrowserResult) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      if (result.type === "cancel" || result.type === "dismiss") phase?.cancelled();
      else phase?.idle();
      resolve(result);
    };
    const abort = () => {
      if (settled) return;
      try {
        browser.dismissAuthSession();
      } catch {
        // The session may already have closed. Cancellation remains bounded.
      }
      finish({ type: "cancel" });
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    void pending
      .then((result) => finish(browserResult(result)))
      .catch((cause: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        phase?.idle();
        reject(cause);
      });
  });
}

export function createMobileNativeAuthorization(
  dependencies: MobileNativeAuthorizationDependencies,
): NativeAuthorizationService {
  return {
    callbackUri: () => mobileAuthorizationCallbackUri(dependencies.variant()),
    deviceLabel: dependencies.deviceLabel,
    randomBytes: async (length) => {
      const crypto = await dependencies.loadCrypto();
      return await crypto.getRandomBytesAsync(length);
    },
    sha256: async (value) => {
      const crypto = await dependencies.loadCrypto();
      return new Uint8Array(
        await crypto.digest(crypto.CryptoDigestAlgorithm.SHA256, value as unknown as BufferSource),
      );
    },
    openSystemBrowser: async (authorizationUrl, callbackUri, signal) => {
      dependencies.phase?.opening();
      try {
        return await openBrowser(
          await dependencies.loadBrowser(),
          authorizationUrl,
          callbackUri,
          signal,
          dependencies.phase,
        );
      } catch (cause) {
        dependencies.phase?.idle();
        throw cause;
      }
    },
  };
}

/**
 * Native public-client authorization.
 *
 * PKCE, state, callback validation, DPoP, and token adoption remain in the
 * shared runtime. This adapter owns only OS entropy, hashing, the exact app
 * scheme, and the system browser presentation.
 */
export const mobileNativeAuthorization = createMobileNativeAuthorization({
  variant: readMobileAppVariant,
  deviceLabel: readMobileDeviceLabel,
  loadCrypto: () => import("expo-crypto"),
  loadBrowser: () => import("expo-web-browser"),
  phase: mobileNativeAuthorizationPhaseStore,
});
