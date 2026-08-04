import { ed25519 } from "@noble/curves/ed25519";
import { p256 } from "@noble/curves/nist";
import { sha256 } from "@noble/hashes/sha2";
import {
  RELAY_INITIAL_LIMITS,
  RelayLimits,
  type RelayChannelId,
  type RelayFrame,
} from "@ryco/contracts";
import { decodeRelayFrame, encodeRelayFrame } from "@ryco/shared/relayCodec";
import {
  e2eeChannelSizeBudget,
  e2eeNegotiationBufferMaxBytes,
  E2EE_HANDSHAKE_REJECT_BYTES,
  RPC_KEEPALIVE_INTERVAL,
  T_ADV,
  T_HANDSHAKE,
  T_KEEPALIVE_FLUSH_MARGIN,
} from "@ryco/shared/relayE2eeConstants";
import {
  decodeE2eeClientHello,
  E2eeNodeHandshake,
  type E2eeAdvertisedChannelMaterial,
  type E2eeClientAuthorization,
  type E2eeClientHandshakeCredentials,
  type E2eeHandshakeChannel,
} from "@ryco/shared/relayE2eeHandshake";
import { e2eeKeyFingerprint } from "@ryco/shared/relayE2eeKeys";
import { E2eeRecordSession, type E2eeSessionSecrets } from "@ryco/shared/relayE2eeSession";
import {
  e2eeAuthorizationContextCommitment,
  encodeCanonicalE2eeCbor,
  encodeClientE2eePrekeyTranscript,
  encodeE2eeAuthorizationContext,
  encodeNodeE2eeCapabilitySigningEnvelope,
  encodeNodeE2eeCapabilityTranscript,
  encodeNodeE2eePrekeyTranscript,
  type NodeE2eeCapabilityTranscriptInput,
} from "@ryco/shared/relayE2eeTranscripts";
import {
  E2EE_INNER_TYPE_RPC,
  E2EE_NEGOTIATION_TYPE_CLIENT_HELLO,
  E2EE_SUITE_25519_CHACHAPOLY_SHA256,
  encodeE2eeCapabilityCarrier,
  encodeE2eeHandshakeReject,
  encodeE2eeNegotiationRecord,
} from "@ryco/shared/relayE2eeWire";
import { RELAY_CHUNK_CAPABILITY_PRELUDE } from "@ryco/shared/relayMessageChunks";
import { describe, expect, it, vi } from "vite-plus/test";

import { encodeBase64Url } from "./base64url";
import {
  makeRelayE2eeInitiator,
  type RelayE2eeInitiator,
  type RelayE2eeInitiatorAttempt,
} from "./relayE2eeInitiator";
import {
  HostedRelayEngine,
  RELAY_E2EE_NEGOTIATION_BUFFER_FULL_MESSAGE,
  type HostedRelaySocketCallbacks,
  type RelaySocket,
  type RelayTimers,
} from "./relayEngine";

// §4.4 rows K1–K24 on the REAL relay path — the client mode machine wired into
// `HostedRelayEngine`, driven by a synthetic node that puts its §5.3 carrier at
// node-to-client data sequence 0 and answers with a real §8.6 responder.
//
// Every assertion about what did or did not reach the wire is made against the
// SOCKET'S FRAME LOG rather than against the engine's or the machine's internal
// state: §4.4's send-buffering rule is a statement about bytes on the relay, and
// a test that read the buffer instead would pass on an implementation that
// emptied it into the socket.

// ─── §16.1-style TEST-ONLY material ──────────────────────────────────────────
//
// The node identity seed, node identifiers, and timestamps are the ones
// `relayE2eeCapabilityVerify.test.ts` and `relayE2eeHandshake.test.ts` pin; the
// X25519 keys are the RFC 7748 §6.1 vectors and the P-256 identity key is the
// RFC 6979 A.2.5 vector. NONE OF IT MAY EVER REACH A REAL ENDPOINT.

const bytes = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, "hex"));
const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

