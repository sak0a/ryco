import { RELAY_INITIAL_LIMITS, type RelayChannelId, type RelayFrame } from "@ryco/contracts";
import {
  encodeBase64Url,
  type HostedRelaySocketCallbacks,
  type RelayE2eeProvider,
} from "@ryco/client-runtime/relay";
import { decodeRelayFrame, encodeRelayFrame } from "@ryco/shared/relayCodec";
import {
  E2eeNodeHandshake,
  type E2eeAdvertisedChannelMaterial,
  type E2eeHandshakeChannel,
} from "@ryco/shared/relayE2eeHandshake";
import { e2eeKeyFingerprint } from "@ryco/shared/relayE2eeKeys";
import { decodeNodeE2eeCapabilityStatement } from "@ryco/shared/relayE2eeTranscripts";
import { E2EE_SUITE_25519_CHACHAPOLY_SHA256 } from "@ryco/shared/relayE2eeWire";
import { RELAY_CHUNK_CAPABILITY_PRELUDE } from "@ryco/shared/relayMessageChunks";
import { vi, type Mock } from "vite-plus/test";

import f03Raw from "../../../packages/shared/fixtures/e2ee/v1/f03-capability-statement.json?raw";
import f07Raw from "../../../packages/shared/fixtures/e2ee/v1/f07-nx-handshake.json?raw";
import f14Raw from "../../../packages/shared/fixtures/e2ee/v1/f14-verification-display.json?raw";

import { BrowserHostedRelaySocket, hostedRelayWebSocketUrl } from "../src/hostedHub/relaySocket";

// ONE relay harness for two runtimes.
//
// `apps/web/src/hostedHub/relaySocket.test.ts` runs it under Node and
// `src/components/hostedHub/*.browser.tsx` runs it under Chromium, which is what
// docs/relay-e2ee-protocol.md §16.4 asks for: the web-facing families "MUST also
// run in the web browser test suite", and a second copy of the mock socket would
// let the two runtimes drift apart in exactly the layer that decides whether a
// byte reached the wire.
//
// EVERY ASSERTION A CALLER BUILDS ON THIS IS ABOUT BYTES ON THE SOCKET. §4.4's
// send-buffering rule is a statement about the relay and not about an engine's
// internal queue, so the log below is the raw frame log and the readers derive
// everything from it.
//
// The node half is REAL — `E2eeNodeHandshake` from the shared package, driven
// from the committed §16.3 fixtures' test-only key material — because a hostile
// Hub is modelled by what it can put on the wire, and a hand-rolled responder
// would only ever produce the bytes the test author already expected.

// ─── the mock browser WebSocket ──────────────────────────────────────────────

export class MockWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = MockWebSocket.CONNECTING;
  bufferedAmount = 0;
  binaryType: BinaryType = "blob";
  closeCalls = 0;
  readonly sent: ArrayBuffer[] = [];

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sent.push(
      data instanceof ArrayBuffer
        ? data.slice(0)
        : ArrayBuffer.isView(data)
          ? Uint8Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).buffer
          : new ArrayBuffer(0),
    );
  }
  close(): void {
    this.closeCalls += 1;
    this.readyState = MockWebSocket.CLOSED;
  }
  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }
  deliver(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
  frame(frame: RelayFrame): void {
    const encoded = encodeRelayFrame(frame);
    if (!encoded.ok) throw new Error("test frame encoding failed");
    this.deliver(Uint8Array.from(encoded.value).buffer);
  }
}

/**
 * The four transport callbacks, spied.
 *
 * Written as a mapped type over the engine's own callback interface rather than
 * inferred: a callback added to `HostedRelaySocketCallbacks` then has to be
 * added here too, instead of silently going unobserved in every suite.
 */
export type RelayCallbackSpies = {
  readonly [K in keyof HostedRelaySocketCallbacks]-?: Mock<
    NonNullable<HostedRelaySocketCallbacks[K]>
  >;
};

export function relayCallbacks(): RelayCallbackSpies {
  return {
    onTransportStatus: vi.fn(),
    onSessionStatus: vi.fn(),
    onRole: vi.fn(),
    onFailure: vi.fn(),
  };
}

export interface RelayHarness {
  readonly facade: BrowserHostedRelaySocket;
  readonly socket: MockWebSocket;
  readonly handlers: RelayCallbackSpies;
}

/**
 * One `BrowserHostedRelaySocket` over a mock browser socket.
 *
 * `e2ee` is passed through verbatim so a caller can construct the facade with
 * NO provider — which is the pre-E2EE channel, byte for byte — or with the §4.4
 * machine, and nothing else about the construction differs between them.
 */
