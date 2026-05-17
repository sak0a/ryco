import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import {
  DetectedServerRegistry,
  DetectedServerRegistryLive,
} from "./Services/DetectedServerRegistry.ts";
import {
  DetectedServersIngress,
  DetectedServersIngressLive,
} from "./Layers/DetectedServersIngress.ts";
import { LivenessHeartbeat } from "./Layers/LivenessHeartbeat.ts";
import { SocketProbe } from "./Layers/SocketProbe.ts";
import { PtyInputLineBuffer, tokenizeShellLine } from "./PtyInputLineBuffer.ts";

const stubProbe = Layer.succeed(SocketProbe, { probe: () => Effect.succeed([]) });
const stubHeartbeat = Layer.succeed(LivenessHeartbeat, { check: () => Effect.succeed(false) });

const testLayer = (() => {
  const deps = Layer.mergeAll(DetectedServerRegistryLive, stubProbe, stubHeartbeat);
  return Layer.mergeAll(deps, DetectedServersIngressLive.pipe(Layer.provide(deps)));
})();

describe("PtyInputLineBuffer", () => {
  it("emits line on Enter (LF)", () => {
    const lines: string[] = [];
    const buf = new PtyInputLineBuffer((l) => lines.push(l));
    buf.write("bun run dev\n");
    expect(lines).toEqual(["bun run dev"]);
  });

  it("emits line on CR", () => {
    const lines: string[] = [];
    const buf = new PtyInputLineBuffer((l) => lines.push(l));
    buf.write("bun run dev\r");
    expect(lines).toEqual(["bun run dev"]);
  });

  it("respects backspace before Enter", () => {
    const lines: string[] = [];
    const buf = new PtyInputLineBuffer((l) => lines.push(l));
    // Type "bxn", backspace twice, type "un run dev", Enter
    buf.write("bxn\x7f\x7fun run dev\r");
    expect(lines).toEqual(["bun run dev"]);
  });

  it("ignores empty / whitespace-only lines", () => {
    const lines: string[] = [];
    const buf = new PtyInputLineBuffer((l) => lines.push(l));
    buf.write("\r\n   \r\n");
    expect(lines).toEqual([]);
  });

  it("Ctrl-C clears buffer without emitting", () => {
    const lines: string[] = [];
    const buf = new PtyInputLineBuffer((l) => lines.push(l));
    buf.write("rm -rf /\x03ls\r");
    expect(lines).toEqual(["ls"]);
  });
});

describe("tokenizeShellLine", () => {
  it("splits on whitespace", () => {
    expect(tokenizeShellLine("  bun  run   dev ")).toEqual(["bun", "run", "dev"]);
  });

  it("returns empty for blank input", () => {
    expect(tokenizeShellLine("   ")).toEqual([]);
  });
});

describe("PtyTracker.feedCommand", () => {
  it("registers a server when a likely-server line is typed", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const ingress = yield* DetectedServersIngress;
        const registry = yield* DetectedServerRegistry;
        const tracker = yield* ingress.trackPty(
          {
            threadId: "thread-1",
            terminalId: "terminal-1",
            pid: 99999,
            argv: ["/bin/bash"],
            cwd: "/tmp",
          },
          { scripts: { dev: "vite" } },
        );

        const buf = new PtyInputLineBuffer((line) => {
          const argv = tokenizeShellLine(line);
          if (argv.length > 0) tracker.feedCommand(argv, "/tmp");
        });

        // Type "bun run dx", backspace once → "bun run d", then "ev\r" → submits "bun run dev"
        buf.write("bun run dx\x7fev\r");

        // feedCommand schedules registry work via runFork; yield once for it to land.
        yield* Effect.sleep(10);

        const servers = yield* registry.getCurrent("thread-1");
        expect(servers).toHaveLength(1);
        expect(servers[0]!.framework).toBe("vite");
        expect(servers[0]!.argv).toEqual(["bun", "run", "dev"]);
        expect(servers[0]!.terminalId).toBe("terminal-1");
      }).pipe(Effect.provide(testLayer)),
    );
  });

  it("does not register for empty / whitespace-only typed lines", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const ingress = yield* DetectedServersIngress;
        const registry = yield* DetectedServerRegistry;
        const tracker = yield* ingress.trackPty(
          {
            threadId: "thread-2",
            terminalId: "terminal-2",
            pid: 99998,
            argv: ["/bin/bash"],
            cwd: "/tmp",
          },
          undefined,
        );
        const buf = new PtyInputLineBuffer((line) => {
          const argv = tokenizeShellLine(line);
          if (argv.length > 0) tracker.feedCommand(argv, "/tmp");
        });
        buf.write("\r\n   \r\n");
        yield* Effect.sleep(10);
        const servers = yield* registry.getCurrent("thread-2");
        expect(servers).toHaveLength(0);
      }).pipe(Effect.provide(testLayer)),
    );
  });

  it("ignores non-server commands", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const ingress = yield* DetectedServersIngress;
        const registry = yield* DetectedServerRegistry;
        const tracker = yield* ingress.trackPty(
          {
            threadId: "thread-3",
            terminalId: "terminal-3",
            pid: 99997,
            argv: ["/bin/bash"],
            cwd: "/tmp",
          },
          undefined,
        );
        tracker.feedCommand(["ls", "-la"], "/tmp");
        tracker.feedCommand(["bun", "run", "test"], "/tmp");
        yield* Effect.sleep(10);
        const servers = yield* registry.getCurrent("thread-3");
        expect(servers).toHaveLength(0);
      }).pipe(Effect.provide(testLayer)),
    );
  });
});
