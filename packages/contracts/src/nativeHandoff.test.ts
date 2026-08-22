import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import {
  NATIVE_HANDOFF_CALLBACK_URIS,
  NATIVE_HANDOFF_CAPABILITY_PATH,
  NATIVE_HANDOFF_CODE_LIFETIME_MS,
  NATIVE_HANDOFF_PROTOCOL_VERSION,
  NATIVE_HANDOFF_TRANSACTION_LIFETIME_MS,
  NATIVE_IDENTITY_CAPABILITY_VERSION,
  NativeHandoffApproveResponse,
  NativeHandoffCapability,
  NativeHandoffCancelResponse,
  NativeHandoffPresentation,
  NativeHandoffConnectRedeemRequest,
  NativeHandoffConnectRedeemResponse,
  NativeHandoffPurpose,
  NativeHandoffRedeemRequest,
  NativeHandoffRedeemResponse,
  NativeHandoffStartRequest,
  NativeHandoffStartResponse,
} from "./nativeHandoff.ts";

const opaque = "A".repeat(43);
const callback = NATIVE_HANDOFF_CALLBACK_URIS[0];
const strictDecode = <SchemaType extends Schema.Top>(schema: SchemaType, input: unknown) =>
  Schema.decodeUnknownSync(schema as unknown as Schema.Decoder<unknown>)(input, {
    onExcessProperty: "error",
  });

describe("native handoff constants", () => {
  it("pins the exact version, discovery path, callbacks, and lifetimes", () => {
    expect(NATIVE_HANDOFF_CAPABILITY_PATH).toBe("/.well-known/ryco-hub");
    expect(NATIVE_HANDOFF_PROTOCOL_VERSION).toBe(1);
    expect(NATIVE_HANDOFF_TRANSACTION_LIFETIME_MS).toBe(5 * 60_000);
    expect(NATIVE_HANDOFF_CODE_LIFETIME_MS).toBe(60_000);
    expect(NATIVE_HANDOFF_CALLBACK_URIS).toEqual([
      "ryco-dev://hosted/complete",
      "ryco-preview://hosted/complete",
      "ryco://hosted/complete",
    ]);
  });
});

describe("NativeHandoffCapability", () => {
  const capability = {
    service: "ryco-hub",
    protocolVersion: 1,
    nativeHandoff: { mode: "system-browser", version: 1 },
    relyingParty: { id: "hub.example.test", displayName: "Ryco Hub" },
  } as const;

  it("accepts the exact bounded capability document", () => {
    expect(strictDecode(NativeHandoffCapability, capability)).toEqual(capability);
  });

  it("accepts an exact additive native identity v2 policy without weakening v1", () => {
    const withNativeIdentity = {
      ...capability,
      nativeIdentity: {
        version: NATIVE_IDENTITY_CAPABILITY_VERSION,
        email: {
          verification: "required",
          antiBot: { provider: "turnstile", siteKey: "0x4AAAAAAAAAAABBBBBBBBBB" },
        },
        signup: {
          status: "enabled",
          primaryCredentials: ["passkey", "password"],
        },
        login: {
          methods: ["passkey", "password", "recovery_code"],
          passwordSecondFactor: {
            totp: "when_enrolled",
            fallback: "verified_email_code",
          },
        },
        recovery: { recoveryCode: true, passwordReset: true },
      },
    } as const;

    expect(strictDecode(NativeHandoffCapability, withNativeIdentity)).toEqual(withNativeIdentity);
    expect(strictDecode(NativeHandoffCapability, capability)).toEqual(capability);
    expect(
      strictDecode(NativeHandoffCapability, {
        ...withNativeIdentity,
        nativeIdentity: {
          ...withNativeIdentity.nativeIdentity,
          signup: { status: "disabled" },
        },
      }),
    ).toBeTruthy();

    for (const nativeIdentity of [
      { ...withNativeIdentity.nativeIdentity, version: 1 },
      {
        ...withNativeIdentity.nativeIdentity,
        email: { ...withNativeIdentity.nativeIdentity.email, verification: "skipped" },
      },
      {
        ...withNativeIdentity.nativeIdentity,
        signup: { ...withNativeIdentity.nativeIdentity.signup, primaryCredentials: [] },
      },
      {
        ...withNativeIdentity.nativeIdentity,
        login: { ...withNativeIdentity.nativeIdentity.login, methods: ["password", "password"] },
      },
      { ...withNativeIdentity.nativeIdentity, internalPolicy: "must-not-survive" },
    ]) {
      expect(() =>
        strictDecode(NativeHandoffCapability, { ...capability, nativeIdentity }),
      ).toThrow();
    }
  });

  it("rejects unsupported versions, modes, RP ids, and extra nested fields", () => {
    for (const invalid of [
      { ...capability, service: "other" },
      { ...capability, protocolVersion: 2 },
      { ...capability, nativeHandoff: { mode: "device-code", version: 1 } },
      { ...capability, nativeHandoff: { mode: "system-browser", version: 2 } },
      { ...capability, relyingParty: { ...capability.relyingParty, id: "https://hub.test" } },
      { ...capability, relyingParty: { ...capability.relyingParty, displayName: "x".repeat(65) } },
      {
        ...capability,
        nativeHandoff: { ...capability.nativeHandoff, secret: "must-not-survive" },
      },
    ]) {
      expect(() => strictDecode(NativeHandoffCapability, invalid)).toThrow();
    }
  });
});

