import { Context, Effect, Layer } from "effect";

import type { RelayNodeAuthHandshake } from "@ryco/contracts/relay";
import { canonicalizeHubOrigin } from "@ryco/shared/nodeIdentity";

import { ServerConfig } from "../config.ts";
import {
  makeHubEnrollmentClient,
  type HubEnrollmentMetadata,
  type HubEnrollmentPollResponse,
  type StartedHubEnrollment,
} from "../hubIdentity/HubEnrollmentClient.ts";
import { makeHubEnrollmentHttpTransport } from "../hubIdentity/HubEnrollmentHttpTransport.ts";
import {
  makeHubKeyRotationClient,
  type HubKeyRotationStatus,
} from "../hubIdentity/HubKeyRotationClient.ts";
import { makeHubKeyRotationHttpTransport } from "../hubIdentity/HubKeyRotationHttpTransport.ts";
import {
  HubNodeProofClientError,
  type HubNodeProofFailure,
  makeHubNodeChallengeHttpTransport,
  makeHubNodeProofClient,
} from "../hubIdentity/HubNodeProofClient.ts";
import {
  type HubProtectedStoreBackend,
  type LocalHubIdentityState,
  makeLocalHubIdentityStateStore,
} from "../hubIdentity/LocalHubIdentityState.ts";
import { makeNodeSigningIdentity } from "../hubIdentity/NodeSigningIdentity.ts";
import {
  makeOsProtectedSecretStore,
  makePermissionedFileSecretStore,
  type ProtectedSecretStore,
  type ProtectedSecretStoreBackend,
  ProtectedSecretStoreError,
} from "../hubIdentity/ProtectedSecretStore.ts";

export type HubIdentityRuntimeErrorCode =
  | "identity_unavailable"
  | "identity_store_unavailable"
  | "enrollment_failed"
  | "node_proof_failed"
  | "rotation_failed";

export class HubIdentityRuntimeError extends Error {
  readonly code: HubIdentityRuntimeErrorCode;

  constructor(code: HubIdentityRuntimeErrorCode) {
    super("Hub identity operation failed.");
    this.name = "HubIdentityRuntimeError";
    this.code = code;
  }
}

export type HubRelayAuthenticationFailure = HubNodeProofFailure;

export class HubRelayAuthenticationError extends Error {
  readonly failure: HubRelayAuthenticationFailure;

  constructor(failure: HubRelayAuthenticationFailure) {
    super("Hub relay authentication preparation failed.");
    this.name = "HubRelayAuthenticationError";
    this.failure = failure;
  }
}

/**
 * A pending ceremony, re-readable after the start response has been lost.
 *
 * The fingerprint is recomputed from the protected key rather than persisted, so
 * a tampered state file cannot display a fingerprint that differs from the key
 * that will actually sign the authentication transcript.
 */
export interface PendingHubEnrollmentDetail {
  readonly deviceCode: string | null;
  readonly label: string | null;
  readonly fingerprint: Uint8Array;
  readonly algorithm: "ed25519";
  readonly expiresAt: number | null;
  readonly pollIntervalMs: number | null;
}

export interface HubIdentityRuntimeShape {
  readonly backend: ProtectedSecretStoreBackend;
  readonly readState: () => Promise<LocalHubIdentityState>;
  /**
   * Erase this node's Hub identity and mint a fresh `EnvironmentId`.
   *
   * Idempotent and resumable: a crash mid-teardown leaves a durable marker that
   * the next start completes.
   */
  readonly leave: () => Promise<void>;
  /** Null when no ceremony is pending for this origin. */
  readonly readPendingEnrollment: (hubOrigin: string) => Promise<PendingHubEnrollmentDetail | null>;
  readonly startEnrollment: (
    hubOrigin: string,
    metadata: HubEnrollmentMetadata,
  ) => Promise<StartedHubEnrollment>;
  readonly pollEnrollment: (hubOrigin: string) => Promise<HubEnrollmentPollResponse>;
  readonly cancelEnrollment: (hubOrigin: string) => Promise<void>;
  readonly createRelayAuthenticationFrame: (
    hubOrigin: string,
    protocol: { readonly protocolMajor: number; readonly protocolMinor: number },
  ) => Promise<RelayNodeAuthHandshake>;
  readonly stageKeyRotation: (hubOrigin: string) => Promise<HubKeyRotationStatus>;
  readonly resumeKeyRotation: (hubOrigin: string) => Promise<HubKeyRotationStatus>;
  readonly confirmAuthenticatedKey: (hubOrigin: string, keyId: string) => Promise<void>;
}

