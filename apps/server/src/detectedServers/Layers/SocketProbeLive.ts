/**
 * SocketProbeLive - OS-selecting Layer for SocketProbe.
 *
 * Separated from SocketProbe.ts to avoid circular imports: the OS adapter
 * files (SocketProbe.Linux.ts, etc.) import SocketProbe from SocketProbe.ts,
 * so SocketProbe.ts must not import them back.
 *
 * @module SocketProbeLive
 */
import { Effect, Layer } from "effect";
import { platform } from "node:os";
import { SocketProbe, type ProbeResult } from "./SocketProbe.ts";
import { SocketProbeLinuxLive } from "./SocketProbe.Linux.ts";
import { SocketProbeDarwinLive } from "./SocketProbe.Darwin.ts";
import { SocketProbeWindowsLive } from "./SocketProbe.Windows.ts";

const NoopProbeLive = Layer.succeed(SocketProbe, {
  probe: () => Effect.succeed([] as ReadonlyArray<ProbeResult>),
});

export const SocketProbeLive: Layer.Layer<SocketProbe> = (() => {
  switch (platform()) {
    case "linux":
      return SocketProbeLinuxLive;
    case "darwin":
      return SocketProbeDarwinLive;
    case "win32":
      return SocketProbeWindowsLive;
    default:
      return NoopProbeLive;
  }
})();
