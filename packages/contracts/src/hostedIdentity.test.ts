import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import {
  ACTIVE_SPACE_SWITCH_PATH,
  ActiveSpaceSwitchResponse,
  HOSTED_IDENTITY_PROTOCOL_VERSION,
  HubBrowserSessionResponse,
  HubNormalizedEmail,
  HubSpaceId,
  HubUsername,
  NATIVE_NODE_CLAIM_FINISH_PATH,
  NATIVE_NODE_CLAIM_START_PATH,
  NATIVE_NODE_CLAIM_TRANSCRIPT_VERSION,
  NativeNodeClaimError,
  NativeNodeClaimFinishRequest,
  NativeNodeClaimFinishResponse,
  NativeNodeClaimStartRequest,
  NativeNodeClaimStartResponse,
  PASSWORD_LOGIN_FINISH_PATH,
  PASSWORD_LOGIN_START_PATH,
  PASSWORD_RESET_FINISH_PATH,
  PASSWORD_RESET_REQUEST_PATH,
  PASSWORD_RESET_VERIFY_PATH,
  PUBLIC_SIGNUP_PASSKEY_FINISH_PATH,
  PUBLIC_SIGNUP_PASSKEY_OPTIONS_PATH,
  PUBLIC_SIGNUP_PASSWORD_FINISH_PATH,
  PUBLIC_SIGNUP_START_PATH,
  PUBLIC_SIGNUP_VERIFY_PATH,
  PasswordLoginFinishRequest,
  PasswordLoginStartRequest,
  PasswordLoginStartResponse,
  PasswordResetFinishRequest,
  PasswordResetFinishResponse,
  PasswordResetRequest,
  PasswordResetRequestResponse,
  PasswordResetVerifyRequest,
  PasswordResetVerifyResponse,
  PublicSignupFinishResponse,
  PublicSignupPasskeyFinishRequest,
  PublicSignupPasskeyOptionsRequest,
  PublicSignupPasskeyOptionsResponse,
  PublicSignupPasswordFinishRequest,
  PublicSignupStartRequest,
  PublicSignupStartResponse,
  PublicSignupVerifyRequest,
  PublicSignupVerifyResponse,
} from "./hostedIdentity.ts";

const opaque = "A".repeat(43);
const opaqueB = "B".repeat(43);
const opaqueC = "C".repeat(43);
const accountId = "acct_aaaaaaaaaaaaaaaaaaaaaa";
const sessionId = "sess_aaaaaaaaaaaaaaaaaaaaaa";
const spaceId = "space_aaaaaaaaaaaaaaaaaaaaaa";
const otherSpaceId = "space_bbbbbbbbbbbbbbbbbbbaaa";
const issuedAt = 1_752_710_400_000;
const expiresAt = issuedAt + 15 * 60_000;

const strictDecode = <S extends Schema.Top>(schema: S, input: unknown): S["Type"] =>
  Schema.decodeUnknownSync(schema as unknown as Schema.Decoder<unknown>)(input, {
    onExcessProperty: "error",
  }) as S["Type"];

const activeSpace = {
  id: spaceId,
  kind: "personal",
  displayName: "Ada's space",
  role: "owner",
} as const;

const browserIdentity = {
  account: {
    id: accountId,
    username: "ada_dev",
    displayName: "Ada",
    createdAt: issuedAt,
    disabledAt: null,
  },
  session: {
    id: sessionId,
    accountId,
    activeSpaceId: spaceId,
    createdAt: issuedAt,
    expiresAt: issuedAt + 86_400_000,
    lastSeenAt: issuedAt,
    revokedAt: null,
    revocationReasonCode: null,
  },
  activeSpace,
  spaces: [activeSpace],
  csrfToken: "csrf-sensitive-canary",
} as const;

