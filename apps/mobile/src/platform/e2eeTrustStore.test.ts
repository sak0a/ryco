import type { NodeE2eeCapabilityVerification } from "@ryco/shared/relayE2eeCapabilityVerify";
import type { NodeE2eeCapabilityStatement } from "@ryco/shared/relayE2eeTranscripts";
import { deriveE2eeSafetyNumber } from "@ryco/shared/relayE2eeVerificationDisplay";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0xd,
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-sqlite/kv-store", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

import { E2EE_TRUST_DOCUMENT_KEY, type E2eeSecureStore } from "./e2eeSecureStore";
import {
  classifyE2eeTrustSnapshot,
  isE2eeVerifiedPinRecord,
  resolveE2eeTrustStatementOutcome,
  resolveE2eeUnexpectedNodeSituation,
  type E2eeTrustSelection,
} from "./e2eeTrustModel";
import {
  makeMobileE2eeTrustStore,
  MobileE2eeTrustStoreError,
  mintE2eeOwnerLegacyConsentDecision,
  mintE2eeOwnerStrictLegacyDecision,
  mintE2eeOwnerVerificationDecision,
  type E2eeOwnerVerificationDecision,
  type MobileE2eeTrustStore,
} from "./e2eeTrustStore";

const HUB = "https://hub.example.com";
const OTHER_HUB = "https://other.example.com";
const ACCOUNT = "acct_0123456789";
const OTHER_ACCOUNT = "acct_9876543210";

function bytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.byteLength; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

// Deterministic §16.1-style material, shared with the §13.4 suite. TEST ONLY.
const NODE_PUBLIC_KEY = bytes("03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8");
const ROTATED_NODE_FINGERPRINT = "SHA256:rotated-node-key";
const CLIENT_PUBLIC_KEY = bytes(
  "047a593180860c4037c83c12749845c8ee1424dd297fadcb895e358255d2c7d2" +
    "b2a8ca25580f2626fe579062ff1b99ff91c24a0da06fb32b5be20148c9249f5650",
);

function safetyNumber(hubOrigin: string, accountId: string): string {
  return deriveE2eeSafetyNumber({
    nodeIdentityPublicKey: NODE_PUBLIC_KEY,
    clientIdentityPublicKey: CLIENT_PUBLIC_KEY,
    hubOrigin,
    accountId,
  }).display;
}

interface Harness {
  readonly entries: Map<string, string>;
  readonly log: string[];
  readonly failures: { get: boolean; set: boolean; remove: boolean };
  readonly secureStore: E2eeSecureStore;
  readonly create: () => MobileE2eeTrustStore;
}

function harness(seed?: string): Harness {
  const entries = new Map<string, string>();
  if (seed !== undefined) entries.set(E2EE_TRUST_DOCUMENT_KEY, seed);
  const log: string[] = [];
  const failures = { get: false, set: false, remove: false };
  let handle = 0;
  const secureStore: E2eeSecureStore = {
    get: async (key) => {
      log.push(`get:${key}`);
      if (failures.get) throw new Error("keychain unavailable");
      return entries.get(key) ?? null;
    },
    set: async (key, value) => {
      log.push(`set:${key}`);
      if (failures.set) throw new Error("keychain unavailable");
      entries.set(key, value);
    },
    remove: async (key) => {
      log.push(`remove:${key}`);
      if (failures.remove) throw new Error("keychain unavailable");
      entries.delete(key);
    },
    destroy: async () => {
      log.push("destroy");
      entries.clear();
    },
  };
  return {
    entries,
    log,
    failures,
    secureStore,
    create: () =>
      makeMobileE2eeTrustStore({
        store: secureStore,
        randomBytes: (length) => {
          handle += 1;
          return new Uint8Array(length).fill(handle);
        },
      }),
  };
}

