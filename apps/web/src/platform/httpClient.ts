import type { HttpClientService } from "@ryco/client-runtime/platform";

// Pass the request init through unchanged (the neutral HttpRequestInit carries
// plain-object headers); the cast only bridges the DOM `fetch` overload, which
// accepts the same plain header records at runtime.
export const webHttpClient: HttpClientService = {
  fetch: (url, init) =>
    init === undefined ? globalThis.fetch(url) : globalThis.fetch(url, init as RequestInit),
};
