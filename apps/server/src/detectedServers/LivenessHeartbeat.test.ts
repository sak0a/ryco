import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { LivenessHeartbeatLive, LivenessHeartbeat } from "./Layers/LivenessHeartbeat.ts";

const runCheck = (url: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const heartbeat = yield* LivenessHeartbeat;
      return yield* heartbeat.check(url);
    }).pipe(Effect.provide(LivenessHeartbeatLive)),
  );

describe("LivenessHeartbeat", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true on a 200 response", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    expect(await runCheck("http://localhost:5173")).toBe(true);
  });

  it("returns true on a 500 response (any HTTP response counts)", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 500 }),
    );
    expect(await runCheck("http://localhost:5173")).toBe(true);
  });

  it("returns false on AbortError (timeout)", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    expect(await runCheck("http://localhost:5173")).toBe(false);
  });

  it("returns false on a generic network error", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("ECONNREFUSED"),
    );
    expect(await runCheck("http://localhost:5173")).toBe(false);
  });
});
