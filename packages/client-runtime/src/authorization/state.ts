import type { EnvironmentId, RelayEffectiveRole } from "@ryco/contracts";

import { HostedHubApiError } from "./api.ts";
import { activateHostedNode, deactivateHostedNode, suspendHostedNode } from "./environment.ts";
import { getHostedHubApi, getHostedRuntimeConfiguration } from "./runtime.ts";
import type {
  HostedAccountStatus,
  HostedBrowserStatus,
  HostedDirectoryStatus,
  HostedHubAccount,
  HostedHubNode,
  HostedHubPasskey,
  HostedHubSession,
  HostedHubSessionResponse,
  HostedRelayFailure,
  HostedRelayTransportStatus,
  HostedRycoSessionStatus,
  HostedSelectionStatus,
} from "./types.ts";

export interface HostedHubState {
  readonly bootstrapAvailable: boolean;
  readonly accountStatus: HostedAccountStatus;
  readonly account: HostedHubAccount | null;
  readonly session: HostedHubSession | null;
  readonly directoryStatus: HostedDirectoryStatus;
  readonly nodes: ReadonlyArray<HostedHubNode>;
  readonly selectedNode: HostedHubNode | null;
  readonly selectionStatus: HostedSelectionStatus;
  readonly effectiveRole: RelayEffectiveRole | null;
  readonly transportStatus: HostedRelayTransportStatus;
  readonly sessionStatus: HostedRycoSessionStatus;
  readonly sessionEstablished: boolean;
  readonly sessionRecoveredAfterUnknown: boolean;
  readonly browserStatus: HostedBrowserStatus;
  readonly recoveryCodes: ReadonlyArray<string>;
  readonly errorMessage: string | null;
  readonly generation: number;
}

const initialState: HostedHubState = {
  bootstrapAvailable: false,
  accountStatus: "signed-out",
  account: null,
  session: null,
  directoryStatus: "idle",
  nodes: [],
  selectedNode: null,
  selectionStatus: "none",
  effectiveRole: null,
  transportStatus: "idle",
  sessionStatus: "closed",
  sessionEstablished: false,
  sessionRecoveredAfterUnknown: false,
  browserStatus: "current",
  recoveryCodes: [],
  errorMessage: null,
  generation: 0,
};

export type HostedPasskeyDirectoryStatus = "idle" | "loading" | "ready" | "stale";

export type HostedAccountActionStatus =
  | "idle"
  | "adding-passkey"
  | "revoking-passkey"
  | "loading-recovery-codes";

/**
 * Account-management surface state. Kept in its own store rather than widened
 * into {@link HostedHubState} so the relay/session lifecycle state — republished
 * on every transport and session transition — is not perturbed by an account
 * screen, and so an account read never re-renders a relay consumer.
 *
 * No secret material lives here. A passkey `id` is a public credential
 * identifier; recovery codes are deliberately *not* stored here — they go to the
 * existing single-display `hostedHubStore.recoveryCodes` slot that
 * `dismissRecoveryCodes` already clears.
 */
export interface HostedAccountState {
  readonly passkeys: ReadonlyArray<HostedHubPasskey>;
  readonly passkeysStatus: HostedPasskeyDirectoryStatus;
  readonly actionStatus: HostedAccountActionStatus;
  readonly errorMessage: string | null;
}

const initialAccountState: HostedAccountState = {
  passkeys: [],
  passkeysStatus: "idle",
  actionStatus: "idle",
  errorMessage: null,
};

type HostedHubStoreListener = () => void;

