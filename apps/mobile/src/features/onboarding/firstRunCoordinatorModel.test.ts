import { describe, expect, it } from "vite-plus/test";

import {
  deriveFirstRunLaunchDisposition,
  hasActionableInitialDeepLink,
  resolveFirstRunStartup,
} from "./firstRunCoordinatorModel";

describe("first-run startup", () => {
  it("keeps an explicit marker authoritative", () => {
    expect(
      resolveFirstRunStartup({
        progress: { version: 1, status: "in-progress" },
        hasStoredHub: true,
        directEnvironmentCount: 1,
        hostedAuthenticated: true,
      }),
    ).toEqual({ status: "in-progress", persist: false });
  });

  it("writes completed for existing users and in-progress for a fresh install", () => {
    expect(
      resolveFirstRunStartup({
        progress: null,
        hasStoredHub: true,
        directEnvironmentCount: 0,
        hostedAuthenticated: false,
      }),
    ).toEqual({ status: "completed", persist: true });
    expect(
      resolveFirstRunStartup({
        progress: null,
        hasStoredHub: false,
        directEnvironmentCount: 0,
        hostedAuthenticated: false,
      }),
    ).toEqual({ status: "in-progress", persist: true });
  });
});

describe("first-run launch disposition", () => {
  it("presents once from a neutral Home launch", () => {
    expect(
      deriveFirstRunLaunchDisposition({
        status: "in-progress",
        routeNames: ["Home"],
        presentationRequested: false,
      }),
    ).toBe("present");
  });

  it("defers the entire launch when a deep-linked destination is active", () => {
    for (const routeNames of [
      ["Home", "Thread"],
      ["Project"],
      ["Home", "SettingsSheet"],
      ["Home", "Onboarding"],
    ]) {
      expect(
        deriveFirstRunLaunchDisposition({
          status: "in-progress",
          routeNames,
          presentationRequested: false,
        }),
      ).toBe("defer");
    }
  });

  it("defers when the initial deep link has not reached navigation yet", () => {
    expect(
      deriveFirstRunLaunchDisposition({
        status: "in-progress",
        routeNames: ["Home"],
        presentationRequested: false,
        hasInitialDeepLink: true,
      }),
    ).toBe("defer");
    expect(hasActionableInitialDeepLink("ryco-dev://threads/node/thread")).toBe(true);
    expect(
      hasActionableInitialDeepLink(
        "ryco-dev://expo-development-client/?url=http%3A%2F%2Flocalhost",
      ),
    ).toBe(false);
    expect(hasActionableInitialDeepLink(null)).toBe(false);
  });

  it("does nothing for completed users or after presentation was requested", () => {
    expect(
      deriveFirstRunLaunchDisposition({
        status: "completed",
        routeNames: ["Home"],
        presentationRequested: false,
      }),
    ).toBe("none");
    expect(
      deriveFirstRunLaunchDisposition({
        status: "in-progress",
        routeNames: ["Home"],
        presentationRequested: true,
      }),
    ).toBe("none");
  });
});
