import { Effect, Layer } from "effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

import { ServerConfig } from "../../config.ts";
import { isLoopbackHost } from "../../startupAccess.ts";
import { BrowserHostAuth, type BrowserHostAuthShape } from "../Services/BrowserHostAuth.ts";
import { AuthError } from "../Services/ServerAuth.ts";

const AUTHORIZATION_PREFIX = "Bearer ";

function parseBearerToken(request: HttpServerRequest.HttpServerRequest): string | null {
  const header = request.headers["authorization"];
  if (typeof header !== "string" || !header.startsWith(AUTHORIZATION_PREFIX)) {
    return null;
  }
  const token = header.slice(AUTHORIZATION_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

function hostnameFromHostHeader(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch {
    return value.split(":")[0]?.toLowerCase() ?? null;
  }
}

export const BrowserHostAuthLive = Layer.effect(
  BrowserHostAuth,
  Effect.gen(function* () {
    const config = yield* ServerConfig;

    const authenticateWebSocketUpgrade: BrowserHostAuthShape["authenticateWebSocketUpgrade"] = (
      request,
    ) =>
      Effect.gen(function* () {
        if (config.mode !== "desktop") {
          return yield* new AuthError({
            message: "BrowserHost route is only available for desktop runtime.",
            status: 403,
          });
        }

        const requestHost = hostnameFromHostHeader(request.headers.host);
        if (!isLoopbackHost(requestHost ?? undefined)) {
          return yield* new AuthError({
            message: "BrowserHost route requires loopback desktop access.",
            status: 403,
          });
        }

        const expectedToken = config.desktopBrowserHostToken;
        if (!expectedToken) {
          return yield* new AuthError({
            message: "BrowserHost token is not configured.",
            status: 403,
          });
        }

        const token = parseBearerToken(request);
        if (token !== expectedToken) {
          return yield* new AuthError({
            message: "Invalid BrowserHost token.",
            status: 401,
          });
        }

        return { role: "desktop-browser-host" as const };
      });

    return { authenticateWebSocketUpgrade } satisfies BrowserHostAuthShape;
  }),
);
