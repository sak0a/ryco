import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import {
  RELAY_INITIAL_LIMITS,
  type RelayChannelId,
  type RelayCloseReason,
  type RelayDataFrame,
  type RelayFrame,
  type RelayLimits,
} from "@ryco/contracts/relay";
import { decodeRelayFrame } from "@ryco/shared/relayCodec";
import {
  E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
  E2EE_EPOCH_MAX,
  E2EE_HANDSHAKE_REJECT_BYTES,
  E2EE_PREKEY_LIFETIME,
  E2EE_REKEY_MAX_RECORDS,
} from "@ryco/shared/relayE2eeConstants";
import {
  E2EE_ERROR_CODE_POLICY,
  E2EE_ERROR_CODE_PROTOCOL_VIOLATION,
  E2eeCloseMachine,
  decodeE2eeCloseRecordBody,
  decodeE2eeErrorRecordBody,
  type E2eeCloseRecordToSend,
  type E2eeSequencePosition,
} from "@ryco/shared/relayE2eeClose";
import {
  E2eeClientHandshake,
  type E2eeClientAuthorization,
  type E2eeClientHandshakeCredentials,
  type E2eeHandshakeChannel,
} from "@ryco/shared/relayE2eeHandshake";
import { deriveE2eeAgreementPublicKey } from "@ryco/shared/relayE2eeKeys";
import {
  E2eeRecordSession,
  type E2eeDirectionState,
  type E2eeSyntheticDirectionState,
} from "@ryco/shared/relayE2eeSession";
import {
  encodeClientE2eePrekeyTranscript,
  encodeNodeE2eePrekeyTranscript,
} from "@ryco/shared/relayE2eeTranscripts";
import {
  E2EE_INNER_TYPE_CLOSE,
  E2EE_INNER_TYPE_CLOSE_ACK,
  E2EE_INNER_TYPE_ERROR,
  E2EE_INNER_TYPE_RPC,
  E2EE_NEGOTIATION_TYPE_CLIENT_HELLO,
  E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT,
  E2EE_SUITE_25519_CHACHAPOLY_SHA256,
  classifyPostStripPayload,
  decodeE2eeNegotiationRecord,
  encodeE2eeHandshakeReject,
  encodeE2eeNegotiationRecord,
  type E2eeInnerRecordType,
} from "@ryco/shared/relayE2eeWire";
import { prepareRelayMessage, RelayMessageAssembler } from "@ryco/shared/relayMessageChunks";

import {
  makeNodeE2eeCapabilityStatementClient,
  type NodeE2eeAdvertisement,
  type NodeE2eeAdvertisementResult,
} from "../hubIdentity/NodeE2eeCapabilityStatement.ts";
import {
  makeNodeE2eePolicyClient,
  type NodeE2eeChannelRegistration,
  type NodeE2eePolicyWithdrawalCounts,
} from "../hubIdentity/NodeE2eePolicyClient.ts";
import {
  e2eePolicyNarrows,
  effectiveNodeE2eePolicy,
  initialNodeE2eePolicyRecord,
  nodeE2eeAdmissionPolicyOf,
  type EffectiveNodeE2eePolicy,
  type NodeE2eePolicyRecordFile,
  type NodeE2eePolicyStore,
} from "../hubIdentity/NodeE2eePolicyStore.ts";
import type { NodeE2eePrekeyCertificate } from "../hubIdentity/NodeE2eePrekeyClient.ts";
import { makeNodeE2eeChannelAdvertiser } from "./NodeE2eeChannelAdvertiser.ts";
import {
  makeNodeE2eeChannelSession,
  makeNodeE2eeHandshakeRateLimiter,
  NODE_E2EE_RECEIVE_FATAL_ROWS,
  type NodeE2eeChannelAuthorization,
  type NodeE2eeChannelSession,
} from "./NodeE2eeChannelSession.ts";
import {
  makeNodeE2eeRelayChannelSession,
  nodeE2eeChannelPlaintextCeiling,
} from "./NodeE2eeRelayChannel.ts";
import { RelayChannelRegistry, type RelayRpcChannelSession } from "./RelayChannelRegistry.ts";
import { RelaySendQueue } from "./RelaySendQueue.ts";

// The node's E2EE layer on the real relay path: the §4.4 mode machine, the §8.6
// responder, the §9 record session with its §9.3 admission, the §10 close, and
// §11's observables — driven through a real `RelayChannelRegistry` and a real
// `RelaySendQueue`, against a really signed §5.2 statement and Phase 1's real
// client handshake.
//
// EVERY INBOUND PAYLOAD GOES IN AS A RELAY `data` FRAME and every assertion is
// made against bytes the send queue put on the socket, so nothing here can pass
// while the seam it is about is bypassed.
//
// TEST-ONLY KEY MATERIAL. The Ed25519 identity is generated per run; the X25519
// and P-256 material is the published RFC vector material `relayE2eeHandshake`'s
// own suite pins, so a wrong curve or encoding shows up immediately. NONE OF IT
// MAY EVER REACH A REAL ENDPOINT.

const HUB_ORIGIN = "https://relay.example";
const NODE_ID = `node_${"N".repeat(22)}`;
const IDENTITY_KEY_ID = `nkey_${"K".repeat(22)}`;
const PREKEY_ID = `epk_${"P".repeat(22)}`;
const CONTINUITY_ID = `nct_${"C".repeat(22)}`;
const ACCOUNT_ID = "acct_0123456789";
const CHANNEL_ID = `ch_${"A".repeat(22)}` as RelayChannelId;
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const version = { protocolMajor: 1, protocolMinor: 2 } as const;
const limits: RelayLimits = RELAY_INITIAL_LIMITS;
const CAPABILITY = "ryco.rpc" as const;
const ROLE = "owner" as const;
const NOW = 1_784_160_030_000;

/** Let every pending microtask run: `protect` is serialized and asynchronous. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const hex = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, "hex"));
const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

const NODE_AGREEMENT_SECRET = hex(
  "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb",
);
const NODE_AGREEMENT_PUBLIC = deriveE2eeAgreementPublicKey(NODE_AGREEMENT_SECRET);
const CLIENT_AGREEMENT_SECRET = hex(
  "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",
);
const CLIENT_AGREEMENT_PUBLIC = deriveE2eeAgreementPublicKey(CLIENT_AGREEMENT_SECRET);
/**
 * The client device key (§7.1), generated per run through the platform's own
 * P-256 implementation.
 *
 * `ieee-p1363` is the raw `r ‖ s` encoding §7.1 fixes; DER would be rejected by
 * the certificate verifier, which is the point of naming it here rather than
 * relying on a default.
 */
const clientIdentity = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const CLIENT_IDENTITY_PUBLIC = Uint8Array.from(
  clientIdentity.publicKey.export({ format: "der", type: "spki" }).subarray(-65),
);
const signClientPrekey = (transcript: Uint8Array): Uint8Array =>
  Uint8Array.from(
    sign("sha256", transcript, {
      key: clientIdentity.privateKey,
      dsaEncoding: "ieee-p1363",
    }),
  );

const APPROVED: E2eeClientAuthorization = {
  status: "approved",
  maxRole: ROLE,
  capabilitySet: [CAPABILITY],
};

