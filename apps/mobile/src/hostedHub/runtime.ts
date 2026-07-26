import { configureHostedRuntime, hostedHubController } from "@ryco/client-runtime/authorization";
import {
  hasHostedRelayPendingRequests,
  resetHostedRelayAttemptFactory,
} from "@ryco/client-runtime/relay";

import { mobileAppLifecycle } from "../platform/appLifecycle";
import { createMobileDpopSigner } from "../platform/dpopSigner";
import { mobileKV } from "../platform/kv";
import { mobileNativeAuthorization } from "../platform/nativeAuthorization";
import { mobilePasskeyCeremony } from "../platform/passkeyCeremony";
import {
  hydrateMobileHostedSessionToken,
  mobileSessionCredentials,
} from "../platform/sessionCredentials";
import { hydrateMobileHubProfile } from "./hubProfile";
import { mobileHostedNodeLifecycle } from "./nodeLifecycle";
import { MobileHostedRelaySocket, mobileHostedRelayUrl } from "./relaySocket";
import {
  getMobileHostedEndpoint,
  getMobileHostedHttpClient,
  invalidateMobileHostedRuntimeConfig,
  isMobileHostedModeConfigured,
} from "./runtimeConfig";

/**
 * Hosted runtime wiring.
 *
 * Fails closed at every step: with no hosted config, or with no hardware device
 * key, the runtime is simply never configured and hosted surfaces report
 * unavailable. Configuring without a DPoP signer would throw inside
 * `HostedHubApi`'s constructor at bootstrap, so the signer is resolved before
 * `configureHostedRuntime` is called, never after.
 */

let configured = false;
let available = false;
let session: Promise<void> | undefined;
const availabilityListeners = new Set<() => void>();

function setAvailable(next: boolean): void {
  if (available === next) return;
  available = next;
  for (const listener of availabilityListeners) listener();
}

/** Whether hosted mode is both configured and backed by a usable hardware key. */
export function isMobileHostedModeAvailable(): boolean {
  return available;
}

export function subscribeMobileHostedModeAvailability(listener: () => void): () => void {
  availabilityListeners.add(listener);
  return () => availabilityListeners.delete(listener);
}

/**
 * Bound timer wrappers. Unbound platform methods throw "Illegal invocation"
 * under React Native, and Hermes builds do not all ship `queueMicrotask`.
 */
const timers = {
  now: (): number => Date.now(),
  setTimeout: (callback: () => void, delayMs: number) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(timer),
  queueMicrotask: (callback: () => void): void => {
    if (typeof globalThis.queueMicrotask === "function") globalThis.queueMicrotask(callback);
    else void Promise.resolve().then(callback);
  },
};

/**
 * Subscribe to the next foreground transition, once.
 *
 * `mobileAppLifecycle` emits both "foreground" and "resume" per transition, so
 * this de-duplicates; the runtime's `{once: true}` semantics drive resumption
 * of the 20s directory poll.
 */
function subscribeForeground(listener: () => void): () => void {
  let fired = false;
  const unsubscribe = mobileAppLifecycle.subscribe((event) => {
    if (fired || event !== "foreground") return;
    fired = true;
    listener();
  });
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
  };
}

/**
 * Idempotent. Returns false when hosted mode cannot be configured, which is the
 * normal state for a direct-only build.
 */
export async function configureMobileHostedRuntime(): Promise<boolean> {
  if (configured) return available;
  if (!isMobileHostedModeConfigured()) return false;
  const endpoint = getMobileHostedEndpoint();
  const httpClient = getMobileHostedHttpClient();
  if (!endpoint || !httpClient) return false;

  let dpopSigner;
  try {
    // Hardware-backed key or no hosted session at all. There is deliberately no
    // software fallback: it would reduce DPoP to bare bearer assurance.
    dpopSigner = await createMobileDpopSigner();
  } catch {
    return false;
  }
  if (configured) return available;

  configureHostedRuntime({
    endpoint,
    httpClient,
    passkeyCeremony: mobilePasskeyCeremony,
    sessionCredentials: mobileSessionCredentials,
    dpopSigner,
    nativeAuthorization: mobileNativeAuthorization,
    nodeLifecycle: mobileHostedNodeLifecycle,
    timers,
    isForeground: () => mobileAppLifecycle.isForeground(),
    subscribeForeground,
    hasPendingRelayRequests: hasHostedRelayPendingRequests,
    resetRelayAttemptFactory: resetHostedRelayAttemptFactory,
    relayUrl: mobileHostedRelayUrl,
    createRelaySocket: (input) => new MobileHostedRelaySocket(input),
  });
  configured = true;
  setAvailable(true);
  return true;
}

/**
 * The single entry point screens use.
 *
 * Order matters: the bearer token must be hydrated **before**
 * `hostedHubController.bootstrap()` runs. `readBearerToken()` is synchronous,
 * so a null read would make `restoreSession` fail with a 401 and drop the user
 * to the bootstrap-availability probe even though a valid session exists.
 */
export function ensureMobileHostedSession(): Promise<void> {
  session ??= (async () => {
    await hydrateMobileHubProfile(mobileKV);
    // A settings render may have memoized the build default before async
    // profile hydration completed. Re-resolve now so a compatible saved domain
    // becomes authoritative before any secret is read or request is sent.
    invalidateMobileHostedRuntimeConfig();
    if (!isMobileHostedModeConfigured()) return;
    await hydrateMobileHostedSessionToken();
    if (!(await configureMobileHostedRuntime())) return;
    await hostedHubController.bootstrap();
  })().catch(() => {
    session = undefined;
  });
  return session;
}

/** Invalidate hosted availability after a deliberate Hub profile change. */
export function invalidateMobileHostedRuntime(): void {
  configured = false;
  setAvailable(false);
  session = undefined;
  invalidateMobileHostedRuntimeConfig();
}

/** Test seam: drop the configured/available flags between cases. */
export function resetMobileHostedRuntimeForTests(): void {
  invalidateMobileHostedRuntime();
}
