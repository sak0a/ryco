import { describe, it, expect } from "vitest";
import { Effect, Layer, Duration } from "effect";
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

describe("DetectedServers / Codex synthetic", () => {
  it("transitions predicted → candidate on Vite-shaped outputDelta", async () => {
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
        const tracker = yield* ingress.trackAgentCommand(
          {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "item-1",
            argv: ["vite"],
            cwd: "/tmp",
          },
          "codex",
          undefined,
        );
        tracker.feed("  ➜  Local:   http://localhost:5173/\n");
        // Poll until the sniffer callback registers the candidate (bounded wait).
        let current = yield* registry.getCurrent("thread-1");
        for (let attempt = 0; attempt < 50 && current[0]?.status !== "candidate"; attempt += 1) {
          yield* Effect.sleep(Duration.millis(50));
          current = yield* registry.getCurrent("thread-1");
        }
        expect(current).toHaveLength(1);
        expect(current[0]!.status).toBe("candidate");
        expect(current[0]!.url).toBe("http://localhost:5173/");
        expect(current[0]!.framework).toBe("vite");
      }).pipe(Effect.provide(testLayer)),
    );
  });
});
