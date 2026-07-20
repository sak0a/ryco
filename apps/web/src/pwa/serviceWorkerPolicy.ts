export type ServiceWorkerRequestPolicy = "navigation" | "network-only" | "precache";

export interface ServiceWorkerRequestLike {
  readonly headers: Readonly<Record<string, string>>;
  readonly method: string;
  readonly mode: string;
  readonly url: string;
}

const NETWORK_ONLY_PATH_PREFIXES = ["/.well-known", "/api", "/attachments", "/v1/relay"];

function readHeader(headers: Readonly<Record<string, string>>, name: string): string | null {
  const expected = name.toLowerCase();
  for (const [headerName, value] of Object.entries(headers)) {
    if (headerName.toLowerCase() === expected) return value;
  }
  return null;
}

function hasNetworkOnlyPath(pathname: string): boolean {
  return NETWORK_ONLY_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
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