describe("hosted identity route and version constants", () => {
  it("pins all public identity and native claim routes", () => {
    expect({
      PUBLIC_SIGNUP_START_PATH,
      PUBLIC_SIGNUP_VERIFY_PATH,
      PUBLIC_SIGNUP_PASSKEY_OPTIONS_PATH,
      PUBLIC_SIGNUP_PASSKEY_FINISH_PATH,
      PUBLIC_SIGNUP_PASSWORD_FINISH_PATH,
      PASSWORD_LOGIN_START_PATH,
      PASSWORD_LOGIN_FINISH_PATH,
      PASSWORD_RESET_REQUEST_PATH,
      PASSWORD_RESET_VERIFY_PATH,
      PASSWORD_RESET_FINISH_PATH,
      ACTIVE_SPACE_SWITCH_PATH,
      NATIVE_NODE_CLAIM_START_PATH,
      NATIVE_NODE_CLAIM_FINISH_PATH,
    }).toEqual({
      PUBLIC_SIGNUP_START_PATH: "/api/public-signup/start",
      PUBLIC_SIGNUP_VERIFY_PATH: "/api/public-signup/verify",
      PUBLIC_SIGNUP_PASSKEY_OPTIONS_PATH: "/api/public-signup/passkey/options",
      PUBLIC_SIGNUP_PASSKEY_FINISH_PATH: "/api/public-signup/passkey/finish",
      PUBLIC_SIGNUP_PASSWORD_FINISH_PATH: "/api/public-signup/password/finish",
      PASSWORD_LOGIN_START_PATH: "/api/auth/password/start",
      PASSWORD_LOGIN_FINISH_PATH: "/api/auth/password/finish",
      PASSWORD_RESET_REQUEST_PATH: "/api/auth/password-reset/request",
      PASSWORD_RESET_VERIFY_PATH: "/api/auth/password-reset/verify",
      PASSWORD_RESET_FINISH_PATH: "/api/auth/password-reset/finish",
      ACTIVE_SPACE_SWITCH_PATH: "/api/auth/spaces/active",
      NATIVE_NODE_CLAIM_START_PATH: "/api/native/node-claims/start",
      NATIVE_NODE_CLAIM_FINISH_PATH: "/api/native/node-claims/finish",
    });
    expect(HOSTED_IDENTITY_PROTOCOL_VERSION).toBe(1);
    expect(NATIVE_NODE_CLAIM_TRANSCRIPT_VERSION).toBe(1);
  });
});

describe("hosted username, email, and space authority", () => {
  it("accepts only canonical lowercase usernames and emails", () => {
    expect(strictDecode(HubUsername, "ada_2026")).toBe("ada_2026");
    expect(strictDecode(HubNormalizedEmail, "ada@example.test")).toBe("ada@example.test");

    for (const username of ["ab", "Ada", "ada-dev", " ada", "a".repeat(33)]) {
      expect(() => strictDecode(HubUsername, username)).toThrow();
    }
    for (const email of [
      "Ada@example.test",
      " ada@example.test",
      "ada@example.test ",
      "missing-at.test",
      `${"a".repeat(250)}@x.test`,
    ]) {
      expect(() => strictDecode(HubNormalizedEmail, email)).toThrow();
    }
  });

  it("brands bounded space ids and rejects malformed ids", () => {
    expect(strictDecode(HubSpaceId, spaceId)).toBe(spaceId);
    for (const value of ["space_short", "org_aaaaaaaaaaaaaaaaaaaaaa", `${spaceId}/other`]) {
      expect(() => strictDecode(HubSpaceId, value)).toThrow();
    }
  });

  it("requires one matching active-space membership in browser session responses", () => {
    expect(strictDecode(HubBrowserSessionResponse, browserIdentity)).toEqual(browserIdentity);

    for (const invalid of [
      {
        ...browserIdentity,
        session: { ...browserIdentity.session, accountId: "acct_bbbbbbbbbbbbbbbbbbbbbb" },
      },
      {
        ...browserIdentity,
        session: { ...browserIdentity.session, activeSpaceId: otherSpaceId },
      },
      { ...browserIdentity, spaces: [] },
      {
        ...browserIdentity,
        spaces: [
          activeSpace,
          { ...activeSpace, id: otherSpaceId },
          { ...activeSpace, id: otherSpaceId },
        ],
      },
      {
        ...browserIdentity,
        spaces: [activeSpace, { ...activeSpace, id: otherSpaceId }],
        activeSpace: { ...activeSpace, role: "operator" },
      },
      { ...browserIdentity, internalRole: "platform_admin" },
    ]) {
      expect(() => strictDecode(HubBrowserSessionResponse, invalid)).toThrow();
    }
  });
});

