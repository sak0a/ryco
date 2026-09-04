import { describe, expect, it } from "vite-plus/test";

import { HOSTED_CONNECTION_STATUS_INDICATORS } from "@ryco/client-runtime/authorization";

import { deriveNodeTrustByEnvironment, NODE_TRUST_UNVERIFIED_LABEL } from "./nodeTrustModel";

describe("Node trust presentation", () => {
  it("presents only the authoritative verified state as verified", () => {
    const trust = deriveNodeTrustByEnvironment({
      authoritativeTrustByEnvironmentId: new Map([
        ["env-a", "verified"],
        ["env-b", "unverified"],
        ["env-account", "account-trusted"],
        ["env-c", "unknown"],
        ["env-d", "identity-conflict"],
      ]),
    });
    expect(Object.fromEntries(trust)).toEqual({
      "env-a": "verified",
      "env-b": "unverified",
      "env-account": "account-trusted",
      "env-c": "unverified",
      "env-d": "unverified",
    });
  });

  it("returns an empty map for an empty authoritative result", () => {
    expect(
      deriveNodeTrustByEnvironment({ authoritativeTrustByEnvironmentId: new Map() }).size,
    ).toBe(0);
  });

  it("reuses the client-runtime label rather than inventing a phrasing", () => {
    expect(NODE_TRUST_UNVERIFIED_LABEL in HOSTED_CONNECTION_STATUS_INDICATORS).toBe(true);
  });
});
