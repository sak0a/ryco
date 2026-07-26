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
  type LocalHubIdentityState,
  makeLocalHubIdentityStateStore,
} from "../hubIdentity/LocalHubIdentityState.ts";
import { makeNodeSigningIdentity } from "../hubIdentity/NodeSigningIdentity.ts";
import {
  makeProtectedSecretStore,
  type ProtectedSecretStore,
  type ProtectedSecretStoreBackend,
} from "../hubIdentity/ProtectedSecretStore.ts";

export type HubIdentityRuntimeErrorCode =
  | "identity_unavailable"
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

export async function makeHubIdentityRuntime(options: {
  readonly statePath: string;
  readonly fileSecretRoot: string;
  readonly allowFileFallback: boolean;
  readonly secretStore?: ProtectedSecretStore;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}): Promise<HubIdentityRuntimeShape> {
  const secretStore =
    options.secretStore ??
    (await makeProtectedSecretStore({
      service: "ryco.node.identity",
      fileRoot: options.fileSecretRoot,
      allowFileFallback: options.allowFileFallback,
    }));
  const stateStore = await makeLocalHubIdentityStateStore(options.statePath);
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
