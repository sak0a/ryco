import { hostedHubStore } from "@ryco/client-runtime/authorization";
import type { RelayE2eeHost } from "@ryco/client-runtime/relay";
import { e2eeKeyFingerprint, formatE2eeKeyFingerprint } from "@ryco/shared/relayE2eeKeys";
import { deriveE2eeSafetyNumber } from "@ryco/shared/relayE2eeVerificationDisplay";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const HUB = "https://hub.example.com";
const ACCOUNT = "acct_0123456789";

function bytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.byteLength; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

const CLIENT_PUBLIC_KEY = bytes(
  "047a593180860c4037c83c12749845c8ee1424dd297fadcb895e358255d2c7d2" +
    "b2a8ca25580f2626fe579062ff1b99ff91c24a0da06fb32b5be20148c9249f5650",
);
const AGREEMENT_PUBLIC_KEY = bytes(
  "0100000000000000000000000000000000000000000000000000000000000000",
);
const AGREEMENT_SECRET_KEY = bytes(
  "0200000000000000000000000000000000000000000000000000000000000000",
);
/** A §7.1-valid Ed25519 node identity key. §16.1-style material, TEST ONLY. */
const NODE_PUBLIC_KEY = bytes("03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8");

/**
 * The custody seams, all of which reach a keychain or the enclave. Each one can
 * be made to fail, because §6.3's "no software fallback and no degraded mode" is
 * only meaningful if the failure path is the one that runs.
 */
const custody = vi.hoisted(() => ({
  prekeyFails: false,
  agreementFails: false,
}));

vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0xd,
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
// The provider's production default reaches `./appLifecycle`, whose two native
// modules are stubbed here so the injection can be exercised off-device.
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => undefined }) },
}));
vi.mock("expo-network", () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
  getNetworkStateAsync: async () => ({ isConnected: true }),
}));
vi.mock("expo-sqlite/kv-store", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
vi.mock("../platform/deviceKey", () => ({
  getMobileDeviceIdentityPublicKey: async () => CLIENT_PUBLIC_KEY,
}));
vi.mock("../platform/e2eeAgreementKey", () => ({
  mobileE2eeAgreementKey: {
    withSecretKey: async (use: (secretKey: Uint8Array) => unknown) => {
      if (custody.agreementFails) throw new Error("no agreement key");
      return use(Uint8Array.from(AGREEMENT_SECRET_KEY));
    },
  },
}));
vi.mock("../platform/e2eeClientPrekey", () => ({
  mobileClientE2eePrekey: {
    ensure: async () => {
      if (custody.prekeyFails) throw new Error("no prekey");
      return {
        hubOrigin: HUB,
        accountId: ACCOUNT,
        identityPublicKey: CLIENT_PUBLIC_KEY,
        agreementPublicKey: AGREEMENT_PUBLIC_KEY,
        transcript: new Uint8Array([1, 2, 3]),
        signature: new Uint8Array([4, 5, 6]),
        createdAt: 0,
        expiresAt: 1,
      };
    },
  },
}));
vi.mock("./runtimeConfig", () => ({
  getMobileHostedConfig: () => ({ hubOrigin: HUB, appUrl: HUB, relyingParty: "hub.example.com" }),
}));

import {
  mintE2eeOwnerVerificationDecision,
  mobileE2eeTrustStore,
} from "../platform/e2eeTrustStore";
import {
  getMobileE2eeSessionState,
  lockMobileE2eeChannelMode,
  resetMobileE2eeSessionForTests,
} from "./e2eeSession";
import {
  disposeMobileRelayE2eeAttempt,
  inspectMobileRelayE2eeAttemptForTests,
  prepareMobileRelayE2eeAttempt,
  resetMobileRelayE2eeAttemptForTests,
  resolveMobileRelayE2eeProvider,
} from "./e2eeAttempt";

function selectNode(nodeId = "node_1"): void {
  hostedHubStore.setState({
    accountStatus: "authenticated",
    account: {
      id: ACCOUNT,
      displayName: "Ada",
      role: "admin",
      createdAt: 0,
      disabledAt: null,
    },
    selectedNode: {
      id: nodeId,
      environmentId: "env_1",
      label: "Studio",
      platformOs: "darwin",
      platformArch: "arm64",
      clientVersion: "1",
      createdAt: 0,
      updatedAt: 0,
      lastAuthenticatedAt: null,
      revokedAt: null,
      revocationReasonCode: null,
      grant: { id: "grant_1", role: "admin" },
      effectiveRole: "admin",
      presence: { online: true, lastHeartbeatAt: null },
    },
  } as never);
}

function signOut(): void {
  hostedHubStore.setState({
    accountStatus: "signed-out",
    account: null,
    selectedNode: null,
  } as never);
}

/** The minimum of `RelayE2eeHost` the fail-closed channel touches. */
function host(): { readonly host: RelayE2eeHost; readonly closes: unknown[] } {
  const closes: unknown[] = [];
  return {
    closes,
    host: {
      limits: {} as never,
      channel: {} as never,
      admit: () => undefined,
      lockMode: () => {
        throw new Error("a channel that resolved nothing must not lock a mode");
      },
      close: (failure) => closes.push(failure),
      now: () => 0,
      setTimeout: () => 0,
      clearTimeout: () => undefined,
    },
  };
}

beforeEach(() => {
  custody.prekeyFails = false;
  custody.agreementFails = false;
  resetMobileRelayE2eeAttemptForTests();
  resetMobileE2eeSessionForTests();
  signOut();
});

describe("native E2EE is on: every hosted channel is built with the §4.4 machine", () => {
  it("supplies a provider once the attempt for the current selection is resolved", async () => {
    selectNode();
    await prepareMobileRelayE2eeAttempt();
    const provider = resolveMobileRelayE2eeProvider();
    expect(typeof provider).toBe("function");
  });

  it("publishes the selection and its classification before any channel exists", async () => {
    // The ordered bootstrap hydrates the trust store before the relay socket
    // factory is installed; without that the marker is `unobtainable`, which is
    // §4.4's fail-closed answer and not "unset".
    await mobileE2eeTrustStore.hydrate();
    selectNode();
    await prepareMobileRelayE2eeAttempt();
    const state = getMobileE2eeSessionState();
    // docs/relay-e2ee-protocol.md §4.4: the guards are resolved BEFORE the
    // channel, not at row-evaluation time against state that has since moved.
    expect(state.selection?.nodeId).toBe("node_1");
    expect(state.classification).not.toBeNull();
    expect(state.channel).toBe("negotiating");
    // A fresh device: nothing verified anywhere on this Hub (§13.1.1).
    expect(state.markerSet).toBe(false);
  });
});

describe("an attempt that is not ready fails the channel closed", () => {
  it("never falls back to a legacy channel", async () => {
    selectNode();
    // No `prepare` has run: this is the launch race the slot exists to survive.
    const provider = resolveMobileRelayE2eeProvider();
    expect(provider).not.toBeUndefined();
    const context = host();
    const channel = provider!(context.host);
    // §11.2: "a client executing FATAL-PRE sends nothing and closes." The host's
    // `lockMode` throws above, so a channel that released anything fails here.
    expect(context.closes.length).toBe(1);
    // §11.5's uniform observable on the wire, and a RETRYABLE local disposition:
    // nothing here failed a cryptographic check, and the non-retryable one drives
    // the hosted transport to `terminal-failure` and stops reconnection — a
    // warm-up race must cost one channel, not the session.
    expect(context.closes[0]).toMatchObject({ retryable: true, closeReason: "channel_rejected" });
    await expect(channel.intercept(new Uint8Array([1]))).resolves.toEqual({ kind: "rejected" });
    await expect(channel.emit(new Uint8Array([1]))).resolves.toBe(false);
    await expect(channel.beginClose()).resolves.toBe("refused");
    // …and it primes itself, so the next attempt has a resolved one.
    await prepareMobileRelayE2eeAttempt();
    expect(typeof resolveMobileRelayE2eeProvider()).toBe("function");
  });

  it("refuses an attempt resolved for a different selection", async () => {
    selectNode("node_1");
    await prepareMobileRelayE2eeAttempt();
    selectNode("node_2");
    const provider = resolveMobileRelayE2eeProvider();
    const context = host();
    provider!(context.host);
    expect(context.closes.length).toBe(1);
  });
});

describe("a selection change while a preparation is in flight", () => {
  it("settles on the node that is current when the keychain read lands", async () => {
    await mobileE2eeTrustStore.hydrate();
    selectNode("node_a");
    // Not awaited: the preparation for A is in flight when B is selected, which
    // is the shape `preparing` de-duplicates into a single promise. Settling A
    // into the slot would leave B's channel with a stale key and fail it closed.
    const inFlight = prepareMobileRelayE2eeAttempt();
    selectNode("node_b");
    await inFlight;

    expect(getMobileE2eeSessionState().selection?.nodeId).toBe("node_b");
    expect(typeof resolveMobileRelayE2eeProvider()).toBe("function");
    const context = host();
    resolveMobileRelayE2eeProvider()!(context.host);
    expect(context.closes.length).toBe(0);
  });

  it("zeroizes and abandons a preparation that lands after a sign-out", async () => {
    await mobileE2eeTrustStore.hydrate();
    selectNode("node_signed_out");
    const inFlight = prepareMobileRelayE2eeAttempt();
    signOut();
    await inFlight;

    // The scalar copy must not be left live in the module slot, and the §13
    // projection must not describe a channel for the account that just left.
    expect(getMobileE2eeSessionState().selection).toBeNull();
    expect(getMobileE2eeSessionState().channel).toBe("unavailable");
    // Nothing was assigned: re-selecting the same node finds an empty slot and
    // fails the channel closed rather than handing out the abandoned attempt.
    selectNode("node_signed_out");
    const context = host();
    resolveMobileRelayE2eeProvider()!(context.host);
    expect(context.closes.length).toBe(1);
  });
});

describe("§6.3: a device that cannot hold the key simply has no E2EE", () => {
  it("supplies no provider when the prekey certificate cannot be issued", async () => {
    selectNode();
    custody.prekeyFails = true;
    await prepareMobileRelayE2eeAttempt();
    expect(resolveMobileRelayE2eeProvider()).toBeUndefined();
    // …and §12.2's label is applied to the channel that results.
    expect(getMobileE2eeSessionState().channel).toBe("legacy");
  });

  it("supplies no provider when the agreement key cannot be borrowed", async () => {
    selectNode();
    custody.agreementFails = true;
    await prepareMobileRelayE2eeAttempt();
    expect(resolveMobileRelayE2eeProvider()).toBeUndefined();
    expect(getMobileE2eeSessionState().channel).toBe("legacy");
  });
});

describe("§4.4: absence of evidence is never a legacy channel", () => {
  it("closes rather than falling back when the trust document cannot be read", async () => {
    await mobileE2eeTrustStore.hydrate();
    selectNode("node_unreadable");
    // §4.4: "MUST NOT treat unobtainable evidence as an unset latch or an unset
    // marker." A classification this device could not compute is not a §6.3
    // custody failure and must not borrow its legacy answer.
    const classify = vi
      .spyOn(mobileE2eeTrustStore, "classify")
      .mockRejectedValue(new Error("store unavailable"));
    await prepareMobileRelayE2eeAttempt();
    classify.mockRestore();

    const provider = resolveMobileRelayE2eeProvider();
    expect(provider).not.toBeUndefined();
    const context = host();
    provider!(context.host);
    expect(context.closes.length).toBe(1);
    expect(getMobileE2eeSessionState().channel).not.toBe("legacy");
  });

  it("withholds the §6.3 legacy answer from a latched selection", async () => {
    await mobileE2eeTrustStore.hydrate();
    selectNode("node_latched");
    const classify = vi
      .spyOn(mobileE2eeTrustStore, "classify")
      .mockResolvedValue({ class: "latched" });
    custody.agreementFails = true;
    await prepareMobileRelayE2eeAttempt();
    classify.mockRestore();

    // §12.1's latch is not something a local custody failure may talk this
    // client out of: the channel closes instead of running plaintext.
    expect(resolveMobileRelayE2eeProvider()).not.toBeUndefined();
    const context = host();
    resolveMobileRelayE2eeProvider()!(context.host);
    expect(context.closes.length).toBe(1);
  });
});

describe("there is no channel to secure", () => {
  it("closes rather than running plaintext while signed out or with no node selected", async () => {
    await prepareMobileRelayE2eeAttempt();
    const provider = resolveMobileRelayE2eeProvider();
    // NOT `undefined`. §6.3's no-custody device is the only thing that answers a
    // legacy channel; a store that moved between the transport's reconnect gate
    // and this synchronous construction is absent evidence like any other, and
    // §12.1.1 admits nothing into the legacy-eligible class on absence.
    expect(provider).not.toBeUndefined();
    const context = host();
    provider!(context.host);
    expect(context.closes.length).toBe(1);
  });

  it("still resolves an attempt after a preparation that had nothing to do", async () => {
    // The in-flight slot has to be released even when the preparation returns
    // before its first `await`. It did not once: the body ran synchronously,
    // cleared the slot in its own `finally`, and was then assigned into it — so
    // every later call short-circuited on a settled promise and this device
    // would have run every channel fail-closed for the rest of the process.
    await prepareMobileRelayE2eeAttempt();
    selectNode();
    await prepareMobileRelayE2eeAttempt();
    expect(typeof resolveMobileRelayE2eeProvider()).toBe("function");
    // …and a second preparation for the SAME selection is still a no-op that
    // leaves the slot usable.
    await prepareMobileRelayE2eeAttempt();
    await prepareMobileRelayE2eeAttempt();
    expect(typeof resolveMobileRelayE2eeProvider()).toBe("function");
  });
});

describe("what the resolved §4.4 attempt actually carries", () => {
  /**
   * The attempt is the whole security surface of this module and NONE of it is
   * observable through the provider the engine receives, which is how five
   * separate mutations of it once survived the entire suite: `pairingOnly`
   * forced false (§13.1's release gate off), the verified flag forced true
   * (§2.2's claim on an uncompared key), the pin spread dropped (§8.3 elements 9
   * and 17 gone), the class forced `latched` and `legacyPermitted` forced true.
   * Every field below is asserted against the trust document it was derived
   * from.
   */
  it("reports first contact as legacy-eligible, with no pin and no pairing flag", async () => {
    await mobileE2eeTrustStore.hydrate();
    selectNode("node_first_contact");
    await prepareMobileRelayE2eeAttempt();

    const attempt = inspectMobileRelayE2eeAttemptForTests();
    // §12.1.1 branch (a): genuine first contact, which is the selection a §13.2
    // ceremony runs under and the one rows K9/K13 may still fall back from.
    expect(attempt?.selectionClass).toBe("legacy-eligible");
    expect(attempt?.legacyPermitted).toBe(true);
    // §13.1: "an `unverified` record anchors nothing" — and there is no record
    // at all here, so neither §8.3 element travels.
    expect(attempt?.verifiedPinFingerprint).toBeNull();
    expect(attempt?.acceptedPolicyGeneration).toBeUndefined();
    // §13.2 step 2's flag is for the ceremony's own channel, which this is not.
    expect(attempt?.pairingOnly).toBe(false);
  });

  it("marks a selection mid-ceremony pairing-only", async () => {
    await mobileE2eeTrustStore.hydrate();
    const index = await mobileE2eeTrustStore.beginPairing({
      hubOrigin: HUB,
      accountId: ACCOUNT,
      nodeId: "node_pairing",
    });
    expect(index.localNodeHandle.length).toBeGreaterThan(0);
    selectNode("node_pairing");
    await prepareMobileRelayE2eeAttempt();

    const attempt = inspectMobileRelayE2eeAttemptForTests();
    // §13.2 step 2: "buffered application sends are never flushed, and no
    // application payload is released regardless of outcome".
    expect(attempt?.pairingOnly).toBe(true);
    expect(attempt?.verifiedPinFingerprint).toBeNull();
  });

  it("carries the §8.3 pin material of a promoted record, and re-resolves for it", async () => {
    await mobileE2eeTrustStore.hydrate();
    selectNode("node_promoted");
    await prepareMobileRelayE2eeAttempt();
    expect(inspectMobileRelayE2eeAttemptForTests()?.verifiedPinFingerprint).toBeNull();
    expect(getMobileE2eeSessionState().markerSet).toBe(false);

    const index = await mobileE2eeTrustStore.beginPairing({
      hubOrigin: HUB,
      accountId: ACCOUNT,
      nodeId: "node_promoted",
    });
    const decision = mintE2eeOwnerVerificationDecision({
      index,
      nodeIdentityPublicKey: NODE_PUBLIC_KEY,
      clientIdentityPublicKey: CLIENT_PUBLIC_KEY,
      comparedSafetyNumber: deriveE2eeSafetyNumber({
        nodeIdentityPublicKey: NODE_PUBLIC_KEY,
        clientIdentityPublicKey: CLIENT_PUBLIC_KEY,
        hubOrigin: HUB,
        accountId: ACCOUNT,
      }).display,
      continuityId: "nct_FFFFFFFFFFFFFFFFFFFFFF",
      acceptedPolicyGeneration: 7,
      decidedAt: 1_000,
    });
    await mobileE2eeTrustStore.promote(decision);

    // §13.2 step 5 changed the pin, the latch, the class and the marker without
    // touching the account or the node. Nothing may still be evaluated against
    // the document that existed before the owner decided.
    await prepareMobileRelayE2eeAttempt();
    const attempt = inspectMobileRelayE2eeAttemptForTests();
    expect(attempt?.selectionClass).toBe("latched");
    expect(attempt?.verifiedPinFingerprint).toBe(
      formatE2eeKeyFingerprint(e2eeKeyFingerprint("node-identity", NODE_PUBLIC_KEY)),
    );
    expect(attempt?.acceptedPolicyGeneration).toBe(7);
    expect(attempt?.pairingOnly).toBe(false);
    // …and §13.1.1's persistent indication is gone from the projection too.
    expect(getMobileE2eeSessionState().markerSet).toBe(true);

    // §13.3's owner-initiated re-pair, from the other direction.
    await mobileE2eeTrustStore.clearSelection(index);
    await prepareMobileRelayE2eeAttempt();
    const forgotten = inspectMobileRelayE2eeAttemptForTests();
    expect(forgotten?.verifiedPinFingerprint).toBeNull();
    expect(forgotten?.selectionClass).not.toBe("latched");
    expect(getMobileE2eeSessionState().markerSet).toBe(false);
  });

  it("refuses the slot resolved before a trust decision even without a re-preparation", async () => {
    await mobileE2eeTrustStore.hydrate();
    selectNode("node_stale");
    await prepareMobileRelayE2eeAttempt();
    expect(typeof resolveMobileRelayE2eeProvider()).toBe("function");

    // A committed decision, and NO chance to re-prepare before the next channel.
    await mobileE2eeTrustStore.beginPairing({
      hubOrigin: HUB,
      accountId: ACCOUNT,
      nodeId: "node_stale",
    });
    const context = host();
    const provider = resolveMobileRelayE2eeProvider();
    provider!(context.host);
    expect(context.closes.length).toBe(1);
  });
});

describe("§12.2: the channel claim is per channel, not per preparation", () => {
  it("returns to negotiating for every channel the provider builds", async () => {
    await mobileE2eeTrustStore.hydrate();
    selectNode("node_per_channel");
    await prepareMobileRelayE2eeAttempt();
    // A previous channel's lock, as the projection would hold it.
    lockMobileE2eeChannelMode("e2ee");
    expect(getMobileE2eeSessionState().channel).toBe("unverified");

    const provider = resolveMobileRelayE2eeProvider();
    provider!(host().host);
    // §2.2: the claim belongs to the channel that earned it. A new one claims
    // nothing until it locks a mode of its own.
    expect(getMobileE2eeSessionState().channel).toBe("negotiating");
  });

  it("never reports a first-contact channel as verified", () => {
    // §2.2's bottom row needs BOTH halves: an `e2ee` lock and a pin the owner
    // compared. The pin half is published with the guards it was resolved
    // beside, so no call site can hand the lock the wrong row.
    expect(getMobileE2eeSessionState().pinVerified).toBe(false);
    lockMobileE2eeChannelMode("e2ee");
    expect(getMobileE2eeSessionState().channel).toBe("unverified");
  });
});

describe("the attempt-owned agreement scalar", () => {
  it("is zeroized when the attempt stops being current", async () => {
    selectNode();
    await prepareMobileRelayE2eeAttempt();
    const provider = resolveMobileRelayE2eeProvider();
    expect(provider).not.toBeUndefined();
    disposeMobileRelayE2eeAttempt();
    // The next resolution has nothing to hand out and fails closed rather than
    // handing out a machine whose scalar is now zeros.
    const context = host();
    resolveMobileRelayE2eeProvider()!(context.host);
    expect(context.closes.length).toBe(1);
  });
});
