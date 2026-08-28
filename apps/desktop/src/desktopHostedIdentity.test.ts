import type { HostedHubApi } from "@ryco/client-runtime/authorization";
import { HostedHubApiError } from "@ryco/client-runtime/authorization";

import type { DesktopHubControlClient } from "./desktopHubControl.ts";
import {
  DesktopHostedIdentityCoordinator,
  shouldEnableDesktopHubConnectorForAccountSetup,
} from "./desktopHostedIdentity.ts";
import type { DesktopHostedSessionCredentials } from "./hostedCredentials.ts";
import type { DesktopLocalIntroductionSecurity } from "./localTrustedIntroduction.ts";
import type { DesktopProtectedRecordStore } from "./protectedRecordStore.ts";
import type { DesktopE2eeTrustStore } from "./desktopE2eeTrust.ts";
import { describe, expect, it, vi } from "vite-plus/test";

function coordinator(input: {
  readonly api: Partial<HostedHubApi>;
  readonly credentials?: Partial<DesktopHostedSessionCredentials>;
  readonly setup?: ConstructorParameters<typeof DesktopHostedIdentityCoordinator>[0]["setup"];
  readonly trust?: DesktopE2eeTrustStore;
  readonly control?: DesktopHubControlClient;
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
    control: input.control ?? ({} as DesktopHubControlClient),
    security: {} as DesktopLocalIntroductionSecurity,
    records: {} as DesktopProtectedRecordStore,
    ...(input.trust === undefined ? {} : { trust: input.trust }),
    ...(input.setup === undefined ? {} : { setup: input.setup }),
  });
}

describe("Desktop hosted identity coordinator", () => {
  it("repairs a disabled connector after interactive account sign-in", () => {
    expect(
      shouldEnableDesktopHubConnectorForAccountSetup({
        hubOrigin: "https://hub.example.test",
        connectorEnabled: false,
        hasSessionMaterial: true,
      }),
    ).toBe(true);
    expect(
      shouldEnableDesktopHubConnectorForAccountSetup({
        hubOrigin: "https://hub.example.test",
        connectorEnabled: false,
        hasSessionMaterial: false,
      }),
    ).toBe(false);
    expect(
      shouldEnableDesktopHubConnectorForAccountSetup({
        hubOrigin: null,
        connectorEnabled: false,
        hasSessionMaterial: true,
      }),
    ).toBe(false);
  });

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

  it("exposes retained session material when sign-in succeeds before node setup", async () => {
    let hasSessionMaterial = false;
    const api = {
      get hasSessionMaterial() {
        return hasSessionMaterial;
      },
      signIn: vi.fn().mockImplementation(async () => {
        hasSessionMaterial = true;
        return { account: { id: "account-1" } };
      }),
    };
    const identity = coordinator({
      api,
      setup: vi.fn().mockRejectedValue(new Error("node connector disabled")),
    });

    await expect(identity.connect()).resolves.toEqual({ status: "unavailable" });
    expect(identity.hasSessionMaterial).toBe(true);
  });

  it("resumes the client from retained local trust while the node plane is unavailable", async () => {
    const list = vi.fn().mockResolvedValue([
      {
        hubOrigin: "https://hub.example.test",
        accountId: "account-1",
        nodeId: "node-local",
        environmentId: "env-local",
        localNodeHandle: "L".repeat(22),
        verificationMethod: "local-trusted-introduction-v1",
      },
    ]);
    const identity = coordinator({
      api: {
        hasSessionMaterial: true,
        restoreSession: vi.fn().mockResolvedValue({ account: { id: "account-1" } }),
      },
      control: {
        nodeClaimDescriptor: vi.fn().mockRejectedValue(new Error("node connector disabled")),
      } as unknown as DesktopHubControlClient,
      trust: { list } as unknown as DesktopE2eeTrustStore,
    });

    await expect(identity.resume()).resolves.toMatchObject({
      status: "ready",
      accountId: "account-1",
      nodeId: "node-local",
      localNodeHandle: "L".repeat(22),
    });
    expect(list).toHaveBeenCalledWith("https://hub.example.test", "account-1");
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

  it("projects only bounded GitHub policy and display metadata", async () => {
    const identity = coordinator({
      api: {
        hasSessionMaterial: true,
        restoreSession: vi.fn().mockResolvedValue({ account: { id: "account-1" } }),
        getExternalIdentityConfiguration: vi.fn().mockResolvedValue({
          version: 1,
          providers: [{ provider: "github", login: true, signup: true, link: true }],
        }),
        getAccountSecurity: vi.fn().mockResolvedValue({
          passwordConfigured: true,
          totpEnrolled: false,
          emailDeliveryConfigured: false,
          email: null,
          externalIdentities: [
            {
              provider: "github",
              login: "octocat",
              displayName: "The Octocat",
              connectedAt: 1_700_000_000_000,
              lastUsedAt: null,
            },
          ],
        }),
      },
      setup: vi.fn().mockResolvedValue({ nodeId: "node-1", localNodeHandle: "local-node-1" }),
    });

    const status = await identity.resume();
    expect(status).toMatchObject({
      status: "ready",
      github: {
        linkAvailable: true,
        identity: { provider: "github", login: "octocat", displayName: "The Octocat" },
      },
    });
    expect(JSON.stringify(status)).not.toContain("providerSubject");
    expect(JSON.stringify(status)).not.toContain("accessToken");
  });

  it("retries a staged GitHub connection with TOTP without reopening a separate flow", async () => {
    const connectExternalIdentity = vi
      .fn()
      .mockRejectedValueOnce(new HostedHubApiError("step_up_required", 403))
      .mockResolvedValueOnce({
        provider: "github",
        login: "octocat",
        displayName: null,
        connectedAt: 1_700_000_000_000,
        lastUsedAt: null,
      });
    const identity = coordinator({
      api: { hasSessionMaterial: true, connectExternalIdentity },
    });

    await expect(identity.connectGitHub()).resolves.toMatchObject({
      outcome: "step-up-required",
      signedOut: false,
    });
    await expect(identity.connectGitHub({ totpCode: "123456" })).resolves.toMatchObject({
      outcome: "committed",
      signedOut: false,
      github: { identity: { login: "octocat" } },
    });
    expect(connectExternalIdentity).toHaveBeenNthCalledWith(1, "github", undefined);
    expect(connectExternalIdentity).toHaveBeenNthCalledWith(2, "github", {
      totpCode: "123456",
    });
  });

  it("returns a bounded last-primary result when disconnect is refused", async () => {
    const identity = coordinator({
      api: {
        hasSessionMaterial: true,
        disconnectExternalIdentity: vi
          .fn()
          .mockRejectedValue(new HostedHubApiError("last_primary_credential", 409)),
      },
    });

    await expect(identity.disconnectGitHub()).resolves.toMatchObject({
      outcome: "last-primary-credential",
      signedOut: false,
    });
  });

  it("forgets a staged GitHub connection when Desktop cancels step-up", () => {
    const cancelExternalIdentityConnection = vi.fn();
    const identity = coordinator({
      api: { cancelExternalIdentityConnection },
    });

    identity.cancelGitHubConnection();

    expect(cancelExternalIdentityConnection).toHaveBeenCalledWith("github");
  });
});
