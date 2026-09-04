import type { RelayE2eeEnrollmentRevokedFrame } from "@ryco/contracts/relay";
import type { E2eeAccountGrantAuthoritySnapshot } from "@ryco/shared/relayE2eeHandshake";
import { describe, expect, it } from "vite-plus/test";

import { makeNodeE2eeSessionDirectory } from "./NodeE2eeSessionDirectory.ts";

const authority: E2eeAccountGrantAuthoritySnapshot = {
  trustSource: "account-enrolled",
  hubOrigin: "https://hub.example",
  accountId: "account-secret-correlation-canary",
  enrollmentId: `enr_${"E".repeat(22)}`,
  enrollmentRevision: 2,
  accountAuthEpoch: 3,
  deviceAuthEpoch: 4,
  clientIdentityFingerprint: new Uint8Array(32).fill(7),
  maximumRole: "operator",
  capabilitySet: ["ryco.rpc"],
};

const revocation = (
  enrollmentRevision: number,
  deviceAuthEpoch: number,
): RelayE2eeEnrollmentRevokedFrame =>
  ({
    type: "e2ee.enrollment-revoked",
    protocolMajor: 1,
    protocolMinor: 3,
    enrollmentId: authority.enrollmentId,
    enrollmentRevision,
    accountAuthEpoch: 3,
    deviceAuthEpoch,
  }) as unknown as RelayE2eeEnrollmentRevokedFrame;

describe("NodeE2eeSessionDirectory account revocation", () => {
  it("terminates matching stale account leases without exposing their account metadata", async () => {
    const directory = makeNodeE2eeSessionDirectory();
    let terminations = 0;
    directory.register({
      tier: "native",
      suite: 2,
      establishedAt: 1,
      verificationCode: undefined,
      accountGrantAuthority: authority,
      terminate: () => {
        terminations += 1;
      },
    });
    directory.register({
      tier: "native",
      suite: 1,
      establishedAt: 2,
      verificationCode: undefined,
    });

    expect(JSON.stringify(directory.list())).not.toContain(authority.accountId);
    expect(await directory.revokeEnrollment(revocation(2, 3))).toBe(1);
    expect(terminations).toBe(1);
    expect(directory.list()).toHaveLength(1);
    expect(directory.list()[0]).toMatchObject({ suite: 1 });
  });

  it("treats a newer account epoch as dominant over enrollment revision", async () => {
    const directory = makeNodeE2eeSessionDirectory();
    let terminated = 0;
    directory.register({
      tier: "native",
      suite: 2,
      establishedAt: 1,
      accountGrantAuthority: {
        ...authority,
        enrollmentRevision: 9,
        accountAuthEpoch: 2,
      },
      terminate: () => {
        terminated += 1;
      },
    });
    expect(await directory.revokeEnrollment(revocation(2, 1))).toBe(1);
    expect(terminated).toBe(1);
  });
});
