import type { SecretKVService, SessionCredentialsService } from "@ryco/client-runtime/platform";

import { mobileSecretKV } from "./secretKv";

/**
 * A native client cannot use the browser cookie session, so the hosted plane's
 * session mode is "bearer": requests present `Authorization: DPoP <token>` plus
 * a proof, and never a cookie.
 *
 * `HostedHubApi` fails closed at construction when a bearer adapter lacks a
 * DPoP signer or a bearer-token holder, and `configureHostedRuntime` builds the
 * API eagerly — so an adapter missing these accessors throws at app bootstrap
 * rather than at first request. Both accessors below are therefore mandatory,
 * not optional conveniences.
 *
 * The accessors are synchronous while SecretKV is async, so the token is held
 * in an in-memory cache and mirrored to SecretKV for durability across
 * restarts. The token is never logged, never returned from anything that feeds
 * a view model, and never included in an error message.
 */

/** `sanitizeSecretKey` escapes the dots, so this stays readable at the call site. */
export const HOSTED_SESSION_TOKEN_KEY = "ryco.hostedHub.sessionToken";

export interface MobileSessionCredentials extends SessionCredentialsService {
  /** Read the persisted token into the synchronous cache exactly once. */
  readonly hydrate: () => Promise<void>;
}

export function createMobileSessionCredentials(
  secretKV: SecretKVService = mobileSecretKV,
): MobileSessionCredentials {
  let csrfToken: string | null = null;
  let bearerToken: string | null = null;
  let hydration: Promise<void> | undefined;

  return {
    mode: "bearer",
    // Retained because the contract requires them; unused in bearer mode, where
    // requests are sent with `credentials: "omit"` and no CSRF header.
    readCsrfToken: () => csrfToken,
    writeCsrfToken: (token) => {
      csrfToken = token;
    },
    readBearerToken: () => bearerToken,
    writeBearerToken: (token) => {
      bearerToken = token;
      // Mirror durably. Failures are swallowed: losing persistence costs the
      // user a re-login, but must not surface the token in an error path.
      void (
        token === null
          ? secretKV.remove(HOSTED_SESSION_TOKEN_KEY)
          : secretKV.set(HOSTED_SESSION_TOKEN_KEY, token)
      ).catch(() => undefined);
    },
    hydrate: () => {
      hydration ??= (async () => {
        try {
          const stored = await secretKV.get(HOSTED_SESSION_TOKEN_KEY);
          // A token written while hydration was in flight wins: it is newer.
          if (bearerToken === null && stored !== null && stored.length > 0) {
            bearerToken = stored;
          }
        } catch {
          // Treat an unreadable store as "no session"; the user re-authenticates.
        }
      })();
      return hydration;
    },
  };
}

export const mobileSessionCredentials = createMobileSessionCredentials();

/** Read the persisted hosted session token into the synchronous holder. */
export function hydrateMobileHostedSessionToken(): Promise<void> {
  return mobileSessionCredentials.hydrate();
}
