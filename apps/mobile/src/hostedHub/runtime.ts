import {
  configureHostedRuntime,
  hostedHubController,
  hostedHubStore,
} from "@ryco/client-runtime/authorization";
import {
  hasHostedRelayPendingRequests,
  resetHostedRelayAttemptFactory,
} from "@ryco/client-runtime/relay";

import { mobileAppLifecycle } from "../platform/appLifecycle";
import { createMobileDpopSigner } from "../platform/dpopSigner";
import { mobileE2eeTrustStore } from "../platform/e2eeTrustStore";
import { mobileKV } from "../platform/kv";
import { mobileNativeAuthorization } from "../platform/nativeAuthorization";
import { mobilePasskeyCeremony } from "../platform/passkeyCeremony";
import {
  hydrateMobileHostedSessionToken,
  mobileSessionCredentials,
} from "../platform/sessionCredentials";
import {
  disposeMobileRelayE2eeAttempt,
  prepareMobileRelayE2eeAttempt,
  resolveMobileRelayE2eeProvider,
} from "./e2eeAttempt";
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
let selectionWatch: (() => void) | undefined;
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
    // docs/relay-e2ee-protocol.md §4: THIS IS WHERE NATIVE E2EE IS ON.
    //
    // Every relay channel this app opens is built with the §4.4 mode machine,
    // and the guards it consults were resolved before this call — §4.4 requires
    // them "before it has received any payload", and this call is synchronous.
    // `resolveMobileRelayE2eeProvider` returns `undefined` in exactly one case,
    // a device that cannot hold the §6.3 agreement key, which §6.3 says simply
    // has no E2EE; everything else is either the machine or a channel that fails
    // closed. It is never a legacy channel because the attempt was late.
    createRelaySocket: (input) =>
      new MobileHostedRelaySocket({ ...input, e2ee: resolveMobileRelayE2eeProvider() }),
  });
  configured = true;
  setAvailable(true);
  watchSelectionForE2ee();
  return true;
}

/**
 * Keep the §4.4 attempt warm for whatever selection is current.
 *
 * The relay transport creates its socket the instant a ticket resolves, and
 * resolving an attempt reads a keychain and a secure store. Priming on every
 * change of the `(account, node)` pair is what makes the synchronous read at
 * `createRelaySocket` find a complete attempt rather than fail the channel
 * closed — and the failure IS closed, never a silent fallback, so a miss costs
 * one channel rather than the guarantee.
 */
function watchSelectionForE2ee(): void {
  if (selectionWatch !== undefined) return;
  let last = "";
  const evaluate = () => {
    const state = hostedHubStore.getState();
    // NUL-joined: `accountId` and `nodeId` are Hub-issued (§12.1.1), so a
    // separator either could contain would let one selection's key be spelled
    // by another's fields.
    const next = [state.accountStatus, state.account?.id ?? "", state.selectedNode?.id ?? ""].join(
      "\u0000",
    );
    if (next === last) return;
    last = next;
    if (state.accountStatus !== "authenticated" || state.selectedNode === null) {
      disposeMobileRelayE2eeAttempt();
      return;
    }
    void prepareMobileRelayE2eeAttempt();
  };
  selectionWatch = hostedHubStore.subscribe(evaluate);
  evaluate();
}

/**
 * The single entry point screens use.
 *
 * Order matters: the bearer token must be hydrated **before**
 * `hostedHubController.bootstrap()` runs. `readBearerToken()` is synchronous,
 * so a null read would make `restoreSession` fail with a 401 and drop the user
 * to the bootstrap-availability probe even though a valid session exists.
 *
 * The §13 trust store is hydrated before `configureMobileHostedRuntime`, which
 * is what installs the relay socket factory: no channel can exist until the load
 * has completed or failed. `docs/relay-e2ee-protocol.md` §4.4 requires every
 * latch and pin guard to be "evaluated against the pin the client resolves from
 * **its own** channel selection" before any payload arrives, and §13.1.1's
 * partial-loss rule makes an unread store UNEXPECTED rather than legacy-eligible.
 * The load therefore has to precede the first `channel.accept`, and it never
 * rejects: a store that cannot be read leaves the classifier at `unobtainable`,
 * which fails closed, and taking the whole hosted session down for it would put
 * a keychain hiccup between the owner and their nodes.
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
    await mobileE2eeTrustStore.hydrate();
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
  selectionWatch?.();
  selectionWatch = undefined;
  // The attempt holds this device's agreement scalar. A Hub-profile change is
  // exactly when it stops being the right one, so it is zeroized here rather
  // than left for the next selection to overwrite.
  disposeMobileRelayE2eeAttempt();
  invalidateMobileHostedRuntimeConfig();
}

/** Test seam: drop the configured/available flags between cases. */
export function resetMobileHostedRuntimeForTests(): void {
  invalidateMobileHostedRuntime();
}
