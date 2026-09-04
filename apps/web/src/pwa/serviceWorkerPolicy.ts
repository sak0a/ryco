import {
  ACCOUNT_E2EE_DEVICES_PATH,
  ACCOUNT_E2EE_DEVICE_PATH_PREFIX,
  NATIVE_ACCOUNT_GRANT_RELAY_TICKET_PATH,
  NATIVE_E2EE_CURRENT_DEVICE_PATH,
  NATIVE_E2EE_GRANT_KEYS_PATH,
} from "@ryco/contracts/native-e2ee";

export type ServiceWorkerRequestPolicy = "navigation" | "network-only" | "precache";

export interface ServiceWorkerRequestLike {
  readonly headers: Readonly<Record<string, string>>;
  readonly method: string;
  readonly mode: string;
  readonly url: string;
}

const NETWORK_ONLY_PATH_PREFIXES = ["/.well-known", "/api", "/attachments", "/v1/relay"];

/**
 * Security-sensitive native E2EE routes called out independently of the `/api`
 * catch-all. Keeping this list executable makes a future API namespace move
 * fail a focused test instead of silently making credentials cache-eligible.
 */
export const HOSTED_E2EE_NETWORK_ONLY_PATHS = [
  NATIVE_E2EE_CURRENT_DEVICE_PATH,
  NATIVE_E2EE_GRANT_KEYS_PATH,
  NATIVE_ACCOUNT_GRANT_RELAY_TICKET_PATH,
  ACCOUNT_E2EE_DEVICES_PATH,
] as const;

function readHeader(headers: Readonly<Record<string, string>>, name: string): string | null {
  const expected = name.toLowerCase();
  for (const [headerName, value] of Object.entries(headers)) {
    if (headerName.toLowerCase() === expected) return value;
  }
  return null;
}

function hasNetworkOnlyPath(pathname: string): boolean {
  return (
    HOSTED_E2EE_NETWORK_ONLY_PATHS.includes(
      pathname as (typeof HOSTED_E2EE_NETWORK_ONLY_PATHS)[number],
    ) ||
    pathname.startsWith(`${ACCOUNT_E2EE_DEVICE_PATH_PREFIX}/`) ||
    NETWORK_ONLY_PATH_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  );
}

export function classifyServiceWorkerRequest(input: {
  readonly origin: string;
  readonly precacheUrls: ReadonlySet<string>;
  readonly request: ServiceWorkerRequestLike;
}): ServiceWorkerRequestPolicy {
  if (input.request.method.toUpperCase() !== "GET") return "network-only";

  let url: URL;
  try {
    url = new URL(input.request.url);
  } catch {
    return "network-only";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return "network-only";
  if (url.origin !== input.origin) return "network-only";
  if (readHeader(input.request.headers, "range") !== null) return "network-only";
  if (readHeader(input.request.headers, "accept")?.toLowerCase().includes("text/event-stream")) {
    return "network-only";
  }
  if (hasNetworkOnlyPath(url.pathname)) return "network-only";
  if (input.request.mode === "navigate") return "navigation";
  return input.precacheUrls.has(url.href) ? "precache" : "network-only";
}

export const HOSTED_PWA_NETWORK_ONLY_PATH_PREFIXES = NETWORK_ONLY_PATH_PREFIXES;
