import type { EnvironmentId, RelayEffectiveRole } from "@ryco/contracts";
import { create } from "zustand";

import { hostedHubApi, HostedHubApiError } from "./api";
import type {
  HostedAccountStatus,
  HostedDirectoryStatus,
  HostedHubAccount,
  HostedHubNode,
  HostedHubSession,
  HostedRelayFailure,
  HostedRelayTransportStatus,
  HostedRycoSessionStatus,
  HostedSelectionStatus,
} from "./types";

interface HostedHubState {
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
  readonly sessionRecoveredAfterUnknown: boolean;
  readonly recoveryCodes: ReadonlyArray<string>;
  readonly errorMessage: string | null;
  readonly generation: number;
}

const initialState: HostedHubState = {
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
  sessionRecoveredAfterUnknown: false,
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

class HostedHubController {
  #operation: AbortController | null = null;
  #directoryTimer: ReturnType<typeof setTimeout> | null = null;
  #directoryRetry = 0;
  #directoryOperation: AbortController | null = null;
  #directoryPromise: Promise<void> | null = null;
  #bootstrapPromise: Promise<void> | null = null;

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
        if (operation.signal.aborted) return;
        hostedHubApi.clearSessionMaterial();
        if (isSessionFailure(error)) {
          patchState(initialState);
          return;
        }
        patchState({
          ...initialState,
          accountStatus: "unavailable",
          errorMessage: errorMessage(error),
        });
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
    const operation = this.#replaceOperation();
    patchState({ accountStatus: "authenticating", errorMessage: null, recoveryCodes: [] });
    try {
      const result = await hostedHubApi.redeemInvitation(input, operation.signal);
      patchState({
        accountStatus: "authenticated",
        account: result.account,
        session: result.session,
        recoveryCodes: result.recoveryCodes ?? [],
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

  async clearAccount(status: "signed-out" | "session-expired"): Promise<void> {
    this.#clearDirectoryTimer();
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
    if (state.directoryStatus !== "ready") return;
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
      sessionRecoveredAfterUnknown: false,
      errorMessage: null,
      generation,
    });
    const { activateHostedNode } = await import("./environment");
    await activateHostedNode(node, state.selectedNode?.environmentId ?? null);
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
    patchState({
      selectionStatus,
      effectiveRole: failure.retryable ? state.effectiveRole : null,
      transportStatus: failure.retryable ? "reconnecting" : "terminal-failure",
      sessionStatus: state.sessionStatus === "delivery-unknown" ? "delivery-unknown" : "stale",
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
    if (state.sessionStatus === "delivery-unknown") {
      patchState({ sessionRecoveredAfterUnknown: true });
      return;
    }
    patchState({ sessionStatus: "ready", sessionRecoveredAfterUnknown: false });
  }

  markSessionReplaying(environmentId: EnvironmentId): void {
    const state = useHostedHubStore.getState();
    if (state.selectedNode?.environmentId !== environmentId) return;
    if (state.sessionStatus === "delivery-unknown") {
      patchState({ sessionRecoveredAfterUnknown: false });
      return;
    }
    patchState({ sessionStatus: "replaying" });
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
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    this.#directoryTimer = setTimeout(() => void this.refreshDirectory(), delay);
  }

  #clearDirectoryTimer(): void {
    if (this.#directoryTimer) clearTimeout(this.#directoryTimer);
    this.#directoryTimer = null;
  }

  async #deactivateSelection(environmentId: EnvironmentId, generation: number): Promise<void> {
    const { deactivateHostedNode } = await import("./environment");
    await deactivateHostedNode(environmentId);
    if (useHostedHubStore.getState().generation !== generation) return;
    patchState({
      selectedNode: null,
      transportStatus: "idle",
      sessionStatus: "closed",
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

export function markHostedSessionReady(environmentId: EnvironmentId): void {
  hostedHubController.markSessionReady(environmentId);
}

export function markHostedSessionReplaying(environmentId: EnvironmentId): void {
  hostedHubController.markSessionReplaying(environmentId);
}
