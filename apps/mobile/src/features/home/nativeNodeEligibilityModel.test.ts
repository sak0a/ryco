import { describe, expect, it } from "vite-plus/test";
import { reconcileWorkspaceMachineCatalog } from "@ryco/client-runtime/state/workspace";
import { EnvironmentId } from "@ryco/contracts";

import {
  needsVerificationEnvironmentIds,
  resolveAuthoritativeNativeNodeTrust,
  workspaceEligibleEnvironmentIds,
} from "./nativeNodeEligibilityModel";

describe("authoritative native node eligibility", () => {
  it("awaits durable classification per node and never promotes unknown evidence", async () => {
    const result = await resolveAuthoritativeNativeNodeTrust({
      scope: { hubOrigin: "https://hub.example", accountId: "account" },
      targets: [
        { environmentId: "env-a", nodeId: "node-a" },
        { environmentId: "env-b", nodeId: "node-b" },
        { environmentId: "env-c", nodeId: "node-c" },
      ],
      classify: async ({ nodeId }) => {
        if (nodeId === "node-a") return { class: "latched" };
        if (nodeId === "node-b") return { class: "legacy-eligible", branch: "a" };
        throw new Error("secure store unavailable");
      },
    });
    expect(Object.fromEntries(result)).toEqual({
      "env-a": "verified",
      "env-b": "unverified",
      "env-c": "unknown",
    });
    expect([...workspaceEligibleEnvironmentIds(result)]).toEqual(["env-a"]);
    expect([...needsVerificationEnvironmentIds(result)]).toEqual(["env-b", "env-c"]);
  });

  it("locks only the environment with an identity conflict", async () => {
    const result = await resolveAuthoritativeNativeNodeTrust({
      scope: { hubOrigin: "https://hub.example", accountId: "account" },
      targets: [
        { environmentId: "env-a", nodeId: "node-a" },
        { environmentId: "env-b", nodeId: "node-b" },
      ],
      classify: async () => ({ class: "latched" }),
      identityConflictEnvironmentIds: new Set(["env-b"]),
    });
    expect(result.get("env-a")).toBe("verified");
    expect(result.get("env-b")).toBe("identity-conflict");
    expect([...workspaceEligibleEnvironmentIds(result)]).toEqual(["env-a"]);
  });

  it("makes fresh nodes account-trusted and selectable once enrollment is ready", async () => {
    const result = await resolveAuthoritativeNativeNodeTrust({
      scope: { hubOrigin: "https://hub.example", accountId: "account" },
      targets: [{ environmentId: "env-a", nodeId: "node-a" }],
      classify: async () => ({ class: "legacy-eligible", branch: "a" }),
      accountEnrollmentReady: true,
    });
    expect(result.get("env-a")).toBe("account-trusted");
    expect([...workspaceEligibleEnvironmentIds(result)]).toEqual(["env-a"]);
    expect([...needsVerificationEnvironmentIds(result)]).toEqual(["env-a"]);
  });

  it("keeps revocation, presence, role and trust as independent gates", () => {
    const base = {
      label: "Node",
      clientTier: "native" as const,
      requiresNativeVerification: true,
      lastSeenAt: null,
      observedAt: 1,
    };
    const catalog = reconcileWorkspaceMachineCatalog([
      {
        ...base,
        environmentId: EnvironmentId.make("verified-operator"),
        nativeTrust: "verified",
        effectiveRole: "operator",
        online: true,
      },
      {
        ...base,
        environmentId: EnvironmentId.make("account-operator"),
        nativeTrust: "account-trusted",
        effectiveRole: "operator",
        online: true,
      },
      {
        ...base,
        environmentId: EnvironmentId.make("offline"),
        nativeTrust: "verified",
        effectiveRole: "operator",
        online: false,
      },
      {
        ...base,
        environmentId: EnvironmentId.make("viewer"),
        nativeTrust: "verified",
        effectiveRole: "viewer",
        online: true,
      },
      {
        ...base,
        environmentId: EnvironmentId.make("unknown"),
        nativeTrust: "unknown",
        effectiveRole: "operator",
        online: true,
      },
      {
        ...base,
        environmentId: EnvironmentId.make("revoked"),
        nativeTrust: "verified",
        effectiveRole: "operator",
        online: true,
        revokedAt: 1,
      },
    ]);
    const byId = new Map(catalog.map((entry) => [entry.environmentId, entry]));
    expect(byId.get("verified-operator" as never)?.canMutate).toBe(true);
    expect(byId.get("account-operator" as never)?.canMutate).toBe(true);
    expect(byId.get("offline" as never)?.accessReasons).toContain("offline");
    expect(byId.get("viewer" as never)?.accessReasons).toContain("viewer");
    expect(byId.get("unknown" as never)?.accessReasons).toContain("trust-unknown");
    expect(byId.get("revoked" as never)?.accessReasons).toContain("revoked");
  });
});
