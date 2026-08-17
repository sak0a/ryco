import { describe, expect, it } from "vitest";

import { DEVICE_FRAME_RESYNC_MESSAGE } from "@ryco/shared/deviceFrame";

import { decodeResyncRequest, makeDeviceFrameSink } from "./deviceFrameRoute.ts";

describe("frame socket client messages", () => {
  it("recognizes a resync request in text or binary framing", () => {
    const message = JSON.stringify({ type: DEVICE_FRAME_RESYNC_MESSAGE });

    expect(decodeResyncRequest(message)).toBe("resync");
    expect(decodeResyncRequest(new TextEncoder().encode(message))).toBe("resync");
  });

  it("ignores malformed, unknown, and oversized messages", () => {
    expect(decodeResyncRequest("hello")).toBeNull();
    expect(decodeResyncRequest("{ not json")).toBeNull();
    expect(decodeResyncRequest(JSON.stringify({ type: "something.else" }))).toBeNull();
    expect(decodeResyncRequest(JSON.stringify(["resync"]))).toBeNull();
    expect(decodeResyncRequest(JSON.stringify(null))).toBeNull();
    expect(
      decodeResyncRequest(
        JSON.stringify({ type: DEVICE_FRAME_RESYNC_MESSAGE, padding: "x".repeat(4_096) }),
      ),
    ).toBeNull();
  });
});

describe("frame socket sink", () => {
  it("counts in-flight bytes until a write settles", async () => {
    let settle: (() => void) | undefined;
    const sink = makeDeviceFrameSink({
      send: () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
      isOpen: () => true,
    });

    sink.send(new Uint8Array(500));
    expect(sink.bufferedAmount()).toBe(500);
    settle?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(sink.bufferedAmount()).toBe(0);
  });

  it("clears rejected writes and reports connection closure", async () => {
    let open = true;
    const sink = makeDeviceFrameSink({
      send: () => Promise.reject(new Error("socket gone")),
      isOpen: () => open,
    });

    sink.send(new Uint8Array(64));
    await Promise.resolve();
    await Promise.resolve();
    expect(sink.bufferedAmount()).toBe(0);
    expect(sink.isOpen()).toBe(true);
    open = false;
    expect(sink.isOpen()).toBe(false);
  });
});
