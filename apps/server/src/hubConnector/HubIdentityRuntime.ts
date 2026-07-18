import { Context, Effect, Layer } from "effect";

import type { RelayNodeAuthHandshake } from "@ryco/contracts/relay";

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

export interface HubIdentityRuntimeShape {
  readonly backend: ProtectedSecretStoreBackend;
  readonly readState: () => Promise<LocalHubIdentityState>;
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