function decisionFor(
  index: { hubOrigin: string; accountId: string; localNodeHandle: string },
  overrides: {
    readonly continuityId?: string;
    readonly acceptedPolicyGeneration?: number;
    readonly decidedAt?: number;
  } = {},
): E2eeOwnerVerificationDecision {
  return mintE2eeOwnerVerificationDecision({
    index,
    nodeIdentityPublicKey: NODE_PUBLIC_KEY,
    clientIdentityPublicKey: CLIENT_PUBLIC_KEY,
    comparedSafetyNumber: safetyNumber(index.hubOrigin, index.accountId),
    continuityId: overrides.continuityId ?? "continuity-1",
    acceptedPolicyGeneration: overrides.acceptedPolicyGeneration ?? 4,
    decidedAt: overrides.decidedAt ?? 1_000,
  });
}

async function pairAndVerify(
  store: MobileE2eeTrustStore,
  input: {
    readonly hubOrigin?: string;
    readonly accountId?: string;
    readonly nodeId?: string;
    readonly environmentId?: string;
    readonly continuityId?: string;
    readonly acceptedPolicyGeneration?: number;
  } = {},
) {
  const index = await store.beginPairing({
    hubOrigin: input.hubOrigin ?? HUB,
    accountId: input.accountId ?? ACCOUNT,
    ...(input.nodeId === undefined ? {} : { nodeId: input.nodeId }),
    ...(input.environmentId === undefined ? {} : { environmentId: input.environmentId }),
  });
  await store.promote(
    decisionFor(index, {
      ...(input.continuityId === undefined ? {} : { continuityId: input.continuityId }),
      ...(input.acceptedPolicyGeneration === undefined
        ? {}
        : { acceptedPolicyGeneration: input.acceptedPolicyGeneration }),
    }),
  );
  return index;
}

function handleSelection(index: {
  hubOrigin: string;
  accountId: string;
  localNodeHandle: string;
}): E2eeTrustSelection {
  return { kind: "handle", ...index };
}

let context: Harness;

beforeEach(() => {
  context = harness();
});

describe("hydration and the cold start", () => {
  it("classifies a latched selection as unexpected before the load completes", async () => {
    // THE TRAP. §4.4: "a client … MUST NOT treat unobtainable evidence as an
    // unset latch or an unset marker." A store that answered from an empty
    // in-memory default would put the first channel after every app restart on
    // the legacy branch for a node the owner latched.
    const seeded = context.create();
    await seeded.hydrate();
    const index = await pairAndVerify(seeded);

    const cold = context.create();
    const before = await cold.classify(handleSelection(index));

    expect(before).toEqual({ class: "unexpected", clause: "unobtainable" });
    expect(cold.marker(HUB)).toEqual({ kind: "unobtainable" });
    expect(cold.strictLegacyPolicy(HUB)).toEqual({ kind: "unobtainable" });
    expect(cold.resolve(handleSelection(index))).toBeNull();

    await cold.hydrate();
    expect(await cold.classify(handleSelection(index))).toEqual({ class: "latched" });
  });

  it("never lets a latched selection reach legacy-eligible on a cold start", async () => {
    const seeded = context.create();
    await seeded.hydrate();
    const index = await pairAndVerify(seeded, { nodeId: "node-1" });

    const cold = context.create();
    const selections: readonly E2eeTrustSelection[] = [
      handleSelection(index),
      { kind: "node-id-hint", hubOrigin: HUB, accountId: ACCOUNT, nodeId: "node-1" },
      { kind: "handle", hubOrigin: HUB, accountId: OTHER_ACCOUNT, localNodeHandle: "invented" },
    ];

    for (const selection of selections) {
      expect((await cold.classify(selection)).class).toBe("unexpected");
    }
  });

  it("treats a store that will not answer as unobtainable, and retries the load", async () => {
    const seeded = context.create();
    await seeded.hydrate();
    const index = await pairAndVerify(seeded);

    const store = context.create();
    context.failures.get = true;
    await store.hydrate();
    expect(await store.classify(handleSelection(index))).toEqual({
      class: "unexpected",
      clause: "unobtainable",
    });

    context.failures.get = false;
    await store.hydrate();
    expect(await store.classify(handleSelection(index))).toEqual({ class: "latched" });
  });

  it("treats an unparseable document as unobtainable, not as a fresh install", async () => {
    const store = harness("{not json").create();
    await store.hydrate();

    expect(
      await store.classify({
        kind: "handle",
        hubOrigin: HUB,
        accountId: ACCOUNT,
        localNodeHandle: "any",
      }),
    ).toEqual({ class: "unexpected", clause: "unobtainable" });
  });

  it("refuses a document whose verified record is missing a promoted field", async () => {
    // §13.1 makes every promoted field the product of the owner's decision. A
    // record claiming `verified` without them describes no decision, and quietly
    // demoting it to `unverified` would invent one.
    const store = harness(
      JSON.stringify({
        version: 1,
        records: [
          {
            hubOrigin: HUB,
            accountId: ACCOUNT,
            localNodeHandle: "h",
            state: "verified",
            nodeIdHints: [],
            verifiedFingerprint: "SHA256:aaaa",
          },
        ],
      }),
    ).create();
    await store.hydrate();

    expect(
      await store.classify({
        kind: "handle",
        hubOrigin: HUB,
        accountId: ACCOUNT,
        localNodeHandle: "h",
      }),
    ).toEqual({ class: "unexpected", clause: "unobtainable" });
  });
});

