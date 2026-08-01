import {
  deriveE2eeAgreementPublicKey,
  e2eeKeyFingerprint,
  E2EE_AGREEMENT_ALGORITHM,
  generateE2eeAgreementKeyPair,
} from "@ryco/shared/relayE2eeKeys";

import type { ProtectedSecretStore } from "./ProtectedSecretStore.ts";

// Custody of the node's static X25519 agreement key —
// docs/relay-e2ee-protocol.md §6.2 (static agreement keys) and §6.3 (custody by
// endpoint), whose node row is "a new named secret in the node's protected
// secret store, in the same store class and under the same create-only naming
// discipline as the node identity key … loaded transiently for use and zeroized
// after each use".
//
// A SIBLING OF `NodeSigningIdentity`, NOT AN EXTENSION OF IT. §6.2's
// key-separation rule is absolute — the identity key never performs key
// agreement and the agreement key never signs — and `NodeSigningIdentity`
// enforces its half by rejecting anything whose `asymmetricKeyType` is not
// `ed25519`. Keeping the two in separate modules over the same store is what
// makes the rule structural instead of a comment.
//
// WHERE THIS DIFFERS FROM THE IDENTITY KEY, AND WHY IT HAS TO. The signing
// identity never lets private material cross its module boundary: callers hand
// it bytes and receive a signature. That is not available here. The Noise
// responder takes the static secret as raw bytes
// (`E2eeNodeHandshakeOptions.agreementSecretKey`, §8), so an agree-only façade
// would mean forking the §14.1 Noise module — the one module §14.1 requires to
// stay small and singular. `withSecretKey` is the narrowest thing that is
// actually expressible: the secret is live only for the duration of one
// caller-supplied function, this module zeroizes it on every exit from that
// function, and no accessor returns it.

export type NodeAgreementIdentityErrorCode =
  | "agreement_key_not_found"
  | "agreement_key_corrupt"
  | "agreement_key_conflict"
  | "agreement_key_operation_failed";

export class NodeAgreementIdentityError extends Error {
  readonly code: NodeAgreementIdentityErrorCode;

  constructor(code: NodeAgreementIdentityErrorCode) {
    super("Node agreement identity operation failed.");
    this.name = "NodeAgreementIdentityError";
    this.code = code;
  }
}

export interface NodeAgreementPublicDescriptor {
  readonly algorithm: typeof E2EE_AGREEMENT_ALGORITHM;
  /** Raw X25519 public key, `E2EE_AGREEMENT_PUBLIC_KEY_BYTES` (§7.1). */
  readonly publicKey: Uint8Array;
  /** `ryco.e2ee-agreement-key.v1` fingerprint of `publicKey` (§7.1). */
  readonly fingerprint: Uint8Array;
}

export interface NodeAgreementIdentity {
  readonly generate: (secretName: string) => Promise<NodeAgreementPublicDescriptor>;
  readonly getPublicDescriptor: (secretName: string) => Promise<NodeAgreementPublicDescriptor>;
  /**
   * Borrow the agreement secret for exactly one operation (§6.3).
   *
   * The bytes handed to `use` are this module's buffer and are zeroized before
   * this call settles — on return, on throw, and on rejection alike. A caller
   * MUST NOT retain the reference past `use`; the Noise handshake copies what it
   * needs and erases its own copy (§8), which is what makes the borrow window
   * exactly the length of one handshake construction.
   */
  readonly withSecretKey: <A>(
    secretName: string,
    use: (secretKey: Uint8Array) => Promise<A> | A,
  ) => Promise<A>;
  readonly delete: (secretName: string) => Promise<void>;
}

/**
 * X25519 secret-scalar length (RFC 7748 §5).
 *
 * Stated separately from `E2EE_AGREEMENT_PUBLIC_KEY_BYTES` even though the curve
 * makes the two equal: they bound different values, and a future check that
 * reused the public-key constant for a secret would read as if the two were the
 * same thing.
 */
const AGREEMENT_SECRET_KEY_BYTES = 32;

function agreementError(code: NodeAgreementIdentityErrorCode): never {
  throw new NodeAgreementIdentityError(code);
}

function publicDescriptorFromSecretKey(secretKey: Uint8Array): NodeAgreementPublicDescriptor {
  let publicKey: Uint8Array;
  try {
    publicKey = deriveE2eeAgreementPublicKey(secretKey);
  } catch {
    return agreementError("agreement_key_corrupt");
  }
  return {
    algorithm: E2EE_AGREEMENT_ALGORITHM,
    publicKey,
    fingerprint: e2eeKeyFingerprint("agreement", publicKey),
  };
}

/**
 * Load the stored scalar, zeroizing it before rejecting.
 *
 * The rejection path matters as much as the success path: a stored value of the
 * wrong length is still key-shaped material, and leaving it in a live buffer
 * because the length check failed would be the one leak this discipline exists
 * to prevent.
 */
async function loadSecretKey(store: ProtectedSecretStore, secretName: string): Promise<Uint8Array> {
  const secretKey = await store.get(secretName);
  if (secretKey === null) return agreementError("agreement_key_not_found");
  if (secretKey.byteLength !== AGREEMENT_SECRET_KEY_BYTES) {
    secretKey.fill(0);
    return agreementError("agreement_key_corrupt");
  }
  return secretKey;
}

export function makeNodeAgreementIdentity(store: ProtectedSecretStore): NodeAgreementIdentity {
  return {
    generate: async (secretName) => {
      // §6.2/§14.5: generated by the shared primitive surface, so this endpoint
      // has no curve arithmetic and no randomness policy of its own.
      const { secretKey } = generateE2eeAgreementKeyPair();
      try {
        const descriptor = publicDescriptorFromSecretKey(secretKey);
        try {
          await store.create(secretName, secretKey);
        } catch (error: unknown) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "protected_store_conflict"
          ) {
            return agreementError("agreement_key_conflict");
          }
          return agreementError("agreement_key_operation_failed");
        }
        return descriptor;
      } finally {
        secretKey.fill(0);
      }
    },
    getPublicDescriptor: async (secretName) => {
      const secretKey = await loadSecretKey(store, secretName);
      try {
        return publicDescriptorFromSecretKey(secretKey);
      } finally {
        secretKey.fill(0);
      }
    },
    withSecretKey: async (secretName, use) => {
      const secretKey = await loadSecretKey(store, secretName);
      try {
        return await use(secretKey);
      } finally {
        secretKey.fill(0);
      }
    },
    delete: async (secretName) => {
      try {
        await store.remove(secretName);
      } catch {
        return agreementError("agreement_key_operation_failed");
      }
    },
  };
}
