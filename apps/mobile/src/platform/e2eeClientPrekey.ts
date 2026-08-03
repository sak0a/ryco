import type { KVService } from "@ryco/client-runtime/platform";
import { decodeBase64Url, encodeBase64Url } from "@ryco/client-runtime/relay";
import {
  E2EE_MAX_CLOCK_SKEW,
  E2EE_PREKEY_LIFETIME,
  E2EE_PREKEY_ROTATION_OVERLAP,
} from "@ryco/shared/relayE2eeConstants";
import { E2EE_CLIENT_IDENTITY_ALGORITHM, verifyE2eeSignature } from "@ryco/shared/relayE2eeKeys";
import { encodeClientE2eePrekeyTranscript } from "@ryco/shared/relayE2eeTranscripts";

import { getMobileDeviceIdentityPublicKey, getMobileDeviceSigningKey } from "./deviceKey";
import {
  mobileE2eeAgreementKey,
  MobileE2eeAgreementKeyError,
  type MobileE2eeAgreementKey,
} from "./e2eeAgreementKey";
import { mobileKV } from "./kv";

// The device's §7.4 client agreement-prekey certificate —
// docs/relay-e2ee-protocol.md §6.2 (the device key cross-signs the static
// agreement key), §6.4 (lifetime and the re-sign remedy), and §7.4 (the
// certificate itself).
//
// WHAT THIS OWNS: producing the certificate the native tier presents inside the
// encrypted IK handshake payload (§8.5), keeping it durable so a launch that
// changes nothing re-signs nothing, and re-signing when §6.4 says it must. It
// does not handshake and does not advertise.
//
// THE CROSS-SIGNATURE IS NEVER BUILT BY HAND. §7.2's no-ad-hoc-transcript rule
// is enforced here by type, not by discipline: the only thing this module hands
// the device key is `encodeClientE2eePrekeyTranscript` output, the encoder is
// called by this module rather than by a caller, and NOTHING this module exports
// accepts bytes to sign. A caller can ask for a certificate over a namespace; it
// cannot ask for a signature over anything.
//
// THE CERTIFICATE IS NOT A SECRET. It is a signed public statement — two public
// keys, a namespace, a validity window, and a signature — so it lives in the
// plain KV beside the rest of the app's durable state, and only the agreement
// SECRET is in the device-only keychain namespace (§6.3). Storage that is backed
// up therefore cannot resurrect anything usable: a restored certificate whose
// `agreementPublicKey` no longer matches this device's key is re-signed below,
// and the key it named cannot follow it (§6.3's storage class, and the Android
// backup exclusion).

/** The `(hubOrigin, accountId)` namespace a certificate claims (§7.4). */
export interface ClientE2eePrekeyNamespace {
  readonly hubOrigin: string;
  readonly accountId: string;
}

export interface ClientE2eePrekeyCertificate {
  readonly hubOrigin: string;
  readonly accountId: string;
  /** X9.63 uncompressed P-256 device key (§7.4 element 4). */
  readonly identityPublicKey: Uint8Array;
  /** Raw X25519 agreement key, the Noise `s` of IK (§7.4 element 6). */
  readonly agreementPublicKey: Uint8Array;
  /** Exact §7.4 transcript bytes, as `E2eeClientHandshakeCredentials` carries them. */
  readonly transcript: Uint8Array;
  /** ECDSA P-256 over SHA-256 of `transcript`, fixed-width raw `r ‖ s` (§7.1). */
  readonly signature: Uint8Array;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export type MobileClientE2eePrekeyErrorCode =
  /** The namespace or the device's own keys cannot be represented in a §7.4 transcript. */
  | "e2ee_prekey_unavailable"
  /** The agreement key, the device key, or the signature failed. */
  | "e2ee_prekey_custody_failed";

export class MobileClientE2eePrekeyError extends Error {
  readonly code: MobileClientE2eePrekeyErrorCode;

