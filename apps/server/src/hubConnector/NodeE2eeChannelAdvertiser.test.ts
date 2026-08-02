import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import type {
  RelayChannelId,
  RelayChannelOpenFrame,
  RelayFrame,
  RelayLimits,
} from "@ryco/contracts/relay";
import { decodeRelayFrame } from "@ryco/shared/relayCodec";
import {
  E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
  E2EE_CAPABILITY_CARRIER_TAG,
} from "@ryco/shared/relayE2eeConstants";
import { deriveE2eeAgreementPublicKey, verifyE2eeSignature } from "@ryco/shared/relayE2eeKeys";
import {
  decodeCanonicalE2eeCbor,
  encodeNodeE2eeCapabilitySigningEnvelope,
  encodeNodeE2eePrekeyTranscript,
  verifyNodeE2eeCapabilityCrossSignature,
} from "@ryco/shared/relayE2eeTranscripts";
import {
  classifyPostStripPayload,
  E2EE_SUITE_25519_CHACHAPOLY_SHA256,
} from "@ryco/shared/relayE2eeWire";
import { RelayMessageAssembler } from "@ryco/shared/relayMessageChunks";

import {
  makeNodeE2eeCapabilityStatementClient,
  type NodeE2eeCapabilityStatementClient,
} from "../hubIdentity/NodeE2eeCapabilityStatement.ts";
import { effectiveNodeE2eePolicy } from "../hubIdentity/NodeE2eePolicyStore.ts";
import type { NodeE2eePrekeyCertificate } from "../hubIdentity/NodeE2eePrekeyClient.ts";
import {
  makeNodeE2eeChannelAdvertiser,
  type E2eeAdvertisementUnavailableReason,
  type NodeE2eeAdvertisementDiagnostic,
  type NodeE2eeChannelAdvertiserSources,
} from "./NodeE2eeChannelAdvertiser.ts";
import {
  RelayChannelRegistry,
  type RelayChannelSendHandle,
  type RelayRpcChannelSession,
} from "./RelayChannelRegistry.ts";
import { RelaySendQueue } from "./RelaySendQueue.ts";

// Test-only key material, generated per run and never leaving the process.

const HUB_ORIGIN = "https://relay.example";
const NODE_ID = `node_${"N".repeat(22)}`;
const IDENTITY_KEY_ID = `nkey_${"K".repeat(22)}`;
const PREKEY_ID = `epk_${"P".repeat(22)}`;
const CONTINUITY_ID = `nct_${"C".repeat(22)}`;
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const channelA = `ch_${"A".repeat(22)}` as RelayChannelId;
const version = { protocolMajor: 1, protocolMinor: 2 } as const;

/**
 * A real statement client over real Ed25519 custody.
 *
 * The relay-path assertions below are about bytes a client would receive, so
 * they are made against a statement that actually verifies rather than against a
 * placeholder that only has the right length.
 */
function statementClient(): {
  readonly client: NodeE2eeCapabilityStatementClient;
  readonly identityPublicKey: Uint8Array;
} {
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
  const agreementPublicKey = deriveE2eeAgreementPublicKey(new Uint8Array(32).fill(0x37));
  const prekey: NodeE2eePrekeyCertificate = {
    hubOrigin: HUB_ORIGIN,
    nodeId: NODE_ID,
    identityKeyId: IDENTITY_KEY_ID,
    prekeyId: PREKEY_ID,
    agreementPublicKey,
    createdAt: 1_000,
    expiresAt: 9_000_000_000_000,
    crossSignature: signBytes(
      encodeNodeE2eePrekeyTranscript({
        hubOrigin: HUB_ORIGIN,
        nodeId: NODE_ID,
        identityKeyId: IDENTITY_KEY_ID,
        prekeyId: PREKEY_ID,
        identityPublicKey,
        agreementPublicKey,
        createdAt: 1_000,
        expiresAt: 9_000_000_000_000,
      }),
    ),
  };
  return {
    identityPublicKey,
    client: makeNodeE2eeCapabilityStatementClient({
      identity: async () => ({
        nodeId: NODE_ID,
        identityKeyId: IDENTITY_KEY_ID,
        identityPublicKey,
        sign: async (envelope) => signBytes(envelope),
      }),
      prekey: async () => prekey,
      continuity: async () => ({ continuityId: CONTINUITY_ID, chain: [] }),
      policy: () =>
        effectiveNodeE2eePolicy({
          requireE2EE: false,
          requireApprovedClientE2EE: false,
          suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
        }),
      generation: () => 3,
    }),
  };
}

