import type { WebBrowserAuthSessionResult } from "expo-web-browser";

import type { MobileHostedConfig } from "../../platform/config";

/**
 * The hosted fallback browser session.
 *
 * Every credential flow the native app cannot perform — password sign-in, email
 * verification and recovery, TOTP enrollment and verification, recovery-code
 * redemption, owner bootstrap, and invitation registration — is
 * browser-transport-only on the Hub: it requires a browser `Origin` that is in
 * the Hub's WebAuthn origin list, a matching `Host`, and `Sec-Fetch-Site` either
 * absent or `same-origin`. A native socket cannot satisfy those conditions, so
 * the app opens the Hub's own hosted web app and lets it drive the flow. The
 * app implements none of it.
 *
 * The point of the flow is always the same: get the user to a device passkey.
 * When the browser returns — by redirect *or* by dismissal — the next step is a
 * native passkey sign-in that mints the app's own DPoP-bound session. The app
 * never adopts the browser's session, so the sign-in is not optional and is not
 * left to the caller to remember: it is an input to this function and runs on
 * every return path.
 *
 * ## Why a system auth session rather than an in-app WebView
 *
 * `openAuthSessionAsync` is `ASWebAuthenticationSession` on iOS and a Chrome
 * Custom Tab on Android. Both run outside the app: their cookie stores are not
 * readable by this process, and on iOS `preferEphemeralSession` additionally
 * discards the store when the session ends. That is the strongest transport
 * separation available, and Safari-backed WebAuthn is far more reliable than
 * WebAuthn inside a WKWebView.
 *
 * On Android that separation is load-bearing rather than merely tidy. React
 * Native's HTTP stack (OkHttp) and its WebSocket share a jar backed by the
 * app-global `android.webkit.CookieManager`, which is the very store an in-app
 * WebView writes to. A Hub-origin cookie left behind there would be attached to
 * later native requests *and* to the relay WebSocket upgrade — which rejects any
 * `Cookie` header with a hard 403, taking the whole hosted data path down. A
 * Custom Tab lives in the browser app's own process and jar, so nothing it
 * stores can reach that upgrade. This module therefore ships no in-app WebView
 * path at all; any future one would have to purge Hub-origin cookies from the
 * app-global store before the next native hosted request.
 *
 * ## What this module deliberately cannot do
 *
 * It has no access to the bearer token, the DPoP signer, the secret store, or
 * any cookie API, and it imports none of them. Nothing from the browser result
 * is read except the result *type* — a redirect URL is attacker-influencable
 * input, and there is no value the app would be willing to take from it.
 */

/**
 * Deep-link path the hosted web app may redirect to when it finishes, resolved
 * against the build's own scheme (`ryco://hosted/complete` in production).
 *
 * The redirect is an optimization, not a requirement: the Hub needs no change
 * for this handoff, because a user who simply closes the sheet lands on the
 * identical dismissal path.
 */
export const HOSTED_FALLBACK_REDIRECT_PATH = "hosted/complete";

/**
 * The hosted configuration this module needs. It is the platform reader's own
 * shape (`readMobileHostedConfig`), imported as a type so that this module — and
 * its tests — never pull `expo-constants` in at import time.
 */
export type HostedFallbackConfig = MobileHostedConfig;

/** Why a fallback session did not run. Bounded, secret-free, renderable. */
export type HostedFallbackBlockedReason =
  /** This build has no hosted plane, or its Hub origin is not usable. */
  | "hosted-mode-unavailable"
  /** Hosted mode is configured, but no hosted web app URL was supplied. */
  | "fallback-url-unconfigured"
  /** A hosted web app URL was supplied and failed validation. */
  | "fallback-url-rejected"
  /** The platform could not run a browser session (busy, or it threw). */
  | "browser-unavailable";

export type HostedFallbackUrlResolution =
  | { readonly status: "ok"; readonly url: string }
  | { readonly status: "blocked"; readonly reason: HostedFallbackBlockedReason };

/** How the browser handed control back. Both lead to the same next step. */
export type HostedFallbackReturn = "redirect" | "dismissed";

export type HostedFallbackResult =
  | {
      readonly status: "native-sign-in-attempted";
      readonly returnedVia: HostedFallbackReturn;
    }
  | { readonly status: "not-started"; readonly reason: HostedFallbackBlockedReason };

export type OpenHostedFallbackBrowser = (
  url: string,
  redirectUrl: string | null,
) => Promise<WebBrowserAuthSessionResult>;

