import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("expo-constants", () => ({
  default: { deviceName: "Ryco mobile", expoConfig: { extra: {} } },
}));

import {
  createMobileNativeAuthorization,
  mobileAuthorizationCallbackUri,
  type MobileNativeAuthorizationDependencies,
} from "./nativeAuthorization";
import { createNativeAuthorizationPhaseStore } from "../features/onboarding/nativeAuthorizationState";

function dependencies(
  overrides: Partial<MobileNativeAuthorizationDependencies> = {},
): MobileNativeAuthorizationDependencies {
  return {
    variant: () => "development",
    deviceLabel: () => "Laurin's iPhone",
    loadCrypto: async () =>
      ({
        CryptoDigestAlgorithm: { SHA256: "SHA-256" },
        getRandomBytesAsync: async (length: number) => new Uint8Array(length).fill(7),
        digest: async (_algorithm: string, value: Uint8Array) =>
          new Uint8Array(value.length).fill(9).buffer,
      }) as never,
    loadBrowser: async () =>
      ({
        openAuthSessionAsync: async () => ({
          type: "success",
          url: "ryco-dev://hosted/complete?code=x",
        }),
        dismissAuthSession: () => {},
      }) as never,
    ...overrides,
  };
}

describe("mobile native authorization adapter", () => {
  it("uses one exact callback URI per app variant", () => {
    expect(mobileAuthorizationCallbackUri("development")).toBe("ryco-dev://hosted/complete");
    expect(mobileAuthorizationCallbackUri("preview")).toBe("ryco-preview://hosted/complete");
    expect(mobileAuthorizationCallbackUri("production")).toBe("ryco://hosted/complete");
  });

  it("supplies OS entropy, SHA-256, and the bounded public device label", async () => {
    const service = createMobileNativeAuthorization(dependencies());

    expect(service.callbackUri()).toBe("ryco-dev://hosted/complete");
    expect(service.deviceLabel()).toBe("Laurin's iPhone");
    await expect(service.randomBytes(32)).resolves.toEqual(new Uint8Array(32).fill(7));
    await expect(service.sha256(new Uint8Array(32))).resolves.toEqual(new Uint8Array(32).fill(9));
  });

  it("opens a reusable system-browser session and returns only its callback", async () => {
    const openAuthSessionAsync = vi.fn(async () => ({
      type: "success" as const,
      url: "ryco-dev://hosted/complete?code=x&state=y&handoff_id=z",
    }));
    const service = createMobileNativeAuthorization(
      dependencies({
        loadBrowser: async () => ({ openAuthSessionAsync, dismissAuthSession: () => {} }) as never,
      }),
    );

    await expect(
      service.openSystemBrowser(
        "https://hub.ryco.dev/native/authorize/id",
        "ryco-dev://hosted/complete",
      ),
    ).resolves.toEqual({
      type: "success",
      url: "ryco-dev://hosted/complete?code=x&state=y&handoff_id=z",
    });
    expect(openAuthSessionAsync).toHaveBeenCalledWith(
      "https://hub.ryco.dev/native/authorize/id",
      "ryco-dev://hosted/complete",
      {
        preferEphemeralSession: false,
        preferUniversalLinks: false,
      },
    );
  });

  it("reports opening, waiting, and idle without publishing browser data", async () => {
    const phase = createNativeAuthorizationPhaseStore();
    const snapshots: string[] = [];
    phase.subscribe(() => snapshots.push(phase.getSnapshot().phase));
    let releaseBrowser: ((value: { type: "success"; url: string }) => void) | undefined;
    const service = createMobileNativeAuthorization(
      dependencies({
        phase,
        loadBrowser: async () =>
          ({
            openAuthSessionAsync: () =>
              new Promise((resolve) => {
                releaseBrowser = resolve;
              }),
            dismissAuthSession: () => {},
          }) as never,
      }),
    );

    const pending = service.openSystemBrowser(
      "https://hub.ryco.dev/native/authorize/id",
      "ryco-dev://hosted/complete",
    );
    await Promise.resolve();
    expect(snapshots).toEqual(["opening", "waiting"]);

    releaseBrowser?.({
      type: "success",
      url: "ryco-dev://hosted/complete?code=x&state=y&handoff_id=z",
    });
    await expect(pending).resolves.toMatchObject({ type: "success" });
    expect(snapshots).toEqual(["opening", "waiting", "idle"]);
    expect(JSON.stringify(phase.getSnapshot())).not.toContain("handoff_id");
  });

  it("reports cancelled for browser dismissal and idle for a locked browser", async () => {
    const dismissed = createNativeAuthorizationPhaseStore();
    const dismissedService = createMobileNativeAuthorization(
      dependencies({
        phase: dismissed,
        loadBrowser: async () =>
          ({ openAuthSessionAsync: async () => ({ type: "dismiss" }) }) as never,
      }),
    );
    await expect(
      dismissedService.openSystemBrowser(
        "https://hub.ryco.dev/native/authorize/id",
        "ryco-dev://hosted/complete",
      ),
    ).resolves.toEqual({ type: "dismiss" });
    expect(dismissed.getSnapshot().phase).toBe("cancelled");

    const locked = createNativeAuthorizationPhaseStore();
    const lockedService = createMobileNativeAuthorization(
      dependencies({
        phase: locked,
        loadBrowser: async () =>
          ({ openAuthSessionAsync: async () => ({ type: "locked" }) }) as never,
      }),
    );
    await lockedService.openSystemBrowser(
      "https://hub.ryco.dev/native/authorize/id",
      "ryco-dev://hosted/complete",
    );
    expect(locked.getSnapshot().phase).toBe("idle");
  });

  it("dismisses the browser and resolves as cancelled when the attempt is aborted", async () => {
    const dismissAuthSession = vi.fn();
    const phase = createNativeAuthorizationPhaseStore();
    const pending = new Promise<never>(() => {});
    const service = createMobileNativeAuthorization(
      dependencies({
        phase,
        loadBrowser: async () =>
          ({
            openAuthSessionAsync: () => pending,
            dismissAuthSession,
          }) as never,
      }),
    );
    const controller = new AbortController();
    const result = service.openSystemBrowser(
      "https://hub.ryco.dev/native/authorize/id",
      "ryco-dev://hosted/complete",
      controller.signal,
    );
    await Promise.resolve();
    controller.abort();

    await expect(result).resolves.toEqual({ type: "cancel" });
    expect(dismissAuthSession).toHaveBeenCalledTimes(1);
    expect(phase.getSnapshot().phase).toBe("cancelled");
  });
});