  constructor(code: MobileClientE2eePrekeyErrorCode) {
    super("Device E2EE prekey operation failed.");
    this.name = "MobileClientE2eePrekeyError";
    this.code = code;
  }
}

/**
 * Where a certificate sits in its §6.4 lifetime.
 *
 * The twin of the node's `nodeE2eePrekeyValidity`, restated here because the two
 * sit on opposite sides of the client/server boundary and the mobile app cannot
 * import server code. `renewable` is §6.4's re-sign trigger and is deliberately
 * distinct from `expired`, which is a hard failure at a verifier: a renewable
 * certificate is still valid evidence, and §6.4 says an established channel is
 * never disturbed by rotation or expiry.
 */
export type ClientE2eePrekeyValidity = "usable" | "renewable" | "expired";

export function clientE2eePrekeyValidity(
  certificate: { readonly createdAt: number; readonly expiresAt: number },
  now: number,
): ClientE2eePrekeyValidity {
  if (now > certificate.expiresAt + E2EE_MAX_CLOCK_SKEW) return "expired";
  // The lower bound matters after a clock jumps backwards: the material is fine,
  // but no verifier would accept a certificate that has not started yet, so
  // re-issuing is the repair.
  if (now + E2EE_MAX_CLOCK_SKEW < certificate.createdAt) return "expired";
  if (now + E2EE_PREKEY_ROTATION_OVERLAP >= certificate.expiresAt) return "renewable";
  return "usable";
}

/**
 * The durable slot. One record, mirroring the node's single active-prekey slot:
 * a device serves one `(hubOrigin, accountId)` namespace at a time, and a
 * certificate for a namespace this device is no longer in is not evidence worth
 * retaining.
 */
export const CLIENT_E2EE_PREKEY_RECORD_KEY = "ryco.e2ee.clientPrekeyCertificate.v1";

interface StoredClientE2eePrekey {
  readonly hubOrigin: string;
  readonly accountId: string;
  readonly identityPublicKey: string;
  readonly agreementPublicKey: string;
  readonly signature: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface MobileClientE2eePrekey {
  /**
   * §6.4's client remedy, run at application start and before the credentials
   * are needed: return the stored certificate when it is still bound to this
   * device's keys, still inside its window, and still verifiable, and re-sign
   * otherwise.
   */
  readonly ensure: (namespace: ClientE2eePrekeyNamespace) => Promise<ClientE2eePrekeyCertificate>;
}

export interface MobileClientE2eePrekeyDependencies {
  readonly agreementKey?: MobileE2eeAgreementKey;
  readonly kv?: Pick<KVService, "getItem" | "setItem">;
  readonly now?: () => number;
}

function prekeyError(code: MobileClientE2eePrekeyErrorCode): never {
  throw new MobileClientE2eePrekeyError(code);
}

function parseStored(value: string | null): StoredClientE2eePrekey | null {
  if (value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Partial<StoredClientE2eePrekey>;
  const strings = [
    record.hubOrigin,
    record.accountId,
    record.identityPublicKey,
    record.agreementPublicKey,
    record.signature,
  ];
  if (strings.some((field) => typeof field !== "string" || field.length === 0)) return null;
  if (!Number.isSafeInteger(record.createdAt) || !Number.isSafeInteger(record.expiresAt)) {
    return null;
  }
  return record as StoredClientE2eePrekey;
}

export function makeMobileClientE2eePrekey(
  dependencies: MobileClientE2eePrekeyDependencies = {},
): MobileClientE2eePrekey {
  const agreementKey = dependencies.agreementKey ?? mobileE2eeAgreementKey;
  const kv = dependencies.kv ?? mobileKV;
  const now = dependencies.now ?? Date.now;

  /**
   * The device's agreement key, created on first use.
   *
   * `agreement_key_conflict` is not a failure here: it is what a concurrent
   * creator looks like from this side, and the repair is to read the key that
   * won rather than to refuse. Every other code is a refusal — §6.3 admits no
   * software-key fallback and no degraded mode, so a device that cannot hold the
   * key simply has no E2EE.
   */
  const ensureAgreementKey = async (): Promise<Uint8Array> => {
    const descriptor = await agreementKey.getPublicDescriptor().catch((cause: unknown) => {
      if (
        cause instanceof MobileE2eeAgreementKeyError &&
        cause.code === "agreement_key_not_found"
      ) {
        return null;
      }
      throw cause;
    });
    if (descriptor !== null) return descriptor.publicKey;
    const created = await agreementKey.generate().catch((cause: unknown) => {
      if (cause instanceof MobileE2eeAgreementKeyError && cause.code === "agreement_key_conflict") {
        return null;
      }
      throw cause;
    });
    if (created !== null) return created.publicKey;
    return (await agreementKey.getPublicDescriptor()).publicKey;
  };

  /**
   * §7.2: the encoder is called HERE, on a described transcript, and its output
   * is the only thing that reaches the device key.
   */
  const encodeTranscript = (input: {
    readonly hubOrigin: string;
    readonly accountId: string;
    readonly identityPublicKey: Uint8Array;
    readonly agreementPublicKey: Uint8Array;
    readonly createdAt: number;
    readonly expiresAt: number;
  }): Uint8Array => {
    try {
      return encodeClientE2eePrekeyTranscript(input);
    } catch {
      // A malformed origin, an over-long account id, or a point that fails §7.1
      // validation. None of them may travel out of here as their own message.
      return prekeyError("e2ee_prekey_unavailable");
    }
  };

  const verifies = (certificate: ClientE2eePrekeyCertificate): boolean =>
    verifyE2eeSignature({
      algorithm: E2EE_CLIENT_IDENTITY_ALGORITHM,
      publicKey: certificate.identityPublicKey,
      message: certificate.transcript,
      signature: certificate.signature,
    });

  /**
   * Best effort, deliberately. Losing the record costs one signature at the next
   * launch; failing the certificate over a storage hiccup would take a working
   * device off E2EE entirely.
   */
  const persist = async (certificate: ClientE2eePrekeyCertificate): Promise<void> => {
    const record: StoredClientE2eePrekey = {
      hubOrigin: certificate.hubOrigin,
      accountId: certificate.accountId,
      identityPublicKey: encodeBase64Url(certificate.identityPublicKey),
      agreementPublicKey: encodeBase64Url(certificate.agreementPublicKey),
      signature: encodeBase64Url(certificate.signature),
      createdAt: certificate.createdAt,
      expiresAt: certificate.expiresAt,
    };
    await kv.setItem(CLIENT_E2EE_PREKEY_RECORD_KEY, JSON.stringify(record)).catch(() => undefined);
  };

  const issue = async (
    namespace: ClientE2eePrekeyNamespace,
    identityPublicKey: Uint8Array,
    agreementPublicKey: Uint8Array,
  ): Promise<ClientE2eePrekeyCertificate> => {
    const createdAt = now();
    // §6.4: the lifetime MUST NOT exceed `E2EE_PREKEY_LIFETIME`, and issuers
    // SHOULD use exactly it. Exactly it, computed here and never taken from a
    // caller, is the only shape that cannot drift past the bound.
    const expiresAt = createdAt + E2EE_PREKEY_LIFETIME;
    const transcript = encodeTranscript({
      hubOrigin: namespace.hubOrigin,
      accountId: namespace.accountId,
      identityPublicKey,
      agreementPublicKey,
      createdAt,
      expiresAt,
    });
    let signature: Uint8Array;
    try {
      signature = await (await getMobileDeviceSigningKey()).sign(transcript);
    } catch {
      return prekeyError("e2ee_prekey_custody_failed");
    }
    const certificate: ClientE2eePrekeyCertificate = {
      hubOrigin: namespace.hubOrigin,
      accountId: namespace.accountId,
      identityPublicKey,
      agreementPublicKey,
      transcript,
      signature,
      createdAt,
      expiresAt,
    };
    // The check a node will run in §8.6, run here against this device's own
    // certificate. Presenting one that fails it would fail the handshake with no
    // local evidence of why.
    if (!verifies(certificate)) return prekeyError("e2ee_prekey_custody_failed");
    await persist(certificate);
    return certificate;
  };

  /**
   * Rebuild the stored certificate, or `null` if anything about it has moved.
   *
   * The transcript is RE-ENCODED from the record's fields rather than replayed
   * from storage, so the bytes this returns are always a named encoder's output
   * (§7.2) and the stored signature has to verify over them. A record whose
   * fields no longer agree with the device — a different namespace, a key that
   * was regenerated, a restored file from another installation — cannot survive
   * that check even before its validity window is considered.
   */
  const restore = (
    stored: StoredClientE2eePrekey,
    namespace: ClientE2eePrekeyNamespace,
    identityPublicKey: Uint8Array,
    agreementPublicKey: Uint8Array,
  ): ClientE2eePrekeyCertificate | null => {
    if (stored.hubOrigin !== namespace.hubOrigin || stored.accountId !== namespace.accountId) {
      return null;
    }
    if (
      stored.identityPublicKey !== encodeBase64Url(identityPublicKey) ||
      stored.agreementPublicKey !== encodeBase64Url(agreementPublicKey)
    ) {
      return null;
    }
    if (clientE2eePrekeyValidity(stored, now()) !== "usable") return null;
    let signature: Uint8Array;
    try {
      signature = decodeBase64Url(stored.signature);
    } catch {
      return null;
    }
    const certificate: ClientE2eePrekeyCertificate = {
      hubOrigin: stored.hubOrigin,
      accountId: stored.accountId,
      identityPublicKey,
      agreementPublicKey,
      transcript: encodeTranscript({
        hubOrigin: stored.hubOrigin,
        accountId: stored.accountId,
        identityPublicKey,
        agreementPublicKey,
        createdAt: stored.createdAt,
        expiresAt: stored.expiresAt,
      }),
      signature,
      createdAt: stored.createdAt,
      expiresAt: stored.expiresAt,
    };
    return verifies(certificate) ? certificate : null;
  };

  /**
   * One certificate at a time, so two callers racing at launch cannot both sign
   * and leave the loser's certificate durably recorded over the winner's.
   */
  let pending: Promise<unknown> = Promise.resolve();
  const exclusive = <A>(operation: () => Promise<A>): Promise<A> => {
    const run = pending.then(operation, operation);
    pending = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    ensure: (namespace) =>
      exclusive(async () => {
        const agreementPublicKey = await ensureAgreementKey().catch((cause: unknown) => {
          if (cause instanceof MobileE2eeAgreementKeyError) {
            return prekeyError("e2ee_prekey_custody_failed");
          }
          throw cause;
        });
        const identityPublicKey = await getMobileDeviceIdentityPublicKey().catch(() =>
          prekeyError("e2ee_prekey_custody_failed"),
        );
        const stored = parseStored(
          await kv.getItem(CLIENT_E2EE_PREKEY_RECORD_KEY).catch(() => null),
        );
        const restored =
          stored === null
            ? null
            : restore(stored, namespace, identityPublicKey, agreementPublicKey);
        return restored ?? (await issue(namespace, identityPublicKey, agreementPublicKey));
      }),
  };
}

export const mobileClientE2eePrekey = makeMobileClientE2eePrekey();
