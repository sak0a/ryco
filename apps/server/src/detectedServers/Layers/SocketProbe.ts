/**
 * SocketProbe - Socket probing service contract.
 *
 * Defines the interface for probing LISTEN sockets owned by processes
 * without binding to a specific OS implementation.
 *
 * @module SocketProbe
 */
import { Effect, Context } from "effect";

/**
 * ProbeResult - A single socket probe result.
 */
export interface ProbeResult {
  pid: number;
  port: number;
  host: string;
}

/**
 * SocketProbeShape - Service API for probing LISTEN sockets.
 */
export interface SocketProbeShape {
  /**
   * Probe for LISTEN sockets owned by any of the given pids.
   * Returns rows of (pid, port, host) — empty when unavailable.
   */
  readonly probe: (pids: ReadonlyArray<number>) => Effect.Effect<ReadonlyArray<ProbeResult>>;
}

/**
 * SocketProbe - Service tag for socket probing integration.
 */
export class SocketProbe extends Context.Service<SocketProbe, SocketProbeShape>()(
  "s3/detectedServers/Layers/SocketProbe",
) {}