export class HubIdentityRuntime extends Context.Service<
  HubIdentityRuntime,
  HubIdentityRuntimeShape
>()("ryco/hubConnector/HubIdentityRuntime") {}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const bounded = async <A>(
  code: HubIdentityRuntimeErrorCode,
  operation: () => Promise<A>,
): Promise<A> => {
  try {
    return await operation();
  } catch (error: unknown) {
    if (error instanceof HubIdentityRuntimeError) throw error;
    throw new HubIdentityRuntimeError(code);
  }
};

const protectedStoreClass = (backend: ProtectedSecretStoreBackend): HubProtectedStoreBackend =>
  backend === "permissioned-file" ? "permissioned-file" : "os";

const identitySecretNames = (state: LocalHubIdentityState): ReadonlyArray<string> =>
  [
    state.activeNode?.activeKeySecretName,
    state.activeNode?.cleanupPollingSecretName,
    state.stagedRotation?.newKeySecretName,
    state.pendingEnrollment?.keySecretName,
    state.pendingEnrollment?.pollingSecretName,
    ...(state.pendingTeardown?.secretNames ?? []),
  ].filter((name, index, names): name is string => {
    return typeof name === "string" && names.indexOf(name) === index;
  });

const requiredIdentitySecretNames = (state: LocalHubIdentityState): ReadonlySet<string> => {
  const names = new Set<string>();
  // A committed teardown makes every referenced secret optional: deletion may
  // already have completed before the process crashed. Startup must reopen one
  // unambiguous custody class and finish clearing state, not require a key that
  // the teardown protocol intentionally removed.
  if (state.pendingTeardown !== null) return names;
  if (state.activeNode !== null) names.add(state.activeNode.activeKeySecretName);
  if (state.stagedRotation !== null) names.add(state.stagedRotation.newKeySecretName);
  if (state.pendingEnrollment !== null) {
    names.add(state.pendingEnrollment.keySecretName);
    if (
      state.pendingEnrollment.expiresAt !== null &&
      state.pendingEnrollment.pollIntervalMs !== null
    ) {
      names.add(state.pendingEnrollment.pollingSecretName);
    }
  }
  return names;
};

const inspectProtectedStore = async (
  store: ProtectedSecretStore,
  names: ReadonlyArray<string>,
  requiredNames: ReadonlySet<string>,
): Promise<{ readonly present: number; readonly hasEveryRequired: boolean }> => {
  let present = 0;
  let hasEveryRequired = true;
  for (const name of names) {
    const value = await store.get(name);
    if (value === null) {
      if (requiredNames.has(name)) hasEveryRequired = false;
      continue;
    }
    present += 1;
    value.fill(0);
  }
  return { present, hasEveryRequired };
};

const protectedStoreUnavailable = (): never => {
  throw new HubIdentityRuntimeError("identity_store_unavailable");
};