describe("§13.1 marker reconciliation", () => {
  it("runs before the classification it would change, on a document that predates it", async () => {
    // The migration case §13.1 names: pins written by a build that had no marker.
    // Reconciliation has to run FIRST, or a selection under a second account scope
    // classifies "fresh" and takes the legacy branch — exactly the account-remint
    // hole the marker exists to close.
    const pinsOnly = harness(
      JSON.stringify({
        version: 1,
        records: [
          {
            hubOrigin: HUB,
            accountId: ACCOUNT,
            localNodeHandle: "h",
            state: "verified",
            nodeIdHints: [],
            verifiedFingerprint: "SHA256:aaaa",
            recordedContinuityId: "continuity-1",
            acceptedPolicyGeneration: 4,
            approvedClientFingerprint: "SHA256:cccc",
            approvedAt: 1,
            latchedAt: 1,
          },
        ],
      }),
    );
    const store = pinsOnly.create();
    await store.hydrate();
    expect(store.marker(HUB)).toEqual({ kind: "unset" });
    pinsOnly.log.length = 0;

    const classification = await store.classify({
      kind: "handle",
      hubOrigin: HUB,
      accountId: OTHER_ACCOUNT,
      localNodeHandle: "second-account",
    });

    expect(classification).toEqual({ class: "unexpected", clause: "iii" });
    // The reconciling write is the only store call the classification made, and
    // it landed before the verdict was produced.
    expect(pinsOnly.log).toEqual([`set:${E2EE_TRUST_DOCUMENT_KEY}`]);
    expect(store.marker(HUB)).toEqual({ kind: "set" });
    expect(pinsOnly.entries.get(E2EE_TRUST_DOCUMENT_KEY)).toContain(HUB);
  });

  it("only ever sets, and only where a verified pin exists", async () => {
    const store = context.create();
    await store.hydrate();
    await store.beginPairing({ hubOrigin: HUB, accountId: ACCOUNT });
    context.log.length = 0;

    await store.reconcileMarker(HUB);

    expect(store.marker(HUB)).toEqual({ kind: "unset" });
    expect(context.log).toEqual([]);
  });

  it("writes nothing when the marker is already set", async () => {
    const store = context.create();
    await store.hydrate();
    const index = await pairAndVerify(store);
    context.log.length = 0;

    await store.classify(handleSelection(index));
    await store.classify(handleSelection(index));

    expect(context.log).toEqual([]);
  });
});