const NODE_SEED = bytes("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
const NODE_IDENTITY_PUBLIC = ed25519.getPublicKey(NODE_SEED);
const NODE_AGREEMENT_SECRET = bytes(
  "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb",
);
const NODE_AGREEMENT_PUBLIC = bytes(
  "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f",
);
const CLIENT_AGREEMENT_SECRET = bytes(
  "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",
);
const CLIENT_AGREEMENT_PUBLIC = bytes(
  "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a",
);
const CLIENT_IDENTITY_SECRET = bytes(
  "c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721",
);
const CLIENT_IDENTITY_PUBLIC = bytes(
  "04" +
    "60fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb6" +
    "7903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d4462299",
);

const HUB_ORIGIN = "https://hub.example.com";
const NODE_ID = "node_AAAAAAAAAAAAAAAAAAAAAA";
const IDENTITY_KEY_ID = "nkey_BBBBBBBBBBBBBBBBBBBBBB";
const PREKEY_ID = "epk_EEEEEEEEEEEEEEEEEEEEEE";
const CONTINUITY_ID = "nct_FFFFFFFFFFFFFFFFFFFFFF";
const ACCOUNT_ID = "acct_0123456789";
const CHANNEL_ID = "ch_cccccccccccccccccccccc" as RelayChannelId;
const CREATED_AT = 1_784_160_000_000;
const KEY_EXPIRES_AT = 1_786_752_000_000;
const ISSUED_AT = 1_784_160_030_000;
const STATEMENT_EXPIRES_AT = 1_784_160_630_000;
const NOW = 1_784_160_030_000;

const NODE_IDENTITY_FINGERPRINT = e2eeKeyFingerprint("node-identity", NODE_IDENTITY_PUBLIC);
const VERSION = { protocolMajor: 1, protocolMinor: 2 } as const;
const OPEN = 1;

const CLIENT_PREKEY_TRANSCRIPT = encodeClientE2eePrekeyTranscript({
  hubOrigin: HUB_ORIGIN,
  accountId: ACCOUNT_ID,
  identityPublicKey: CLIENT_IDENTITY_PUBLIC,
  agreementPublicKey: CLIENT_AGREEMENT_PUBLIC,
  createdAt: CREATED_AT,
  expiresAt: KEY_EXPIRES_AT,
});
const CLIENT_PREKEY_SIGNATURE = p256
  .sign(sha256(CLIENT_PREKEY_TRANSCRIPT), CLIENT_IDENTITY_SECRET, { prehash: false })
  .toBytes("compact");

const NODE_PREKEY_CROSS_SIGNATURE = ed25519.sign(
  encodeNodeE2eePrekeyTranscript({
    hubOrigin: HUB_ORIGIN,
    nodeId: NODE_ID,
    identityKeyId: IDENTITY_KEY_ID,
    prekeyId: PREKEY_ID,
    identityPublicKey: NODE_IDENTITY_PUBLIC,
    agreementPublicKey: NODE_AGREEMENT_PUBLIC,
    createdAt: CREATED_AT,
    expiresAt: KEY_EXPIRES_AT,
  }),
  NODE_SEED,
);

const BASE_TRANSCRIPT: NodeE2eeCapabilityTranscriptInput = {
  hubOrigin: HUB_ORIGIN,
  nodeId: NODE_ID,
  identityKeyId: IDENTITY_KEY_ID,
  identityPublicKey: NODE_IDENTITY_PUBLIC,
  e2eeVersionMin: 1,
  e2eeVersionMax: 1,
  suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
  prekeyCertificate: {
    prekeyId: PREKEY_ID,
    agreementPublicKey: NODE_AGREEMENT_PUBLIC,
    crossSignature: NODE_PREKEY_CROSS_SIGNATURE,
    createdAt: CREATED_AT,
    expiresAt: KEY_EXPIRES_AT,
  },
  continuityChain: [],
  requireE2EE: false,
  requireApprovedClientE2EE: false,
  policyGeneration: 7,
  issuedAt: ISSUED_AT,
  expiresAt: STATEMENT_EXPIRES_AT,
  continuityId: CONTINUITY_ID,
};

function statement(overrides: Partial<NodeE2eeCapabilityTranscriptInput> = {}): Uint8Array {
  const transcript = encodeNodeE2eeCapabilityTranscript({ ...BASE_TRANSCRIPT, ...overrides });
  return encodeCanonicalE2eeCbor([
    transcript,
    ed25519.sign(encodeNodeE2eeCapabilitySigningEnvelope(transcript), NODE_SEED),
  ]);
}

const STATEMENT = statement();
/** A well-formed, correctly signed statement that is UNUSABLE: §5.2 step 8. */
const UNUSABLE_STATEMENT = statement({ e2eeVersionMin: 2, e2eeVersionMax: 2 });

const NODE_CHANNEL: E2eeHandshakeChannel = {
  hubOrigin: HUB_ORIGIN,
  channelId: CHANNEL_ID,
  relayProtocolMajor: 1,
  relayProtocolMinor: 2,
  channelOpenCapability: "ryco.rpc",
  channelOpenEffectiveRole: "operator",
};
const NODE_ADVERTISED: E2eeAdvertisedChannelMaterial = {
  nodeId: NODE_ID,
  nodeIdentityFingerprint: NODE_IDENTITY_FINGERPRINT,
  prekeyId: PREKEY_ID,
  agreementPublicKey: NODE_AGREEMENT_PUBLIC,
  continuityChainTranscripts: [],
  continuityId: CONTINUITY_ID,
};
const APPROVED: E2eeClientAuthorization = {
  status: "approved",
  maxRole: "owner",
  capabilitySet: ["ryco.rpc"],
};
const CREDENTIALS: E2eeClientHandshakeCredentials = {
  tier: "native",
  accountId: ACCOUNT_ID,
  identityPublicKey: CLIENT_IDENTITY_PUBLIC,
  agreementPublicKey: CLIENT_AGREEMENT_PUBLIC,
  agreementSecretKey: CLIENT_AGREEMENT_SECRET,
  prekeyTranscript: CLIENT_PREKEY_TRANSCRIPT,
  prekeySignature: CLIENT_PREKEY_SIGNATURE,
};

// ─── the harness ─────────────────────────────────────────────────────────────

class MockRelaySocket implements RelaySocket {
  readyState = 0;
  bufferedAmount = 0;
  readonly sent: Uint8Array[] = [];
  #open: Array<() => void> = [];
  #message: Array<(bytes: Uint8Array) => void> = [];
  #close: Array<() => void> = [];
  #error: Array<() => void> = [];

  send(value: Uint8Array): void {
    this.sent.push(Uint8Array.from(value));
  }
  close(): void {
    this.readyState = 3;
  }
  onOpen(listener: () => void): void {
    this.#open.push(listener);
  }
  onBinaryMessage(listener: (value: Uint8Array) => void): void {
    this.#message.push(listener);
  }
  onClose(listener: () => void): void {
    this.#close.push(listener);
  }
  onError(listener: () => void): void {
    this.#error.push(listener);
  }
  open(): void {
    this.readyState = OPEN;
    for (const listener of this.#open) listener();
  }
  frame(frame: RelayFrame): void {
    const encoded = encodeRelayFrame(frame);
    if (!encoded.ok) throw new Error("test frame encoding failed");
    for (const listener of this.#message) listener(Uint8Array.from(encoded.value));
  }
}

/** Timers a test steps by hand, so `T_ADV` and `T_HANDSHAKE` are observable. */
function manualTimers() {
  let clock = NOW;
  let nextId = 1;
  const pending = new Map<number, { at: number; run: () => void }>();
  const timers: RelayTimers = {
    now: () => clock,
    setTimeout: (run, ms) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { at: clock + ms, run });
      return id;
    },
    clearTimeout: (id) => void pending.delete(id as number),
    queueMicrotask: (run) => globalThis.queueMicrotask(run),
  };
  return {
    timers,
    advance(ms: number): void {
      clock += ms;
      // Snapshotted: a fired callback may arm or cancel another timer, and
      // mutating the map while walking it would skip or re-run an entry.
      const due = [...pending].filter(([, entry]) => entry.at <= clock);
      for (const [id, entry] of due) {
        pending.delete(id);
        entry.run();
      }
    },
  };
}

const flush = async (): Promise<void> => {
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
};

function attemptOf(overrides: Partial<RelayE2eeInitiatorAttempt> = {}): RelayE2eeInitiatorAttempt {
  return {
    hubOrigin: HUB_ORIGIN,
    selectionClass: "legacy-eligible",
    legacyPermitted: true,
    pairingOnly: false,
    localSuitePreference: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
    credentials: CREDENTIALS,
    accountId: ACCOUNT_ID,
    ...overrides,
  };
}

interface Harness {
  readonly engine: HostedRelayEngine;
  readonly socket: MockRelaySocket;
  readonly events: {
    onOpen: ReturnType<typeof vi.fn>;
    onData: ReturnType<typeof vi.fn>;
    onError: ReturnType<typeof vi.fn>;
    onClose: ReturnType<typeof vi.fn>;
  };
  readonly callbacks: HostedRelaySocketCallbacks;
  readonly diagnostics: string[];
  readonly unexpected: string[];
  readonly machine: () => RelayE2eeInitiator;
  readonly advance: (ms: number) => void;
}

function harness(
  overrides: Partial<RelayE2eeInitiatorAttempt> = {},
  limits: RelayLimits = RELAY_INITIAL_LIMITS,
): Harness {
  const socket = new MockRelaySocket();
  const clock = manualTimers();
  const diagnostics: string[] = [];
  const unexpected: string[] = [];
  const events = {
    onOpen: vi.fn(),
    onData: vi.fn(),
    onError: vi.fn(),
    onClose: vi.fn(),
  };
  const callbacks: HostedRelaySocketCallbacks = {
    onTransportStatus: vi.fn(),
    onSessionStatus: vi.fn(),
    onRole: vi.fn(),
    onFailure: vi.fn(),
  };
  let machine: RelayE2eeInitiator | undefined;
  const engine = new HostedRelayEngine({
    ticket: encodeBase64Url(new Uint8Array(32).fill(7)),
    ticketExpiresAt: NOW + 60_000,
    socket,
    timers: clock.timers,
    callbacks,
    events,
    e2ee: (host) => {
      machine = makeRelayE2eeInitiator({
        host,
        attempt: attemptOf({
          onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.row),
          onUnexpectedNode: (evidence) => unexpected.push(evidence),
          ...overrides,
        }),
      });
      return machine;
    },
  });
  socket.open();
  socket.frame({ type: "ready", ...VERSION, limits });
  socket.frame({
    type: "channel.open",
    ...VERSION,
    channelId: CHANNEL_ID,
    capability: "ryco.rpc",
    effectiveRole: "operator",
  });
  socket.frame({ type: "channel.accept", ...VERSION, channelId: CHANNEL_ID });
  return {
    engine,
    socket,
    events,
    callbacks,
    diagnostics,
    unexpected,
    machine: () => machine!,
    advance: clock.advance,
  };
}

