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
