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
    expect(authority.resolveTarget).toHaveBeenCalledWith("environment-1", false);
    expect(authority.issueTicket).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: "error", transportId },
      { type: "close", transportId, code: 4401, reason: "Relay unavailable" },
    ]);
    expect(() => manager.send(transportId, Uint8Array.of(1))).toThrow(
      "Desktop workspace transport is unavailable.",
    );
  });

  it("marks verification transports as pairing-only at every authority boundary", async () => {
    const authority = unavailableAuthority();
    const manager = new DesktopWorkspaceRelayManager({
      authority,
      emit: vi.fn(),
    });
    const transportId = manager.prepareVerification(EnvironmentId.make("environment-1"));

    await expect(manager.activate(transportId)).rejects.toThrow(
      "Desktop workspace relay activation failed.",
    );
    expect(authority.resolveTarget).toHaveBeenCalledWith("environment-1", true);
  });

  it("does not issue the legacy ticket request for an account-trusted target", async () => {
    const events: DesktopWorkspaceTransportEvent[] = [];
    const authority = unavailableAuthority();
    vi.mocked(authority.resolveTarget).mockResolvedValue({
      accountId: `acct_${"a".repeat(22)}`,
      nodeId: `node_${"n".repeat(22)}`,
      environmentId: EnvironmentId.make("environment-1"),
      relayUrl: "wss://hub.example.test/v1/relay/client",
      nativeTrust: "account-trusted",
    });
    vi.mocked(authority.prepareE2ee).mockResolvedValue({
      kind: "update-required",
    });
    vi.mocked(authority.authorizeUpgrade).mockResolvedValue({});
    vi.mocked(authority.handshake).mockResolvedValue({} as never);
    const manager = new DesktopWorkspaceRelayManager({
      authority,
      emit: (event) => events.push(event),
    });

    await expect(
      manager.activate(manager.prepare(EnvironmentId.make("environment-1"))),
    ).rejects.toThrow("Desktop workspace relay activation failed.");
    expect(authority.issueTicket).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: "close",
      code: 4406,
      reason: "Update required",
    });
  });

  it("uses a pairing ticket when independently verifying an account-trusted target", async () => {
    const authority = unavailableAuthority();
    const environmentId = EnvironmentId.make("environment-1");
    vi.mocked(authority.resolveTarget).mockResolvedValue({
      accountId: `acct_${"a".repeat(22)}`,
      nodeId: `node_${"n".repeat(22)}`,
      environmentId,
      relayUrl: "wss://hub.example.test/v1/relay/client",
      nativeTrust: "account-trusted",
    });
    vi.mocked(authority.prepareE2ee).mockResolvedValue({
      kind: "native",
      pairingOnly: true,
      attemptHandle: "a".repeat(43),
      suiteId: 1,
      credentials: { tier: "native" },
    } as never);
    vi.mocked(authority.issueTicket).mockResolvedValue({
      ticket: "pairing-ticket",
      expiresAt: Date.now() + 60_000,
    });
    vi.mocked(authority.authorizeUpgrade).mockResolvedValue({});
    vi.mocked(authority.handshake).mockResolvedValue({} as never);
    const socketFactory = vi.fn(() => ({ send: vi.fn(), close: vi.fn() }));
    const manager = new DesktopWorkspaceRelayManager({
      authority,
      emit: vi.fn(),
      socketFactory,
    });

    await manager.activate(manager.prepareVerification(environmentId));

    expect(authority.prepareE2ee).toHaveBeenCalledWith(
      expect.objectContaining({ nativeTrust: "account-trusted" }),
      true,
    );
    expect(authority.issueTicket).toHaveBeenCalledOnce();
    expect(socketFactory).toHaveBeenCalledWith(
      expect.objectContaining({ ticket: "pairing-ticket" }),
    );
  });

  it("invalidates every native workspace when an account enrollment is revoked", async () => {
    const onAccountAuthorizationRevoked = vi.fn();
    const authority = {
      ...unavailableAuthority(),
      onAccountAuthorizationRevoked,
    };
    vi.mocked(authority.resolveTarget).mockResolvedValue({
      accountId: `acct_${"a".repeat(22)}`,
      nodeId: `node_${"n".repeat(22)}`,
      environmentId: EnvironmentId.make("environment-1"),
      relayUrl: "wss://hub.example.test/v1/relay/client",
      nativeTrust: "account-trusted",
    });
    vi.mocked(authority.prepareE2ee).mockResolvedValue({
      kind: "native",
      pairingOnly: false,
      attemptHandle: "a".repeat(43),
      suiteId: 2,
      credentials: { tier: "native" },
      relayTicket: { ticket: "t".repeat(43), expiresAt: Date.now() + 60_000 },
    } as never);
    vi.mocked(authority.authorizeUpgrade).mockResolvedValue({});
    vi.mocked(authority.handshake).mockResolvedValue({
      destroy: vi.fn(),
    } as never);
    let callbacks:
      | Parameters<
          NonNullable<
            ConstructorParameters<typeof DesktopWorkspaceRelayManager>[0]["socketFactory"]
          >
        >[0]["callbacks"]
      | undefined;
    const close = vi.fn();
    const manager = new DesktopWorkspaceRelayManager({
      authority,
      emit: vi.fn(),
      socketFactory: (input) => {
        callbacks = input.callbacks;
        return { send: vi.fn(), close };
      },
    });
    await manager.activate(manager.prepare(EnvironmentId.make("environment-1")));

    callbacks?.onFailure({ kind: "revoked", retryable: false });
    await Promise.resolve();

    expect(onAccountAuthorizationRevoked).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
