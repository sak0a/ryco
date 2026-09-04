import * as Crypto from "node:crypto";

import type {
  NativeE2eeAccountTrustedNode,
  NativeE2eePlatformService,
} from "@ryco/client-runtime/platform";
import { decodeBase64Url, encodeBase64Url } from "@ryco/client-runtime/relay";
import {
  e2eeBytesEqual,
  e2eeKeyFingerprint,
  e2eeSha256,
  validateE2eeNodeIdentityPublicKey,
} from "@ryco/shared/relayE2eeKeys";
import { encodeClientE2eePrekeyCertificateCarrier } from "@ryco/shared/relayE2eeTranscripts";

import { DesktopE2eePrekeyIssuer } from "./desktopE2eePrekey.ts";
import type { DesktopLocalIntroductionSecurity } from "./localTrustedIntroduction.ts";
import type { DesktopNativeSecurityHelper } from "./nativeSecurityHelper.ts";
import type { DesktopProtectedRecordStore } from "./protectedRecordStore.ts";

const ACCOUNT_TRUST_RECORD = "e2ee-account-trust";
const MAX_RECORDS = 128;
const MAX_IDENTITY_CHANGES = 16;
const MAX_TEXT = 512;

interface StoredTrustDocument {
  readonly version: 1;
  readonly records: readonly {
    readonly hubOrigin: string;
    readonly accountId: string;
    readonly nodeId: string;
    readonly identityPublicKey: string;
    readonly identityFingerprint: string;
    readonly agreementFingerprint: string;
    readonly continuityId: string;
    readonly acceptedPolicyGeneration: number;
    readonly firstTrustedAt: number;
    readonly lastTrustedAt: number;
    readonly identityChanges: readonly {
      readonly previousIdentityFingerprint: string;
      readonly nextIdentityFingerprint: string;
      readonly changedAt: number;
    }[];
  }[];
}

export class DesktopNativeE2eeError extends Error {
  constructor() {
    super("Desktop native E2EE platform operation failed.");
    this.name = "DesktopNativeE2eeError";
  }
}

function fail(): never {
  throw new DesktopNativeE2eeError();
}

function bounded(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT;
}

