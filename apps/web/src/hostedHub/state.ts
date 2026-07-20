import type { EnvironmentId, RelayEffectiveRole } from "@ryco/contracts";
import { create } from "zustand";

import { hostedHubApi, HostedHubApiError } from "./api";
import type {
  HostedAccountStatus,
  HostedBrowserStatus,
  HostedDirectoryStatus,
  HostedHubAccount,
  HostedHubNode,
  HostedHubSession,
  HostedHubSessionResponse,
  HostedRelayFailure,
  HostedRelayTransportStatus,
  HostedRycoSessionStatus,
  HostedSelectionStatus,
} from "./types";

interface HostedHubState {
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

export const useHostedHubStore = create<HostedHubState>()(() => initialState);

function patchState(patch: Partial<HostedHubState>): void {
  useHostedHubStore.setState(patch);
}

function errorMessage(error: unknown): string {
  if (error instanceof HostedHubApiError) return error.message;
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "The passkey request was cancelled or denied.";
  }
  if (error instanceof DOMException && error.name === "AbortError") return "";
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
  #directoryVisibilityListener: (() => void) | null = null;
  #directoryPromise: Promise<void> | null = null;
  #bootstrapPromise: Promise<void> | null = null;
  #sessionSyncTimer: ReturnType<typeof setTimeout> | null = null;
  #retrySelectedNodeOperation: AbortController | null = null;
  #retrySelectedNodePromise: Promise<void> | null = null;
  #browserResumeOperation: AbortController | null = null;
  #browserResumePromise: Promise<void> | null = null;
  #browserLifecycleGeneration = 0;

