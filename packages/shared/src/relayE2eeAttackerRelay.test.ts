import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { encode as cborEncode, rfc8949EncodeOptions } from "cborg";
import { describe, expect, it } from "vite-plus/test";

import {
  E2EE_CLIENT_HELLO_MAX_BYTES,
  E2EE_COUNTER_MAX,
  E2EE_ENVELOPE_HEADER_BYTES,
  E2EE_ENVELOPE_OVERHEAD_BYTES,
  E2EE_HANDSHAKE_REJECT_BYTES,
  E2EE_INNER_TYPE_BYTES,
  E2EE_REKEY_MAX_RECORDS,
  T_CLOSE,
  T_HANDSHAKE_NODE,
} from "./relayE2eeConstants.ts";
import {
  E2EE_ERROR_CODE_INTERNAL,
  E2EE_ERROR_CODE_POLICY,
  E2EE_ERROR_CODE_PROTOCOL_VIOLATION,
  E2eeCloseMachine,
  encodeE2eeCloseRecordBody,
  encodeE2eeErrorRecordBody,
  type E2eeCloseRecordToSend,
  type E2eeCloseVerdict,
  type E2eeErrorCode,
  type E2eeSequencePosition,
} from "./relayE2eeClose.ts";
import {
  E2EE_NX_HELLO_PAYLOAD,
  E2eeClientHandshake,
  E2eeNodeHandshake,
  decodeE2eeClientHello,
  encodeE2eeClientHello,
  encodeE2eeIkHelloPayload,
  encodeE2eeServerAccept,
  encodeE2eeServerAcceptPayload,
  selectE2eeSuite,
  type E2eeAdvertisedChannelMaterial,
  type E2eeClientAuthorization,
  type E2eeClientAuthorizationKey,
  type E2eeClientHandshakeCredentials,
  type E2eeHandshakeChannel,
  type E2eeIkHelloPayload,
  type E2eeNodeAdmissionPolicy,
  type E2eePreKeyRow,
} from "./relayE2eeHandshake.ts";
import { RelayE2eeValidationError, e2eeKeyFingerprint } from "./relayE2eeKeys.ts";
import { E2eeNoiseHandshake } from "./relayE2eeNoise.ts";
import {
  E2eeRecordSession,
  deriveE2eeAeadKey,
  deriveE2eeNextEpochSecret,
  type E2eeProtectResult,
  type E2eeReceiveFatalReason,
  type E2eeRecordAeadFactory,
  type E2eeSessionSecrets,
  type E2eeSyntheticDirectionState,
} from "./relayE2eeSession.ts";
import {
  E2EE_NOISE_PATTERN_IK,
  E2EE_NOISE_PATTERN_NX,
  e2eeAuthorizationContextCommitment,
  encodeClientE2eePrekeyTranscript,
  encodeE2eeAuthorizationContext,
  encodeE2eeNoisePrologue,
  type E2eeAuthorizationContextInput,
  type E2eeTier,
} from "./relayE2eeTranscripts.ts";
import {
  E2EE_DIRECTION_CLIENT_TO_NODE,
  E2EE_DIRECTION_NODE_TO_CLIENT,
  E2EE_INNER_TYPE_CLOSE,
  E2EE_INNER_TYPE_CLOSE_ACK,
  E2EE_INNER_TYPE_ERROR,
  E2EE_INNER_TYPE_RPC,
  E2EE_SUITE_25519_CHACHAPOLY_SHA256,
  E2EE_SUITE_ACCOUNT_GRANT_25519_CHACHAPOLY_SHA256,
  classifyPostStripPayload,
  decodeE2eeNegotiationRecord,
  e2eeAeadNonceFromHeader,
  e2eeEnvelopeAad,
  encodeE2eeEnvelope,
  encodeE2eeEnvelopeHeader,
  encodeE2eeHandshakeReject,
  encodeE2eeInnerRecord,
  type E2eeDirection,
  type E2eeInnerRecordType,
} from "./relayE2eeWire.ts";

// THE ATTACKER-RELAY ADVERSARIAL SUITE — docs/relay-e2ee-protocol.md §2.1.
//
// Every other E2EE test file in this package exercises one module against
// honest inputs. This one runs two complete endpoints — handshake (§8), record
// session (§9), and close machine (§10) — against each other with the relay in
// between under an ATTACKER'S CONTROL, which is the trust model §2.1 actually
// assumes: the relay routes, sees, and may rewrite every byte that crosses.
//
// WHAT THE ATTACKER MAY DO HERE. Nothing crosses between the two endpoints by
// itself. Every record a sender produces is captured by `AttackerRelay` and
// reaches its peer only when a case hands it over, so a case may deliver it
// unchanged, MUTATE any byte of it, DROP it, REORDER it against another,
// REPLAY it, TRUNCATE it, REFLECT it back at its own sender, or INJECT bytes
// no endpoint ever produced.
//
// WHAT IT MAY NOT DO is forge authentication. §2.1 gives the relay no key
// material, and the AEAD is what makes that stick, so the honest outcome of
// most byte-level tampering is one authentication failure. The cases that
// require a record which is authentic but non-conforming — a close
// acknowledgement declaring the wrong anchor, a reserved inner-record type, a
// record protected past the close machine — model a NON-CONFORMING PEER
// instead, through `mintNonConformingEnvelope` and `protectRaw` below. Both
// tools are labelled at every use, because the two threat models bound
// different things and conflating them would let a case claim a relay can do
// something it cannot.
//
// EVERY CASE ASSERTS THE ROW, THE VERDICT, OR THE DISPOSITION THE SPECIFICATION
// FIXES — the §11.2 pre-key row, the §11.3 post-key row with its error code and
// its §11.5 observable, or the §10.4 close verdict. A case that asserted only
// "something failed" would pass against an implementation that failed for the
// wrong reason, which on this path means failing open somewhere else.

// ─── §16.1-style TEST-ONLY material ──────────────────────────────────────────
//
// Identical to `relayE2eeHandshake.test.ts`, deliberately: the two files then
// pin the same §7 and §8 material, and a change to one that does not move the
// other shows up as a disagreement rather than as two independently drifting
// corpora. The X25519 keys are the RFC 7748 §6.1 vector keys and the P-256
// identity key is the RFC 6979 A.2.5 vector key. NONE OF IT MAY EVER REACH A
// REAL ENDPOINT.

const bytes = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, "hex"));

const NODE_IDENTITY_PUBLIC = bytes(
  "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8",
);
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
const CLIENT_EPHEMERAL_SECRET = bytes(
  "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
);
const NODE_EPHEMERAL_SECRET = bytes(
  "2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40",
);
const CLIENT_NONCE = bytes("9f9e9d9c9b9a999897969594939291908f8e8d8c8b8a89888786858483828180");

const HUB_ORIGIN = "https://hub.example.com";
const NODE_ID = "node_AAAAAAAAAAAAAAAAAAAAAA";
const PREKEY_ID = "epk_EEEEEEEEEEEEEEEEEEEEEE";
const CONTINUITY_ID = "nct_FFFFFFFFFFFFFFFFFFFFFF";
const OTHER_CONTINUITY_ID = "nct_HHHHHHHHHHHHHHHHHHHHHH";
const CHANNEL_ID = "ch_GGGGGGGGGGGGGGGGGGGGGG";
const ACCOUNT_ID = "acct_0123456789";
const OTHER_ACCOUNT_ID = "acct_9876543210";
const CREATED_AT = 1_784_160_000_000;
const EXPIRES_AT = 1_786_752_000_000;
const NOW = 1_784_160_030_000;

const CAPABILITY = "ryco.rpc";
const ROLE = "operator";
/** Ranked below `operator` by §8.3's role ordering; the role-reduction case. */
const LOWER_ROLE = "viewer";
/** Ranked above `operator` by §8.3's role ordering; the role-escalation case. */
const HIGHER_ROLE = "owner";
/**
 * A capability string the relay contract's closed vocabulary does not admit.
 *
 * The version-1 `RelayCapability` schema has exactly ONE member, so element 11
 * and element 13 can never hold two DIFFERENT valid literals: the §8.3
 * capability-mismatch class is reachable in this version only as a claim outside
 * the vocabulary (P11) or as a Branch A `capabilitySet` that excludes the
 * requested capability (P12), and both forms are cases below. A case
 * additionally pins the singleton, so adding a second literal fails here and
 * surfaces the third form rather than leaving it silently uncovered.
 */
const UNVOCABULARY_CAPABILITY = "ryco.hub-connector";

const NODE_IDENTITY_FINGERPRINT = e2eeKeyFingerprint("node-identity", NODE_IDENTITY_PUBLIC);
const NODE_AGREEMENT_FINGERPRINT = e2eeKeyFingerprint("agreement", NODE_AGREEMENT_PUBLIC);
const CLIENT_IDENTITY_FINGERPRINT = e2eeKeyFingerprint("client-identity", CLIENT_IDENTITY_PUBLIC);
const CLIENT_AGREEMENT_FINGERPRINT = e2eeKeyFingerprint("agreement", CLIENT_AGREEMENT_PUBLIC);

const CLIENT_PREKEY_TRANSCRIPT = encodeClientE2eePrekeyTranscript({
  hubOrigin: HUB_ORIGIN,
  accountId: ACCOUNT_ID,
  identityPublicKey: CLIENT_IDENTITY_PUBLIC,
  agreementPublicKey: CLIENT_AGREEMENT_PUBLIC,
  createdAt: CREATED_AT,
  expiresAt: EXPIRES_AT,
});
const CLIENT_PREKEY_SIGNATURE = p256.sign(
  sha256(CLIENT_PREKEY_TRANSCRIPT),
  CLIENT_IDENTITY_SECRET,
  {
    prehash: false,
    lowS: false,
    format: "compact",
  },
);

const SUITE = E2EE_SUITE_25519_CHACHAPOLY_SHA256;
const PLAINTEXT_CEILING = 1024;
const APPROVED: E2eeClientAuthorization = {
  status: "approved",
  maxRole: HIGHER_ROLE,
  capabilitySet: [CAPABILITY],
};

// ─── attacker primitives ─────────────────────────────────────────────────────
//
// Every transform an attacker-controlled relay can apply to bytes it is
// routing. They are pure and return copies, so a mutated frame never disturbs
// the record the sender still holds — a relay rewriting a message in flight
// does not rewrite the sender's memory.

/** Flip the low bit of one byte: the smallest possible tamper. */
const flipBit = (value: Uint8Array, index: number): Uint8Array => {
  const copy = Uint8Array.from(value);
  copy[index] = (copy[index] ?? 0) ^ 0x01;
  return copy;
};

/** Overwrite one byte with a chosen value. */
const setByte = (value: Uint8Array, index: number, replacement: number): Uint8Array => {
  const copy = Uint8Array.from(value);
  copy[index] = replacement;
  return copy;
};

/** Cut the record short — the relay delivering a prefix of what it received. */
const truncateTo = (value: Uint8Array, length: number): Uint8Array =>
  Uint8Array.from(value.subarray(0, length));

/** Splice a chosen envelope header onto a record's existing ciphertext. */
const restamp = (
  envelope: Uint8Array,
  position: { readonly epoch: bigint; readonly counter: bigint },
): Uint8Array => {
  const header = encodeE2eeEnvelopeHeader({ suite: SUITE, ...position });
  const restamped = new Uint8Array(envelope.byteLength);
  restamped.set(header);
  restamped.set(envelope.subarray(E2EE_ENVELOPE_HEADER_BYTES), E2EE_ENVELOPE_HEADER_BYTES);
  return restamped;
};

/** A payload a legacy peer would send: the pinned RPC serialization's JSON. */
const LEGACY_JSON_PAYLOAD = Uint8Array.from(Buffer.from('{"id":1}', "utf8"));

// ─── the relay ───────────────────────────────────────────────────────────────

type Party = "client" | "node";

interface RelayFrame {
  readonly from: Party;
  /** What the sender called it, for diagnosis only — the relay cannot read it. */
  readonly label: string;
  /** The complete post-strip payload as it left the sender. */
  readonly payload: Uint8Array;
}

/**
 * The relay, under the attacker's control. It captures every payload either
 * endpoint hands to it and forwards NOTHING on its own: a case decides, frame
 * by frame, what its peer sees. That is what makes drop, reorder, replay,
 * reflection, and injection ordinary operations here rather than special
 * machinery — a frame not handed on is dropped, one handed on twice is
 * replayed, and one handed back to its own sender is reflected.
 */
class AttackerRelay {
  readonly frames: RelayFrame[] = [];

  capture(frame: RelayFrame): RelayFrame {
    this.frames.push(frame);
    return frame;
  }

  /** Every frame a party has put on the wire, oldest first. */
  from(party: Party): readonly RelayFrame[] {
    return this.frames.filter((frame) => frame.from === party);
  }
}

// ─── the honest endpoint ─────────────────────────────────────────────────────

/** The §11.3 post-key rows this suite reaches. */
type PostKeyRow = "Q1" | "Q2" | "Q3" | "Q4" | "Q5" | "Q6" | "Q7" | "Q8" | "Q9" | "Q11";

/**
 * The §11.3 row each `unprotect` failure enumerates.
 *
 * The mapping is not invented here: `relayE2eeSession.ts` names the row in the
 * doc comment of every `E2eeReceiveFatalReason` member, and this table restates
 * it so that a case can name a §11 row (as §16.2 requires) instead of a
 * module-internal reason string. `receive_terminated` is deliberately absent —
 * it is not a condition but the latch a previous one left behind.
 */
const RECEIVE_FATAL_ROWS: Readonly<
  Record<Exclude<E2eeReceiveFatalReason, "receive_terminated">, PostKeyRow>
> = Object.freeze({
  malformed_envelope: "Q4",
  version_mismatch: "Q1",
  suite_mismatch: "Q1",
  sequence_mismatch: "Q2",
  authentication_failed: "Q3",
  reserved_inner_type: "Q5",
  malformed_record: "Q5",
});

/** The §11.3 code name a row carries. Every row here is `protocol_violation` bar Q9. */
const rowErrorCode = (row: PostKeyRow): E2eeErrorCode =>
  row === "Q9" ? E2EE_ERROR_CODE_POLICY : E2EE_ERROR_CODE_PROTOCOL_VIOLATION;

type Receipt =
  | { readonly kind: "rpc"; readonly body: Uint8Array }
  | { readonly kind: "close"; readonly branch: "sequential" | "simultaneous" }
  | { readonly kind: "close_ack"; readonly exchangeComplete: boolean }
  | { readonly kind: "terminal_error"; readonly errorCode: number; readonly defined: boolean }
  | {
      readonly kind: "fatal";
      readonly row: PostKeyRow;
      /** The module-level reason, for diagnosis alongside the row. */
      readonly reason: string;
      /** §11.5: whether the one length-uniform encrypted record was emitted. */
      readonly errorEmitted: boolean;
      readonly errorCode: E2eeErrorCode | undefined;
    }
  /** A fatal condition already terminated this direction; nothing more is processed. */
  | { readonly kind: "already_terminated" };

interface EndpointOptions {
  readonly party: Party;
  readonly relay: AttackerRelay;
  readonly secrets: E2eeSessionSecrets;
  /** Copies of the two §6.5 epoch secrets, kept for `mintNonConformingEnvelope`. */
  readonly secretCopies: { readonly c2n: Uint8Array; readonly n2c: Uint8Array };
  readonly sessionBindingHash: Uint8Array;
  readonly nodeHandshake?: E2eeNodeHandshake | undefined;
  readonly syntheticSend?: E2eeSyntheticDirectionState | undefined;
  readonly syntheticReceive?: E2eeSyntheticDirectionState | undefined;
  readonly aeadFactory?: E2eeRecordAeadFactory | undefined;
}

/**
 * One conforming endpoint, driven end to end: the §9 record session, the §10
 * close machine, and — on the node — the §8.9 implicit-finish gates. It is the
 * DRIVER a real client or node would write, and every decision it makes is a
 * value one of the landed modules returned; what it adds is the §4.3 receive
 * order, the §11.3 procedure, and the bookkeeping a case needs to assert the
 * §11.5 observable.
 */
class HonestEndpoint {
  readonly party: Party;
  readonly session: E2eeRecordSession;
  readonly close: E2eeCloseMachine;
  readonly sessionBindingHash: Uint8Array;
  /** Application bodies handed to the RPC handler (§8.9 gates this on the node). */
  readonly rpcDeliveries: Uint8Array[] = [];
  /** Every payload this endpoint put on the wire, in order. */
  readonly emitted: RelayFrame[] = [];
  /** §11.2 / §11.3: the single close reason this protocol admits. */
  channelCloseReason: string | undefined;
  /**
   * §13.6, §8.9: the node's Branch A re-read at the implicit finish. A case
   * sets it to model an owner withdrawal landing before the client's first
   * envelope authenticates — a window the relay widens simply by delaying that
   * envelope.
   */
  reReadAuthorization:
    | ((key: E2eeClientAuthorizationKey) => E2eeClientAuthorization | undefined)
    | undefined;

  readonly #relay: AttackerRelay;
  readonly #nodeHandshake: E2eeNodeHandshake | undefined;
  readonly #secretCopies: { readonly c2n: Uint8Array; readonly n2c: Uint8Array };

  constructor(options: EndpointOptions) {
    this.party = options.party;
    this.reReadAuthorization = undefined;
    this.#relay = options.relay;
    this.#nodeHandshake = options.nodeHandshake;
    this.#secretCopies = options.secretCopies;
    this.sessionBindingHash = Uint8Array.from(options.sessionBindingHash);
    const sendDirection =
      options.party === "client" ? E2EE_DIRECTION_CLIENT_TO_NODE : E2EE_DIRECTION_NODE_TO_CLIENT;
    this.session = new E2eeRecordSession({
      secrets: options.secrets,
      suite: SUITE,
      sessionBindingHash: options.sessionBindingHash,
      sendDirection,
      plaintextCeiling: PLAINTEXT_CEILING,
      ...(options.syntheticSend === undefined
        ? {}
        : { testOnlySyntheticSendState: options.syntheticSend }),
      ...(options.syntheticReceive === undefined
        ? {}
        : { testOnlySyntheticReceiveState: options.syntheticReceive }),
      ...(options.aeadFactory === undefined ? {} : { testOnlyAeadFactory: options.aeadFactory }),
    });
    this.close = new E2eeCloseMachine({
      sessionBindingHash: options.sessionBindingHash,
      sendDirection,
    });
  }

  get sendDirection(): E2eeDirection {
    return this.session.sendDirection;
  }

  get receiveDirection(): E2eeDirection {
    return this.session.receiveDirection;
  }

  get verdict(): E2eeCloseVerdict | undefined {
    return this.close.verdict;
  }

  /** The §9.3 next-send pair; the close machine and §10.1 both read it. */
  get sendPosition(): E2eeSequencePosition {
    const state = this.session.sendState;
    if (state.epoch === undefined || state.counter === undefined) {
      throw new Error("send direction is exhausted; it has no next-send position");
    }
    return { epoch: state.epoch, counter: state.counter };
  }

  /** The §9.2 expected-next receive pair. */
  get expectedRecv(): E2eeSequencePosition {
    const state = this.session.receiveState;
    if (state.epoch === undefined || state.counter === undefined) {
      throw new Error("receive direction is exhausted; it has no expected-next position");
    }
    return { epoch: state.epoch, counter: state.counter };
  }

  /**
   * §8.9: the node MUST NOT emit application RPC — and MUST NOT invoke the RPC
   * handler — until the client's first envelope authenticates. A client has no
   * such gate.
   */
  get mayEmitApplicationRpc(): boolean {
    return this.#nodeHandshake === undefined ? true : this.#nodeHandshake.mayEmitApplicationRpc;
  }

  get mayInvokeRpcHandler(): boolean {
    return this.#nodeHandshake === undefined ? true : this.#nodeHandshake.mayInvokeRpcHandler;
  }

