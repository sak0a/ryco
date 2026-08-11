import * as Crypto from "node:crypto";

import {
  type RelayE2eeNativeHandshakeStartInput,
  type RelayE2eeNativeHandshakeStartResult,
} from "@ryco/client-runtime/relay";
import {
  verifyNodeE2eeCapabilityStatement,
  type NodeE2eeVerifiedPin,
} from "@ryco/shared/relayE2eeCapabilityVerify";
import {
  E2eeClientHandshake,
  type E2eeClientEstablishedResult,
} from "@ryco/shared/relayE2eeHandshake";
import {
  e2eeBytesEqual,
  e2eeKeyFingerprint,
  formatE2eeKeyFingerprint,
} from "@ryco/shared/relayE2eeKeys";
import { E2EE_SUITE_25519_CHACHAPOLY_SHA256 } from "@ryco/shared/relayE2eeWire";

import { DesktopE2eePrekeyIssuer, type DesktopE2eePrekeyCertificate } from "./desktopE2eePrekey.ts";
import { DesktopE2eeTrustStore, type DesktopVerifiedE2eePin } from "./desktopE2eeTrust.ts";
import type { DesktopHostedIdentityStatus } from "./desktopHostedIdentity.ts";
import type { DesktopLocalIntroductionSecurity } from "./localTrustedIntroduction.ts";
import type { DesktopNativeSecurityHelper } from "./nativeSecurityHelper.ts";
import type { DesktopProtectedRecordStore } from "./protectedRecordStore.ts";

const LOCAL_SUITE_PREFERENCE = [E2EE_SUITE_25519_CHACHAPOLY_SHA256] as const;
const PREPARED_ATTEMPT_LIFETIME_MS = 2 * 60 * 1_000;
const HANDSHAKE_HANDLE_LIFETIME_MS = 20_000;
const MAX_PREPARED_ATTEMPTS = 8;
const MAX_HANDSHAKES = 16;
const HANDLE = /^[A-Za-z0-9_-]{43}$/;

type DesktopE2eeHandshakeSecurity = DesktopLocalIntroductionSecurity &
  Pick<DesktopNativeSecurityHelper, "withAgreementSecretKey">;

export type DesktopNativeE2eePreparation =
  | { readonly kind: "web-eligible" }
  | { readonly kind: "strict-unavailable" }
  | {
      readonly kind: "native";
      readonly attemptHandle: string;
      readonly credentials: {
        readonly tier: "native";
        readonly accountId: string;
        readonly identityPublicKey: Uint8Array;
        readonly agreementPublicKey: Uint8Array;
        readonly prekeyTranscript: Uint8Array;
        readonly prekeySignature: Uint8Array;
      };
      readonly verifiedPin: NodeE2eeVerifiedPin;
      readonly acceptedPolicyGeneration: number;
    };

interface PreparedAttempt {
  readonly accountId: string;
  readonly nodeId: string;
  readonly pin: DesktopVerifiedE2eePin;
  readonly certificate: DesktopE2eePrekeyCertificate;
  readonly expiresAt: number;
}

interface HeldHandshake {
  readonly client: E2eeClientHandshake;
  readonly expiresAt: number;
}

export class DesktopNativeE2eeHandshakeError extends Error {
  readonly code = "native_e2ee_unavailable" as const;

  constructor() {
    super("Desktop native E2EE operation failed.");
    this.name = "DesktopNativeE2eeHandshakeError";
  }
}

function fail(): never {
  throw new DesktopNativeE2eeHandshakeError();
}

function opaqueHandle(): string {
  return Crypto.randomBytes(32).toString("base64url");
}

function samePin(left: DesktopVerifiedE2eePin, right: DesktopVerifiedE2eePin): boolean {
  return (
    left.hubOrigin === right.hubOrigin &&
    left.accountId === right.accountId &&
    left.localNodeHandle === right.localNodeHandle &&
    left.nodeId === right.nodeId &&
    left.environmentId === right.environmentId &&
    left.verifiedFingerprint === right.verifiedFingerprint &&
    e2eeBytesEqual(left.verifiedIdentityPublicKey, right.verifiedIdentityPublicKey) &&
    left.recordedContinuityId === right.recordedContinuityId &&
    left.acceptedPolicyGeneration === right.acceptedPolicyGeneration &&
    left.clientIdentityFingerprint === right.clientIdentityFingerprint &&
    left.approvedAt === right.approvedAt &&
    left.verificationMethod === right.verificationMethod
  );
}

function pinForAttempt(pin: DesktopVerifiedE2eePin): NodeE2eeVerifiedPin {
  return {
    identityFingerprint: e2eeKeyFingerprint("node-identity", pin.verifiedIdentityPublicKey),
    continuityId: pin.recordedContinuityId,
  };
}

