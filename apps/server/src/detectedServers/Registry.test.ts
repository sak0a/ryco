import { describe, it, expect } from "vitest";
import { Registry } from "./Layers/Registry.ts";
import type { DetectedServerEvent } from "@ryco/contracts";

const collectEvents = (registry: Registry) => {
  const events: DetectedServerEvent[] = [];
  registry.subscribe("thread-1", (e) => events.push(e));
  return events;
};

describe("Registry", () => {
  it("registers a predicted server and emits a registered event", () => {
    const r = new Registry();
    const events = collectEvents(r);
    r.registerOrUpdate({
      threadId: "thread-1",
      source: "pty",
      identityKey: "thread-1::42::5173",
      patch: {
        framework: "vite",
        status: "predicted",
        pid: 42,
        port: 5173,
        argv: ["vite"],
        cwd: "/work",
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("registered");
    if (events[0]!.type === "registered") {
      expect(events[0]!.server.status).toBe("predicted");
      expect(events[0]!.server.framework).toBe("vite");
    }
  });

  it("emits updated on subsequent transitions", () => {
    const r = new Registry();
    const events = collectEvents(r);
    r.registerOrUpdate({
      threadId: "thread-1",
      source: "pty",
      identityKey: "thread-1::42::5173",
      patch: { framework: "vite", status: "predicted", pid: 42, port: 5173 },
    });
    r.registerOrUpdate({
      threadId: "thread-1",
      source: "pty",
      identityKey: "thread-1::42::5173",
      patch: { status: "candidate", url: "http://localhost:5173/" },
    });
    expect(events[1]!.type).toBe("updated");
  });

  it("rejects illegal transition (live → predicted)", () => {
    const r = new Registry();
    collectEvents(r);
    r.registerOrUpdate({
      threadId: "thread-1",
      source: "pty",
      identityKey: "thread-1::42::5173",
      patch: { framework: "vite", status: "live", pid: 42, port: 5173 },
    });
    expect(() =>
      r.registerOrUpdate({
        threadId: "thread-1",
        source: "pty",
        identityKey: "thread-1::42::5173",
        patch: { status: "predicted" },
      }),
    ).toThrow(/illegal transition/i);
  });

  it("treats same identityKey as restart, not new server", () => {
    const r = new Registry();
    const events = collectEvents(r);
    r.registerOrUpdate({
      threadId: "thread-1",
      source: "pty",
      identityKey: "thread-1::42::5173",
      patch: { framework: "vite", status: "live", pid: 42, port: 5173 },
    });
    r.registerOrUpdate({
      threadId: "thread-1",
      source: "pty",
      identityKey: "thread-1::42::5173",
      patch: { status: "restarting" },
    });
    expect(r.getCurrent("thread-1").length).toBe(1);
    expect(events.filter((e) => e.type === "registered").length).toBe(1);
  });

  it("getCurrent returns servers for a thread only", () => {
    const r = new Registry();
    r.registerOrUpdate({
      threadId: "thread-1",
      source: "pty",
      identityKey: "thread-1::42::5173",
      patch: { framework: "vite", status: "predicted", pid: 42, port: 5173 },
    });
    r.registerOrUpdate({
      threadId: "thread-2",
      source: "pty",
      identityKey: "thread-2::99::3000",
      patch: { framework: "next", status: "predicted", pid: 99, port: 3000 },
    });
    expect(r.getCurrent("thread-1").length).toBe(1);
    expect(r.getCurrent("thread-2").length).toBe(1);
  });

  it("publishLog emits log events to subscribers of the matching thread", () => {
    const r = new Registry();
    const events = collectEvents(r);
    r.registerOrUpdate({
      threadId: "thread-1",
      source: "pty",
      identityKey: "thread-1::42::5173",
      patch: { framework: "vite", status: "predicted", pid: 42, port: 5173 },
    });
    const serverId = r.getCurrent("thread-1")[0]!.id;
    r.publishLog(serverId, "hello\n");
    const log = events.find((e) => e.type === "log");
    expect(log).toBeDefined();
    if (log?.type === "log") {
      expect(log.data).toBe("hello\n");
    }
  });
});