describe("native handoff request and response schemas", () => {
  const start = {
    redirectUri: callback,
    codeChallenge: opaque,
    codeChallengeMethod: "S256",
    state: opaque,
    deviceLabel: "Laurin’s iPhone",
  } as const;

  it("accepts the canonical start, presentation, approval, cancellation, and redeem flow", () => {
    expect(strictDecode(NativeHandoffStartRequest, start)).toEqual(start);
    expect(
      strictDecode(NativeHandoffStartResponse, {
        handoffId: opaque,
        authorizationUrl: `https://hub.example.test/native/authorize/${opaque}`,
        expiresAt: 1_752_710_700_000,
      }),
    ).toMatchObject({ handoffId: opaque });
    expect(
      strictDecode(NativeHandoffPresentation, {
        status: "pending",
        deviceLabel: start.deviceLabel,
        expiresAt: 1_752_710_700_000,
        providerHint: "github",
      }),
    ).toMatchObject({ status: "pending", providerHint: "github" });
    expect(
      strictDecode(NativeHandoffApproveResponse, {
        redirectUri: `${callback}?code=${opaque}&state=${opaque}&handoff_id=${opaque}`,
      }),
    ).toBeTruthy();
    expect(
      strictDecode(NativeHandoffCancelResponse, {
        redirectUri: `${callback}?error=access_denied&state=${opaque}&handoff_id=${opaque}`,
      }),
    ).toBeTruthy();
    expect(
      strictDecode(NativeHandoffRedeemRequest, {
        handoffId: opaque,
        code: opaque,
        codeVerifier: opaque,
      }),
    ).toBeTruthy();
  });

  it("adds typed GitHub sign-in hints and connect purposes without changing old sign-in bytes", () => {
    expect(strictDecode(NativeHandoffStartRequest, start)).toEqual(start);
    expect(
      strictDecode(NativeHandoffStartRequest, {
        ...start,
        purpose: { kind: "sign_in", providerHint: "github" },
      }),
    ).toBeTruthy();
    expect(
      strictDecode(NativeHandoffStartRequest, {
        ...start,
        purpose: { kind: "connect_external_identity", provider: "github" },
      }),
    ).toBeTruthy();
    expect(
      strictDecode(NativeHandoffPurpose, {
        kind: "connect_external_identity",
        provider: "github",
      }),
    ).toBeTruthy();

    for (const purpose of [
      { kind: "sign_in", providerHint: "gitlab" },
      { kind: "connect_external_identity", provider: "gitlab" },
      { kind: "connect_external_identity", provider: "github", token: "must-not-survive" },
      { kind: "unknown", provider: "github" },
    ]) {
      expect(() => strictDecode(NativeHandoffStartRequest, { ...start, purpose })).toThrow();
    }
  });

  it("keeps link redemption separate from session redemption", () => {
    const connectRequest = {
      handoffId: opaque,
      code: opaque,
      codeVerifier: opaque,
      purpose: { kind: "connect_external_identity", provider: "github" },
      totpCode: "123456",
    } as const;
    const connectResponse = {
      status: "connected",
      purpose: { kind: "connect_external_identity", provider: "github" },
      externalIdentity: {
        provider: "github",
        login: "octocat",
        displayName: "The Octocat",
        connectedAt: 1_752_710_400_000,
        lastUsedAt: null,
      },
    } as const;

    expect(strictDecode(NativeHandoffConnectRedeemRequest, connectRequest)).toEqual(connectRequest);
    expect(strictDecode(NativeHandoffConnectRedeemResponse, connectResponse)).toEqual(
      connectResponse,
    );
    expect(() => strictDecode(NativeHandoffRedeemRequest, connectRequest)).toThrow();
    expect(() => strictDecode(NativeHandoffRedeemResponse, connectResponse)).toThrow();
    expect(() =>
      strictDecode(NativeHandoffConnectRedeemResponse, {
        ...connectResponse,
        account: { id: "acct_aaaaaaaaaaaaaaaaaaaaaa" },
      }),
    ).toThrow();
    expect(() =>
      strictDecode(NativeHandoffConnectRedeemRequest, {
        ...connectRequest,
        purpose: { kind: "sign_in", providerHint: "github" },
      }),
    ).toThrow();
  });

  it("rejects callback aliases, malformed secrets, unsafe authorization URLs, and extras", () => {
    for (const invalid of [
      { ...start, redirectUri: `${callback}?next=other` },
      { ...start, redirectUri: "https://hub.example.test/complete" },
      { ...start, codeChallenge: `${opaque}=` },
      { ...start, state: opaque.slice(1) },
      { ...start, deviceLabel: "" },
      { ...start, deviceLabel: "x".repeat(65) },
      { ...start, secret: "must-not-survive" },
    ]) {
      expect(() => strictDecode(NativeHandoffStartRequest, invalid)).toThrow();
    }

    for (const authorizationUrl of [
      "http://hub.example.test/native/authorize/id",
      "https://user:pass@hub.example.test/native/authorize/id",
      "https://hub.example.test/native/authorize/id?secret=value",
      "not a url",
    ]) {
      expect(() =>
        strictDecode(NativeHandoffStartResponse, {
          handoffId: opaque,
          authorizationUrl,
          expiresAt: 1_752_710_700_000,
        }),
      ).toThrow();
    }
  });

  it("rejects malformed or authority-bearing callback responses", () => {
    for (const redirectUri of [
      `${callback}?code=${opaque}&state=${opaque}`,
      `${callback}?code=${opaque}&state=${opaque}&handoff_id=${opaque}&next=https://evil.test`,
      `${callback}?code=${opaque}&code=${opaque}&state=${opaque}&handoff_id=${opaque}`,
      `${callback}?error=other&state=${opaque}&handoff_id=${opaque}`,
      `${callback}?error=access_denied&code=${opaque}&state=${opaque}&handoff_id=${opaque}`,
      `ryco-dev://other/complete?code=${opaque}&state=${opaque}&handoff_id=${opaque}`,
    ]) {
      expect(() => strictDecode(NativeHandoffApproveResponse, { redirectUri })).toThrow();
      expect(() => strictDecode(NativeHandoffCancelResponse, { redirectUri })).toThrow();
    }
  });
});