  /** Send one application RPC record, subject to the §8.9 gate and §9.3. */
  async sendRpc(
    body: Uint8Array,
    label = "rpc",
  ): Promise<
    | { readonly kind: "sent"; readonly result: E2eeProtectResult; readonly frame: RelayFrame }
    | { readonly kind: "refused_before_implicit_finish" }
    | { readonly kind: "not_sent"; readonly result: E2eeProtectResult }
  > {
    if (!this.mayEmitApplicationRpc) return { kind: "refused_before_implicit_finish" };
    const sent = await this.protectRaw(E2EE_INNER_TYPE_RPC, body, label);
    if (sent.frame === undefined) return { kind: "not_sent", result: sent.result };
    return { kind: "sent", result: sent.result, frame: sent.frame };
  }

  /**
   * Protect one inner record and hand it to the relay, BYPASSING the §10 close
   * machine.
   *
   * The conforming send paths above and below go through the close machine, so
   * this is the NON-CONFORMING PEER's send path: it is how a case produces a
   * close acknowledgement the machine would refuse to build, or a record
   * protected past the point §10.2 permits. It still goes through the real §9
   * session, so §9.3's own gates apply and a case can tell "the session refused
   * it" from "the peer sent it and the receiver rejected it".
   */
  async protectRaw(
    innerType: E2eeInnerRecordType,
    body: Uint8Array,
    label: string,
  ): Promise<{ readonly result: E2eeProtectResult; readonly frame: RelayFrame | undefined }> {
    let frame: RelayFrame | undefined;
    const result = await this.session.protect({
      innerType,
      body,
      admit: () => true,
      transmit: (envelope) => {
        frame = this.#emit(label, envelope);
        return { kind: "sent" };
      },
    });
    return { result, frame };
  }

  /** §10.2 step 1: this endpoint's initiating `E2EEClose`. */
  async initiateClose(now: number): Promise<{
    readonly record: E2eeCloseRecordToSend;
    readonly frame: RelayFrame;
  }> {
    return this.#sendCloseRecord(
      this.close.buildClose({
        sendPosition: this.sendPosition,
        expectedRecv: this.expectedRecv,
      }),
      now,
    );
  }

  /** Whatever §10.2 currently obliges this endpoint to send: an ack, or the final confirmation. */
  async sendOwedCloseRecord(now: number): Promise<{
    readonly record: E2eeCloseRecordToSend;
    readonly frame: RelayFrame;
  }> {
    const owed = this.close.pendingRecord;
    if (owed === undefined) throw new Error("the close machine owes nothing in this state");
    return this.#sendCloseRecord(
      this.close.buildCloseAck({
        sendPosition: this.sendPosition,
        expectedRecv: this.close.ackExpectedRecv ?? this.expectedRecv,
      }),
      now,
    );
  }

  async #sendCloseRecord(
    record: E2eeCloseRecordToSend,
    now: number,
  ): Promise<{ readonly record: E2eeCloseRecordToSend; readonly frame: RelayFrame }> {
    const sent = await this.protectRaw(record.innerType, record.body, record.purpose);
    if (sent.result.kind !== "protected" || sent.frame === undefined) {
      throw new Error(`close record was not protected: ${sent.result.kind}`);
    }
    this.close.noteTransmitted({
      record,
      epoch: sent.result.epoch,
      counter: sent.result.counter,
      epochCompleted: sent.result.epochCompleted,
      at: now,
    });
    return { record, frame: sent.frame };
  }

  /**
   * The §4.3 receive pipeline, in the order §4.3 fixes it: post-strip
   * discrimination, then the §9.1/§9.2 checks and the AEAD, then — only on an
   * AUTHENTICATED plaintext — the inner-record type and the §10 close machine.
   *
   * The channel is in `e2ee` throughout this suite, so every class §4.3 step 2
   * yields other than `envelope` is §11.3 Q6, and §10.2 grants the close phase
   * no exemption from it.
   */
  async deliver(payload: Uint8Array, now: number): Promise<Receipt> {
    const payloadClass = classifyPostStripPayload(payload);
    if (payloadClass.kind !== "envelope") {
      const reason =
        payloadClass.kind === "other" ? `other:${payloadClass.reason}` : payloadClass.kind;
      return this.#postKeyFatal("Q6", reason);
    }
    const opened = this.session.unprotect(payload);
    if (opened.kind === "fatal") {
      if (opened.reason === "receive_terminated") return { kind: "already_terminated" };
      return this.#postKeyFatal(RECEIVE_FATAL_ROWS[opened.reason], opened.reason);
    }
    const received = this.close.receive({
      innerType: opened.innerType,
      body: opened.body,
      envelope: { epoch: opened.epoch, counter: opened.counter },
      epochCompleted: opened.epochCompleted,
      currentNextSend: this.sendPosition,
      at: now,
    });
    switch (received.kind) {
      case "fatal":
        return this.#postKeyFatal(received.row, received.reason);
      case "terminal_error": {
        // §11.3: a received `E2EEError` is terminal; the receiver erases and
        // closes and MUST NOT reply. The close machine has already recorded
        // **Failed** and refuses any further record.
        this.session.erase();
        this.channelCloseReason = "channel_rejected";
        return {
          kind: "terminal_error",
          errorCode: received.value.errorCode,
          defined: received.value.defined,
        };
      }
      case "close":
        return { kind: "close", branch: received.branch };
      case "close_ack":
        return { kind: "close_ack", exchangeComplete: received.exchangeComplete };
      case "application": {
        // §8.9: the FIRST valid client-to-node `0x01` envelope is the implicit
        // finish, and it is the point at which the node may invoke the RPC
        // handler at all. The gate is checked before the handler runs, never
        // after.
        if (this.#nodeHandshake !== undefined && !this.#nodeHandshake.mayInvokeRpcHandler) {
          const finish = this.#nodeHandshake.authenticateImplicitFinish({
            now,
            // §13.6: the last re-check before a withdrawn authority could reach
            // application state. Supplied when a case models an owner command
            // landing in the window the relay's delay opened.
            ...(this.reReadAuthorization === undefined
              ? {}
              : { reReadAuthorization: this.reReadAuthorization }),
          });
          if (finish.kind === "fatal") {
            return this.#postKeyFatal(finish.row, finish.reason);
          }
        }
        const body = Uint8Array.from(opened.body);
        this.rpcDeliveries.push(body);
        return { kind: "rpc", body };
      }
    }
  }

  /** §8.9 / §11.3 Q8: the implicit-finish deadline expired with no authenticated finish. */
  async expireImplicitFinish(now: number): Promise<Receipt> {
    const handshake = this.#nodeHandshake;
    if (handshake === undefined) throw new Error("only the node arms the §8.9 deadline");
    const finish = handshake.authenticateImplicitFinish({ now });
    if (finish.kind !== "fatal") throw new Error("the §8.9 deadline had not expired");
    return this.#postKeyFatal(finish.row, finish.reason);
  }

  /** §10.2, §10.4: this endpoint's `T_CLOSE`-bounded wait expired. */
  noteWaitExpired(now: number): E2eeCloseVerdict {
    const verdict = this.close.noteWaitExpired(now);
    this.session.erase();
    return verdict;
  }

  /** §10.4: the channel, connection, or socket ended. */
  noteChannelEnded(input: {
    readonly at: number;
    readonly incompleteReassembly?: boolean;
  }): E2eeCloseVerdict {
    const verdict = this.close.noteChannelEnded(
      input.incompleteReassembly === undefined
        ? { at: input.at }
        : { at: input.at, incompleteReassembly: input.incompleteReassembly },
    );
    this.session.erase();
    return verdict;
  }

  /**
   * §11.3's complete procedure for a post-key fatal condition: stop delivering;
   * emit exactly one `E2EEError` while the send path is usable; erase every
   * session secret; close with reason `channel_rejected`. §11.5 is the
   * observable this builds, and the cases assert it record by record.
   */
  async #postKeyFatal(row: PostKeyRow, reason: string): Promise<Receipt> {
    // §10.4: every condition here is **Failed**, and it supersedes a **Clean**
    // already recorded. The close machine may have recorded it already (Q7,
    // Q11); recording it again is idempotent.
    this.close.noteFatal();
    const code = rowErrorCode(row);
    let errorEmitted = false;
    if (!this.session.erased && this.session.sendPathUsable && this.close.mayProtectTerminalError) {
      const sent = await this.protectRaw(
        E2EE_INNER_TYPE_ERROR,
        encodeE2eeErrorRecordBody(code),
        `E2EEError(${String(code)})`,
      );
      if (sent.result.kind === "protected") {
        this.close.noteTerminalErrorTransmitted();
        errorEmitted = true;
      }
    }
    this.session.erase();
    this.channelCloseReason = "channel_rejected";
    return { kind: "fatal", row, reason, errorEmitted, errorCode: errorEmitted ? code : undefined };
  }

  #emit(label: string, payload: Uint8Array): RelayFrame {
    const frame = this.#relay.capture({ from: this.party, label, payload });
    this.emitted.push(frame);
    return frame;
  }

  /**
   * A record a peer HOLDING THE SESSION KEYS but ignoring the protocol can put
   * on the wire, at any `(epoch, counter)` and with any inner-record type —
   * including one §3.4 reserves.
   *
   * NOT A RELAY CAPABILITY. §2.1 gives the relay no keys, and every case using
   * this says so: it bounds what a non-conforming or compromised PEER can do,
   * which is a different and strictly larger power. The epoch schedule is
   * rebuilt with the module's own §9.4 ratchet, so the bytes are exactly what
   * the peer's session would have produced at that position.
   */
  mintNonConformingEnvelope(input: {
    readonly epoch: bigint;
    readonly counter: bigint;
    readonly innerType?: number;
    readonly body?: Uint8Array;
    readonly rawPlaintext?: Uint8Array;
  }): Uint8Array {
    const direction = this.sendDirection;
    let epochSecret = Uint8Array.from(
      direction === E2EE_DIRECTION_CLIENT_TO_NODE ? this.#secretCopies.c2n : this.#secretCopies.n2c,
    );
    for (let epoch = 0n; epoch < input.epoch; epoch += 1n) {
      epochSecret = Uint8Array.from(deriveE2eeNextEpochSecret(epochSecret, direction));
    }
    const key = deriveE2eeAeadKey(epochSecret, direction);
    const header = encodeE2eeEnvelopeHeader({
      suite: SUITE,
      epoch: input.epoch,
      counter: input.counter,
    });
    const aad = e2eeEnvelopeAad({
      header,
      sessionBindingHash: this.sessionBindingHash,
      direction,
    });
    const plaintext =
      input.rawPlaintext ??
      Uint8Array.from([
        input.innerType ?? E2EE_INNER_TYPE_RPC,
        ...(input.body ?? new Uint8Array(0)),
      ]);
    const ciphertext = chacha20poly1305(key, e2eeAeadNonceFromHeader(header), aad).encrypt(
      plaintext,
    );
    if (ciphertext.byteLength >= E2EE_ENVELOPE_OVERHEAD_BYTES - E2EE_ENVELOPE_HEADER_BYTES) {
      return encodeE2eeEnvelope({
        suite: SUITE,
        epoch: input.epoch,
        counter: input.counter,
        ciphertext,
      });
    }
    // `encodeE2eeEnvelope` refuses a ciphertext below the §3.3 minimum, which is
    // the sending half of the same rule the receiver enforces. A peer ignoring
    // the framing would still put these bytes on the wire, so the concatenation
    // is done by hand here — and the receiving case asserts it is rejected.
    const undersized = new Uint8Array(header.byteLength + ciphertext.byteLength);
    undersized.set(header);
    undersized.set(ciphertext, header.byteLength);
    return undersized;
  }
}

// ─── channel construction ────────────────────────────────────────────────────

const channel = (overrides: Partial<E2eeHandshakeChannel> = {}): E2eeHandshakeChannel => ({
  hubOrigin: HUB_ORIGIN,
  channelId: CHANNEL_ID,
  relayProtocolMajor: 1,
  relayProtocolMinor: 2,
  channelOpenCapability: CAPABILITY,
  channelOpenEffectiveRole: ROLE,
  ...overrides,
});

const advertised = (
  overrides: Partial<E2eeAdvertisedChannelMaterial> = {},
): E2eeAdvertisedChannelMaterial => ({
  nodeId: NODE_ID,
  nodeIdentityFingerprint: NODE_IDENTITY_FINGERPRINT,
  prekeyId: PREKEY_ID,
  agreementPublicKey: NODE_AGREEMENT_PUBLIC,
  continuityChainTranscripts: [],
  continuityId: CONTINUITY_ID,
  ...overrides,
});

const nativeCredentials = (): E2eeClientHandshakeCredentials => ({
  tier: "native",
  accountId: ACCOUNT_ID,
  identityPublicKey: CLIENT_IDENTITY_PUBLIC,
  agreementPublicKey: CLIENT_AGREEMENT_PUBLIC,
  agreementSecretKey: CLIENT_AGREEMENT_SECRET,
  prekeyTranscript: CLIENT_PREKEY_TRANSCRIPT,
  prekeySignature: CLIENT_PREKEY_SIGNATURE,
});

interface HandshakePairOptions {
  readonly tier: E2eeTier;
  readonly offeredSuites?: readonly number[];
  readonly policy?: E2eeNodeAdmissionPolicy;
  readonly authorization?: E2eeClientAuthorization | undefined;
  readonly intendedCapability?: string;
  readonly intendedRole?: string;
}

const makeClient = (options: HandshakePairOptions): E2eeClientHandshake =>
  new E2eeClientHandshake({
    channel: channel(),
    advertised: advertised(),
    selectedSuite: SUITE,
    offeredSuites: options.offeredSuites ?? [SUITE],
    credentials: options.tier === "native" ? nativeCredentials() : { tier: "web" },
    intendedCapability: options.intendedCapability ?? CAPABILITY,
    intendedRole: options.intendedRole ?? ROLE,
    testOnlyClientNonce: CLIENT_NONCE,
    testOnlyEphemeralSecretKey: CLIENT_EPHEMERAL_SECRET,
  });

const makeNode = (options: Partial<HandshakePairOptions> = {}): E2eeNodeHandshake =>
  new E2eeNodeHandshake({
    channel: channel(),
    advertised: advertised(),
    advertisedVersionMin: 1,
    advertisedVersionMax: 1,
    agreementSecretKey: NODE_AGREEMENT_SECRET,
    advertisementEmittedAt: NOW,
    readPolicy: () =>
      options.policy ?? { requireApprovedClientE2EE: false, suiteRegistry: [SUITE] },
    lookupClientAuthorization: () =>
      "authorization" in options ? options.authorization : APPROVED,
    testOnlyEphemeralSecretKey: NODE_EPHEMERAL_SECRET,
  });

interface EstablishOptions extends HandshakePairOptions {
  /** Applied to the hello as it crosses the attacker-controlled relay. */
  readonly tamperHello?: (record: Uint8Array) => Uint8Array;
  /** Applied to the accept as it crosses the attacker-controlled relay. */
  readonly tamperAccept?: (record: Uint8Array) => Uint8Array;
  readonly syntheticC2N?: E2eeSyntheticDirectionState;
  readonly syntheticN2C?: E2eeSyntheticDirectionState;
  readonly clientAead?: E2eeRecordAeadFactory;
  readonly nodeAead?: E2eeRecordAeadFactory;
  /**
   * Whether the client sends one RPC record so the node's §8.9 implicit finish
   * authenticates. Cases about the finish itself set it false.
   */
  readonly primeImplicitFinish?: boolean;
  /**
   * The relay the two endpoints emit into. A capture-only `AttackerRelay` by
   * default; section K supplies the ACTIVE `HostileRelay` instead, which is the
   * only difference between the two halves of this suite.
   */
  readonly relay?: AttackerRelay;
}

interface LiveChannel {
  readonly client: HonestEndpoint;
  readonly node: HonestEndpoint;
  readonly relay: AttackerRelay;
  readonly sessionBindingHash: Uint8Array;
}

/**
 * A complete, honest §8 handshake — optionally with the relay tampering with
 * the two negotiation records as they cross — followed by two live endpoints
 * wired to the same relay.
 */
const establish = async (options: EstablishOptions): Promise<LiveChannel> => {
  const relay = options.relay ?? new AttackerRelay();
  const clientHandshake = makeClient(options);
  const nodeHandshake = makeNode(options);

  const hello = clientHandshake.createHello(NOW);
  if (hello.kind !== "hello") throw new Error(`hello: ${hello.row}/${hello.reason}`);
  const deliveredHello = options.tamperHello?.(hello.record) ?? hello.record;
  const accept = nodeHandshake.receiveHello(deliveredHello, NOW);
  if (accept.kind !== "accepted") throw new Error(`accept: ${accept.row}/${accept.reason}`);
  const deliveredAccept = options.tamperAccept?.(accept.record) ?? accept.record;
  const established = clientHandshake.receiveServerAccept(deliveredAccept, NOW);
  if (established.kind !== "established") {
    throw new Error(`established: ${established.row}/${established.reason}`);
  }

  const secretCopies = {
    c2n: Uint8Array.from(established.secrets.epochSecretC2N),
    n2c: Uint8Array.from(established.secrets.epochSecretN2C),
  };
  const client = new HonestEndpoint({
    party: "client",
    relay,
    secrets: established.secrets,
    secretCopies,
    sessionBindingHash: established.sessionBindingHash,
    syntheticSend: options.syntheticC2N,
    syntheticReceive: options.syntheticN2C,
    aeadFactory: options.clientAead,
  });
  const node = new HonestEndpoint({
    party: "node",
    relay,
    secrets: accept.secrets,
    secretCopies,
    sessionBindingHash: accept.sessionBindingHash,
    nodeHandshake,
    syntheticSend: options.syntheticN2C,
    syntheticReceive: options.syntheticC2N,
    aeadFactory: options.nodeAead,
  });

  if (options.primeImplicitFinish !== false) {
    const primed = await client.sendRpc(Uint8Array.from([0x11]), "implicit finish");
    if (primed.kind !== "sent") throw new Error("the priming record was not sent");
    const receipt = await node.deliver(primed.frame.payload, NOW);
    if (receipt.kind !== "rpc") throw new Error(`priming: ${receipt.kind}`);
  }
  return { client, node, relay, sessionBindingHash: established.sessionBindingHash };
};

const expectFatal = (receipt: Receipt): Extract<Receipt, { kind: "fatal" }> => {
  if (receipt.kind !== "fatal") throw new Error(`expected a fatal receipt, got ${receipt.kind}`);
  return receipt;
};

// ─── pre-key crafting (the relay impersonating an endpoint) ──────────────────

const nativeContext = (
  overrides: Partial<E2eeAuthorizationContextInput> = {},
): E2eeAuthorizationContextInput => ({
  hubOrigin: HUB_ORIGIN,
  channelId: CHANNEL_ID,
  relayProtocolMajor: 1,
  relayProtocolMinor: 2,
  e2eeVersion: 1,
  suiteId: SUITE,
  nodeId: NODE_ID,
  nodeIdentityFingerprint: NODE_IDENTITY_FINGERPRINT,
  clientIntendedCapability: CAPABILITY,
  clientIntendedRole: ROLE,
  channelOpenCapability: CAPABILITY,
  channelOpenEffectiveRole: ROLE,
  nodeAgreementFingerprint: NODE_AGREEMENT_FINGERPRINT,
  nodeContinuityChainTranscripts: [],
  nodeContinuityId: CONTINUITY_ID,
  client: {
    tier: "native",
    accountId: ACCOUNT_ID,
    identityFingerprint: CLIENT_IDENTITY_FINGERPRINT,
    agreementFingerprint: CLIENT_AGREEMENT_FINGERPRINT,
  },
  ...overrides,
});

/**
 * A hello the ATTACKER composed rather than a conforming client: the context
 * block, the commitment, the wrapper tier, the Noise pattern, the payload
 * claims, and the offered-suite list are all chosen independently.
 *
 * This is what a relay running its own handshake attempt against the node can
 * emit. It needs no key material the relay does not have: the IK static is the
 * client's own certificate key only in the cases that say so, and every other
 * case supplies exactly the material the attacker would hold.
 */
