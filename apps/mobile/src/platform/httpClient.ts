import type { HttpClientService, HttpRequestInit } from "@ryco/client-runtime/platform";

const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/**
 * React Native `fetch` does not resolve relative pathnames against a document
 * base URL the way the browser does, so the mobile adapter replicates that:
 * a relative path is resolved against the configured node/Hub origin before the
 * request is issued. Absolute URLs pass through unchanged.
 */
export function createMobileHttpClient(getOrigin: () => string | null): HttpClientService {
  return {
    fetch: (url, init) => {
      const resolved = ABSOLUTE_URL_PATTERN.test(url) ? url : resolveRelative(url, getOrigin());
      return init === undefined
        ? globalThis.fetch(resolved)
        : globalThis.fetch(resolved, init as RequestInit);
    },
  };
}

function resolveRelative(pathname: string, origin: string | null): string {
  if (!origin) {
    // No configured origin: the runtime is expected to hand absolute URLs via
    // the Endpoint adapter; fall back to the pathname unchanged rather than
    // fabricating an origin.
    return pathname;
  }
  return new URL(pathname, origin).toString();
}

export type { HttpRequestInit };