describe("NativeHandoffRedeemResponse", () => {
  const response = {
    account: {
      id: "acct_aaaaaaaaaaaaaaaaaaaaaa",
      displayName: "Ada",
      role: "owner",
      createdAt: 1_752_710_400_000,
      disabledAt: null,
    },
    session: {
      id: "sess_aaaaaaaaaaaaaaaaaaaaaa",
      accountId: "acct_aaaaaaaaaaaaaaaaaaaaaa",
      familyId: "sfam_aaaaaaaaaaaaaaaaaaaaaa",
      clientLabel: "Laurin’s iPhone",
      kind: "native",
      createdAt: 1_752_710_400_000,
      expiresAt: 1_753_315_200_000,
      lastSeenAt: 1_752_710_400_000,
      replacedBySessionId: null,
      revokedAt: null,
      revocationReasonCode: null,
    },
    token: opaque,
  } as const;

  it("accepts one fresh native session and rejects inconsistent authority", () => {
    expect(strictDecode(NativeHandoffRedeemResponse, response)).toEqual(response);

    for (const invalid of [
      { ...response, token: "" },
      { ...response, session: { ...response.session, kind: "browser" } },
      { ...response, session: { ...response.session, accountId: "acct_bbbbbbbbbbbbbbbbbbbbbb" } },
      { ...response, session: { ...response.session, revokedAt: response.session.createdAt } },
      { ...response, account: { ...response.account, disabledAt: response.account.createdAt } },
      { ...response, secret: "must-not-survive" },
    ]) {
      expect(() => strictDecode(NativeHandoffRedeemResponse, invalid)).toThrow();
    }
  });
});