describe("§13.2 step 5 promotion", () => {
  it("is the only path to a verified record, and sets the pin and the marker together", async () => {
    const store = context.create();
    await store.hydrate();
    const index = await store.beginPairing({ hubOrigin: HUB, accountId: ACCOUNT });

    const pairing = store.resolve(handleSelection(index));
    expect(pairing?.state).toBe("unverified");
    // §13.1: between step 2 and step 5 the record "holds **no** verified
    // fingerprint, **no** recorded continuity id, no accepted policy generation,
    // no latch, and no approval state". There is no field to hold them in.
    expect(Object.keys(pairing ?? {}).toSorted()).toEqual([
      "environmentId",
      "index",
      "legacyConsent",
      "nodeIdHints",
      "state",
    ]);
    expect(store.marker(HUB)).toEqual({ kind: "unset" });

    await store.promote(decisionFor(index));

    const promoted = store.resolve(handleSelection(index));
    expect(promoted !== null && isE2eeVerifiedPinRecord(promoted)).toBe(true);
    expect(store.marker(HUB)).toEqual({ kind: "set" });
    expect(await store.classify(handleSelection(index))).toEqual({ class: "latched" });
  });

  it("leaves NEITHER the pin nor the marker applied when the write crashes", async () => {
    const store = context.create();
    await store.hydrate();
    const index = await store.beginPairing({ hubOrigin: HUB, accountId: ACCOUNT });
    const durableBefore = context.entries.get(E2EE_TRUST_DOCUMENT_KEY);

    context.failures.set = true;
    await expect(store.promote(decisionFor(index))).rejects.toBeInstanceOf(
      MobileE2eeTrustStoreError,
    );
    context.failures.set = false;

    expect(store.resolve(handleSelection(index))?.state).toBe("unverified");
    expect(store.marker(HUB)).toEqual({ kind: "unset" });
    expect(context.entries.get(E2EE_TRUST_DOCUMENT_KEY)).toBe(durableBefore);

    // And the reload sees the same thing: one document, one write, no interval in
    // which the pin was verified and the marker was not.
    const reloaded = context.create();
    await reloaded.hydrate();
    expect(reloaded.resolve(handleSelection(index))?.state).toBe("unverified");
    expect(reloaded.marker(HUB)).toEqual({ kind: "unset" });
  });

  it("refuses a decision whose compared safety number is not the one this device derives", () => {
    // The decision cannot be built from statement material: the §13.4 value is
    // over BOTH identity keys and the namespace, and a statement carries only the
    // node's key.
    expect(() =>
      mintE2eeOwnerVerificationDecision({
        index: { hubOrigin: HUB, accountId: ACCOUNT, localNodeHandle: "h" },
        nodeIdentityPublicKey: NODE_PUBLIC_KEY,
        clientIdentityPublicKey: CLIENT_PUBLIC_KEY,
        comparedSafetyNumber: safetyNumber(HUB, OTHER_ACCOUNT),
        continuityId: "continuity-1",
        acceptedPolicyGeneration: 4,
        decidedAt: 1,
      }),
    ).toThrow(MobileE2eeTrustStoreError);
  });

  it("does not make strict mode a silent consequence of the first verified pin", async () => {
    const store = context.create();
    await store.hydrate();

    await pairAndVerify(store);

    expect(store.strictLegacyPolicy(HUB)).toEqual({ kind: "permitted" });
  });
});

describe("§12.1 latch set condition", () => {
  it("is set by a completed ceremony and by authenticating to an already-verified pin", async () => {
    const store = context.create();
    await store.hydrate();
    const index = await pairAndVerify(store);
    // Drop the latch the ceremony set, so the second condition is observable on
    // its own: a channel that authenticates a statement to this pin re-arms it.
    await store.clearSelection(index);
    const reintroduced = await pairAndVerify(store, { continuityId: "continuity-1" });

    await store.recordAuthenticatedStatement({
      index: reintroduced,
      anchor: "pin-unchanged",
      identityFingerprint: "SHA256:aaaa",
      policyGeneration: 4,
      observedAt: 2_000,
    });

    const record = store.resolve(handleSelection(reintroduced));
    expect(record !== null && isE2eeVerifiedPinRecord(record) && record.latch.kind).toBe("set");
  });

  it("is not set by validating a self-signed first-contact statement", async () => {
    const store = context.create();
    await store.hydrate();
    const index = await store.beginPairing({ hubOrigin: HUB, accountId: ACCOUNT });

    // §12.1: "Merely validating a self-signed first-contact statement MUST NOT
    // set the latch, exactly as it MUST NOT set a trusted pin." An unverified
    // record has no anchor a statement could have authenticated against, so the
    // call has no record to write into.
    await expect(
      store.recordAuthenticatedStatement({
        index,
        anchor: "pin-unchanged",
        identityFingerprint: "SHA256:aaaa",
        policyGeneration: 4,
        observedAt: 2_000,
      }),
    ).rejects.toBeInstanceOf(MobileE2eeTrustStoreError);
    expect(store.resolve(handleSelection(index))?.state).toBe("unverified");
  });

  it("is not set by a matching continuity id alone", async () => {
    const store = context.create();
    await store.hydrate();
    const pairing = await store.beginPairing({ hubOrigin: HUB, accountId: ACCOUNT });
    context.log.length = 0;

    // The id a first-contact statement carries, offered for the selection the
    // owner is still pairing. §12.1: "A matching continuity id (§7.5) never
    // satisfies this condition."
    const tightened = await store.tightenWithContinuityId({
      hubOrigin: HUB,
      accountId: ACCOUNT,
      continuityId: "continuity-1",
      initial: { class: "unexpected", clause: "i", record: "unverified" },
    });

    // It is a read: nothing was written, no record was promoted, and no class
    // moved to latched.
    expect(context.log).toEqual([]);
    expect(tightened).toEqual({ class: "unexpected", clause: "i", record: "unverified" });
    expect(store.resolve(handleSelection(pairing))?.state).toBe("unverified");
  });
});