function sameCertificate(
  left: DesktopE2eePrekeyCertificate,
  right: DesktopE2eePrekeyCertificate,
): boolean {
  return (
    left.hubOrigin === right.hubOrigin &&
    left.accountId === right.accountId &&
    left.createdAt === right.createdAt &&
    left.expiresAt === right.expiresAt &&
    e2eeBytesEqual(left.identityPublicKey, right.identityPublicKey) &&
    e2eeBytesEqual(left.agreementPublicKey, right.agreementPublicKey) &&
    e2eeBytesEqual(left.transcript, right.transcript) &&
    e2eeBytesEqual(left.signature, right.signature)
  );
}

function nativePreparation(
  attemptHandle: string,
  attempt: PreparedAttempt,
): Extract<DesktopNativeE2eePreparation, { readonly kind: "native" }> {
  return {
    kind: "native",
    attemptHandle,
    credentials: {
      tier: "native",
      accountId: attempt.accountId,
      identityPublicKey: attempt.certificate.identityPublicKey,
      agreementPublicKey: attempt.certificate.agreementPublicKey,
      prekeyTranscript: attempt.certificate.transcript,
      prekeySignature: attempt.certificate.signature,
    },
    verifiedPin: pinForAttempt(attempt.pin),
    acceptedPolicyGeneration: attempt.pin.acceptedPolicyGeneration,
  };
}

export class DesktopNativeE2eeHandshakeService {
  readonly #origin: string;
  readonly #security: DesktopE2eeHandshakeSecurity;
  readonly #trust: DesktopE2eeTrustStore;
  readonly #prekey: DesktopE2eePrekeyIssuer;
  readonly #identityStatus: () => DesktopHostedIdentityStatus;
  readonly #now: () => number;
  readonly #prepared = new Map<string, PreparedAttempt>();
  readonly #handshakes = new Map<string, HeldHandshake>();

  constructor(input: {
    readonly origin: string;
    readonly security: DesktopE2eeHandshakeSecurity;
    readonly records: DesktopProtectedRecordStore;
    readonly identityStatus: () => DesktopHostedIdentityStatus;
    readonly trust?: DesktopE2eeTrustStore;
    readonly prekey?: DesktopE2eePrekeyIssuer;
    readonly now?: () => number;
  }) {
    this.#origin = input.origin;
    this.#security = input.security;
    this.#trust = input.trust ?? new DesktopE2eeTrustStore(input.records);
    this.#now = input.now ?? Date.now;
    this.#prekey =
      input.prekey ??
      new DesktopE2eePrekeyIssuer({
        origin: input.origin,
        security: input.security,
        records: input.records,
        now: this.#now,
      });
    this.#identityStatus = input.identityStatus;
  }