describe("public signup contracts", () => {
  const start = {
    username: "ada_dev",
    email: "ada@example.test",
    antiBotAssertion: "anti-bot-sensitive-canary",
  } as const;
  const startResponse = {
    status: "accepted",
    attemptId: "signup_aaaaaaaaaaaaaaaaaaaaaa",
    attemptSecret: opaque,
    resendAfterMs: 30_000,
    issuedAt,
    expiresAt,
  } as const;

  it("accepts a strict, uniformly accepted signup start", () => {
    expect(strictDecode(PublicSignupStartRequest, start)).toEqual(start);
    expect(strictDecode(PublicSignupStartResponse, startResponse)).toEqual(startResponse);

    for (const invalid of [
      { ...start, username: "Ada" },
      { ...start, email: "ADA@example.test" },
      { ...start, antiBotAssertion: "" },
      { ...start, provider: "resend" },
    ]) {
      expect(() => strictDecode(PublicSignupStartRequest, invalid)).toThrow();
    }
    expect(() =>
      strictDecode(PublicSignupStartResponse, { ...startResponse, expiresAt: issuedAt }),
    ).toThrow();
    expect(() =>
      strictDecode(PublicSignupStartResponse, {
        ...startResponse,
        available: true,
      }),
    ).toThrow();
  });

  it("keeps mailbox proof and activation secrets in exact discriminated envelopes", () => {
    const linkRequest = {
      attemptId: startResponse.attemptId,
      attemptSecret: opaque,
      proof: { kind: "link_token", token: opaqueB },
    } as const;
    const codeRequest = {
      ...linkRequest,
      proof: { kind: "email_code", code: "123456" },
    } as const;
    expect(strictDecode(PublicSignupVerifyRequest, linkRequest)).toEqual(linkRequest);
    expect(strictDecode(PublicSignupVerifyRequest, codeRequest)).toEqual(codeRequest);
    expect(
      strictDecode(PublicSignupVerifyResponse, {
        status: "verified",
        attemptId: startResponse.attemptId,
        activationSecret: opaqueC,
        issuedAt,
        expiresAt,
      }),
    ).toBeTruthy();

    for (const proof of [
      { kind: "link_token", code: "123456" },
      { kind: "email_code", token: opaqueB },
      { kind: "email_code", code: "12ab56" },
      { kind: "email_code", code: "1234567" },
      { kind: "provider", token: opaqueB },
    ]) {
      expect(() => strictDecode(PublicSignupVerifyRequest, { ...linkRequest, proof })).toThrow();
    }
  });

  it("supports passkey and password completion without provider or persistence fields", () => {
    const activation = {
      attemptId: startResponse.attemptId,
      activationSecret: opaqueC,
    } as const;
    expect(strictDecode(PublicSignupPasskeyOptionsRequest, activation)).toEqual(activation);
    expect(
      strictDecode(PublicSignupPasskeyOptionsResponse, {
        options: { challenge: opaque, rp: { name: "Ryco Hub" } },
      }),
    ).toBeTruthy();
    expect(() => strictDecode(PublicSignupPasskeyOptionsResponse, {})).toThrow();
    expect(() =>
      strictDecode(PublicSignupPasskeyOptionsResponse, { options: "not-an-object" }),
    ).toThrow();
    expect(
      strictDecode(PublicSignupPasskeyFinishRequest, {
        ...activation,
        response: { id: "credential" },
        idempotencyKey: opaqueB,
      }),
    ).toBeTruthy();
    expect(
      strictDecode(PublicSignupPasswordFinishRequest, {
        ...activation,
        password: "password-sensitive-canary",
        idempotencyKey: opaqueB,
      }),
    ).toBeTruthy();
    expect(() =>
      strictDecode(PublicSignupPasswordFinishRequest, {
        ...activation,
        password: "a".repeat(11),
        idempotencyKey: opaqueB,
      }),
    ).toThrow();

    const completed = {
      status: "complete",
      identity: browserIdentity,
      recoveryCodes: ["recovery-sensitive-canary"],
    } as const;
    expect(strictDecode(PublicSignupFinishResponse, completed)).toEqual(completed);
    expect(() =>
      strictDecode(PublicSignupFinishResponse, {
        ...completed,
        resendMessageId: "provider-internal",
      }),
    ).toThrow();
  });
});

