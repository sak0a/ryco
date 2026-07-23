import type { HttpClientService } from "@ryco/client-runtime/platform";

export const webHttpClient: HttpClientService = {
  fetch: (url, init) => (init === undefined ? globalThis.fetch(url) : globalThis.fetch(url, init)),
};