export interface HostedFallbackSessionInput {
  /**
   * The native passkey sign-in to run once the browser returns — in practice
   * `() => hostedHubController.signIn()`.
   *
   * It is an input rather than something the caller does afterwards so that no
   * return path can silently skip it: a fallback flow that is not followed by a
   * native passkey login leaves the app with no session at all, and the app must
   * never treat the browser's session as its own.
   */
  readonly completeWithNativeSignIn: () => void | Promise<void>;
  /**
   * The hosted configuration. Omit it to read the build's configuration lazily;
   * pass `null` to assert that hosted mode is off.
   */
  readonly config?: HostedFallbackConfig | null;
  /** Seam for tests. Defaults to the ephemeral system auth session. */
  readonly openBrowser?: OpenHostedFallbackBrowser;
  /** Seam for tests. Defaults to this build's own deep link. */
  readonly resolveRedirectUrl?: () => string | null | Promise<string | null>;
}

function trimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return next ? next : null;
}

/**
 * Parse a value that must be an https origin and nothing else — no path, query,
 * fragment, or embedded credential. Everything else fails closed to `null`.
 */
function parseHttpsOrigin(value: unknown): URL | null {
  const raw = trimmed(value);
  if (raw === null) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // https only, on both platforms and every variant: a fallback flow performs
  // WebAuthn ceremonies, which require a secure context, and an http origin can
  // never appear in the Hub's WebAuthn origin list.
  if (url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.search !== "" || url.hash !== "") return null;
  if (url.pathname !== "" && url.pathname !== "/") return null;
  if (url.hostname === "") return null;
  return url;
}

/**
 * The hosted web app URL. Same rules as an origin except that a path is kept:
 * the Hub's web app need not sit at the root, and `platform/config.ts` already
 * admits a path when it validates `appUrl`. Query and fragment stay forbidden —
 * the app must never carry state into the fallback flow via the URL.
 */
function parseHttpsAppUrl(value: unknown): URL | null {
  const raw = trimmed(value);
  if (raw === null) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.search !== "" || url.hash !== "") return null;
  if (url.hostname === "") return null;
  return url;
}

/** Normalize a relying-party id (a bare host) for comparison, or reject it. */
function normalizeRelyingPartyHost(value: unknown): string | null {
  const raw = trimmed(value);
  if (raw === null) return null;
  const host = raw.toLowerCase().replace(/\.$/, "");
  // An RP id is a registrable domain: no scheme, port, path, or whitespace.
  return /^[a-z0-9.-]+$/.test(host) && host.includes(".") ? host : null;
}

/**
 * Derive the one URL a fallback session may open.
 *
 * The URL comes from configuration alone. There is no parameter, deep link, QR
 * payload, user input, or server-supplied redirect that can influence it, and no
 * token, proof, ticket, or other credential is ever appended to it — this module
 * holds none. The result is an origin with a bare `/` path, so nothing about the
 * app's state can be smuggled into the path, the query, or the fragment.
 */
export function resolveHostedFallbackUrl(
  config: HostedFallbackConfig | null | undefined,
): HostedFallbackUrlResolution {
  if (!config) return { status: "blocked", reason: "hosted-mode-unavailable" };

  const hub = parseHttpsOrigin(config.hubOrigin);
  if (hub === null) return { status: "blocked", reason: "hosted-mode-unavailable" };

  if (trimmed(config.appUrl) === null) {
    return { status: "blocked", reason: "fallback-url-unconfigured" };
  }

  const appUrl = parseHttpsAppUrl(config.appUrl);
  if (appUrl === null) return { status: "blocked", reason: "fallback-url-rejected" };

  // The hosted web app must live on the Hub itself or on the relying-party host
  // the build is associated with. Anything else is a different origin, cannot
  // satisfy the Hub's browser-transport checks, and must never be opened by us.
  // Both comparisons use `host` rather than `hostname`, so a URL on the right
  // host at a different port — a different origin — is not accepted.
  const relyingParty = normalizeRelyingPartyHost(config.relyingParty);
  const matchesHub = appUrl.host === hub.host;
  const matchesRelyingParty = relyingParty !== null && appUrl.host === relyingParty;
  if (!matchesHub && !matchesRelyingParty) {
    return { status: "blocked", reason: "fallback-url-rejected" };
  }

  // Rebuilt from parsed parts, never echoed from input: origin + path only, so
  // no query, fragment, or credential can survive into the opened URL.
  return { status: "ok", url: `${appUrl.origin}${appUrl.pathname}` };
}

