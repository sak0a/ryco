import type { ClientRuntimeConfigService } from "@ryco/client-runtime/platform";
import Constants from "expo-constants";

interface MobileExtraConfig {
  readonly appVariant?: string | null;
  readonly node?: {
    readonly httpBaseUrl?: string | null;
    readonly wsBaseUrl?: string | null;
  };
  readonly hosted?: {
    readonly hubBaseUrl?: string | null;
    readonly appUrl?: string | null;
    readonly relyingParty?: string | null;
  };
}

/** The validated hosted-plane configuration, or nothing at all. */
export interface MobileHostedConfig {
  /** The Hub public origin every bearer request URL and DPoP `htu` is built from. */
  readonly hubOrigin: string;
  /** The hosted web app the fallback browser session opens, when configured. */
  readonly appUrl: string | null;
  /** The passkey relying party (associated-domains host). */
  readonly relyingParty: string;
}

function readExtra(): MobileExtraConfig {
  return (Constants.expoConfig?.extra as MobileExtraConfig | undefined) ?? {};
}

// `Constants.expoConfig.extra` is untrusted runtime data — its TS type is only a
// build-time hint, so a value typed `string` can arrive as a non-string (or a
// null that a bleeding-edge Hermes mishandles under `?.`). Guard on the runtime
// type instead of trusting the annotation, and never call a method off it.
function trimmed(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const next = value.trim();
  return next ? next : undefined;
}

function readHostedExtra(extra: MobileExtraConfig): MobileExtraConfig["hosted"] {
  const hosted: unknown = extra.hosted;
  if (typeof hosted !== "object" || hosted === null) return undefined;
  return hosted as MobileExtraConfig["hosted"];
}

// `http:` is tolerated only for a development build pointed at a local Hub;
// every other variant (and an unrecognized/absent variant) requires `https:`.
function allowsInsecureHostedOrigin(extra: MobileExtraConfig): boolean {
  return trimmed(extra.appVariant) === "development";
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function hasCredentials(url: URL): boolean {
  return url.username !== "" || url.password !== "";
}

function hasAllowedProtocol(url: URL, allowInsecure: boolean): boolean {
  return url.protocol === "https:" || (allowInsecure && url.protocol === "http:");
}

/**
 * The Hub origin must be an origin and nothing more: the runtime appends every
 * API pathname itself and signs that exact origin into each DPoP proof, so a
 * path, query, fragment, or embedded credential would silently desynchronize the
 * client's `htu` from the server-derived one.
 */
function parseHostedOrigin(value: unknown, allowInsecure: boolean): string | null {
  const raw = trimmed(value);
  if (raw === undefined) return null;
  const url = parseUrl(raw);
  if (!url) return null;
  if (!hasAllowedProtocol(url, allowInsecure)) return null;
  if (hasCredentials(url)) return null;
  if (url.search !== "" || url.hash !== "") return null;
  if (url.pathname !== "" && url.pathname !== "/") return null;
  return url.origin;
}

/**
 * The hosted web app URL may carry a path (the app need not sit at the root) but
 * never a query, fragment, or credential — a fallback browser session must be
 * opened at a URL derived from config alone.
 */
function parseHostedAppUrl(value: unknown, allowInsecure: boolean): string | null {
  const raw = trimmed(value);
  if (raw === undefined) return null;
  const url = parseUrl(raw);
  if (!url) return null;
  if (!hasAllowedProtocol(url, allowInsecure)) return null;
  if (hasCredentials(url)) return null;
  if (url.search !== "" || url.hash !== "") return null;
  return url.toString();
}

/**
 * Reads the hosted-plane configuration, or `null` when this build has none.
 *
 * Fail closed: anything unparseable, insecure, or origin-impure yields `null`
 * (hosted mode simply stays off) rather than throwing at read time, so a
 * malformed `extra` can never take the direct-node plane down with it.
 */
export function readMobileHostedConfig(): MobileHostedConfig | null {
  const extra = readExtra();
  const hosted = readHostedExtra(extra);
  if (!hosted) return null;
  const allowInsecure = allowsInsecureHostedOrigin(extra);
  const hubOrigin = parseHostedOrigin(hosted.hubBaseUrl, allowInsecure);
  if (hubOrigin === null) return null;
  const relyingParty = trimmed(hosted.relyingParty);
  if (relyingParty === undefined) return null;
  return {
    hubOrigin,
    appUrl: parseHostedAppUrl(hosted.appUrl, allowInsecure),
    relyingParty,
  };
}

/**
 * The RN analogue of the web `readWebClientRuntimeConfig`: replaces ambient
 * `import.meta.env` reads with the app config's `extra`. The client mode is
 * derived from the *validated* hosted config, so an absent or rejected hosted
 * block leaves the app in direct-node ("standard") mode. `httpBaseUrl` /
 * `wsBaseUrl` keep meaning the optional default *node* origin for local testing
 * before pairing — the hosted Hub origin never overwrites them, because the two
 * planes address different servers.
 */
export function readMobileClientRuntimeConfig(): ClientRuntimeConfigService {
  const extra = readExtra();
  const httpBaseUrl = trimmed(extra.node?.httpBaseUrl);
  const wsBaseUrl = trimmed(extra.node?.wsBaseUrl);
  const hosted = readMobileHostedConfig();
  const hostedAppUrl = hosted?.appUrl ?? undefined;
  return {
    clientMode: hosted ? "hosted-hub" : "standard",
    ...(httpBaseUrl === undefined ? {} : { httpBaseUrl }),
    ...(wsBaseUrl === undefined ? {} : { wsBaseUrl }),
    ...(hostedAppUrl === undefined ? {} : { hostedAppUrl }),
  };
}
