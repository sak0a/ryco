import { randomBytes as nodeRandomBytes } from "node:crypto";

import {
  CROSS_DEVICE_APPROVAL_ID_BYTES,
  CROSS_DEVICE_APPROVAL_MAX_LIFETIME_MS,
  encodeCrossDeviceApprovalQr,
  encodeCrossDeviceApprovalTbs,
} from "@ryco/shared/relayE2eeCrossDeviceApproval";
import { e2eeBytesEqual, parseE2eeKeyFingerprint } from "@ryco/shared/relayE2eeKeys";

import {
  NodeClientAuthorizationError,
  type NodeClientAuthorizationClient,
} from "./NodeClientAuthorizationClient.ts";

// The node-side signing boundary for
// docs/relay-e2ee-cross-device-approval-protocol.md. Authorization stays in the
// existing durable client: this service may attest an exact APPROVED record but
// can never create, promote, widen, or resurrect one.

export type NodeCrossDeviceApprovalErrorCode =
  | "cross_device_approval_not_approved"
  | "cross_device_approval_conflict"
  | "cross_device_approval_unavailable";

export class NodeCrossDeviceApprovalError extends Error {
  readonly code: NodeCrossDeviceApprovalErrorCode;

  constructor(code: NodeCrossDeviceApprovalErrorCode) {
    super("Cross-device approval operation failed.");
    this.name = "NodeCrossDeviceApprovalError";
    this.code = code;
  }
}

function approvalError(code: NodeCrossDeviceApprovalErrorCode): never {
  throw new NodeCrossDeviceApprovalError(code);
}

export interface NodeCrossDeviceApprovalActiveDescriptor {
  readonly hubOrigin: string;
  readonly nodeId: string;
  readonly nodeIdentityPublicKey: Uint8Array;
  readonly nodeContinuityId: string;
  readonly nodePolicyGeneration: number;
  readonly signApproval: (tbs: Uint8Array) => Promise<Uint8Array>;
}

export interface NodeCrossDeviceApprovalResult {
  readonly payload: string;
  readonly approvedAt: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface NodeCrossDeviceApprovalService {
  readonly create: (input: {
    readonly hubOrigin: string;
    readonly accountId: string;
    readonly clientIdentityFingerprint: Uint8Array;
  }) => Promise<NodeCrossDeviceApprovalResult>;
}

function mapFailure(error: unknown): never {
  if (error instanceof NodeCrossDeviceApprovalError) throw error;
  if (error instanceof NodeClientAuthorizationError) {
    if (
      error.code === "client_authorization_not_found" ||
      error.code === "client_authorization_not_approved"
    ) {
      return approvalError("cross_device_approval_not_approved");
    }
  }
  return approvalError("cross_device_approval_unavailable");
}

export function makeNodeCrossDeviceApprovalService(options: {
  readonly active: () => Promise<NodeCrossDeviceApprovalActiveDescriptor>;
  readonly authorization: Pick<NodeClientAuthorizationClient, "get">;
  readonly now?: () => number;
  readonly randomBytes?: (length: number) => Uint8Array;
}): NodeCrossDeviceApprovalService {
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? ((length) => Uint8Array.from(nodeRandomBytes(length)));

  const create: NodeCrossDeviceApprovalService["create"] = async (input) => {
    try {
      const key = {
        hubOrigin: input.hubOrigin,
        accountId: input.accountId,
        clientIdentityFingerprint: Uint8Array.from(input.clientIdentityFingerprint),
      };
      const record = await options.authorization.get(key);
      if (record?.status !== "approved" || record.approvedAt === undefined) {
        return approvalError("cross_device_approval_not_approved");
      }
      const active = await options.active();
      if (
        active.hubOrigin !== record.hubOrigin ||
        !e2eeBytesEqual(
          parseE2eeKeyFingerprint(record.fingerprintDisplay),
          key.clientIdentityFingerprint,
        )
      ) {
        return approvalError("cross_device_approval_conflict");
      }
      const issuedAt = now();
      if (!Number.isSafeInteger(issuedAt) || issuedAt < record.approvedAt) {
        return approvalError("cross_device_approval_unavailable");
      }
      const expiresAt = issuedAt + CROSS_DEVICE_APPROVAL_MAX_LIFETIME_MS;
      if (!Number.isSafeInteger(expiresAt)) {
        return approvalError("cross_device_approval_unavailable");
      }
      const tbs = encodeCrossDeviceApprovalTbs({
        hubOrigin: record.hubOrigin,
        accountId: record.accountId,
        nodeId: active.nodeId,
        nodeIdentityPublicKey: active.nodeIdentityPublicKey,
        clientIdentityFingerprint: key.clientIdentityFingerprint,
        maxRole: record.maxRole,
        capabilitySet: record.capabilitySet,
        nodeContinuityId: active.nodeContinuityId,
        nodePolicyGeneration: active.nodePolicyGeneration,
        approvedAt: record.approvedAt,
        approvalId: randomBytes(CROSS_DEVICE_APPROVAL_ID_BYTES),
        issuedAt,
        expiresAt,
      });
      const signature = await active.signApproval(tbs);
      return {
        payload: encodeCrossDeviceApprovalQr({ tbs, signature }),
        approvedAt: record.approvedAt,
        issuedAt,
        expiresAt,
      };
    } catch (error: unknown) {
      return mapFailure(error);
    }
  };

  return { create };
}