const limitsWith = (maxDataChunkBytes: number): RelayLimits => ({
  maxControlFrameBytes: 4_096,
  maxDataChunkBytes,
  maxQueuedBytes: 262_144,
  maxChannels: 4,
  heartbeatIntervalMs: 20_000,
  deadConnectionTimeoutMs: 45_000,
  authenticationDeadlineMs: 5_000,
});

const openFrame: RelayChannelOpenFrame = {
  type: "channel.open",
  ...version,
  channelId: channelA,
  capability: "ryco.rpc",
  effectiveRole: "operator",
};

function decodeAll(sent: readonly Uint8Array[]): RelayFrame[] {
  return sent.map((bytes) => {
    const decoded = decodeRelayFrame(bytes);
    if (!decoded.ok) throw new Error(decoded.error.code);
    return decoded.value;
  });
}

interface RelayHarnessOptions {
  readonly maxDataChunkBytes: number;
  readonly requireE2EE?: boolean;
  readonly readAdvertisement?: NodeE2eeChannelAdvertiserSources["readAdvertisement"];
  /** Shrinks the outbound budget so the carrier cannot be enqueued at all. */
  readonly maxQueuedBytes?: number;
}

/**
 * The registry, the send queue, a socket, and the advertiser wired exactly as
 * `HubConnectorLive` wires them — including the announcement hook, which is the
 * only place a carrier can take outbound sequence 0.
 */
