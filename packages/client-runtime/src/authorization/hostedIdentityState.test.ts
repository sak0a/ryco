import { describe, expect, it } from "vite-plus/test";

import {
  presentBrowserIdentity,
  presentPasswordLoginFactor,
  presentPasswordResetVerification,
  presentPublicSignupStart,
  presentPublicSignupVerification,
} from "./hostedIdentityState.ts";

const secret = "A".repeat(43);
const issuedAt = 1_752_710_400_000;
const expiresAt = issuedAt + 900_000;

describe("hosted identity presentation state", () => {
  it("never publishes signup attempt or activation secrets", () => {
    const checkEmail = presentPublicSignupStart({
      status: "accepted",
      attemptId: "signup_aaaaaaaaaaaaaaaaaaaaaa",
      attemptSecret: secret,
      resendAfterMs: 30_000,
      issuedAt,
      expiresAt,
    } as never);
    const chooseCredential = presentPublicSignupVerification({
      status: "verified",
      attemptId: "signup_aaaaaaaaaaaaaaaaaaaaaa",
      activationSecret: secret,
      issuedAt,
      expiresAt,
    } as never);

    expect(checkEmail).toEqual({
      status: "check-email",
      attemptId: "signup_aaaaaaaaaaaaaaaaaaaaaa",
      resendAfterMs: 30_000,
      expiresAt,
    });
    expect(chooseCredential).toEqual({
      status: "choose-credential",
      attemptId: "signup_aaaaaaaaaaaaaaaaaaaaaa",
      expiresAt,
    });
    expect(JSON.stringify([checkEmail, chooseCredential])).not.toContain(secret);
  });

  it("never publishes login/reset attempt secrets", () => {
    const login = presentPasswordLoginFactor({
      status: "factor_required",
      attemptId: "login_aaaaaaaaaaaaaaaaaaaaaa",
      attemptSecret: secret,
      factor: "email_code",
      issuedAt,
      expiresAt,
    } as never);
    const reset = presentPasswordResetVerification({
      status: "verified",
      attemptId: "reset_aaaaaaaaaaaaaaaaaaaaaa",
      attemptSecret: secret,
      requiresTotp: true,
      issuedAt,
      expiresAt,
    } as never);

    expect(login).toMatchObject({ status: "factor-required", factor: "email_code" });
    expect(reset).toMatchObject({ status: "set-password", requiresTotp: true });
    expect(JSON.stringify([login, reset])).not.toContain(secret);
  });

  it("removes CSRF material from publishable identity metadata", () => {
    const identity = presentBrowserIdentity({
      account: {
        id: "acct_aaaaaaaaaaaaaaaaaaaaaa",
        username: "ada_dev",
        displayName: "Ada",
        createdAt: issuedAt,
        disabledAt: null,
      },
      session: {
        id: "sess_aaaaaaaaaaaaaaaaaaaaaa",
        accountId: "acct_aaaaaaaaaaaaaaaaaaaaaa",
        activeSpaceId: "space_aaaaaaaaaaaaaaaaaaaaaa",
        createdAt: issuedAt,
        expiresAt,
        lastSeenAt: issuedAt,
        revokedAt: null,
        revocationReasonCode: null,
      },
      activeSpace: {
        id: "space_aaaaaaaaaaaaaaaaaaaaaa",
        kind: "personal",
        displayName: "Ada's space",
        role: "owner",
      },
      spaces: [
        {
          id: "space_aaaaaaaaaaaaaaaaaaaaaa",
          kind: "personal",
          displayName: "Ada's space",
          role: "owner",
        },
      ],
      csrfToken: "csrf-sensitive-canary",
    } as never);

    expect(identity.account.username).toBe("ada_dev");
    expect(JSON.stringify(identity)).not.toContain("csrf-sensitive-canary");
    expect(identity).not.toHaveProperty("csrfToken");
  });
});