/** One node-to-client `data` frame carrying a post-strip payload at `sequence`. */
function deliver(socket: MockRelaySocket, payload: Uint8Array, sequence = 0): void {
  const framed = new Uint8Array(RELAY_CHUNK_CAPABILITY_PRELUDE.byteLength + payload.byteLength);
  framed.set(RELAY_CHUNK_CAPABILITY_PRELUDE);
  framed.set(payload, RELAY_CHUNK_CAPABILITY_PRELUDE.byteLength);
  socket.frame({
    type: "data",
    ...VERSION,
    channelId: CHANNEL_ID,
    sequence: sequence as never,
    payload: framed,
  });
}

function frames(socket: MockRelaySocket): RelayFrame[] {
  return socket.sent.flatMap((value) => {
    const decoded = decodeRelayFrame(value);
    return decoded.ok ? [decoded.value] : [];
  });
}

/** The post-strip payloads this client actually put on the relay. */
function outbound(socket: MockRelaySocket): Uint8Array[] {
  return frames(socket).flatMap((frame) =>
    frame.type === "data"
      ? [frame.payload.subarray(RELAY_CHUNK_CAPABILITY_PRELUDE.byteLength)]
      : [],
  );
}

function closeReasons(socket: MockRelaySocket): (string | undefined)[] {
  return frames(socket).flatMap((frame) => (frame.type === "channel.close" ? [frame.reason] : []));
}

const CARRIER = encodeE2eeCapabilityCarrier(STATEMENT);
const UNUSABLE_CARRIER = encodeE2eeCapabilityCarrier(UNUSABLE_STATEMENT);
const LEGACY_PING = utf8('{"_tag":"Ping"}');
const LEGACY_RPC = utf8('{"_tag":"Request","id":1}');

/** The node half of one handshake, from the hello this client emitted. */
function respond(hello: Uint8Array, now = NOW) {
  const node = new E2eeNodeHandshake({
    channel: NODE_CHANNEL,
    advertised: NODE_ADVERTISED,
    advertisedVersionMin: 1,
    advertisedVersionMax: 1,
    agreementSecretKey: NODE_AGREEMENT_SECRET,
    advertisementEmittedAt: now,
    readPolicy: () => ({
      requireApprovedClientE2EE: false,
      suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
    }),
    lookupClientAuthorization: () => APPROVED,
  });
  const accept = node.receiveHello(hello, now);
  if (accept.kind !== "accepted") {
    throw new Error(`synthetic node refused the hello: ${JSON.stringify(accept)}`);
  }
  return accept;
}

/** One authenticated node-to-client envelope, built from the node's own secrets. */
async function nodeEnvelope(
  secrets: E2eeSessionSecrets,
  sessionBindingHash: Uint8Array,
  body: Uint8Array,
  limits: RelayLimits = RELAY_INITIAL_LIMITS,
): Promise<Uint8Array> {
  const session = new E2eeRecordSession({
    secrets,
    suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    sessionBindingHash,
    sendDirection: "n2c",
    plaintextCeiling: e2eeChannelSizeBudget(limits).plaintextCeiling,
  });
  let envelope: Uint8Array | undefined;
  const result = await session.protect({
    innerType: E2EE_INNER_TYPE_RPC,
    body,
    admit: () => true,
    transmit: (value) => {
      envelope = Uint8Array.from(value);
      return { kind: "sent" };
    },
  });
  if (result.kind !== "protected" || envelope === undefined) {
    throw new Error("synthetic node could not protect a record");
  }
  return envelope;
}

/** Drive rows K1 and K5 to completion and hand back the node's session material. */
async function establish(overrides: Partial<RelayE2eeInitiatorAttempt> = {}) {
  const test = harness(overrides);
  deliver(test.socket, CARRIER);
  await flush();
  const hello = outbound(test.socket).at(-1)!;
  const accept = respond(Uint8Array.from(hello));
  deliver(test.socket, accept.record, 1);
  await flush();
  return { test, accept };
}

