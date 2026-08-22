import type {
  ExternalIdentityAuthorizationStartRequest,
  ExternalIdentityAuthorizationStartResponse,
  ExternalIdentityConfigResponse,
  ExternalIdentityPendingErrorCode,
  ExternalIdentityProviderPolicy,
} from "@ryco/contracts/hosted-identity";

export function githubProviderPolicy(
  configuration: ExternalIdentityConfigResponse | null,
): ExternalIdentityProviderPolicy | null {
  return configuration?.providers.find((provider) => provider.provider === "github") ?? null;
}

const PENDING_ERROR_COPY: Readonly<Record<ExternalIdentityPendingErrorCode, string>> = {
  external_provider_unavailable: "GitHub sign-in is temporarily unavailable. Try again later.",
  external_authorization_cancelled: "GitHub authorization was cancelled.",
  external_authorization_expired: "GitHub authorization expired. Start again.",
  external_authorization_rejected: "GitHub could not authorize this request. Try again.",
  external_identity_email_conflict:
    "An account already uses that verified email. Sign in another way, then connect GitHub from account settings.",
  external_identity_verified_email_required:
    "GitHub needs a verified primary email before it can create a Ryco account.",
  signup_disabled: "New account signup is closed. Linked GitHub accounts can still sign in.",
  username_unavailable: "That username is unavailable. Choose another one and try again.",
};

export function externalIdentityPendingErrorMessage(
  code: ExternalIdentityPendingErrorCode,
): string {
  return PENDING_ERROR_COPY[code];
}

export async function beginGitHubAuthorization(input: {
  readonly intent: ExternalIdentityAuthorizationStartRequest["intent"];
  readonly returnTo: string;
  readonly start: (
    request: ExternalIdentityAuthorizationStartRequest,
  ) => Promise<ExternalIdentityAuthorizationStartResponse>;
  readonly navigate: (authorizationUrl: string) => void;
}): Promise<void> {
  const started = await input.start({
    provider: "github",
    intent: input.intent,
    returnTo: input.returnTo,
  });
  input.navigate(started.authorizationUrl);
}
