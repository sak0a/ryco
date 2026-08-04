import { hostedHubStore } from "@ryco/client-runtime/authorization";
import type { RelayE2eeHost } from "@ryco/client-runtime/relay";
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

import { mobileE2eeTrustStore } from "../platform/e2eeTrustStore";
import { getMobileE2eeSessionState, resetMobileE2eeSessionForTests } from "./e2eeSession";
import {
  disposeMobileRelayE2eeAttempt,
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
    expect(context.closes[0]).toMatchObject({ retryable: false });
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

describe("there is no channel to secure", () => {
  it("supplies no provider while signed out or with no node selected", async () => {
    await prepareMobileRelayE2eeAttempt();
    expect(resolveMobileRelayE2eeProvider()).toBeUndefined();
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
