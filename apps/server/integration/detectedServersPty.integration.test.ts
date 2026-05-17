import { describe, it, expect } from "vitest";
import { Effect, Layer, Duration } from "effect";
import { spawn } from "node:child_process";
import {
  DetectedServerRegistryLive,
  DetectedServerRegistry,
} from "../src/detectedServers/Services/DetectedServerRegistry.ts";
import { SocketProbeLive } from "../src/detectedServers/Layers/SocketProbeLive.ts";
import { LivenessHeartbeatLive } from "../src/detectedServers/Layers/LivenessHeartbeat.ts";
import {
  DetectedServersIngress,
  DetectedServersIngressLive,
} from "../src/detectedServers/Layers/DetectedServersIngress.ts";

describe("DetectedServers / PTY real server", () => {
  it.skipIf(process.platform === "win32")(
    "transitions predicted → candidate → confirmed → live for a real Node http server",
    async () => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          `const http = require("node:http"); const s = http.createServer((req, res) => res.end("ok")); s.listen(0, "127.0.0.1", () => { console.log("Server listening on port " + s.address().port); });`,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );

      try {
        const depsLayer = Layer.mergeAll(
          DetectedServerRegistryLive,
          SocketProbeLive,
          LivenessHeartbeatLive,
        );
        const testLayer = Layer.mergeAll(
          depsLayer,
          DetectedServersIngressLive.pipe(Layer.provide(depsLayer)),
        );

        await Effect.runPromise(
          Effect.gen(function* () {
            const ingress = yield* DetectedServersIngress;
            const registry = yield* DetectedServerRegistry;

            const tracker = yield* ingress.trackPty(
              {
                threadId: "thread-1",
                terminalId: "terminal-1",
                pid: child.pid!,
                argv: ["npm", "run", "dev"],
                cwd: "/tmp",
              },
              { scripts: { dev: "vite" } },
            );

            child.stdout!.on("data", (d: Buffer) => tracker.feed(d.toString("utf8")));

            // Poll for live with timeout (up to ~15 seconds)
            let server = null;
            for (let i = 0; i < 150; i += 1) {
              yield* Effect.sleep(Duration.millis(100));
              const current = yield* registry.getCurrent("thread-1");
              if (current[0]?.status === "live") {
                server = current[0];
                break;
              }
            }
            expect(server).not.toBeNull();
            expect(server!.status).toBe("live");
            expect(server!.port).toBeGreaterThan(0);
            expect(server!.terminalId).toBe("terminal-1");
          }).pipe(Effect.provide(testLayer)),
        );
      } finally {
        child.kill();
      }
    },
    20_000,
  );
});
