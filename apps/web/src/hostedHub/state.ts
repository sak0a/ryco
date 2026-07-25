import {
  hostedAccountStore,
  hostedHubController,
  hostedHubStore,
  markHostedSessionReady,
  markHostedSessionReplaying,
  reportHostedShellSnapshotFailure,
  setHostedRuntimeConfigurator,
  HOSTED_SESSION_SYNC_FAILURE_MESSAGE,
  type HostedAccountState,
  type HostedHubState,
} from "@ryco/client-runtime/authorization";
import { useStore } from "zustand";

import { configureWebHostedRuntime } from "./runtime";
import { hostedHubApi } from "./api";

/**
 * Register the web runtime wiring as a lazy configurator rather than running it
 * at import: importing the controller/store for their bindings has no import
 * side effect on the environment services, so suites can mock those services;
 * the runtime is wired on first genuine use, or eagerly at the boot gate.
 */
setHostedRuntimeConfigurator(() => configureWebHostedRuntime(hostedHubApi));

export function ensureWebHostedRuntimeConfigured(): void {
  configureWebHostedRuntime(hostedHubApi);
}

export {
  hostedAccountStore,
  hostedHubController,
  hostedHubStore,
  markHostedSessionReady,
  markHostedSessionReplaying,
  reportHostedShellSnapshotFailure,
  HOSTED_SESSION_SYNC_FAILURE_MESSAGE,
};
export type { HostedAccountState, HostedHubState };

type HostedHubSelector<T> = (state: HostedHubState) => T;

/** React binding for the package-owned hosted lifecycle state. */
export const useHostedHubStore = Object.assign(
  <T>(selector: HostedHubSelector<T>): T =>
    useStore(hostedHubStore as never, selector as never) as T,
  hostedHubStore,
);

type HostedAccountSelector<T> = (state: HostedAccountState) => T;

/**
 * React binding for the package-owned account-management state.
 *
 * Deliberately a second store rather than a slice of {@link useHostedHubStore}:
 * the runtime keeps the account surface out of the relay/session state so an
 * account read never re-renders a relay consumer, and the binding mirrors that
 * split rather than collapsing it here.
 */
export const useHostedAccountStore = Object.assign(
  <T>(selector: HostedAccountSelector<T>): T =>
    useStore(hostedAccountStore as never, selector as never) as T,
  hostedAccountStore,
);
