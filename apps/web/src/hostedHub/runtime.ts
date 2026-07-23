import { configureHostedRuntime, type HostedHubApi } from "@ryco/client-runtime/authorization";

import { writePrimaryEnvironmentDescriptor } from "../environments/primary";
import {
  connectPrimaryEnvironment,
  disconnectPrimaryEnvironment,
} from "../environments/runtime/service";
import { useStore } from "../store";
import { webEndpoint } from "../platform/endpoint";
import { webHttpClient } from "../platform/httpClient";
import { webPasskeyCeremony } from "../platform/passkeyCeremony";
import { webSessionCredentials } from "../platform/sessionCredentials";
import { clearWebHostedNodeScopedState } from "./environment";
import { hasHostedRelayPendingRequests, resetHostedRelayAttemptFactory } from "./transport";
import { BrowserHostedRelaySocket, hostedRelayWebSocketUrl } from "./relaySocket";

let configured = false;

export function configureWebHostedRuntime(api: HostedHubApi): void {
  if (configured) return;
  configured = true;
  configureHostedRuntime(
    {
      endpoint: webEndpoint,
      httpClient: webHttpClient,
      passkeyCeremony: webPasskeyCeremony,
      sessionCredentials: webSessionCredentials,
      nodeLifecycle: {
        activate: async () => undefined,
        suspend: async () => undefined,
        deactivate: async () => undefined,
        clearNodeScopedState: clearWebHostedNodeScopedState,
        writePrimaryEnvironmentDescriptor,
        connectPrimaryEnvironment,
        disconnectPrimaryEnvironment,
        setActiveEnvironmentId: (environmentId) =>
          useStore.getState().setActiveEnvironmentId(environmentId),
      },
      timers: {
        now: () => Date.now(),
        setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
        clearTimeout: (timer) => globalThis.clearTimeout(timer),
        queueMicrotask: (callback) => globalThis.queueMicrotask(callback),
      },
      isForeground: () => globalThis.document?.visibilityState !== "hidden",
      subscribeForeground: (listener) => {
        const onVisibility = () => {
          if (globalThis.document?.visibilityState === "visible") listener();
        };
        globalThis.document?.addEventListener("visibilitychange", onVisibility, { once: true });
        return () => globalThis.document?.removeEventListener("visibilitychange", onVisibility);
      },
      hasPendingRelayRequests: hasHostedRelayPendingRequests,
      resetRelayAttemptFactory: resetHostedRelayAttemptFactory,
      relayUrl: hostedRelayWebSocketUrl,
      createRelaySocket: (input) => new BrowserHostedRelaySocket(input),
    },
    api,
  );
}
