import { describe, expect, it } from "vite-plus/test";

import {
  E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
  E2EE_EPOCH_MAX,
  E2EE_HANDSHAKE_REJECT_BYTES,
  E2EE_REKEY_MAX_RECORDS,
} from "@ryco/shared/relayE2eeConstants";
import {
  E2EE_ERROR_CODE_POLICY,
  E2EE_ERROR_CODE_PROTOCOL_VIOLATION,
  decodeE2eeCloseRecordBody,
  decodeE2eeErrorRecordBody,
} from "@ryco/shared/relayE2eeClose";
import { E2eeClientHandshake } from "@ryco/shared/relayE2eeHandshake";
import { deriveE2eeAgreementPublicKey } from "@ryco/shared/relayE2eeKeys";
import { deriveE2eeWebSas } from "@ryco/shared/relayE2eeVerificationDisplay";
import { E2eeRecordSession } from "@ryco/shared/relayE2eeSession";
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
} from "@ryco/shared/relayE2eeWire";
import { prepareRelayMessage } from "@ryco/shared/relayMessageChunks";

import type { NodeE2eeAdvertisementResult } from "../hubIdentity/NodeE2eeCapabilityStatement.ts";
import {
  makeNodeE2eePolicyClient,
  type NodeE2eePolicyWithdrawalCounts,
} from "../hubIdentity/NodeE2eePolicyClient.ts";
import { NODE_E2EE_RECEIVE_FATAL_ROWS } from "./NodeE2eeChannelSession.ts";

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

import {
  CAPABILITY,
  CHANNEL_ID,
  NOW,
  REQUIRE_E2EE_POLICY,
  ROLE,
  authorizationFor,
  clientChannel,
  clientReceive,
  clientSend,
  clientSendCloseRecord,
  establish,
  harness,
  limits,
  nativeCredentials,
  positionOf,
  settle,
  stripPrelude,
  stubPolicyStore,
  utf8,
  type Harness,
} from "./testUtils/nodeE2eeChannelHarness.ts";

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

  it("publishes the §13.5 advisory code for a web session and retires it on close", async () => {
    const registrations: {
      readonly tier: string;
      readonly verificationCode: string | undefined;
    }[] = [];
    let released = 0;
    const node = await harness({
      authorization: authorizationFor(undefined),
      registerSession: (session) => {
        registrations.push({ tier: session.tier, verificationCode: session.verificationCode });
        return () => {
          released += 1;
        };
      },
    });
    const advertisement = await node.open();
    const clientEphemeralSecret = new Uint8Array(32).fill(0x2c);
    // Derived BEFORE the handshake: §9.5's erasure reaches the injected buffer,
    // which is the caller's own array, so reading it afterwards reads zeroes.
    const clientEphemeralPublic = deriveE2eeAgreementPublicKey(clientEphemeralSecret);
    const client = await establish(node, "web", advertisement, clientEphemeralSecret);

    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.tier).toBe("web");
    // The node's value must be the §13.5 derivation over the node identity key,
    // the WEB client's Noise ephemeral, and the §8.8 binding hash — derived here
    // from the two halves the client and the advertisement each hold, so a node
    // that fed the wrong input would produce a different string.
    const expected = deriveE2eeWebSas({
      nodeIdentityPublicKey: advertisement.nodeIdentityPublicKey,
      webEphemeralPublicKey: clientEphemeralPublic,
      sessionBindingHash: client.sessionBindingHash,
    }).display;
    expect(registrations[0]?.verificationCode).toBe(expected);

    // §13.5: the code is ephemeral display state, so the entry goes when the
    // session does.
    expect(released).toBe(0);
    await node.closeFromPeer();
    expect(released).toBe(1);
  });

  it("publishes a native session with no §13.5 code, because it has no meaning there", async () => {
    const registrations: { readonly verificationCode: string | undefined }[] = [];
    const node = await harness({
      registerSession: (session) => {
        registrations.push({ verificationCode: session.verificationCode });
        return () => undefined;
      },
    });
    const advertisement = await node.open();
    await establish(node, "native", advertisement);
    expect(registrations).toHaveLength(1);
    // §13.4's long-term safety number is the owner-facing value for a signed
    // client, and it lives on the Branch A record rather than on the session.
    expect(registrations[0]?.verificationCode).toBeUndefined();
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