function parseDocument(value: string | null): readonly NativeE2eeAccountTrustedNode[] {
  if (value === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return fail();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fail();
  const document = parsed as Partial<StoredTrustDocument>;
  if (
    document.version !== 1 ||
    !Array.isArray(document.records) ||
    document.records.length > MAX_RECORDS
  ) {
    return fail();
  }
  const records: NativeE2eeAccountTrustedNode[] = [];
  const scopes = new Set<string>();
  try {
    for (const value of document.records) {
      if (
        !bounded(value.hubOrigin) ||
        !bounded(value.accountId) ||
        !bounded(value.nodeId) ||
        !bounded(value.continuityId) ||
        !Number.isSafeInteger(value.acceptedPolicyGeneration) ||
        value.acceptedPolicyGeneration < 0 ||
        !Number.isSafeInteger(value.firstTrustedAt) ||
        value.firstTrustedAt < 0 ||
        !Number.isSafeInteger(value.lastTrustedAt) ||
        value.lastTrustedAt < value.firstTrustedAt ||
        !Array.isArray(value.identityChanges) ||
        value.identityChanges.length > MAX_IDENTITY_CHANGES
      ) {
        return fail();
      }
      const identityPublicKey = validateE2eeNodeIdentityPublicKey(
        decodeBase64Url(value.identityPublicKey),
      );
      const identityFingerprint = decodeBase64Url(value.identityFingerprint);
      const agreementFingerprint = decodeBase64Url(value.agreementFingerprint);
      const identityChanges = value.identityChanges.map(
        (change: StoredTrustDocument["records"][number]["identityChanges"][number]) => ({
          previousIdentityFingerprint: decodeBase64Url(change.previousIdentityFingerprint),
          nextIdentityFingerprint: decodeBase64Url(change.nextIdentityFingerprint),
          changedAt: change.changedAt,
        }),
      );
      if (
        !e2eeBytesEqual(
          identityFingerprint,
          e2eeKeyFingerprint("node-identity", identityPublicKey),
        ) ||
        agreementFingerprint.byteLength !== 32 ||
        identityChanges.some(
          (change: (typeof identityChanges)[number]) =>
            change.previousIdentityFingerprint.byteLength !== 32 ||
            change.nextIdentityFingerprint.byteLength !== 32 ||
            !Number.isSafeInteger(change.changedAt) ||
            change.changedAt < value.firstTrustedAt ||
            change.changedAt > value.lastTrustedAt,
        )
      ) {
        return fail();
      }
      const scope = `${value.hubOrigin}\n${value.accountId}\n${value.nodeId}`;
      if (scopes.has(scope)) return fail();
      scopes.add(scope);
      records.push({
        ...value,
        identityPublicKey,
        identityFingerprint,
        agreementFingerprint,
        identityChanges,
      });
    }
    return records;
  } catch (cause) {
    if (cause instanceof DesktopNativeE2eeError) throw cause;
    return fail();
  }
}

function encodeDocument(records: readonly NativeE2eeAccountTrustedNode[]): string {
  const document: StoredTrustDocument = {
    version: 1,
    records: records.map((record) => ({
      ...record,
      identityPublicKey: encodeBase64Url(record.identityPublicKey),
      identityFingerprint: encodeBase64Url(record.identityFingerprint),
      agreementFingerprint: encodeBase64Url(record.agreementFingerprint),
      identityChanges: record.identityChanges.map((change) => ({
        previousIdentityFingerprint: encodeBase64Url(change.previousIdentityFingerprint),
        nextIdentityFingerprint: encodeBase64Url(change.nextIdentityFingerprint),
        changedAt: change.changedAt,
      })),
    })),
  };
  return JSON.stringify(document);
}

type DesktopE2eeSecurity = DesktopLocalIntroductionSecurity &
  Pick<DesktopNativeSecurityHelper, "withAgreementSecretKey">;

/** Main-process-only adapter for shared account enrollment and trust resolution. */
export function createDesktopNativeE2eePlatform(input: {
  readonly origin: string;
  readonly installationId: string;
  readonly appVersion: string;
  readonly deviceLabel: () => string;
  readonly security: DesktopE2eeSecurity;
  readonly records: DesktopProtectedRecordStore;
  readonly prekey?: DesktopE2eePrekeyIssuer;
  readonly randomBytes?: (length: number) => Uint8Array;
  readonly platform?: "darwin" | "linux" | "windows";
}): NativeE2eePlatformService {
  const prekey =
    input.prekey ??
    new DesktopE2eePrekeyIssuer({
      origin: input.origin,
      security: input.security,
      records: input.records,
    });
  const randomBytes = input.randomBytes ?? ((length: number) => Crypto.randomBytes(length));
  let operations: Promise<void> = Promise.resolve();
  const exclusive = <A>(run: () => Promise<A>): Promise<A> => {
    const result = operations.then(run, run);
    operations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const enrollmentId = `enr_${Crypto.createHash("sha256")
    .update("ryco.desktop.e2ee-enrollment.v1\0", "utf8")
    .update(input.installationId, "utf8")
    .digest()
    .subarray(0, 16)
    .toString("base64url")}`;

  return {
    platform: input.platform ?? (process.platform as "darwin" | "linux" | "windows"),
    appVersion: input.appVersion,
    deviceLabel: input.deviceLabel,
    randomBytes: async (length) => Uint8Array.from(randomBytes(length)),
    ensureIdentity: async () => {
      const publicKey = await input.security.getSigningPublicKey();
      return {
        publicKey,
        fingerprint: e2eeKeyFingerprint("client-identity", publicKey),
        backing: "secure-enclave",
      };
    },
    ensureClientPrekey: async (namespace) => {
      if (namespace.hubOrigin !== input.origin) return fail();
      const certificate = await prekey.ensure(namespace.accountId);
      const carrier = encodeClientE2eePrekeyCertificateCarrier(
        certificate.transcript,
        certificate.signature,
      );
      return {
        agreementPublicKey: Uint8Array.from(certificate.agreementPublicKey),
        agreementFingerprint: e2eeKeyFingerprint("agreement", certificate.agreementPublicKey),
        transcript: Uint8Array.from(certificate.transcript),
        signature: Uint8Array.from(certificate.signature),
        certificate: carrier,
        certificateDigest: e2eeSha256(carrier),
        expiresAt: certificate.expiresAt,
      };
    },
    getOrCreateEnrollmentId: async () => enrollmentId,
    clearEnrollment: async () => undefined,
    withAgreementSecret: (use) => input.security.withAgreementSecretKey(use),
    readAccountTrustedNode: (scope) =>
      exclusive(async () => {
        const records = parseDocument(await input.records.read(ACCOUNT_TRUST_RECORD));
        return (
          records.find(
            (record) =>
              record.hubOrigin === scope.hubOrigin &&
              record.accountId === scope.accountId &&
              record.nodeId === scope.nodeId,
          ) ?? null
        );
      }),
    writeAccountTrustedNode: (record) =>
      exclusive(async () => {
        if (
          record.hubOrigin !== input.origin ||
          record.identityChanges.length > MAX_IDENTITY_CHANGES
        ) {
          return fail();
        }
        const current = parseDocument(await input.records.read(ACCOUNT_TRUST_RECORD));
        const same = (candidate: NativeE2eeAccountTrustedNode) =>
          candidate.hubOrigin === record.hubOrigin &&
          candidate.accountId === record.accountId &&
          candidate.nodeId === record.nodeId;
        const existing = current.find(same);
        if (existing && record.acceptedPolicyGeneration < existing.acceptedPolicyGeneration) {
          return fail();
        }
        const next = [...current.filter((candidate) => !same(candidate)), record];
        if (next.length > MAX_RECORDS) return fail();
        await input.records.write(ACCOUNT_TRUST_RECORD, encodeDocument(next));
      }),
  };
}
