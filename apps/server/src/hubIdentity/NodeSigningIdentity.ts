import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signBytes,
} from "node:crypto";

import {
  ED25519_PUBLIC_KEY_BYTES,
  ED25519_SIGNATURE_BYTES,
  fingerprintNodePublicKey,
  type NodePublicKeyDescriptor,
} from "@ryco/shared/nodeIdentity";

import type { ProtectedSecretStore } from "./ProtectedSecretStore.ts";

export type NodeSigningIdentityErrorCode =
  | "node_key_not_found"
  | "node_key_corrupt"
  | "node_key_conflict"
  | "node_signing_failed";

export class NodeSigningIdentityError extends Error {
  readonly code: NodeSigningIdentityErrorCode;

  constructor(code: NodeSigningIdentityErrorCode) {
    super("Node signing identity operation failed.");
    this.name = "NodeSigningIdentityError";
    this.code = code;
  }
}

export interface NodeSigningPublicDescriptor extends NodePublicKeyDescriptor {
  readonly algorithm: "ed25519";
  readonly fingerprint: Uint8Array;
}

export interface NodeSigningIdentity {
  readonly generate: (secretName: string) => Promise<NodeSigningPublicDescriptor>;
  readonly getPublicDescriptor: (secretName: string) => Promise<NodeSigningPublicDescriptor>;
  readonly sign: (secretName: string, transcript: Uint8Array) => Promise<Uint8Array>;
  readonly delete: (secretName: string) => Promise<void>;
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function signingError(code: NodeSigningIdentityErrorCode): never {
  throw new NodeSigningIdentityError(code);
}

function bufferView(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function publicDescriptorFromPrivateDer(privateDer: Uint8Array): NodeSigningPublicDescriptor {
  try {
    const privateKey = createPrivateKey({
      key: bufferView(privateDer),
      format: "der",
      type: "pkcs8",
    });
    if (privateKey.asymmetricKeyType !== "ed25519") return signingError("node_key_corrupt");
    const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
    if (
      spki.byteLength !== ED25519_SPKI_PREFIX.byteLength + ED25519_PUBLIC_KEY_BYTES ||
      !spki.subarray(0, ED25519_SPKI_PREFIX.byteLength).equals(ED25519_SPKI_PREFIX)
    ) {
      return signingError("node_key_corrupt");
    }
    const publicKey = Uint8Array.from(spki.subarray(ED25519_SPKI_PREFIX.byteLength));
    return {
      algorithm: "ed25519",
      publicKey,
      fingerprint: fingerprintNodePublicKey({ algorithm: "ed25519", publicKey }),
    };
  } catch (error: unknown) {
    if (error instanceof NodeSigningIdentityError) throw error;
    return signingError("node_key_corrupt");
  }
}

async function loadPrivateDer(
  store: ProtectedSecretStore,
  secretName: string,
): Promise<Uint8Array> {
  const privateDer = await store.get(secretName);
  if (privateDer === null) return signingError("node_key_not_found");
  if (privateDer.byteLength < 32 || privateDer.byteLength > 256) {
    privateDer.fill(0);
    return signingError("node_key_corrupt");
  }
  return privateDer;
}

export function makeNodeSigningIdentity(store: ProtectedSecretStore): NodeSigningIdentity {
  return {
    generate: async (secretName) => {
      const { privateKey } = generateKeyPairSync("ed25519");
      const privateDer = Buffer.from(privateKey.export({ format: "der", type: "pkcs8" }));
      try {
        const descriptor = publicDescriptorFromPrivateDer(privateDer);
        try {
          await store.create(secretName, privateDer);
        } catch (error: unknown) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "protected_store_conflict"
          ) {
            return signingError("node_key_conflict");
          }
          return signingError("node_signing_failed");
        }
        return descriptor;
      } finally {
        privateDer.fill(0);
      }
    },
    getPublicDescriptor: async (secretName) => {
      const privateDer = await loadPrivateDer(store, secretName);
      try {
        return publicDescriptorFromPrivateDer(privateDer);
      } finally {
        privateDer.fill(0);
      }
    },
    sign: async (secretName, transcript) => {
      if (
        !(transcript instanceof Uint8Array) ||
        transcript.byteLength === 0 ||
        transcript.byteLength > 4096
      ) {
        return signingError("node_signing_failed");
      }
      const privateDer = await loadPrivateDer(store, secretName);
      try {
        let privateKey;
        try {
          privateKey = createPrivateKey({
            key: bufferView(privateDer),
            format: "der",
            type: "pkcs8",
          });
        } catch {
          return signingError("node_key_corrupt");
        }
        if (privateKey.asymmetricKeyType !== "ed25519") return signingError("node_key_corrupt");
        const signature = signBytes(null, transcript, privateKey);
        if (signature.byteLength !== ED25519_SIGNATURE_BYTES) {
          return signingError("node_signing_failed");
        }
        return Uint8Array.from(signature);
      } finally {
        privateDer.fill(0);
      }
    },
    delete: async (secretName) => {
      try {
        await store.remove(secretName);
      } catch {
        return signingError("node_signing_failed");
      }
    },
  };
}