async function selectProtectedSecretStore(options: {
  readonly stateStore: Awaited<ReturnType<typeof makeLocalHubIdentityStateStore>>;
  readonly fileSecretRoot: string;
  readonly allowFileFallback: boolean;
  readonly secretStore?: ProtectedSecretStore;
  readonly makeOsStore?: (service: string) => Promise<ProtectedSecretStore>;
  readonly makeFileStore?: (
    rootDirectory: string,
    options: { readonly explicitlyAllowed: boolean },
  ) => Promise<ProtectedSecretStore>;
}): Promise<ProtectedSecretStore> {
  const state = await options.stateStore.readOrCreate();
  const bindBackend = async (kind: HubProtectedStoreBackend): Promise<void> => {
    const current = await options.stateStore.readOrCreate();
    if (current.protectedStoreBackend === kind) return;
    if (current.protectedStoreBackend !== null) return protectedStoreUnavailable();
    await options.stateStore.update((latest) => {
      if (latest.protectedStoreBackend !== null) {
        if (latest.protectedStoreBackend !== kind) return protectedStoreUnavailable();
        return { ...latest, revision: latest.revision + 1 };
      }
      return {
        ...latest,
        revision: latest.revision + 1,
        protectedStoreBackend: kind,
      };
    });
  };
  const makeOs = () => (options.makeOsStore ?? makeOsProtectedSecretStore)("ryco.node.identity");
  const makeFile = () => {
    if (!options.allowFileFallback) return protectedStoreUnavailable();
    return (options.makeFileStore ?? makePermissionedFileSecretStore)(options.fileSecretRoot, {
      explicitlyAllowed: true,
    });
  };
  const optionalStore = async (
    make: () => Promise<ProtectedSecretStore>,
  ): Promise<ProtectedSecretStore | null> => {
    try {
      return await make();
    } catch (error: unknown) {
      if (
        error instanceof ProtectedSecretStoreError &&
        error.code === "protected_store_unavailable"
      ) {
        return null;
      }
      return protectedStoreUnavailable();
    }
  };

  let selected: ProtectedSecretStore;
  if (options.secretStore !== undefined) {
    selected = options.secretStore;
    if (
      state.protectedStoreBackend !== null &&
      state.protectedStoreBackend !== protectedStoreClass(selected.backend)
    ) {
      return protectedStoreUnavailable();
    }
  } else if (state.protectedStoreBackend === "os") {
    selected = (await optionalStore(makeOs)) ?? protectedStoreUnavailable();
  } else if (state.protectedStoreBackend === "permissioned-file") {
    selected = (await optionalStore(makeFile)) ?? protectedStoreUnavailable();
  } else {
    const names = identitySecretNames(state);
    if (names.length === 0) {
      selected =
        (await optionalStore(makeOs)) ??
        (await optionalStore(makeFile)) ??
        protectedStoreUnavailable();
    } else {
      const requiredNames = requiredIdentitySecretNames(state);
      const osStore = await optionalStore(makeOs);
      const fileStore = options.allowFileFallback ? await optionalStore(makeFile) : null;
      const candidates = await Promise.all(
        [
          osStore === null ? null : { store: osStore, kind: "os" as const },
          fileStore === null ? null : { store: fileStore, kind: "permissioned-file" as const },
        ]
          .filter(
            (
              candidate,
            ): candidate is {
              readonly store: ProtectedSecretStore;
              readonly kind: HubProtectedStoreBackend;
            } => candidate !== null,
          )
          .map(async ({ store, kind }) => ({
            store,
            kind,
            inspection: await bounded("identity_store_unavailable", () =>
              inspectProtectedStore(store, names, requiredNames),
            ),
          })),
      );
      const containingMaterial = candidates.filter(({ inspection }) => inspection.present > 0);
      if (containingMaterial.length > 1) return protectedStoreUnavailable();
      const candidate =
        containingMaterial[0] ??
        (state.pendingTeardown !== null && requiredNames.size === 0 ? candidates[0] : undefined);
      if (candidate === undefined || !candidate.inspection.hasEveryRequired) {
        return protectedStoreUnavailable();
      }
      selected = candidate.store;
      await bindBackend(candidate.kind);
    }
  }

  const latest = await options.stateStore.readOrCreate();
  if (latest.protectedStoreBackend === null && identitySecretNames(latest).length > 0) {
    const names = identitySecretNames(latest);
    const requiredNames = requiredIdentitySecretNames(latest);
    const inspection = await bounded("identity_store_unavailable", () =>
      inspectProtectedStore(selected, names, requiredNames),
    );
    if (
      !inspection.hasEveryRequired ||
      (inspection.present === 0 && latest.pendingTeardown === null)
    ) {
      return protectedStoreUnavailable();
    }
    await bindBackend(protectedStoreClass(selected.backend));
  }

  let bindInFlight: Promise<void> | null = null;
  const ensureBound = (): Promise<void> => {
    if (bindInFlight !== null) return bindInFlight;
    const kind = protectedStoreClass(selected.backend);
    const binding = bindBackend(kind);
    bindInFlight = binding;
    const clearBinding = () => {
      if (bindInFlight === binding) bindInFlight = null;
    };
    void binding.then(clearBinding, clearBinding);
    return binding;
  };

  return {
    backend: selected.backend,
    get: selected.get,
    create: async (name, value) => {
      await ensureBound();
      await selected.create(name, value);
    },
    remove: selected.remove,
  };
}

