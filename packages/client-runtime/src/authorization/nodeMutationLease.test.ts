import { EnvironmentId } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createNodeMutationLeaseAuthority,
  deriveNodeMutationLease,
  nodeMutationLeaseIsCurrent,
} from "./nodeMutationLease.ts";

const first = EnvironmentId.make("environment-first");
const second = EnvironmentId.make("environment-second");
const ready = {
  environmentId: first,
  selectionGeneration: 1,
  snapshotGeneration: 1,
  effectiveRole: "owner" as const,
  directoryReady: true,
  relayReady: true,
  shellReady: true,
};

describe("node mutation lease", () => {
  it("is issued only for a fully current owner shell", () => {
    expect(deriveNodeMutationLease(ready)).toEqual({
      ...ready,
      directoryReady: true,
      relayReady: true,
      shellReady: true,
    });
    for (const unavailable of [
      { ...ready, effectiveRole: "operator" as const },
      { ...ready, directoryReady: false },
      { ...ready, relayReady: false },
      { ...ready, shellReady: false },
      { ...ready, environmentId: null },
    ]) {
      expect(deriveNodeMutationLease(unavailable)).toBeNull();
    }
  });

  it("rejects a different environment and every stale generation", () => {
    const lease = deriveNodeMutationLease(ready)!;
    expect(nodeMutationLeaseIsCurrent(lease, first, ready)).toBe(true);
    expect(nodeMutationLeaseIsCurrent(lease, second, { ...ready, environmentId: second })).toBe(
      false,
    );
    expect(nodeMutationLeaseIsCurrent(lease, first, { ...ready, selectionGeneration: 2 })).toBe(
      false,
    );
    expect(nodeMutationLeaseIsCurrent(lease, first, { ...ready, snapshotGeneration: 2 })).toBe(
      false,
    );
  });

  it("invalidates synchronously on selection, role, directory, relay, shell, or snapshot change", () => {
    const authority = createNodeMutationLeaseAuthority();
    const publish = (overrides = {}) =>
      authority.update({
        environmentId: first,
        snapshotGeneration: 1,
        effectiveRole: "owner",
        directoryReady: true,
        relayReady: true,
        shellReady: true,
        ...overrides,
      });
    publish();
    const lease = authority.lease(first)!;
    expect(authority.validate(lease, first)).toBe(true);
    for (const change of [
      { environmentId: second },
      { effectiveRole: "viewer" as const },
      { directoryReady: false },
      { relayReady: false },
      { shellReady: false },
      { snapshotGeneration: 2 },
    ]) {
      publish(change);
      expect(authority.validate(lease, first)).toBe(false);
      publish();
    }
  });
});