function relayHarness(options: RelayHarnessOptions) {
  const limits: RelayLimits = {
    ...limitsWith(options.maxDataChunkBytes),
    ...(options.maxQueuedBytes === undefined ? {} : { maxQueuedBytes: options.maxQueuedBytes }),
  };
  const sent: Uint8Array[] = [];
  const sendQueue = new RelaySendQueue(
    { bufferedAmount: 0, send: (bytes) => sent.push(Uint8Array.from(bytes)) },
    limits,
  );
  const statements = statementClient();
  const occurrences: Array<{ hubOrigin: string; reason: E2eeAdvertisementUnavailableReason }> = [];
  const diagnostics: NodeE2eeAdvertisementDiagnostic[] = [];
  const advertiser = makeNodeE2eeChannelAdvertiser({
    hubOrigin: HUB_ORIGIN,
    readAdvertisement:
      options.readAdvertisement ?? ((hubOrigin) => statements.client.advertised(hubOrigin)),
    policy: () =>
      effectiveNodeE2eePolicy({
        requireE2EE: options.requireE2EE ?? false,
        requireApprovedClientE2EE: false,
        suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
      }),
    recordFallback: async (occurrence) => {
      occurrences.push({ ...occurrence });
    },
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  let announcementWasAsynchronous = false;
  const sendHandles = new Map<string, RelayChannelSendHandle>();
  const registry = new RelayChannelRegistry({
    limits,
    sendQueue,
    factory: {
      connectionReady: ({ limits: ready }) =>
        advertiser.connectionReady({ maxDataChunkBytes: ready.maxDataChunkBytes }),
      open: async ({ channelId, send }) => {
        const announcement = await advertiser.openChannel();
        sendHandles.set(channelId as string, send);
        return {
          receive: async () => true,
          queuedBytes: async () => 0,
          supportsChunkedMessages: () => false,
          close: async () => undefined,
          onAccepted: () => {
            const result = announcement.announce(send) as unknown;
            // §5.4 and the announcement contract: the body must be a single
            // `send`, so a conforming announcement returns nothing and the
            // registry arms no deadline timer at all.
            if (result !== undefined) announcementWasAsynchronous = true;
          },
        } satisfies RelayRpcChannelSession;
      },
    },
  });
  return {
    registry,
    sendQueue,
    sent,
    occurrences,
    diagnostics,
    statements,
    sendHandles,
    advertiser,
    announcementWasAsynchronous: () => announcementWasAsynchronous,
  };
}

describe("NodeE2eeChannelAdvertiser on the relay path", () => {
  it("puts the carrier at outbound data sequence 0, ahead of every other payload (§5.4)", async () => {
    const harness = relayHarness({ maxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES });
    await harness.registry.handle(openFrame);
    harness.sendQueue.flush();

    const frames = decodeAll(harness.sent);
    // The accept travels on the control lane and is flushed before data, so the
    // client's channel state has flipped by the time sequence 0 arrives.
    expect(frames[0]).toMatchObject({ type: "channel.accept", channelId: channelA });
    const first = frames[1];
    expect(first).toMatchObject({ type: "data", channelId: channelA, sequence: 0 });
    expect(frames.filter((frame) => frame.type === "data")).toHaveLength(1);
    expect(harness.announcementWasAsynchronous()).toBe(false);

    // The next node payload continues the SHARED counter: nothing ran a second
    // sequence beside the carrier.
    expect(harness.sendHandles.get(channelA as string)!(Uint8Array.of(0x7b, 0x7d))).toEqual({
      accepted: true,
    });
    harness.sendQueue.flush();
    expect(decodeAll(harness.sent).at(-1)).toMatchObject({ type: "data", sequence: 1 });
  });

  it("delivers bytes a legacy client reassembles, ignores, and is unharmed by (§5.3, §5.6)", async () => {
    const harness = relayHarness({ maxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES });
    await harness.registry.handle(openFrame);
    harness.sendQueue.flush();
    const frame = decodeAll(harness.sent).find((candidate) => candidate.type === "data");
    if (frame?.type !== "data") throw new Error("no data frame");

    // C1 and C6: the current client reassembly path completes the message, the
    // prelude is stripped, and the peer chunk-support latch is set exactly as
    // for any other fitting message. The carrier can never enter the chunk
    // parser, because its first byte is `{`.
    const assembler = new RelayMessageAssembler();
    const pushed = assembler.push(frame.payload);
    expect(pushed.kind).toBe("done");
    if (pushed.kind !== "done") return;
    expect(assembler.peerSupportsChunking).toBe(true);
    expect(pushed.message[0]).toBe(0x7b);
    // Nothing in the E2EE receive pipeline claims it: it is legacy JSON.
    expect(classifyPostStripPayload(pushed.message)).toEqual({ kind: "legacy-json" });

    const text = new TextDecoder().decode(pushed.message);
    const parsed = JSON.parse(text) as Readonly<Record<string, string>>;
    expect(Object.keys(parsed)).toEqual(["_tag", "statement"]);
    expect(parsed._tag).toBe(E2EE_CAPABILITY_CARRIER_TAG);
    // No `requestId`, so no request-entry lookup and no reply is generated at a
    // legacy client, and the tag matches no known response tag (§5.6 C2, C3).
    expect(text).not.toContain("requestId");
    expect(text).toBe(JSON.stringify({ _tag: parsed._tag, statement: parsed.statement }));
    expect(parsed.statement).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("carries a statement the Phase 1 verifier accepts, taken off the wire (§5.2)", async () => {
    const harness = relayHarness({ maxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES });
    await harness.registry.handle(openFrame);
    harness.sendQueue.flush();
    const frame = decodeAll(harness.sent).find((candidate) => candidate.type === "data");
    if (frame?.type !== "data") throw new Error("no data frame");
    const assembler = new RelayMessageAssembler();
    const pushed = assembler.push(frame.payload);
    if (pushed.kind !== "done") throw new Error("carrier did not reassemble");

    const carrier = JSON.parse(new TextDecoder().decode(pushed.message)) as { statement: string };
    const statement = Uint8Array.from(Buffer.from(carrier.statement, "base64url"));
    const decoded = decodeCanonicalE2eeCbor(statement);
    if (decoded.kind !== "ok" || !Array.isArray(decoded.value)) {
      throw new Error("statement is not a canonical CBOR array");
    }
    const [transcript, signature] = decoded.value as readonly Uint8Array[];

    // §5.2 step 1, from the exact transcript bytes received.
    expect(
      verifyE2eeSignature({
        algorithm: "ed25519",
        publicKey: harness.statements.identityPublicKey,
        message: encodeNodeE2eeCapabilitySigningEnvelope(Uint8Array.from(transcript!)),
        signature: Uint8Array.from(signature!),
      }),
    ).toBe(true);

    const elementsDecoded = decodeCanonicalE2eeCbor(Uint8Array.from(transcript!));
    if (elementsDecoded.kind !== "ok" || !Array.isArray(elementsDecoded.value)) {
      throw new Error("transcript is not a canonical CBOR array");
    }
    const elements = elementsDecoded.value;
    expect(elements[1]).toBe(HUB_ORIGIN);
    const prekey = elements[10] as readonly unknown[];
    // §5.2 step 5 / §7.6: the prekey is bound to the advertised identity by a
    // reconstruction the verifier performs, not by anything the wire carries.
    expect(
      verifyNodeE2eeCapabilityCrossSignature({
        hubOrigin: elements[1] as string,
        nodeId: elements[2] as string,
        identityKeyId: elements[4] as string,
        identityPublicKey: Uint8Array.from(elements[5] as Uint8Array),
        identityFingerprint: Uint8Array.from(elements[6] as Uint8Array),
        prekeyCertificate: {
          prekeyId: prekey[0] as string,
          agreementPublicKey: Uint8Array.from(prekey[1] as Uint8Array),
          crossSignature: Uint8Array.from(prekey[2] as Uint8Array),
          agreementFingerprint: Uint8Array.from(prekey[3] as Uint8Array),
          createdAt: prekey[4] as number,
          expiresAt: prekey[5] as number,
        },
      }),
    ).toBe(true);
  });

  it("suppresses on an undersized connection and counts it in its own class (§5.5 U1, row N16)", async () => {
    const harness = relayHarness({ maxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES - 1 });
    await harness.registry.handle(openFrame);
    harness.sendQueue.flush();

    const frames = decodeAll(harness.sent);
    expect(frames[0]).toMatchObject({ type: "channel.accept", channelId: channelA });
    // Row N16: no carrier, and the channel stays open as an ordinary legacy one.
    expect(frames.filter((frame) => frame.type === "data")).toHaveLength(0);
    expect(frames.some((frame) => frame.type === "channel.close")).toBe(false);
    // Exactly one occurrence, in the advertisement-unavailable class, naming
    // `undersized-connection` — never the peer-legacy class, which §12.3's flip
    // criterion reads and which a Hub-asserted chunk limit must not move.
    expect(harness.occurrences).toEqual([
      { hubOrigin: HUB_ORIGIN, reason: "undersized-connection" },
    ]);
    // §5.5's operator diagnostic names the condition and both figures.
    expect(harness.diagnostics).toEqual([
      {
        reason: "undersized-connection",
        fatal: false,
        assertedMaxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES - 1,
        minimumChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
      },
    ]);
  });

  it("reports the live §5.5 U1 pair for §12.5's display, and nothing when it is not live", async () => {
    // §12.5 Display: "For a live `undersized-connection` condition it MUST also
    // display the asserted `maxDataChunkBytes` and
    // `E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES`", and it says the pair is read from
    // the current connection rather than retained in the ring. So it is read
    // here, and it answers `undefined` for a connection that carries a carrier
    // fine — a display that reported the pair anyway would name a condition that
    // does not hold.
    const undersized = relayHarness({ maxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES - 1 });
    await undersized.registry.handle(openFrame);
    expect(undersized.advertiser.undersizedConnection()).toEqual({
      assertedMaxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES - 1,
      advertisementMinChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
    });

    const serviceable = relayHarness({ maxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES });
    await serviceable.registry.handle(openFrame);
    expect(serviceable.advertiser.undersizedConnection()).toBeUndefined();
  });

  it("fails an undersized connection closed under effective requireE2EE (§5.5, §11.2 P2)", async () => {
    const harness = relayHarness({
      maxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES - 1,
      requireE2EE: true,
    });
    await harness.registry.handle(openFrame);
    await Promise.resolve();
    harness.sendQueue.flush();

    const frames = decodeAll(harness.sent);
    // §11.5: an outer `channel.close` with the existing reason
    // `channel_rejected`, zero application payload, and no new close literal.
    expect(frames.at(-1)).toMatchObject({
      type: "channel.close",
      channelId: channelA,
      reason: "channel_rejected",
    });
    expect(frames.filter((frame) => frame.type === "data")).toHaveLength(0);
    // Row N15 is FATAL-PRE, not row N16: no fallback occurrence is recorded for
    // a channel the node closed rather than served.
    expect(harness.occurrences).toEqual([]);
    expect(harness.diagnostics[0]).toMatchObject({
      reason: "undersized-connection",
      fatal: true,
    });
  });

  it("takes the same two dispositions when no conforming statement exists (§5.5 U2, §11.2 P23)", async () => {
    const suppressing = relayHarness({
      maxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
      readAdvertisement: async () => ({ kind: "unavailable", reason: "signing_failed" }),
    });
    await suppressing.registry.handle(openFrame);
    suppressing.sendQueue.flush();
    expect(decodeAll(suppressing.sent).filter((frame) => frame.type === "data")).toHaveLength(0);
    expect(suppressing.occurrences).toEqual([
      { hubOrigin: HUB_ORIGIN, reason: "statement-unavailable" },
    ]);
    // The node-local diagnostic names WHICH §7.6.1 check failed; the wire
    // surface stays the generic one and carries nothing about the cause.
    expect(suppressing.diagnostics).toEqual([
      { reason: "statement-unavailable", fatal: false, statementFailure: "signing_failed" },
    ]);

    const failing = relayHarness({
      maxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
      requireE2EE: true,
      readAdvertisement: async () => ({
        kind: "unavailable",
        reason: "continuity_id_unresolved",
      }),
    });
    await failing.registry.handle(openFrame);
    await Promise.resolve();
    failing.sendQueue.flush();
    expect(decodeAll(failing.sent).at(-1)).toMatchObject({
      type: "channel.close",
      reason: "channel_rejected",
    });
    expect(failing.occurrences).toEqual([]);
  });

  it("closes as channel_rejected when the send path will not take the carrier", async () => {
    // §5.4 makes the carrier the FIRST node payload; a channel that could not
    // emit it has no advertisement and cannot acquire one later, so it is not a
    // channel that may proceed. The close reason is the §11.5 one rather than
    // the send path's `transfer_limit`, so it is indistinguishable from every
    // other pre-key failure.
    const harness = relayHarness({
      maxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
      maxQueuedBytes: 4_352,
    });
    await harness.registry.handle(openFrame);
    await Promise.resolve();
    harness.sendQueue.flush();
    const frames = decodeAll(harness.sent);
    // The channel was accepted first, so this is the announcement failing and
    // not the open being rejected.
    expect(frames[0]).toMatchObject({ type: "channel.accept", channelId: channelA });
    expect(frames.filter((frame) => frame.type === "data")).toHaveLength(0);
    expect(frames.at(-1)).toMatchObject({
      type: "channel.close",
      channelId: channelA,
      reason: "channel_rejected",
    });
    // The channel was served, not suppressed: no §12.5 occurrence belongs to it.
    expect(harness.occurrences).toEqual([]);
  });

  it("counts one occurrence per channel and surfaces one diagnostic per connection", async () => {
    const harness = relayHarness({ maxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES - 1 });
    await harness.registry.handle(openFrame);
    await harness.registry.handle({
      ...openFrame,
      channelId: `ch_${"B".repeat(22)}` as RelayChannelId,
    });
    // §12.5 counts per channel; §5.5's condition is about the connection, so
    // repeating its diagnostic per channel would bury it under the traffic it
    // describes.
    expect(harness.occurrences).toHaveLength(2);
    expect(harness.diagnostics).toHaveLength(1);
  });

  it("re-evaluates U1 on every connection, and refuses to guess before `ready`", async () => {
    const occurrences: E2eeAdvertisementUnavailableReason[] = [];
    const diagnostics: NodeE2eeAdvertisementDiagnostic[] = [];
    const advertiser = makeNodeE2eeChannelAdvertiser({
      hubOrigin: HUB_ORIGIN,
      readAdvertisement: (hubOrigin) => statementClient().client.advertised(hubOrigin),
      policy: () =>
        effectiveNodeE2eePolicy({
          requireE2EE: false,
          requireApprovedClientE2EE: false,
          suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
        }),
      recordFallback: async (occurrence) => {
        occurrences.push(occurrence.reason);
      },
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    // No `ready` yet. The registry makes this unreachable — it announces the
    // limits as it is constructed — but a node that does not know the asserted
    // limit cannot know its carrier fits, so it does not advertise.
    expect((await advertiser.openChannel()).plan).toEqual({
      kind: "suppress",
      reason: "undersized-connection",
    });

    advertiser.connectionReady({ maxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES - 1 });
    expect((await advertiser.openChannel()).plan.kind).toBe("suppress");
    // A new connection is a new verdict, in both directions.
    advertiser.connectionReady({ maxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES });
    expect((await advertiser.openChannel()).plan.kind).toBe("advertise");
    advertiser.connectionReady({ maxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES - 1 });
    expect((await advertiser.openChannel()).plan.kind).toBe("suppress");
    // Each connection reports the condition it is in, rather than inheriting the
    // previous connection's silence.
    expect(diagnostics.filter((entry) => entry.reason === "undersized-connection")).toHaveLength(3);
    expect(occurrences).toEqual([]);
  });
});
