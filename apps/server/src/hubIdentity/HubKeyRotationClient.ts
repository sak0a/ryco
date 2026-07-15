import { randomBytes } from "node:crypto";

import {
  canonicalizeHubOrigin,
  encodeNodeKeyRotationTranscript,
  type NodePublicKeyDescriptor,
} from "@ryco/shared/nodeIdentity";

import type { LocalHubIdentityStateStore } from "./LocalHubIdentityState.ts";
import type { NodeSigningIdentity } from "./NodeSigningIdentity.ts";

export interface HubKeyRotationChallenge {
  readonly rotationRequestId: string;
  readonly newKeyId: string;
  readonly protocolMajor: number;
  readonly protocolMinor: number;
  readonly challenge: Uint8Array;
  readonly challengeExpiresAt: number;
}

export type HubKeyRotationStatus =
  | { readonly status: "proof_required" }
  | { readonly status: "awaiting_owner" }
  | { readonly status: "activated"; readonly activatedAt: number }
  | { readonly status: "rejected" };

export interface HubKeyRotationTransport {
  readonly begin: (request: {
    readonly hubOrigin: string;
    readonly nodeId: string;
    readonly oldActiveKeyId: string;
    readonly newKey: NodePublicKeyDescriptor;
    readonly existingRotationRequestId?: string;
  }) => Promise<HubKeyRotationChallenge>;
  readonly prove: (request: {
    readonly hubOrigin: string;
    readonly rotationRequestId: string;
    readonly challenge: Uint8Array;
    readonly signature: Uint8Array;
  }) => Promise<HubKeyRotationStatus>;
  readonly status: (request: {
    readonly hubOrigin: string;
    readonly rotationRequestId: string;
  }) => Promise<HubKeyRotationStatus>;
}

export type HubKeyRotationClientErrorCode =
  | "rotation_not_available"
  | "rotation_conflict"
  | "rotation_response_invalid"
  | "rotation_transport_failed"
  | "rotation_local_state_failed";

export class HubKeyRotationClientError extends Error {
  readonly code: HubKeyRotationClientErrorCode;

  constructor(code: HubKeyRotationClientErrorCode) {
    super("Hub key rotation client operation failed.");
    this.name = "HubKeyRotationClientError";
    this.code = code;
  }
}

export interface HubKeyRotationClient {
  readonly stage: (hubOrigin: string) => Promise<HubKeyRotationStatus>;
  readonly resume: (hubOrigin: string) => Promise<HubKeyRotationStatus>;
  readonly authenticationKey: (hubOrigin: string) => Promise<{
    readonly keyId: string;
    readonly secretName: string;
  }>;
  readonly confirmNewKeyAuthenticated: (hubOrigin: string, keyId: string) => Promise<void>;
}

export interface HubKeyRotationClientDependencies {
  readonly transport: HubKeyRotationTransport;
  readonly signingIdentity: NodeSigningIdentity;
  readonly stateStore: LocalHubIdentityStateStore;
  readonly now?: () => number;
}

const ROTATION_ID = /^nrot_[A-Za-z0-9_-]{22}$/;
const NODE_KEY_ID = /^nkey_[A-Za-z0-9_-]{22}$/;

function rotationError(code: HubKeyRotationClientErrorCode): never {
  throw new HubKeyRotationClientError(code);
}

function validateStatus(status: HubKeyRotationStatus): HubKeyRotationStatus {
  if (
    status.status === "proof_required" ||
    status.status === "awaiting_owner" ||
    status.status === "rejected"
  ) {
    return status;
  }
  if (
    status.status === "activated" &&
    Number.isSafeInteger(status.activatedAt) &&
    status.activatedAt >= 0
  ) {
    return { status: "activated", activatedAt: status.activatedAt };
  }
  return rotationError("rotation_response_invalid");
}

function validateChallenge(
  challenge: HubKeyRotationChallenge,
  now: number,
): HubKeyRotationChallenge {
  if (
    !ROTATION_ID.test(challenge.rotationRequestId) ||
    !NODE_KEY_ID.test(challenge.newKeyId) ||
    !Number.isSafeInteger(challenge.protocolMajor) ||
    challenge.protocolMajor < 0 ||
    challenge.protocolMajor > 65_535 ||
    !Number.isSafeInteger(challenge.protocolMinor) ||
    challenge.protocolMinor < 0 ||
    challenge.protocolMinor > 65_535 ||
    !(challenge.challenge instanceof Uint8Array) ||
    challenge.challenge.byteLength !== 32 ||
    !Number.isSafeInteger(challenge.challengeExpiresAt) ||
    challenge.challengeExpiresAt <= now ||
    challenge.challengeExpiresAt > now + 60_000
  ) {
    return rotationError("rotation_response_invalid");
  }
  return { ...challenge, challenge: Uint8Array.from(challenge.challenge) };
}