describe("§13.3 rotation and re-verification", () => {
  it("updates the pin silently, carrying the latch, the generation and the approval", async () => {
    const store = context.create();
    await store.hydrate();
    const index = await pairAndVerify(store, { acceptedPolicyGeneration: 4 });
    const before = store.resolve(handleSelection(index));

    await store.recordAuthenticatedStatement({
      index,
      anchor: "pin-updated",
      identityFingerprint: ROTATED_NODE_FINGERPRINT,
      policyGeneration: 6,
      observedAt: 3_000,
    });

    const after = store.resolve(handleSelection(index));
    expect(after !== null && isE2eeVerifiedPinRecord(after)).toBe(true);
    if (after === null || !isE2eeVerifiedPinRecord(after)) throw new Error("unreachable");
    if (before === null || !isE2eeVerifiedPinRecord(before)) throw new Error("unreachable");
    expect(after.verifiedFingerprint).toBe(ROTATED_NODE_FINGERPRINT);
    expect(after.latch).toEqual(before.latch);
    expect(after.approval).toEqual(before.approval);
    expect(after.recordedContinuityId).toBe(before.recordedContinuityId);
    expect(after.acceptedPolicyGeneration).toBe(6);
    // The channel stays latched, and no surface is raised: §13.3's whole point is
    // that a legitimate rotation "MUST NOT surface a re-verification prompt".
    expect(await store.classify(handleSelection(index))).toEqual({ class: "latched" });
    expect(
      resolveE2eeUnexpectedNodeSituation({ class: "latched" }, { kind: "first-contact-statement" }),
    ).toBeNull();
  });

  it("never lowers the remembered policy generation", async () => {
    const store = context.create();
    await store.hydrate();
    const index = await pairAndVerify(store, { acceptedPolicyGeneration: 9 });

    await store.recordAuthenticatedStatement({
      index,
      anchor: "pin-unchanged",
      identityFingerprint: "SHA256:aaaa",
      policyGeneration: 2,
      observedAt: 3_000,
    });

    const record = store.resolve(handleSelection(index));
    expect(
      record !== null && isE2eeVerifiedPinRecord(record) && record.acceptedPolicyGeneration,
    ).toBe(9);
  });

  it("persists the accepted policy generation across a restart", async () => {
    const store = context.create();
    await store.hydrate();
    const index = await pairAndVerify(store, { acceptedPolicyGeneration: 7 });

    // A round trip through the durable document, not an in-memory field: §5.7's
    // rollback resistance is worth nothing if it dies with the process.
    const restarted = context.create();
    await restarted.hydrate();

    const record = restarted.resolve(handleSelection(index));
    expect(
      record !== null && isE2eeVerifiedPinRecord(record) && record.acceptedPolicyGeneration,
    ).toBe(7);
  });

  it("updates no pin on a chain failure, and neither prompts nor re-verifies on a regression", async () => {
    const store = context.create();
    await store.hydrate();
    const index = await pairAndVerify(store, { acceptedPolicyGeneration: 5 });
    const before = store.resolve(handleSelection(index));
    context.log.length = 0;

    // What the §4.4 mode machine will do with a §5.2 verdict. Only the two
    // anchors that authenticated to the pin have a store mutator to reach; the
    // §13.3 identity event and the §5.7 regression have none, which is the point.
    const apply = async (verification: NodeE2eeCapabilityVerification) => {
      const outcome = resolveE2eeTrustStatementOutcome(verification);
      if (outcome.kind === "pin-authenticated" || outcome.kind === "pin-rotated") {
        await store.recordAuthenticatedStatement({
          index,
          anchor: outcome.kind === "pin-rotated" ? "pin-updated" : "pin-unchanged",
          identityFingerprint: ROTATED_NODE_FINGERPRINT,
          policyGeneration: 1,
          observedAt: 4_000,
        });
      }
      return outcome;
    };

    // §13.3: a chain failure is channel-fatal and surfaces the re-verification
    // UI, and "requires a fresh §13.2 ceremony before any application payload
    // flows to the new identity" — it does not re-pin.
    expect(
      await apply({
        kind: "identity-event",
        event: { reason: "continuity_chain", failure: "pin_not_reached" },
        statement: {} as NodeE2eeCapabilityStatement,
      }),
    ).toEqual({
      kind: "re-verification-required",
      event: { reason: "continuity_chain", failure: "pin_not_reached" },
    });

    // §13.3: "A **policy-generation** regression is deliberately _not_ on this
    // list … because a Hub can replay a genuine older statement on demand."
    expect(await apply({ kind: "invalid", reason: "policy_generation_regressed" })).toEqual({
      kind: "diagnostic-only",
      diagnostic: "e2ee_policy_generation_regressed",
    });

    expect(context.log).toEqual([]);
    expect(store.resolve(handleSelection(index))).toEqual(before);
  });

  it("clears the whole selection and the marker on the owner-initiated re-pair", async () => {
    const store = context.create();
    await store.hydrate();
    const first = await pairAndVerify(store);
    const second = await pairAndVerify(store, { accountId: OTHER_ACCOUNT });

    await store.clearSelection(first);
    // §13.3: the marker stays set "while any other verified pin remains".
    expect(store.marker(HUB)).toEqual({ kind: "set" });
    expect(store.resolve(handleSelection(first))).toBeNull();

    await store.clearSelection(second);
    expect(store.marker(HUB)).toEqual({ kind: "unset" });
  });
});