  #prune(): void {
    const now = this.#now();
    for (const [handle, attempt] of this.#prepared) {
      if (attempt.expiresAt < now) this.#prepared.delete(handle);
    }
    for (const [handle, held] of this.#handshakes) {
      if (held.expiresAt >= now) continue;
      this.#handshakes.delete(handle);
      held.client.destroy();
    }
  }

  async prepare(input: {
    readonly accountId: string;
    readonly nodeId: string;
  }): Promise<DesktopNativeE2eePreparation> {
    this.#prune();
    const [pin, marker] = await Promise.all([
      this.#trust.read(this.#origin, input.accountId, input.nodeId),
      this.#trust.hasVerifiedOrigin(this.#origin),
    ]);
    if (pin === null) return marker ? { kind: "strict-unavailable" } : { kind: "web-eligible" };

    const identity = this.#identityStatus();
    if (
      identity.status !== "ready" ||
      identity.accountId !== input.accountId ||
      identity.nodeId !== input.nodeId
    ) {
      return { kind: "strict-unavailable" };
    }
    const certificate = await this.#prekey.ensure(input.accountId);
    if (
      !e2eeBytesEqual(certificate.identityPublicKey, await this.#security.getSigningPublicKey()) ||
      !e2eeBytesEqual(
        certificate.agreementPublicKey,
        await this.#security.ensureAgreementPublicKey(),
      ) ||
      pin.clientIdentityFingerprint !==
        formatE2eeKeyFingerprint(
          e2eeKeyFingerprint("client-identity", certificate.identityPublicKey),
        )
    ) {
      return fail();
    }
    for (const [attemptHandle, prepared] of this.#prepared) {
      if (
        prepared.accountId === input.accountId &&
        prepared.nodeId === input.nodeId &&
        samePin(prepared.pin, pin) &&
        sameCertificate(prepared.certificate, certificate)
      ) {
        return nativePreparation(attemptHandle, prepared);
      }
    }
    if (this.#prepared.size >= MAX_PREPARED_ATTEMPTS) return fail();
    const attemptHandle = opaqueHandle();
    const prepared: PreparedAttempt = {
      accountId: input.accountId,
      nodeId: input.nodeId,
      pin,
      certificate,
      expiresAt: this.#now() + PREPARED_ATTEMPT_LIFETIME_MS,
    };
    this.#prepared.set(attemptHandle, prepared);
    return nativePreparation(attemptHandle, prepared);
  }

  async start(
    attemptHandle: string,
    input: RelayE2eeNativeHandshakeStartInput,
  ): Promise<RelayE2eeNativeHandshakeStartResult> {
    this.#prune();
    if (!HANDLE.test(attemptHandle)) return fail();
    const prepared = this.#prepared.get(attemptHandle);
    if (prepared === undefined || prepared.expiresAt < this.#now()) return fail();
    const identity = this.#identityStatus();
    if (
      identity.status !== "ready" ||
      identity.accountId !== prepared.accountId ||
      identity.nodeId !== prepared.nodeId ||
      input.channel.hubOrigin !== this.#origin ||
      input.intendedCapability !== input.channel.channelOpenCapability ||
      input.intendedRole !== input.channel.channelOpenEffectiveRole ||
      input.selectedSuite !== E2EE_SUITE_25519_CHACHAPOLY_SHA256 ||
      input.offeredSuites.length !== 1 ||
      input.offeredSuites[0] !== E2EE_SUITE_25519_CHACHAPOLY_SHA256
    ) {
      return fail();
    }
    const livePin = await this.#trust.read(this.#origin, prepared.accountId, prepared.nodeId);
    if (livePin === null || !samePin(livePin, prepared.pin)) return fail();
    const verification = verifyNodeE2eeCapabilityStatement({
      statement: input.statement,
      connectedHubOrigin: this.#origin,
      tier: "native",
      localSuitePreference: LOCAL_SUITE_PREFERENCE,
      now: this.#now(),
      accountId: prepared.accountId,
      pin: pinForAttempt(livePin),
      acceptedPolicyGeneration: livePin.acceptedPolicyGeneration,
    });
    if (
      verification.kind !== "verified" ||
      verification.statement.nodeId !== prepared.nodeId ||
      verification.selectedSuite !== input.selectedSuite ||
      verification.anchor === "none"
    ) {
      return fail();
    }
    const committedPin = await this.#trust.recordAuthenticatedStatement({
      hubOrigin: this.#origin,
      accountId: prepared.accountId,
      nodeId: prepared.nodeId,
      localNodeHandle: livePin.localNodeHandle,
      verification,
    });
    const certificate = prepared.certificate;
    let client: E2eeClientHandshake | undefined;
    const result = await this.#security.withAgreementSecretKey((agreementSecretKey) => {
      client = new E2eeClientHandshake({
        channel: input.channel,
        advertised: {
          nodeId: verification.statement.nodeId,
          nodeIdentityFingerprint:
            verification.anchor === "pin-unchanged"
              ? e2eeKeyFingerprint("node-identity", committedPin.verifiedIdentityPublicKey)
              : verification.statement.identityFingerprint,
          prekeyId: verification.statement.prekeyCertificate.prekeyId,
          agreementPublicKey: verification.statement.prekeyCertificate.agreementPublicKey,
          continuityChainTranscripts: verification.statement.continuityChain.map(
            (entry) => entry.transcript,
          ),
          continuityId: committedPin.recordedContinuityId,
        },
        selectedSuite: input.selectedSuite,
        offeredSuites: input.offeredSuites,
        credentials: {
          tier: "native",
          accountId: prepared.accountId,
          identityPublicKey: certificate.identityPublicKey,
          agreementPublicKey: certificate.agreementPublicKey,
          agreementSecretKey,
          prekeyTranscript: certificate.transcript,
          prekeySignature: certificate.signature,
        },
        intendedCapability: input.intendedCapability,
        intendedRole: input.intendedRole,
      });
      return client.createHello(this.#now());
    });
    if (result.kind !== "hello") {
      client?.destroy();
      return { kind: "fatal", result };
    }
    if (client === undefined || this.#handshakes.size >= MAX_HANDSHAKES) {
      client?.destroy();
      return fail();
    }
    const handle = opaqueHandle();
    this.#handshakes.set(handle, {
      client,
      expiresAt: Math.min(result.deadlineAt, this.#now() + HANDSHAKE_HANDLE_LIFETIME_MS),
    });
    return { kind: "hello", handle, result };
  }

  finish(handle: string, payload: Uint8Array): E2eeClientEstablishedResult {
    this.#prune();
    if (!HANDLE.test(handle)) return fail();
    const held = this.#handshakes.get(handle);
    if (held === undefined) return fail();
    this.#handshakes.delete(handle);
    if (held.expiresAt < this.#now()) {
      held.client.destroy();
      return fail();
    }
    try {
      return held.client.receiveServerAccept(payload, this.#now());
    } catch {
      held.client.destroy();
      return fail();
    }
  }

  destroy(handle: string): void {
    if (!HANDLE.test(handle)) return;
    const held = this.#handshakes.get(handle);
    this.#handshakes.delete(handle);
    held?.client.destroy();
  }

  dispose(): void {
    for (const held of this.#handshakes.values()) held.client.destroy();
    this.#handshakes.clear();
    this.#prepared.clear();
  }
}
