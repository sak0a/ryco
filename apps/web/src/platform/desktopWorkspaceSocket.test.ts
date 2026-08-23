import { EnvironmentId, type DesktopWorkspaceTransportEvent } from "@ryco/contracts";
import { describe, expect, it, vi } from "vitest";

import { DesktopWorkspaceIpcSocketFactory } from "./desktopWorkspaceSocket";

describe("DesktopWorkspaceIpcSocketFactory", () => {
  it("uses a fresh opaque handle and carries only authorized RPC bytes", async () => {
    let listener: ((event: DesktopWorkspaceTransportEvent) => void) | undefined;
    const activate = vi.fn(async () => undefined);
    const send = vi.fn();
    const close = vi.fn();
    const bridge = {
      prepareDesktopWorkspaceTransport: vi.fn(async () => ({ transportId: "A".repeat(32) })),
      activateDesktopWorkspaceTransport: activate,
      sendDesktopWorkspaceTransport: send,
      closeDesktopWorkspaceTransport: close,
      onDesktopWorkspaceTransportEvent: vi.fn((next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      }),
    };
    const factory = new DesktopWorkspaceIpcSocketFactory(EnvironmentId.make("env_remote"), bridge);
    const url = await factory.nextUrl();
    const socket = factory.createSocket(url);
    const opened = vi.fn();
    const message = vi.fn();
    socket.addEventListener("open", opened);
    socket.addEventListener("message", message);
    await Promise.resolve();
    expect(activate).toHaveBeenCalledWith("A".repeat(32));

    listener?.({ type: "open", transportId: "A".repeat(32) });
    socket.send(new Uint8Array([1, 2, 3]));
    listener?.({ type: "message", transportId: "A".repeat(32), data: new Uint8Array([4, 5]) });

    expect(opened).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith("A".repeat(32), new Uint8Array([1, 2, 3]));
    expect(message.mock.calls[0]?.[0].data).toEqual(new Uint8Array([4, 5]));
    socket.close();
    expect(close).toHaveBeenCalledWith("A".repeat(32));
    expect(() => factory.createSocket(url)).toThrow("fresh opaque handle");
    expect(JSON.stringify(bridge)).not.toContain("ticket");
  });

  it("fails closed when main refuses activation", async () => {
    const bridge = {
      prepareDesktopWorkspaceTransport: vi.fn(async () => ({ transportId: "B".repeat(32) })),
      activateDesktopWorkspaceTransport: vi.fn(async () => {
        throw new Error("sensitive internal detail");
      }),
      sendDesktopWorkspaceTransport: vi.fn(),
      closeDesktopWorkspaceTransport: vi.fn(),
      onDesktopWorkspaceTransportEvent: vi.fn(() => () => undefined),
    };
    const factory = new DesktopWorkspaceIpcSocketFactory(EnvironmentId.make("env_remote"), bridge);
    const socket = factory.createSocket(await factory.nextUrl());
    const errors = vi.fn();
    const closes = vi.fn();
    socket.addEventListener("error", errors);
    socket.addEventListener("close", closes);
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toHaveBeenCalledOnce();
    expect(closes.mock.calls[0]?.[0]).toMatchObject({ code: 4401, reason: "Relay unavailable" });
    expect(JSON.stringify(closes.mock.calls)).not.toContain("sensitive internal detail");
  });
});
