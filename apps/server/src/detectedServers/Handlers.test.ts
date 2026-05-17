import { describe, expect, it, vi } from "vitest";
import { DateTime, Effect, Layer } from "effect";
import type { DetectedServer } from "@ryco/contracts";
import { handleDetectedServerOpenInBrowser, handleDetectedServerStop } from "./Handlers.ts";
import {
  DetectedServerRegistry,
  type DetectedServerRegistryShape,
} from "./Services/DetectedServerRegistry.ts";
import { Registry } from "./Layers/Registry.ts";
import type { TerminalManagerShape } from "../terminal/Services/Manager.ts";
import type { OpenShape } from "../open.ts";

// Each test gets a fresh registry instance so writes from earlier tests do
// not leak through the module-level DetectedServerRegistryLive layer.
const freshRegistryLayer = (): Layer.Layer<DetectedServerRegistry> => {
  const r = new Registry();
  return Layer.succeed(DetectedServerRegistry, {
    registerOrUpdate: (input) => Effect.sync(() => r.registerOrUpdate(input)),
    publishLog: (id, data) => Effect.sync(() => r.publishLog(id, data)),
    remove: (id) => Effect.sync(() => r.remove(id)),
    subscribe: (tid, listener) => Effect.sync(() => r.subscribe(tid, listener)),
    getCurrent: (tid) => Effect.sync(() => r.getCurrent(tid)),
    findById: (id) => Effect.sync(() => r.findById(id)),
  } satisfies DetectedServerRegistryShape);
};

const now = DateTime.fromDateUnsafe(new Date());

const baseServer: DetectedServer = {
  id: "server-1",
  threadId: "thread-1",
  source: "pty",
  framework: "vite",
  status: "live",
  url: "http://localhost:5173",
  port: 5173,
  host: "127.0.0.1",
  pid: 9999,
  terminalId: "terminal-1",
  argv: ["bun", "run", "dev"],
  cwd: "/repo",
  startedAt: now,
  lastSeenAt: now,
};

const seedRegistry = (server: DetectedServer) =>
  Effect.gen(function* () {
    const registry = yield* DetectedServerRegistry;
    const patch: Record<string, unknown> = {
      framework: server.framework,
      status: server.status,
    };
    if (server.url !== undefined) patch.url = server.url;
    if (server.port !== undefined) patch.port = server.port;
    if (server.host !== undefined) patch.host = server.host;
    if (server.pid !== undefined) patch.pid = server.pid;
    if (server.terminalId !== undefined) patch.terminalId = server.terminalId;
    if (server.argv !== undefined) patch.argv = server.argv;
    if (server.cwd !== undefined) patch.cwd = server.cwd;
    yield* registry.registerOrUpdate({
      threadId: server.threadId,
      source: server.source,
      identityKey: `${server.threadId}::${server.source}::${server.id}`,
      patch: patch as Parameters<typeof registry.registerOrUpdate>[0]["patch"],
    });
    return registry;
  });

const fakeTerminalManager = (close: ReturnType<typeof vi.fn>): TerminalManagerShape =>
  ({
    close,
  }) as unknown as TerminalManagerShape;

const fakeOpen = (openBrowser: ReturnType<typeof vi.fn>): OpenShape =>
  ({
    openBrowser,
  }) as unknown as OpenShape;