describe("password login and reset contracts", () => {
  it("reveals exactly one second-factor kind only after password start", () => {
    const start = {
      identifier: "ada_dev",
      password: "password-sensitive-canary",
    } as const;
    expect(strictDecode(PasswordLoginStartRequest, start)).toEqual(start);

    for (const factor of ["totp", "email_code"] as const) {
      const response = {
        status: "factor_required",
        attemptId: "login_aaaaaaaaaaaaaaaaaaaaaa",
        attemptSecret: opaque,
        factor,
        issuedAt,
        expiresAt,
      } as const;
      expect(strictDecode(PasswordLoginStartResponse, response)).toEqual(response);
      expect(
        strictDecode(PasswordLoginFinishRequest, {
          attemptId: response.attemptId,
          attemptSecret: opaque,
          factor,
          code: "123456",
        }),
      ).toBeTruthy();
    }

    expect(() =>
      strictDecode(PasswordLoginFinishRequest, {
        attemptId: "login_aaaaaaaaaaaaaaaaaaaaaa",
        attemptSecret: opaque,
        factor: "totp",
        emailCode: "123456",
      }),
    ).toThrow();
    for (const factor of ["totp", "email_code"] as const) {
      expect(() =>
        strictDecode(PasswordLoginFinishRequest, {
          attemptId: "login_aaaaaaaaaaaaaaaaaaaaaa",
          attemptSecret: opaque,
          factor,
          code: "1234567",
        }),
      ).toThrow();
    }
  });

  it("keeps reset uniform, single-use, and explicitly sessionless", () => {
    expect(strictDecode(PasswordResetRequest, { identifier: "ada@example.test" })).toBeTruthy();
    expect(strictDecode(PasswordResetRequestResponse, { status: "accepted" })).toBeTruthy();
    expect(strictDecode(PasswordResetVerifyRequest, { token: opaque })).toBeTruthy();
    expect(
      strictDecode(PasswordResetVerifyResponse, {
        status: "verified",
        attemptId: "reset_aaaaaaaaaaaaaaaaaaaaaa",
        attemptSecret: opaqueB,
        requiresTotp: true,
        issuedAt,
        expiresAt,
      }),
    ).toBeTruthy();
    expect(
      strictDecode(PasswordResetFinishRequest, {
        attemptId: "reset_aaaaaaaaaaaaaaaaaaaaaa",
        attemptSecret: opaqueB,
        password: "new-password-sensitive-canary",
        factor: { kind: "totp", code: "123456" },
      }),
    ).toBeTruthy();
    expect(strictDecode(PasswordResetFinishResponse, { status: "complete" })).toBeTruthy();
    expect(() =>
      strictDecode(PasswordResetFinishResponse, {
        status: "complete",
        session: browserIdentity.session,
      }),
    ).toThrow();
  });
});

