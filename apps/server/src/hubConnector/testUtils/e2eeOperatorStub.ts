import { E2EE_SUITE_25519_CHACHAPOLY_SHA256 } from "@ryco/shared/relayE2eeWire";

import type { HubConnectorE2eeOperator } from "../HubConnectorLive.ts";
import type { NodeE2eeAuthorizationAdmin } from "../HubIdentityRuntime.ts";
import type { NodeLocalIntroductionService } from "../../hubIdentity/NodeLocalIntroductionService.ts";
import type { NodeNativeClaimService } from "../../hubIdentity/NodeNativeClaimService.ts";
import type {
  E2eeClientListingView,
  E2eeClientRecordView,
  E2eePolicyView,
} from "../e2eeOperatorContract.ts";

// Test doubles for the E2EE operator surface.
//
// They exist so a test about enrollment routing, connector lifecycle, or CLI
// argument parsing does not have to restate a surface it is not exercising —
// and so a test that DOES exercise it overrides exactly the members it asserts
// on, leaving the rest of the shape honest rather than absent.

export const stubLocalIntroductionService = (
  overrides: Partial<NodeLocalIntroductionService> = {},
): NodeLocalIntroductionService => {
  const unused = async (): Promise<never> => {
    throw new Error("unused");
  };
  return { descriptor: unused, complete: unused, ...overrides };
};

export const stubNativeNodeClaimService = (
  overrides: Partial<NodeNativeClaimService> = {},
): NodeNativeClaimService => {
  const unused = async (): Promise<never> => {
    throw new Error("unused");
  };
  return { prepare: unused, sign: unused, commit: unused, ...overrides };
};

/** A record with every field populated, so a display assertion has something to find. */
export const stubClientRecord = (
  overrides: Partial<E2eeClientRecordView> = {},
): E2eeClientRecordView => ({
  status: "approved",
  hubOrigin: "https://hub.example.test",
  accountId: "acct_stub",
  fingerprint: `SHA256:${"B".repeat(42)}A`,
  maxRole: "operator",
  capabilitySet: ["ryco.rpc"],
  createdAt: 1_000,
  approvedAt: 2_000,
  safetyNumber: "11111 22222 33333 44444 55555",
  displayLabel: "Studio laptop",
  pairingReserved: false,
  ...overrides,
});

export const stubClientListing = (
  overrides: Partial<E2eeClientListingView> = {},
): E2eeClientListingView => ({
  records: [stubClientRecord()],
  pendingGlobalSaturated: false,
  saturatedAccounts: [],
  refusedPairingAttempts: 0,
  ...overrides,
});

export const stubPolicy = (overrides: Partial<E2eePolicyView> = {}): E2eePolicyView => ({
  requireE2EE: false,
  requireApprovedClientE2EE: false,
  effectiveRequireE2EE: false,
  admittedPatterns: ["IK", "NX"],
  suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
  generation: 3,
  ...overrides,
});

/**
 * Every member answers, and every mutation reports zero closures.
 *
 * Zero is the truthful default for a double that carries no channels; a test
 * that asserts §12.6 or §13.6 counts overrides the member it is asserting on.
 */
export const stubE2eeOperator = (
  overrides: Partial<HubConnectorE2eeOperator> = {},
): HubConnectorE2eeOperator => ({
  listClients: async () => stubClientListing(),
  getClient: async () => stubClientRecord(),
  approveClient: async () => ({
    record: stubClientRecord(),
    closedChannels: 0,
    abortedHandshakes: 0,
  }),
  narrowClient: async () => ({
    record: stubClientRecord({ maxRole: "viewer" }),
    closedChannels: 0,
    abortedHandshakes: 0,
  }),
  revokeClient: async () => ({
    record: stubClientRecord({ status: "revoked", revokedAt: 3_000 }),
    closedChannels: 0,
    abortedHandshakes: 0,
  }),
  purgeClient: async () => ({ closedChannels: 0, abortedHandshakes: 0 }),
  openPairingWindow: async () => stubClientListing(),
  closePairingWindow: async () => stubClientListing(),
  clearRefusedPairingAttempts: async () => stubClientListing({ refusedPairingAttempts: 0 }),
  listSessions: () => ({ sessions: [] }),
  readPolicy: () => stubPolicy(),
  previewPolicy: () => ({
    policy: stubPolicy(),
    withdrawal: false,
    changed: false,
    counts: { legacy: 0, nxE2ee: 0, suiteWithdrawn: 0, abortedHandshakes: 0 },
  }),
  applyPolicy: async () => ({
    policy: stubPolicy(),
    withdrawal: false,
    changed: false,
    counts: { legacy: 0, nxE2ee: 0, suiteWithdrawn: 0, abortedHandshakes: 0 },
  }),
  recoverPolicyGeneration: async () => ({
    policy: stubPolicy({ generation: 9 }),
    withdrawal: false,
    changed: true,
    counts: { legacy: 0, nxE2ee: 0, suiteWithdrawn: 0, abortedHandshakes: 0 },
  }),
  readPrekey: async () => ({
    present: true,
    prekeyId: "pk_stub",
    fingerprint: `SHA256:${"C".repeat(42)}A`,
    createdAt: 1_000,
    expiresAt: 2_000,
    validity: "usable",
  }),
  rotatePrekey: async () => ({
    present: true,
    prekeyId: "pk_stub",
    fingerprint: `SHA256:${"C".repeat(42)}A`,
    createdAt: 1_000,
    expiresAt: 2_000,
    validity: "usable",
  }),
  readContinuity: async () => ({
    status: "advertisable",
    continuityId: "nct_stubstubstubstubstu",
    generation: 0,
    chainLength: 0,
  }),
  adoptContinuityId: async (continuityId) => ({ outcome: "adopted", continuityId }),
  remintContinuityId: async () => ({
    outcome: "reminted",
    continuityId: "nct_remintedremintedrem",
  }),
  breakContinuityChain: async () => ({ outcome: "chain_broken" }),
  readFallback: () => ({
    peerLegacy: { occurrences: 0, ringOverflows: 0 },
    advertisementUnavailable: { occurrences: 0, ringOverflows: 0 },
    ring: [],
  }),
  resetFallback: async () => ({
    windowStartedAt: 9_000,
    peerLegacy: { occurrences: 0, ringOverflows: 0 },
    advertisementUnavailable: { occurrences: 0, ringOverflows: 0 },
    ring: [],
  }),
  ...overrides,
});

/**
 * The `HubIdentityRuntimeShape` half, for a runtime double that carries no
 * operator surface.
 *
 * Every mutation throws rather than answering: a double that returned success
 * for a §13.6 withdrawal would assert exactly the thing §13.6 makes the
 * acknowledgement mean, about a record it never committed.
 */
export const stubIdentityE2eeAdmin = (): NodeE2eeAuthorizationAdmin => {
  const unused = async (): Promise<never> => {
    throw new Error("unused");
  };
  return {
    list: unused,
    get: unused,
    approve: unused,
    narrow: unused,
    revoke: unused,
    purge: unused,
    setDisplayLabel: unused,
    openPairingWindow: unused,
    closePairingWindow: unused,
    clearRefusedPairingAttempts: () => undefined,
    sweepExpired: unused,
  };
};
