import type { EndpointService } from "@ryco/client-runtime/platform";

import {
  readPrimaryEnvironmentTarget,
  resolvePrimaryEnvironmentHttpUrl,
} from "../environments/primary/target";

export const webEndpoint: EndpointService = {
  origin: () => window.location.origin,
  readPrimaryTarget: () => readPrimaryEnvironmentTarget()?.target ?? null,
  resolveHttpUrl: (pathname, searchParams) =>
    searchParams
      ? resolvePrimaryEnvironmentHttpUrl(pathname, { ...searchParams })
      : resolvePrimaryEnvironmentHttpUrl(pathname),
  resolveWsUrl: (wsBaseUrl) => new URL(wsBaseUrl, window.location.origin).toString(),
};