function newSecretName(): string {
  return `node-key.${randomBytes(16).toString("hex")}`;
}

export function makeHubKeyRotationClient(
  dependencies: HubKeyRotationClientDependencies,
): HubKeyRotationClient {
  const now = dependencies.now ?? Date.now;

  const applyStatus = async (
    hubOrigin: string,
    status: HubKeyRotationStatus,
  ): Promise<HubKeyRotationStatus> => {
    const validated = validateStatus(status);
    const current = await dependencies.stateStore.readOrCreate();
    const staged = current.stagedRotation;
    if (staged === null || staged.hubOrigin !== hubOrigin) {
      return rotationError("rotation_local_state_failed");
    }
    if (validated.status === "activated") {
      if (staged.activatedAt !== validated.activatedAt) {
        await dependencies.stateStore.update((state) => {
          if (state.stagedRotation?.rotationRequestId !== staged.rotationRequestId) {
            return rotationError("rotation_local_state_failed");
          }
          return {
            ...state,
            revision: state.revision + 1,
            stagedRotation: { ...state.stagedRotation, activatedAt: validated.activatedAt },
          };
        });
      }
      return validated;
    }
    if (validated.status === "rejected") {
      await dependencies.signingIdentity.delete(staged.newKeySecretName).catch(() => undefined);
      await dependencies.stateStore.update((state) => {
        if (state.stagedRotation?.rotationRequestId !== staged.rotationRequestId) {
          return rotationError("rotation_local_state_failed");
        }
        return { ...state, revision: state.revision + 1, stagedRotation: null };
      });
    }
    return validated;
  };

  const prove = async (
    hubOrigin: string,
    challenge: HubKeyRotationChallenge,
  ): Promise<HubKeyRotationStatus> => {
    const state = await dependencies.stateStore.readOrCreate();
    const active = state.activeNode;
    const staged = state.stagedRotation;
    if (
      active === null ||
      active.hubOrigin !== hubOrigin ||
      staged === null ||
      staged.rotationRequestId !== challenge.rotationRequestId ||
      staged.newKeyId !== challenge.newKeyId
    ) {
      return rotationError("rotation_local_state_failed");
    }
    const newKey = await dependencies.signingIdentity.getPublicDescriptor(staged.newKeySecretName);
    const transcript = encodeNodeKeyRotationTranscript({
      hubOrigin,
      protocolMajor: challenge.protocolMajor,
      protocolMinor: challenge.protocolMinor,
      rotationRequestId: challenge.rotationRequestId,
      nodeId: active.nodeId,
      oldActiveKeyId: active.activeKeyId,
      newKeyId: challenge.newKeyId,
      newKey,
      challengeExpiresAt: challenge.challengeExpiresAt,
      challenge: challenge.challenge,
    });
    const signature = await dependencies.signingIdentity.sign(
      active.activeKeySecretName,
      transcript,
    );
    try {
      return await applyStatus(
        hubOrigin,
        await dependencies.transport.prove({
          hubOrigin,
          rotationRequestId: challenge.rotationRequestId,
          challenge: challenge.challenge,
          signature,
        }),
      );
    } catch (error: unknown) {
      if (error instanceof HubKeyRotationClientError) throw error;
      return rotationError("rotation_transport_failed");
    } finally {
      challenge.challenge.fill(0);
      signature.fill(0);
      transcript.fill(0);
    }
  };

  const stage: HubKeyRotationClient["stage"] = async (rawHubOrigin) => {
    let hubOrigin: string;
    try {
      hubOrigin = canonicalizeHubOrigin(rawHubOrigin);
    } catch {
      return rotationError("rotation_not_available");
    }
    const state = await dependencies.stateStore.readOrCreate();
    const active = state.activeNode;
    if (active === null || active.hubOrigin !== hubOrigin) {
      return rotationError("rotation_not_available");
    }
    if (state.stagedRotation !== null) return rotationError("rotation_conflict");

    const newKeySecretName = newSecretName();
    const newKey = await dependencies.signingIdentity.generate(newKeySecretName);
    let challenge: HubKeyRotationChallenge;
    try {
      challenge = validateChallenge(
        await dependencies.transport.begin({
          hubOrigin,
          nodeId: active.nodeId,
          oldActiveKeyId: active.activeKeyId,
          newKey,
        }),
        now(),
      );
    } catch (error: unknown) {
      await dependencies.signingIdentity.delete(newKeySecretName).catch(() => undefined);
      if (error instanceof HubKeyRotationClientError) throw error;
      return rotationError("rotation_transport_failed");
    }
    try {
      await dependencies.stateStore.update((current) => {
        if (
          current.stagedRotation !== null ||
          current.activeNode?.activeKeyId !== active.activeKeyId
        ) {
          return rotationError("rotation_conflict");
        }
        return {
          ...current,
          revision: current.revision + 1,
          stagedRotation: {
            hubOrigin,
            rotationRequestId: challenge.rotationRequestId,
            newKeyId: challenge.newKeyId,
            newKeySecretName,
            stagedAt: now(),
            activatedAt: null,
          },
        };
      });
    } catch (error: unknown) {
      challenge.challenge.fill(0);
      await dependencies.signingIdentity.delete(newKeySecretName).catch(() => undefined);
      throw error;
    }
    return prove(hubOrigin, challenge);
  };

  const resume: HubKeyRotationClient["resume"] = async (rawHubOrigin) => {
    let hubOrigin: string;
    try {
      hubOrigin = canonicalizeHubOrigin(rawHubOrigin);
    } catch {
      return rotationError("rotation_not_available");
    }
    const state = await dependencies.stateStore.readOrCreate();
    const active = state.activeNode;
    const staged = state.stagedRotation;
    if (active === null || staged === null || staged.hubOrigin !== hubOrigin) {
      return rotationError("rotation_not_available");
    }
    let status: HubKeyRotationStatus;
    try {
      status = validateStatus(
        await dependencies.transport.status({
          hubOrigin,
          rotationRequestId: staged.rotationRequestId,
        }),
      );
    } catch (error: unknown) {
      if (error instanceof HubKeyRotationClientError) throw error;
      return rotationError("rotation_transport_failed");
    }
    if (status.status !== "proof_required") return applyStatus(hubOrigin, status);

    const newKey = await dependencies.signingIdentity.getPublicDescriptor(staged.newKeySecretName);
    let challenge: HubKeyRotationChallenge;
    try {
      challenge = validateChallenge(
        await dependencies.transport.begin({
          hubOrigin,
          nodeId: active.nodeId,
          oldActiveKeyId: active.activeKeyId,
          newKey,
          existingRotationRequestId: staged.rotationRequestId,
        }),
        now(),
      );
    } catch (error: unknown) {
      if (error instanceof HubKeyRotationClientError) throw error;
      return rotationError("rotation_transport_failed");
    }
    if (
      challenge.rotationRequestId !== staged.rotationRequestId ||
      challenge.newKeyId !== staged.newKeyId
    ) {
      challenge.challenge.fill(0);
      return rotationError("rotation_response_invalid");
    }
    return prove(hubOrigin, challenge);
  };

  const authenticationKey: HubKeyRotationClient["authenticationKey"] = async (rawHubOrigin) => {
    const hubOrigin = canonicalizeHubOrigin(rawHubOrigin);
    const state = await dependencies.stateStore.readOrCreate();
    if (state.activeNode?.hubOrigin !== hubOrigin) return rotationError("rotation_not_available");
    if (
      state.stagedRotation?.hubOrigin === hubOrigin &&
      state.stagedRotation.activatedAt !== null
    ) {
      return {
        keyId: state.stagedRotation.newKeyId,
        secretName: state.stagedRotation.newKeySecretName,
      };
    }
    return {
      keyId: state.activeNode.activeKeyId,
      secretName: state.activeNode.activeKeySecretName,
    };
  };

  const confirmNewKeyAuthenticated: HubKeyRotationClient["confirmNewKeyAuthenticated"] = async (
    rawHubOrigin,
    keyId,
  ) => {
    const hubOrigin = canonicalizeHubOrigin(rawHubOrigin);
    const state = await dependencies.stateStore.readOrCreate();
    const active = state.activeNode;
    const staged = state.stagedRotation;
    if (
      active === null ||
      active.hubOrigin !== hubOrigin ||
      staged === null ||
      staged.hubOrigin !== hubOrigin ||
      staged.activatedAt === null ||
      staged.newKeyId !== keyId
    ) {
      return rotationError("rotation_not_available");
    }
    await dependencies.signingIdentity.delete(active.activeKeySecretName);
    await dependencies.stateStore.update((current) => {
      if (
        current.activeNode?.activeKeyId !== active.activeKeyId ||
        current.stagedRotation?.newKeyId !== staged.newKeyId
      ) {
        return rotationError("rotation_local_state_failed");
      }
      return {
        ...current,
        revision: current.revision + 1,
        activeNode: {
          ...current.activeNode,
          activeKeyId: staged.newKeyId,
          activeKeySecretName: staged.newKeySecretName,
        },
        stagedRotation: null,
      };
    });
  };

  return { stage, resume, authenticationKey, confirmNewKeyAuthenticated };
}
