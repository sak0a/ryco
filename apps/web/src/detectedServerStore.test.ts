import { describe, it, expect, beforeEach } from "vitest";
import { useDetectedServerStore } from "./detectedServerStore.ts";

describe("detectedServerStore", () => {
  beforeEach(() => useDetectedServerStore.getState().__reset());

  it("registered adds a server to the thread map", () => {
    const store = useDetectedServerStore.getState();
    store.handleEvent("t1", {
      type: "registered",
      threadId: "t1",
      createdAt: "2026-05-13T00:00:00Z",
      server: {
        id: "s1",
        threadId: "t1",
        source: "pty",
        framework: "vite",
        status: "predicted",
        startedAt: new Date(),
        lastSeenAt: new Date(),
      } as any,
    });
    expect(useDetectedServerStore.getState().serversByThreadKey["t1"]?.size).toBe(1);
  });

  it("updated mutates an existing server", () => {
    const store = useDetectedServerStore.getState();
    store.handleEvent("t1", {
      type: "registered",
      threadId: "t1",
      createdAt: "2026-05-13T00:00:00Z",
      server: {
        id: "s1",
        threadId: "t1",
        source: "pty",
        framework: "vite",
        status: "predicted",
        startedAt: new Date(),
        lastSeenAt: new Date(),
      } as any,
    });
    store.handleEvent("t1", {
      type: "updated",
      threadId: "t1",
      createdAt: "2026-05-13T00:00:01Z",
      serverId: "s1",
      patch: { status: "live", url: "http://localhost:5173/" },
    });
    const server = useDetectedServerStore.getState().serversByThreadKey["t1"]!.get("s1");
    expect(server?.status).toBe("live");
    expect(server?.url).toBe("http://localhost:5173/");
  });

  it("log appends to the per-server buffer with a cap", () => {
    const store = useDetectedServerStore.getState();
    store.handleEvent("t1", {
      type: "registered",
      threadId: "t1",
      createdAt: "2026-05-13T00:00:00Z",
      server: {
        id: "s1",
        threadId: "t1",
        source: "pty",
        framework: "vite",
        status: "predicted",
        startedAt: new Date(),
        lastSeenAt: new Date(),
      } as any,
    });
    store.handleEvent("t1", {
      type: "log",
      threadId: "t1",
      createdAt: "2026-05-13T00:00:01Z",
      serverId: "s1",
      data: "hello\nworld\n",
    });
    const buf = useDetectedServerStore.getState().logBuffersByServerId.get("s1");
    expect(buf?.snapshot()).toEqual(["hello", "world"]);
  });

  it("removed drops the server and its log buffer", () => {
    const store = useDetectedServerStore.getState();
    store.handleEvent("t1", {
      type: "registered",
      threadId: "t1",
      createdAt: "2026-05-13T00:00:00Z",
      server: {
        id: "s1",
        threadId: "t1",
        source: "pty",
        framework: "vite",
        status: "predicted",
        startedAt: new Date(),
        lastSeenAt: new Date(),
      } as any,
    });
    store.handleEvent("t1", {
      type: "removed",
      threadId: "t1",
      createdAt: "2026-05-13T00:00:02Z",
      serverId: "s1",
    });
    expect(useDetectedServerStore.getState().serversByThreadKey["t1"]?.size ?? 0).toBe(0);
    expect(useDetectedServerStore.getState().logBuffersByServerId.has("s1")).toBe(false);
  });
});
