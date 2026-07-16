import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { AuthError, ServerAuth } from "../auth/Services/ServerAuth.ts";
import { respondToAuthError } from "../auth/http.ts";
import { HubConnectorService } from "./HubConnectorLive.ts";

const authenticateOwner = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  const session = yield* serverAuth.authenticateHttpRequest(request);
  if (session.role !== "owner") {
    return yield* new AuthError({
      message: "Only owner sessions can manage Hub connectivity.",
      status: 403,
    });
  }
});

const enrollmentFailure = () =>
  new AuthError({
    message: "Hub enrollment operation failed.",
    status: 400,
  });

export const hubConnectorStatusRouteLayer = HttpRouter.add(
  "GET",
  "/api/hub/status",
  Effect.gen(function* () {
    yield* authenticateOwner;
    const connector = yield* HubConnectorService;
    return HttpServerResponse.jsonUnsafe(connector.status(), { status: 200 });
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const hubConnectorEnrollmentRouteLayer = HttpRouter.add(
  "POST",
  "/api/hub/enrollment",
  Effect.gen(function* () {
    yield* authenticateOwner;
    const connector = yield* HubConnectorService;
    const result = yield* Effect.tryPromise({
      try: () => connector.enroll(),
      catch: enrollmentFailure,
    });
    return HttpServerResponse.jsonUnsafe(result, { status: 201 });
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const hubConnectorEnrollmentCancelRouteLayer = HttpRouter.add(
  "POST",
  "/api/hub/enrollment/cancel",
  Effect.gen(function* () {
    yield* authenticateOwner;
    const connector = yield* HubConnectorService;
    const status = yield* Effect.tryPromise({
      try: () => connector.cancelEnrollment(),
      catch: enrollmentFailure,
    });
    return HttpServerResponse.jsonUnsafe(status, { status: 200 });
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const hubConnectorRoutesLayer = Layer.mergeAll(
  hubConnectorStatusRouteLayer,
  hubConnectorEnrollmentRouteLayer,
  hubConnectorEnrollmentCancelRouteLayer,
);
