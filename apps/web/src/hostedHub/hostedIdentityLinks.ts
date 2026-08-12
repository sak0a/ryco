const OPAQUE_256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SIGNUP_ATTEMPT_PATTERN = /^signup_[A-Za-z0-9_-]{22,43}$/u;

export type HostedIdentityLink =
  | {
      readonly kind: "signup-verification";
      readonly attemptId: string;
      readonly attemptSecret: string;
      readonly token: string;
    }
  | { readonly kind: "password-reset"; readonly token: string }
  | { readonly kind: "email-verification"; readonly token: string }
  | { readonly kind: "invalid-signup-verification" }
  | { readonly kind: "invalid-password-reset" }
  | { readonly kind: "invalid-email-verification" };

/** Parse only the secret-bearing public identity fragments. */
export function parseHostedIdentityLink(url: URL): HostedIdentityLink | null {
  if (url.pathname === "/public-signup/verify") {
    const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    const attemptId = fragment.get("attempt");
    const attemptSecret = fragment.get("attempt_secret");
    const token = fragment.get("token");
    return attemptId !== null &&
      SIGNUP_ATTEMPT_PATTERN.test(attemptId) &&
      attemptSecret !== null &&
      OPAQUE_256_PATTERN.test(attemptSecret) &&
      token !== null &&
      OPAQUE_256_PATTERN.test(token)
      ? { kind: "signup-verification", attemptId, attemptSecret, token }
      : { kind: "invalid-signup-verification" };
  }
  if (url.pathname === "/password-reset") {
    const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    const token = fragment.get("token");
    return token !== null && OPAQUE_256_PATTERN.test(token)
      ? { kind: "password-reset", token }
      : { kind: "invalid-password-reset" };
  }
  if (url.pathname === "/email-verification") {
    const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    const token = fragment.get("token");
    return token !== null && OPAQUE_256_PATTERN.test(token)
      ? { kind: "email-verification", token }
      : { kind: "invalid-email-verification" };
  }
  return null;
}

/**
 * Read the fragment once and synchronously remove it before any network call,
 * render-side telemetry, or error surface can observe the bearer material.
 */
export function consumeHostedIdentityLink(input: {
  readonly href: string;
  readonly historyState: unknown;
  readonly replaceState: (state: unknown, unused: string, url?: string | URL | null) => void;
}): HostedIdentityLink | null {
  const url = new URL(input.href);
  const parsed = parseHostedIdentityLink(url);
  if (parsed === null) return null;
  input.replaceState(input.historyState, "", `${url.pathname}${url.search}`);
  return parsed;
}