const craftHello = (input: {
  readonly contextBlock: Uint8Array;
  readonly commitment?: Uint8Array;
  readonly wrapperTier?: E2eeTier;
  readonly noiseTier?: E2eeTier;
  readonly claims?: Partial<E2eeIkHelloPayload>;
  readonly offeredSuites?: readonly number[];
  /**
   * IK message-1 payload bytes chosen outright, for claims the §8.5 payload
   * encoder validates and therefore refuses to build — a capability or role
   * literal the relay contract's closed vocabulary does not admit.
   */
  readonly rawIkPayload?: Uint8Array;
}): Uint8Array => {
  const commitment = input.commitment ?? e2eeAuthorizationContextCommitment(input.contextBlock);
  const noiseTier = input.noiseTier ?? input.wrapperTier ?? "native";
  const prologue = encodeE2eeNoisePrologue({
    hubOrigin: HUB_ORIGIN,
    channelId: CHANNEL_ID,
    relayProtocolMajor: 1,
    relayProtocolMinor: 2,
    e2eeVersion: 1,
    suiteId: SUITE,
    nodeId: NODE_ID,
    contextCommitment: commitment,
  });
  const noise = new E2eeNoiseHandshake({
    pattern: noiseTier === "native" ? E2EE_NOISE_PATTERN_IK : E2EE_NOISE_PATTERN_NX,
    role: "initiator",
    prologue,
    ...(noiseTier === "native"
      ? { staticSecretKey: CLIENT_AGREEMENT_SECRET, remoteStaticPublicKey: NODE_AGREEMENT_PUBLIC }
      : {}),
    testOnlyEphemeralSecretKey: CLIENT_EPHEMERAL_SECRET,
  });
  const payload =
    input.rawIkPayload ??
    (noiseTier === "native"
      ? encodeE2eeIkHelloPayload({
          clientPrekeyTranscript: CLIENT_PREKEY_TRANSCRIPT,
          clientPrekeySignature: CLIENT_PREKEY_SIGNATURE,
          accountId: ACCOUNT_ID,
          intendedCapability: CAPABILITY,
          intendedRole: ROLE,
          ...input.claims,
        })
      : E2EE_NX_HELLO_PAYLOAD);
  return encodeE2eeClientHello({
    tier: input.wrapperTier ?? noiseTier,
    selectedSuite: SUITE,
    offeredSuites: input.offeredSuites ?? [SUITE],
    clientNonce: CLIENT_NONCE,
    contextCommitment: commitment,
    noiseMessage1: noise.writeMessage(payload),
  });
};

/** Run one crafted hello against a fresh node and name the §11.2 row it produces. */
const nodeRowFor = (
  helloRecord: Uint8Array,
  options: Partial<HandshakePairOptions> = {},
): { readonly row: E2eePreKeyRow; readonly reason: string } => {
  const node = makeNode(options);
  const result = node.receiveHello(helloRecord, NOW);
  if (result.kind !== "fatal") throw new Error("the node accepted a hello it must reject");
  return { row: result.row, reason: result.reason };
};

// ─── a counting AEAD ─────────────────────────────────────────────────────────

interface CountingAead {
  readonly calls: { select: number; seal: number; open: number };
  readonly factory: E2eeRecordAeadFactory;
}

/**
 * A counting stand-in for the suite AEAD, delegating to the same primitive the
 * suite selects. §9.1 requires the version and suite comparison, and §9.2 the
 * sequence comparison, to happen BEFORE any AEAD implementation is selected;
 * `select` and `open` are what make that observable from outside.
 */
const countingAead = (): CountingAead => {
  const calls = { select: 0, seal: 0, open: 0 };
  const factory: E2eeRecordAeadFactory = ({ key }) => {
    calls.select += 1;
    return {
      seal: (nonce, plaintext, aad) => {
        calls.seal += 1;
        return chacha20poly1305(key, nonce, aad).encrypt(plaintext);
      },
      open: (nonce, ciphertext, aad) => {
        calls.open += 1;
        return chacha20poly1305(key, nonce, aad).decrypt(ciphertext);
      },
    };
  };
  return { calls, factory };
};

// ═════════════════════════════════════════════════════════════════════════════
// A. Envelope mutation at every header field, and truncation (§3.3, §9.1–§9.2)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The §11.3 row a flipped bit at each envelope-header offset produces. The
 * table is the §3.3 layout read straight off: offset 0 is the discriminator, 1
 * the version, 2 the suite, 3–6 the epoch, and 7–14 the counter — so the rows
 * are Q6 (the payload is no longer an envelope at all), Q1, Q1, and then Q2 for
 * every byte of the nonce.
 */
const HEADER_FIELD_ROWS: readonly {
  readonly offset: number;
  readonly field: string;
  readonly row: PostKeyRow;
}[] = [
  { offset: 0, field: "discriminator", row: "Q6" },
  { offset: 1, field: "version", row: "Q1" },
  { offset: 2, field: "suite", row: "Q1" },
  { offset: 3, field: "epoch byte 0", row: "Q2" },
  { offset: 4, field: "epoch byte 1", row: "Q2" },
  { offset: 5, field: "epoch byte 2", row: "Q2" },
  { offset: 6, field: "epoch byte 3", row: "Q2" },
  { offset: 7, field: "counter byte 0", row: "Q2" },
  { offset: 8, field: "counter byte 1", row: "Q2" },
  { offset: 9, field: "counter byte 2", row: "Q2" },
  { offset: 10, field: "counter byte 3", row: "Q2" },
  { offset: 11, field: "counter byte 4", row: "Q2" },
  { offset: 12, field: "counter byte 5", row: "Q2" },
  { offset: 13, field: "counter byte 6", row: "Q2" },
  { offset: 14, field: "counter byte 7", row: "Q2" },
];