// ─── §3.2.2 L1 ───────────────────────────────────────────────────────────────

describe("§3.2.2 L1 — the negotiating window fits inside one keepalive period", () => {
  it("holds T_ADV + T_HANDSHAKE + T_KEEPALIVE_FLUSH_MARGIN <= RPC_KEEPALIVE_INTERVAL", () => {
    // §3.2.2: "A release in which any of L1–L5 is false is a specification
    // defect." The client is the only endpoint bound by it, and row K15 is
    // reachable ONLY while it holds — under a violating budget the transport
    // declares the peer dead mid-handshake and the specified FATAL-PRE, with
    // §11.5's uniform observable, can never execute (§17.14).
    expect(T_ADV + T_HANDSHAKE + T_KEEPALIVE_FLUSH_MARGIN).toBeLessThanOrEqual(
      RPC_KEEPALIVE_INTERVAL,
    );
  });
});

// ─── §4.4 rows K1–K24 ────────────────────────────────────────────────────────

describe("§4.4 client transition table — rows K1–K4 (the capability carrier)", () => {
  it("K1: sends exactly one bounded hello on a validated, usable statement", async () => {
    const test = harness();
    deliver(test.socket, CARRIER);
    await flush();

    const emitted = outbound(test.socket);
    expect(emitted).toHaveLength(1);
    const hello = decodeE2eeClientHello(Uint8Array.from(emitted[0]!));
    expect(hello.kind).toBe("ok");
    expect(test.machine().mode()).toBe("negotiating");
    // §4.4: nothing is released while the hello is in flight.
    expect(test.events.onOpen).not.toHaveBeenCalled();
  });

  it("K2: closes FATAL-PRE on an unusable statement while the selection is latched", async () => {
    const test = harness({ selectionClass: "latched" });
    deliver(test.socket, UNUSABLE_CARRIER);
    await flush();

    // §11.2 P15, and §11.2's procedure: the client sends NOTHING.
    expect(outbound(test.socket)).toEqual([]);
    expect(test.diagnostics).toEqual(["P15"]);
    expect(closeReasons(test.socket)).toEqual(["channel_rejected"]);
  });

  it("K3: treats an unusable statement as absent evidence when the selection is not latched", async () => {
    const test = harness({ selectionClass: "legacy-eligible" });
    deliver(test.socket, UNUSABLE_CARRIER);
    await flush();

    expect(test.machine().mode()).toBe("negotiating");
    expect(outbound(test.socket)).toEqual([]);
    expect(test.diagnostics).toEqual(["K3"]);
    // The `T_ADV` rows still decide the channel.
    test.advance(T_ADV);
    expect(test.machine().mode()).toBe("legacy");
  });

  it("K4: closes FATAL-PRE on a duplicate carrier", async () => {
    const test = harness();
    deliver(test.socket, CARRIER);
    await flush();
    deliver(test.socket, CARRIER, 1);
    await flush();

    expect(test.diagnostics).toEqual(["P4"]);
    expect(test.machine().mode()).toBe("closed");
  });
});

describe("§4.4 client transition table — rows K5–K8 (negotiation records)", () => {
  it("K5: verifies the accept, enters e2ee, and only then releases the channel", async () => {
    const { test } = await establish();

    expect(test.machine().mode()).toBe("e2ee");
    expect(test.events.onOpen).toHaveBeenCalledOnce();
    expect(test.callbacks.onTransportStatus).toHaveBeenCalledWith("online");
  });

  it("K6: closes FATAL-PRE on an accept with no hello sent", async () => {
    const test = harness();
    // A well-formed accept, produced from a hello this client never sent.
    const other = harness();
    deliver(other.socket, CARRIER);
    await flush();
    const accept = respond(Uint8Array.from(outbound(other.socket).at(-1)!));

    deliver(test.socket, accept.record);
    await flush();

    expect(test.diagnostics).toEqual(["P16"]);
    expect(outbound(test.socket)).toEqual([]);
  });

  it("K6: closes FATAL-PRE on a tampered accept and emits no record", async () => {
    const test = harness();
    deliver(test.socket, CARRIER);
    await flush();
    const accept = respond(Uint8Array.from(outbound(test.socket).at(-1)!));
    const tampered = Uint8Array.from(accept.record);
    tampered[tampered.byteLength - 1] ^= 0x01;

    deliver(test.socket, tampered, 1);
    await flush();

    // §8.8 step 5's constant-time comparison, reached through the real wiring.
    expect(test.diagnostics).toEqual(["P16"]);
    expect(outbound(test.socket)).toHaveLength(1);
    expect(test.events.onOpen).not.toHaveBeenCalled();
  });

  it("K7: closes FATAL-PRE on an E2EEHandshakeReject after a hello", async () => {
    const test = harness();
    deliver(test.socket, CARRIER);
    await flush();
    const reject = encodeE2eeHandshakeReject();
    expect(reject.byteLength).toBe(E2EE_HANDSHAKE_REJECT_BYTES);

    deliver(test.socket, reject, 1);
    await flush();

    expect(test.diagnostics).toEqual(["P17"]);
    // §4.4: one attempt per channel — a retry needs a fresh ticket and channel.
    expect(test.machine().mode()).toBe("closed");
  });

  it("K8: closes FATAL-PRE on a misdirected negotiation record", async () => {
    const test = harness();
    // `E2EEClientHello` is a client-to-node record (§3.4).
    deliver(
      test.socket,
      encodeE2eeNegotiationRecord(E2EE_NEGOTIATION_TYPE_CLIENT_HELLO, new Uint8Array([0x80])),
    );
    await flush();

    expect(test.diagnostics).toEqual(["P3"]);
    expect(outbound(test.socket)).toEqual([]);
  });
});

