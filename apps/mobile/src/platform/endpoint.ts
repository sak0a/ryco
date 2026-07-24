import type {
  ClientRuntimeConfigService,
  EndpointService,
  PrimaryEnvironmentTarget,
} from "@ryco/client-runtime/platform";

const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

function swapWsToHttp(wsBaseUrl: string): string {
  const url = new URL(wsBaseUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return url.toString();
}

function swapHttpToWs(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/**
 * The mobile endpoint has no `window.location`; the primary origin is the
 * configured default node (if any). Pairing supplies saved-environment targets
 * dynamically, so with no configured default `readPrimaryTarget` returns null
 * and all traffic flows through saved environments.
 */
export function createMobileEndpoint(config: ClientRuntimeConfigService): EndpointService {
  const originOf = (): string | null => {
    if (config.httpBaseUrl) return new URL(config.httpBaseUrl).origin;
    if (config.wsBaseUrl) return new URL(swapWsToHttp(config.wsBaseUrl)).origin;
    return null;
  };

  return {
    origin: () => originOf() ?? "",
    readPrimaryTarget: (): PrimaryEnvironmentTarget | null => {
      const { httpBaseUrl, wsBaseUrl } = config;
      if (!httpBaseUrl && !wsBaseUrl) return null;
      const resolvedHttp = httpBaseUrl ?? swapWsToHttp(wsBaseUrl!);
      const resolvedWs = wsBaseUrl ?? swapHttpToWs(httpBaseUrl!);
      return {
        source: "configured",
        target: { httpBaseUrl: resolvedHttp, wsBaseUrl: resolvedWs },
      };
    },
    resolveHttpUrl: (pathname, searchParams) => {
      const origin = originOf();
      const base = ABSOLUTE_URL_PATTERN.test(pathname)
        ? new URL(pathname)
        : origin
          ? new URL(pathname, origin)
          : null;
      if (base === null) return pathname;
      if (searchParams) {
        for (const [key, value] of Object.entries(searchParams)) {
          base.searchParams.set(key, value);
        }
      }
      return base.toString();
    },
    resolveWsUrl: (wsBaseUrl) => {
      if (ABSOLUTE_URL_PATTERN.test(wsBaseUrl)) return wsBaseUrl;
      // A relative ws path resolves against the configured ws origin (derived by
      // swapping the http origin's scheme), not the http origin, so the result
      // keeps the ws/wss scheme.
      const wsOrigin = config.wsBaseUrl
        ? new URL(config.wsBaseUrl).origin
        : config.httpBaseUrl
          ? new URL(swapHttpToWs(config.httpBaseUrl)).origin
          : null;
      return wsOrigin ? new URL(wsBaseUrl, wsOrigin).toString() : wsBaseUrl;
    },
  };
}