describe("§12.1.1 owner legacy consent", () => {
  it("is never recorded by a repeated classification, a retry, or a timeout", async () => {
    const store = context.create();
    await store.hydrate();
    const index = await store.beginPairing({ hubOrigin: HUB, accountId: ACCOUNT });
    context.log.length = 0;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await store.classify(handleSelection(index))).toEqual({
        class: "unexpected",
        clause: "i",
        record: "unverified",
      });
    }

    expect(context.log).toEqual([]);
    expect(store.resolve(handleSelection(index))?.legacyConsent).toEqual({ kind: "absent" });
  });

  it("is refused for a latched pin", async () => {
    const store = context.create();
    await store.hydrate();
    const index = await pairAndVerify(store);

    await expect(
      store.recordLegacyConsent(mintE2eeOwnerLegacyConsentDecision({ index, decidedAt: 9 })),
    ).rejects.toMatchObject({ code: "trust_store_selection_latched" });
  });

  it("is durable and applies to one selection only", async () => {
    const store = context.create();
    await store.hydrate();
    const consented = await store.beginPairing({ hubOrigin: HUB, accountId: ACCOUNT });
    const other = await store.beginPairing({ hubOrigin: HUB, accountId: ACCOUNT });

    await store.recordLegacyConsent(
      mintE2eeOwnerLegacyConsentDecision({ index: consented, decidedAt: 9 }),
    );

    const restarted = context.create();
    await restarted.hydrate();
    expect(await restarted.classify(handleSelection(consented))).toEqual({
      class: "legacy-eligible",
      branch: "b",
    });
    expect(await restarted.classify(handleSelection(other))).toEqual({
      class: "unexpected",
      clause: "i",
      record: "unverified",
    });
  });
});