const PERMISSIVE_POLICY = effectiveNodeE2eePolicy({
  requireE2EE: false,
  requireApprovedClientE2EE: false,
  suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
});

const REQUIRE_E2EE_POLICY = effectiveNodeE2eePolicy({
  requireE2EE: true,
  requireApprovedClientE2EE: false,
  suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
});

function decodeFrame(bytes: Uint8Array): RelayFrame {
  const result = decodeRelayFrame(bytes);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

/** The relay chunk layer's own prelude, stripped exactly as a receiver does. */
function stripPrelude(payload: Uint8Array): Uint8Array {
  const assembler = new RelayMessageAssembler();
  const result = assembler.push(payload);
  if (result.kind !== "done") throw new Error("expected one complete message");
  return result.message;
}

/**
 * A real §5.2 statement client over real Ed25519 custody.
 *
 * One per harness, and the same instance answers the node's advertiser and the
 * test's client: §8.3 gives the client's element 15 exactly one source — the
 * statement it validated on this channel — so the material a client uses must be
 * the material the node advertised, not a second statement that merely looks
 * like it.
 */
function statementClient(policy: () => EffectiveNodeE2eePolicy) {
  const { privateKey } = generateKeyPairSync("ed25519");
  const der = Buffer.from(privateKey.export({ format: "der", type: "pkcs8" }));
  const identityPublicKey = Uint8Array.from(
    createPublicKey(privateKey)
      .export({ format: "der", type: "spki" })
      .subarray(SPKI_PREFIX.byteLength),
  );
  const signBytes = (message: Uint8Array): Uint8Array =>
    Uint8Array.from(
      sign(null, message, createPrivateKey({ key: der, format: "der", type: "pkcs8" })),
    );
  const prekey: NodeE2eePrekeyCertificate = {
    hubOrigin: HUB_ORIGIN,
    nodeId: NODE_ID,
    identityKeyId: IDENTITY_KEY_ID,
    prekeyId: PREKEY_ID,
    agreementPublicKey: NODE_AGREEMENT_PUBLIC,
    createdAt: 1_000,
    expiresAt: 9_000_000_000_000,
    crossSignature: signBytes(
      encodeNodeE2eePrekeyTranscript({
        hubOrigin: HUB_ORIGIN,
        nodeId: NODE_ID,
        identityKeyId: IDENTITY_KEY_ID,
        prekeyId: PREKEY_ID,
        identityPublicKey,
        agreementPublicKey: NODE_AGREEMENT_PUBLIC,
        createdAt: 1_000,
        expiresAt: 9_000_000_000_000,
      }),
    ),
  };
  return makeNodeE2eeCapabilityStatementClient({
    identity: async () => ({
      nodeId: NODE_ID,
      identityKeyId: IDENTITY_KEY_ID,
      identityPublicKey,
      sign: async (envelope) => signBytes(envelope),
    }),
    prekey: async () => prekey,
    continuity: async () => ({ continuityId: CONTINUITY_ID, chain: [] }),
    policy,
    generation: () => 3,
    now: () => NOW,
  });
}

/**
 * An in-memory §12.6 policy store with the real commit semantics and no
 * durability, so a test can run the REAL `NodeE2eePolicyClient` — its ordered
 * procedure, its single snapshot, and its dispatch by phase — against a real
 * channel session.
 */
function stubPolicyStore(): NodeE2eePolicyStore {
  let record: NodeE2eePolicyRecordFile = initialNodeE2eePolicyRecord();
  const apply = (next: NodeE2eePolicyRecordFile) => {
    const previous = effectiveNodeE2eePolicy(nodeE2eeAdmissionPolicyOf(record));
    const policy = effectiveNodeE2eePolicy(nodeE2eeAdmissionPolicyOf(next));
    record = next;
    return {
      record: next,
      policy,
      previous,
      withdrawal: e2eePolicyNarrows(previous, policy),
      changed: true,
    };
  };
  return {
    read: async () => ({
      record,
      policy: effectiveNodeE2eePolicy(nodeE2eeAdmissionPolicyOf(record)),
    }),
    commit: async (proposal) =>
      apply({
        ...record,
        revision: record.revision + 1,
        generation: record.generation + 1,
        requireE2EE: proposal.requireE2EE ?? record.requireE2EE,
        requireApprovedClientE2EE:
          proposal.requireApprovedClientE2EE ?? record.requireApprovedClientE2EE,
        suiteRegistry: proposal.suiteRegistry ?? record.suiteRegistry,
      }),
    recoverGeneration: async () =>
      apply({ ...record, revision: record.revision + 1, generation: record.generation + 1 }),
  };
}

/** A policy registration that admits everything, so a test isolates one rule. */
function permissiveRegistration(): NodeE2eeChannelRegistration {
  return {
    selectHandshake: () => ({
      establish: () => ({ kind: "entered", established: () => undefined }),
    }),
    lockLegacy: () => ({ kind: "entered" }),
    release: () => undefined,
  };
}

function authorizationFor(
  record: E2eeClientAuthorization | undefined,
): NodeE2eeChannelAuthorization {
  return {
    lookupClientAuthorization: () => record,
    reReadAuthorization: () => record,
    registerInFlightHandshake: () => ({
      establish: () => ({
        kind: "entered",
        release: () => undefined,
        established: () => undefined,
      }),
      release: () => undefined,
    }),
  };
}

interface Harness {
  readonly dataPayloads: () => readonly Uint8Array[];
  readonly closeReasons: () => readonly (RelayCloseReason | undefined)[];
  readonly deliveredToParser: readonly Uint8Array[];
  readonly session: () => NodeE2eeChannelSession;
  /** The registry-facing channel, exactly as `HubConnectorLive` binds it. */
  readonly channel: () => RelayRpcChannelSession;
  /** How many times the RPC runtime behind the channel was released. */
  readonly releases: () => number;
  readonly open: () => Promise<NodeE2eeAdvertisement>;
  /** Open a channel whose advertisement this node cannot produce (§5.5). */
  readonly openRaw: () => Promise<void>;
  readonly deliver: (payload: Uint8Array) => Promise<void>;
  /** The peer tore the channel down: the registry's own teardown path. */
  readonly closeFromPeer: () => Promise<void>;
  readonly flush: () => void;
  readonly sendQueue: RelaySendQueue;
  readonly fallbacks: () => number;
  /** The node-local §11.4 diagnostic rows, for asserting WHICH rule fired. */
  readonly rows: () => readonly string[];
}

/**
 * The node, assembled from the real relay pieces.
 *
 * `RelayChannelRegistry` supplies the send handle, the §9.3 admission handle,
 * the close handle, and the acceptance announcement. The channel session's
 * `intercept` sits exactly where `RpcByteSession` puts it — after the relay
 * message assembler and before the RPC parser — so `deliveredToParser` is
 * literally the set of bytes that would reach the parser and nothing else.
 */
async function harness(
  options: {
    readonly policy?: () => EffectiveNodeE2eePolicy;
    readonly authorization?: NodeE2eeChannelAuthorization;
    readonly registration?: () => NodeE2eeChannelRegistration;
    /** §5.5: what this node's statement builder answers, when a test needs U2. */
    readonly readAdvertisement?: () => Promise<NodeE2eeAdvertisementResult>;
    /** §5.5 U1: an asserted chunk limit below `E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES`. */
    readonly maxDataChunkBytes?: number;
    /**
     * Runs inside `withPrekeySecret`, after the borrow's body has returned and
     * before the borrow resolves — the exact window a §12.6 sweep can land in
     * while a hello is being processed.
     */
    readonly afterPrekeyBorrow?: () => Promise<void>;
    /** §16.3 F9: place the node's send direction at §9.6's exhaustion boundary. */
    readonly syntheticSendState?: E2eeSyntheticDirectionState;
  } = {},
): Promise<Harness> {
  const readyLimits: RelayLimits =
    options.maxDataChunkBytes === undefined
      ? RELAY_INITIAL_LIMITS
      : { ...RELAY_INITIAL_LIMITS, maxDataChunkBytes: options.maxDataChunkBytes };
  const sent: Uint8Array[] = [];
  const socket = {
    bufferedAmount: 0,
    send: (bytes: Uint8Array) => {
      sent.push(Uint8Array.from(bytes));
    },
  };
  const sendQueue = new RelaySendQueue(socket, readyLimits);
  const policy = options.policy ?? (() => PERMISSIVE_POLICY);
  const statements = statementClient(policy);
  const advertiser = makeNodeE2eeChannelAdvertiser({
    hubOrigin: HUB_ORIGIN,
    readAdvertisement:
      options.readAdvertisement ?? ((hubOrigin) => statements.advertised(hubOrigin)),
    policy,
    recordFallback: async () => undefined,
  });
  const deliveredToParser: Uint8Array[] = [];
  const assembler = new RelayMessageAssembler();
  let channelSession: NodeE2eeChannelSession | undefined;
  let relayChannel: RelayRpcChannelSession | undefined;
  let releases = 0;
  let fallbacks = 0;
  let inboundSequence = 0;
  const rows: string[] = [];

  const registry = new RelayChannelRegistry({
    limits: readyLimits,
    sendQueue,
    onOutboundReady: () => sendQueue.flush(),
    factory: {
      connectionReady: ({ limits: ready }) =>
        advertiser.connectionReady({ maxDataChunkBytes: ready.maxDataChunkBytes }),
      open: async ({ channelId, capability, effectiveRole, send, admit, close }) => {
        const announcement = await advertiser.openChannel();
        const e2ee = makeNodeE2eeChannelSession({
          channel: {
            hubOrigin: HUB_ORIGIN,
            channelId,
            relayProtocolMajor: version.protocolMajor,
            relayProtocolMinor: version.protocolMinor,
            channelOpenCapability: capability,
            channelOpenEffectiveRole: effectiveRole,
          },
          announcement,
          plaintextCeiling: nodeE2eeChannelPlaintextCeiling(readyLimits),
          send,
          admit,
          close,
          policy,
          registerPolicyChannel: options.registration ?? permissiveRegistration,
          authorization: options.authorization ?? authorizationFor(APPROVED),
          withPrekeySecret: async (prekeyId, use) => {
            expect(prekeyId).toBe(PREKEY_ID);
            const result = await use(NODE_AGREEMENT_SECRET);
            await options.afterPrekeyBorrow?.();
            return result;
          },
          rateLimiter: makeNodeE2eeHandshakeRateLimiter(),
          recordPeerLegacyFallback: () => {
            fallbacks += 1;
          },
          onDiagnostic: (value) => rows.push(value.row),
          ...(options.syntheticSendState === undefined
            ? {}
            : { testOnlySyntheticSendState: options.syntheticSendState }),
        });
        channelSession = e2ee;
        // The binding `HubConnectorLive` uses, over the same pipeline
        // `RpcByteSession` provides: reassemble and strip the prelude, then
        // discriminate. Nothing reaches `deliveredToParser` except an `rpc`
        // disposition, which is what the parser boundary is.
        relayChannel = makeNodeE2eeRelayChannelSession({
          e2ee,
          rpc: {
            receive: async (bytes) => {
              const assembled = assembler.push(bytes);
              if (assembled.kind === "error") throw new Error(assembled.reason);
              if (assembled.kind === "pending") return true;
              const disposition = await e2ee.intercept(assembled.message);
              if (disposition.kind === "rpc") deliveredToParser.push(disposition.message);
              return disposition.kind !== "rejected";
            },
            queuedBytes: async () => 0,
            supportsChunkedMessages: () => assembler.peerSupportsChunking,
            incompleteReassembly: () => assembler.incompleteMessage,
          },
          release: async () => {
            releases += 1;
          },
        });
        return relayChannel;
      },
    },
  });

  const frames = (): readonly RelayFrame[] => sent.map(decodeFrame);
  return {
    dataPayloads: () =>
      frames()
        .filter((frame): frame is RelayDataFrame => frame.type === "data")
        .map((frame) => Uint8Array.from(frame.payload)),
    closeReasons: () =>
      frames()
        .filter(
          (frame): frame is Extract<RelayFrame, { type: "channel.close" }> =>
            frame.type === "channel.close",
        )
        .map((frame) => frame.reason),
    deliveredToParser,
    session: () => {
      if (channelSession === undefined) throw new Error("channel is not open");
      return channelSession;
    },
    channel: () => {
      if (relayChannel === undefined) throw new Error("channel is not open");
      return relayChannel;
    },
    releases: () => releases,
    openRaw: async () => {
      await registry.handle({
        type: "channel.open",
        ...version,
        channelId: CHANNEL_ID,
        capability: CAPABILITY,
        effectiveRole: ROLE,
      });
      sendQueue.flush();
    },
    open: async () => {
      await registry.handle({
        type: "channel.open",
        ...version,
        channelId: CHANNEL_ID,
        capability: CAPABILITY,
        effectiveRole: ROLE,
      });
      sendQueue.flush();
      const result = await statements.advertised(HUB_ORIGIN);
      if (result.kind !== "available") throw new Error(result.reason);
      return result.advertisement;
    },
    deliver: async (payload) => {
      await registry.handle({
        type: "data",
        ...version,
        channelId: CHANNEL_ID,
        sequence: inboundSequence as RelayDataFrame["sequence"],
        payload,
      });
      inboundSequence += 1;
      // The registry defers every close it schedules to a microtask, so a
      // caller that asserts on the wire has to let those run first.
      await Promise.resolve();
      await Promise.resolve();
      sendQueue.flush();
    },
    closeFromPeer: async () => {
      await registry.handle({ type: "channel.close", ...version, channelId: CHANNEL_ID });
      await Promise.resolve();
      sendQueue.flush();
    },
    flush: () => sendQueue.flush(),
    sendQueue,
    fallbacks: () => fallbacks,
    rows: () => rows,
  };
}

function nativeCredentials(): E2eeClientHandshakeCredentials {
  const transcript = encodeClientE2eePrekeyTranscript({
    hubOrigin: HUB_ORIGIN,
    accountId: ACCOUNT_ID,
    identityPublicKey: CLIENT_IDENTITY_PUBLIC,
    agreementPublicKey: CLIENT_AGREEMENT_PUBLIC,
    createdAt: NOW - 1_000,
    // §6.4 bounds the certificate's whole lifetime, not just its expiry.
    expiresAt: NOW - 1_000 + E2EE_PREKEY_LIFETIME,
  });
  return {
    tier: "native",
    accountId: ACCOUNT_ID,
    identityPublicKey: CLIENT_IDENTITY_PUBLIC,
    agreementPublicKey: CLIENT_AGREEMENT_PUBLIC,
    agreementSecretKey: CLIENT_AGREEMENT_SECRET,
    prekeyTranscript: transcript,
    prekeySignature: signClientPrekey(transcript),
  };
}

const clientChannel: E2eeHandshakeChannel = {
  hubOrigin: HUB_ORIGIN,
  channelId: CHANNEL_ID,
  relayProtocolMajor: version.protocolMajor,
  relayProtocolMinor: version.protocolMinor,
  channelOpenCapability: CAPABILITY,
  channelOpenEffectiveRole: ROLE,
};

interface EstablishedClient {
  readonly record: E2eeRecordSession;
  readonly close: E2eeCloseMachine;
}

const positionOf = (state: E2eeDirectionState): E2eeSequencePosition => {
  if (state.epoch === undefined || state.counter === undefined) {
    throw new Error("direction is exhausted");
  }
  return { epoch: state.epoch, counter: state.counter };
};

/**
 * Drive a whole handshake against the harness and return the client's session.
 *
 * The node is a real relay channel throughout: the hello goes in as a `data`
 * frame the assembler strips, and the accept comes back out of the send queue.
 */
async function establish(
  node: Harness,
  tier: "native" | "web",
  advertisement: NodeE2eeAdvertisement,
): Promise<EstablishedClient> {
  const client = new E2eeClientHandshake({
    channel: clientChannel,
    // §8.3: the client's node material has one source — the statement it
    // validated on this channel.
    advertised: advertisement.material,
    selectedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    offeredSuites: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
    credentials: tier === "native" ? nativeCredentials() : { tier: "web" },
    intendedCapability: CAPABILITY,
    intendedRole: ROLE,
  });
  const hello = client.createHello(NOW);
  if (hello.kind !== "hello") throw new Error(`hello: ${JSON.stringify(hello)}`);
  const before = node.dataPayloads().length;
  await node.deliver(hello.record);
  const accept = node.dataPayloads().slice(before);
  expect(accept).toHaveLength(1);
  const established = client.receiveServerAccept(stripPrelude(accept[0]!), NOW);
  if (established.kind !== "established") {
    throw new Error(`accept: ${JSON.stringify(established)} rows=${node.rows().join(",")}`);
  }
  return {
    record: new E2eeRecordSession({
      secrets: established.secrets,
      suite: established.suite,
      sessionBindingHash: established.sessionBindingHash,
      sendDirection: "c2n",
      plaintextCeiling: 512 * 1_024,
    }),
    close: new E2eeCloseMachine({
      sessionBindingHash: established.sessionBindingHash,
      sendDirection: "c2n",
    }),
  };
}

/** Protect one client record and hand the envelope to the node as a data frame. */
async function clientSend(
  node: Harness,
  client: EstablishedClient,
  innerType: E2eeInnerRecordType,
  body: Uint8Array,
): Promise<{ readonly epoch: bigint; readonly counter: bigint; readonly epochCompleted: boolean }> {
  let envelope: Uint8Array | undefined;
  const result = await client.record.protect({
    innerType,
    body,
    admit: () => true,
    transmit: (bytes) => {
      envelope = Uint8Array.from(bytes);
      return { kind: "sent" };
    },
  });
  if (result.kind !== "protected" || envelope === undefined) {
    throw new Error(`client protect: ${JSON.stringify(result)}`);
  }
  await node.deliver(envelope);
  return {
    epoch: result.epoch,
    counter: result.counter,
    epochCompleted: result.epochCompleted,
  };
}

async function clientSendCloseRecord(
  node: Harness,
  client: EstablishedClient,
  toSend: E2eeCloseRecordToSend,
): Promise<void> {
  const sent = await clientSend(node, client, toSend.innerType, toSend.body);
  client.close.noteTransmitted({ record: toSend, ...sent, at: NOW });
}

/** Authenticate one node-to-client payload and hand it to the client's close machine. */
function clientReceive(client: EstablishedClient, payload: Uint8Array) {
  const authenticated = client.record.unprotect(stripPrelude(payload));
  if (authenticated.kind !== "authenticated") {
    throw new Error(`client unprotect: ${JSON.stringify(authenticated)}`);
  }
  return authenticated;
}

describe("NodeE2eeChannelSession", () => {
  it("completes a full IK handshake and carries RPC as envelopes", async () => {
    const node = await harness();
    const advertisement = await node.open();
    // §5.4: the carrier is the first node-to-client data payload.
    expect(node.dataPayloads()).toHaveLength(1);
    expect(classifyPostStripPayload(stripPrelude(node.dataPayloads()[0]!)).kind).toBe(
      "legacy-json",
    );

    const client = await establish(node, "native", advertisement);
    expect(node.session().mode()).toBe("e2ee");
    expect(node.deliveredToParser).toHaveLength(0);

    await clientSend(node, client, E2EE_INNER_TYPE_RPC, utf8('{"_tag":"Ping"}'));
    expect(node.deliveredToParser).toHaveLength(1);
    expect(new TextDecoder().decode(node.deliveredToParser[0]!)).toBe('{"_tag":"Ping"}');

    // The node's own response goes out as an envelope, not as plaintext.
    const before = node.dataPayloads().length;
    expect(await node.session().emit(utf8('{"_tag":"Pong"}'))).toBe(true);
    node.flush();
    const emitted = node.dataPayloads().slice(before);
    expect(emitted).toHaveLength(1);
    expect(classifyPostStripPayload(stripPrelude(emitted[0]!)).kind).toBe("envelope");
    const authenticated = clientReceive(client, emitted[0]!);
    expect(authenticated.innerType).toBe(E2EE_INNER_TYPE_RPC);
    expect(new TextDecoder().decode(authenticated.body)).toBe('{"_tag":"Pong"}');
  });

  it("completes a full NX handshake with no client identity", async () => {
    // NX carries no Branch A record, so the node holds none for it: §12.4's
    // policy is what admits the channel.
    const node = await harness({ authorization: authorizationFor(undefined) });
    const advertisement = await node.open();
    const client = await establish(node, "web", advertisement);
    expect(node.session().mode()).toBe("e2ee");
    await clientSend(node, client, E2EE_INNER_TYPE_RPC, utf8('{"_tag":"Ping"}'));
    expect(node.deliveredToParser).toHaveLength(1);
  });

  it("delivers nothing to the RPC parser before the implicit client finish", async () => {
    const node = await harness();
    const advertisement = await node.open();
    await establish(node, "native", advertisement);
    // Row N3 has been taken and session keys exist, but §8.9's finish has not
    // authenticated: the node may emit no application RPC and invoke no handler.
    expect(node.deliveredToParser).toHaveLength(0);
    expect(await node.session().emit(utf8('{"_tag":"Pong"}'))).toBe(false);
    node.flush();
    expect(node.dataPayloads()).toHaveLength(2); // the carrier and the accept
  });

  it("never lets plaintext after E2EE reach the RPC parser", async () => {
    const node = await harness();
    const advertisement = await node.open();
    const client = await establish(node, "native", advertisement);
    await clientSend(node, client, E2EE_INNER_TYPE_RPC, utf8('{"_tag":"Ping"}'));
    expect(node.deliveredToParser).toHaveLength(1);

    const before = node.dataPayloads().length;
    await node.deliver(utf8('{"_tag":"Ping"}'));
    // Row N11 / §11.3 Q6: nothing more reaches the parser, exactly one
    // length-uniform encrypted record goes out, and the channel closes with
    // `channel_rejected`.
    expect(node.deliveredToParser).toHaveLength(1);
    expect(node.session().mode()).toBe("closed");
    const emitted = node.dataPayloads().slice(before);
    expect(emitted).toHaveLength(1);
    const error = clientReceive(client, emitted[0]!);
    expect(error.innerType).toBe(E2EE_INNER_TYPE_ERROR);
    const body = decodeE2eeErrorRecordBody(error.body);
    if (body.kind !== "ok") throw new Error("expected a conforming error body");
    expect(body.value.errorCode).toBe(E2EE_ERROR_CODE_PROTOCOL_VIOLATION);
    expect(node.closeReasons()).toEqual(["channel_rejected"]);
  });

  it("consumes no counter and emits no bytes when a send is not admitted", async () => {
    const node = await harness();
    const advertisement = await node.open();
    const client = await establish(node, "native", advertisement);
    await clientSend(node, client, E2EE_INNER_TYPE_RPC, utf8('{"_tag":"Ping"}'));

    const session = node.session();
    expect(await session.emit(utf8("first"))).toBe(true);
    node.flush();
    const afterFirst = node.dataPayloads().length;
    // Authenticated, so the client's §9.2 expectation is exactly one past it.
    expect(clientReceive(client, node.dataPayloads()[afterFirst - 1]!).counter).toBe(0n);

    // Hold the whole data budget, so the §9.3 admission probe refuses. Nothing
    // else about the channel changes.
    const dataCapacity = limits.maxQueuedBytes - limits.maxControlFrameBytes;
    expect(node.sendQueue.reserveData(CHANNEL_ID, dataCapacity)).toBe(true);
    expect(await session.emit(utf8("refused"))).toBe(false);
    node.flush();

    // THE CARRY-FORWARD (§9.3, §11.4): no wire record of any kind, and the
    // channel is unaffected and remains usable.
    expect(node.dataPayloads()).toHaveLength(afterFirst);
    expect(session.mode()).toBe("e2ee");

    node.sendQueue.releaseReservation(CHANNEL_ID, dataCapacity);
    expect(await session.emit(utf8("second"))).toBe(true);
    node.flush();
    const emitted = node.dataPayloads().slice(afterFirst);
    expect(emitted).toHaveLength(1);

    // AND NO COUNTER WAS CONSUMED, proven by the peer's own §9.2 rule rather
    // than by reading the node's state: the receiver's expected next pair is
    // still the one the refused send would have taken, and a consumed-then-
    // discarded pair would make this a fatal `sequence_mismatch` gap.
    const authenticated = clientReceive(client, emitted[0]!);
    expect(new TextDecoder().decode(authenticated.body)).toBe("second");
    expect(authenticated.counter).toBe(1n);
  });

  it("drains the node's close records before the outer channel.close", async () => {
    const node = await harness();
    const advertisement = await node.open();
    const client = await establish(node, "native", advertisement);
    await clientSend(node, client, E2EE_INNER_TYPE_RPC, utf8('{"_tag":"Ping"}'));

    // The client initiates; the node is the sequential responder of §10.2.
    const before = node.dataPayloads().length;
    await clientSendCloseRecord(
      node,
      client,
      client.close.buildClose({
        sendPosition: positionOf(client.record.sendState),
        expectedRecv: positionOf(client.record.receiveState),
      }),
    );
    const ackPayloads = node.dataPayloads().slice(before);
    expect(ackPayloads).toHaveLength(1);
    const ack = clientReceive(client, ackPayloads[0]!);
    expect(ack.innerType).toBe(E2EE_INNER_TYPE_CLOSE_ACK);
    expect(decodeE2eeCloseRecordBody(ack.body).kind).toBe("ok");
    // §10.3's lower bound: the ack is on the wire and the outer close has NOT
    // been emitted — the node still owes a wait for the final confirmation.
    expect(node.closeReasons()).toEqual([]);

    const received = client.close.receive({
      innerType: ack.innerType,
      body: ack.body,
      envelope: { epoch: ack.epoch, counter: ack.counter },
      epochCompleted: ack.epochCompleted,
      currentNextSend: positionOf(client.record.sendState),
      at: NOW,
    });
    expect(received.kind).toBe("close_ack");
    await clientSendCloseRecord(
      node,
      client,
      client.close.buildCloseAck({
        sendPosition: positionOf(client.record.sendState),
        expectedRecv: positionOf(client.record.receiveState),
      }),
    );
    // The exchange completed, so the outer close carries no reason at all
    // (§10.3), and the node's verdict is Clean (§10.4).
    expect(node.closeReasons()).toEqual([undefined]);
    expect(node.session().verdict()).toBe("clean");
    // The last data frame on the wire is still the node's ack: the close frame
    // followed it rather than overtaking it.
    const payloads = node.dataPayloads();
    expect(payloads[payloads.length - 1]).toEqual(ackPayloads[0]);
  });

  it("runs the initiator half of the close and lingers before the outer close", async () => {
    const node = await harness();
    const advertisement = await node.open();
    const client = await establish(node, "native", advertisement);
    await clientSend(node, client, E2EE_INNER_TYPE_RPC, utf8('{"_tag":"Ping"}'));

    const session = node.session();
    const before = node.dataPayloads().length;
    const closing = session.beginClose();
    await settle();
    node.flush();
    const closePayloads = node.dataPayloads().slice(before);
    expect(closePayloads).toHaveLength(1);
    const close = clientReceive(client, closePayloads[0]!);
    expect(close.innerType).toBe(E2EE_INNER_TYPE_CLOSE);
    expect(
      client.close.receive({
        innerType: close.innerType,
        body: close.body,
        envelope: { epoch: close.epoch, counter: close.counter },
        epochCompleted: close.epochCompleted,
        currentNextSend: positionOf(client.record.sendState),
        at: NOW,
      }).kind,
    ).toBe("close");

    // §10.2 step 2: the responder acknowledges, and step 3 has the initiator
    // answer with the final confirmation.
    await clientSendCloseRecord(
      node,
      client,
      client.close.buildCloseAck({
        sendPosition: positionOf(client.record.sendState),
        expectedRecv: positionOf(client.record.receiveState),
      }),
    );
    await closing;
    const confirmations = node.dataPayloads().slice(before + 1);
    expect(confirmations).toHaveLength(1);
    const confirmation = clientReceive(client, confirmations[0]!);
    expect(confirmation.innerType).toBe(E2EE_INNER_TYPE_CLOSE_ACK);
    // §10.4: the verdict is fixed at completion, before and independently of the
    // outer close. §10.3: the initiator sent the last close-machine record, so
    // it lingers rather than closing on top of it.
    expect(session.verdict()).toBe("clean");
    expect(node.closeReasons()).toEqual([]);
    session.dispose();
  });

  it("gives every pre-key failure the same observable", async () => {
    const causes: readonly Uint8Array[] = [
      // §11.2 P5 (row N6): an envelope before establishment.
      Uint8Array.from([0x01, 0x01, 0x01, ...new Uint8Array(60)]),
      // §11.2 P6 (row N7): an unknown first byte.
      Uint8Array.from([0xfe, 0x00, 0x01]),
      // §11.2 P6: the ABSENT first byte — a zero-length post-strip payload.
      new Uint8Array(0),
      // §11.2 P3 (row N5): a correctly formed but misdirected negotiation
      // record — this one only ever travels node to client.
      encodeE2eeHandshakeReject(),
      // §11.2 P9 (§8.6 step 2): a hello whose wrapper this node refuses. The
      // handshake actually runs, which is exactly why it must look identical.
      encodeE2eeNegotiationRecord(E2EE_NEGOTIATION_TYPE_CLIENT_HELLO, Uint8Array.from([0x80])),
    ];
    const observables: unknown[] = [];
    for (const cause of causes) {
      const node = await harness();
      await node.open();
      const before = node.dataPayloads().length;
      await node.deliver(cause);
      observables.push({
        records: node
          .dataPayloads()
          .slice(before)
          .map((payload) => Buffer.from(stripPrelude(payload)).toString("hex")),
        closeReasons: node.closeReasons(),
        deliveredToParser: node.deliveredToParser.length,
      });
    }
    // §11.5: at most one `E2EEHandshakeReject`, byte-identical across all causes
    // and exactly `E2EE_HANDSHAKE_REJECT_BYTES` long; one `channel_rejected`;
    // zero application payload in either direction.
    const first = observables[0] as { readonly records: readonly string[] };
    for (const observable of observables) expect(observable).toEqual(first);
    expect(first.records).toHaveLength(1);
    const reject = Buffer.from(first.records[0]!, "hex");
    expect(reject).toHaveLength(E2EE_HANDSHAKE_REJECT_BYTES);
    const decoded = decodeE2eeNegotiationRecord(reject);
    if (decoded.kind !== "ok") throw new Error(decoded.reason);
    expect(decoded.value.recordType).toBe(E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT);
  });

  it("locks legacy on plaintext under the compatibility default and counts it once", async () => {
    const node = await harness();
    await node.open();
    await node.deliver(utf8('{"_tag":"Ping"}'));
    // Row N2: legacy is locked, the message is delivered, and exactly one
    // peer-legacy occurrence is recorded (§12.5).
    expect(node.session().mode()).toBe("legacy");
    expect(node.deliveredToParser).toHaveLength(1);
    expect(node.fallbacks()).toBe(1);

    const before = node.dataPayloads().length;
    await node.deliver(Uint8Array.from([0x01, 0x01, 0x01, ...new Uint8Array(60)]));
    // Row N13 / §11.2 P5: E2EE material after a legacy lock is FATAL-PRE, and
    // no session keys exist in `legacy`, so it is a reject and never an
    // `E2EEError`.
    expect(node.session().mode()).toBe("closed");
    expect(node.deliveredToParser).toHaveLength(1);
    expect(node.dataPayloads().slice(before)).toHaveLength(1);
    expect(node.closeReasons()).toEqual(["channel_rejected"]);
  });

  it("refuses plaintext outright under effective requireE2EE", async () => {
    const node = await harness({ policy: () => REQUIRE_E2EE_POLICY });
    await node.open();
    await node.deliver(utf8('{"_tag":"Ping"}'));
    // Row N1 / §11.2 P1: FATAL-PRE, nothing delivered, no legacy lock.
    expect(node.deliveredToParser).toHaveLength(0);
    expect(node.session().mode()).toBe("closed");
    expect(node.fallbacks()).toBe(0);
    expect(node.closeReasons()).toEqual(["channel_rejected"]);
  });

  it("gives the advertisement-unavailable rows the same pre-key observable", async () => {
    // §11.2 is explicit that P2 and P23 are node-local availability conditions
    // whose WIRE surface is "a generic fixed-size reject and `channel_rejected`,
    // revealing nothing about the cause". A channel that merely lost its
    // announcement — one close, no record — would partition the pre-key
    // observable by cause, which is the anti-oracle rule's whole subject.
    const wire: unknown[] = [];
    const localRows: string[][] = [];
    const cases = [
      // §5.5 U1 / §11.2 P2: the asserted chunk limit cannot carry a carrier.
      { maxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES - 1 },
      // §5.5 U2 / §11.2 P23: this node holds no conforming signed statement.
      {
        readAdvertisement: async (): Promise<NodeE2eeAdvertisementResult> => ({
          kind: "unavailable",
          reason: "signing_failed",
        }),
      },
    ] as const;
    for (const options of cases) {
      const node = await harness({ policy: () => REQUIRE_E2EE_POLICY, ...options });
      await node.openRaw();
      await settle();
      node.flush();
      wire.push({
        records: node
          .dataPayloads()
          .map((payload) => Buffer.from(stripPrelude(payload)).toString("hex")),
        closeReasons: node.closeReasons(),
        deliveredToParser: node.deliveredToParser.length,
      });
      localRows.push([...node.rows()]);
    }
    const first = wire[0] as { readonly records: readonly string[] };
    for (const observable of wire) expect(observable).toEqual(first);
    expect(first.records).toHaveLength(1);
    const reject = Buffer.from(first.records[0]!, "hex");
    expect(reject).toHaveLength(E2EE_HANDSHAKE_REJECT_BYTES);
    const decoded = decodeE2eeNegotiationRecord(reject);
    if (decoded.kind !== "ok") throw new Error(decoded.reason);
    expect(decoded.value.recordType).toBe(E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT);
    // The node-local diagnostic is the one thing that DOES distinguish them,
    // which is exactly the split §5.5 and §11.4 require.
    expect(localRows).toEqual([["P2"], ["P23"]]);
  });

  it("completes row N3 in the same turn that registers it", async () => {
    // §12.6 registers this channel as an established `e2ee` channel inside
    // `receiveHello`. If anything that MAKES it established ran after an await,
    // a sweep landing in between would find a channel it must terminate with an
    // encrypted §11.3 Q12 record and nothing to protect it with — and the
    // continuation would then build live session secrets onto a channel whose
    // §9.5 erasure had already run.
    let sweep: (() => void | Promise<void>) | undefined;
    let phaseIsE2ee = false;
    const node = await harness({
      registration: () => ({
        selectHandshake: () => ({
          establish: (transition) => {
            sweep = transition.close;
            return {
              kind: "entered",
              established: () => {
                phaseIsE2ee = true;
              },
            };
          },
        }),
        lockLegacy: () => ({ kind: "entered" }),
        release: () => undefined,
      }),
      afterPrekeyBorrow: async () => {
        // The sweep lands on the far side of the borrow's await — the first
        // instant anything else can run. Row N3 is already complete by then,
        // phase change included, so the FATAL-POST disposition is the right one.
        expect(phaseIsE2ee).toBe(true);
        await sweep?.();
      },
    });
    const advertisement = await node.open();
    const client = new E2eeClientHandshake({
      channel: clientChannel,
      advertised: advertisement.material,
      selectedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      offeredSuites: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
      credentials: nativeCredentials(),
      intendedCapability: CAPABILITY,
      intendedRole: ROLE,
    });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error(`hello: ${JSON.stringify(hello)}`);
    const before = node.dataPayloads().length;
    await node.deliver(hello.record);
    await settle();
    node.flush();

    // The accept, and then exactly one encrypted record: §11.3 Q12's `E2EEError`
    // with code `policy`. It exists only because the sweep found a channel whose
    // record session was already there.
    const emitted = node.dataPayloads().slice(before);
    expect(emitted).toHaveLength(2);
    const established = client.receiveServerAccept(stripPrelude(emitted[0]!), NOW);
    if (established.kind !== "established") throw new Error("expected an established client");
    const record = new E2eeRecordSession({
      secrets: established.secrets,
      suite: established.suite,
      sessionBindingHash: established.sessionBindingHash,
      sendDirection: "c2n",
      plaintextCeiling: 512 * 1_024,
    });
    const error = record.unprotect(stripPrelude(emitted[1]!));
    if (error.kind !== "authenticated") throw new Error(`unprotect: ${JSON.stringify(error)}`);
    expect(error.innerType).toBe(E2EE_INNER_TYPE_ERROR);
    const body = decodeE2eeErrorRecordBody(error.body);
    if (body.kind !== "ok") throw new Error("expected a conforming error body");
    expect(body.value.errorCode).toBe(E2EE_ERROR_CODE_POLICY);
    expect(node.session().mode()).toBe("closed");
    expect(node.rows()).toEqual(["Q12"]);
    expect(node.closeReasons()).toEqual(["channel_rejected"]);
  });

  it("is an in-flight handshake to the sweep until the accept reaches the wire", async () => {
    // The other half of the row-N3 race (§12.6 step (b), §16.3 F18): a handshake
    // whose step-8 work FAILED after the withdrawal test passed. The failure is
    // answered a turn later — on the far side of the prekey borrow — and a real
    // §12.6 sweep runs in that gap, over a real `NodeE2eePolicyClient`.
    //
    // "Established" is what §13.6 says it is: the node-side mode machine in the
    // `e2ee` state, which here it never reaches. So the sweep MUST find an
    // in-flight handshake and abort it as FATAL-PRE `P25` with the generic
    // fixed-size reject — never close it as `Q12`, which would put an encrypted
    // record on a channel whose peer holds no keys, no reject at all, and a
    // channel that never established into the operator's `e2ee` counts.
    const policyClient = makeNodeE2eePolicyClient({ store: stubPolicyStore() });
    await policyClient.start({
      requireE2EE: false,
      requireApprovedClientE2EE: false,
      suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
    });
    // Every byte of the connection's data budget, so the accept cannot be
    // enqueued at all (§11.4 `queue_full`) and row N3 is left untaken.
    const dataCapacity = limits.maxQueuedBytes - limits.maxControlFrameBytes;
    let counts: NodeE2eePolicyWithdrawalCounts | undefined;
    let node: Harness | undefined;
    node = await harness({
      policy: () => policyClient.policy(),
      registration: () => policyClient.registerChannel(),
      // NX: no Branch A record, so §12.6's node policy is what reaches it.
      authorization: authorizationFor(undefined),
      afterPrekeyBorrow: async () => {
        // The reject the abort owes needs room; holding the budget through the
        // sweep would test §11.2's "no record when the node is not writable"
        // instead of the disposition this case is about.
        node?.sendQueue.releaseReservation(CHANNEL_ID, dataCapacity);
        counts = (await policyClient.applyChange({ requireApprovedClientE2EE: true })).counts;
      },
    });
    const advertisement = await node.open();
    expect(node.sendQueue.reserveData(CHANNEL_ID, dataCapacity)).toBe(true);

    const client = new E2eeClientHandshake({
      channel: clientChannel,
      advertised: advertisement.material,
      selectedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      offeredSuites: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
      credentials: { tier: "web" },
      intendedCapability: CAPABILITY,
      intendedRole: ROLE,
    });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error(`hello: ${JSON.stringify(hello)}`);
    const before = node.dataPayloads().length;
    await node.deliver(hello.record);
    await settle();
    node.flush();

    // §12.6(c): counted in the in-flight class and in no other.
    expect(counts).toEqual({ legacy: 0, nxE2ee: 0, suiteWithdrawn: 0, abortedHandshakes: 1 });
    expect(node.rows()).toEqual(["P25"]);
    // §11.2: one generic fixed-size reject and nothing else — in particular no
    // encrypted record, which is what a channel treated as established emits.
    const emitted = node.dataPayloads().slice(before);
    expect(emitted).toHaveLength(1);
    const reject = stripPrelude(emitted[0]!);
    expect(reject).toHaveLength(E2EE_HANDSHAKE_REJECT_BYTES);
    expect(reject).toEqual(encodeE2eeHandshakeReject());
    expect(node.closeReasons()).toEqual(["channel_rejected"]);
    expect(node.session().mode()).toBe("closed");
    expect(node.deliveredToParser).toHaveLength(0);
  });

  it("leaves the channel usable when a close record meets backpressure", async () => {
    const node = await harness();
    const advertisement = await node.open();
    const client = await establish(node, "native", advertisement);
    await clientSend(node, client, E2EE_INNER_TYPE_RPC, utf8('{"_tag":"Ping"}'));
    const before = node.dataPayloads().length;

    // Hold the whole data budget, so the §9.3 admission for the `E2EEClose`
    // refuses exactly as it does for an application record.
    const dataCapacity = limits.maxQueuedBytes - limits.maxControlFrameBytes;
    expect(node.sendQueue.reserveData(CHANNEL_ID, dataCapacity)).toBe(true);
    await node.session().beginClose();
    node.flush();

    // §11.4 `e2ee_send_unavailable`: no pair consumed, no wire record of any
    // kind, and the channel unaffected and still usable. Ordinary backpressure
    // is NOT §9.6's degenerate state and MUST NOT end the channel or fix a
    // verdict for it.
    expect(node.dataPayloads()).toHaveLength(before);
    expect(node.session().mode()).toBe("e2ee");
    expect(node.session().verdict()).toBeUndefined();
    expect(node.closeReasons()).toEqual([]);

    node.sendQueue.releaseReservation(CHANNEL_ID, dataCapacity);
    const closing = node.session().beginClose();
    await settle();
    node.flush();
    const emitted = node.dataPayloads().slice(before);
    expect(emitted).toHaveLength(1);
    expect(clientReceive(client, emitted[0]!).innerType).toBe(E2EE_INNER_TYPE_CLOSE);
    node.session().dispose();
    await closing;
  });

  it("takes §9.6's degenerate outcome when the send direction is spent", async () => {
    const node = await harness({
      // One record short of the end of the direction: the `E2EEClose` below
      // completes epoch `E2EE_EPOCH_MAX` and exhausts it (§9.6).
      syntheticSendState: { epoch: E2EE_EPOCH_MAX, epochRecords: E2EE_REKEY_MAX_RECORDS - 1 },
    });
    const advertisement = await node.open();
    const client = await establish(node, "native", advertisement);
    await clientSend(node, client, E2EE_INNER_TYPE_RPC, utf8('{"_tag":"Ping"}'));
    expect(node.deliveredToParser).toHaveLength(1);

    void node.session().beginClose();
    await settle();
    node.flush();
    // §9.6, §10.4: the close spent the direction's last position, so no anchor
    // exists for a peer ack to equal and the verdict is already fixed.
    expect(node.session().verdict()).toBe("unclean_abrupt");

    const before = node.dataPayloads().length;
    await clientSend(node, client, E2EE_INNER_TYPE_RPC, utf8('{"_tag":"Ping"}'));
    // The next authenticated record has no current next-send to be processed
    // against. §9.6 gives that state an outcome — no wire record, nothing
    // delivered, **Unclean — abrupt** — and it is that outcome and not a raw
    // exception escaping the inbound interceptor.
    expect(node.dataPayloads().slice(before)).toHaveLength(0);
    expect(node.deliveredToParser).toHaveLength(1);
    expect(node.session().mode()).toBe("closed");
    expect(node.session().verdict()).toBe("unclean_abrupt");
  });

  it("runs §10's close when the channel session itself is closed", async () => {
    const node = await harness();
    const advertisement = await node.open();
    const client = await establish(node, "native", advertisement);
    await clientSend(node, client, E2EE_INNER_TYPE_RPC, utf8('{"_tag":"Ping"}'));

    const before = node.dataPayloads().length;
    // The channel session's own close is the node's signal that the channel is
    // ending, and §10's exchange is what an ending E2EE channel owes.
    const closing = node.channel().close();
    await settle();
    node.flush();
    const emitted = node.dataPayloads().slice(before);
    expect(emitted).toHaveLength(1);
    const closeRecord = clientReceive(client, emitted[0]!);
    expect(closeRecord.innerType).toBe(E2EE_INNER_TYPE_CLOSE);
    expect(decodeE2eeCloseRecordBody(closeRecord.body).kind).toBe("ok");
    // §10.3: nothing behind the channel is released while the exchange is owed.
    expect(node.releases()).toBe(0);

    const received = client.close.receive({
      innerType: closeRecord.innerType,
      body: closeRecord.body,
      envelope: { epoch: closeRecord.epoch, counter: closeRecord.counter },
      epochCompleted: closeRecord.epochCompleted,
      currentNextSend: positionOf(client.record.sendState),
      at: NOW,
    });
    expect(received.kind).toBe("close");
    await clientSendCloseRecord(
      node,
      client,
      client.close.buildCloseAck({
        sendPosition: positionOf(client.record.sendState),
        expectedRecv: client.close.ackExpectedRecv ?? positionOf(client.record.receiveState),
      }),
    );
    await closing;
    expect(node.session().verdict()).toBe("clean");
    expect(node.releases()).toBe(1);
  });

  it("lets a truncation at the channel's end supersede a recorded clean verdict", async () => {
    const node = await harness();
    const advertisement = await node.open();
    const client = await establish(node, "native", advertisement);
    await clientSend(node, client, E2EE_INNER_TYPE_RPC, utf8('{"_tag":"Ping"}'));

    // A complete §10.2 exchange first, so **Clean** is recorded and the session
    // is closed — the state in which §10.4's later-condition rule has to work.
    const closing = node.channel().close();
    await settle();
    node.flush();
    const closeRecord = clientReceive(client, node.dataPayloads().at(-1)!);
    expect(closeRecord.innerType).toBe(E2EE_INNER_TYPE_CLOSE);
    client.close.receive({
      innerType: closeRecord.innerType,
      body: closeRecord.body,
      envelope: { epoch: closeRecord.epoch, counter: closeRecord.counter },
      epochCompleted: closeRecord.epochCompleted,
      currentNextSend: positionOf(client.record.sendState),
      at: NOW,
    });
    await clientSendCloseRecord(
      node,
      client,
      client.close.buildCloseAck({
        sendPosition: positionOf(client.record.sendState),
        expectedRecv: client.close.ackExpectedRecv ?? positionOf(client.record.receiveState),
      }),
    );
    await closing;
    expect(node.session().verdict()).toBe("clean");
    expect(node.session().mode()).toBe("closed");

    // Then the peer's chunks of a further message it never finishes. They reach
    // the relay assembler and stop there — the E2EE layer is not consulted for
    // an incomplete reassembly — so this is state the closed session cannot see
    // and a verdict it cannot revise on its own.
    const prepared = prepareRelayMessage(new Uint8Array(3_000).fill(0x41), {
      maxChunkBytes: 1_024,
      maxMessageBytes: 512 * 1_024,
      peerSupportsChunking: true,
    });
    if (prepared.kind !== "ready") throw new Error(prepared.reason);
    expect(prepared.payloads.length).toBeGreaterThan(1);
    expect(await node.channel().receive(prepared.payloads[0]!)).toBe(true);

    // §10.4: "a partial reassembled message at close **is** truncation,
    // regardless of any other state", and a condition of higher precedence
    // arising after a verdict was recorded supersedes it. Clean is not the
    // endpoint's final answer here, and a `dispose` that dropped the
    // channel-ended input on an already-closed session would make the rule
    // unreachable in the one shape it is written for.
    await node.channel().close();
    expect(node.session().verdict()).toBe("unclean_truncation");
  });

  it("reports an incomplete reassembly at close as truncation", async () => {
    const node = await harness();
    const advertisement = await node.open();
    const client = await establish(node, "native", advertisement);
    await clientSend(node, client, E2EE_INNER_TYPE_RPC, utf8('{"_tag":"Ping"}'));

    // One chunk of a message that never completes.
    const prepared = prepareRelayMessage(new Uint8Array(3_000).fill(0x41), {
      maxChunkBytes: 1_024,
      maxMessageBytes: 512 * 1_024,
      peerSupportsChunking: true,
    });
    if (prepared.kind !== "ready") throw new Error(prepared.reason);
    expect(prepared.payloads.length).toBeGreaterThan(1);
    await node.deliver(prepared.payloads[0]!);

    const before = node.dataPayloads().length;
    await node.closeFromPeer();
    // §10.4: "the relay chunk assembler holds an incomplete reassembled message
    // when the channel ends" is truncation, and it is a fact only the assembler
    // knows — so a channel whose teardown never asks can never report it, and
    // every truncated channel would be recorded as an ordinary abrupt one.
    expect(node.session().verdict()).toBe("unclean_truncation");
    expect(node.releases()).toBe(1);
    // The peer is gone, so §10's exchange put nothing further on the wire.
    expect(node.dataPayloads().slice(before)).toHaveLength(0);
  });

  it("maps every receive-fatal condition to the §11.3 row that defines it", () => {
    expect(NODE_E2EE_RECEIVE_FATAL_ROWS).toEqual({
      version_mismatch: "Q1",
      suite_mismatch: "Q1",
      sequence_mismatch: "Q2",
      authentication_failed: "Q3",
      malformed_envelope: "Q4",
      reserved_inner_type: "Q5",
      malformed_record: "Q5",
      // The latch a previous fatal condition left behind, reported when a
      // further envelope arrives for a direction that has no expectation left.
      receive_terminated: "Q2",
    });
    // §11.3 Q10 is a LOCAL internal failure — code `internal`, and per §9.3 a
    // close with NO record at all. Every row above is detected on peer input and
    // answered with `protocol_violation`, so Q10 can never be one of them.
    expect(Object.values(NODE_E2EE_RECEIVE_FATAL_ROWS)).not.toContain("Q10");
  });
});