/**
 * A redirect back into the app must use the app's own scheme. An `http(s)`
 * redirect would hand the handoff to a web origin (and, on iOS, require the
 * associated-domains path), so it is refused; the session then simply resolves
 * on dismissal instead.
 */
function sanitizeRedirectUrl(value: unknown): string | null {
  const raw = trimmed(value);
  if (raw === null) return null;
  if (/\s/.test(raw)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return null;
  if (/^https?:/i.test(raw)) return null;
  return raw;
}

async function readConfiguredHostedConfig(): Promise<HostedFallbackConfig | null> {
  try {
    // Lazy: the platform config module reads `expo-constants` at import time,
    // which pulls the native bridge into every consumer of this module.
    const { readMobileHostedConfig } = await import("../../platform/config");
    return readMobileHostedConfig();
  } catch {
    return null;
  }
}

async function defaultRedirectUrl(): Promise<string | null> {
  // Lazy for the same reason, and tolerant: a build without a resolvable scheme
  // still gets a working dismissal path.
  const linking = await import("expo-linking");
  return linking.createURL(HOSTED_FALLBACK_REDIRECT_PATH);
}

const openEphemeralAuthSession: OpenHostedFallbackBrowser = async (url, redirectUrl) => {
  // Lazy import: `expo-web-browser` reaches into `expo-modules-core` at module
  // scope, and this module is imported by screens that never open a browser.
  const webBrowser = await import("expo-web-browser");
  return await webBrowser.openAuthSessionAsync(url, redirectUrl, {
    // iOS only, and honored at the browser's discretion: run
    // `ASWebAuthenticationSession` against a private data store that is
    // discarded when the session ends. Android ignores the flag — there the
    // separation comes from the Custom Tab running in the browser app's own
    // process and jar (see this module's header).
    preferEphemeralSession: true,
  });
};

function classifyBrowserResult(result: WebBrowserAuthSessionResult): HostedFallbackReturn | null {
  // Widened deliberately: the SDK types this as a string enum plus `"success"`,
  // and a future SDK may add members this build has never heard of.
  const type: string = result.type;
  if (type === "success") return "redirect";
  // `locked`: another auth session is already in flight, so this one never ran.
  if (type === "locked") return null;
  // `cancel`, `dismiss`, and anything unrecognized: the user came back without a
  // redirect, which is the ordinary path and needs no Hub-side support.
  return "dismissed";
}

async function resolveRedirectUrlSafely(input: HostedFallbackSessionInput): Promise<string | null> {
  const resolve = input.resolveRedirectUrl ?? defaultRedirectUrl;
  try {
    return sanitizeRedirectUrl(await resolve());
  } catch {
    return null;
  }
}

/**
 * Open the hosted fallback flow, then hand control back to native passkey login.
 *
 * Resolves once the browser has returned and the native sign-in has been
 * attempted, or immediately with `not-started` when no session could be opened.
 * The sign-in's own outcome is not reported here: `hostedHubController.signIn()`
 * records success and failure in the hosted store, which is where the surfaces
 * already read it from.
 */
export async function openHostedFallbackSession(
  input: HostedFallbackSessionInput,
): Promise<HostedFallbackResult> {
  const config = input.config === undefined ? await readConfiguredHostedConfig() : input.config;
  const resolution = resolveHostedFallbackUrl(config);
  if (resolution.status === "blocked") {
    return { status: "not-started", reason: resolution.reason };
  }

  const redirectUrl = await resolveRedirectUrlSafely(input);
  const openBrowser = input.openBrowser ?? openEphemeralAuthSession;

  let result: WebBrowserAuthSessionResult;
  try {
    result = await openBrowser(resolution.url, redirectUrl);
  } catch {
    // Bounded on purpose: the platform's error text can echo the URL and its own
    // internal state, and nothing in it is actionable beyond "no session ran".
    return { status: "not-started", reason: "browser-unavailable" };
  }

  const returnedVia = classifyBrowserResult(result);
  if (returnedVia === null) {
    return { status: "not-started", reason: "browser-unavailable" };
  }

  // Nothing from `result` beyond its type is read, stored, or returned. Whatever
  // the fallback flow achieved in the browser, the only thing that can mint a
  // native session is a passkey login carrying a DPoP proof — so both the
  // redirect path and the dismissal path continue identically here.
  await input.completeWithNativeSignIn();
  return { status: "native-sign-in-attempted", returnedVia };
}