describe("§4.4 client transition table — rows K9–K12 (plaintext and stray classes)", () => {
  it("K9: locks legacy and delivers when the selection is legacy-eligible", async () => {
    const test = harness({ selectionClass: "legacy-eligible", legacyPermitted: true });
    deliver(test.socket, LEGACY_RPC);
    await flush();

    expect(test.machine().mode()).toBe("legacy");
    expect(test.events.onOpen).toHaveBeenCalledOnce();
    expect(test.events.onData).toHaveBeenCalledWith(LEGACY_RPC);
  });

  it("K10: closes FATAL-PRE on non-carrier legacy JSON while latched", async () => {
    const test = harness({ selectionClass: "latched" });
    deliver(test.socket, LEGACY_PING);
    await flush();

    expect(test.diagnostics).toEqual(["P18"]);
    expect(test.events.onData).not.toHaveBeenCalled();
  });

  it("K10: closes FATAL-PRE on non-carrier legacy JSON after a hello was sent", async () => {
    const test = harness();
    deliver(test.socket, CARRIER);
    await flush();
    deliver(test.socket, LEGACY_PING, 1);
    await flush();

    expect(test.diagnostics).toEqual(["P18"]);
  });

  it("K11: closes FATAL-PRE on an envelope before establishment", async () => {
    const test = harness();
    deliver(test.socket, new Uint8Array([0x01, 0x01, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    await flush();

    expect(test.diagnostics).toEqual(["P5"]);
  });

  it("K12: closes FATAL-PRE on an unknown or absent first byte", async () => {
    const unknown = harness();
    deliver(unknown.socket, new Uint8Array([0xff]));
    await flush();
    expect(unknown.diagnostics).toEqual(["P6"]);

    // §3.4's absent case: a zero-length post-strip payload is never a benign
    // no-op and never silently dropped.
    const absent = harness();
    deliver(absent.socket, new Uint8Array(0));
    await flush();
    expect(absent.diagnostics).toEqual(["P6"]);
  });
});

describe("§4.4 client transition table — rows K13–K15 (timers)", () => {
  it("K13: locks legacy at T_ADV when the selection is legacy-eligible", async () => {
    const test = harness();
    test.advance(T_ADV - 1);
    expect(test.machine().mode()).toBe("negotiating");

    test.advance(1);
    expect(test.machine().mode()).toBe("legacy");
    expect(test.events.onOpen).toHaveBeenCalledOnce();
  });

  it("K14: closes FATAL-PRE at T_ADV when the selection is latched", () => {
    const test = harness({ selectionClass: "latched" });
    test.advance(T_ADV);

    expect(test.diagnostics).toEqual(["P19"]);
    expect(outbound(test.socket)).toEqual([]);
  });

  it("K14: closes FATAL-PRE at T_ADV when local policy forbids legacy", () => {
    const test = harness({ selectionClass: "legacy-eligible", legacyPermitted: false });
    test.advance(T_ADV);

    expect(test.diagnostics).toEqual(["P19"]);
  });

  it("K15: closes FATAL-PRE at T_HANDSHAKE and never falls back to legacy", async () => {
    const test = harness();
    deliver(test.socket, CARRIER);
    await flush();

    // `T_ADV` was cancelled at the hello emit: advancing past it changes nothing.
    test.advance(T_ADV);
    expect(test.machine().mode()).toBe("negotiating");

    test.advance(T_HANDSHAKE);
    expect(test.diagnostics).toEqual(["P20"]);
    expect(test.machine().mode()).toBe("closed");
    expect(outbound(test.socket)).toHaveLength(1);
  });

  it("ignores a superseded T_ADV after the mode locked", async () => {
    const test = harness();
    deliver(test.socket, LEGACY_RPC);
    await flush();
    expect(test.machine().mode()).toBe("legacy");

    test.advance(T_ADV + T_HANDSHAKE);
    // One-way: a legacy channel is never re-decided by a timer.
    expect(test.machine().mode()).toBe("legacy");
    expect(test.diagnostics).toEqual([]);
  });
});

describe("§4.4 client transition table — rows K16–K18 (the established channel)", () => {
  it("K16: delivers an authenticated inner RPC record", async () => {
    const { test, accept } = await establish();
    const envelope = await nodeEnvelope(
      accept.secrets,
      accept.sessionBindingHash,
      utf8('{"_tag":"Response"}'),
    );

    deliver(test.socket, envelope, 2);
    await flush();

    expect(test.events.onData).toHaveBeenCalledWith(utf8('{"_tag":"Response"}'));
  });

  it("K17: closes FATAL-POST on an envelope whose checks fail", async () => {
    const { test, accept } = await establish();
    const envelope = await nodeEnvelope(
      accept.secrets,
      accept.sessionBindingHash,
      utf8('{"_tag":"Response"}'),
    );
    envelope[envelope.byteLength - 1] ^= 0x01;

    deliver(test.socket, envelope, 2);
    await flush();

    expect(test.events.onData).not.toHaveBeenCalled();
    expect(closeReasons(test.socket)).toContain("channel_rejected");
  });

  it("K18: closes FATAL-POST on plaintext after E2EE", async () => {
    const { test } = await establish();

    deliver(test.socket, LEGACY_PING, 2);
    await flush();

    // The keepalive `Pong` a synthesized-Pong implementation must stop injecting
    // at the mode lock is exactly this record, and it is still fatal.
    expect(test.events.onData).not.toHaveBeenCalled();
    expect(closeReasons(test.socket)).toContain("channel_rejected");
  });
});

describe("§4.4 client transition table — rows K19–K22 (after a legacy lock)", () => {
  async function locked() {
    const test = harness();
    test.advance(T_ADV);
    return test;
  }

  it("K19: delivers non-carrier legacy JSON to the RPC parser", async () => {
    const test = await locked();
    deliver(test.socket, LEGACY_RPC);
    await flush();

    expect(test.events.onData).toHaveBeenCalledWith(LEGACY_RPC);
  });

  it("K20: ignores a carrier after a legacy lock and never upgrades", async () => {
    const test = await locked();
    deliver(test.socket, CARRIER);
    await flush();

    expect(test.machine().mode()).toBe("legacy");
    expect(test.events.onData).not.toHaveBeenCalled();
    expect(test.diagnostics).toEqual(["K20"]);
    expect(outbound(test.socket)).toEqual([]);
  });

  it("K21: closes FATAL-PRE on an envelope or a negotiation record", async () => {
    const envelope = await locked();
    deliver(
      envelope.socket,
      new Uint8Array([0x01, 0x01, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    );
    await flush();
    expect(envelope.diagnostics).toEqual(["P5"]);

    const negotiation = await locked();
    deliver(negotiation.socket, encodeE2eeHandshakeReject());
    await flush();
    // §11.2 P24: no session keys exist in `legacy`, so it is FATAL-PRE.
    expect(negotiation.diagnostics).toEqual(["P24"]);
  });

  it("K22: closes FATAL-PRE on an unknown first byte", async () => {
    const test = await locked();
    deliver(test.socket, new Uint8Array([0x2a]));
    await flush();

    expect(test.diagnostics).toEqual(["P6"]);
  });
});

// ─── the substituted node (§13.2.1, rows K23/K24) ────────────────────────────

describe("NEGATIVE — a substituted node raises the §13.2.1 surface and releases nothing", () => {
  it("K23: closes FATAL-PRE on legacy JSON and discards the buffer UNFLUSHED", async () => {
    const test = harness({ selectionClass: "unexpected", legacyPermitted: true });
    test.engine.send(utf8('{"_tag":"Request","id":7}'));
    expect(outbound(test.socket)).toEqual([]);

    deliver(test.socket, LEGACY_PING);
    await flush();

    expect(test.unexpected).toEqual(["none"]);
    expect(test.diagnostics).toEqual(["P22"]);
    // THE POINT OF THE ROW: the buffered application send is NOT flushed as
    // plaintext on the way out, which is what a legacy lock would have done.
    expect(outbound(test.socket)).toEqual([]);
    expect(test.events.onOpen).not.toHaveBeenCalled();
    expect(test.events.onData).not.toHaveBeenCalled();
    expect(closeReasons(test.socket)).toEqual(["channel_rejected"]);
  });

  it("K24: closes FATAL-PRE at T_ADV and discards the buffer UNFLUSHED", () => {
    const test = harness({ selectionClass: "unexpected", legacyPermitted: true });
    test.engine.send(utf8('{"_tag":"Request","id":8}'));

    test.advance(T_ADV);

    expect(test.unexpected).toEqual(["none"]);
    expect(test.diagnostics).toEqual(["P22"]);
    expect(outbound(test.socket)).toEqual([]);
    expect(test.events.onOpen).not.toHaveBeenCalled();
  });
});

// ─── §4.4 send buffering ─────────────────────────────────────────────────────

describe("§4.4 send buffering — no plaintext byte reaches the wire while negotiating", () => {
  it("holds every submission, including a keepalive Ping injected mid-window", async () => {
    const test = harness();
    test.engine.send(utf8('{"_tag":"Request","id":1}'));
    // The keepalive `Ping` is generated by the RPC layer several levels above
    // this seam and is not otherwise controllable; §4.4 classifies it exactly as
    // any other plaintext, which is why the buffer covers all of it.
    test.engine.send(LEGACY_PING);
    test.engine.send(utf8('{"_tag":"Request","id":2}'));

    // Asserted on the socket's FRAME LOG: not one `data` frame exists.
    expect(frames(test.socket).some((frame) => frame.type === "data")).toBe(false);

    deliver(test.socket, CARRIER);
    await flush();
    // Still nothing but the hello: the flush waits for §8.8 step 6.
    expect(outbound(test.socket)).toHaveLength(1);
  });

  it("flushes as envelopes only after §8.8 step 6, in submission order", async () => {
    const test = harness();
    test.engine.send(utf8('{"_tag":"Request","id":1}'));
    test.engine.send(LEGACY_PING);
    deliver(test.socket, CARRIER);
    await flush();
    const hello = Uint8Array.from(outbound(test.socket).at(-1)!);
    expect(outbound(test.socket)).toHaveLength(1);

    const accept = respond(hello);
    deliver(test.socket, accept.record, 1);
    await flush();

    const emitted = outbound(test.socket);
    // The hello, then two envelopes — every one of them a `0x01` envelope and
    // none of them a plaintext byte.
    expect(emitted).toHaveLength(3);
    expect(emitted[1]![0]).toBe(0x01);
    expect(emitted[2]![0]).toBe(0x01);
    expect(test.engine.bufferedAmount).toBe(0);
  });

  it("flushes as plaintext on a legacy lock, before the first delivery", async () => {
    const test = harness();
    test.engine.send(utf8('{"first":1}'));
    test.engine.send(utf8('{"second":2}'));

    test.advance(T_ADV);

    const emitted = outbound(test.socket).map((value) => new TextDecoder().decode(value));
    expect(emitted).toEqual(['{"first":1}', '{"second":2}']);
  });

  it("makes the buffered keepalive Ping the §8.9 implicit finish when nothing else is pending", async () => {
    const test = harness();
    test.engine.send(LEGACY_PING);
    deliver(test.socket, CARRIER);
    await flush();
    const accept = respond(Uint8Array.from(outbound(test.socket).at(-1)!));

    deliver(test.socket, accept.record, 1);
    await flush();

    // §8.9: the first valid client-to-node envelope IS the implicit finish, and
    // §4.4/§3.2.2 L1 budget for exactly this frame.
    const emitted = outbound(test.socket);
    expect(emitted).toHaveLength(2);
    expect(emitted[1]![0]).toBe(0x01);
  });

  it("refuses a submission past E2EE_NEGOTIATION_BUFFER_MAX_BYTES without failing the channel", () => {
    const limits = RelayLimits.make({
      ...RELAY_INITIAL_LIMITS,
      maxControlFrameBytes: 4_096,
      maxDataChunkBytes: 8_192,
      maxQueuedBytes: 12_288,
    });
    // `maxQueuedBytes − maxControlFrameBytes`, and one buffered message fits in
    // a single data chunk — the flush below is not what this case is bounding.
    const bound = e2eeNegotiationBufferMaxBytes(limits);
    const test = harness({}, limits);

    // The charge is the buffer's own running total against the same aggregate
    // budget the relay send queue enforces, per relay connection.
    test.engine.send(new Uint8Array(bound - 2_048).fill(0x7b));
    expect(() => test.engine.send(new Uint8Array(2_049).fill(0x7b))).toThrow(
      RELAY_E2EE_NEGOTIATION_BUFFER_FULL_MESSAGE,
    );

    // §11.4 `e2ee_send_unavailable`: no wire record of any kind, the channel
    // unaffected and still usable, and never a silent drop.
    expect(frames(test.socket).some((frame) => frame.type === "data")).toBe(false);
    expect(test.callbacks.onFailure).not.toHaveBeenCalled();
    expect(test.machine().mode()).toBe("negotiating");
    // The share is released the instant the channel leaves `negotiating`.
    test.advance(T_ADV);
    expect(test.engine.bufferedAmount).toBe(0);
    expect(() => test.engine.send(new Uint8Array(32).fill(0x7b))).not.toThrow();
  });

  it("does not change the shape of any pre-existing refusal", () => {
    const test = harness();
    test.advance(T_ADV);

    // Every legacy refusal still throws synchronously, with its own message,
    // which both facades map by string.
    expect(() => test.engine.send(new Uint8Array(RELAY_INITIAL_LIMITS.maxQueuedBytes * 4))).toThrow(
      "RPC payload exceeds the maximum relay message size.",
    );
  });
});

// ─── FATAL-PRE discard (§4.4, §11.2) ─────────────────────────────────────────

describe("§4.4 FATAL-PRE — the buffer is zeroized and discarded, and no record is emitted", () => {
  const rows: readonly (readonly [string, (test: Harness) => Promise<void> | void])[] = [
    ["K2", (test) => void deliver(test.socket, UNUSABLE_CARRIER)],
    [
      "K4",
      async (test) => {
        deliver(test.socket, CARRIER);
        await flush();
        deliver(test.socket, CARRIER, 1);
      },
    ],
    [
      "K6",
      async (test) => {
        deliver(test.socket, CARRIER);
        await flush();
        const accept = respond(Uint8Array.from(outbound(test.socket).at(-1)!));
        const tampered = Uint8Array.from(accept.record);
        tampered[tampered.byteLength - 1] ^= 0x01;
        deliver(test.socket, tampered, 1);
      },
    ],
    [
      "K7",
      async (test) => {
        deliver(test.socket, CARRIER);
        await flush();
        deliver(test.socket, encodeE2eeHandshakeReject(), 1);
      },
    ],
    [
      "K8",
      (test) =>
        void deliver(
          test.socket,
          encodeE2eeNegotiationRecord(E2EE_NEGOTIATION_TYPE_CLIENT_HELLO, new Uint8Array([0x80])),
        ),
    ],
    ["K10", (test) => void deliver(test.socket, LEGACY_PING)],
    [
      "K11",
      (test) =>
        void deliver(
          test.socket,
          new Uint8Array([0x01, 0x01, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        ),
    ],
    ["K12", (test) => void deliver(test.socket, new Uint8Array(0))],
    ["K14", (test) => test.advance(T_ADV)],
    [
      "K15",
      async (test) => {
        deliver(test.socket, CARRIER);
        await flush();
        test.advance(T_ADV + T_HANDSHAKE);
      },
    ],
  ];

  for (const [row, drive] of rows) {
    it(`${row}: discards the buffered sends unflushed`, async () => {
      // `latched` reaches every row above whose guard needs it and changes none
      // of the others: rows K4, K6, K7, K8, K11, K12 and K15 are unguarded.
      const test = harness({ selectionClass: "latched" });
      test.engine.send(utf8('{"_tag":"Request","id":99}'));
      await drive(test);
      await flush();

      const emitted = outbound(test.socket);
      // The hello is the ONE record a client may emit; nothing else — and in
      // particular no buffered plaintext — reaches the relay.
      for (const payload of emitted) expect(payload[0]).toBe(0x02);
      expect(test.engine.bufferedAmount).toBe(0);
      expect(closeReasons(test.socket)).toEqual(["channel_rejected"]);
      expect(test.events.onOpen).not.toHaveBeenCalled();
    });
  }

  it("K23 and K24 take the same discard path", async () => {
    for (const drive of [
      async (test: Harness) => {
        deliver(test.socket, LEGACY_PING);
        await flush();
      },
      async (test: Harness) => test.advance(T_ADV),
    ]) {
      const test = harness({ selectionClass: "unexpected" });
      test.engine.send(utf8('{"_tag":"Request","id":99}'));
      await drive(test);
      await flush();
      expect(outbound(test.socket)).toEqual([]);
      expect(test.engine.bufferedAmount).toBe(0);
    }
  });
});

// ─── §13.2 the pairing-only attempt ──────────────────────────────────────────

describe("NEGATIVE — a pairing-only attempt releases no application payload", () => {
  it("sends exactly one bounded hello and never flushes, on the reject path", async () => {
    const test = harness({ pairingOnly: true, selectionClass: "unexpected" });
    test.engine.send(utf8('{"_tag":"Request","id":1}'));
    deliver(test.socket, CARRIER);
    await flush();

    const emitted = outbound(test.socket);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]![0]).toBe(0x02);

    deliver(test.socket, encodeE2eeHandshakeReject(), 1);
    await flush();

    expect(outbound(test.socket)).toHaveLength(1);
    expect(test.events.onOpen).not.toHaveBeenCalled();
    expect(test.diagnostics).toEqual(["P17"]);
  });

  it("releases nothing on a hypothetical accept path either", async () => {
    const test = harness({ pairingOnly: true, selectionClass: "unexpected" });
    test.engine.send(utf8('{"_tag":"Request","id":1}'));
    deliver(test.socket, CARRIER);
    await flush();
    const accept = respond(Uint8Array.from(outbound(test.socket).at(-1)!));

    // A conforming node never emits this to an unapproved client; §13.2 fixes
    // the outcome anyway — "no application payload is released REGARDLESS OF
    // OUTCOME" — so a node that answers one gains nothing.
    deliver(test.socket, accept.record, 1);
    await flush();

    expect(outbound(test.socket)).toHaveLength(1);
    expect(test.machine().mode()).toBe("closed");
    expect(test.events.onOpen).not.toHaveBeenCalled();
    expect(test.events.onData).not.toHaveBeenCalled();
    expect(test.diagnostics).toEqual(["P21"]);
  });
});

// ─── §4.4 no legacy after validated evidence ─────────────────────────────────

describe("§4.4 no legacy after validated evidence", () => {
  it("sends the hello rather than idling past T_ADV, and never falls back", async () => {
    const test = harness();
    deliver(test.socket, CARRIER);
    await flush();
    expect(outbound(test.socket)).toHaveLength(1);

    test.advance(T_ADV);
    expect(test.machine().mode()).toBe("negotiating");
    test.advance(T_HANDSHAKE);

    // P20, not a legacy lock — the two are the only outcomes this rule leaves.
    expect(test.machine().mode()).toBe("closed");
    expect(test.diagnostics).toEqual(["P20"]);
  });

  it("closes FATAL-PRE with P21 rather than proceeding when the client cannot", async () => {
    const test = harness({ pairingOnly: true });
    deliver(test.socket, CARRIER);
    await flush();
    const accept = respond(Uint8Array.from(outbound(test.socket).at(-1)!));
    deliver(test.socket, accept.record, 1);
    await flush();

    expect(test.diagnostics).toEqual(["P21"]);
    expect(test.machine().mode()).toBe("closed");
  });
});

// ─── §8.3 provenance and §8.8 wiring ─────────────────────────────────────────

describe("§8.3 provenance — elements 9 and 17 come from the resolved verified pin", () => {
  it("builds the context commitment from the pin, not from the statement", async () => {
    const test = harness({
      selectionClass: "latched",
      verifiedPin: {
        identityFingerprint: NODE_IDENTITY_FINGERPRINT,
        continuityId: CONTINUITY_ID,
      },
    });
    deliver(test.socket, CARRIER);
    await flush();

    const hello = decodeE2eeClientHello(Uint8Array.from(outbound(test.socket).at(-1)!));
    if (hello.kind !== "ok") throw new Error("expected a decodable hello");
    const expected = e2eeAuthorizationContextCommitment(
      encodeE2eeAuthorizationContext({
        hubOrigin: HUB_ORIGIN,
        channelId: CHANNEL_ID,
        relayProtocolMajor: 1,
        relayProtocolMinor: 2,
        e2eeVersion: 1,
        suiteId: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        nodeId: NODE_ID,
        // The PIN's fingerprint and continuity id, which is what §8.3 requires
        // wherever a verified pin resolves.
        nodeIdentityFingerprint: NODE_IDENTITY_FINGERPRINT,
        clientIntendedCapability: "ryco.rpc",
        clientIntendedRole: "operator",
        channelOpenCapability: "ryco.rpc",
        channelOpenEffectiveRole: "operator",
        nodeAgreementFingerprint: e2eeKeyFingerprint("agreement", NODE_AGREEMENT_PUBLIC),
        nodeContinuityChainTranscripts: [],
        nodeContinuityId: CONTINUITY_ID,
        client: {
          tier: "native",
          accountId: ACCOUNT_ID,
          identityFingerprint: e2eeKeyFingerprint("client-identity", CLIENT_IDENTITY_PUBLIC),
          agreementFingerprint: e2eeKeyFingerprint("agreement", CLIENT_AGREEMENT_PUBLIC),
        },
      }),
    );
    expect(Buffer.from(hello.value.contextCommitment).toString("hex")).toBe(
      Buffer.from(expected).toString("hex"),
    );
  });

  it("closes FATAL-PRE when the statement cannot authenticate to the pin", async () => {
    const test = harness({
      selectionClass: "latched",
      verifiedPin: {
        identityFingerprint: e2eeKeyFingerprint("node-identity", ed25519.getPublicKey(NODE_SEED)),
        continuityId: "nct_HHHHHHHHHHHHHHHHHHHHHH",
      },
    });
    deliver(test.socket, CARRIER);
    await flush();

    // §5.2 step 6: a continuity id disagreeing with the pinned value is already
    // channel-fatal before a hello may be sent, so no hello exists to carry an
    // adopted value.
    expect(outbound(test.socket)).toEqual([]);
    expect(test.diagnostics).toEqual(["P15"]);
  });

  it("commits to the capability and role the channel.open actually presented", async () => {
    const test = harness();
    deliver(test.socket, CARRIER);
    await flush();

    // §8.3 requires elements 11–12 to byte-equal elements 13–14 at both
    // endpoints; the node reconstructs the context from its own `channel.open`
    // and refuses a hello whose commitment disagrees in EITHER direction. The
    // synthetic node accepting this hello is that check passing.
    expect(() => respond(Uint8Array.from(outbound(test.socket).at(-1)!))).not.toThrow();
  });
});

describe("§8.8 wiring — the client hashes its OWN hello wire bytes", () => {
  it("an honest handshake produces a matching confirmation", async () => {
    const { test } = await establish();
    expect(test.machine().mode()).toBe("e2ee");
  });

  it("a suite list stripped in transit after the hello was hashed breaks the confirmation", async () => {
    // §16.3 F16's `suite-list-strip-after-the-hello-was-hashed`: every node-side
    // check passes, so the node's transcript covers the STRIPPED bytes while the
    // client's covers the original.
    const test = harness({ localSuitePreference: [E2EE_SUITE_25519_CHACHAPOLY_SHA256, 2] });
    deliver(test.socket, CARRIER);
    await flush();
    const sent = Uint8Array.from(outbound(test.socket).at(-1)!);
    const delivered = Uint8Array.from(sent);
    // The `offeredSuites` array header and its two entries sit at a fixed offset
    // in the §8.5 wrapper; strip the second entry and shorten the array.
    const index = delivered.indexOf(0x82, 6);
    expect(index).toBeGreaterThan(0);
    expect(delivered[index + 1]).toBe(0x01);
    expect(delivered[index + 2]).toBe(0x02);
    const stripped = new Uint8Array(delivered.byteLength - 1);
    stripped.set(delivered.subarray(0, index));
    stripped[index] = 0x81;
    stripped[index + 1] = 0x01;
    stripped.set(delivered.subarray(index + 3), index + 2);

    const accept = respond(stripped);
    deliver(test.socket, accept.record, 1);
    await flush();

    expect(test.diagnostics).toEqual(["P16"]);
    expect(test.machine().mode()).toBe("closed");
    expect(outbound(test.socket)).toHaveLength(1);
    expect(closeReasons(test.socket)).toEqual(["channel_rejected"]);
  });
});

// ─── the RN lifecycle abort ──────────────────────────────────────────────────

describe("a client-initiated abort while negotiating", () => {
  it("closes FATAL-PRE, emits no record, and discards the buffer", () => {
    const test = harness();
    test.engine.send(utf8('{"_tag":"Request","id":1}'));

    test.machine().abort();

    expect(outbound(test.socket)).toEqual([]);
    expect(test.engine.bufferedAmount).toBe(0);
    expect(test.machine().mode()).toBe("closed");
    expect(closeReasons(test.socket)).toEqual(["channel_rejected"]);
    expect(test.events.onOpen).not.toHaveBeenCalled();
  });

  it("is a no-op once a mode has locked", async () => {
    const { test } = await establish();
    test.machine().abort();
    expect(test.machine().mode()).toBe("e2ee");
  });
});