describe("detectedServers handlers", () => {
  describe("handleDetectedServerStop", () => {
    it("returns not-stoppable when the server id is unknown", async () => {
      const close = vi.fn(() => Effect.void);
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* DetectedServerRegistry;
          return yield* handleDetectedServerStop(registry, fakeTerminalManager(close), "missing");
        }).pipe(Effect.provide(freshRegistryLayer())),
      );
      expect(result).toEqual({ kind: "not-stoppable", hint: "interrupt-turn" });
      expect(close).not.toHaveBeenCalled();
    });

    it("calls TerminalManager.close and returns stopped for source=pty + terminalId", async () => {
      const close = vi.fn(() => Effect.void);
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* seedRegistry(baseServer);
          const servers = yield* registry.getCurrent("thread-1");
          const created = servers[0]!;
          return yield* handleDetectedServerStop(registry, fakeTerminalManager(close), created.id);
        }).pipe(Effect.provide(freshRegistryLayer())),
      );
      expect(result).toEqual({ kind: "stopped" });
      expect(close).toHaveBeenCalledTimes(1);
      const firstArg = (
        close.mock.calls[0] as unknown as [{ threadId: string; terminalId: string }]
      )[0];
      expect(firstArg).toEqual({ threadId: "thread-1", terminalId: "terminal-1" });
    });

    it("returns not-stoppable for non-pty servers", async () => {
      const close = vi.fn(() => Effect.void);
      const codexServer: DetectedServer = {
        ...baseServer,
        source: "codex",
        terminalId: undefined,
      };
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* seedRegistry(codexServer);
          const servers = yield* registry.getCurrent("thread-1");
          return yield* handleDetectedServerStop(
            registry,
            fakeTerminalManager(close),
            servers[0]!.id,
          );
        }).pipe(Effect.provide(freshRegistryLayer())),
      );
      expect(result).toEqual({ kind: "not-stoppable", hint: "interrupt-turn" });
      expect(close).not.toHaveBeenCalled();
    });
  });

  describe("handleDetectedServerOpenInBrowser", () => {
    it("opens the server URL in the browser when one exists", async () => {
      const openBrowser = vi.fn(() => Effect.void);
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* seedRegistry(baseServer);
          const servers = yield* registry.getCurrent("thread-1");
          return yield* handleDetectedServerOpenInBrowser(
            registry,
            fakeOpen(openBrowser),
            servers[0]!.id,
          );
        }).pipe(Effect.provide(freshRegistryLayer())),
      );
      expect(result).toEqual({ ok: true });
      expect(openBrowser).toHaveBeenCalledWith("http://localhost:5173");
    });

    it("returns ok:false and does not open when the server has no url", async () => {
      const openBrowser = vi.fn(() => Effect.void);
      const noUrlServer: DetectedServer = { ...baseServer, url: undefined };
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* seedRegistry(noUrlServer);
          const servers = yield* registry.getCurrent("thread-1");
          return yield* handleDetectedServerOpenInBrowser(
            registry,
            fakeOpen(openBrowser),
            servers[0]!.id,
          );
        }).pipe(Effect.provide(freshRegistryLayer())),
      );
      expect(result).toEqual({ ok: false });
      expect(openBrowser).not.toHaveBeenCalled();
    });
  });

  describe("DetectedServerRegistry subscribe + snapshot semantics", () => {
    it("subscriber receives a registered event when a new server is registered", async () => {
      const events: unknown[] = [];
      await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* DetectedServerRegistry;
          const unsub = yield* registry.subscribe("thread-x", (e) => events.push(e));
          yield* registry.registerOrUpdate({
            threadId: "thread-x",
            source: "pty",
            identityKey: "key-1",
            patch: { framework: "vite", status: "predicted", terminalId: "term-1" },
          });
          unsub();
        }).pipe(Effect.provide(freshRegistryLayer())),
      );
      expect(events).toHaveLength(1);
      expect((events[0] as { type: string }).type).toBe("registered");
    });

    it("snapshot replay (getCurrent) returns pre-existing servers so the WS handler can synthesize registered events", async () => {
      const initial = await Effect.runPromise(
        Effect.gen(function* () {
          yield* seedRegistry(baseServer);
          const registry = yield* DetectedServerRegistry;
          return yield* registry.getCurrent("thread-1");
        }).pipe(Effect.provide(freshRegistryLayer())),
      );
      expect(initial).toHaveLength(1);
      expect(initial[0]!.framework).toBe("vite");
      expect(initial[0]!.terminalId).toBe("terminal-1");
    });
  });
});
