import { Context } from "effect";
import type { Effect } from "effect";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

import { AuthError } from "./ServerAuth.ts";

export interface AuthenticatedBrowserHost {
  readonly role: "desktop-browser-host";
}

export interface BrowserHostAuthShape {
  readonly authenticateWebSocketUpgrade: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<AuthenticatedBrowserHost, AuthError>;
}

export class BrowserHostAuth extends Context.Service<BrowserHostAuth, BrowserHostAuthShape>()(
  "ryco/auth/Services/BrowserHostAuth",
) {}
