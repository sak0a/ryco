import type * as HostedIdentity from "@ryco/contracts/hosted-identity";

import type {
  HostedPasswordLoginState,
  HostedPasswordResetState,
  HostedPublicSignupState,
  HostedPublishedIdentity,
} from "./types.ts";

/** Project a secret-bearing signup start result into safe presentation state. */
export function presentPublicSignupStart(
  result: HostedIdentity.PublicSignupStartResponse,
): HostedPublicSignupState {
  return {
    status: "check-email",
    attemptId: result.attemptId,
    resendAfterMs: result.resendAfterMs,
    expiresAt: result.expiresAt,
  };
}

/** Project verified mailbox state without retaining the activation secret. */
export function presentPublicSignupVerification(
  result: HostedIdentity.PublicSignupVerifyResponse,
): HostedPublicSignupState {
  return {
    status: "choose-credential",
    attemptId: result.attemptId,
    expiresAt: result.expiresAt,
  };
}

/** Strip CSRF material before identity metadata is published to shared state. */
export function presentBrowserIdentity(
  result: HostedIdentity.HubBrowserSessionResponse,
): HostedPublishedIdentity {
  return {
    account: result.account,
    session: result.session,
    activeSpace: result.activeSpace,
    spaces: result.spaces,
  };
}

/** Project password-login factor state without retaining its attempt secret. */
export function presentPasswordLoginFactor(
  result: HostedIdentity.PasswordLoginStartResponse,
): HostedPasswordLoginState {
  return {
    status: "factor-required",
    attemptId: result.attemptId,
    factor: result.factor,
    expiresAt: result.expiresAt,
  };
}

/** Project reset proof state without retaining its reset bearer. */
export function presentPasswordResetVerification(
  result: HostedIdentity.PasswordResetVerifyResponse,
): HostedPasswordResetState {
  return {
    status: "set-password",
    attemptId: result.attemptId,
    requiresTotp: result.requiresTotp,
    expiresAt: result.expiresAt,
  };
}
