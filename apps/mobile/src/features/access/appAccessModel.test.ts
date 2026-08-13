import { describe, expect, it } from "vitest";

import { deriveAppAccess, isWorkspaceDeepLink } from "./appAccessModel";

const complete = {
  hostedHydrated: true,
  hostedSessionRevalidated: false,
  directHydrated: true,
  directCredentialReadable: false,
} as const;

describe("authoritative app access", () => {
  it("stays hydrating until both independent planes finish", () => {
    expect(deriveAppAccess({ ...complete, hostedHydrated: false })).toEqual({
      status: "hydrating",
    });
    expect(deriveAppAccess({ ...complete, directHydrated: false })).toEqual({
      status: "hydrating",
    });
  });

  it("locks when neither plane has proven usable authority", () => {
    expect(deriveAppAccess(complete)).toEqual({ status: "locked" });
  });

  it("unlocks for only the revalidated hosted session", () => {
    expect(deriveAppAccess({ ...complete, hostedSessionRevalidated: true })).toEqual({
      status: "unlocked",
      via: "hosted-session",
    });
  });

  it("unlocks for only a saved direct node with readable credential material", () => {
    expect(deriveAppAccess({ ...complete, directCredentialReadable: true })).toEqual({
      status: "unlocked",
      via: "direct-node",
    });
  });

  it("reports both without treating either as dependent on the other", () => {
    expect(
      deriveAppAccess({
        ...complete,
        hostedSessionRevalidated: true,
        directCredentialReadable: true,
      }),
    ).toEqual({ status: "unlocked", via: "both" });
  });
});

describe("locked deep-link classification", () => {
  it("queues workspace destinations but keeps auth and direct pairing in the blocker", () => {
    expect(isWorkspaceDeepLink("ryco://threads/env/thread")).toBe(true);
    expect(isWorkspaceDeepLink("ryco://projects/env/project")).toBe(true);
    expect(isWorkspaceDeepLink("ryco://account/access#token=secret")).toBe(false);
    expect(isWorkspaceDeepLink("ryco://connections/new#token=secret")).toBe(false);
    expect(isWorkspaceDeepLink("ryco://hosted/complete?code=secret")).toBe(false);
  });
});
