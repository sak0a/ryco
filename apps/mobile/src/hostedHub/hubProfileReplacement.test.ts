import { describe, expect, it, vi } from "vite-plus/test";

import { createHubProfile } from "./hubProfile";
import {
  createHubProfileReplacementService,
  type HubProfileReplacementDependencies,
} from "./hubProfileReplacement";

const CURRENT = createHubProfile({ origin: "https://old.ryco.dev" })!;
const NEXT = createHubProfile({ origin: "https://new.ryco.dev" })!;

function harness(overrides: Partial<HubProfileReplacementDependencies> = {}) {
  const order: string[] = [];
  let status: "authenticated" | "signed-out" | "unavailable" = "authenticated";
  const dependencies: HubProfileReplacementDependencies = {
    saveProfile: async () => order.push("save-profile"),
    clearProfile: async () => order.push("clear-profile"),
    hostedAvailable: () => true,
    accountStatus: () => status,
    signOut: async () => {
      order.push("sign-out");
      status = "signed-out";
    },
    expireSession: async () => order.push("expire-session"),
    clearSessionToken: async () => order.push("clear-session-token"),
    forgetHubOrigin: async () => order.push("forget-origin"),
    invalidateRuntime: () => order.push("invalidate-runtime"),
    bootstrapSession: () => order.push("bootstrap-session"),
    ...overrides,
  };
  return { order, service: createHubProfileReplacementService(dependencies) };
}

describe("Hub profile replacement service", () => {
  it("persists a same-origin update without Hub teardown", async () => {
    const { order, service } = harness();
    const relabelled = { ...CURRENT, label: "Renamed" };

    expect(service.plan(CURRENT, relabelled)).toBeNull();
    await expect(service.replace(CURRENT, relabelled)).resolves.toEqual({
      profile: relabelled,
      remoteSignOut: "not-required",
    });
    expect(order).toEqual(["save-profile", "invalidate-runtime", "bootstrap-session"]);
  });

  it("changes origin using the existing ordered reset plan", async () => {
    const { order, service } = harness();

    expect(service.plan(CURRENT, NEXT)?.preserves).toEqual([
      "direct-connections",
      "direct-credentials",
    ]);
    await expect(service.replace(CURRENT, NEXT)).resolves.toEqual({
      profile: NEXT,
      remoteSignOut: "completed",
    });
    expect(order).toEqual([
      "sign-out",
      "clear-session-token",
      "forget-origin",
      "save-profile",
      "invalidate-runtime",
      "bootstrap-session",
    ]);
  });

  it("continues local teardown when remote sign-out is unavailable", async () => {
    const { order, service } = harness({
      signOut: async () => {
        order.push("sign-out");
        throw new Error("old Hub offline");
      },
    });

    await expect(service.replace(CURRENT, NEXT)).resolves.toMatchObject({
      remoteSignOut: "unavailable",
    });
    expect(order).toEqual([
      "sign-out",
      "expire-session",
      "clear-session-token",
      "forget-origin",
      "save-profile",
      "invalidate-runtime",
      "bootstrap-session",
    ]);
  });

  it("does not persist or re-bootstrap when local Hub teardown fails", async () => {
    const saveProfile = vi.fn(async () => undefined);
    const invalidateRuntime = vi.fn();
    const bootstrapSession = vi.fn();
    const { service } = harness({
      signOut: async () => {
        throw new Error("offline");
      },
      clearSessionToken: async () => {
        throw new Error("secure storage failed");
      },
      saveProfile,
      invalidateRuntime,
      bootstrapSession,
    });

    await expect(service.replace(CURRENT, NEXT)).rejects.toThrow("secure storage failed");
    expect(saveProfile).not.toHaveBeenCalled();
    expect(invalidateRuntime).not.toHaveBeenCalled();
    expect(bootstrapSession).not.toHaveBeenCalled();
  });

  it("can clear the saved override while preserving unrelated direct state", async () => {
    const directState = { connections: 2, credentials: 2 };
    const { order, service } = harness();

    await expect(service.replace(CURRENT, null)).resolves.toMatchObject({ profile: null });
    expect(order).toContain("clear-profile");
    expect(directState).toEqual({ connections: 2, credentials: 2 });
  });
});