export function createRelayHarness(
  options: {
    readonly e2ee?: RelayE2eeProvider | undefined;
    readonly handlers?: RelayCallbackSpies;
  } = {},
): RelayHarness {
  const handlers = options.handlers ?? relayCallbacks();
  const sockets: MockWebSocket[] = [];
  const facade = new BrowserHostedRelaySocket({
    url: hostedRelayWebSocketUrl(),
    ticket: encodeBase64Url(new Uint8Array(32).fill(7)),
    ticketExpiresAt: Date.now() + 60_000,
    callbacks: handlers,
    createSocket: () => {
      const socket = new MockWebSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    ...(options.e2ee === undefined ? {} : { e2ee: options.e2ee }),
  });
  return { facade, socket: sockets[0]!, handlers };
}

export const RELAY_CHANNEL_ID = "ch_cccccccccccccccccccccc" as RelayChannelId;
export const RELAY_VERSION = { protocolMajor: 1, protocolMinor: 2 } as const;

/** Drive the connection to `channel.accept` — the instant §4.4 measures from. */
export function authenticateRelay(socket: MockWebSocket): void {
  socket.open();
  socket.frame({ type: "ready", ...RELAY_VERSION, limits: RELAY_INITIAL_LIMITS });
  socket.frame({
    type: "channel.open",
    ...RELAY_VERSION,
    channelId: RELAY_CHANNEL_ID,
    capability: "ryco.rpc",
    effectiveRole: "operator",
  });
  socket.frame({ type: "channel.accept", ...RELAY_VERSION, channelId: RELAY_CHANNEL_ID });
}

/** One node-to-client `data` frame carrying a post-strip payload at `sequence`. */
export function deliverRelayPayload(
  socket: MockWebSocket,
  payload: Uint8Array,
  sequence = 0,
): void {
  const framed = new Uint8Array(RELAY_CHUNK_CAPABILITY_PRELUDE.byteLength + payload.byteLength);
  framed.set(RELAY_CHUNK_CAPABILITY_PRELUDE);
  framed.set(payload, RELAY_CHUNK_CAPABILITY_PRELUDE.byteLength);
  socket.frame({
    type: "data",
    ...RELAY_VERSION,
    channelId: RELAY_CHANNEL_ID,
    sequence: sequence as never,
    payload: framed,
  });
}

export function sentRelayFrames(socket: MockWebSocket): RelayFrame[] {
  return socket.sent.flatMap((bytes) => {
    const decoded = decodeRelayFrame(new Uint8Array(bytes));
    return decoded.ok ? [decoded.value] : [];
  });
}

/** The post-strip payloads this client actually put on the relay. */
export function outboundRelayPayloads(socket: MockWebSocket): Uint8Array[] {
  return sentRelayFrames(socket).flatMap((frame) =>
    frame.type === "data"
      ? [frame.payload.subarray(RELAY_CHUNK_CAPABILITY_PRELUDE.byteLength)]
      : [],
  );
}

export function relayCloseReasons(socket: MockWebSocket): (string | undefined)[] {
  return sentRelayFrames(socket).flatMap((frame) =>
    frame.type === "channel.close" ? [frame.reason] : [],
  );
}

/** Let queued microtasks and the engine's own async hops settle. */
export const settleRelay = async (): Promise<void> => {
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
};

// ─── the committed §16.3 corpus, read the same way in both runtimes ──────────
//
// Imported as raw text rather than as a JSON module so the fixture stays a
// data file of `packages/shared` that this app only reads: nothing here
// regenerates it, and §16.4's "a vector that produces different bytes on any
// supported runtime is a release-blocking defect" is checked against the
// committed bytes and not against a copy.

interface FixtureCase {
  readonly name: string;
  readonly sections: readonly string[];
  readonly note?: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly expected: Readonly<Record<string, unknown>>;
}

interface FixtureFamily {
  readonly family: { readonly number: number; readonly title: string };
  readonly testKeyMaterial: Readonly<Record<string, unknown>>;
  readonly cases: readonly FixtureCase[];
}

export const F03: FixtureFamily = JSON.parse(f03Raw) as FixtureFamily;
export const F07: FixtureFamily = JSON.parse(f07Raw) as FixtureFamily;
export const F14: FixtureFamily = JSON.parse(f14Raw) as FixtureFamily;

/** §16.2: byte strings are `{"$bytes": "<lowercase hex>"}` and nothing else. */
export function fixtureBytes(value: unknown): Uint8Array {
  const hex = (value as { readonly $bytes?: unknown }).$bytes;
  if (typeof hex !== "string" || !/^(?:[0-9a-f]{2})*$/.test(hex)) {
    throw new Error("fixture value is not a §16.2 byte string");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

export function hexOf(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function fixtureCase(family: FixtureFamily, name: string): FixtureCase {
  const found = family.cases.find((entry) => entry.name === name);
  if (!found) throw new Error(`missing §16.3 fixture case ${name}`);
  return found;
}

/** TEST ONLY (§16.1). None of this material may ever reach a real endpoint. */
const KEY_MATERIAL = F03.testKeyMaterial;
const IDENTIFIERS = KEY_MATERIAL.identifiers as {
  readonly hubOrigin: string;
  readonly nodeId: string;
  readonly prekeyId: string;
  readonly continuityId: string;
  readonly accountId: string;
};
const TIMESTAMPS = KEY_MATERIAL.timestamps as { readonly now: number };

export const FIXTURE_HUB_ORIGIN = IDENTIFIERS.hubOrigin;
export const FIXTURE_NODE_ID = IDENTIFIERS.nodeId;
export const FIXTURE_ACCOUNT_ID = IDENTIFIERS.accountId;
export const FIXTURE_NOW = TIMESTAMPS.now;
export const FIXTURE_NODE_IDENTITY_PUBLIC_KEY = fixtureBytes(KEY_MATERIAL.nodeIdentityPublicKey);
export const FIXTURE_NODE_AGREEMENT_PUBLIC_KEY = fixtureBytes(KEY_MATERIAL.nodeAgreementPublicKey);
const FIXTURE_NODE_AGREEMENT_SECRET_KEY = fixtureBytes(KEY_MATERIAL.testOnlyNodeAgreementSecretKey);

/**
 * The §5.3 carrier for one committed F03 statement.
 *
 * The carrier framing is recomputed here rather than carried, so a change to
 * §5.3's tag or bounds shows up as a failure in this suite too.
 */
export function fixtureStatement(name: string): Uint8Array {
  return fixtureBytes(fixtureCase(F03, name).inputs.statement);
}

/** The one committed statement whose §7.6 element 14 admits this tier's NX. */
export const USABLE_STATEMENT_CASE = "admitted-pattern-set-ik-and-nx-evaluated-as-web";

/**
 * The §8.3 material the node ADVERTISED, read off the statement it advertised.
 *
 * Derived rather than restated: §8.3 requires the two endpoints' context blocks
 * to be byte-equal, and a hand-written copy of the node's own advertisement is
 * how they silently stop being — the node then answers `P13 context_mismatch`
 * for a reason that has nothing to do with the case under test.
 */
export function advertisedFromStatement(statement: Uint8Array): E2eeAdvertisedChannelMaterial {
  const decoded = decodeNodeE2eeCapabilityStatement(statement);
  if (decoded.kind !== "ok") throw new Error(`fixture statement did not decode: ${decoded.kind}`);
  const value = decoded.value;
  return {
    nodeId: value.nodeId,
    nodeIdentityFingerprint: e2eeKeyFingerprint("node-identity", value.identityPublicKey),
    prekeyId: value.prekeyCertificate.prekeyId,
    agreementPublicKey: value.prekeyCertificate.agreementPublicKey,
    continuityChainTranscripts: value.continuityChain.map((entry) => entry.transcript),
    continuityId: value.continuityId,
  };
}

/**
 * The node half of one handshake, as a hostile or an honest relay would run it.
 *
 * `agreementSecretKey` is separated from `advertised.agreementPublicKey` on
 * purpose: passing a substituted secret is exactly §16.3 F7's responder-static
 * case, and the node then builds a completely well-formed accept whose Noise
 * static is not the key it advertised.
 */
export function respondAsNode(
  hello: Uint8Array,
  options: {
    readonly now?: number;
    readonly agreementSecretKey?: Uint8Array;
    readonly advertised?: E2eeAdvertisedChannelMaterial;
  } = {},
) {
  const advertised: E2eeAdvertisedChannelMaterial =
    options.advertised ?? advertisedFromStatement(fixtureStatement(USABLE_STATEMENT_CASE));
  const channel: E2eeHandshakeChannel = {
    hubOrigin: FIXTURE_HUB_ORIGIN,
    channelId: RELAY_CHANNEL_ID,
    relayProtocolMajor: RELAY_VERSION.protocolMajor,
    relayProtocolMinor: RELAY_VERSION.protocolMinor,
    channelOpenCapability: "ryco.rpc",
    channelOpenEffectiveRole: "operator",
  };
  const now = options.now ?? FIXTURE_NOW;
  const node = new E2eeNodeHandshake({
    channel,
    advertised,
    advertisedVersionMin: 1,
    advertisedVersionMax: 1,
    agreementSecretKey: options.agreementSecretKey ?? FIXTURE_NODE_AGREEMENT_SECRET_KEY,
    advertisementEmittedAt: now,
    readPolicy: () => ({
      requireApprovedClientE2EE: false,
      suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
    }),
  });
  return node.receiveHello(hello, now);
}
