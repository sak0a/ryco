/**
 * LivenessHeartbeat - HTTP liveness probe service.
 *
 * Performs HEAD requests with a 500ms timeout to check if a server is up.
 * Any HTTP response (2xx/3xx/4xx/5xx) counts as success.
 *
 * @module LivenessHeartbeat
 */
import { Effect, Context, Layer, Schema } from "effect";

class HeartbeatError extends Schema.TaggedErrorClass<HeartbeatError>(
  "s3/detectedServers/HeartbeatError",
)("HeartbeatError", { url: Schema.String }) {}

/**
 * LivenessHeartbeatShape - Service API for HTTP liveness checks.
 */
export interface LivenessHeartbeatShape {
  /**
   * Single liveness check. Returns true if any HTTP response was received
   * (any 2xx/3xx/4xx/5xx counts as "the server is up").
   */
  readonly check: (url: string) => Effect.Effect<boolean>;
}

/**
 * LivenessHeartbeat - Service tag for HTTP liveness probe integration.
 */
export class LivenessHeartbeat extends Context.Service<LivenessHeartbeat, LivenessHeartbeatShape>()(
  "s3/detectedServers/Layers/LivenessHeartbeat",
) {}

const checkImpl = (url: string): Effect.Effect<boolean> =>
  Effect.tryPromise({
    try: () => fetch(url, { method: "HEAD", signal: AbortSignal.timeout(500) }),
    catch: () => new HeartbeatError({ url }),
  }).pipe(
    Effect.map(() => true),
    Effect.orElseSucceed(() => false),
  );

/**
 * LivenessHeartbeatLive - Layer providing the default implementation.
 */
export const LivenessHeartbeatLive: Layer.Layer<LivenessHeartbeat> = Layer.succeed(
  LivenessHeartbeat,
  { check: checkImpl },
);