export async function makeHubIdentityRuntime(options: {
  readonly statePath: string;
  readonly fileSecretRoot: string;
  readonly allowFileFallback: boolean;
  readonly secretStore?: ProtectedSecretStore;
  readonly makeOsSecretStore?: (service: string) => Promise<ProtectedSecretStore>;
  readonly makeFileSecretStore?: (
    rootDirectory: string,
    options: { readonly explicitlyAllowed: boolean },
  ) => Promise<ProtectedSecretStore>;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}): Promise<HubIdentityRuntimeShape> {
  const stateStore = await makeLocalHubIdentityStateStore(options.statePath);
  const secretStore = await selectProtectedSecretStore({
    stateStore,
    fileSecretRoot: options.fileSecretRoot,
    allowFileFallback: options.allowFileFallback,
    ...(options.secretStore === undefined ? {} : { secretStore: options.secretStore }),
    ...(options.makeOsSecretStore === undefined ? {} : { makeOsStore: options.makeOsSecretStore }),
    ...(options.makeFileSecretStore === undefined
      ? {}
      : { makeFileStore: options.makeFileSecretStore }),
  });
  const signingIdentity = makeNodeSigningIdentity(secretStore);
  const enrollment = makeHubEnrollmentClient({
    transport: makeHubEnrollmentHttpTransport(options.fetch, { timeoutMs: 10_000 }),
    signingIdentity,
    secretStore,
    stateStore,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  });
  const rotation = makeHubKeyRotationClient({
    transport: makeHubKeyRotationHttpTransport(options.fetch, { timeoutMs: 10_000 }),
    signingIdentity,
    stateStore,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const proof = makeHubNodeProofClient({
    transport: makeHubNodeChallengeHttpTransport(options.fetch, { timeoutMs: 10_000 }),
    stateStore,
    signingIdentity,
    keySelector: rotation,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  const now = options.now ?? (() => Date.now());

  /**
   * Collect every protected-store name an identity owns.
   *
   * A leave must erase all of them: the active signing key, a staged rotation
   * key, a pending ceremony's key, and any polling secret still awaiting
   * cleanup. Missing one orphans key material in the OS credential store.
   */
  const ownedSecretNames = (state: LocalHubIdentityState): ReadonlyArray<string> =>
    [
      state.activeNode?.activeKeySecretName,
      state.activeNode?.cleanupPollingSecretName,
      state.stagedRotation?.newKeySecretName,
      state.pendingEnrollment?.keySecretName,
      state.pendingEnrollment?.pollingSecretName,
    ].filter((name): name is string => typeof name === "string");

  /**
   * Phase two and three of the teardown: erase the recorded secrets, then drop
   * the state.
   *
   * Deletion is best-effort per secret. A credential store that cannot delete
   * must not strand the node in a half-left state forever — the marker has
   * already recorded the intent, and an undeletable secret is inert once the
   * state that references it is gone.
   */
  const completeTeardown = async (secretNames: ReadonlyArray<string>): Promise<void> => {
    for (const name of secretNames) {
      await signingIdentity.delete(name).catch(() => undefined);
      await secretStore.remove(name).catch(() => undefined);
    }
    await stateStore.reset();
  };

  // Resume an interrupted leave before anything reads key custody: the keys it
  // names may already be gone, which would otherwise fail the validation below
  // and leave the node permanently unstartable.
  await bounded("identity_unavailable", async () => {
    const state = await stateStore.readOrCreate();
    if (state.pendingTeardown !== null) {
      await completeTeardown(state.pendingTeardown.secretNames);
    }
  });

  await bounded("identity_unavailable", async () => {
    const state = await stateStore.readOrCreate();
    if (state.activeNode !== null) {
      const selected = await rotation.authenticationKey(state.activeNode.hubOrigin);
      await signingIdentity.getPublicDescriptor(selected.secretName);
    }
    if (state.stagedRotation !== null) {
      await signingIdentity.getPublicDescriptor(state.stagedRotation.newKeySecretName);
    }
  });

  return {
    backend: secretStore.backend,
    readState: () => bounded("identity_unavailable", () => stateStore.readOrCreate()),
    leave: () =>
      bounded("identity_unavailable", async () => {
        const state = await stateStore.readOrCreate();
        if (state.pendingTeardown !== null) {
          // A previous attempt committed but did not finish. Finish that one
          // rather than starting a second, so its secret list is not lost.
          await completeTeardown(state.pendingTeardown.secretNames);
          return;
        }
        const secretNames = ownedSecretNames(state);
        if (
          state.activeNode === null &&
          state.pendingEnrollment === null &&
          state.stagedRotation === null
        ) {
          if (state.protectedStoreBackend !== null) {
            await stateStore.reset();
          }
          // Nothing to erase. Idempotent by design: the panel may retry a leave
          // whose response was lost.
          return;
        }
        // Phase one: record the intent, and everything it must erase, before
        // touching either store.
        await stateStore.update((current) => ({
          ...current,
          revision: current.revision + 1,
          pendingTeardown: { secretNames, requestedAt: now() },
        }));
        await completeTeardown(secretNames);
      }),
    readPendingEnrollment: (hubOrigin) =>
      bounded("identity_unavailable", async () => {
        const state = await stateStore.readOrCreate();
        const pending = state.pendingEnrollment;
        // A ceremony being torn down is not one an approver should still be
        // shown, so a cleanup-marked record reads as absent.
        if (pending === null || pending.cleanupRequested) return null;
        if (pending.hubOrigin !== canonicalizeHubOrigin(hubOrigin)) return null;
        const descriptor = await signingIdentity.getPublicDescriptor(pending.keySecretName);
        return {
          deviceCode: pending.deviceCode,
          label: pending.label,
          fingerprint: descriptor.fingerprint,
          algorithm: descriptor.algorithm,
          expiresAt: pending.expiresAt,
          pollIntervalMs: pending.pollIntervalMs,
        };
      }),
    startEnrollment: (hubOrigin, metadata) =>
      bounded("enrollment_failed", () => enrollment.start(hubOrigin, metadata)),
    pollEnrollment: (hubOrigin) => bounded("enrollment_failed", () => enrollment.poll(hubOrigin)),
    cancelEnrollment: (hubOrigin) =>
      bounded("enrollment_failed", () => enrollment.cancel(hubOrigin)),
    createRelayAuthenticationFrame: async (hubOrigin, protocol) => {
      try {
        return await proof.createRelayAuthenticationFrame(hubOrigin, protocol);
      } catch (error) {
        throw new HubRelayAuthenticationError(
          error instanceof HubNodeProofClientError ? error.failure : "identity_unavailable",
        );
      }
    },
    stageKeyRotation: (hubOrigin) => bounded("rotation_failed", () => rotation.stage(hubOrigin)),
    resumeKeyRotation: (hubOrigin) => bounded("rotation_failed", () => rotation.resume(hubOrigin)),
    confirmAuthenticatedKey: (hubOrigin, keyId) =>
      bounded("rotation_failed", () => rotation.confirmNewKeyAuthenticated(hubOrigin, keyId)),
  };
}

export const HubIdentityRuntimeLive = Layer.effect(
  HubIdentityRuntime,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    return yield* Effect.tryPromise({
      try: () =>
        makeHubIdentityRuntime({
          statePath: config.hubIdentityStatePath,
          fileSecretRoot: `${config.secretsDir}/hub-node`,
          allowFileFallback: config.hubConnector?.allowFileSecretStore ?? false,
        }),
      catch: () => new HubIdentityRuntimeError("identity_unavailable"),
    });
  }),
);
