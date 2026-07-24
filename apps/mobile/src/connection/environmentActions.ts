import type { EnvironmentId } from "@ryco/contracts";
import type { SavedEnvironmentRecord } from "@ryco/client-runtime/connection";

import { useStore } from "../state/threadsRuntime";
import type { MobileConnectionRegistry } from "../runtime/bootstrap";

// §2.6 / §3-22..26: the saved-environment lifecycle actions, mirroring
// apps/web/src/environments/runtime/service.ts. Free functions over ONE registry
// ({catalog, remoteApi, driver}); no forked runtime logic — every op composes the
// runtime supervisor + catalog + threads store. All desktop-SSH / relay / hosted
// arms are dropped (direct-node only). A record's bearer token NEVER enters a
// return value or view model (§3-25 secret boundary) — it lives only in SecretKV.

export interface ResolvedPairingTarget {
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly credential: string;
}

export interface AddSavedEnvironmentInput {
  readonly label: string;
  readonly pairingUrl?: string;
  readonly host?: string;
  readonly pairingCode?: string;
}

export interface EnvironmentActionsDeps {
  readonly registry: MobileConnectionRegistry;
  /** Resolve a pairing URL / host+code into a target (ryco* schemes, §Task 6). */
  readonly resolvePairingTarget: (input: {
    readonly pairingUrl?: string;
    readonly host?: string;
    readonly pairingCode?: string;
  }) => ResolvedPairingTarget;
  readonly now?: () => string;
}

const MISSING_CREDENTIAL_MESSAGE = "Unable to persist saved environment credentials.";

export function createEnvironmentActions(deps: EnvironmentActionsDeps) {
  const { registry } = deps;
  const isoNow = deps.now ?? (() => new Date().toISOString());

  const connect = (record: SavedEnvironmentRecord) =>
    registry.driver.supervisor.ensureSavedEnvironmentConnection(record, (isCancelled) =>
      registry.driver.connectSavedEnvironment(record, isCancelled),
    );

  async function addSavedEnvironment(
    input: AddSavedEnvironmentInput,
  ): Promise<SavedEnvironmentRecord> {
    const target = deps.resolvePairingTarget({
      ...(input.pairingUrl !== undefined ? { pairingUrl: input.pairingUrl } : {}),
      ...(input.host !== undefined ? { host: input.host } : {}),
      ...(input.pairingCode !== undefined ? { pairingCode: input.pairingCode } : {}),
    });

    // Pre-auth: identify the node so the token + record are keyed by EnvironmentId.
    const descriptor = await registry.remoteApi.fetchRemoteEnvironmentDescriptor({
      httpBaseUrl: target.httpBaseUrl,
    });
    const environmentId = descriptor.environmentId;

    // §3-22 single-record snapshot for rollback (no bulk registry API on mobile).
    const prior = registry.catalog.get(environmentId);

    const bearerSession = await registry.remoteApi.bootstrapRemoteBearerSession({
      httpBaseUrl: target.httpBaseUrl,
      credential: target.credential,
    });

    const record: SavedEnvironmentRecord = {
      environmentId,
      label: input.label.trim() || prior?.label || descriptor.label,
      httpBaseUrl: target.httpBaseUrl,
      wsBaseUrl: target.wsBaseUrl,
      createdAt: prior?.createdAt ?? isoNow(),
      lastConnectedAt: isoNow(),
    };

    await registry.catalog.persistRecord(record);
    const didPersistToken = await registry.catalog.writeBearerToken(
      environmentId,
      bearerSession.sessionToken,
    );
    if (!didPersistToken) {
      // Roll the registry back BEFORE the upsert (the failing path never upserts,
      // so the store needs no rollback).
      if (prior) await registry.catalog.persistRecord(prior);
      throw new Error(MISSING_CREDENTIAL_MESSAGE);
    }

    // The upsert auto-persists and fires the supervisor's registry subscription.
    registry.catalog.registryStore.getState().upsert(record);
    await registry.driver.supervisor.remove(environmentId).catch(() => false);
    await connect(record);
    return record;
  }

  async function reconnectSavedEnvironment(environmentId: EnvironmentId): Promise<void> {
    const record = registry.catalog.get(environmentId);
    if (!record) return;
    await registry.driver.supervisor.remove(environmentId).catch(() => false);
    await connect(record);
  }

  async function disconnectSavedEnvironment(environmentId: EnvironmentId): Promise<void> {
    await registry.driver.supervisor.remove(environmentId).catch(() => false);
  }

  async function removeSavedEnvironment(environmentId: EnvironmentId): Promise<void> {
    await registry.driver.supervisor.remove(environmentId).catch(() => false);
    registry.driver.supervisor.disposeThreadDetailSubscriptionsForEnvironment(environmentId);
    registry.catalog.registryStore.getState().remove(environmentId);
    registry.catalog.runtimeStore.getState().clear(environmentId);
    useStore.getState().removeEnvironmentState(environmentId);
    await registry.catalog.removeBearerToken(environmentId);
  }

  function renameSavedEnvironment(environmentId: EnvironmentId, label: string): void {
    registry.catalog.registryStore.getState().rename(environmentId, label);
  }

  return {
    addSavedEnvironment,
    reconnectSavedEnvironment,
    disconnectSavedEnvironment,
    removeSavedEnvironment,
    renameSavedEnvironment,
  };
}

export type EnvironmentActions = ReturnType<typeof createEnvironmentActions>;