describe("attacker relay: envelope mutation at every header field", () => {
  it("covers every byte of the §3.3 header, so no field is left untested", () => {
    expect(HEADER_FIELD_ROWS).toHaveLength(E2EE_ENVELOPE_HEADER_BYTES);
    expect(HEADER_FIELD_ROWS.map((entry) => entry.offset)).toEqual(
      Array.from({ length: E2EE_ENVELOPE_HEADER_BYTES }, (_unused, index) => index),
    );
  });

  for (const { offset, field, row } of HEADER_FIELD_ROWS) {
    it(`rejects a flipped ${field} byte (offset ${String(offset)}) as ${row}`, async () => {
      const { client, node } = await establish({ tier: "native" });
      const sent = await client.sendRpc(Uint8Array.from([0x01, 0x02]));
      if (sent.kind !== "sent") throw new Error("the record was not sent");

      const receipt = expectFatal(await node.deliver(flipBit(sent.frame.payload, offset), NOW));
      expect(receipt.row).toBe(row);
      // §11.5: one length-uniform encrypted record, then `channel_rejected`.
      expect(receipt.errorEmitted).toBe(true);
      expect(receipt.errorCode).toBe(E2EE_ERROR_CODE_PROTOCOL_VIOLATION);
      expect(node.channelCloseReason).toBe("channel_rejected");
      expect(node.rpcDeliveries).toHaveLength(1); // the priming record only
      expect(node.verdict).toBe("failed");
      expect(node.session.erased).toBe(true);
    });
  }

  it("rejects a flipped ciphertext byte as Q3, the AEAD authentication failure", async () => {
    const { client, node } = await establish({ tier: "native" });
    const sent = await client.sendRpc(Uint8Array.from([0x01, 0x02]));
    if (sent.kind !== "sent") throw new Error("the record was not sent");

    const receipt = expectFatal(
      await node.deliver(flipBit(sent.frame.payload, E2EE_ENVELOPE_HEADER_BYTES), NOW),
    );
    expect(receipt.row).toBe("Q3");
    expect(receipt.reason).toBe("authentication_failed");
    expect(node.verdict).toBe("failed");
  });

  it("rejects a flipped AEAD tag byte as Q3", async () => {
    const { client, node } = await establish({ tier: "native" });
    const sent = await client.sendRpc(Uint8Array.from([0x01, 0x02]));
    if (sent.kind !== "sent") throw new Error("the record was not sent");

    const last = sent.frame.payload.byteLength - 1;
    const receipt = expectFatal(await node.deliver(flipBit(sent.frame.payload, last), NOW));
    expect(receipt.row).toBe("Q3");
    expect(receipt.reason).toBe("authentication_failed");
  });

  it("never selects an AEAD for a mutated header field (§9.1, §9.2 ordering)", async () => {
    // The strongest form of the ordering rule: the mutated record ALSO carries a
    // corrupted ciphertext, so an implementation that decrypted first would
    // report Q3. A conforming one never reaches the AEAD at all.
    const aead = countingAead();
    const { client, node } = await establish({ tier: "native", nodeAead: aead.factory });
    const sent = await client.sendRpc(Uint8Array.from([0x01, 0x02]));
    if (sent.kind !== "sent") throw new Error("the record was not sent");
    const opensAfterPriming = aead.calls.open;

    const doublyTampered = flipBit(flipBit(sent.frame.payload, 7), E2EE_ENVELOPE_HEADER_BYTES + 1);
    const receipt = expectFatal(await node.deliver(doublyTampered, NOW));
    expect(receipt.row).toBe("Q2");
    expect(receipt.reason).toBe("sequence_mismatch");
    expect(aead.calls.open).toBe(opensAfterPriming);
  });

  it("rejects an envelope truncated below E2EE_ENVELOPE_OVERHEAD_BYTES as Q4", async () => {
    const { client, node } = await establish({ tier: "native" });
    const sent = await client.sendRpc(Uint8Array.from([0x01, 0x02]));
    if (sent.kind !== "sent") throw new Error("the record was not sent");

    const receipt = expectFatal(
      await node.deliver(truncateTo(sent.frame.payload, E2EE_ENVELOPE_OVERHEAD_BYTES - 1), NOW),
    );
    expect(receipt.row).toBe("Q4");
    expect(receipt.reason).toBe("malformed_envelope");
  });

  it("rejects an envelope truncated inside its ciphertext as Q3", async () => {
    const { client, node } = await establish({ tier: "native" });
    const sent = await client.sendRpc(Uint8Array.from([0x01, 0x02, 0x03, 0x04, 0x05]));
    if (sent.kind !== "sent") throw new Error("the record was not sent");

    // Still a structurally valid envelope with the expected pair, so the failure
    // is the AEAD's and not the length bound's.
    const receipt = expectFatal(
      await node.deliver(truncateTo(sent.frame.payload, sent.frame.payload.byteLength - 1), NOW),
    );
    expect(receipt.row).toBe("Q3");
    expect(receipt.reason).toBe("authentication_failed");
  });

  it("rejects a zero-length post-strip payload as Q6, never as a benign no-op", async () => {
    const { node } = await establish({ tier: "native" });
    const receipt = expectFatal(await node.deliver(new Uint8Array(0), NOW));
    expect(receipt.row).toBe("Q6");
    expect(receipt.reason).toBe("other:empty");
    expect(receipt.errorEmitted).toBe(true);
  });

  it("rejects injected legacy JSON in `e2ee` as Q6", async () => {
    const { node } = await establish({ tier: "native" });
    const receipt = expectFatal(await node.deliver(LEGACY_JSON_PAYLOAD, NOW));
    expect(receipt.row).toBe("Q6");
    expect(receipt.reason).toBe("legacy-json");
    expect(node.verdict).toBe("failed");
  });

  it("rejects an injected negotiation record in `e2ee` as Q6", async () => {
    const { node } = await establish({ tier: "native" });
    const injected = craftHello({ contextBlock: encodeE2eeAuthorizationContext(nativeContext()) });
    const receipt = expectFatal(await node.deliver(injected, NOW));
    expect(receipt.row).toBe("Q6");
    expect(receipt.reason).toBe("negotiation");
  });

  it("latches the receive direction after a fatal condition", async () => {
    // §11.3 fixes a COMPLETE procedure for a post-key fatal condition — stop
    // delivering records, emit exactly one `E2EEError` while the send path is
    // usable, erase every session secret, close with `channel_rejected` — and
    // §11.5 is the observable it produces. A relay that follows a tampered
    // record with the UNTOUCHED one is attacking every clause of that at once,
    // so the case asserts every clause rather than that a second delivery
    // "throws": an endpoint that erased nothing, or that answered the second
    // record with a second error envelope, or that ran the AEAD again and let
    // the genuine record through, all throw somewhere too.
    const aead = countingAead();
    const { client, node } = await establish({ tier: "native", nodeAead: aead.factory });
    const sent = await client.sendRpc(Uint8Array.from([0x01, 0x02]));
    if (sent.kind !== "sent") throw new Error("the record was not sent");

    const receipt = expectFatal(await node.deliver(flipBit(sent.frame.payload, 20), NOW));
    expect(receipt.row).toBe("Q3");
    expect(receipt.reason).toBe("authentication_failed");
    // §11.5: one length-uniform encrypted record, then `channel_rejected`.
    expect(receipt.errorEmitted).toBe(true);
    expect(receipt.errorCode).toBe(E2EE_ERROR_CODE_PROTOCOL_VIOLATION);
    expect(node.channelCloseReason).toBe("channel_rejected");
    expect(node.verdict).toBe("failed");
    expect(node.session.erased).toBe(true);
    expect(node.session.sendPathUsable).toBe(false);
    const emittedByTheFatal = node.emitted.length;
    const opensByTheFatal = aead.calls.open;

    // The untouched record, delivered second. §11.3's erasure — not another
    // authentication failure — is what refuses it, and the refusal names the
    // reason in as many words: the session is gone and is never resumed.
    expect(() => node.session.unprotect(sent.frame.payload)).toThrow(TypeError);
    expect(() => node.session.unprotect(sent.frame.payload)).toThrow(
      "Relay E2EE session has been erased; it is never resumed.",
    );
    // Nothing was processed and nothing was answered: the AEAD was never
    // invoked again, no second `E2EEError` reached the wire (§11.3 fixes the
    // count at exactly one), and the record never reached the RPC handler.
    expect(aead.calls.open).toBe(opensByTheFatal);
    expect(node.emitted).toHaveLength(emittedByTheFatal);
    expect(node.rpcDeliveries).toHaveLength(1); // the priming record only
    // And the verdict does not move: §10.4 **Failed** is terminal.
    expect(node.verdict).toBe("failed");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// B. Control-record mutation at every field (§10.1)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The §10.1 body is the canonical-CBOR array of exactly five byte strings:
 * `[ bstr(4), bstr(8), bstr(4), bstr(8), bstr(32) ]`. The offsets below are that
 * layout read off the canonical encoding, and the first case asserts them
 * against the body the module actually produces, so a change to the body shape
 * fails here rather than silently retargeting every mutation.
 */
const CLOSE_BODY_FIELDS: readonly {
  readonly field: string;
  readonly offset: number;
  readonly reason: string;
}[] = [
  { field: "0 finalSend epoch", offset: 2, reason: "header_mismatch" },
  { field: "1 finalSend counter", offset: 7, reason: "header_mismatch" },
  { field: "2 expectedRecv epoch", offset: 16, reason: "commitment_mismatch" },
  { field: "3 expectedRecv counter", offset: 21, reason: "commitment_mismatch" },
  { field: "4 closeCommitment", offset: 31, reason: "commitment_mismatch" },
];

describe("attacker relay: close-record mutation at every field", () => {
  const closeBodyFrom = (
    endpoint: HonestEndpoint,
    overrides: Partial<{
      finalSend: E2eeSequencePosition;
      expectedRecv: E2eeSequencePosition;
    }> = {},
  ): Uint8Array =>
    encodeE2eeCloseRecordBody({
      innerType: E2EE_INNER_TYPE_CLOSE,
      senderDirection: endpoint.sendDirection,
      sessionBindingHash: endpoint.sessionBindingHash,
      finalSend: overrides.finalSend ?? endpoint.sendPosition,
      expectedRecv: overrides.expectedRecv ?? endpoint.expectedRecv,
    });

  it("pins the §10.1 body layout the field offsets are read from", async () => {
    const { client } = await establish({ tier: "native" });
    const body = closeBodyFrom(client);
    expect(body.byteLength).toBe(63);
    expect(E2EE_INNER_TYPE_BYTES + body.byteLength).toBe(64);
    expect([...body.subarray(0, 2)]).toEqual([0x85, 0x44]);
    expect(body[6]).toBe(0x48);
    expect(body[15]).toBe(0x44);
    expect(body[20]).toBe(0x48);
    expect([...body.subarray(29, 31)]).toEqual([0x58, 0x20]);
  });

  for (const { field, offset, reason } of CLOSE_BODY_FIELDS) {
    it(`rejects a mutated close-record field ${field} as Q7 ${reason}`, async () => {
      // A NON-CONFORMING PEER, not the relay: the body is inside the AEAD, so a
      // relay flipping this bit produces Q3 instead (asserted separately).
      const { client, node } = await establish({ tier: "native" });
      const body = flipBit(closeBodyFrom(node), offset);
      const sent = await node.protectRaw(E2EE_INNER_TYPE_CLOSE, body, "mutated close");
      if (sent.frame === undefined) throw new Error("the record was not protected");

      const receipt = expectFatal(await client.deliver(sent.frame.payload, NOW));
      expect(receipt.row).toBe("Q7");
      expect(receipt.reason).toBe(reason);
      expect(client.verdict).toBe("failed");
      expect(receipt.errorEmitted).toBe(true);
      expect(receipt.errorCode).toBe(E2EE_ERROR_CODE_PROTOCOL_VIOLATION);
    });
  }

  it("rejects a truncated close-record body as Q7 malformed_body", async () => {
    const { client, node } = await establish({ tier: "native" });
    const body = truncateTo(closeBodyFrom(node), 40);
    const sent = await node.protectRaw(E2EE_INNER_TYPE_CLOSE, body, "truncated close");
    if (sent.frame === undefined) throw new Error("the record was not protected");

    const receipt = expectFatal(await client.deliver(sent.frame.payload, NOW));
    expect(receipt.row).toBe("Q7");
    expect(receipt.reason).toBe("malformed_body");
    expect(client.verdict).toBe("failed");
  });

  it("rejects a close record whose body declares a position it was not protected at", async () => {
    // §10.1 fields 0–1 MUST byte-equal the carrying envelope's header fields.
    const { client, node } = await establish({ tier: "native" });
    const body = closeBodyFrom(node, { finalSend: { epoch: 0n, counter: 9n } });
    const sent = await node.protectRaw(E2EE_INNER_TYPE_CLOSE, body, "displaced close");
    if (sent.frame === undefined) throw new Error("the record was not protected");

    const receipt = expectFatal(await client.deliver(sent.frame.payload, NOW));
    expect(receipt.row).toBe("Q7");
    expect(receipt.reason).toBe("header_mismatch");
  });

  it("rejects a close record violating the §10.1 passed-through rule", async () => {
    const { client, node } = await establish({ tier: "native" });
    // The peer claims to have received more than this endpoint has ever sent.
    const beyond: E2eeSequencePosition = {
      epoch: node.expectedRecv.epoch,
      counter: node.expectedRecv.counter + 5n,
    };
    const body = closeBodyFrom(node, { expectedRecv: beyond });
    const sent = await node.protectRaw(E2EE_INNER_TYPE_CLOSE, body, "over-declaring close");
    if (sent.frame === undefined) throw new Error("the record was not protected");

    const receipt = expectFatal(await client.deliver(sent.frame.payload, NOW));
    expect(receipt.row).toBe("Q7");
    expect(receipt.reason).toBe("passed_through_rule");
    expect(client.verdict).toBe("failed");
  });

  it("rejects a relay-mutated close record as Q3, not as a §10.1 violation", async () => {
    // The contrast case for the five above: what the relay can actually do to a
    // close record is corrupt it, and that is an AEAD failure — the close
    // machine never sees the body at all.
    const { client, node } = await establish({ tier: "native" });
    const close = await node.initiateClose(NOW);
    const receipt = expectFatal(
      await client.deliver(flipBit(close.frame.payload, E2EE_ENVELOPE_HEADER_BYTES + 3), NOW),
    );
    expect(receipt.row).toBe("Q3");
    expect(receipt.reason).toBe("authentication_failed");
    expect(client.verdict).toBe("failed");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// C. Tier and pattern confusion, and cross-direction reflection (§8.1, §8.5)
// ═════════════════════════════════════════════════════════════════════════════

describe("attacker relay: tier and pattern confusion", () => {
  it("rejects an IK Noise message offered under an NX wrapper as P10", async () => {
    // The NX responder reads message 1 as a bare `e`, so the remainder of an IK
    // message 1 surfaces as a nonempty NX payload — which §8.5 forbids outright,
    // because the NX first message has no encryption keys.
    const record = craftHello({
      contextBlock: encodeE2eeAuthorizationContext(
        nativeContext({ client: { tier: "web" }, clientIntendedCapability: CAPABILITY }),
      ),
      wrapperTier: "web",
      noiseTier: "native",
    });
    const outcome = nodeRowFor(record);
    expect(outcome.row).toBe("P10");
    expect(outcome.reason).toBe("nx_payload_not_empty");
  });

  it("rejects an NX Noise message offered under an IK wrapper as P10", async () => {
    // The IK responder owes `e, es, s, ss`; a 32-byte NX message 1 runs out of
    // bytes at the `s` token, which is a Noise processing failure.
    const record = craftHello({
      contextBlock: encodeE2eeAuthorizationContext(nativeContext()),
      wrapperTier: "native",
      noiseTier: "web",
    });
    const outcome = nodeRowFor(record);
    expect(outcome.row).toBe("P10");
    expect(outcome.reason).toBe("noise");
  });

  it("rejects an NX hello at a node whose admitted pattern set is IK only, as P9", () => {
    // §12.4: `requireApprovedClientE2EE` makes the effective admitted set `["IK"]`.
    // A web client offering NX is refused at §8.6 step 2 — the enforcement that
    // remains when a client ignores §7.6 element 14.
    const record = craftHello({
      contextBlock: encodeE2eeAuthorizationContext(nativeContext({ client: { tier: "web" } })),
      wrapperTier: "web",
      noiseTier: "web",
    });
    const outcome = nodeRowFor(record, {
      policy: { requireApprovedClientE2EE: true, suiteRegistry: [SUITE] },
    });
    expect(outcome.row).toBe("P9");
    expect(outcome.reason).toBe("wrapper");
  });

  it("admits the same NX hello when the node's admitted set holds NX, so the check is a membership test", async () => {
    const node = makeNode({ policy: { requireApprovedClientE2EE: false, suiteRegistry: [SUITE] } });
    const record = craftHello({
      contextBlock: encodeE2eeAuthorizationContext(nativeContext({ client: { tier: "web" } })),
      wrapperTier: "web",
      noiseTier: "web",
    });
    const result = node.receiveHello(record, NOW);
    expect(result.kind).toBe("accepted");
  });

  it("rejects a hello whose selected suite the relay rewrote to an unregistered id, as P9", async () => {
    // The wrapper is cleartext, so this is a genuine relay capability. A hello
    // whose `selectedSuite` leaves the registry never reaches Noise.
    const client = makeClient({ tier: "native" });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("expected a hello");
    // The suite id sits inside the canonical-CBOR body; rewriting the byte is
    // exactly what a relay editing the wrapper would do.
    const index = hello.record.indexOf(0x01, 6);
    const outcome = nodeRowFor(setByte(hello.record, index, 0x7f));
    expect(outcome.row).toBe("P9");
    expect(outcome.reason).toBe("wrapper");
  });
});

describe("attacker relay: cross-direction reflection", () => {
  it("rejects the client's own hello reflected back at it as P3", () => {
    const client = makeClient({ tier: "native" });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("expected a hello");
    const reflected = client.receiveServerAccept(hello.record, NOW);
    expect(reflected.kind).toBe("fatal");
    if (reflected.kind !== "fatal") return;
    expect(reflected.row).toBe("P3");
    expect(reflected.reason).toBe("record_bounds");
  });

  it("rejects the node's own accept reflected back at it as P4", () => {
    const client = makeClient({ tier: "native" });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("expected a hello");
    const node = makeNode();
    const accept = node.receiveHello(hello.record, NOW);
    if (accept.kind !== "accepted") throw new Error("expected an accept");

    const reflected = node.receiveHello(accept.record, NOW);
    expect(reflected.kind).toBe("fatal");
    if (reflected.kind !== "fatal") return;
    // §8.1: exactly one handshake attempt per channel. The object is spent
    // before the record's type is ever considered.
    expect(reflected.row).toBe("P4");
    expect(reflected.reason).toBe("handshake_spent");
  });

  it("rejects an accept reflected at a node that has not yet seen a hello, as P3", () => {
    const client = makeClient({ tier: "native" });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("expected a hello");
    const accept = makeNode().receiveHello(hello.record, NOW);
    if (accept.kind !== "accepted") throw new Error("expected an accept");

    const outcome = nodeRowFor(accept.record);
    expect(outcome.row).toBe("P3");
    expect(outcome.reason).toBe("record_bounds");
  });

  it("rejects a protected record reflected back at its sender as Q3", async () => {
    // The §3.3 AAD carries the DIRECTION LABEL of the direction the record
    // travels, and the two directions run different epoch schedules, so a
    // reflected record authenticates under neither.
    //
    // The reflection is deliberately of the endpoint's FIRST record, so the
    // reflected `(epoch, counter)` is exactly the one the sender expects to
    // RECEIVE next. The §9.2 check therefore passes and the failure is the
    // AEAD's — the strongest form of the case, since a reflection caught only
    // by the counter would say nothing about the direction label.
    const { client } = await establish({ tier: "native", primeImplicitFinish: false });
    const sent = await client.sendRpc(Uint8Array.from([0x42]));
    if (sent.kind !== "sent") throw new Error("the record was not sent");
    expect(client.expectedRecv).toEqual({ epoch: 0n, counter: 0n });

    const receipt = expectFatal(await client.deliver(sent.frame.payload, NOW));
    expect(receipt.row).toBe("Q3");
    expect(receipt.reason).toBe("authentication_failed");
    expect(client.verdict).toBe("failed");
    expect(client.rpcDeliveries).toHaveLength(0);
  });

  it("rejects a close record reflected back at its sender as Q3", async () => {
    const { client } = await establish({ tier: "native", primeImplicitFinish: false });
    const close = await client.initiateClose(NOW);
    const receipt = expectFatal(await client.deliver(close.frame.payload, NOW));
    expect(receipt.row).toBe("Q3");
    expect(receipt.reason).toBe("authentication_failed");
    expect(client.verdict).toBe("failed");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// D. Transcript and context-commitment mismatch, per element class (§8.3)
// ═════════════════════════════════════════════════════════════════════════════

describe("attacker relay: authorization-context mismatch by element class", () => {
  const runContext = (
    overrides: Partial<E2eeAuthorizationContextInput>,
    claims?: Partial<E2eeIkHelloPayload>,
  ) =>
    nodeRowFor(
      craftHello({
        contextBlock: encodeE2eeAuthorizationContext(nativeContext(overrides)),
        ...(claims === undefined ? {} : { claims }),
      }),
    );

  it("rejects an element 9 node-identity-fingerprint substitution as P13", () => {
    const outcome = runContext({
      nodeIdentityFingerprint: flipBit(NODE_IDENTITY_FINGERPRINT, 0),
    });
    expect(outcome.row).toBe("P13");
    expect(outcome.reason).toBe("context_mismatch");
  });

  it("rejects an element 10 cross-account splice as P13", () => {
    // The context commits to one account while the authenticated IK payload
    // claims another, so the node's step-7 reconstruction cannot match.
    const outcome = runContext({
      client: {
        tier: "native",
        accountId: OTHER_ACCOUNT_ID,
        identityFingerprint: CLIENT_IDENTITY_FINGERPRINT,
        agreementFingerprint: CLIENT_AGREEMENT_FINGERPRINT,
      },
    });
    expect(outcome.row).toBe("P13");
    expect(outcome.reason).toBe("context_mismatch");
  });

  it("rejects an element 17 continuity-id substitution as P13", () => {
    const outcome = runContext({ nodeContinuityId: OTHER_CONTINUITY_ID });
    expect(outcome.row).toBe("P13");
    expect(outcome.reason).toBe("context_mismatch");
  });

  it("rejects an element 11 capability outside the relay's closed vocabulary as P11", () => {
    // The version-1 capability vocabulary is a singleton, so a client claiming a
    // capability OTHER than the one the channel granted is necessarily claiming
    // one the vocabulary does not admit. §8.6 step 5 refuses it while decoding
    // the authenticated payload, before the context is ever reconstructed.
    const claimed = Uint8Array.from(
      cborEncode(
        [
          CLIENT_PREKEY_TRANSCRIPT,
          CLIENT_PREKEY_SIGNATURE,
          ACCOUNT_ID,
          UNVOCABULARY_CAPABILITY,
          ROLE,
        ],
        rfc8949EncodeOptions,
      ),
    );
    const outcome = nodeRowFor(
      craftHello({
        contextBlock: encodeE2eeAuthorizationContext(nativeContext()),
        rawIkPayload: claimed,
      }),
    );
    expect(outcome.row).toBe("P11");
    expect(outcome.reason).toBe("client_binding");
  });

  it("pins the capability vocabulary as a singleton, which is why the P13 form is unreachable", () => {
    // §8.3 element 11 MUST be a member of the relay contract's closed capability
    // vocabulary, and the element-11-versus-element-13 P13 form needs TWO
    // different members of it. The spec-fixed outcome here is therefore a
    // MEMBERSHIP result over that vocabulary — its cardinality — and not "the
    // encoder throws for the one string this case happened to pick". A case
    // asserting only the throw would keep passing on the day a second literal is
    // added, which is exactly the day the P13 form becomes expressible and the
    // corpus must gain it.
    //
    // So the probe runs over a candidate set: the admitted literal, near-misses
    // of it, and literals that are valid members of the relay's OTHER closed
    // vocabularies (the §8.3 role literals), and the assertion is on which of
    // them the vocabulary admits.
    const candidates: readonly string[] = [
      CAPABILITY,
      UNVOCABULARY_CAPABILITY,
      "",
      " ",
      `${CAPABILITY} `,
      ` ${CAPABILITY}`,
      CAPABILITY.toUpperCase(),
      `${CAPABILITY}\u0000`,
      `${CAPABILITY}.v1`,
      "ryco",
      "rpc",
      LOWER_ROLE,
      ROLE,
      HIGHER_ROLE,
    ];
    const admitted: string[] = [];
    for (const candidate of candidates) {
      let encoded: Uint8Array | undefined;
      let refusal: unknown;
      try {
        encoded = encodeE2eeAuthorizationContext(
          nativeContext({ clientIntendedCapability: candidate }),
        );
      } catch (thrown) {
        refusal = thrown;
      }
      if (encoded !== undefined) {
        expect(encoded.byteLength, candidate).toBeGreaterThan(0);
        admitted.push(candidate);
        continue;
      }
      // One refusal, indistinguishable across every non-member: the uniform
      // §7 input rejection, never a per-literal diagnostic that would tell a
      // caller how close its guess was.
      expect(refusal, candidate).toBeInstanceOf(RelayE2eeValidationError);
      expect((refusal as RelayE2eeValidationError).code, candidate).toBe(
        "invalid_relay_e2ee_input",
      );
      expect((refusal as Error).message, candidate).toBe("Relay E2EE input is invalid.");
    }
    // THE assertion. Exactly one member, and it is the literal the channel was
    // granted — so the element 11 / element 13 mismatch above is unreachable as
    // a P13 in version 1 by cardinality, not by the encoder being fragile.
    expect(admitted).toEqual([CAPABILITY]);
  });

  it("rejects a Branch A record whose capabilitySet excludes the requested capability as P12", () => {
    // The capability-mismatch class where version 1 can actually decide it:
    // §8.6 step 6, against the record the node holds for this client.
    const outcome = nodeRowFor(
      craftHello({ contextBlock: encodeE2eeAuthorizationContext(nativeContext()) }),
      { authorization: { status: "approved", maxRole: HIGHER_ROLE, capabilitySet: [] } },
    );
    expect(outcome.row).toBe("P12");
    expect(outcome.reason).toBe("authorization");
  });

  it("rejects a Branch A record whose maxRole is below the requested role as P12", () => {
    const outcome = nodeRowFor(
      craftHello({ contextBlock: encodeE2eeAuthorizationContext(nativeContext()) }),
      { authorization: { status: "approved", maxRole: LOWER_ROLE, capabilitySet: [CAPABILITY] } },
    );
    expect(outcome.row).toBe("P12");
    expect(outcome.reason).toBe("authorization");
  });

  it("rejects an element 12 role ESCALATION above element 14 as P13", () => {
    const outcome = runContext({ clientIntendedRole: HIGHER_ROLE }, { intendedRole: HIGHER_ROLE });
    expect(outcome.row).toBe("P13");
    expect(outcome.reason).toBe("context_mismatch");
  });

  it("rejects an element 12 role REDUCTION below element 14 as P13", () => {
    // §8.3 makes a difference in EITHER direction a context mismatch: a
    // handshake never proceeds at the lower authority, which is what an
    // implementation comparing only "at most" would allow.
    const outcome = runContext({ clientIntendedRole: LOWER_ROLE }, { intendedRole: LOWER_ROLE });
    expect(outcome.row).toBe("P13");
    expect(outcome.reason).toBe("context_mismatch");
  });

  it("rejects a well-formed context under a commitment computed over other bytes as P13", () => {
    const block = encodeE2eeAuthorizationContext(nativeContext());
    const other = encodeE2eeAuthorizationContext(
      nativeContext({ nodeContinuityId: OTHER_CONTINUITY_ID }),
    );
    const outcome = nodeRowFor(
      craftHello({ contextBlock: block, commitment: e2eeAuthorizationContextCommitment(other) }),
    );
    expect(outcome.row).toBe("P13");
    expect(outcome.reason).toBe("context_mismatch");
  });

  it("rejects a web-tier context carrying a nonempty element 10 as P13", () => {
    // §8.3's absence semantics: on NX elements 10 and 16 are absent, and a
    // context that fills them cannot match the responder's reconstruction.
    const outcome = nodeRowFor(
      craftHello({
        contextBlock: encodeE2eeAuthorizationContext(nativeContext()),
        wrapperTier: "web",
        noiseTier: "web",
      }),
    );
    expect(outcome.row).toBe("P13");
    expect(outcome.reason).toBe("context_mismatch");
  });

  it("rejects a client-identity-fingerprint substitution in element 16 as P13", () => {
    const outcome = runContext({
      client: {
        tier: "native",
        accountId: ACCOUNT_ID,
        identityFingerprint: flipBit(CLIENT_IDENTITY_FINGERPRINT, 0),
        agreementFingerprint: CLIENT_AGREEMENT_FINGERPRINT,
      },
    });
    expect(outcome.row).toBe("P13");
    expect(outcome.reason).toBe("context_mismatch");
  });

  it("rejects an accept echoing a different context commitment as P13 at the client", () => {
    const client = makeClient({ tier: "native" });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("expected a hello");
    const node = makeNode();
    const accept = node.receiveHello(hello.record, NOW);
    if (accept.kind !== "accepted") throw new Error("expected an accept");

    // The relay rewrites field 2 of the accept wrapper. The client compares it
    // against the commitment it computed itself.
    const index = accept.record.indexOf(hello.contextCommitment[0] ?? 0, 4);
    const tampered = setByte(accept.record, index, (accept.record[index] ?? 0) ^ 0x01);
    const outcome = client.receiveServerAccept(tampered, NOW);
    expect(outcome.kind).toBe("fatal");
    if (outcome.kind !== "fatal") return;
    expect(outcome.row).toBe("P13");
    expect(outcome.reason).toBe("context_mismatch");
  });

  it("rejects an accept payload declaring a different `channel.open` authority as P13", () => {
    // The node is non-conforming here: it echoes an authority other than the one
    // it received. The client compares against its own `channel.open`.
    const client = makeClient({ tier: "native" });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("expected a hello");

    const prologue = encodeE2eeNoisePrologue({
      hubOrigin: HUB_ORIGIN,
      channelId: CHANNEL_ID,
      relayProtocolMajor: 1,
      relayProtocolMinor: 2,
      e2eeVersion: 1,
      suiteId: SUITE,
      nodeId: NODE_ID,
      contextCommitment: hello.contextCommitment,
    });
    const noise = new E2eeNoiseHandshake({
      pattern: E2EE_NOISE_PATTERN_IK,
      role: "responder",
      prologue,
      staticSecretKey: NODE_AGREEMENT_SECRET,
      testOnlyEphemeralSecretKey: NODE_EPHEMERAL_SECRET,
    });
    // Read the client's own message 1, so the responder state — and therefore
    // message 2 — is genuine and the client's step 3 succeeds. The failure under
    // test is step 4's, not a Noise failure.
    const decodedHello = decodeE2eeClientHello(hello.record);
    if (decodedHello.kind !== "ok") throw new Error("the hello did not decode");
    noise.readMessage(decodedHello.value.noiseMessage1);
    const message2 = noise.writeMessage(
      encodeE2eeServerAcceptPayload({
        channelOpenCapability: CAPABILITY,
        channelOpenEffectiveRole: LOWER_ROLE,
        nodeAgreementKeyFingerprint: NODE_AGREEMENT_FINGERPRINT,
      }),
    );
    const outcome = client.receiveServerAccept(
      encodeE2eeServerAccept({
        acceptedSuite: SUITE,
        nodePrekeyId: PREKEY_ID,
        contextCommitment: hello.contextCommitment,
        noiseMessage2: message2,
        // A confirmation the client never reaches: the payload check is step 4
        // and the confirmation is step 5.
        serverConfirmation: new Uint8Array(32),
      }),
      NOW,
    );
    noise.destroy();
    expect(outcome.kind).toBe("fatal");
    if (outcome.kind !== "fatal") return;
    expect(outcome.row).toBe("P13");
    expect(outcome.reason).toBe("context_mismatch");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// E. Suite-list stripping and downgrade attempts (§8.7 key confirmation)
// ═════════════════════════════════════════════════════════════════════════════

describe("attacker relay: downgrade attempts and key confirmation", () => {
  it("cannot downgrade account-enrolled native trust to the local suite", () => {
    const advertised = {
      tier: "native" as const,
      trustSource: "account-enrolled" as const,
      localSuitePreference: [
        E2EE_SUITE_ACCOUNT_GRANT_25519_CHACHAPOLY_SHA256,
        E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      ],
      advertisedSuiteRegistry: [
        E2EE_SUITE_ACCOUNT_GRANT_25519_CHACHAPOLY_SHA256,
        E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      ],
      advertisedVersionMin: 1,
      advertisedVersionMax: 1,
      advertisedAdmittedPatterns: [E2EE_NOISE_PATTERN_IK],
    } as const;
    expect(selectE2eeSuite(advertised)).toEqual({
      kind: "usable",
      selectedSuite: E2EE_SUITE_ACCOUNT_GRANT_25519_CHACHAPOLY_SHA256,
    });

    // Model the attacker-controlled relay stripping 0x02 from the authenticated
    // node material it forwards. Account trust becomes unusable; it does not
    // silently fall back to the locally-approved suite 0x01.
    expect(
      selectE2eeSuite({
        ...advertised,
        advertisedSuiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
      }),
    ).toEqual({ kind: "unusable", reason: "empty_suite_intersection" });
  });

  it("breaks key confirmation when the relay strips a suite from `offeredSuites`", async () => {
    // §8.7 hashes the EXACT hello wire bytes, so the node confirms over the
    // stripped list and the client over the list it sent. The confirmation MAC
    // is what makes the strip visible; the selected suite still validates, which
    // is exactly why a wrapper-level check alone would miss it.
    const client = makeClient({ tier: "native", offeredSuites: [SUITE, 0x02] });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("expected a hello");
    const stripped = makeClient({ tier: "native", offeredSuites: [SUITE] }).createHello(NOW);
    if (stripped.kind !== "hello") throw new Error("expected a hello");

    const node = makeNode();
    const accept = node.receiveHello(stripped.record, NOW);
    expect(accept.kind).toBe("accepted");
    if (accept.kind !== "accepted") return;

    const outcome = client.receiveServerAccept(accept.record, NOW);
    expect(outcome.kind).toBe("fatal");
    if (outcome.kind !== "fatal") return;
    expect(outcome.row).toBe("P16");
    expect(outcome.reason).toBe("confirmation_mismatch");
  });

  it("breaks key confirmation when the relay rewrites the client nonce", async () => {
    // The node checks nothing about the nonce, so this passes every wrapper
    // check and is caught only by the §8.7 confirmation over the hello bytes.
    const client = makeClient({ tier: "native" });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("expected a hello");
    const index = hello.record.indexOf(CLIENT_NONCE[0] ?? 0, 4);
    const tampered = setByte(hello.record, index, (hello.record[index] ?? 0) ^ 0x01);

    const accept = makeNode().receiveHello(tampered, NOW);
    expect(accept.kind).toBe("accepted");
    if (accept.kind !== "accepted") return;

    const outcome = client.receiveServerAccept(accept.record, NOW);
    expect(outcome.kind).toBe("fatal");
    if (outcome.kind !== "fatal") return;
    expect(outcome.row).toBe("P16");
    expect(outcome.reason).toBe("confirmation_mismatch");
  });

  it("rejects an accept whose confirmation the relay flipped, as P16", () => {
    const client = makeClient({ tier: "native" });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("expected a hello");
    const accept = makeNode().receiveHello(hello.record, NOW);
    if (accept.kind !== "accepted") throw new Error("expected an accept");

    const outcome = client.receiveServerAccept(
      flipBit(accept.record, accept.record.byteLength - 1),
      NOW,
    );
    expect(outcome.kind).toBe("fatal");
    if (outcome.kind !== "fatal") return;
    expect(outcome.row).toBe("P16");
    expect(outcome.reason).toBe("confirmation_mismatch");
  });

  it("rejects an accept whose accepted suite the relay rewrote, as P16", () => {
    const client = makeClient({ tier: "native" });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("expected a hello");
    const accept = makeNode().receiveHello(hello.record, NOW);
    if (accept.kind !== "accepted") throw new Error("expected an accept");

    // Field 0 of the accept body: the byte immediately after the array header.
    const outcome = client.receiveServerAccept(setByte(accept.record, 3, 0x02), NOW);
    expect(outcome.kind).toBe("fatal");
    if (outcome.kind !== "fatal") return;
    expect(outcome.row).toBe("P16");
    expect(outcome.reason).toBe("accept_mismatch");
  });

  it("rejects an accept whose node prekey id the relay rewrote, as P16", () => {
    const client = makeClient({ tier: "native" });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("expected a hello");
    const accept = makeNode().receiveHello(hello.record, NOW);
    if (accept.kind !== "accepted") throw new Error("expected an accept");

    const index = accept.record.indexOf(PREKEY_ID.charCodeAt(4), 4);
    const outcome = client.receiveServerAccept(flipBit(accept.record, index), NOW);
    expect(outcome.kind).toBe("fatal");
    if (outcome.kind !== "fatal") return;
    expect(outcome.row).toBe("P16");
    expect(outcome.reason).toBe("accept_mismatch");
  });

  it("answers every pre-key cause with the one byte-identical E2EEHandshakeReject", () => {
    // §11.2 and §11.5: the node's ENTIRE pre-key wire surface is one fixed-size
    // record, byte-identical across causes. Five causes are driven here, each
    // through a different §8.6 step and each landing on a different §11.2 row —
    // and the record the node emits for all five is the same 64 bytes.
    const rows = [
      nodeRowFor(
        craftHello({
          contextBlock: encodeE2eeAuthorizationContext(nativeContext({ client: { tier: "web" } })),
          wrapperTier: "web",
          noiseTier: "web",
        }),
        { policy: { requireApprovedClientE2EE: true, suiteRegistry: [SUITE] } },
      ).row,
      nodeRowFor(
        craftHello({
          contextBlock: encodeE2eeAuthorizationContext(nativeContext()),
          wrapperTier: "web",
          noiseTier: "native",
        }),
      ).row,
      nodeRowFor(craftHello({ contextBlock: encodeE2eeAuthorizationContext(nativeContext()) }), {
        authorization: undefined,
      }).row,
      nodeRowFor(craftHello({ contextBlock: encodeE2eeAuthorizationContext(nativeContext()) }), {
        authorization: { status: "revoked", maxRole: HIGHER_ROLE, capabilitySet: [CAPABILITY] },
      }).row,
      nodeRowFor(
        craftHello({
          contextBlock: encodeE2eeAuthorizationContext(
            nativeContext({ clientIntendedRole: HIGHER_ROLE }),
          ),
          claims: { intendedRole: HIGHER_ROLE },
        }),
      ).row,
    ];
    // Five distinct local diagnoses, which is what makes the identical wire
    // surface a claim worth asserting.
    expect(rows).toEqual(["P9", "P10", "P12", "P12", "P13"]);

    const reject = encodeE2eeHandshakeReject();
    expect(reject.byteLength).toBe(E2EE_HANDSHAKE_REJECT_BYTES);
    for (const _row of rows) {
      expect([...encodeE2eeHandshakeReject()]).toEqual([...reject]);
    }
    // §11.2 leaves no room to signal a cause: the one conforming body is the
    // only one the encoder will build, and a peer's is checked byte for byte.
    expect(decodeE2eeNegotiationRecord(setByte(reject, reject.byteLength - 1, 0x01))).toEqual({
      kind: "error",
      reason: "non_canonical_reject",
    });
  });

  it("rejects a hello the relay truncated as P9, and one it padded past its bound as P3", () => {
    const hello = makeClient({ tier: "native" }).createHello(NOW);
    if (hello.kind !== "hello") throw new Error("expected a hello");

    // Truncation leaves the framing intact and the canonical-CBOR body broken:
    // §8.6 step 1's bound passes and step 2's strict decode does not.
    const truncated = nodeRowFor(truncateTo(hello.record, hello.record.byteLength - 8));
    expect(truncated.row).toBe("P9");
    expect(truncated.reason).toBe("wrapper");

    // Padding past `E2EE_CLIENT_HELLO_MAX_BYTES` is decided on the framing
    // alone, before the body is parsed at all.
    const padded = new Uint8Array(E2EE_CLIENT_HELLO_MAX_BYTES + 1);
    padded.set(hello.record);
    const oversized = nodeRowFor(padded);
    expect(oversized.row).toBe("P3");
    expect(oversized.reason).toBe("record_bounds");
  });

  it("rejects an accept the relay truncated as P16", () => {
    const client = makeClient({ tier: "native" });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("expected a hello");
    const accept = makeNode().receiveHello(hello.record, NOW);
    if (accept.kind !== "accepted") throw new Error("expected an accept");

    const outcome = client.receiveServerAccept(
      truncateTo(accept.record, accept.record.byteLength - 8),
      NOW,
    );
    expect(outcome.kind).toBe("fatal");
    if (outcome.kind !== "fatal") return;
    expect(outcome.row).toBe("P16");
    expect(outcome.reason).toBe("accept_mismatch");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// F. Replay, reorder, gap, and partial truncation of protected records (§9.2)
// ═════════════════════════════════════════════════════════════════════════════

describe("attacker relay: replay, reorder, gap, and truncation", () => {
  it("rejects a replayed protected record as Q2", async () => {
    const { client, node } = await establish({ tier: "native" });
    const sent = await client.sendRpc(Uint8Array.from([0xaa]));
    if (sent.kind !== "sent") throw new Error("the record was not sent");

    expect((await node.deliver(sent.frame.payload, NOW)).kind).toBe("rpc");
    const replayed = expectFatal(await node.deliver(sent.frame.payload, NOW));
    expect(replayed.row).toBe("Q2");
    expect(replayed.reason).toBe("sequence_mismatch");
    expect(node.rpcDeliveries).toHaveLength(2); // priming plus the one genuine record
    expect(node.verdict).toBe("failed");
  });

  it("rejects two reordered records at the first one delivered, as Q2", async () => {
    const { client, node } = await establish({ tier: "native" });
    const first = await client.sendRpc(Uint8Array.from([0x01]), "first");
    const second = await client.sendRpc(Uint8Array.from([0x02]), "second");
    if (first.kind !== "sent" || second.kind !== "sent") throw new Error("records were not sent");

    const receipt = expectFatal(await node.deliver(second.frame.payload, NOW));
    expect(receipt.row).toBe("Q2");
    expect(receipt.reason).toBe("sequence_mismatch");
    // The reordering is caught immediately: the later record is never delivered
    // to the application ahead of the earlier one.
    expect(node.rpcDeliveries).toHaveLength(1);
  });

  it("rejects a gap left by a dropped record as Q2", async () => {
    const { client, node } = await establish({ tier: "native" });
    const dropped = await client.sendRpc(Uint8Array.from([0x01]), "dropped");
    const following = await client.sendRpc(Uint8Array.from([0x02]), "following");
    if (dropped.kind !== "sent" || following.kind !== "sent") throw new Error("not sent");

    // The relay simply never hands the first frame over.
    const receipt = expectFatal(await node.deliver(following.frame.payload, NOW));
    expect(receipt.row).toBe("Q2");
    expect(receipt.reason).toBe("sequence_mismatch");
  });

  it("rejects a record whose counter the relay regressed, as Q2", async () => {
    const { client, node } = await establish({ tier: "native" });
    const sent = await client.sendRpc(Uint8Array.from([0x01]));
    if (sent.kind !== "sent") throw new Error("the record was not sent");

    const regressed = restamp(sent.frame.payload, { epoch: 0n, counter: 0n });
    const receipt = expectFatal(await node.deliver(regressed, NOW));
    expect(receipt.row).toBe("Q2");
    expect(receipt.reason).toBe("sequence_mismatch");
  });

  it("rejects a partially truncated record and then refuses the untruncated one", async () => {
    const { client, node } = await establish({ tier: "native" });
    const sent = await client.sendRpc(Uint8Array.from({ length: 32 }, (_u, index) => index));
    if (sent.kind !== "sent") throw new Error("the record was not sent");

    // Still comfortably above `E2EE_ENVELOPE_OVERHEAD_BYTES`, so the record is a
    // structurally valid envelope at the expected pair and the failure is the
    // AEAD's rather than the length bound's.
    const cut = truncateTo(sent.frame.payload, sent.frame.payload.byteLength - 4);
    expect(cut.byteLength).toBeGreaterThan(E2EE_ENVELOPE_OVERHEAD_BYTES);
    const truncated = expectFatal(await node.deliver(cut, NOW));
    expect(truncated.row).toBe("Q3");
    // §11.3: the endpoint stopped delivering records; the genuine record that
    // follows must not be processed as though nothing had happened.
    expect(node.session.erased).toBe(true);
    expect(node.rpcDeliveries).toHaveLength(1);
  });

  it("rejects a replay across a rekey boundary as Q2", async () => {
    // The pre-boundary record is at `(0, c)`; after the boundary the receiver
    // expects `(1, 0)`, so the relay replaying the old record is a regression.
    const synthetic: E2eeSyntheticDirectionState = {
      epochRecords: E2EE_REKEY_MAX_RECORDS - 1,
    };
    const { client, node } = await establish({
      tier: "native",
      primeImplicitFinish: false,
      syntheticC2N: synthetic,
    });
    const boundary = await client.sendRpc(Uint8Array.from([0x01]), "boundary record");
    if (boundary.kind !== "sent") throw new Error("the record was not sent");
    if (boundary.result.kind !== "protected") throw new Error("not protected");
    expect(boundary.result.epochCompleted).toBe(true);
    expect((await node.deliver(boundary.frame.payload, NOW)).kind).toBe("rpc");
    expect(node.session.receiveState.epoch).toBe(1n);
    expect(node.session.receiveState.counter).toBe(0n);

    const receipt = expectFatal(await node.deliver(boundary.frame.payload, NOW));
    expect(receipt.row).toBe("Q2");
    expect(receipt.reason).toBe("sequence_mismatch");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// G. Implicit client-finish abuse (§8.9)
// ═════════════════════════════════════════════════════════════════════════════

describe("attacker relay: implicit client-finish abuse", () => {
  it("invokes no RPC handler and emits no application RPC before the finish authenticates", async () => {
    const { client, node } = await establish({ tier: "native", primeImplicitFinish: false });
    expect(node.mayInvokeRpcHandler).toBe(false);
    expect(node.mayEmitApplicationRpc).toBe(false);

    const refused = await node.sendRpc(Uint8Array.from([0x01]));
    expect(refused.kind).toBe("refused_before_implicit_finish");
    expect(node.emitted).toHaveLength(0);
    expect(node.rpcDeliveries).toHaveLength(0);

    // The relay withholding the client's first envelope changes nothing: the
    // gate is on the authenticated record, not on the passage of time.
    const withheld = await client.sendRpc(Uint8Array.from([0x02]));
    expect(withheld.kind).toBe("sent");
    expect(node.mayInvokeRpcHandler).toBe(false);
    expect(node.rpcDeliveries).toHaveLength(0);
  });

  it("does not treat an authenticated close record as the implicit finish", async () => {
    // §8.9 names the first valid client-to-node `0x01` envelope. A `0x02` is
    // authenticated and processed, and the RPC gates stay shut.
    const { client, node } = await establish({ tier: "native", primeImplicitFinish: false });
    const close = await client.initiateClose(NOW);
    const receipt = await node.deliver(close.frame.payload, NOW);
    expect(receipt.kind).toBe("close");
    expect(node.mayInvokeRpcHandler).toBe(false);
    expect(node.mayEmitApplicationRpc).toBe(false);
    expect(node.rpcDeliveries).toHaveLength(0);
  });

  it("opens the gate exactly once, and rejects the replayed finish as Q2", async () => {
    const { client, node } = await establish({ tier: "native", primeImplicitFinish: false });
    const finish = await client.sendRpc(Uint8Array.from([0x11]), "implicit finish");
    if (finish.kind !== "sent") throw new Error("the record was not sent");

    expect((await node.deliver(finish.frame.payload, NOW)).kind).toBe("rpc");
    expect(node.mayInvokeRpcHandler).toBe(true);
    expect(node.rpcDeliveries).toHaveLength(1);

    const replayed = expectFatal(await node.deliver(finish.frame.payload, NOW));
    expect(replayed.row).toBe("Q2");
    expect(replayed.reason).toBe("sequence_mismatch");
    // The handler ran once, not twice: the replay never reached it.
    expect(node.rpcDeliveries).toHaveLength(1);
    expect(node.verdict).toBe("failed");
  });

  it("keeps the handler shut when the relay injects an unauthenticated record first", async () => {
    const { client, node } = await establish({ tier: "native", primeImplicitFinish: false });
    const finish = await client.sendRpc(Uint8Array.from([0x11]), "implicit finish");
    if (finish.kind !== "sent") throw new Error("the record was not sent");

    // An envelope at exactly the expected pair, with a ciphertext the relay made up.
    const injected = new Uint8Array(finish.frame.payload.byteLength);
    injected.set(finish.frame.payload.subarray(0, E2EE_ENVELOPE_HEADER_BYTES));
    injected.fill(0x5a, E2EE_ENVELOPE_HEADER_BYTES);
    const receipt = expectFatal(await node.deliver(injected, NOW));
    expect(receipt.row).toBe("Q3");
    expect(node.mayInvokeRpcHandler).toBe(false);
    expect(node.rpcDeliveries).toHaveLength(0);
  });

  it("fails the withheld finish at the §8.9 deadline as Q8 with one error record", async () => {
    const { node } = await establish({ tier: "native", primeImplicitFinish: false });
    const receipt = expectFatal(await node.expireImplicitFinish(NOW + T_HANDSHAKE_NODE + 1));
    expect(receipt.row).toBe("Q8");
    expect(receipt.reason).toBe("implicit_finish_deadline");
    expect(receipt.errorEmitted).toBe(true);
    expect(receipt.errorCode).toBe(E2EE_ERROR_CODE_PROTOCOL_VIOLATION);
    expect(node.emitted).toHaveLength(1);
    expect(node.channelCloseReason).toBe("channel_rejected");
    expect(node.mayInvokeRpcHandler).toBe(false);
  });

  it("satisfies the §8.9 deadline for a finish delivered just inside it", async () => {
    // The boundary, not merely the existence of a timer: the case above fails
    // one millisecond past `T_HANDSHAKE_NODE` and this one succeeds at exactly
    // it, which is what makes the deadline a deadline rather than a rejection.
    const { client, node } = await establish({ tier: "native", primeImplicitFinish: false });
    const finish = await client.sendRpc(Uint8Array.from([0x11]), "implicit finish");
    if (finish.kind !== "sent") throw new Error("the record was not sent");

    const receipt = await node.deliver(finish.frame.payload, NOW + T_HANDSHAKE_NODE);
    expect(receipt.kind).toBe("rpc");
    expect(node.mayInvokeRpcHandler).toBe(true);
    expect(node.mayEmitApplicationRpc).toBe(true);
    expect(node.rpcDeliveries).toHaveLength(1);
  });

  it("fails the finish as Q9 with code `policy` when a withdrawal lands in the delayed window", async () => {
    // §13.6 and §8.9: the implicit finish is the LAST re-check before a
    // withdrawn authority could reach application state, and the relay widens
    // that window for free — it simply holds the client's first envelope. The
    // code is `policy`, not `protocol_violation`, and the RPC handler never
    // runs.
    const { client, node } = await establish({ tier: "native", primeImplicitFinish: false });
    const finish = await client.sendRpc(Uint8Array.from([0x11]), "implicit finish");
    if (finish.kind !== "sent") throw new Error("the record was not sent");

    // The owner reduces `maxRole` below the admitted snapshot's while the
    // record sits in the relay. `status` is untouched, so a status-only
    // re-check would pass it — which is the defect the withdrawal test closes.
    node.reReadAuthorization = () => ({
      status: "approved",
      maxRole: LOWER_ROLE,
      capabilitySet: [CAPABILITY],
    });

    const receipt = expectFatal(await node.deliver(finish.frame.payload, NOW));
    expect(receipt.row).toBe("Q9");
    expect(receipt.reason).toBe("authorization_withdrawn");
    expect(receipt.errorEmitted).toBe(true);
    expect(receipt.errorCode).toBe(E2EE_ERROR_CODE_POLICY);
    expect(node.rpcDeliveries).toHaveLength(0);
    expect(node.mayInvokeRpcHandler).toBe(false);
    expect(node.channelCloseReason).toBe("channel_rejected");
    expect(node.verdict).toBe("failed");
  });

  it("lets the finish through when the re-read matches the admitted snapshot", async () => {
    // The contrast case: the same re-read hook, an unchanged record, and the
    // finish authenticates — so the case above is a withdrawal result and not
    // an artefact of supplying the hook at all.
    const { client, node } = await establish({ tier: "native", primeImplicitFinish: false });
    node.reReadAuthorization = () => APPROVED;
    const finish = await client.sendRpc(Uint8Array.from([0x11]), "implicit finish");
    if (finish.kind !== "sent") throw new Error("the record was not sent");

    expect((await node.deliver(finish.frame.payload, NOW)).kind).toBe("rpc");
    expect(node.mayInvokeRpcHandler).toBe(true);
    expect(node.rpcDeliveries).toHaveLength(1);
  });

  it("emits no application RPC and no error record while the finish is merely late", async () => {
    // §8.9's gate is not a fatal condition until the deadline: before it, the
    // node is silent on the application path and puts NOTHING on the wire.
    const { node } = await establish({ tier: "native", primeImplicitFinish: false });
    expect(await node.sendRpc(Uint8Array.from([0x01]))).toEqual({
      kind: "refused_before_implicit_finish",
    });
    expect(node.emitted).toHaveLength(0);
    expect(node.channelCloseReason).toBeUndefined();
    expect(node.verdict).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// H. Counter, rekey, and exhaustion boundary abuse (§9.2, §9.4, §9.6)
// ═════════════════════════════════════════════════════════════════════════════

describe("attacker relay: counter, rekey, and exhaustion boundaries", () => {
  const atBoundary = async () => {
    const synthetic: E2eeSyntheticDirectionState = { epochRecords: E2EE_REKEY_MAX_RECORDS - 1 };
    const live = await establish({
      tier: "native",
      primeImplicitFinish: false,
      syntheticC2N: synthetic,
    });
    const boundary = await live.client.sendRpc(Uint8Array.from([0x01]), "boundary record");
    if (boundary.kind !== "sent") throw new Error("the record was not sent");
    expect((await live.node.deliver(boundary.frame.payload, NOW)).kind).toBe("rpc");
    // Both ends now expect `(1, 0)`: the boundary record was the last of epoch 0.
    expect(live.client.sendPosition).toEqual({ epoch: 1n, counter: 0n });
    expect(live.node.expectedRecv).toEqual({ epoch: 1n, counter: 0n });
    return live;
  };

  it("rejects an epoch increment that is not exactly +1, as Q2", async () => {
    const { client, node } = await atBoundary();
    const next = await client.sendRpc(Uint8Array.from([0x02]), "first of epoch 1");
    if (next.kind !== "sent") throw new Error("the record was not sent");

    const receipt = expectFatal(
      await node.deliver(restamp(next.frame.payload, { epoch: 2n, counter: 0n }), NOW),
    );
    expect(receipt.row).toBe("Q2");
    expect(receipt.reason).toBe("sequence_mismatch");
    expect(node.verdict).toBe("failed");
  });

  it("rejects an epoch increment of +1 whose counter is not 0, as Q2", async () => {
    const { client, node } = await atBoundary();
    const next = await client.sendRpc(Uint8Array.from([0x02]), "first of epoch 1");
    if (next.kind !== "sent") throw new Error("the record was not sent");

    const receipt = expectFatal(
      await node.deliver(restamp(next.frame.payload, { epoch: 1n, counter: 1n }), NOW),
    );
    expect(receipt.row).toBe("Q2");
    expect(receipt.reason).toBe("sequence_mismatch");
  });

  it("rejects a late rekey — the old epoch continued past the boundary — as Q2", async () => {
    const { client, node } = await atBoundary();
    const next = await client.sendRpc(Uint8Array.from([0x02]), "first of epoch 1");
    if (next.kind !== "sent") throw new Error("the record was not sent");

    const receipt = expectFatal(
      await node.deliver(restamp(next.frame.payload, { epoch: 0n, counter: 1n }), NOW),
    );
    expect(receipt.row).toBe("Q2");
    expect(receipt.reason).toBe("sequence_mismatch");
  });

  it("rejects an early rekey mid-epoch as Q2", async () => {
    const { client, node } = await establish({ tier: "native", primeImplicitFinish: false });
    const sent = await client.sendRpc(Uint8Array.from([0x01]));
    if (sent.kind !== "sent") throw new Error("the record was not sent");

    const receipt = expectFatal(
      await node.deliver(restamp(sent.frame.payload, { epoch: 1n, counter: 0n }), NOW),
    );
    expect(receipt.row).toBe("Q2");
    expect(receipt.reason).toBe("sequence_mismatch");
  });

  it("accepts the honest boundary crossing, so the rejections above are not blanket", async () => {
    const { client, node } = await atBoundary();
    const next = await client.sendRpc(Uint8Array.from([0x02]), "first of epoch 1");
    if (next.kind !== "sent") throw new Error("the record was not sent");
    expect((await node.deliver(next.frame.payload, NOW)).kind).toBe("rpc");
    expect(node.expectedRecv).toEqual({ epoch: 1n, counter: 1n });
  });

  it("rejects a peer minting a record at the wrong epoch with the right key, as Q2", async () => {
    // A NON-CONFORMING PEER, holding the keys: it protects a record under the
    // epoch-1 schedule while its peer still expects epoch 0. The sequence
    // comparison catches it before the AEAD is selected.
    const aead = countingAead();
    const { client, node } = await establish({
      tier: "native",
      primeImplicitFinish: false,
      nodeAead: aead.factory,
    });
    const minted = client.mintNonConformingEnvelope({
      epoch: 1n,
      counter: 0n,
      body: Uint8Array.from([0x01]),
    });
    const opensBefore = aead.calls.open;

    const receipt = expectFatal(await node.deliver(minted, NOW));
    expect(receipt.row).toBe("Q2");
    expect(aead.calls.open).toBe(opensBefore);
  });

  it("exhausts the direction at the counter boundary rather than wrapping to zero", async () => {
    // §9.3 and §9.6: the uint64 counter is a hard boundary. The record at
    // `E2EE_COUNTER_MAX` is the last one the direction can carry; after it the
    // direction is exhausted, holds no position at all, and NOTHING is reused —
    // a wrap here would repeat a nonce under a live key, which is the one
    // failure the whole sequencing design exists to prevent.
    const atCounterMax: E2eeSyntheticDirectionState = { counter: E2EE_COUNTER_MAX };
    const { client, node } = await establish({
      tier: "native",
      primeImplicitFinish: false,
      syntheticC2N: atCounterMax,
      syntheticN2C: atCounterMax,
    });
    const last = await client.sendRpc(Uint8Array.from([0x01]), "last record");
    if (last.kind !== "sent") throw new Error("the record was not sent");
    if (last.result.kind !== "protected") throw new Error("not protected");
    expect(last.result.counter).toBe(E2EE_COUNTER_MAX);
    expect(client.session.sendState.exhausted).toBe(true);
    expect(client.session.sendState.counter).toBeUndefined();

    const after = await client.sendRpc(Uint8Array.from([0x02]), "after exhaustion");
    expect(after.kind).toBe("not_sent");
    if (after.kind !== "not_sent") return;
    expect(after.result.kind).toBe("close_required");
    expect(client.emitted).toHaveLength(1);

    // The receiver mirrors it: the boundary record authenticates, and the
    // direction then holds no expectation any later record could match.
    expect((await node.deliver(last.frame.payload, NOW)).kind).toBe("rpc");
    expect(node.session.receiveState.exhausted).toBe(true);
    const wrapped = expectFatal(
      await node.deliver(restamp(last.frame.payload, { epoch: 0n, counter: 0n }), NOW),
    );
    expect(wrapped.row).toBe("Q2");
    expect(wrapped.reason).toBe("sequence_mismatch");
  });

  it("refuses an application record that would break the §9.6 post-application reserve", async () => {
    // The terminal epoch with exactly the reserve behind it: an application
    // record is refused with `close_required` and NOTHING is consumed — no wrap,
    // no reuse, and no envelope on the wire.
    const terminal: E2eeSyntheticDirectionState = {
      epoch: 0xffff_ffffn,
      epochRecords: E2EE_REKEY_MAX_RECORDS - 3,
    };
    const { client } = await establish({
      tier: "native",
      primeImplicitFinish: false,
      syntheticC2N: terminal,
      syntheticN2C: terminal,
    });
    expect(client.session.postApplicationReserveHeld).toBe(true);

    const refused = await client.sendRpc(Uint8Array.from([0x01]));
    expect(refused.kind).toBe("not_sent");
    if (refused.kind !== "not_sent") return;
    expect(refused.result.kind).toBe("close_required");
    expect(client.emitted).toHaveLength(0);
    expect(client.sendPosition).toEqual({ epoch: 0xffff_ffffn, counter: 0n });
  });

  it("protects the complete close exchange out of the §9.6 reserve without wrapping", async () => {
    const terminal: E2eeSyntheticDirectionState = {
      epoch: 0xffff_ffffn,
      epochRecords: E2EE_REKEY_MAX_RECORDS - 3,
    };
    const { client, node } = await establish({
      tier: "native",
      primeImplicitFinish: false,
      syntheticC2N: terminal,
      syntheticN2C: terminal,
    });
    const close = await client.initiateClose(NOW);
    expect((await node.deliver(close.frame.payload, NOW)).kind).toBe("close");
    const ack = await node.sendOwedCloseRecord(NOW);
    expect((await client.deliver(ack.frame.payload, NOW)).kind).toBe("close_ack");
    await client.sendOwedCloseRecord(NOW);

    expect(client.close.exchangeComplete).toBe(true);
    expect(client.verdict).toBe("clean");
    // Two close-machine records out of the reserve, and the error record's
    // capacity still held behind them.
    expect(client.close.closeRecordsSent).toBe(2);
    expect(client.sendPosition).toEqual({ epoch: 0xffff_ffffn, counter: 2n });
  });

  it("takes the §9.6 degenerate outcome when less than the reserve remains", async () => {
    const degenerate: E2eeSyntheticDirectionState = {
      epoch: 0xffff_ffffn,
      epochRecords: E2EE_REKEY_MAX_RECORDS - 1,
    };
    const { client } = await establish({
      tier: "native",
      primeImplicitFinish: false,
      syntheticC2N: degenerate,
      syntheticN2C: degenerate,
    });
    expect(client.session.postApplicationReserveHeld).toBe(false);

    // The one remaining position goes to the close record; nothing wraps and
    // nothing is reused after it.
    await client.initiateClose(NOW);
    expect(client.close.closeAnchorUnavailable).toBe(true);
    expect(client.verdict).toBe("unclean_abrupt");
    expect(client.session.sendState.exhausted).toBe(true);

    const after = await client.protectRaw(
      E2EE_INNER_TYPE_ERROR,
      encodeE2eeErrorRecordBody(E2EE_ERROR_CODE_INTERNAL),
      "error",
    );
    expect(after.result.kind).toBe("exhausted");
    expect(after.frame).toBeUndefined();
    expect(client.emitted).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// I. Close-machine abuse (§10.1.1, §10.2, §10.4)
// ═════════════════════════════════════════════════════════════════════════════

describe("attacker relay: close-machine abuse", () => {
  /** A sequential close driven to the point where the initiator awaits the ack. */
  const awaitingAck = async () => {
    const live = await establish({ tier: "native" });
    const close = await live.client.initiateClose(NOW);
    expect((await live.node.deliver(close.frame.payload, NOW)).kind).toBe("close");
    return { ...live, close };
  };

  it("rejects a forged ack — one the relay corrupted — as Q3, verdict Failed", async () => {
    const { client, node } = await awaitingAck();
    const ack = await node.sendOwedCloseRecord(NOW);
    const emittedBefore = client.emitted.length;

    const receipt = expectFatal(
      await client.deliver(flipBit(ack.frame.payload, E2EE_ENVELOPE_HEADER_BYTES + 2), NOW),
    );
    expect(receipt.row).toBe("Q3");
    expect(receipt.reason).toBe("authentication_failed");
    expect(client.verdict).toBe("failed");
    expect(receipt.errorEmitted).toBe(true);
    expect(client.emitted).toHaveLength(emittedBefore + 1);
  });

  it("rejects an ack declaring the receiver's current next-send instead of its anchor, as Q7", async () => {
    // §10.1.1's disallowed reading, stated as a fixture in §16.3 F11: the strict
    // rule is EXACT EQUALITY against the anchor, and the anchor is frozen at the
    // endpoint's own first close-machine record.
    const { client, node } = await awaitingAck();
    const anchor = client.close.closeAnchor;
    if (anchor === undefined) throw new Error("the anchor must exist here");
    const wrong: E2eeSequencePosition = { epoch: anchor.epoch, counter: anchor.counter + 1n };

    const body = encodeE2eeCloseRecordBody({
      innerType: E2EE_INNER_TYPE_CLOSE_ACK,
      senderDirection: node.sendDirection,
      sessionBindingHash: node.sessionBindingHash,
      finalSend: node.sendPosition,
      expectedRecv: wrong,
    });
    const sent = await node.protectRaw(E2EE_INNER_TYPE_CLOSE_ACK, body, "wrong-anchor ack");
    if (sent.frame === undefined) throw new Error("the record was not protected");

    const receipt = expectFatal(await client.deliver(sent.frame.payload, NOW));
    expect(receipt.row).toBe("Q7");
    expect(receipt.reason).toBe("strict_rule");
    expect(client.verdict).toBe("failed");
    expect(receipt.errorEmitted).toBe(true);
  });

  it("rejects an ack declaring counter + 1 where the anchor crossed an epoch boundary, as Q7", async () => {
    // §16.3 F11's companion negative: an epoch-completing close advances the
    // anchor to `(e + 1, 0)` and never to `(e, counter + 1)`.
    const synthetic: E2eeSyntheticDirectionState = { epochRecords: E2EE_REKEY_MAX_RECORDS - 1 };
    const { client, node } = await establish({
      tier: "native",
      primeImplicitFinish: false,
      syntheticC2N: synthetic,
    });
    const close = await client.initiateClose(NOW);
    expect(client.close.closeAnchor).toEqual({ epoch: 1n, counter: 0n });
    expect((await node.deliver(close.frame.payload, NOW)).kind).toBe("close");

    const body = encodeE2eeCloseRecordBody({
      innerType: E2EE_INNER_TYPE_CLOSE_ACK,
      senderDirection: node.sendDirection,
      sessionBindingHash: node.sessionBindingHash,
      finalSend: node.sendPosition,
      expectedRecv: { epoch: 0n, counter: close.record.position.counter + 1n },
    });
    const sent = await node.protectRaw(E2EE_INNER_TYPE_CLOSE_ACK, body, "counter+1 ack");
    if (sent.frame === undefined) throw new Error("the record was not protected");

    const receipt = expectFatal(await client.deliver(sent.frame.payload, NOW));
    expect(receipt.row).toBe("Q7");
    expect(receipt.reason).toBe("strict_rule");
  });

  it("accepts the ack that declares the epoch-advanced anchor, so the rule is not a blanket rejection", async () => {
    const synthetic: E2eeSyntheticDirectionState = { epochRecords: E2EE_REKEY_MAX_RECORDS - 1 };
    const { client, node } = await establish({
      tier: "native",
      primeImplicitFinish: false,
      syntheticC2N: synthetic,
    });
    const close = await client.initiateClose(NOW);
    expect((await node.deliver(close.frame.payload, NOW)).kind).toBe("close");
    expect(node.close.ackExpectedRecv).toEqual({ epoch: 1n, counter: 0n });

    const ack = await node.sendOwedCloseRecord(NOW);
    const receipt = await client.deliver(ack.frame.payload, NOW);
    expect(receipt.kind).toBe("close_ack");
    await client.sendOwedCloseRecord(NOW);
    expect(client.verdict).toBe("clean");
  });

  it("records Unclean — abrupt with NO wire record when the relay drops the ack", async () => {
    const { client, node } = await awaitingAck();
    await node.sendOwedCloseRecord(NOW); // dropped: never handed to the client
    const emittedBefore = client.emitted.length;

    expect(client.close.waitExpired(NOW + T_CLOSE + 1)).toBe(true);
    expect(client.noteWaitExpired(NOW + T_CLOSE + 1)).toBe("unclean_abrupt");
    expect(client.verdict).toBe("unclean_abrupt");
    // §10.2, §10.4: this endpoint emits NO wire record for a `T_CLOSE` expiry.
    expect(client.emitted).toHaveLength(emittedBefore);
    expect(client.channelCloseReason).toBeUndefined();
  });

  it("rejects a stray record after the exchange completes as Q7, verdict Failed and NOT abrupt", async () => {
    const { client, node } = await awaitingAck();
    const ack = await node.sendOwedCloseRecord(NOW);
    expect((await client.deliver(ack.frame.payload, NOW)).kind).toBe("close_ack");
    const confirmation = await client.sendOwedCloseRecord(NOW);
    expect(client.close.exchangeComplete).toBe(true);
    expect(client.verdict).toBe("clean");
    expect((await node.deliver(confirmation.frame.payload, NOW)).kind).toBe("close_ack");

    // A NON-CONFORMING PEER protects a third close-machine record.
    const strayBody = encodeE2eeCloseRecordBody({
      innerType: E2EE_INNER_TYPE_CLOSE_ACK,
      senderDirection: node.sendDirection,
      sessionBindingHash: node.sessionBindingHash,
      finalSend: node.sendPosition,
      expectedRecv: node.expectedRecv,
    });
    const stray = await node.protectRaw(E2EE_INNER_TYPE_CLOSE_ACK, strayBody, "stray ack");
    if (stray.frame === undefined) throw new Error("the record was not protected");

    const emittedBefore = client.emitted.length;
    const receipt = expectFatal(await client.deliver(stray.frame.payload, NOW));
    expect(receipt.row).toBe("Q7");
    expect(receipt.reason).toBe("record_beyond_machine");
    // §10.4: **Failed** supersedes the **Clean** already recorded, and the
    // verdict is specifically NOT **Unclean — abrupt**.
    expect(client.verdict).toBe("failed");
    expect(client.verdict).not.toBe("unclean_abrupt");
    // §10.2, §11.5: the error record IS emitted, and it is the ONLY record
    // protected after the close machine.
    expect(receipt.errorEmitted).toBe(true);
    expect(client.emitted).toHaveLength(emittedBefore + 1);
    expect(client.channelCloseReason).toBe("channel_rejected");
  });

  it("rejects a stray application record after completion as Q7", async () => {
    const { client, node } = await awaitingAck();
    const ack = await node.sendOwedCloseRecord(NOW);
    expect((await client.deliver(ack.frame.payload, NOW)).kind).toBe("close_ack");
    await client.sendOwedCloseRecord(NOW);

    // The peer's own session refuses to protect an application record here, so
    // this is a peer holding the keys and bypassing §10.2 altogether.
    const stray = node.mintNonConformingEnvelope({
      epoch: node.sendPosition.epoch,
      counter: node.sendPosition.counter,
      innerType: E2EE_INNER_TYPE_RPC,
      body: Uint8Array.from([0x99]),
    });
    const receipt = expectFatal(await client.deliver(stray, NOW));
    expect(receipt.row).toBe("Q7");
    expect(receipt.reason).toBe("record_beyond_machine");
    expect(client.verdict).toBe("failed");
    expect(client.rpcDeliveries).toHaveLength(0);
  });

  it("answers the peer's terminal E2EEError with silence, verdict Failed", async () => {
    // The other endpoint's view of the trace above. Two endpoints answering each
    // other's terminal errors is precisely the reading §10.2 removes.
    const { client, node } = await awaitingAck();
    const ack = await node.sendOwedCloseRecord(NOW);
    expect((await client.deliver(ack.frame.payload, NOW)).kind).toBe("close_ack");
    const confirmation = await client.sendOwedCloseRecord(NOW);
    expect((await node.deliver(confirmation.frame.payload, NOW)).kind).toBe("close_ack");
    expect(node.close.exchangeComplete).toBe(true);
    expect(node.verdict).toBe("clean");

    const error = await client.protectRaw(
      E2EE_INNER_TYPE_ERROR,
      encodeE2eeErrorRecordBody(E2EE_ERROR_CODE_PROTOCOL_VIOLATION),
      "terminal error",
    );
    if (error.frame === undefined) throw new Error("the record was not protected");

    const emittedBefore = node.emitted.length;
    const receipt = await node.deliver(error.frame.payload, NOW);
    expect(receipt.kind).toBe("terminal_error");
    if (receipt.kind !== "terminal_error") return;
    expect(receipt.errorCode).toBe(E2EE_ERROR_CODE_PROTOCOL_VIOLATION);
    expect(receipt.defined).toBe(true);
    // No record in reply, verdict **Failed**, secrets erased.
    expect(node.emitted).toHaveLength(emittedBefore);
    expect(node.verdict).toBe("failed");
    expect(node.session.erased).toBe(true);
    expect(node.channelCloseReason).toBe("channel_rejected");
  });

  it("rejects a malformed E2EEError body as Q11 rather than treating it as terminal", async () => {
    const { client, node } = await awaitingAck();
    // A NON-CONFORMING PEER: a `0x03` record whose body is not a §11.3 record.
    const stray = node.mintNonConformingEnvelope({
      epoch: node.sendPosition.epoch,
      counter: node.sendPosition.counter,
      innerType: E2EE_INNER_TYPE_ERROR,
      body: Uint8Array.from([0x9f, 0xff]),
    });
    const receipt = expectFatal(await client.deliver(stray, NOW));
    expect(receipt.row).toBe("Q11");
    expect(receipt.reason).toBe("malformed_error_body");
    expect(client.verdict).toBe("failed");
    expect(receipt.errorEmitted).toBe(true);
  });

  it("rejects legacy JSON injected during the close phase as Q6, verdict Failed", async () => {
    const { client } = await awaitingAck();
    const receipt = expectFatal(await client.deliver(LEGACY_JSON_PAYLOAD, NOW));
    expect(receipt.row).toBe("Q6");
    expect(receipt.reason).toBe("legacy-json");
    expect(client.verdict).toBe("failed");
    expect(receipt.errorEmitted).toBe(true);
  });

  it("rejects a negotiation record injected during the close phase as Q6, verdict Failed", async () => {
    const { client } = await awaitingAck();
    const injected = craftHello({ contextBlock: encodeE2eeAuthorizationContext(nativeContext()) });
    const receipt = expectFatal(await client.deliver(injected, NOW));
    expect(receipt.row).toBe("Q6");
    expect(receipt.reason).toBe("negotiation");
    expect(client.verdict).toBe("failed");
  });

  it("rejects a replayed close record as Q2 before the close machine sees it", async () => {
    const { client, node, close } = await awaitingAck();
    const receipt = expectFatal(await node.deliver(close.frame.payload, NOW));
    expect(receipt.row).toBe("Q2");
    expect(receipt.reason).toBe("sequence_mismatch");
    expect(node.verdict).toBe("failed");
    expect(client.close.state).toBe("awaiting_ack");
  });

  it("gives §10.4 precedence to Failed over Unclean — truncation", async () => {
    const { client, node } = await awaitingAck();
    /** A peer close built at whatever position the peer currently sends from. */
    const peerClose = async (label: string) => {
      const body = encodeE2eeCloseRecordBody({
        innerType: E2EE_INNER_TYPE_CLOSE,
        senderDirection: node.sendDirection,
        sessionBindingHash: node.sessionBindingHash,
        finalSend: node.sendPosition,
        expectedRecv: node.expectedRecv,
      });
      const sent = await node.protectRaw(E2EE_INNER_TYPE_CLOSE, body, label);
      if (sent.frame === undefined) throw new Error("the record was not protected");
      return sent.frame;
    };

    // The client is in `awaiting_ack`, so the peer's close takes it into the
    // simultaneous branch — a legitimate transition.
    expect((await client.deliver((await peerClose("peer close")).payload, NOW)).kind).toBe("close");
    expect(client.close.state).toBe("simultaneous_pending");

    // A SECOND peer close, which no state of the machine expects.
    const receipt = expectFatal(
      await client.deliver((await peerClose("second peer close")).payload, NOW),
    );
    expect(receipt.row).toBe("Q7");
    expect(receipt.reason).toBe("record_beyond_machine");
    expect(client.verdict).toBe("failed");

    // An incomplete reassembly arriving afterwards does not demote the verdict.
    expect(client.noteChannelEnded({ at: NOW, incompleteReassembly: true })).toBe("failed");
    expect(client.verdict).toBe("failed");
  });

  it("records Unclean — truncation for an incomplete reassembly with no fatal condition", async () => {
    // The contrast case: without a Q7 the truncation verdict is the one recorded,
    // so the precedence case above is a precedence result and not an artefact.
    const { client } = await awaitingAck();
    expect(client.noteChannelEnded({ at: NOW, incompleteReassembly: true })).toBe(
      "unclean_truncation",
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// J. Reserved inner-record types, and what the relay cannot reach (§3.4, §9.1)
// ═════════════════════════════════════════════════════════════════════════════

describe("attacker relay: authenticated records the registries do not admit", () => {
  it("rejects an authenticated reserved inner-record type as Q5", async () => {
    // A NON-CONFORMING PEER: `encodeE2eeInnerRecord` refuses to build this, so a
    // conforming sender cannot produce it, and §4.3 reads the type only after
    // authentication — which is exactly why the row exists.
    const { client, node } = await establish({ tier: "native", primeImplicitFinish: false });
    const minted = client.mintNonConformingEnvelope({
      epoch: 0n,
      counter: 0n,
      rawPlaintext: Uint8Array.from([0x7f, 0x01, 0x02]),
    });
    const receipt = expectFatal(await node.deliver(minted, NOW));
    expect(receipt.row).toBe("Q5");
    expect(receipt.reason).toBe("reserved_inner_type");
    expect(node.rpcDeliveries).toHaveLength(0);
    expect(node.mayInvokeRpcHandler).toBe(false);
  });

  it("cannot reach the Q5 companion row from the wire, and says why", async () => {
    // `malformed_record` covers an authenticated plaintext with no type byte.
    // The smallest such record is a zero-length plaintext, whose ciphertext is
    // the tag alone; the resulting envelope is below
    // `E2EE_ENVELOPE_OVERHEAD_BYTES` and is rejected as Q4 before the AEAD runs.
    // The row is therefore defense in depth against a future framing change,
    // and this case pins the arithmetic that makes it unreachable today.
    expect(E2EE_ENVELOPE_OVERHEAD_BYTES).toBe(
      E2EE_ENVELOPE_HEADER_BYTES + E2EE_INNER_TYPE_BYTES + 16,
    );
    const { client, node } = await establish({ tier: "native", primeImplicitFinish: false });
    const minted = client.mintNonConformingEnvelope({
      epoch: 0n,
      counter: 0n,
      rawPlaintext: new Uint8Array(0),
    });
    expect(minted.byteLength).toBe(E2EE_ENVELOPE_OVERHEAD_BYTES - 1);
    const receipt = expectFatal(await node.deliver(minted, NOW));
    expect(receipt.row).toBe("Q4");
    expect(receipt.reason).toBe("malformed_envelope");
  });

  it("keeps the two directions' AEAD keys apart, so a relay cannot re-key a record", async () => {
    // The relay re-stamping a c2n record as an n2c one has to defeat both the
    // direction label in the AAD and the directional epoch schedule (§9.4).
    const { client, node } = await establish({ tier: "native", primeImplicitFinish: false });
    const sent = await client.sendRpc(Uint8Array.from([0x01]));
    if (sent.kind !== "sent") throw new Error("the record was not sent");
    expect((await node.deliver(sent.frame.payload, NOW)).kind).toBe("rpc");

    // The node's own next send is at n2c `(0, 0)`; the relay reuses the client's
    // ciphertext under that header.
    const reused = restamp(sent.frame.payload, { epoch: 0n, counter: 0n });
    const receipt = expectFatal(await client.deliver(reused, NOW));
    expect(receipt.row).toBe("Q3");
    expect(receipt.reason).toBe("authentication_failed");
  });

  it("refuses to encode an inner record the §3.4 registry does not admit", async () => {
    // The sending half of the same rule: no path through the landed modules
    // emits a reserved type, which is why the receiving case above needs a
    // non-conforming peer at all.
    //
    // The spec-fixed outcome is a REGISTRY MEMBERSHIP test over the whole byte,
    // not "it throws something": §3.4 admits exactly `0x01`–`0x04` and makes
    // "all others" reserved. Asserting only `toThrow(TypeError)` on one reserved
    // value would still pass against an encoder that admitted `0x00`, or `0x05`,
    // or every value it happened not to be handed — so the assertion is made
    // over the entire domain of the field, and against the exact §9.1 framing
    // for the four values the registry does admit.
    const admitted = new Set<number>([
      E2EE_INNER_TYPE_RPC,
      E2EE_INNER_TYPE_CLOSE,
      E2EE_INNER_TYPE_ERROR,
      E2EE_INNER_TYPE_CLOSE_ACK,
    ]);
    const body = Uint8Array.from([0xa1, 0xb2, 0xc3]);
    const refused: number[] = [];
    for (let value = 0x00; value <= 0xff; value += 1) {
      const encode = (): Uint8Array =>
        encodeE2eeInnerRecord(value as E2eeInnerRecordType, new Uint8Array(0));
      if (admitted.has(value)) {
        expect(encode, `inner type 0x${value.toString(16)}`).not.toThrow();
        continue;
      }
      // One outcome, one error type, one message — the reserved row of §3.4 is
      // not distinguishable from any other reserved row, at any value.
      expect(encode, `inner type 0x${value.toString(16)}`).toThrow(TypeError);
      expect(encode, `inner type 0x${value.toString(16)}`).toThrow(
        "E2EE inner record type must be a registered type.",
      );
      refused.push(value);
    }
    expect(refused.length).toBe(0x100 - admitted.size);

    // The admitted four produce exactly the §9.1 inner record: the type byte,
    // then the body, and nothing else. That is what makes the refusal above a
    // registry check rather than an encoder that is simply broken.
    for (const value of admitted) {
      const plaintext = encodeE2eeInnerRecord(value as E2eeInnerRecordType, body);
      expect(plaintext.byteLength, `inner type 0x${value.toString(16)}`).toBe(
        E2EE_INNER_TYPE_BYTES + body.byteLength,
      );
      expect([...plaintext], `inner type 0x${value.toString(16)}`).toEqual([value, ...body]);
    }

    // And nothing is produced on the refusal path. The §9.3 consequence is what
    // matters and it is asserted against a LIVE session rather than restated as
    // a second throw: a reserved type is refused at the same choke point, before
    // the pair is assigned, so no `(epoch, counter)` is consumed, no AEAD runs,
    // and no envelope reaches the relay.
    const { node } = await establish({ tier: "native" });
    const before = node.sendPosition;
    const emittedBefore = node.emitted.length;
    await expect(
      node.session.protect({
        innerType: 0x7f as E2eeInnerRecordType,
        body: new Uint8Array(0),
        admit: () => true,
        transmit: () => {
          throw new Error("a reserved inner type must never reach the transmit callback");
        },
      }),
    ).rejects.toThrow("Relay E2EE inner record type must be a registered type.");
    expect(node.sendPosition).toEqual(before);
    expect(node.emitted).toHaveLength(emittedBefore);
    expect(node.session.erased).toBe(false);
    expect(node.session.sendPathUsable).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// K. The hostile relay: an ACTIVE man-in-the-middle that owns delivery (§2.1)
// ═════════════════════════════════════════════════════════════════════════════
//
// Sections A–J hand bytes across by hand, one record at a time. That proves a
// module rejects a bad value. It does NOT prove the SESSION survives an
// adversary who controls the channel, and the difference is a schedule: the
// interesting failures need a frame held while another overtakes it, a
// rejection followed by the genuine record the rejection was supposed to make
// unusable, a duplicate landing after the peer has moved on, or an error record
// the relay simply keeps. §14.1 requires the adversarial suite to run against an
// ATTACKER-CONTROLLED RELAY HARNESS, and this is it.
//
// WHAT THE HARNESS ADDS over `AttackerRelay`: delivery. `HostileRelay` captures
// every frame into a queue that nothing drains on its own, and each §2.1
// capability is one method — `hold`/`release` (delay a frame and let it land
// later), `drop` (never deliver it), `forward` (deliver the next one), the
// `index` argument (reorder), releasing the same held frame twice (duplicate),
// the `transform` argument (modify, which subsumes truncate and restamp because
// both are functions of the frame's bytes), the `to` argument (reflect), and
// `inject` (bytes no endpoint produced). It adds no key material: it is the same
// §2.1 relay, and the cases that need a peer holding keys still say so and still
// use `mintNonConformingEnvelope`.
//
// DELIVERY INTO AN ERASED ENDPOINT REJECTS, and the harness deliberately does
// not smooth that over. §11.3 erases the session on a fatal condition and
// `unprotect` then throws rather than returning a row, so a case that releases a
// withheld frame after the peer has failed asserts the rejection in as many
// words. That is the point of holding the frame in the first place.
//
// WHAT THE SCHEDULE DOES NOT COVER, so that a count of this file is not read as
// a count of harness-driven evidence:
//
//   - The §8 NEGOTIATION RECORDS never cross the relay. `establishHostile` runs
//     an honest §8 exchange by handing hello and accept directly between the two
//     handshake objects, then attaches the two live endpoints to the relay — so
//     everything below schedules §9 records and §10 close records only. The last
//     block in this section is hand-carried for the same reason and says so in
//     its title: §8.1 allows one attempt per channel, which leaves a two-record
//     phase nothing to reorder.
//   - Most §14.1 attack CLASSES are still discharged by sections A–J against
//     hand-carried delivery, which is the right shape for them: key and
//     suite-list substitution, tier and pattern confusion, transcript and
//     context-commitment mismatch, role escalation and reduction, cross-account
//     splice, node-fingerprint substitution, mode-lock violations, and
//     key-material validation are properties of a VALUE, and a schedule adds
//     nothing to a value. What the schedule changes the meaning of is what runs
//     here: replay, reorder and gap, implicit-finish abuse, the §9.4 rekey
//     boundary, the §10.2 simultaneous branch, a kept §11.3 error record, and
//     the §8.6/§13.6 authorization withdrawal — the last of which is a RACE
//     rather than a value, and the only §14.1 class this section moved off
//     hand-carried delivery for that reason.

interface HeldFrame {
  readonly id: number;
  readonly from: Party;
  readonly frame: RelayFrame;
}

interface ReleaseOptions {
  /** Modify the bytes in flight. `truncateTo`, `flipBit`, and `restamp` all fit here. */
  readonly transform?: (payload: Uint8Array) => Uint8Array;
  /** Deliver somewhere other than the peer — with `to` equal to `from`, a reflection. */
  readonly to?: Party;
}

class HostileRelay extends AttackerRelay {
  /** Every delivery the attacker chose to make, with what the receiver made of it. */
  readonly deliveries: {
    readonly to: Party;
    readonly label: string;
    readonly receipt: Receipt;
  }[] = [];

  #endpoints: Record<Party, HonestEndpoint> | undefined = undefined;
  readonly #inFlight: HeldFrame[] = [];
  #nextId = 0;

  attach(client: HonestEndpoint, node: HonestEndpoint): void {
    this.#endpoints = { client, node };
  }

  override capture(frame: RelayFrame): RelayFrame {
    const captured = super.capture(frame);
    this.#nextId += 1;
    this.#inFlight.push({ id: this.#nextId, from: frame.from, frame: captured });
    return captured;
  }

  /** What the attacker is holding, oldest first. */
  inFlight(from?: Party): readonly HeldFrame[] {
    return from === undefined ? [...this.#inFlight] : this.#inFlight.filter((h) => h.from === from);
  }

  /** Start from an empty channel, discarding whatever setup left in flight. */
  discardInFlight(): void {
    this.#inFlight.length = 0;
  }

  /**
   * Take a frame OUT of flight without delivering it. Release it later, release
   * it twice, release it at its own sender, or never release it at all — those
   * are delay, duplicate, reflect, and drop, and they are the same operation.
   */
  hold(from: Party, index = 0): HeldFrame {
    const held = this.inFlight(from)[index];
    if (held === undefined) {
      throw new Error(`the relay holds no frame at index ${String(index)} from the ${from}`);
    }
    this.#inFlight.splice(this.#inFlight.indexOf(held), 1);
    return held;
  }

  /** Named for what it means at the call site; `hold` and never releasing is the mechanism. */
  drop(from: Party, index = 0): HeldFrame {
    return this.hold(from, index);
  }

  /** Deliver a held frame. Calling this twice with the same frame duplicates it. */
  async release(held: HeldFrame, at: number, options: ReleaseOptions = {}): Promise<Receipt> {
    const to = options.to ?? (held.from === "client" ? "node" : "client");
    const payload =
      options.transform === undefined ? held.frame.payload : options.transform(held.frame.payload);
    return this.#handTo(to, payload, at, held.frame.label);
  }

  /** Take the next frame from a direction and deliver it, in one step. */
  async forward(
    from: Party,
    at: number,
    options: ReleaseOptions & { readonly index?: number } = {},
  ): Promise<Receipt> {
    return this.release(this.hold(from, options.index ?? 0), at, options);
  }

  /**
   * The honest schedule, for the cases that need a live channel before the
   * attack begins: everything in flight WHEN PUMP WAS CALLED, in emission
   * order. Records the deliveries themselves produce stay in flight, so a pump
   * never runs away with an error record the case has not decided about.
   */
  async pump(at: number): Promise<Receipt[]> {
    const scheduled = this.inFlight();
    const receipts: Receipt[] = [];
    for (const held of scheduled) {
      const index = this.#inFlight.indexOf(held);
      if (index >= 0) this.#inFlight.splice(index, 1);
      receipts.push(await this.release(held, at));
    }
    return receipts;
  }

  /** Bytes no endpoint ever produced. */
  async inject(to: Party, payload: Uint8Array, at: number, label = "injected"): Promise<Receipt> {
    return this.#handTo(to, payload, at, label);
  }

  async #handTo(to: Party, payload: Uint8Array, at: number, label: string): Promise<Receipt> {
    const endpoints = this.#endpoints;
    if (endpoints === undefined) throw new Error("the hostile relay is not attached to a channel");
    const receipt = await endpoints[to].deliver(payload, at);
    this.deliveries.push({ to, label, receipt });
    return receipt;
  }
}

interface HostileChannel {
  readonly client: HonestEndpoint;
  readonly node: HonestEndpoint;
  readonly relay: HostileRelay;
  readonly sessionBindingHash: Uint8Array;
}

/** The §8 handshake, then two live endpoints whose channel the attacker drains. */
const establishHostile = async (
  options: EstablishOptions = { tier: "native" },
): Promise<HostileChannel> => {
  const relay = new HostileRelay();
  const live = await establish({ ...options, relay });
  relay.attach(live.client, live.node);
  // `establish` hands the priming record over itself, so its spent copy is all
  // that is in flight; the attacker starts from an empty channel.
  relay.discardInFlight();
  return {
    client: live.client,
    node: live.node,
    relay,
    sessionBindingHash: live.sessionBindingHash,
  };
};

/** §11.3's erasure, from the attacker's side: the channel cannot be delivered into. */
const ERASED_SESSION_MESSAGE = "Relay E2EE session has been erased; it is never resumed.";

describe("hostile relay: the schedule carries an honest session", () => {
  it("delivers a full application exchange and a clean §10.2 close", async () => {
    // THE ANTI-VACUITY CASE. Every case below asserts that something did not
    // happen, and all of them would pass against a harness that delivered
    // nothing at all. This one pins that the schedule can carry a real session
    // end to end: records in both directions, then the three-record sequential
    // close, then **Clean** at both ends with no error record anywhere.
    const { client, node, relay } = await establishHostile();

    await client.sendRpc(Uint8Array.from([0x01]), "c2n one");
    await node.sendRpc(Uint8Array.from([0x02]), "n2c one");
    const exchanged = await relay.pump(NOW);
    expect(exchanged.map((receipt) => receipt.kind)).toEqual(["rpc", "rpc"]);

    await client.initiateClose(NOW);
    expect((await relay.pump(NOW)).map((receipt) => receipt.kind)).toEqual(["close"]);
    await node.sendOwedCloseRecord(NOW);
    expect((await relay.pump(NOW)).map((receipt) => receipt.kind)).toEqual(["close_ack"]);
    await client.sendOwedCloseRecord(NOW);
    expect((await relay.pump(NOW)).map((receipt) => receipt.kind)).toEqual(["close_ack"]);

    expect(client.verdict).toBe("clean");
    expect(node.verdict).toBe("clean");
    expect(client.close.exchangeComplete).toBe(true);
    expect(node.close.exchangeComplete).toBe(true);
    expect(relay.inFlight()).toHaveLength(0);
    expect(relay.deliveries.some((entry) => entry.receipt.kind === "fatal")).toBe(false);
  });
});

describe("hostile relay: holding a frame and releasing it after the rejection", () => {
  it("refuses the withheld record after the reorder it caused was fatal", async () => {
    // Section F proves the reorder is caught. This proves what the attacker is
    // actually after: that the record it WITHHELD is worthless afterwards. The
    // relay holds the first record, lets the second overtake it, and then
    // releases the first into the §11.3 erasure the second one caused.
    const { client, node, relay } = await establishHostile();
    await client.sendRpc(Uint8Array.from([0x01]), "first");
    await client.sendRpc(Uint8Array.from([0x02]), "second");

    const withheld = relay.hold("client");
    expect(withheld.frame.label).toBe("first");

    const overtaking = expectFatal(await relay.forward("client", NOW));
    expect(overtaking.row).toBe("Q2");
    expect(overtaking.reason).toBe("sequence_mismatch");
    expect(overtaking.errorEmitted).toBe(true);
    expect(node.verdict).toBe("failed");
    expect(node.session.erased).toBe(true);
    expect(node.rpcDeliveries).toHaveLength(1); // the priming record only

    // §11.5 from the ATTACKER's side: exactly one record came back, and it is
    // the length-uniform error record. Nothing about it names a cause.
    const answered = relay.inFlight("node");
    expect(answered).toHaveLength(1);
    expect(answered[0]?.frame.label).toBe("E2EEError(1)");

    // The whole point of the hold. The record is genuine, it is at the position
    // the node was expecting when the attack began, and it is refused.
    await expect(relay.release(withheld, NOW)).rejects.toThrow(ERASED_SESSION_MESSAGE);
    expect(node.rpcDeliveries).toHaveLength(1);
    expect(relay.inFlight("node")).toHaveLength(1);
    expect(node.verdict).toBe("failed");
  });

  it("refuses a duplicate released after the peer moved past it", async () => {
    const { client, node, relay } = await establishHostile();
    await client.sendRpc(Uint8Array.from([0x01]), "first");
    await client.sendRpc(Uint8Array.from([0x02]), "second");

    const first = relay.hold("client");
    const second = relay.hold("client");
    expect((await relay.release(first, NOW)).kind).toBe("rpc");
    expect((await relay.release(second, NOW)).kind).toBe("rpc");
    expect(node.rpcDeliveries).toHaveLength(3); // priming plus both

    // The duplicate: the same held frame, released a second time, after the
    // receiver has moved on.
    const duplicated = expectFatal(await relay.release(first, NOW));
    expect(duplicated.row).toBe("Q2");
    expect(duplicated.reason).toBe("sequence_mismatch");
    expect(node.rpcDeliveries).toHaveLength(3);
    expect(node.verdict).toBe("failed");

    // And the OTHER record it holds is worthless too, which is the session-level
    // claim: one accepted duplicate does not merely fail, it ends the channel.
    await expect(relay.release(second, NOW)).rejects.toThrow(ERASED_SESSION_MESSAGE);
  });

  it("refuses a record reflected at its sender and still delivers it to the peer", async () => {
    // §8.10's independent exclusion, scheduled. Two mechanisms exclude a
    // reflection — the directional epoch schedules give the two directions
    // distinct AEAD keys, and the §3.3 AAD carries the direction label — and
    // this case proves the CONJUNCTION rather than either one: the label on its
    // own is isolated by `relayE2eeWire.test.ts` and `relayE2eeSession.test.ts`,
    // which is where a change to it fails first. What the schedule adds is the
    // second half of the attack: the failure is the reflected-at party's alone,
    // the frame is still the attacker's to deliver, and the peer is untouched.
    const { client, node, relay } = await establishHostile({
      tier: "native",
      primeImplicitFinish: false,
    });
    await client.sendRpc(Uint8Array.from([0x42]), "reflected");
    // The reflected pair is exactly the one the client expects to RECEIVE next,
    // so §9.2 passes and the AEAD is what refuses it.
    expect(client.expectedRecv).toEqual({ epoch: 0n, counter: 0n });

    const held = relay.hold("client");
    const reflected = expectFatal(await relay.release(held, NOW, { to: "client" }));
    expect(reflected.row).toBe("Q3");
    expect(reflected.reason).toBe("authentication_failed");
    expect(client.verdict).toBe("failed");
    expect(client.rpcDeliveries).toHaveLength(0);

    // The node never saw any of it, and the frame is still the attacker's to
    // deliver: the reflection cost the client, not the channel.
    expect(node.verdict).toBeUndefined();
    expect((await relay.release(held, NOW)).kind).toBe("rpc");
    expect(node.rpcDeliveries).toHaveLength(1);
    expect(node.mayInvokeRpcHandler).toBe(true);
  });
});

describe("hostile relay: what the attacker keeps", () => {
  it("leaves the two ends in the asymmetric state §10.4 resolves, when it drops the error record", async () => {
    // THE CASE ONLY A SCHEDULE CAN STATE. §11.3 obliges the failing endpoint to
    // emit exactly one `E2EEError` — and the relay is under no obligation to
    // carry it. So the strongest attack on a live channel is not forgery: it is
    // to kill one end and keep the notification, leaving the peer sending into
    // nothing.
    //
    // What must hold is that the peer neither hangs nor proceeds: §10.4 gives it
    // one `T_CLOSE`-bounded wait and an UNATTRIBUTED **Unclean — abrupt**, which
    // §2.6 already declines to attribute cryptographically. The two verdicts
    // disagreeing is the accepted outcome; either end continuing is not.
    const { client, node, relay } = await establishHostile();
    await client.sendRpc(Uint8Array.from([0x01]), "corrupted in flight");

    const corrupted = expectFatal(
      await relay.forward("client", NOW, {
        transform: (payload) => flipBit(payload, E2EE_ENVELOPE_HEADER_BYTES + 1),
      }),
    );
    expect(corrupted.row).toBe("Q3");
    expect(node.verdict).toBe("failed");
    expect(node.session.erased).toBe(true);

    // The relay keeps the one record §11.3 sent.
    const kept = relay.drop("node");
    expect(kept.frame.label).toBe("E2EEError(1)");

    // The client is untouched and still believes it has a channel: it keeps a
    // usable send path, no verdict, and no close reason.
    expect(client.verdict).toBeUndefined();
    expect(client.session.erased).toBe(false);
    expect(client.channelCloseReason).toBeUndefined();
    const stillSends = await client.sendRpc(Uint8Array.from([0x02]), "into nothing");
    expect(stillSends.kind).toBe("sent");
    expect(relay.drop("client").frame.label).toBe("into nothing");

    // §10.2, §10.4: the client's own close is the only way out, and the relay
    // keeps that too. The wait expires, the verdict is unattributed, and NO wire
    // record is emitted for it.
    await client.initiateClose(NOW);
    relay.drop("client");
    const emittedBefore = client.emitted.length;
    expect(client.close.waitExpired(NOW + T_CLOSE + 1)).toBe(true);
    expect(client.noteWaitExpired(NOW + T_CLOSE + 1)).toBe("unclean_abrupt");
    expect(client.emitted).toHaveLength(emittedBefore);
    expect(client.session.erased).toBe(true);

    // Both ends terminated, on different verdicts, and neither is still running.
    expect(client.verdict).toBe("unclean_abrupt");
    expect(node.verdict).toBe("failed");
  });

  it("cannot resurrect a close the wait already gave up on", async () => {
    // The delay attack on §10.2: hold the ack until the initiator's single
    // `T_CLOSE` wait expires, then release it. §10.4's **Unclean — abrupt** is a
    // verdict, not a pause — an implementation that accepted the late ack would
    // report **Clean** for an exchange that timed out.
    const { client, node, relay } = await establishHostile();
    await client.initiateClose(NOW);
    expect((await relay.pump(NOW)).map((receipt) => receipt.kind)).toEqual(["close"]);
    await node.sendOwedCloseRecord(NOW);
    const heldAck = relay.hold("node");

    expect(client.close.waitExpired(NOW + T_CLOSE + 1)).toBe(true);
    expect(client.noteWaitExpired(NOW + T_CLOSE + 1)).toBe("unclean_abrupt");
    const emittedAfterExpiry = client.emitted.length;

    await expect(relay.release(heldAck, NOW + T_CLOSE + 2)).rejects.toThrow(ERASED_SESSION_MESSAGE);
    expect(client.verdict).toBe("unclean_abrupt");
    expect(client.close.exchangeComplete).toBe(false);
    expect(client.emitted).toHaveLength(emittedAfterExpiry);
  });
});

describe("hostile relay: injection ahead of the genuine frame", () => {
  it("keeps the §8.9 gate shut and makes the genuine finish unusable", async () => {
    // Section G proves an injected record does not open the §8.9 gate. This adds
    // the half the attacker cares about: the relay holds the client's genuine
    // first envelope, spends the node's session on a record it made up at the
    // same position, and THEN releases the genuine one. The RPC handler must
    // never run — not for the injection, and not for the record that would have
    // been the implicit finish.
    const { client, node, relay } = await establishHostile({
      tier: "native",
      primeImplicitFinish: false,
    });
    await client.sendRpc(Uint8Array.from([0x11]), "implicit finish");
    const genuine = relay.hold("client");

    const forged = new Uint8Array(genuine.frame.payload.byteLength);
    forged.set(genuine.frame.payload.subarray(0, E2EE_ENVELOPE_HEADER_BYTES));
    forged.fill(0x5a, E2EE_ENVELOPE_HEADER_BYTES);
    const injected = expectFatal(await relay.inject("node", forged, NOW, "relay-authored"));
    expect(injected.row).toBe("Q3");
    expect(injected.reason).toBe("authentication_failed");
    expect(node.mayInvokeRpcHandler).toBe(false);
    expect(node.mayEmitApplicationRpc).toBe(false);

    await expect(relay.release(genuine, NOW)).rejects.toThrow(ERASED_SESSION_MESSAGE);
    expect(node.rpcDeliveries).toHaveLength(0);
    expect(node.mayInvokeRpcHandler).toBe(false);
    expect(node.verdict).toBe("failed");
  });
});

describe("hostile relay: widening the §8.6 withdrawal window by holding the finish", () => {
  it("refuses a finish the owner withdrew authority for while the relay held it", async () => {
    // THE ONE §14.1 CLASS WHOSE MEANING THE SCHEDULE CHANGES AND SECTION G COULD
    // ONLY ASSERT. §13.6 and §8.9 make the node re-read the client authorization
    // at the implicit finish, and section G proves the re-read refuses a reduced
    // `maxRole`. What it cannot show is the RACE: the window between the client
    // sending its first envelope and the node authenticating it is not fixed by
    // the protocol, and the relay widens it for free by simply holding the
    // frame. Here the withdrawal lands strictly INSIDE that window, with the
    // record already minted and in the attacker's queue, and the outcome is
    // unchanged — Q9 `authorization_withdrawn`, a `policy` error record, and no
    // RPC handler invocation.
    const { client, node, relay } = await establishHostile({
      tier: "native",
      primeImplicitFinish: false,
    });
    await client.sendRpc(Uint8Array.from([0x11]), "implicit finish");
    const finish = relay.hold("client");

    // The owner reduces `maxRole` below the admitted snapshot's while the record
    // is held. `status` is untouched, so a status-only re-check would pass it.
    node.reReadAuthorization = () => ({
      status: "approved",
      maxRole: LOWER_ROLE,
      capabilitySet: [CAPABILITY],
    });

    const receipt = expectFatal(await relay.release(finish, NOW));
    expect(receipt.row).toBe("Q9");
    expect(receipt.reason).toBe("authorization_withdrawn");
    expect(receipt.errorCode).toBe(E2EE_ERROR_CODE_POLICY);
    expect(node.rpcDeliveries).toHaveLength(0);
    expect(node.mayInvokeRpcHandler).toBe(false);
    expect(node.channelCloseReason).toBe("channel_rejected");
    expect(node.verdict).toBe("failed");
  });
});

describe("hostile relay: scheduling the §10.2 simultaneous branch", () => {
  // The relay CAUSES the simultaneous branch — it holds both closes until each
  // endpoint has sent its own — and then reorders the closes and the acks. Every
  // ordering is DRIVEN rather than argued: §10.1.1's anchor is what makes the
  // outcome independent of who lands first, so a bug that resolved correctly
  // only when the node's record arrives first is exactly what the four
  // combinations below exist to catch, and running one of them under a title
  // that says "whichever way" would assert the independence instead of testing
  // it. The duplicate at the end is aimed at whichever ack the relay released
  // last, so the replay lands on both endpoints across the matrix.
  for (const closeFirst of ["node", "client"] as const) {
    for (const ackFirst of ["node", "client"] as const) {
      it(`completes the four-record exchange with the ${closeFirst} close and the ${ackFirst} ack first`, async () => {
        const { client, node, relay } = await establishHostile();
        await client.initiateClose(NOW);
        await node.initiateClose(NOW);
        const held = {
          client: relay.hold("client"),
          node: relay.hold("node"),
        };
        const closeOrder: readonly Party[] =
          closeFirst === "node" ? ["node", "client"] : ["client", "node"];
        for (const party of closeOrder) {
          expect(await relay.release(held[party], NOW)).toEqual({
            kind: "close",
            branch: "simultaneous",
          });
        }
        expect(client.close.state).toBe("simultaneous_pending");
        expect(node.close.state).toBe("simultaneous_pending");

        await client.sendOwedCloseRecord(NOW);
        await node.sendOwedCloseRecord(NOW);
        const acks = {
          client: relay.hold("client"),
          node: relay.hold("node"),
        };
        const ackOrder: readonly Party[] =
          ackFirst === "node" ? ["node", "client"] : ["client", "node"];
        for (const party of ackOrder) {
          expect(await relay.release(acks[party], NOW)).toEqual({
            kind: "close_ack",
            exchangeComplete: true,
          });
        }
        expect(client.verdict).toBe("clean");
        expect(node.verdict).toBe("clean");
        expect(client.close.exchangeComplete).toBe(true);
        expect(node.close.exchangeComplete).toBe(true);

        // The duplicate the attacker still holds: a completed exchange does not
        // make a replayed ack harmless, and §10.4 lets **Failed** supersede
        // **Clean**. The replayed ack is refused by its RECEIVER, which is the
        // party that did not send it.
        const replayed: Party = ackFirst === "node" ? "client" : "node";
        const receiver = replayed === "node" ? client : node;
        const survivor = replayed === "node" ? node : client;
        const duplicated = expectFatal(await relay.release(acks[replayed], NOW));
        expect(duplicated.row).toBe("Q2");
        expect(duplicated.reason).toBe("sequence_mismatch");
        expect(receiver.verdict).toBe("failed");
        expect(survivor.verdict).toBe("clean");
      });
    }
  }
});

describe("hostile relay: holding a frame across the §9.4 rekey boundary", () => {
  it("refuses the withheld boundary record after the new epoch overtook it", async () => {
    // Section H proves the boundary is enforced record by record. The schedule
    // asks the sharper question: can the ratchet be made to CATCH UP? The relay
    // holds the last record of epoch 0 and delivers the first record of epoch 1
    // in its place. A receiver that advanced its epoch on the record it SAW —
    // rather than on the threshold the boundary record completed — would take
    // it, and the withheld record would then be the attacker's to spend at
    // leisure under a key the receiver had already moved past.
    const synthetic: E2eeSyntheticDirectionState = { epochRecords: E2EE_REKEY_MAX_RECORDS - 1 };
    const { client, node, relay } = await establishHostile({
      tier: "native",
      primeImplicitFinish: false,
      syntheticC2N: synthetic,
    });
    const boundary = await client.sendRpc(Uint8Array.from([0x01]), "last of epoch 0");
    if (boundary.kind !== "sent") throw new Error("the record was not sent");
    if (boundary.result.kind !== "protected") throw new Error("not protected");
    expect(boundary.result.epochCompleted).toBe(true);
    const next = await client.sendRpc(Uint8Array.from([0x02]), "first of epoch 1");
    if (next.kind !== "sent") throw new Error("the record was not sent");
    expect(client.sendPosition).toEqual({ epoch: 1n, counter: 1n });

    const withheld = relay.hold("client");
    expect(withheld.frame.label).toBe("last of epoch 0");
    // The node is still inside epoch 0, so the record it is handed is at a pair
    // that is valid for a LATER state and for no state it can be in now.
    expect(node.expectedRecv.epoch).toBe(0n);
    const overtaking = expectFatal(await relay.forward("client", NOW));
    expect(overtaking.row).toBe("Q2");
    expect(overtaking.reason).toBe("sequence_mismatch");
    expect(node.verdict).toBe("failed");

    await expect(relay.release(withheld, NOW)).rejects.toThrow(ERASED_SESSION_MESSAGE);
    expect(node.rpcDeliveries).toHaveLength(0);
  });
});

describe("hostile relay: truncation inside a flight of records", () => {
  // Section A truncates one record in isolation. Scheduling it inside a flight
  // asks the sharper question: does the fatal land on the record the relay
  // touched, and does everything the relay is still holding become worthless?
  // A receiver that resynchronized after a truncation would deliver the rest.
  for (const target of [0, 1, 2]) {
    it(`fails at record ${String(target)} of three and refuses the two behind it`, async () => {
      const { client, node, relay } = await establishHostile();
      const labels = ["first", "second", "third"];
      for (const label of labels) {
        await client.sendRpc(Uint8Array.from([0x10, labels.indexOf(label)]), label);
      }
      const flight = labels.map(() => relay.hold("client"));

      for (let index = 0; index < target; index += 1) {
        expect((await relay.release(flight[index]!, NOW)).kind).toBe("rpc");
      }
      const truncated = expectFatal(
        await relay.release(flight[target]!, NOW, {
          transform: (payload) => truncateTo(payload, payload.byteLength - 1),
        }),
      );
      expect(truncated.row).toBe("Q3");
      expect(truncated.reason).toBe("authentication_failed");
      // The priming record plus exactly the records delivered before the cut.
      expect(node.rpcDeliveries).toHaveLength(1 + target);

      for (let index = target + 1; index < flight.length; index += 1) {
        await expect(relay.release(flight[index]!, NOW)).rejects.toThrow(ERASED_SESSION_MESSAGE);
      }
      expect(node.rpcDeliveries).toHaveLength(1 + target);
      expect(node.verdict).toBe("failed");
    });
  }
});

describe("the negotiation phase: one attempt per channel, so a refused record spends it", () => {
  // HAND-CARRIED, AND NAMED THAT WAY. §8 is two records long and §8.1 allows
  // exactly one handshake attempt per channel, so hold, reorder, and delay have
  // nowhere to go here — sections C and E already drive every reflection and
  // mutation the two frames admit. The two cases below construct no
  // `HostileRelay` and hold no frames; they pass records between a client and a
  // node by hand, exactly as sections A–J do. They sit in section K because the
  // point they make is the schedule's — duplication and substitution both leave
  // the genuine record worthless — but counting them as harness-driven evidence
  // would overstate the harness, so the title no longer says a schedule runs
  // here. See the same distinction in docs/relay-e2ee-noise-audit-scope.md §6.

  it("spends the client handshake on a duplicated accept", async () => {
    const client = makeClient({ tier: "native" });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("expected a hello");
    const accept = makeNode().receiveHello(hello.record, NOW);
    if (accept.kind !== "accepted") throw new Error("expected an accept");

    const established = client.receiveServerAccept(accept.record, NOW);
    expect(established.kind).toBe("established");

    const duplicated = client.receiveServerAccept(accept.record, NOW);
    expect(duplicated.kind).toBe("fatal");
    if (duplicated.kind !== "fatal") return;
    expect(duplicated.row).toBe("P16");
    expect(duplicated.reason).toBe("handshake_spent");
  });

  it("makes the genuine accept unusable once the relay's forgery was refused", async () => {
    // The relay drops the node's accept and substitutes one whose §8.7
    // confirmation it cannot compute — it holds no exporter secret. The client
    // refuses it (P16), and the substitution is not merely detected: the client
    // is spent, so releasing the genuine accept afterwards changes nothing.
    // §8.1's one-attempt rule is what makes a substitution an outage rather than
    // a retry the attacker can grind against.
    const client = makeClient({ tier: "native" });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("expected a hello");
    const accept = makeNode().receiveHello(hello.record, NOW);
    if (accept.kind !== "accepted") throw new Error("expected an accept");

    const forged = flipBit(accept.record, accept.record.byteLength - 1);
    const refused = client.receiveServerAccept(forged, NOW);
    expect(refused.kind).toBe("fatal");
    if (refused.kind !== "fatal") return;
    expect(refused.row).toBe("P16");
    expect(refused.reason).toBe("confirmation_mismatch");

    const released = client.receiveServerAccept(accept.record, NOW);
    expect(released.kind).toBe("fatal");
    if (released.kind !== "fatal") return;
    expect(released.row).toBe("P16");
    expect(released.reason).toBe("handshake_spent");
  });
});