describe("§12.1.1 strict legacy policy", () => {
  it("is recorded and evaluated under the Hub origin alone", async () => {
    const store = context.create();
    await store.hydrate();
    await pairAndVerify(store, { accountId: OTHER_ACCOUNT });

    await store.setStrictLegacyPolicy(
      mintE2eeOwnerStrictLegacyDecision({ hubOrigin: HUB, policy: "forbid", decidedAt: 11 }),
    );

    expect(store.strictLegacyPolicy(HUB)).toEqual({ kind: "forbidden", recordedAt: 11 });
    expect(store.strictLegacyPolicy(OTHER_HUB)).toEqual({ kind: "permitted" });

    // It survives a restart, and it is not keyed on an account scope: there is no
    // account-scoped read to lose it to.
    const restarted = context.create();
    await restarted.hydrate();
    expect(restarted.strictLegacyPolicy(HUB)).toEqual({ kind: "forbidden", recordedAt: 11 });

    await restarted.setStrictLegacyPolicy(
      mintE2eeOwnerStrictLegacyDecision({ hubOrigin: HUB, policy: "permit", decidedAt: 12 }),
    );
    expect(restarted.strictLegacyPolicy(HUB)).toEqual({ kind: "permitted" });
  });
});

describe("§13.2.1 substituted-node surfaces", () => {
  it("presents a first-contact statement under an account holding a verified pin as situation 2", async () => {
    const store = context.create();
    await store.hydrate();
    await pairAndVerify(store);

    const classification = await store.classify({
      kind: "handle",
      hubOrigin: HUB,
      accountId: ACCOUNT,
      localNodeHandle: "presented-by-the-hub",
    });

    expect(classification).toEqual({ class: "unexpected", clause: "ii" });
    expect(
      resolveE2eeUnexpectedNodeSituation(classification, { kind: "first-contact-statement" }),
    ).toBe(2);
  });

  it("presents an unseen account scope on a verified Hub origin as situation 3", async () => {
    const store = context.create();
    await store.hydrate();
    await pairAndVerify(store);

    const classification = await store.classify({
      kind: "handle",
      hubOrigin: HUB,
      accountId: OTHER_ACCOUNT,
      localNodeHandle: "second-account",
    });

    expect(classification).toEqual({ class: "unexpected", clause: "iii" });
    expect(
      resolveE2eeUnexpectedNodeSituation(classification, { kind: "first-contact-statement" }),
    ).toBe(3);
  });
});

describe("§13.1.1 durable trust loss", () => {
  it("reconstructs nothing from anything the Hub supplies", async () => {
    const seeded = context.create();
    await seeded.hydrate();
    const index = await pairAndVerify(seeded, {
      nodeId: "node-1",
      continuityId: "continuity-1",
      environmentId: "env-a",
    });

    // §6.3's purge: the device-only namespace is gone. Everything §13.1 made
    // durable went with it.
    await context.secureStore.destroy();
    const store = context.create();
    await store.hydrate();
    await store.reconcileMarker(HUB);

    expect(store.marker(HUB)).toEqual({ kind: "unset" });
    expect(store.resolve(handleSelection(index))).toBeNull();

    const hubSupplied: readonly E2eeTrustSelection[] = [
      handleSelection(index),
      { kind: "node-id-hint", hubOrigin: HUB, accountId: ACCOUNT, nodeId: "node-1" },
      { kind: "handle", hubOrigin: HUB, accountId: OTHER_ACCOUNT, localNodeHandle: "anything" },
    ];
    for (const selection of hubSupplied) {
      // §13.1.1: it "behaves as a fresh install: every selection classifies as
      // genuine first contact" — which is branch (a), and only branch (a).
      expect(await store.classify(selection)).toEqual({ class: "legacy-eligible", branch: "a" });
    }

    // Not even the continuity id it recorded before the loss re-anchors anything.
    expect(
      await store.tightenWithContinuityId({
        hubOrigin: HUB,
        accountId: ACCOUNT,
        continuityId: "continuity-1",
        initial: { class: "legacy-eligible", branch: "a" },
      }),
    ).toEqual({ class: "legacy-eligible", branch: "a" });
  });
});