/** Neutral external store; React binding remains in the web adapter. */
function createHostedStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<HostedHubStoreListener>();
  const publish = () => listeners.forEach((listener) => listener());
  return {
    getState: () => state,
    getInitialState: () => initial,
    setState: (patch: Partial<T> | T, replace = false) => {
      state = replace ? (patch as T) : { ...state, ...patch };
      publish();
    },
    subscribe: (listener: HostedHubStoreListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const hostedHubStore = createHostedStore(initialState);

export const hostedAccountStore = createHostedStore(initialAccountState);

function patchState(patch: Partial<HostedHubState>): void {
  hostedHubStore.setState(patch);
}

function patchAccountState(patch: Partial<HostedAccountState>): void {
  hostedAccountStore.setState(patch);
}

function errorMessage(error: unknown): string {
  if (error instanceof HostedHubApiError) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "NotAllowedError"
  ) {
    return "The passkey request was cancelled or denied.";
  }
  if (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")
    return "";
  return "Hub is temporarily unavailable.";
}

function isSessionFailure(error: unknown): boolean {
  return (
    error instanceof HostedHubApiError && (error.status === 401 || error.code === "session_invalid")
  );
}

const DIRECTORY_REFRESH_MS = 20_000;
const DIRECTORY_RETRY_MAX_MS = 60_000;
const HOSTED_SESSION_SYNC_DEADLINE_MS = 30_000;
export const HOSTED_SESSION_SYNC_FAILURE_MESSAGE = "Ryco state could not be synchronized.";

class HostedHubController {
  #operation: AbortController | null = null;
  #directoryTimer: ReturnType<typeof setTimeout> | null = null;
  #directoryRetry = 0;
  #directoryOperation: AbortController | null = null;
  #directoryPromise: Promise<void> | null = null;
  #bootstrapPromise: Promise<void> | null = null;
  #sessionSyncTimer: ReturnType<typeof setTimeout> | null = null;
  #retrySelectedNodeOperation: AbortController | null = null;
  #retrySelectedNodePromise: Promise<void> | null = null;
  #browserResumeOperation: AbortController | null = null;
  #browserResumePromise: Promise<void> | null = null;
  #browserSuspendPromise: Promise<void> | null = null;
  #browserLifecycleGeneration = 0;
  #passkeysOperation: AbortController | null = null;
  #passkeysPromise: Promise<void> | null = null;
  #accountOperation: AbortController | null = null;

  bootstrap(): Promise<void> {
    if (this.#bootstrapPromise) return this.#bootstrapPromise;
    const operation = this.#replaceOperation();
    const promise = getHostedHubApi()
      .restoreSession(operation.signal)
      .then(async (result) => {
        patchState({
          accountStatus: "authenticated",
          account: result.account,
          session: result.session,
          errorMessage: null,
        });
        await this.refreshDirectory();
      })
      .catch((error) => {
        if (operation.signal.aborted) return undefined;
        getHostedHubApi().clearSessionMaterial();
        if (isSessionFailure(error)) {
          return getHostedHubApi()
            .getBootstrapAvailability(operation.signal)
            .catch(() => false)
            .then((bootstrapAvailable) => {
              if (!operation.signal.aborted) patchState({ ...initialState, bootstrapAvailable });
            });
        }
        patchState({
          ...initialState,
          accountStatus: "unavailable",
          errorMessage: errorMessage(error),
        });
        return undefined;
      })
      .finally(() => {
        if (this.#operation === operation) this.#operation = null;
        if (this.#bootstrapPromise === promise) this.#bootstrapPromise = null;
      });
    this.#bootstrapPromise = promise;
    return promise;
  }

  async signIn(): Promise<void> {
    const operation = this.#replaceOperation();
    patchState({ accountStatus: "authenticating", errorMessage: null, recoveryCodes: [] });
    try {
      const result = await getHostedHubApi().signIn(operation.signal);
      patchState({
        accountStatus: "authenticated",
        account: result.account,
        session: result.session,
      });
      await this.refreshDirectory();
    } catch (error) {
      if (operation.signal.aborted) return;
      patchState({ accountStatus: "signed-out", errorMessage: errorMessage(error) || null });
    } finally {
      if (this.#operation === operation) this.#operation = null;
    }
  }

  async redeemInvitation(input: {
    readonly secret: string;
    readonly displayName: string;
    readonly passkeyLabel: string | null;
  }): Promise<void> {
    return this.#registerAccount((signal) => getHostedHubApi().redeemInvitation(input, signal));
  }

  async bootstrapOwner(input: {
    readonly credential: string;
    readonly displayName: string;
    readonly passkeyLabel: string | null;
  }): Promise<void> {
    return this.#registerAccount((signal) => getHostedHubApi().bootstrapOwner(input, signal));
  }

  async #registerAccount(
    register: (signal: AbortSignal) => Promise<HostedHubSessionResponse>,
  ): Promise<void> {
    const operation = this.#replaceOperation();
    patchState({ accountStatus: "authenticating", errorMessage: null, recoveryCodes: [] });
    try {
      const result = await register(operation.signal);
      patchState({
        accountStatus: "authenticated",
        account: result.account,
        session: result.session,
        recoveryCodes: result.recoveryCodes ?? [],
        bootstrapAvailable: false,
      });
      await this.refreshDirectory();
    } catch (error) {
      if (operation.signal.aborted) return;
      patchState({ accountStatus: "signed-out", errorMessage: errorMessage(error) || null });
    } finally {
      if (this.#operation === operation) this.#operation = null;
    }
  }

  cancelAuthentication(): void {
    this.#operation?.abort();
    this.#operation = null;
    patchState({ accountStatus: "signed-out", errorMessage: null });
  }

  dismissRecoveryCodes(): void {
    patchState({ recoveryCodes: [] });
  }

  /**
   * Load the account's passkeys. Deduplicated like the node directory: a second
   * caller joins the in-flight read rather than issuing a second request.
   */
  refreshPasskeys(): Promise<void> {
    if (this.#passkeysPromise) return this.#passkeysPromise;
    const operation = new AbortController();
    this.#passkeysOperation = operation;
    const promise = this.#refreshPasskeys(operation).finally(() => {
      if (this.#passkeysOperation === operation) this.#passkeysOperation = null;
      if (this.#passkeysPromise === promise) this.#passkeysPromise = null;
    });
    this.#passkeysPromise = promise;
    return promise;
  }

  async #refreshPasskeys(operation: AbortController): Promise<void> {
    const state = hostedHubStore.getState();
    if (state.accountStatus !== "authenticated") return;
    const sessionId = state.session?.id ?? null;
    if (hostedAccountStore.getState().passkeys.length === 0) {
      patchAccountState({ passkeysStatus: "loading" });
    }
    try {
      const passkeys = await getHostedHubApi().listPasskeys(operation.signal);
      if (!this.#isCurrentAccountSession(operation.signal, sessionId)) return;
      patchAccountState({ passkeys, passkeysStatus: "ready", errorMessage: null });
    } catch (error) {
      if (operation.signal.aborted) return;
      if (isSessionFailure(error)) {
        await this.expireSession();
        return;
      }
      if (!this.#isCurrentAccountSession(operation.signal, sessionId)) return;
      patchAccountState({ passkeysStatus: "stale", errorMessage: errorMessage(error) || null });
    }
  }

  /** Enrol an additional passkey on the signed-in account ("add this device"). */
  async addPasskey(input: { readonly passkeyLabel: string | null }): Promise<void> {
    const committed = await this.#accountAction("adding-passkey", async (signal) => {
      await getHostedHubApi().addPasskey(input, signal);
      return () => undefined;
    });
    if (committed) await this.refreshPasskeys();
  }

  async revokePasskey(credentialId: string): Promise<void> {
    const committed = await this.#accountAction("revoking-passkey", async (signal) => {
      await getHostedHubApi().revokePasskey(credentialId, signal);
      return () => undefined;
    });
    if (committed) await this.refreshPasskeys();
  }

  /**
   * Fetch recovery codes for a single display. They land in the existing
   * `recoveryCodes` slot — in memory only, cleared by `dismissRecoveryCodes` and
   * by any account teardown — and are never written to the account store, an
   * error message, or a log.
   */
  async loadRecoveryCodes(): Promise<void> {
    await this.#accountAction("loading-recovery-codes", async (signal) => {
      const recoveryCodes = await getHostedHubApi().getRecoveryCodes(signal);
      return () => patchState({ recoveryCodes });
    });
  }

  /**
   * Run one account-surface mutation at a time, publishing its result only
   * behind the same session fence the directory refresh uses. `run` returns the
   * commit thunk so nothing reaches a store before that fence passes. Resolves
   * `true` when the action committed.
   */
  async #accountAction(
    status: Exclude<HostedAccountActionStatus, "idle">,
    run: (signal: AbortSignal) => Promise<() => void>,
  ): Promise<boolean> {
    if (hostedAccountStore.getState().actionStatus !== "idle") return false;
    const state = hostedHubStore.getState();
    if (state.accountStatus !== "authenticated") return false;
    const sessionId = state.session?.id ?? null;
    const operation = new AbortController();
    this.#accountOperation = operation;
    patchAccountState({ actionStatus: status, errorMessage: null });
    try {
      const commit = await run(operation.signal);
      if (!this.#isCurrentAccountSession(operation.signal, sessionId)) return false;
      commit();
      return true;
    } catch (error) {
      if (operation.signal.aborted) return false;
      if (isSessionFailure(error)) {
        await this.expireSession();
        return false;
      }
      if (!this.#isCurrentAccountSession(operation.signal, sessionId)) return false;
      patchAccountState({ errorMessage: errorMessage(error) || null });
      return false;
    } finally {
      if (this.#accountOperation === operation) {
        this.#accountOperation = null;
        if (hostedAccountStore.getState().actionStatus === status) {
          patchAccountState({ actionStatus: "idle" });
        }
      }
    }
  }

  /**
   * Fence an account-surface result: a result may only publish while the same
   * Hub session that issued the request is still the authenticated one.
   */
  #isCurrentAccountSession(signal: AbortSignal, sessionId: string | null): boolean {
    const active = hostedHubStore.getState();
    return (
      !signal.aborted &&
      active.accountStatus === "authenticated" &&
      (active.session?.id ?? null) === sessionId
    );
  }

  #clearAccountSurface(): void {
    this.#passkeysOperation?.abort();
    this.#passkeysOperation = null;
    this.#passkeysPromise = null;
    this.#accountOperation?.abort();
    this.#accountOperation = null;
    hostedAccountStore.setState(initialAccountState, true);
  }

  resetForTests(): void {
    this.#operation?.abort();
    this.#operation = null;
    this.#clearDirectoryTimer();
    this.#directoryRetry = 0;
    this.#directoryOperation?.abort();
    this.#directoryOperation = null;
    this.#directoryPromise = null;
    this.#bootstrapPromise = null;
    this.#clearSessionSyncTimer();
    this.#retrySelectedNodeOperation?.abort();
    this.#retrySelectedNodeOperation = null;
    this.#retrySelectedNodePromise = null;
    this.#browserResumeOperation?.abort();
    this.#browserResumeOperation = null;
    this.#browserResumePromise = null;
    this.#browserSuspendPromise = null;
    this.#browserLifecycleGeneration += 1;
    this.#clearAccountSurface();
    getHostedHubApi().clearSessionMaterial();
    hostedHubStore.setState(initialState, true);
  }

  async signOut(): Promise<void> {
    const operation = this.#replaceOperation();
    patchState({ accountStatus: "signing-out", errorMessage: null });
    try {
      await getHostedHubApi().signOut(operation.signal);
    } catch (error) {
      if (!isSessionFailure(error) && !operation.signal.aborted) {
        patchState({ accountStatus: "authenticated", errorMessage: errorMessage(error) });
        return;
      }
    } finally {
      if (this.#operation === operation) this.#operation = null;
    }
    await this.clearAccount("signed-out");
  }

  async expireSession(): Promise<void> {
    getHostedHubApi().clearSessionMaterial();
    await this.clearAccount("session-expired");
  }

  suspendBrowser(reason: "hidden" | "offline"): void {
    const state = hostedHubStore.getState();
    if (state.accountStatus !== "authenticated") return;
    this.#browserLifecycleGeneration += 1;
    this.#browserResumeOperation?.abort();
    this.#browserResumeOperation = null;
    this.#browserResumePromise = null;
    this.#retrySelectedNodeOperation?.abort();
    this.#clearSessionSyncTimer();
    this.#clearDirectoryTimer();
    this.#directoryOperation?.abort();
    this.#directoryOperation = null;
    this.#directoryPromise = null;
    patchState({
      browserStatus: reason === "offline" ? "offline" : "suspended",
      sessionStatus: state.sessionStatus === "delivery-unknown" ? "delivery-unknown" : "stale",
      sessionRecoveredAfterUnknown: false,
      generation: state.generation + 1,
    });
    if (state.selectedNode && !this.#browserSuspendPromise) {
      const environmentId = state.selectedNode.environmentId;
      const promise = suspendHostedNode(environmentId)
        .catch(() => undefined)
        .finally(() => {
          if (this.#browserSuspendPromise === promise) this.#browserSuspendPromise = null;
        });
      this.#browserSuspendPromise = promise;
    }
  }

  resumeBrowser(): Promise<void> {
    if (this.#browserResumePromise) return this.#browserResumePromise;
    const operation = new AbortController();
    this.#browserResumeOperation = operation;
    const promise = this.#resumeBrowser(operation).finally(() => {
      if (this.#browserResumePromise === promise) this.#browserResumePromise = null;
      if (this.#browserResumeOperation === operation) this.#browserResumeOperation = null;
    });
    this.#browserResumePromise = promise;
    return promise;
  }

  async #resumeBrowser(operation: AbortController): Promise<void> {
    const initial = hostedHubStore.getState();
    if (initial.accountStatus !== "authenticated") return;
    const browserGeneration = this.#browserLifecycleGeneration + 1;
    this.#browserLifecycleGeneration = browserGeneration;
    const expectedAccountId = initial.account?.id ?? null;
    patchState({ browserStatus: "checking-access", errorMessage: null });
    try {
      const restored = await getHostedHubApi().restoreSession(operation.signal);
      if (operation.signal.aborted || this.#browserLifecycleGeneration !== browserGeneration)
        return;
      const active = hostedHubStore.getState();
      if (active.accountStatus !== "authenticated" || restored.account.id !== expectedAccountId) {
        await this.expireSession();
        return;
      }
      patchState({ account: restored.account, session: restored.session });
      await this.refreshDirectory();
      if (this.#browserLifecycleGeneration !== browserGeneration) return;
      const refreshed = hostedHubStore.getState();
      if (refreshed.accountStatus !== "authenticated") return;
      if (refreshed.directoryStatus !== "ready") {
        patchState({ browserStatus: "stale" });
        return;
      }
      if (!refreshed.selectedNode) {
        patchState({ browserStatus: "current" });
        return;
      }
      patchState({ browserStatus: "synchronizing" });
      await this.#retrySelectedNode(operation.signal);
    } catch (error) {
      if (operation.signal.aborted || this.#browserLifecycleGeneration !== browserGeneration)
        return;
      if (isSessionFailure(error)) {
        await this.expireSession();
        return;
      }
      patchState({ browserStatus: "stale", errorMessage: errorMessage(error) });
    }
  }

  async clearAccount(status: "signed-out" | "session-expired"): Promise<void> {
    this.#browserLifecycleGeneration += 1;
    this.#browserResumeOperation?.abort();
    this.#browserResumeOperation = null;
    this.#browserResumePromise = null;
    this.#retrySelectedNodeOperation?.abort();
    this.#retrySelectedNodeOperation = null;
    this.#retrySelectedNodePromise = null;
    this.#clearDirectoryTimer();
    this.#clearSessionSyncTimer();
    this.#directoryOperation?.abort();
    this.#directoryOperation = null;
    this.#directoryPromise = null;
    this.#operation?.abort();
    this.#operation = null;
    this.#clearAccountSurface();
    const previousEnvironmentId = hostedHubStore.getState().selectedNode?.environmentId ?? null;
    patchState({
      ...initialState,
      accountStatus: status,
      generation: hostedHubStore.getState().generation + 1,
    });
    if (previousEnvironmentId) {
      await deactivateHostedNode(previousEnvironmentId);
    }
  }

  refreshDirectory(): Promise<void> {
    if (this.#directoryPromise) return this.#directoryPromise;
    const operation = new AbortController();
    this.#directoryOperation = operation;
    const promise = this.#refreshDirectory(operation).finally(() => {
      if (this.#directoryOperation === operation) this.#directoryOperation = null;
      if (this.#directoryPromise === promise) this.#directoryPromise = null;
    });
    this.#directoryPromise = promise;
    return promise;
  }

  async #refreshDirectory(operation: AbortController): Promise<void> {
    const state = hostedHubStore.getState();
    if (state.accountStatus !== "authenticated") return;
    const sessionId = state.session?.id ?? null;
    this.#clearDirectoryTimer();
    patchState({ directoryStatus: state.nodes.length === 0 ? "loading" : state.directoryStatus });
    try {
      const nodes = await getHostedHubApi().listNodes(operation.signal);
      const active = hostedHubStore.getState();
      if (
        operation.signal.aborted ||
        active.accountStatus !== "authenticated" ||
        active.session?.id !== sessionId
      ) {
        return;
      }
      this.#directoryRetry = 0;
      const current = hostedHubStore.getState();
      const resumeStaleBrowser = current.browserStatus === "stale";
      const selected = current.selectedNode;
      const refreshedSelection = selected
        ? (nodes.find(
            (node) => node.id === selected.id && node.environmentId === selected.environmentId,
          ) ?? null)
        : null;
      if (selected && (!refreshedSelection || refreshedSelection.revokedAt !== null)) {
        const generation = current.generation + 1;
        patchState({
          nodes,
          directoryStatus: "ready",
          selectionStatus:
            refreshedSelection && refreshedSelection.revokedAt !== null
              ? "revoked"
              : "authorization-removed",
          effectiveRole: null,
          generation,
        });
        await this.#deactivateSelection(selected.environmentId, generation);
      } else {
        patchState({
          nodes,
          directoryStatus: "ready",
          ...(refreshedSelection
            ? {
                selectedNode: refreshedSelection,
                selectionStatus: refreshedSelection.presence.online ? "online" : "offline",
                effectiveRole: refreshedSelection.effectiveRole,
              }
            : {}),
        });
      }
      this.#scheduleDirectory(DIRECTORY_REFRESH_MS);
      if (resumeStaleBrowser) {
        getHostedRuntimeConfiguration().timers.queueMicrotask(() => {
          const recovered = hostedHubStore.getState();
          if (
            recovered.accountStatus === "authenticated" &&
            recovered.directoryStatus === "ready" &&
            recovered.browserStatus === "stale"
          ) {
            void this.resumeBrowser();
          }
        });
      }
    } catch (error) {
      if (operation.signal.aborted) return;
      if (isSessionFailure(error)) {
        await this.expireSession();
        return;
      }
      this.#directoryRetry += 1;
      patchState({
        directoryStatus: "stale",
        effectiveRole: null,
        errorMessage: errorMessage(error),
      });
      const delay = Math.min(
        DIRECTORY_RETRY_MAX_MS,
        1_000 * 2 ** Math.min(this.#directoryRetry, 6),
      );
      this.#scheduleDirectory(delay);
    }
  }

  async selectNode(nodeId: string): Promise<void> {
    const state = hostedHubStore.getState();
    if (state.directoryStatus !== "ready" || state.browserStatus !== "current") return;
    const node = state.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.revokedAt) return;
    if (
      state.selectedNode?.id === node.id &&
      state.selectedNode.environmentId === node.environmentId
    )
      return;
    const generation = state.generation + 1;
    patchState({
      selectedNode: node,
      selectionStatus: node.presence.online ? "online" : "offline",
      effectiveRole: node.effectiveRole,
      transportStatus: "idle",
      sessionStatus: "synchronizing",
      sessionEstablished: false,
      sessionRecoveredAfterUnknown: false,
      errorMessage: null,
      generation,
    });
    this.#startSessionSyncTimer(generation);
    try {
      await activateHostedNode(node, state.selectedNode?.environmentId ?? null);
    } catch {
      this.#failSessionSync(generation);
    }
  }

  /**
   * Deactivate the selected node and return to the node directory without
   * touching the Hub session. Used by history navigation (Back to the
   * directory) and by fail-closed route fallbacks. Follows the documented
   * switching-nodes teardown order via `deactivateHostedNode`; the generation
   * bump prevents stale relay attempts from publishing readiness or role.
   * `preserveTerminalSelection` keeps a terminal selection status (revoked,
   * authorization removed, incompatible) and its bounded message so the
   * directory renders the existing explanation.
   */
  async returnToDirectory(options?: {
    readonly preserveTerminalSelection?: boolean;
  }): Promise<void> {
    const state = hostedHubStore.getState();
    const node = state.selectedNode;
    if (!node) return;
    const preserve = options?.preserveTerminalSelection === true;
    // Mirror clearAccount: an in-flight browser resume belongs to the
    // selection being torn down. Abort it and invalidate its lifecycle
    // generation so it can neither publish stale state nor leave
    // browserStatus stuck in a node-scoped phase that would gate every
    // subsequent selection.
    this.#browserLifecycleGeneration += 1;
    this.#browserResumeOperation?.abort();
    this.#browserResumeOperation = null;
    this.#browserResumePromise = null;
    this.#retrySelectedNodeOperation?.abort();
    this.#retrySelectedNodeOperation = null;
    this.#retrySelectedNodePromise = null;
    this.#clearSessionSyncTimer();
    patchState({
      selectedNode: null,
      selectionStatus: preserve ? state.selectionStatus : "none",
      effectiveRole: null,
      transportStatus: "idle",
      sessionStatus: "closed",
      sessionEstablished: false,
      sessionRecoveredAfterUnknown: false,
      browserStatus:
        state.browserStatus === "synchronizing" || state.browserStatus === "checking-access"
          ? "current"
          : state.browserStatus,
      errorMessage: preserve ? state.errorMessage : null,
      generation: state.generation + 1,
    });
    await deactivateHostedNode(node.environmentId);
  }

  retrySelectedNode(): Promise<void> {
    if (this.#retrySelectedNodePromise) return this.#retrySelectedNodePromise;
    const operation = new AbortController();
    this.#retrySelectedNodeOperation = operation;
    const promise = this.#retrySelectedNode(operation.signal).finally(() => {
      if (this.#retrySelectedNodeOperation === operation) {
        this.#retrySelectedNodeOperation = null;
      }
      if (this.#retrySelectedNodePromise === promise) this.#retrySelectedNodePromise = null;
    });
    this.#retrySelectedNodePromise = promise;
    return promise;
  }

  async #retrySelectedNode(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    await this.#browserSuspendPromise;
    if (signal.aborted) return;
    let state = hostedHubStore.getState();
    const node = state.selectedNode;
    if (
      !node ||
      node.revokedAt !== null ||
      state.accountStatus !== "authenticated" ||
      state.directoryStatus !== "ready"
    ) {
      return;
    }
    state = hostedHubStore.getState();
    if (
      signal.aborted ||
      state.selectedNode?.id !== node.id ||
      state.selectedNode.environmentId !== node.environmentId ||
      state.selectedNode.revokedAt !== null ||
      state.accountStatus !== "authenticated" ||
      state.directoryStatus !== "ready"
    ) {
      return;
    }
    const deliveryUnknown =
      state.sessionStatus === "delivery-unknown" ||
      getHostedRuntimeConfiguration().hasPendingRelayRequests();
    const generation = state.generation + 1;
    this.#clearSessionSyncTimer();
    patchState({
      selectionStatus: node.presence.online ? "online" : "offline",
      effectiveRole: node.effectiveRole,
      transportStatus: "idle",
      sessionStatus: deliveryUnknown ? "delivery-unknown" : "synchronizing",
      sessionEstablished: false,
      sessionRecoveredAfterUnknown: false,
      errorMessage: null,
      generation,
    });
    this.#startSessionSyncTimer(generation);
    try {
      await activateHostedNode(node, node.environmentId, signal);
    } catch {
      if (signal.aborted) return;
      this.#failSessionSync(generation);
    }
  }

  transportStatus(generation: number, status: HostedRelayTransportStatus): void {
    if (hostedHubStore.getState().generation !== generation) return;
    patchState({ transportStatus: status });
  }

  sessionStatus(generation: number, status: HostedRycoSessionStatus): void {
    const state = hostedHubStore.getState();
    if (state.generation !== generation) return;
    if (state.sessionStatus === "delivery-unknown" && status !== "closed") {
      patchState({ sessionRecoveredAfterUnknown: false });
      return;
    }
    patchState({ sessionStatus: status, sessionRecoveredAfterUnknown: false });
  }

  role(generation: number, role: RelayEffectiveRole | null): void {
    const state = hostedHubStore.getState();
    if (state.generation !== generation) return;
    patchState({ effectiveRole: state.directoryStatus === "ready" ? role : null });
  }

  failure(generation: number, failure: HostedRelayFailure): void {
    const state = hostedHubStore.getState();
    if (state.generation !== generation) return;
    const selectionStatus: HostedSelectionStatus =
      failure.kind === "revoked"
        ? "revoked"
        : failure.kind === "authorization-removed"
          ? "authorization-removed"
          : failure.kind === "incompatible"
            ? "incompatible"
            : state.selectedNode?.presence.online
              ? state.selectionStatus
              : "offline";
    if (!failure.retryable) this.#clearSessionSyncTimer();
    patchState({
      selectionStatus,
      effectiveRole: failure.retryable ? state.effectiveRole : null,
      transportStatus: failure.retryable ? "reconnecting" : "terminal-failure",
      sessionStatus: state.sessionStatus === "delivery-unknown" ? "delivery-unknown" : "stale",
      browserStatus:
        !failure.retryable && state.browserStatus === "synchronizing"
          ? "current"
          : state.browserStatus,
      errorMessage: failureMessage(failure),
    });
  }

  markDeliveryUnknown(generation: number): void {
    if (hostedHubStore.getState().generation !== generation) return;
    patchState({ sessionStatus: "delivery-unknown", sessionRecoveredAfterUnknown: false });
  }

  connectionClosed(generation: number): void {
    const state = hostedHubStore.getState();
    if (state.generation !== generation || state.transportStatus === "terminal-failure") return;
    patchState({
      effectiveRole: null,
      transportStatus: "reconnecting",
      sessionStatus: state.sessionStatus === "delivery-unknown" ? "delivery-unknown" : "stale",
      sessionRecoveredAfterUnknown: false,
    });
  }

  markSessionReady(environmentId: EnvironmentId): void {
    const state = hostedHubStore.getState();
    if (state.selectedNode?.environmentId !== environmentId) return;
    this.#clearSessionSyncTimer();
    if (state.sessionStatus === "delivery-unknown") {
      patchState({
        sessionEstablished: true,
        sessionRecoveredAfterUnknown: true,
        browserStatus: state.browserStatus === "synchronizing" ? "current" : state.browserStatus,
      });
      return;
    }
    patchState({
      sessionStatus: "ready",
      sessionEstablished: true,
      sessionRecoveredAfterUnknown: false,
      browserStatus: state.browserStatus === "synchronizing" ? "current" : state.browserStatus,
    });
  }

  markSessionReplaying(environmentId: EnvironmentId): void {
    const state = hostedHubStore.getState();
    if (state.selectedNode?.environmentId !== environmentId) return;
    if (state.sessionStatus === "delivery-unknown") {
      patchState({ sessionRecoveredAfterUnknown: false });
      return;
    }
    patchState({
      sessionStatus: "replaying",
      browserStatus:
        state.browserStatus === "current" || state.browserStatus === "synchronizing"
          ? "synchronizing"
          : state.browserStatus,
    });
  }

  reportShellSnapshotFailure(environmentId: EnvironmentId): void {
    const state = hostedHubStore.getState();
    if (state.selectedNode?.environmentId !== environmentId) return;
    if (state.sessionEstablished) {
      console.warn("hosted_snapshot_reconciliation_failed");
      return;
    }
    this.#failSessionSync(state.generation);
  }

  acknowledgeDeliveryUnknown(): void {
    const state = hostedHubStore.getState();
    if (state.sessionStatus !== "delivery-unknown" || !state.sessionRecoveredAfterUnknown) return;
    patchState({ sessionStatus: "ready", sessionRecoveredAfterUnknown: false });
  }

  #replaceOperation(): AbortController {
    this.#operation?.abort();
    const operation = new AbortController();
    this.#operation = operation;
    return operation;
  }

  #scheduleDirectory(delay: number): void {
    this.#clearDirectoryTimer();
    const runtime = getHostedRuntimeConfiguration();
    if (!runtime.isForeground()) {
      const onVisibilityChange = () => {
        if (!runtime.isForeground()) return;
        this.#clearDirectoryTimer();
        void this.refreshDirectory();
      };
      runtime.subscribeForeground(onVisibilityChange);
      return;
    }
    this.#directoryTimer = runtime.timers.setTimeout(() => void this.refreshDirectory(), delay);
  }

  #clearDirectoryTimer(): void {
    if (this.#directoryTimer)
      getHostedRuntimeConfiguration().timers.clearTimeout(this.#directoryTimer);
    this.#directoryTimer = null;
  }

  #startSessionSyncTimer(generation: number): void {
    this.#clearSessionSyncTimer();
    const state = hostedHubStore.getState();
    if (state.generation !== generation || state.sessionEstablished) return;
    this.#sessionSyncTimer = getHostedRuntimeConfiguration().timers.setTimeout(
      () => this.#failSessionSync(generation),
      HOSTED_SESSION_SYNC_DEADLINE_MS,
    );
  }

  #clearSessionSyncTimer(): void {
    if (this.#sessionSyncTimer)
      getHostedRuntimeConfiguration().timers.clearTimeout(this.#sessionSyncTimer);
    this.#sessionSyncTimer = null;
  }

  #failSessionSync(generation: number): void {
    const state = hostedHubStore.getState();
    // Generation fence: a stale deadline whose callback already queued before
    // its timer was cleared must not terminal-fail a newer selection/session.
    if (state.generation !== generation || state.sessionEstablished) return;
    this.#clearSessionSyncTimer();
    patchState({
      transportStatus: "terminal-failure",
      sessionStatus: state.sessionStatus === "delivery-unknown" ? "delivery-unknown" : "stale",
      sessionEstablished: false,
      sessionRecoveredAfterUnknown: false,
      browserStatus: state.browserStatus === "synchronizing" ? "current" : state.browserStatus,
      errorMessage: HOSTED_SESSION_SYNC_FAILURE_MESSAGE,
    });
  }

  async #deactivateSelection(environmentId: EnvironmentId, generation: number): Promise<void> {
    this.#clearSessionSyncTimer();
    await deactivateHostedNode(environmentId);
    if (hostedHubStore.getState().generation !== generation) return;
    patchState({
      selectedNode: null,
      transportStatus: "idle",
      sessionStatus: "closed",
      sessionEstablished: false,
      sessionRecoveredAfterUnknown: false,
    });
  }
}

function failureMessage(failure: HostedRelayFailure): string {
  switch (failure.kind) {
    case "offline":
      return "The selected node is offline. Ryco will reconnect when it becomes available.";
    case "revoked":
      return "Access to the selected node was revoked.";
    case "authorization-removed":
      return "Your authorization for the selected node was removed.";
    case "incompatible":
      return "The selected node uses an incompatible relay protocol version.";
    case "draining":
      return "Hub is draining connections. Ryco will retry shortly.";
    case "slow-consumer":
      return "The relay closed a slow connection. Ryco will reconnect.";
    case "authentication":
      return "The relay authentication attempt expired or was rejected.";
    case "rate-limited":
      return "Relay attempts are temporarily rate limited.";
    default:
      return failure.retryable
        ? "The relay connection was interrupted. Ryco is reconnecting."
        : "The relay connection could not be established.";
  }
}

export const hostedHubController = new HostedHubController();

export function markHostedSessionReady(environmentId: EnvironmentId, generation: number): void {
  if (hostedHubStore.getState().generation !== generation) return;
  hostedHubController.markSessionReady(environmentId);
}

export function markHostedSessionReplaying(environmentId: EnvironmentId, generation: number): void {
  if (hostedHubStore.getState().generation !== generation) return;
  hostedHubController.markSessionReplaying(environmentId);
}

export function reportHostedShellSnapshotFailure(
  environmentId: EnvironmentId,
  generation: number,
): void {
  if (hostedHubStore.getState().generation !== generation) return;
  hostedHubController.reportShellSnapshotFailure(environmentId);
}
