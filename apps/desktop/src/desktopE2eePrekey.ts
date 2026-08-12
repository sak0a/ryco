import { decodeBase64Url, encodeBase64Url } from "@ryco/client-runtime/relay";
import {
  E2EE_MAX_CLOCK_SKEW,
  E2EE_PREKEY_LIFETIME,
  E2EE_PREKEY_ROTATION_OVERLAP,
} from "@ryco/shared/relayE2eeConstants";
import { E2EE_CLIENT_IDENTITY_ALGORITHM, verifyE2eeSignature } from "@ryco/shared/relayE2eeKeys";
import { encodeClientE2eePrekeyTranscript } from "@ryco/shared/relayE2eeTranscripts";

import type { DesktopLocalIntroductionSecurity } from "./localTrustedIntroduction.ts";
import type { DesktopProtectedRecordStore } from "./protectedRecordStore.ts";

const PREKEY_RECORD = "e2ee-client-prekey";

export interface DesktopE2eePrekeyCertificate {
  readonly hubOrigin: string;
  readonly accountId: string;
  readonly identityPublicKey: Uint8Array;
  readonly agreementPublicKey: Uint8Array;
  readonly transcript: Uint8Array;
  readonly signature: Uint8Array;
  readonly createdAt: number;
  readonly expiresAt: number;
}

interface StoredDesktopE2eePrekey {
  readonly hubOrigin: string;
  readonly accountId: string;
  readonly identityPublicKey: string;
  readonly agreementPublicKey: string;
  readonly signature: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export class DesktopE2eePrekeyError extends Error {
  readonly code = "prekey_unavailable" as const;

  constructor() {
    super("Desktop E2EE prekey operation failed.");
    this.name = "DesktopE2eePrekeyError";
  }
}

function fail(): never {
  throw new DesktopE2eePrekeyError();
}

function validity(
  certificate: Pick<DesktopE2eePrekeyCertificate, "createdAt" | "expiresAt">,
  now: number,
): "usable" | "renewable" | "expired" {
  if (now > certificate.expiresAt + E2EE_MAX_CLOCK_SKEW) return "expired";
  if (now + E2EE_MAX_CLOCK_SKEW < certificate.createdAt) return "expired";
  if (now + E2EE_PREKEY_ROTATION_OVERLAP >= certificate.expiresAt) return "renewable";
  return "usable";
}

function decodeStored(value: string | null): StoredDesktopE2eePrekey | null {
  if (value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Partial<StoredDesktopE2eePrekey>;
  if (
    typeof record.hubOrigin !== "string" ||
    record.hubOrigin.length === 0 ||
    typeof record.accountId !== "string" ||
    record.accountId.length === 0 ||
    typeof record.identityPublicKey !== "string" ||
    typeof record.agreementPublicKey !== "string" ||
    typeof record.signature !== "string" ||
    !Number.isSafeInteger(record.createdAt) ||
    Number(record.createdAt) < 0 ||
    !Number.isSafeInteger(record.expiresAt) ||
    Number(record.expiresAt) <= Number(record.createdAt) ||
    Number(record.expiresAt) - Number(record.createdAt) > E2EE_PREKEY_LIFETIME
  ) {
    return null;
  }
  return record as StoredDesktopE2eePrekey;
}

function certificateFromStored(
  stored: StoredDesktopE2eePrekey,
): DesktopE2eePrekeyCertificate | null {
  try {
    const identityPublicKey = decodeBase64Url(stored.identityPublicKey);
    const agreementPublicKey = decodeBase64Url(stored.agreementPublicKey);
    const signature = decodeBase64Url(stored.signature);
    const transcript = encodeClientE2eePrekeyTranscript({
      hubOrigin: stored.hubOrigin,
      accountId: stored.accountId,
      identityPublicKey,
      agreementPublicKey,
      createdAt: stored.createdAt,
      expiresAt: stored.expiresAt,
    });
    if (
      !verifyE2eeSignature({
        algorithm: E2EE_CLIENT_IDENTITY_ALGORITHM,
        publicKey: identityPublicKey,
        message: transcript,
        signature,
      })
    ) {
      return null;
    }
    return {
      hubOrigin: stored.hubOrigin,
      accountId: stored.accountId,
      identityPublicKey,
      agreementPublicKey,
      transcript,
      signature,
      createdAt: stored.createdAt,
      expiresAt: stored.expiresAt,
    };
  } catch {
    return null;
  }
}

export class DesktopE2eePrekeyIssuer {
  readonly #origin: string;
  readonly #security: DesktopLocalIntroductionSecurity;
  readonly #records: DesktopProtectedRecordStore;
  readonly #now: () => number;
  #pending: Promise<unknown> = Promise.resolve();

  constructor(input: {
    readonly origin: string;
    readonly security: DesktopLocalIntroductionSecurity;
    readonly records: DesktopProtectedRecordStore;
    readonly now?: () => number;
  }) {
    this.#origin = input.origin;
    this.#security = input.security;
    this.#records = input.records;
    this.#now = input.now ?? Date.now;
  }

  ensure(accountId: string): Promise<DesktopE2eePrekeyCertificate> {
    const operation = this.#pending.then(
      () => this.#ensure(accountId),
      () => this.#ensure(accountId),
    );
    this.#pending = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async #ensure(accountId: string): Promise<DesktopE2eePrekeyCertificate> {
    try {
      const [identityPublicKey, agreementPublicKey, storedValue] = await Promise.all([
        this.#security.getSigningPublicKey(),
        this.#security.ensureAgreementPublicKey(),
        this.#records.read(PREKEY_RECORD),
      ]);
      const parsed = decodeStored(storedValue);
      const stored = parsed === null ? null : certificateFromStored(parsed);
      if (
        stored !== null &&
        stored.hubOrigin === this.#origin &&
        stored.accountId === accountId &&
        encodeBase64Url(stored.identityPublicKey) === encodeBase64Url(identityPublicKey) &&
        encodeBase64Url(stored.agreementPublicKey) === encodeBase64Url(agreementPublicKey) &&
        validity(stored, this.#now()) === "usable"
      ) {
        return stored;
      }

      const createdAt = this.#now();
      const expiresAt = createdAt + E2EE_PREKEY_LIFETIME;
      const transcript = encodeClientE2eePrekeyTranscript({
        hubOrigin: this.#origin,
        accountId,
        identityPublicKey,
        agreementPublicKey,
        createdAt,
        expiresAt,
      });
      const signature = await (await this.#security.getSigningKey()).sign(transcript);
      const certificate = {
        hubOrigin: this.#origin,
        accountId,
        identityPublicKey,
        agreementPublicKey,
        transcript,
        signature,
        createdAt,
        expiresAt,
      } satisfies DesktopE2eePrekeyCertificate;
      if (
        !verifyE2eeSignature({
          algorithm: E2EE_CLIENT_IDENTITY_ALGORITHM,
          publicKey: identityPublicKey,
          message: transcript,
          signature,
        })
      ) {
        return fail();
      }
      const encoded: StoredDesktopE2eePrekey = {
        hubOrigin: certificate.hubOrigin,
        accountId: certificate.accountId,
        identityPublicKey: encodeBase64Url(certificate.identityPublicKey),
        agreementPublicKey: encodeBase64Url(certificate.agreementPublicKey),
        signature: encodeBase64Url(certificate.signature),
        createdAt,
        expiresAt,
      };
      await this.#records.write(PREKEY_RECORD, JSON.stringify(encoded));
      return certificate;
    } catch (cause) {
      if (cause instanceof DesktopE2eePrekeyError) throw cause;
      return fail();
    }
  }
}
