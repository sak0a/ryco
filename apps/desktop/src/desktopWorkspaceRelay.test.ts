import { EnvironmentId } from "@ryco/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  DesktopWorkspaceRelayManager,
  type DesktopWorkspaceRelayAuthority,
  type DesktopWorkspaceTransportEvent,
} from "./desktopWorkspaceRelay.ts";

function unavailableAuthority(): DesktopWorkspaceRelayAuthority {
  return {
    resolveTarget: vi.fn().mockResolvedValue(null),
    prepareE2ee: vi.fn(),
    handshake: vi.fn(),
    issueTicket: vi.fn(),
    authorizeUpgrade: vi.fn(),
  };
}

describe("Desktop workspace relay manager", () => {
  it("bounds prepared opaque handles and never derives them from environment ids", () => {
    const manager = new DesktopWorkspaceRelayManager({
      authority: unavailableAuthority(),
      emit: vi.fn(),
    });
    const ids = Array.from({ length: 8 }, (_, index) =>
      manager.prepare(EnvironmentId.make(`environment-${index}`)),
    );

    expect(new Set(ids).size).toBe(8);
    expect(ids.every((id) => /^[A-Za-z0-9_-]{32}$/u.test(id))).toBe(true);
    expect(ids.some((id) => id.includes("environment"))).toBe(false);
    expect(() => manager.prepare(EnvironmentId.make("environment-9"))).toThrow(
      "Desktop workspace transport capacity is unavailable.",
    );
  });

  it("expires unused handles before admitting another transport", () => {
    let now = 100;
    const manager = new DesktopWorkspaceRelayManager({
      authority: unavailableAuthority(),
      emit: vi.fn(),
      now: () => now,
    });
    for (let index = 0; index < 8; index += 1) {
      manager.prepare(EnvironmentId.make(`environment-${index}`));
    }

    now += 30_001;
    expect(() => manager.prepare(EnvironmentId.make("environment-new"))).not.toThrow();
  });

  it("fails an unavailable exact target closed without exposing authority material", async () => {
    const events: DesktopWorkspaceTransportEvent[] = [];
    const authority = unavailableAuthority();
    const manager = new DesktopWorkspaceRelayManager({
      authority,
      emit: (event) => events.push(event),
    });
    const transportId = manager.prepare(EnvironmentId.make("environment-1"));

    await expect(manager.activate(transportId)).rejects.toThrow(
      "Desktop workspace relay activation failed.",
    );
    expect(authority.resolveTarget).toHaveBeenCalledWith("environment-1");
    expect(authority.issueTicket).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: "error", transportId },
      { type: "close", transportId, code: 4401, reason: "Relay unavailable" },
    ]);
    expect(() => manager.send(transportId, Uint8Array.of(1))).toThrow(
      "Desktop workspace transport is unavailable.",
    );
  });
});
