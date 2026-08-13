import type * as HostedIdentity from "@ryco/contracts/hosted-identity";

/**
 * A verified email attempt no longer accepts its pre-verification attempt
 * secret. Cancellation must prove possession of the activation secret returned
 * by verification, even though the wire contract keeps the generic
 * `attemptSecret` field name for both attempt phases.
 */
export function verifiedEmailCancellation(
  response: HostedIdentity.NativeIdentityEmailVerifyResponse,
): HostedIdentity.NativeIdentityAttemptCancelRequest {
  return {
    attemptId: response.attemptId,
    attemptSecret: response.activationSecret,
  };
}

/**
 * Cleanup is useful but never authoritative for the verified-email outcome.
 * The Hub expires an attempt independently, so a failed cancellation must not
 * replace precise signup/login guidance with a generic request error.
 */
export async function cancelVerifiedEmailAttempt(
  api: {
    readonly cancelNativeIdentityAttempt: (
      request: HostedIdentity.NativeIdentityAttemptCancelRequest,
    ) => Promise<unknown>;
  },
  response: HostedIdentity.NativeIdentityEmailVerifyResponse,
): Promise<void> {
  try {
    await api.cancelNativeIdentityAttempt(verifiedEmailCancellation(response));
  } catch {
    // The bounded server attempt expires even when eager cleanup is unavailable.
  }
}
