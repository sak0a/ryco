import { hostedHubStore } from "@ryco/client-runtime/authorization";
import type { RelayE2eeHost, RelayE2eeInitiatorAttempt } from "@ryco/client-runtime/relay";
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
  identityFails: false,
  agreementFails: false,
  prekeyCalls: 0,
  identityCalls: 0,
  agreementCalls: 0,
  prekeyPending: null as Promise<void> | null,
  onPrekeyStart: null as (() => void) | null,
}));
const relayProvider = vi.hoisted(() => ({
  attempt: null as RelayE2eeInitiatorAttempt | null,
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
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove: () => undefined }),
  },
}));
vi.mock("expo-network", () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
  getNetworkStateAsync: async () => ({ isConnected: true }),
}));
vi.mock("expo-sqlite/kv-store", () => ({
  default: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));
vi.mock("../platform/deviceKey", () => ({
  getMobileDeviceIdentityPublicKey: async () => {
    custody.identityCalls += 1;
    if (custody.identityFails) throw new Error("no device identity key");
    return CLIENT_PUBLIC_KEY;
  },
}));
vi.mock("../platform/e2eeAgreementKey", () => ({
  mobileE2eeAgreementKey: {
    withSecretKey: async (use: (secretKey: Uint8Array) => unknown) => {
      custody.agreementCalls += 1;
      if (custody.agreementFails) throw new Error("no agreement key");
      return use(Uint8Array.from(AGREEMENT_SECRET_KEY));
    },
  },
}));
vi.mock("../platform/e2eeClientPrekey", () => ({
  mobileClientE2eePrekey: {
    ensure: async ({ accountId }: { readonly accountId: string }) => {
      custody.prekeyCalls += 1;
      custody.onPrekeyStart?.();
      if (custody.prekeyPending !== null) await custody.prekeyPending;
      if (custody.prekeyFails) throw new Error("no prekey");
      // §7.1 bounds the UTF-8 account id at 256 bytes. This represents the
      // named encoder refusing an oversized §7.4 prekey transcript.
      if (new TextEncoder().encode(accountId).byteLength > 256) {
        throw new Error("prekey transcript unavailable");
      }
      return {
        hubOrigin: HUB,
        accountId,
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
vi.mock("../platform/e2eeRelayProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform/e2eeRelayProvider")>();
  return {
    makeMobileRelayE2eeProvider: (sources: { readonly attempt: RelayE2eeInitiatorAttempt }) => {
      relayProvider.attempt = sources.attempt;
      return actual.makeMobileRelayE2eeProvider(sources);
    },
  };
});
vi.mock("./runtimeConfig", () => ({
  getMobileHostedConfig: () => ({
    hubOrigin: HUB,
    appUrl: HUB,
    relyingParty: "hub.example.com",
  }),
}));

import {
  mintE2eeOwnerVerificationDecision,
  mobileE2eeTrustStore,
} from "../platform/e2eeTrustStore";
import {
  getMobileE2eeSessionState,
  lockMobileE2eeChannelMode,
  resetMobileE2eeSessionForTests,
  subscribeMobileE2eeSession,
} from "./e2eeSession";
import {
  disposeMobileRelayE2eeAttempt,
  inspectMobileRelayE2eeAttemptForTests,
  prepareMobileRelayE2eeAttempt,
  resetMobileRelayE2eeAttemptForTests,
  resolveMobileRelayE2eeProvider,
} from "./e2eeAttempt";

function selectNode(
  nodeId = "node_1",
  accountId = ACCOUNT,
  generation = hostedHubStore.getState().generation,
): void {
  hostedHubStore.setState({
    accountStatus: "authenticated",
    account: {
      id: accountId,
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
    generation,
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

function instantiateCurrentProvider(): { readonly closes: unknown[] } {
  const context = host();
  const provider = resolveMobileRelayE2eeProvider();
  expect(provider).not.toBeUndefined();
  provider!(context.host);
  return context;
}

beforeEach(() => {
  vi.restoreAllMocks();
  custody.prekeyFails = false;
  custody.identityFails = false;
  custody.agreementFails = false;
  custody.prekeyCalls = 0;
  custody.identityCalls = 0;
  custody.agreementCalls = 0;
  custody.prekeyPending = null;
  custody.onPrekeyStart = null;
  relayProvider.attempt = null;
  resetMobileRelayE2eeAttemptForTests();
  resetMobileE2eeSessionForTests();
  signOut();
});

function authenticatedStatement(policyGeneration = 8) {
  return {
    kind: "verified",
    anchor: "pin-unchanged",
    selectedSuite: 1,
    statement: {
      identityPublicKey: NODE_PUBLIC_KEY,
      continuityId: "nct_FFFFFFFFFFFFFFFFFFFFFF",
      policyGeneration,
    },
  } as const;
}

async function prepareVerifiedSelection(nodeId: string, generation = 1): Promise<void> {
  await mobileE2eeTrustStore.hydrate();
  const index = await mobileE2eeTrustStore.beginPairing({
    hubOrigin: HUB,
    accountId: ACCOUNT,
    nodeId,
  });
  await mobileE2eeTrustStore.promote(
    mintE2eeOwnerVerificationDecision({
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
    }),
  );
  selectNode(nodeId, ACCOUNT, generation);
  await prepareMobileRelayE2eeAttempt();
  resolveMobileRelayE2eeProvider();
}

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
    const retried = prepareMobileRelayE2eeAttempt();
    const context = host();
    const channel = provider!(context.host);
    // §11.2: "a client executing FATAL-PRE sends nothing and closes." The host's
    // `lockMode` throws above, so a channel that released anything fails here.
    expect(context.closes.length).toBe(1);
    // §11.5's uniform observable on the wire, and a RETRYABLE local disposition:
    // nothing here failed a cryptographic check, and the non-retryable one drives
    // the hosted transport to `terminal-failure` and stops reconnection — a
    // warm-up race must cost one channel, not the session.
    expect(context.closes[0]).toMatchObject({
      retryable: true,
      closeReason: "channel_rejected",
    });
    await expect(channel.intercept(new Uint8Array([1]))).resolves.toEqual({
      kind: "rejected",
    });
    expect(channel.submit(new Uint8Array([1]))).toBe(false);
    await expect(channel.beginClose()).resolves.toBe("refused");
    // …and it primes itself, so the next attempt has a resolved one.
    await retried;
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

  it("does not publish stale legacy when a credential rejection lands after sign-out", async () => {
    await mobileE2eeTrustStore.hydrate();
    selectNode("node_rejected_after_sign_out");
    let rejectPrekey!: (cause: Error) => void;
    custody.prekeyPending = new Promise<void>((_resolve, reject) => {
      rejectPrekey = reject;
    });
    let reportStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    custody.onPrekeyStart = reportStarted;

    const inFlight = prepareMobileRelayE2eeAttempt();
    await started;
    signOut();
    rejectPrekey(new Error("secure store unavailable"));
    await inFlight;

    expect(getMobileE2eeSessionState().selection).toBeNull();
    expect(getMobileE2eeSessionState().channel).toBe("unavailable");
    expect(resolveMobileRelayE2eeProvider()).not.toBeUndefined();
    await prepareMobileRelayE2eeAttempt();
  });
});

describe("§6.3: credential failure is legacy only for an explicitly eligible selection", () => {
  it("supplies no provider for a legacy-eligible selection when legacy is permitted", async () => {
    selectNode();
    custody.prekeyFails = true;
    await prepareMobileRelayE2eeAttempt();
    expect(resolveMobileRelayE2eeProvider()).toBeUndefined();
    await prepareMobileRelayE2eeAttempt();
    // …and §12.2's label is applied to the channel that results.
    expect(getMobileE2eeSessionState().channel).toBe("legacy");
  });

  it("fails closed for a legacy-eligible selection when legacy is forbidden", async () => {
    await mobileE2eeTrustStore.hydrate();
    selectNode("node_strict_legacy");
    const strictLegacyPolicy = vi
      .spyOn(mobileE2eeTrustStore, "strictLegacyPolicy")
      .mockReturnValue({ kind: "forbidden", recordedAt: 1 });
    custody.prekeyFails = true;
    await prepareMobileRelayE2eeAttempt();
    expect(custody.prekeyCalls).toBe(1);

    const provider = resolveMobileRelayE2eeProvider();
    expect(provider).not.toBeUndefined();
    const retried = prepareMobileRelayE2eeAttempt();
    const context = host();
    const channel = provider!(context.host);
    expect(context.closes).toHaveLength(1);
    expect(channel.submit(new Uint8Array([1]))).toBe(false);
    await expect(channel.intercept(new Uint8Array([1]))).resolves.toEqual({
      kind: "rejected",
    });
    await retried;
    expect(custody.prekeyCalls).toBe(2);
    expect(getMobileE2eeSessionState()).toMatchObject({
      channel: "unavailable",
      selection: { nodeId: "node_strict_legacy" },
      classification: { class: "legacy-eligible" },
      event: null,
    });
    strictLegacyPolicy.mockRestore();
  });

  it.each([
    [
      "oversized prekey transcript",
      () => selectNode("node_unexpected_transcript", "a".repeat(257)),
      [1, 0, 0],
    ],
    [
      "secure device identity store",
      () => {
        selectNode("node_unexpected_identity");
        custody.identityFails = true;
      },
      [1, 1, 0],
    ],
    [
      "agreement key store",
      () => {
        selectNode("node_unexpected_agreement");
        custody.agreementFails = true;
      },
      [1, 1, 1],
    ],
  ])(
    "fails closed for an unexpected selection when the %s fails",
    async (_name, arrange, expectedCalls) => {
      await mobileE2eeTrustStore.hydrate();
      arrange();
      const classify = vi
        .spyOn(mobileE2eeTrustStore, "classify")
        .mockResolvedValue({ class: "unexpected", clause: "ii" });
      await prepareMobileRelayE2eeAttempt();
      expect([custody.prekeyCalls, custody.identityCalls, custody.agreementCalls]).toEqual(
        expectedCalls,
      );

      expect(getMobileE2eeSessionState()).toMatchObject({
        channel: "unavailable",
        selection: { nodeId: expect.stringContaining("node_unexpected") },
        classification: { class: "unexpected", clause: "ii" },
        event: { kind: "unexpected-node", situation: 1, evidence: "none" },
      });

      const provider = resolveMobileRelayE2eeProvider();
      expect(provider).not.toBeUndefined();
      const retried = prepareMobileRelayE2eeAttempt();
      const context = host();
      const channel = provider!(context.host);
      expect(context.closes).toHaveLength(1);
      expect(channel.submit(new Uint8Array([1]))).toBe(false);
      await expect(channel.intercept(new Uint8Array([1]))).resolves.toEqual({
        kind: "rejected",
      });
      await retried;
      expect([custody.prekeyCalls, custody.identityCalls, custody.agreementCalls]).toEqual(
        expectedCalls.map((value) => value * 2),
      );
      expect(getMobileE2eeSessionState().event).toEqual({
        kind: "unexpected-node",
        situation: 1,
        evidence: "none",
      });
      classify.mockRestore();
    },
  );

  it("clears the previous channel claim when a new selection fails closed", async () => {
    await mobileE2eeTrustStore.hydrate();
    selectNode("node_previous");
    await prepareMobileRelayE2eeAttempt();
    lockMobileE2eeChannelMode("legacy");
    expect(getMobileE2eeSessionState().channel).toBe("legacy");

    selectNode("node_unexpected_after_previous");
    const classify = vi
      .spyOn(mobileE2eeTrustStore, "classify")
      .mockResolvedValue({ class: "unexpected", clause: "ii" });
    custody.agreementFails = true;
    await prepareMobileRelayE2eeAttempt();

    // The prior claim is gone, while the new selection's trust context remains
    // available to the owner even though credentials could not be built.
    expect(getMobileE2eeSessionState()).toMatchObject({
      channel: "unavailable",
      selection: { nodeId: "node_unexpected_after_previous" },
      classification: { class: "unexpected", clause: "ii" },
      event: { kind: "unexpected-node", situation: 1, evidence: "none" },
    });
    classify.mockRestore();
  });

  it("keeps the unexpected ceremony visible while an automatic retry is pending", async () => {
    await mobileE2eeTrustStore.hydrate();
    selectNode("node_unexpected_retry");
    const classify = vi
      .spyOn(mobileE2eeTrustStore, "classify")
      .mockResolvedValue({ class: "unexpected", clause: "ii" });
    custody.agreementFails = true;
    await prepareMobileRelayE2eeAttempt();
    expect(getMobileE2eeSessionState().event).toMatchObject({
      kind: "unexpected-node",
      evidence: "none",
    });

    custody.agreementFails = false;
    let rejectPrekey!: (cause: Error) => void;
    custody.prekeyPending = new Promise<void>((_resolve, reject) => {
      rejectPrekey = reject;
    });
    let reportStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    custody.onPrekeyStart = reportStarted;

    expect(resolveMobileRelayE2eeProvider()).not.toBeUndefined();
    const retried = prepareMobileRelayE2eeAttempt();
    await started;

    // The retry may wait on the secure store indefinitely. It must not erase
    // the warning during that interval and republish it only after rejection.
    expect(getMobileE2eeSessionState()).toMatchObject({
      channel: "unavailable",
      selection: { nodeId: "node_unexpected_retry" },
      classification: { class: "unexpected", clause: "ii" },
      event: { kind: "unexpected-node", situation: 1, evidence: "none" },
    });

    rejectPrekey(new Error("secure store unavailable"));
    await retried;
    classify.mockRestore();
  });

  it("supplies no provider when an eligible selection cannot borrow the agreement key", async () => {
    selectNode();
    custody.agreementFails = true;
    await prepareMobileRelayE2eeAttempt();
    expect(resolveMobileRelayE2eeProvider()).toBeUndefined();
    await prepareMobileRelayE2eeAttempt();
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

    expect(custody.prekeyCalls).toBe(0);
    expect(custody.identityCalls).toBe(0);
    expect(custody.agreementCalls).toBe(0);

    const provider = resolveMobileRelayE2eeProvider();
    expect(provider).not.toBeUndefined();
    const context = host();
    provider!(context.host);
    await prepareMobileRelayE2eeAttempt();
    expect(context.closes.length).toBe(1);
    expect(getMobileE2eeSessionState().channel).not.toBe("legacy");
    classify.mockRestore();
  });

  it("withholds the §6.3 legacy answer from a latched selection", async () => {
    await mobileE2eeTrustStore.hydrate();
    selectNode("node_latched");
    const classify = vi
      .spyOn(mobileE2eeTrustStore, "classify")
      .mockResolvedValue({ class: "latched" });
    custody.agreementFails = true;
    await prepareMobileRelayE2eeAttempt();

    // §12.1's latch is not something a local custody failure may talk this
    // client out of: the channel closes instead of running plaintext.
    expect(resolveMobileRelayE2eeProvider()).not.toBeUndefined();
    const context = host();
    resolveMobileRelayE2eeProvider()!(context.host);
    await prepareMobileRelayE2eeAttempt();
    expect(context.closes.length).toBe(1);
    classify.mockRestore();
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

describe("authenticated statement persistence owns the mobile handshake", () => {
  it("fences a provider opened reentrantly by a statement session listener", async () => {
    await prepareVerifiedSelection("node_reentrant_commit");
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(mobileE2eeTrustStore, "recordAuthenticatedStatement").mockReturnValue(pending);

    let reentrantCloses: readonly unknown[] | null = null;
    const unsubscribe = subscribeMobileE2eeSession(() => {
      reentrantCloses = instantiateCurrentProvider().closes;
    });
    const commit = relayProvider.attempt!.onStatement!(authenticatedStatement() as never);
    unsubscribe();

    expect(reentrantCloses).toHaveLength(1);
    release();
    await commit;
  });

  it("fences same-selection providers until the underlying durable mutation settles", async () => {
    await prepareVerifiedSelection("node_pending_commit");
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const record = vi
      .spyOn(mobileE2eeTrustStore, "recordAuthenticatedStatement")
      .mockReturnValue(pending);

    const commit = relayProvider.attempt!.onStatement!(authenticatedStatement() as never);
    await Promise.resolve();
    expect(record).toHaveBeenCalledOnce();

    expect(instantiateCurrentProvider().closes).toHaveLength(1);

    await expect(
      relayProvider.attempt!.onStatement!(authenticatedStatement(9) as never),
    ).rejects.toThrow();
    expect(record).toHaveBeenCalledOnce();

    release();
    await commit;
    // The provider function exists in both cases. Construction proves the
    // settled path is the usable machine rather than the unresolved closer.
    expect(instantiateCurrentProvider().closes).toHaveLength(0);
  });

  it("propagates durable rejection and restores the previous complete attempt only afterward", async () => {
    await prepareVerifiedSelection("node_rejected_commit");
    let reject!: (cause: Error) => void;
    const pending = new Promise<void>((_resolve, rejectPromise) => {
      reject = rejectPromise;
    });
    vi.spyOn(mobileE2eeTrustStore, "recordAuthenticatedStatement").mockReturnValue(pending);

    const commit = relayProvider.attempt!.onStatement!(authenticatedStatement() as never);
    expect(instantiateCurrentProvider().closes).toHaveLength(1);
    reject(new Error("durable trust write refused"));
    await expect(commit).rejects.toThrow("durable trust write refused");

    expect(instantiateCurrentProvider().closes).toHaveLength(0);
  });

  it("makes the committed generation and rotated pin visible before its continuation runs", async () => {
    const nodeId = "node_commit_before_continue";
    await prepareVerifiedSelection(nodeId);
    const rotatedIdentity = bytes(
      "5866666666666666666666666666666666666666666666666666666666666666",
    );
    const expectedFingerprint = formatE2eeKeyFingerprint(
      e2eeKeyFingerprint("node-identity", rotatedIdentity),
    );

    let recordAtContinuation: ReturnType<typeof mobileE2eeTrustStore.resolve> = null;
    await Promise.resolve(
      relayProvider.attempt!.onStatement!({
        kind: "verified",
        anchor: "pin-updated",
        selectedSuite: 1,
        statement: {
          identityPublicKey: rotatedIdentity,
          continuityId: "nct_FFFFFFFFFFFFFFFFFFFFFF",
          policyGeneration: 12,
        },
      } as never),
    ).then(() => {
      // This continuation stands at the exact contract the shared initiator
      // awaits before it may send hello and arm the handshake deadline.
      recordAtContinuation = mobileE2eeTrustStore.resolve({
        kind: "node-id-hint",
        hubOrigin: HUB,
        accountId: ACCOUNT,
        nodeId,
      });
    });

    expect(recordAtContinuation).toMatchObject({
      state: "verified",
      verifiedFingerprint: expectedFingerprint,
      acceptedPolicyGeneration: 12,
    });
  });

  it("rejects an old continuation across A to B to A lifecycle generations", async () => {
    await prepareVerifiedSelection("node_generation_a", 11);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(mobileE2eeTrustStore, "recordAuthenticatedStatement").mockReturnValue(pending);

    const commit = relayProvider.attempt!.onStatement!(authenticatedStatement() as never);
    selectNode("node_generation_b", ACCOUNT, 12);
    selectNode("node_generation_a", ACCOUNT, 13);
    release();

    await expect(commit).rejects.toThrow();
    expect(getMobileE2eeSessionState().selection?.nodeId).not.toBe("node_generation_b");
  });
});