describe("space switch contract", () => {
  it("requires the selected active space to be one exact current membership", () => {
    const switched = {
      activeSpace: { ...activeSpace, id: otherSpaceId, role: "operator" },
      spaces: [activeSpace, { ...activeSpace, id: otherSpaceId, role: "operator" }],
    } as const;
    expect(strictDecode(ActiveSpaceSwitchResponse, switched)).toEqual(switched);
    expect(() =>
      strictDecode(ActiveSpaceSwitchResponse, { ...switched, spaces: [activeSpace] }),
    ).toThrow();
    expect(() =>
      strictDecode(ActiveSpaceSwitchResponse, {
        ...switched,
        spaces: [...switched.spaces, switched.spaces[0]],
      }),
    ).toThrow();
  });
});

describe("native automatic-node claim contracts", () => {
  const fingerprint = `SHA256:${"A".repeat(42)}E`;
  const installationId = "install_aaaaaaaaaaaaaaaaaaaaaa";
  const environmentId = "env_aaaaaaaaaaaaaaaaaaaaaa";
  const claimId = "nclaim_aaaaaaaaaaaaaaaaaaaaaa";
  const node = {
    environmentId,
    label: "Ada's Mac",
    platformOs: "darwin",
    platformArch: "arm64",
    clientVersion: "0.1.8",
    algorithm: "ed25519",
    publicKey: opaque,
    fingerprint,
  } as const;

  it("binds a start response to account, space, session, DPoP key, install, and node", () => {
    expect(strictDecode(NativeNodeClaimStartRequest, { installationId, node })).toBeTruthy();
    const response = {
      protocolVersion: 1,
      transcriptVersion: 1,
      claimId,
      challenge: opaqueB,
      accountId,
      spaceId,
      sessionId,
      dpopKeyThumbprint: opaqueC,
      installationId,
      environmentId,
      nodeFingerprint: fingerprint,
      issuedAt,
      expiresAt,
    } as const;
    expect(strictDecode(NativeNodeClaimStartResponse, response)).toEqual(response);

    for (const invalid of [
      { ...response, protocolVersion: 2 },
      { ...response, transcriptVersion: 2 },
      { ...response, environmentId: "desktop-main" },
      { ...response, expiresAt: issuedAt },
      { ...response, rawDpopProof: "must-not-survive" },
    ]) {
      expect(() => strictDecode(NativeNodeClaimStartResponse, invalid)).toThrow();
    }
  });

  it("accepts only one bounded signature and returns no reusable claim credential", () => {
    expect(
      strictDecode(NativeNodeClaimFinishRequest, {
        claimId,
        signature: `${"A".repeat(85)}Q`,
        idempotencyKey: opaque,
      }),
    ).toBeTruthy();
    expect(
      strictDecode(NativeNodeClaimFinishResponse, {
        status: "claimed",
        disposition: "created",
        node: {
          id: "node_aaaaaaaaaaaaaaaaaaaaaa",
          environmentId,
          label: node.label,
          fingerprint,
          effectiveRole: "owner",
        },
      }),
    ).toBeTruthy();
    expect(() =>
      strictDecode(NativeNodeClaimFinishRequest, {
        claimId,
        signature: `${"A".repeat(85)}B`,
        idempotencyKey: opaque,
      }),
    ).toThrow();
  });

  it("collapses claim failures into stable non-enumerating envelopes", () => {
    expect(
      strictDecode(NativeNodeClaimError, {
        error: "node_claim_rejected",
        retryable: false,
      }),
    ).toBeTruthy();
    expect(
      strictDecode(NativeNodeClaimError, {
        error: "node_claim_unavailable",
        retryable: true,
        retryAfterMs: 1_000,
      }),
    ).toBeTruthy();
    for (const invalid of [
      { error: "wrong_account", retryable: false },
      { error: "node_claim_rejected", retryable: true },
      { error: "node_claim_unavailable", retryable: true, databaseCode: "SQLITE_BUSY" },
    ]) {
      expect(() => strictDecode(NativeNodeClaimError, invalid)).toThrow();
    }
  });
});