describe("owner-driven cleanup", () => {
  it("clears every record, latch, consent, marker and policy under a Hub origin", async () => {
    const store = context.create();
    await store.hydrate();
    const kept = await pairAndVerify(store, { hubOrigin: OTHER_HUB });
    const cleared = await pairAndVerify(store);
    const consented = await store.beginPairing({ hubOrigin: HUB, accountId: OTHER_ACCOUNT });
    await store.recordLegacyConsent(
      mintE2eeOwnerLegacyConsentDecision({ index: consented, decidedAt: 3 }),
    );
    await store.setStrictLegacyPolicy(
      mintE2eeOwnerStrictLegacyDecision({ hubOrigin: HUB, policy: "forbid", decidedAt: 4 }),
    );

    await store.forgetHubOrigin(HUB);

    expect(store.resolve(handleSelection(cleared))).toBeNull();
    expect(store.resolve(handleSelection(consented))).toBeNull();
    expect(store.marker(HUB)).toEqual({ kind: "unset" });
    expect(store.strictLegacyPolicy(HUB)).toEqual({ kind: "permitted" });
    // The other Hub origin is untouched.
    expect(store.marker(OTHER_HUB)).toEqual({ kind: "set" });
    expect(await store.classify(handleSelection(kept))).toEqual({ class: "latched" });
  });

  it("clears the records the owner forgot a node by, and the marker they backed", async () => {
    const store = context.create();
    await store.hydrate();
    const forgotten = await pairAndVerify(store, { environmentId: "env-a" });
    const kept = await pairAndVerify(store, { accountId: OTHER_ACCOUNT, environmentId: "env-b" });

    await store.forgetEnvironment("env-a");

    expect(store.resolve(handleSelection(forgotten))).toBeNull();
    expect(store.marker(HUB)).toEqual({ kind: "set" });

    await store.forgetEnvironment("env-b");
    expect(store.resolve(handleSelection(kept))).toBeNull();
    expect(store.marker(HUB)).toEqual({ kind: "unset" });
  });

  it("refuses to discard state it merely could not read", async () => {
    const store = context.create();
    context.failures.get = true;
    await store.hydrate();

    await expect(store.forgetHubOrigin(HUB)).rejects.toMatchObject({
      code: "trust_store_unavailable",
    });
    expect(context.log).not.toContain(`remove:${E2EE_TRUST_DOCUMENT_KEY}`);
  });
});

describe("§13.1 node-id hints", () => {
  it("keeps at most the specified number, oldest first, and authorizes nothing", async () => {
    const store = context.create();
    await store.hydrate();
    const index = await pairAndVerify(store, { nodeId: "node-0" });

    for (let seq = 1; seq <= 10; seq += 1) {
      await store.recordNodeIdHint(index, `node-${seq}`);
    }

    const record = store.resolve(handleSelection(index));
    expect(record?.nodeIdHints).toEqual([
      "node-3",
      "node-4",
      "node-5",
      "node-6",
      "node-7",
      "node-8",
      "node-9",
      "node-10",
    ]);
    // An evicted hint stops resolving, which lands the channel in the unexpected
    // class — §12.1.1's "a Hub that suppresses a hint produces _no_ resolution".
    expect(
      await store.classify({
        kind: "node-id-hint",
        hubOrigin: HUB,
        accountId: ACCOUNT,
        nodeId: "node-0",
      }),
    ).toEqual({ class: "unexpected", clause: "ii" });
  });
});

describe("classification is a pure read of client-anchored state", () => {
  it("produces the same verdict from the snapshot as from the classifier", async () => {
    const store = context.create();
    await store.hydrate();
    const index = await pairAndVerify(store);

    expect(classifyE2eeTrustSnapshot(store.snapshot(handleSelection(index)))).toEqual(
      await store.classify(handleSelection(index)),
    );
  });
});
