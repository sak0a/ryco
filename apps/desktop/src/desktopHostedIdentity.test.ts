import type { HostedHubApi } from "@ryco/client-runtime/authorization";

import type { DesktopHubControlClient } from "./desktopHubControl.ts";
import { DesktopHostedIdentityCoordinator } from "./desktopHostedIdentity.ts";
import type { DesktopHostedSessionCredentials } from "./hostedCredentials.ts";
import type { DesktopLocalIntroductionSecurity } from "./localTrustedIntroduction.ts";
import type { DesktopProtectedRecordStore } from "./protectedRecordStore.ts";
import { describe, expect, it, vi } from "vite-plus/test";

function coordinator(input: {
  readonly api: Partial<HostedHubApi>;
  readonly credentials?: Partial<DesktopHostedSessionCredentials>;
  readonly setup?: ConstructorParameters<typeof DesktopHostedIdentityCoordinator>[0]["setup"];
}) {
  return new DesktopHostedIdentityCoordinator({
    origin: "https://hub.example.test",
    installationId: `install_${"A".repeat(22)}`,
    api: input.api as HostedHubApi,
    credentials: {
      hydrate: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      ...input.credentials,
    } as DesktopHostedSessionCredentials,
    control: {} as DesktopHubControlClient,
    security: {} as DesktopLocalIntroductionSecurity,
    records: {} as DesktopProtectedRecordStore,
    ...(input.setup === undefined ? {} : { setup: input.setup }),
  });
}

describe("Desktop hosted identity coordinator", () => {
  it("does not open the browser during a background resume without a session", async () => {
    const signIn = vi.fn();
    const setup = vi.fn();
    const identity = coordinator({
      api: { hasSessionMaterial: false, signIn },
      setup,
    });

    await expect(identity.resume()).resolves.toEqual({ status: "signed-out" });
    expect(signIn).not.toHaveBeenCalled();
    expect(setup).not.toHaveBeenCalled();
  });

  it("upgrades a concurrent background resume when the user chooses Connect", async () => {
    let releaseFirstHydrate!: () => void;
    const firstHydrate = new Promise<void>((resolve) => {
      releaseFirstHydrate = resolve;
    });
    const hydrate = vi
      .fn<DesktopHostedSessionCredentials["hydrate"]>()
      .mockImplementationOnce(async () => await firstHydrate)
      .mockResolvedValue(undefined);
    const signIn = vi.fn().mockResolvedValue({ account: { id: "account-1" } });
    const setup = vi.fn().mockResolvedValue({
      nodeId: "node-1",
      localNodeHandle: "local-node-1",
    });
    const identity = coordinator({
      api: { hasSessionMaterial: false, signIn },
      credentials: { hydrate },
      setup,
    });

    const resumed = identity.resume();
    const connected = identity.connect();
    releaseFirstHydrate();

    await expect(resumed).resolves.toEqual({ status: "signed-out" });
    await expect(connected).resolves.toEqual({
      status: "ready",
      accountId: "account-1",
      nodeId: "node-1",
      localNodeHandle: "local-node-1",
    });
    expect(hydrate).toHaveBeenCalledTimes(2);
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(setup).toHaveBeenCalledWith({ accountId: "account-1" });
  });

  it("does not let an in-flight setup restore credentials after disconnect", async () => {
    let releaseSetup!: () => void;
    const setupWait = new Promise<void>((resolve) => {
      releaseSetup = resolve;
    });
    const clearSessionMaterial = vi.fn();
    const clear = vi.fn().mockResolvedValue(undefined);
    const identity = coordinator({
      api: {
        hasSessionMaterial: true,
        restoreSession: vi.fn().mockResolvedValue({ account: { id: "account-1" } }),
        clearSessionMaterial,
      },
      credentials: { clear },
      setup: async () => {
        await setupWait;
        return { nodeId: "node-1", localNodeHandle: "local-node-1" };
      },
    });

    const connected = identity.connect();
    const disconnected = identity.disconnect();
    expect(clearSessionMaterial).not.toHaveBeenCalled();
    releaseSetup();

    await expect(connected).resolves.toMatchObject({ status: "ready" });
    await disconnected;
    expect(clearSessionMaterial).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
  });
});
