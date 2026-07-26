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

const resumeFailure = () =>
  new AuthError({
    message: "Hub connector resume failed.",
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

/**
 * Report whether this node holds a Hub identity.
 *
 * Separate from status because `disabled` is reported both for a never-enrolled
 * node and for an enrolled node whose connector is off. The panel gates the
 * origin field and every destructive action on this, so conflating the two would
 * let it offer to re-point a node that is already enrolled.
 */
export const hubConnectorIdentityRouteLayer = HttpRouter.add(
  "GET",
  "/api/hub/identity",
  Effect.gen(function* () {
    yield* authenticateOwner;
    const connector = yield* HubConnectorService;
    const summary = yield* Effect.promise(() => connector.identitySummary());
    return HttpServerResponse.jsonUnsafe(summary, { status: 200 });
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

/**
 * Re-read a pending enrollment ceremony.
 *
 * The device code, fingerprint, and expiry are otherwise only in the enrollment
 * start response, so losing that output — a scrolled terminal, a closed panel, a
 * restart — strands a live ceremony with no way to finish it and no way back in
 * except cancelling, which destroys key custody.
 *
 * 404 means nothing is pending, or a ceremony predates device-code persistence
 * and therefore cannot be displayed.
 */
export const hubConnectorEnrollmentReadRouteLayer = HttpRouter.add(
  "GET",
  "/api/hub/enrollment",
  Effect.gen(function* () {
    yield* authenticateOwner;
    const connector = yield* HubConnectorService;
    const enrollment = yield* Effect.tryPromise({
      try: () => connector.readEnrollment(),
      catch: enrollmentFailure,
    });
    if (enrollment === null) {
      return HttpServerResponse.jsonUnsafe(
        { message: "No Hub enrollment is pending." },
        { status: 404 },
      );
    }
    return HttpServerResponse.jsonUnsafe(enrollment, { status: 200 });
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

/**
 * Retry a connector that stopped without scheduling its own retry.
 *
 * `connection_replaced` and a locked credential store both classify as
 * operator-action failures, so no reconnect timer exists for them. Without this
 * route the only recovery is restarting the process, which in the desktop tears
 * down every provider session and terminal to retry one outbound socket.
 *
 * `resume()` is deliberately a no-op for `revoked`, a stopping connector, and a
 * disabled one. Returning the resulting status rather than an error keeps those
 * cases honest: the caller sees the unchanged state instead of a success that
 * implies something happened.
 */
export const hubConnectorResumeRouteLayer = HttpRouter.add(
  "POST",
  "/api/hub/resume",
  Effect.gen(function* () {
    yield* authenticateOwner;
    const connector = yield* HubConnectorService;
    yield* Effect.tryPromise({
      try: () => connector.resume(),
      catch: resumeFailure,
    });
    return HttpServerResponse.jsonUnsafe(connector.status(), { status: 200 });
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
  hubConnectorResumeRouteLayer,
  hubConnectorEnrollmentReadRouteLayer,
  hubConnectorIdentityRouteLayer,
);