  bootstrap(): Promise<void> {
    if (this.#bootstrapPromise) return this.#bootstrapPromise;
    const operation = this.#replaceOperation();
    const promise = hostedHubApi
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
        hostedHubApi.clearSessionMaterial();
        if (isSessionFailure(error)) {
          return hostedHubApi
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
      const result = await hostedHubApi.signIn(operation.signal);
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
    return this.#registerAccount((signal) => hostedHubApi.redeemInvitation(input, signal));
  }

  async bootstrapOwner(input: {
    readonly credential: string;
    readonly displayName: string;
    readonly passkeyLabel: string | null;
  }): Promise<void> {
    return this.#registerAccount((signal) => hostedHubApi.bootstrapOwner(input, signal));
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
    this.#browserLifecycleGeneration += 1;
    hostedHubApi.clearSessionMaterial();
    useHostedHubStore.setState(initialState, true);
  }

  async signOut(): Promise<void> {
    const operation = this.#replaceOperation();
    patchState({ accountStatus: "signing-out", errorMessage: null });
    try {
      await hostedHubApi.signOut(operation.signal);
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
    hostedHubApi.clearSessionMaterial();
    await this.clearAccount("session-expired");
  }

  suspendBrowser(reason: "hidden" | "offline"): void {
    const state = useHostedHubStore.getState();
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
    });
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
    const initial = useHostedHubStore.getState();
    if (initial.accountStatus !== "authenticated") return;
    const browserGeneration = this.#browserLifecycleGeneration + 1;
    this.#browserLifecycleGeneration = browserGeneration;
    const expectedAccountId = initial.account?.id ?? null;
    patchState({ browserStatus: "checking-access", errorMessage: null });
    try {
      const restored = await hostedHubApi.restoreSession(operation.signal);
      if (operation.signal.aborted || this.#browserLifecycleGeneration !== browserGeneration)
        return;
      const active = useHostedHubStore.getState();
      if (active.accountStatus !== "authenticated" || restored.account.id !== expectedAccountId) {
        await this.expireSession();
        return;
      }
      patchState({ account: restored.account, session: restored.session });
      await this.refreshDirectory();
      if (this.#browserLifecycleGeneration !== browserGeneration) return;
      const refreshed = useHostedHubStore.getState();
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
    const previousEnvironmentId = useHostedHubStore.getState().selectedNode?.environmentId ?? null;
    patchState({
      ...initialState,
      accountStatus: status,
      generation: useHostedHubStore.getState().generation + 1,
    });
    if (previousEnvironmentId) {
      const { deactivateHostedNode } = await import("./environment");
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
    const state = useHostedHubStore.getState();
    if (state.accountStatus !== "authenticated") return;
    const sessionId = state.session?.id ?? null;
    this.#clearDirectoryTimer();
    patchState({ directoryStatus: state.nodes.length === 0 ? "loading" : state.directoryStatus });
    try {
      const nodes = await hostedHubApi.listNodes(operation.signal);
      const active = useHostedHubStore.getState();
      if (
        operation.signal.aborted ||
        active.accountStatus !== "authenticated" ||
        active.session?.id !== sessionId
      ) {
        return;
      }
      this.#directoryRetry = 0;
      const current = useHostedHubStore.getState();
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
        queueMicrotask(() => {
          const recovered = useHostedHubStore.getState();
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
    const state = useHostedHubStore.getState();
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
    const { activateHostedNode } = await import("./environment");
    try {
      await activateHostedNode(node, state.selectedNode?.environmentId ?? null);
    } catch {
      this.#failSessionSync(generation);
    }
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
    let state = useHostedHubStore.getState();
    const node = state.selectedNode;
    if (
      !node ||
      node.revokedAt !== null ||
      state.accountStatus !== "authenticated" ||
      state.directoryStatus !== "ready"
    ) {
      return;
    }
    const [{ hasHostedRelayPendingRequests }, { activateHostedNode }] = await Promise.all([
      import("./transport"),
      import("./environment"),
    ]);
    state = useHostedHubStore.getState();
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
      state.sessionStatus === "delivery-unknown" || hasHostedRelayPendingRequests();
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
    if (useHostedHubStore.getState().generation !== generation) return;
    patchState({ transportStatus: status });
  }

  sessionStatus(generation: number, status: HostedRycoSessionStatus): void {
    const state = useHostedHubStore.getState();
    if (state.generation !== generation) return;
    if (state.sessionStatus === "delivery-unknown" && status !== "closed") {
      patchState({ sessionRecoveredAfterUnknown: false });
      return;
    }
    patchState({ sessionStatus: status, sessionRecoveredAfterUnknown: false });
  }

  role(generation: number, role: RelayEffectiveRole | null): void {
    const state = useHostedHubStore.getState();
    if (state.generation !== generation) return;
    patchState({ effectiveRole: state.directoryStatus === "ready" ? role : null });
  }

  failure(generation: number, failure: HostedRelayFailure): void {
    const state = useHostedHubStore.getState();
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
    if (useHostedHubStore.getState().generation !== generation) return;
    patchState({ sessionStatus: "delivery-unknown", sessionRecoveredAfterUnknown: false });
  }

  connectionClosed(generation: number): void {
    const state = useHostedHubStore.getState();
    if (state.generation !== generation || state.transportStatus === "terminal-failure") return;
    patchState({
      effectiveRole: null,
      transportStatus: "reconnecting",
      sessionStatus: state.sessionStatus === "delivery-unknown" ? "delivery-unknown" : "stale",
      sessionRecoveredAfterUnknown: false,
    });
  }

  markSessionReady(environmentId: EnvironmentId): void {
    const state = useHostedHubStore.getState();
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
    const state = useHostedHubStore.getState();
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
    const state = useHostedHubStore.getState();
    if (state.selectedNode?.environmentId !== environmentId) return;
    if (state.sessionEstablished) {
      console.warn("hosted_snapshot_reconciliation_failed");
      return;
    }
    this.#failSessionSync(state.generation);
  }

  acknowledgeDeliveryUnknown(): void {
    const state = useHostedHubStore.getState();
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
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      const onVisibilityChange = () => {
        if (document.visibilityState !== "visible") return;
        this.#clearDirectoryTimer();
        void this.refreshDirectory();
      };
      this.#directoryVisibilityListener = onVisibilityChange;
      document.addEventListener("visibilitychange", onVisibilityChange, { once: true });
      return;
    }
    this.#directoryTimer = setTimeout(() => void this.refreshDirectory(), delay);
  }

  #clearDirectoryTimer(): void {
    if (this.#directoryTimer) clearTimeout(this.#directoryTimer);
    this.#directoryTimer = null;
    if (this.#directoryVisibilityListener && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.#directoryVisibilityListener);
    }
    this.#directoryVisibilityListener = null;
  }

  #startSessionSyncTimer(generation: number): void {
    this.#clearSessionSyncTimer();
    const state = useHostedHubStore.getState();
    if (state.generation !== generation || state.sessionEstablished) return;
    this.#sessionSyncTimer = setTimeout(
      () => this.#failSessionSync(generation),
      HOSTED_SESSION_SYNC_DEADLINE_MS,
    );
  }

  #clearSessionSyncTimer(): void {
    if (this.#sessionSyncTimer) clearTimeout(this.#sessionSyncTimer);
    this.#sessionSyncTimer = null;
  }

  #failSessionSync(generation: number): void {
    const state = useHostedHubStore.getState();
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
    const { deactivateHostedNode } = await import("./environment");
    await deactivateHostedNode(environmentId);
    if (useHostedHubStore.getState().generation !== generation) return;
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
  if (useHostedHubStore.getState().generation !== generation) return;
  hostedHubController.markSessionReady(environmentId);
}

export function markHostedSessionReplaying(environmentId: EnvironmentId, generation: number): void {
  if (useHostedHubStore.getState().generation !== generation) return;
  hostedHubController.markSessionReplaying(environmentId);
}

export function reportHostedShellSnapshotFailure(
  environmentId: EnvironmentId,
  generation: number,
): void {
  if (useHostedHubStore.getState().generation !== generation) return;
  hostedHubController.reportShellSnapshotFailure(environmentId);
}
