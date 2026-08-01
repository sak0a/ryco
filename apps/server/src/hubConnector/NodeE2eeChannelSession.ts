import type { RelayCloseReason } from "@ryco/contracts/relay";
import {
  E2EE_HANDSHAKE_RATE_BURST,
  E2EE_HANDSHAKE_RATE_REFILL,
  T_HANDSHAKE_NODE,
} from "@ryco/shared/relayE2eeConstants";
import {
  E2EE_ERROR_CODE_INTERNAL,
  E2EE_ERROR_CODE_POLICY,
  E2EE_ERROR_CODE_PROTOCOL_VIOLATION,
  E2eeCloseMachine,
  encodeE2eeErrorRecordBody,
  type E2eeCloseRecordToSend,
  type E2eeCloseVerdict,
  type E2eeErrorCode,
  type E2eeSequencePosition,
} from "@ryco/shared/relayE2eeClose";
import {
  E2eeNodeHandshake,
  type E2eeClientAuthorizationKey,
  type E2eeHandshakeChannel,
  type E2eeModeTransition,
  type E2eeNodeModeTransitionSelection,
} from "@ryco/shared/relayE2eeHandshake";
import {
  E2eeRecordSession,
  type E2eeProtectResult,
  type E2eeReceiveFatalReason,
  type E2eeSyntheticDirectionState,
} from "@ryco/shared/relayE2eeSession";
import {
  classifyPostStripPayload,
  decodeE2eeNegotiationRecord,
  E2EE_INNER_TYPE_ERROR,
  E2EE_INNER_TYPE_RPC,
  E2EE_NEGOTIATION_TYPE_CLIENT_HELLO,
  encodeE2eeHandshakeReject,
  type E2eeDirection,
  type E2eeInnerRecordType,
  type PostStripPayloadClass,
} from "@ryco/shared/relayE2eeWire";

import type { NodeClientAuthorizationClient } from "../hubIdentity/NodeClientAuthorizationClient.ts";
import type { NodeE2eeChannelRegistration } from "../hubIdentity/NodeE2eePolicyClient.ts";
import type { EffectiveNodeE2eePolicy } from "../hubIdentity/NodeE2eePolicyStore.ts";
import {
  NodeE2eeAdvertisementFatalError,
  type NodeE2eeChannelAnnouncement,
} from "./NodeE2eeChannelAdvertiser.ts";
import type { RelayChannelAdmission, RelayChannelAdmitHandle } from "./RelayChannelRegistry.ts";
import type { RelayChannelSendHandle } from "./RelayChannelRegistry.ts";
import { defaultRelayScheduler, type RelaySessionScheduler } from "./RelayConnectionSession.ts";

// The node half of the relay E2EE layer, on the real relay path —
// docs/relay-e2ee-protocol.md §4.3 (discrimination), §4.4 (the node mode
// machine), §8 (the responder handshake and the implicit finish), §9 (record
// protection), §10 (the authenticated close), and §11 (the error mapping).
//
// WHAT THIS OWNS: one channel's receiver mode machine, the drive loop for Phase
// 1's `E2eeNodeHandshake`, `E2eeRecordSession` and `E2eeCloseMachine`, the two
// §4.4 deadlines, the §12.6 and §13.6 registrations, and the mapping of every
// fatal condition onto §11's observable. It builds no statement, verifies no
// certificate, derives no key, and decides no policy — every one of those
// belongs to a module below it, and a second implementation of any of them here
// would be a second chance to disagree with the first.
//
// THE INVARIANT WORTH STATING TWICE: unauthenticated bytes never reach the RPC
// parser (§4.3). The only disposition this module returns that reaches the
// parser is `rpc`, and in `e2ee` mode the only path to it is a successfully
// authenticated inner RPC record — a plaintext payload in that mode is row N11
// and ends the channel instead.
//
// AND THE ORDERING RULE THE PROTOCOL SINGLES OUT: §9.3 requires transmission
// admission for the WHOLE record — every chunk of it — before the
// `(epoch, counter)` pair is assigned. `E2eeRecordSession.protect` takes an
// `admit` callback for exactly that, and `protectRecord` below wires the relay
// channel's admission handle into it. A refused admission consumes no pair,
// encrypts nothing, and puts no byte on the wire; an implementation that
// encrypted first and rolled the counter back on refusal would reuse that nonce
// with different plaintext, which is an AEAD failure and not a backpressure bug.

/** §3.4: the node sends `n2c` and receives `c2n`. */
const NODE_SEND_DIRECTION: E2eeDirection = "n2c";

/**
 * §11.1: every E2EE-fatal condition takes the existing relay close reason, and
 * this protocol introduces no literal of its own. A clean §10 exchange closes
 * with no reason at all.
 */
const FATAL_CLOSE_REASON: RelayCloseReason = "channel_rejected";

/** The §4.4 node states, plus the terminal one a driver needs to stop at. */
export type NodeE2eeChannelMode = "negotiating" | "e2ee" | "legacy" | "closed";

/**
 * What one inbound, reassembled, prelude-stripped payload becomes.
 *
 * `rejected` is the channel-fatal verdict: by the time it is returned this
 * module has already emitted whatever §11 record the condition calls for, erased
 * what §9.5 requires, and asked for the outer close, so the caller's only
 * remaining job is to stop consuming.
 */
export type NodeE2eeInboundDisposition =
  | { readonly kind: "rpc"; readonly message: Uint8Array }
  | { readonly kind: "claimed" }
  | { readonly kind: "rejected" };

const REJECTED: NodeE2eeInboundDisposition = Object.freeze({ kind: "rejected" } as const);
const CLAIMED: NodeE2eeInboundDisposition = Object.freeze({ kind: "claimed" } as const);

/**
 * Every §9 receive failure, mapped onto its §11.3 row for the node-local
 * diagnostic.
 *
 * Exported because it is a normative enumeration rather than an implementation
 * detail: §11.3's table is the definition site, §16.2 requires every expected
 * failure to name a row of it, and a mapping that only ever appears inside a
 * closure is one no conformance test can hold to the table.
 */
export const NODE_E2EE_RECEIVE_FATAL_ROWS: Readonly<Record<E2eeReceiveFatalReason, string>> = {
  version_mismatch: "Q1",
  suite_mismatch: "Q1",
  sequence_mismatch: "Q2",
  authentication_failed: "Q3",
  malformed_envelope: "Q4",
  reserved_inner_type: "Q5",
  malformed_record: "Q5",
  // Not a condition of its own: it is the latch an earlier fatal condition left
  // behind, reported when a further envelope is delivered to a direction that
  // has none of its expectation left. §11.3 Q2 is the row for an envelope whose
  // pair is not the receiver-expected one, and its code is `protocol_violation`
  // — which is what this module emits for every row of this table. Q10 is a
  // LOCAL internal failure whose send path is unusable and which closes without
  // any record at all, so naming it here would report the wrong condition to the
  // operator and disagree with the code actually sent.
  receive_terminated: "Q2",
};

/**
 * The §8.6 step 1 pre-authentication rate bound (§15), shared by every channel
 * of one Hub origin.
 *
 * A token bucket of capacity `E2EE_HANDSHAKE_RATE_BURST` refilled at
 * `E2EE_HANDSHAKE_RATE_REFILL` per second, evaluated before any signature
 * verification or DH computation. Per Hub origin rather than per channel because
 * a per-channel bucket would bound nothing: §4.4 already admits exactly one
 * handshake attempt per channel.
 */
export interface NodeE2eeHandshakeRateLimiter {
  readonly admit: (hubOrigin: string) => boolean;
}

export function makeNodeE2eeHandshakeRateLimiter(
  options: { readonly now?: () => number } = {},
): NodeE2eeHandshakeRateLimiter {
  const now = options.now ?? Date.now;
  const buckets = new Map<string, { readonly tokens: number; readonly at: number }>();
  return {
    admit: (hubOrigin) => {
      const at = now();
      const bucket = buckets.get(hubOrigin) ?? { tokens: E2EE_HANDSHAKE_RATE_BURST, at };
      const refilled = Math.min(
        E2EE_HANDSHAKE_RATE_BURST,
        bucket.tokens + Math.max(0, (at - bucket.at) / 1_000) * E2EE_HANDSHAKE_RATE_REFILL,
      );
      buckets.set(hubOrigin, { tokens: refilled < 1 ? refilled : refilled - 1, at });
      return refilled >= 1;
    },
  };
}

/** The §13.6 surface this module needs, and no more of it. */
export type NodeE2eeChannelAuthorization = Pick<
  NodeClientAuthorizationClient,
  "lookupClientAuthorization" | "reReadAuthorization" | "registerInFlightHandshake"
>;

/**
 * A node-local diagnostic for one channel-fatal condition (§11.4).
 *
 * It carries the §11 row this node enumerated and the §10.4 verdict it
 * recorded, and never a byte of the payload, a key, an account, a fingerprint,
 * or a transcript value. §11.2's anti-oracle rule governs the WIRE; this is the
 * operator's side of the same event and MUST NOT alter it.
 */
export interface NodeE2eeChannelDiagnostic {
  readonly phase: "pre_key" | "post_key";
  /** A §11.2 or §11.3 row, or `local` for a failure §11.2's table does not enumerate. */
  readonly row: string;
  readonly verdict?: E2eeCloseVerdict | undefined;
}

export interface NodeE2eeChannelSessionSources {
  /** §8.3 elements 1–4 and 13–14, from this node's OWN `channel.open`. */
  readonly channel: E2eeHandshakeChannel;
  /** The §5.5 disposition and, when it advertises, the §8.3 material (§5.4). */
  readonly announcement: NodeE2eeChannelAnnouncement;
  /** §4.5; MUST be positive, or the channel may not carry an E2EE session. */
  readonly plaintextCeiling: number;
  readonly send: RelayChannelSendHandle;
  /** §9.3: admission for the whole record, before a pair is assigned. */
  readonly admit: RelayChannelAdmitHandle;
  /**
   * The outer relay close; the registry drains this channel's queue ahead of
   * it (§10.3). `notifyPeer` is how a reasonless `channel.close` — the relay
   * protocol's orderly close, which §10.3 asks for after a clean exchange — is
   * distinguished from a silent local teardown.
   */
  readonly close: (reason?: RelayCloseReason, options?: { readonly notifyPeer?: boolean }) => void;
  /** §12.4's committed effective policy, read per decision (§8.6 step 2, §12.6). */
  readonly policy: () => EffectiveNodeE2eePolicy;
  /** §12.6: this channel's handle on the policy-withdrawal sweep. */
  readonly registerPolicyChannel: () => NodeE2eeChannelRegistration;
  /** §13.6: the Branch A reads and this channel's handle on that sweep. */
  readonly authorization: NodeE2eeChannelAuthorization;
  /** §6.4: borrow the secret half of the prekey THIS CHANNEL advertised. */
  readonly withPrekeySecret: <A>(
    prekeyId: string,
    use: (secretKey: Uint8Array) => Promise<A> | A,
  ) => Promise<A>;
  /** §15 / §8.6 step 1, before any signature or DH work. */
  readonly rateLimiter: NodeE2eeHandshakeRateLimiter;
  /** §12.5 row N2: one peer-legacy occurrence. Never rejects and is never awaited. */
  readonly recordPeerLegacyFallback: () => void;
  readonly onDiagnostic?: (diagnostic: NodeE2eeChannelDiagnostic) => void;
  readonly now?: () => number;
  readonly scheduler?: RelaySessionScheduler;
  /**
   * TEST AND FIXTURE USE ONLY (§16.3 F9), forwarded verbatim to the record
   * session's own synthetic start positions.
   *
   * It exists because §9.6's degenerate state — a direction that has spent its
   * last position — is otherwise unreachable in finite time, and an unreachable
   * state is one no test can hold this module's behavior to. Production callers
   * MUST omit it; the record session validates every field and refuses anything
   * outside the §9.2 ranges.
   */
  readonly testOnlySyntheticSendState?: E2eeSyntheticDirectionState | undefined;
  /** TEST AND FIXTURE USE ONLY (§16.3 F9). See `testOnlySyntheticSendState`. */
  readonly testOnlySyntheticReceiveState?: E2eeSyntheticDirectionState | undefined;
}

export interface NodeE2eeChannelSession {
  readonly mode: () => NodeE2eeChannelMode;
  /**
   * The §5.4 acceptance announcement, and the instant `T_HANDSHAKE_NODE` starts.
   *
   * Synchronous, as `RelayRpcChannelSession.onAccepted` requires, and at most one
   * record reaches the wire. It does NOT throw: the two dispositions the
   * advertiser makes fatal — §5.5's row N15 (§11.2 P2/P23) and a carrier the send
   * path would not take — take this module's own FATAL-PRE path, so their wire
   * surface is the generic fixed-size reject and `channel_rejected` §11.2 fixes
   * for every pre-key cause rather than a bare registry close.
   */
  readonly announce: () => void;
  /** §4.3, behind the inbound interceptor: discriminate, then §4.4. */
  readonly intercept: (payload: Uint8Array) => Promise<NodeE2eeInboundDisposition>;
  /**
   * One outbound RPC message: plaintext in `legacy`, an envelope in `e2ee`, and
   * dropped in every other state (§4.4, §8.9, §10.2). `false` is a non-fatal
   * refusal — §11.4's sender-local disposition, never a channel-fatal one.
   */
  readonly emit: (bytes: Uint8Array) => Promise<boolean>;
  /**
   * §10: begin the authenticated close. Resolves once this endpoint's exchange
   * has completed, a `T_CLOSE` wait has expired, or the channel has ended —
   * never merely because the records were enqueued (§10.3).
   *
   * It also resolves immediately when the `E2EEClose` could not be admitted at
   * all: that is §11.4 backpressure, which consumes no pair and opens no close
   * phase, so there is nothing to wait for and the caller may try again.
   */
  readonly beginClose: () => Promise<void>;
  /** The channel ended: §10.4's verdict, §9.5's erasure, and sweep retirement. */
  readonly dispose: (options?: { readonly incompleteReassembly?: boolean }) => void;
  /** §10.4, for the node-local diagnostic and for tests. */
  readonly verdict: () => E2eeCloseVerdict | undefined;
}

export function makeNodeE2eeChannelSession(
  sources: NodeE2eeChannelSessionSources,
): NodeE2eeChannelSession {
  const now = sources.now ?? Date.now;
  const scheduler = sources.scheduler ?? defaultRelayScheduler;
  const diagnostic = sources.onDiagnostic ?? (() => undefined);
  const plan = sources.announcement.plan;
  /** The statement advertised ON THIS CHANNEL, or nothing (§5.5 rows N16/N17). */
  const advertised = plan.kind === "advertise" ? plan.advertisement : undefined;

  let mode: NodeE2eeChannelMode = "negotiating";
  let helloConsumed = false;
  let advertisementEmittedAt: number | undefined;
  let deadlineTimer: unknown;
  let closeTimer: unknown;

  const policyRegistration = sources.registerPolicyChannel();
  let authorizationRelease: (() => void) | undefined;
  /**
   * The second half of row N3: the §12.6 and §13.6 phase change from in-flight
   * handshake to established `e2ee` channel.
   *
   * Handed over by `enterE2eeMode` when the row's test passes, and spent by
   * `runHandshake` in the same synchronous turn, next to the mode flip it
   * describes. While it is unspent this channel is an in-flight handshake to
   * both sweeps — which is what it is.
   */
  let markEstablished: (() => void) | undefined;

  let handshake: E2eeNodeHandshake | undefined;
  let record: E2eeRecordSession | undefined;
  let closeMachine: E2eeCloseMachine | undefined;
  let implicitFinishAuthenticated = false;
  let closeSettled: (() => void) | undefined;
  let closePhaseFinished = false;

  // ─── terminal bookkeeping ──────────────────────────────────────────────────

  /**
   * Is the channel already terminal?
   *
   * A function rather than a comparison at each site, because every one of them
   * reads `mode` AFTER an await, and the compiler's narrowing at the top of an
   * async function does not survive one. A stale narrowing here would let a
   * second terminal path emit a second §11 record on a channel that already
   * emitted one.
   */
  function closed(): boolean {
    return mode === "closed";
  }

  function clearTimers(): void {
    if (deadlineTimer !== undefined) scheduler.clearTimeout(deadlineTimer);
    if (closeTimer !== undefined) scheduler.clearTimeout(closeTimer);
    deadlineTimer = undefined;
    closeTimer = undefined;
  }

  /**
   * §9.5 and §6.5 on every terminal path, plus the two sweep retirements.
   *
   * Idempotent, because several of the paths that reach it can run twice — a
   * `T_CLOSE` expiry racing the peer's proof, a sweep closing a channel that
   * has already failed.
   */
  function releaseChannel(): void {
    record?.erase();
    policyRegistration.release();
    authorizationRelease?.();
    authorizationRelease = undefined;
    clearTimers();
    closeSettled?.();
    closeSettled = undefined;
    closePhaseFinished = true;
  }

  /**
   * §11.2 FATAL-PRE, in the order the procedure states it: stop processing the
   * triggering input, send the fixed-size reject while the channel is still
   * writable, erase partial handshake state, close with `channel_rejected`, and
   * deliver nothing to the application.
   *
   * EVERY pre-key cause takes this one path, which is what makes the observable
   * uniform (§11.5): one byte-identical record of exactly
   * `E2EE_HANDSHAKE_REJECT_BYTES`, one close reason, zero application payload.
   * The send uses `report` rather than the path's default `close` disposition,
   * so a reject the queue will not take still closes with the reason §11.1 names
   * instead of the send path's `transfer_limit`/`slow_consumer` vocabulary.
   */
  function fatalPreKey(row: string): NodeE2eeInboundDisposition {
    if (mode === "closed") return REJECTED;
    mode = "closed";
    sources.send(encodeE2eeHandshakeReject(), { onRefused: "report" });
    const verdict = closeMachine?.noteFatal();
    releaseChannel();
    diagnostic({ phase: "pre_key", row, verdict });
    sources.close(FATAL_CLOSE_REASON);
    return REJECTED;
  }

  /**
   * §11.3 FATAL-POST: stop delivering records; when the send path is still
   * usable emit exactly one `E2EEError` consuming the normal directional
   * sequence; erase every session secret; close with `channel_rejected`.
   *
   * The error record takes the same §9.3 admission path every other record
   * takes. §9.6 reserves capacity for it beyond the close machine's, so the
   * obligation is satisfiable even in the terminal epoch, and a refusal here is
   * §11.5's "none when the send path is unusable" case rather than a violation
   * of the procedure.
   */
  async function fatalPostKey(
    row: string,
    errorCode: E2eeErrorCode,
  ): Promise<NodeE2eeInboundDisposition> {
    if (mode === "closed") return REJECTED;
    mode = "closed";
    const machine = closeMachine;
    const verdict = machine?.noteFatal();
    const session = record;
    if (
      session !== undefined &&
      session.sendPathUsable &&
      (machine === undefined || machine.mayProtectTerminalError)
    ) {
      const result = await protectRecord(
        session,
        E2EE_INNER_TYPE_ERROR,
        encodeE2eeErrorRecordBody(errorCode),
      );
      if (result.kind === "protected") machine?.noteTerminalErrorTransmitted();
    }
    releaseChannel();
    diagnostic({ phase: "post_key", row, verdict });
    sources.close(FATAL_CLOSE_REASON);
    return REJECTED;
  }

  // ─── §9.3: admission, then the pair, then the AEAD ─────────────────────────

  /**
   * What one `protect` attempt did, reduced to what a caller here reacts to.
   *
   * `close_required` is §9.6's reserve boundary and `unusable` is §9.3's
   * no-byte-reached-the-relay branch; both are outcomes rather than errors, and
   * `refused` is ordinary sender-local backpressure (§11.4).
   *
   * The consumed pair travels in the RESULT rather than in a field this closure
   * shares. `protect` is asynchronous and serialized inside the record session,
   * so two callers can sit between their own `await` and their continuation at
   * the same time; a shared "last protected" field would let the second one's
   * entry overwrite what the first is about to read, and the close machine's
   * `noteTransmitted` would then commit a record at a position it does not
   * declare.
   */
  type ProtectOutcome =
    | {
        readonly kind: "protected";
        readonly epoch: bigint;
        readonly counter: bigint;
        readonly epochCompleted: boolean;
      }
    /**
     * §11.4 ONLY: `e2ee_send_unavailable` or `e2ee_message_too_large`. No pair
     * was consumed, no wire record of any kind was produced, and the channel is
     * unaffected and remains usable. It is kept apart from every other
     * non-`protected` outcome precisely because a caller that must decide the
     * channel's fate reacts to ordinary backpressure differently from a failure.
     */
    | { readonly kind: "refused" }
    | { readonly kind: "close_required" }
    /**
     * The send path declines this record in this state — erased, spent, or the
     * §10.2 application-phase gate — or it consumed a pair and could not
     * establish delivery. Nothing follows from a retry.
     */
    | { readonly kind: "unavailable" }
    | { readonly kind: "unusable" };

  /**
   * Protect and transmit exactly one inner record.
   *
   * THE ADMISSION CALLBACK IS THE POINT OF THIS FUNCTION. §9.3 requires
   * transmission admission for the entire record — every chunk of it — BEFORE
   * the `(epoch, counter)` pair is assigned and the AEAD runs, so `admit`
   * consults the relay channel's admission handle and the reservation it returns
   * is what `transmit` spends. A refusal returns `false`, which
   * `E2eeRecordSession.protect` reports as the sender-local
   * `e2ee_send_unavailable` having consumed no pair, encrypted nothing, and
   * produced no wire record at all.
   *
   * The reservation is released in a `finally` because `protect` has two paths
   * that admit and then decline to transmit — an erasure racing the admission,
   * and a local AEAD or encoder failure — and an unspent reservation would
   * otherwise hold relay capacity until the channel closed.
   */
  async function protectRecord(
    session: E2eeRecordSession,
    innerType: E2eeInnerRecordType,
    body: Uint8Array,
  ): Promise<ProtectOutcome> {
    let admission: RelayChannelAdmission | undefined;
    let result: E2eeProtectResult;
    try {
      result = await session.protect({
        innerType,
        body,
        admit: (envelopeBytes) => {
          admission = sources.admit(envelopeBytes);
          return admission !== undefined;
        },
        transmit: (envelope) => {
          const held = admission;
          admission = undefined;
          const sent =
            held === undefined
              ? sources.send(envelope, { onRefused: "report" })
              : held.send(envelope, { onRefused: "report" });
          // The send path is all-or-nothing (`RelaySendQueue.enqueueDataBatch`),
          // so a refusal means no byte of this record reached the relay — §9.3's
          // `none` branch, under which no further record may be protected and no
          // `E2EEError` may follow, because that record would itself create the
          // sequence gap being avoided.
          return sent.accepted ? { kind: "sent" } : { kind: "failed", delivery: "none" };
        },
      });
    } finally {
      admission?.release();
    }
    if (result.kind === "protected") {
      return {
        kind: "protected",
        epoch: result.epoch,
        counter: result.counter,
        epochCompleted: result.epochCompleted,
      };
    }
    if (result.kind === "close_required") return { kind: "close_required" };
    if (result.kind === "send_failed") {
      // A pair WAS consumed here, so this is never `refused`: §11.4's "channel
      // unaffected" is false of it, and a caller that retried the same record
      // would build it at a position the session has already spent.
      return result.sendPathUsable ? { kind: "unavailable" } : { kind: "unusable" };
    }
    if (result.kind === "exhausted") return { kind: "unusable" };
    if (result.kind === "unavailable") return { kind: "unavailable" };
    return { kind: "refused" };
  }

  // ─── §4.4 deadlines ────────────────────────────────────────────────────────

  /**
   * `T_HANDSHAKE_NODE`, armed at advertisement emit and covering both halves
   * §4.4 and §8.9 give it.
   *
   * One timer, because it is one deadline. Row N8 is its `negotiating` half and
   * is guarded on effective `requireE2EE`, for the compatibility reason §4.4
   * states at length; the §8.9 implicit-finish half is armed unconditionally,
   * under every policy including the compatibility default, and stays armed
   * through `e2ee` until the first client-to-node envelope authenticates. A
   * channel that locked `legacy`, or whose finish has authenticated, is past
   * both, and the expiry is ignored.
   */
  function armHandshakeDeadline(at: number): void {
    advertisementEmittedAt = at;
    deadlineTimer = scheduler.setTimeout(() => {
      deadlineTimer = undefined;
      if (mode === "negotiating") {
        if (sources.policy().requireE2EE) fatalPreKey("P7");
        return;
      }
      if (mode === "e2ee" && !implicitFinishAuthenticated) {
        // §11.3 Q8. The justification is key-material lifetime, not
        // availability: between row N3 and the finish the node holds a complete
        // set of live session secrets for a peer that has not yet shown it
        // derived the same ones, and §9.5's erasure needs a deterministic
        // trigger in every configuration rather than only in the hardened ones.
        void fatalPostKey("Q8", E2EE_ERROR_CODE_PROTOCOL_VIOLATION);
      }
    }, T_HANDSHAKE_NODE);
  }

  function announce(): void {
    // The advertiser's body first: it either puts the carrier at outbound
    // sequence 0 or throws, and a channel whose advertisement is fatal must not
    // arm a deadline it will not live to see.
    try {
      sources.announcement.announce(sources.send);
    } catch (error: unknown) {
      // §11.2 IS EXPLICIT ABOUT THESE TWO ROWS: "Rows P2 and P23 are node-local
      // availability conditions ... their wire surface is identical to every
      // other FATAL-PRE — a generic fixed-size reject and `channel_rejected`,
      // revealing nothing about the cause." So they take the same FATAL-PRE path
      // every peer-input row takes, HERE, rather than escaping to the registry:
      // the registry's announcement-failure close is the right reason but no
      // record at all, and a missing reject is exactly the "record count varying
      // by cause" the anti-oracle rule forbids. A carrier the send path would not
      // take is not a row of §11.2's table — it is local — and it takes the
      // identical path for the identical reason.
      fatalPreKey(
        error instanceof NodeE2eeAdvertisementFatalError
          ? error.reason === "undersized-connection"
            ? "P2"
            : "P23"
          : "local",
      );
      return;
    }
    armHandshakeDeadline(now());
  }

  // ─── §8.6: the responder handshake ─────────────────────────────────────────

  /**
   * Row N3's ADMISSION TEST, evaluated inside `receiveHello` and therefore
   * inside the same synchronous turn as the §8.6 step 2 and step 6 reads.
   *
   * That is what discharges both atomicity requirements on this runtime without
   * any per-channel generation bookkeeping: a §12.6 commit and a §13.6 write are
   * each `await`-driven, so neither can interleave between those reads and this
   * test. What the two registrations still buy is the window on the other side
   * of it — the sweeps that run after row N3, and the in-flight aborts that
   * reach a handshake whose hello has not arrived yet.
   *
   * Passing the test is NOT the transition, and this function deliberately does
   * not make the channel an established `e2ee` channel for either sweep. Row N3
   * is "on success emit `E2EEServerAccept`" (§4.4), and none of the §8.6 step 8
   * work that produces the accept has run yet; `markEstablished` below is the
   * half of the row that flips both registrations, and `runHandshake` calls it
   * with the mode flip it belongs to.
   */
  function enterE2eeMode(selection: E2eeNodeModeTransitionSelection): E2eeModeTransition {
    const selected = policyRegistration.selectHandshake({
      pattern: selection.pattern,
      suite: selection.suite,
      // §11.2 P25: the §12.6 sweep reaching a handshake still in flight takes
      // the ordinary generic reject and never a distinguishable signal.
      abort: () => {
        fatalPreKey("P25");
      },
    });
    const admitted = selected.establish({
      // §11.3 Q12: one encrypted error with code `policy`, then the close.
      close: async () => {
        await fatalPostKey("Q12", E2EE_ERROR_CODE_POLICY);
      },
    });
    if (admitted.kind === "refused") return { kind: "refused", reason: "policy_withdrawn" };
    // NX carries no Branch A record and therefore no snapshot: no withdrawal can
    // name an NX channel, and §12.4's node policy governs its admission instead.
    if (selection.admittedAuthority === undefined) {
      markEstablished = admitted.established;
      return { kind: "entered" };
    }
    const registration = sources.authorization.registerInFlightHandshake({
      admittedAuthority: selection.admittedAuthority,
      // §11.2 P12's second clause — the generic surface, never a `policy` code,
      // which exists only post-key.
      abort: () => {
        fatalPreKey("P12");
      },
    });
    // Retired at channel close and on any fatal outcome, NEVER at the
    // authenticated finish: §8.9 makes a channel between row N3 and the finish
    // an active E2EE channel for §13.6, and it stays one for the rest of its
    // life, so releasing early would hide it from the withdrawal sweep. It is
    // set from the in-flight registration rather than from the admission below,
    // because the entry is on the sweep's list from THIS call and a step-8
    // failure between here and the accept must not strand it there.
    authorizationRelease = registration.release;
    const authorized = registration.establish({
      // §11.3 Q9.
      close: async () => {
        await fatalPostKey("Q9", E2EE_ERROR_CODE_POLICY);
      },
    });
    if (authorized.kind === "refused") {
      return { kind: "refused", reason: "authorization_withdrawn" };
    }
    authorizationRelease = authorized.release;
    markEstablished = () => {
      admitted.established();
      authorized.established();
    };
    return { kind: "entered" };
  }

  /**
   * What one hello did, decided ENTIRELY inside the prekey borrow below.
   *
   * `row` names the §11.2 row a fatal hello takes; `local` is the row-less
   * disposition for a failure §11.2's table does not enumerate.
   */
  type HelloOutcome =
    | { readonly kind: "entered" }
    | { readonly kind: "fatal"; readonly row: string };

  /** Rows N3 and N4, and the whole of §8.6 behind them. */
  async function runHandshake(payload: Uint8Array): Promise<NodeE2eeInboundDisposition> {
    // Row N4: a hello with no advertisement emitted, or a second hello on this
    // channel. §4.4 admits exactly one handshake attempt per channel.
    if (advertised === undefined || helloConsumed) return fatalPreKey("P4");
    helloConsumed = true;
    const at = now();
    try {
      // The secret half of the prekey THIS CHANNEL advertised (§6.4), borrowed
      // for exactly the span that needs it. `receiveHello` is synchronous, which
      // is also what keeps row N3 atomic with respect to the two withdrawal
      // commits.
      //
      // EVERYTHING ROW N3 CONSISTS OF RUNS IN THIS ONE SYNCHRONOUS TURN, and
      // that is the point of the callback's shape rather than an accident of it:
      // the §8.6 step 2 and step 6 reads, `enterE2eeMode`'s two withdrawal
      // tests, the session and close machine, the accept onto the send path, the
      // mode flip, and the phase change that publishes all of it to the two
      // sweeps. Nothing can run between them.
      //
      // WHAT IS *NOT* CLAIMED HERE — and what the phase change is separate for —
      // is that passing the tests establishes the channel. The step-8 work below
      // can still fail: a Noise write, the §4.5 ceiling the record session
      // enforces, a send the queue will not take. Those failures return through
      // this callback and are answered by `fatalPreKey` A TURN LATER, on the
      // other side of the borrow's own await, and a sweep may land in that gap.
      // An entry claiming `e2ee` there would be closed as FATAL-POST — an
      // encrypted §11.3 Q12 record for a peer that never received an accept and
      // holds no keys, and no reject at all, which is precisely the record count
      // varying by cause that §11.2 forbids. So the registrations stay on the
      // in-flight handshake list until `markEstablished` runs, where a sweep
      // takes the generic FATAL-PRE abort that every other pre-key cause takes.
      const outcome = await sources.withPrekeySecret(
        advertised.material.prekeyId,
        (secretKey): HelloOutcome => {
          const responder = new E2eeNodeHandshake({
            channel: sources.channel,
            advertised: advertised.material,
            advertisedVersionMin: advertised.e2eeVersionMin,
            advertisedVersionMax: advertised.e2eeVersionMax,
            agreementSecretKey: secretKey,
            advertisementEmittedAt: advertisementEmittedAt ?? at,
            // ALWAYS the node's own committed policy, never the one the
            // advertised snapshot carries (§8.6 step 2, §12.6).
            readPolicy: () => {
              const policy = sources.policy();
              return {
                requireApprovedClientE2EE: policy.requireApprovedClientE2EE,
                suiteRegistry: policy.suiteRegistry,
              };
            },
            admitAttempt: () => sources.rateLimiter.admit(sources.channel.hubOrigin),
            lookupClientAuthorization: (key) =>
              sources.authorization.lookupClientAuthorization(key),
            enterE2eeMode,
          });
          handshake = responder;
          const accept = responder.receiveHello(payload, at);
          if (accept.kind === "fatal") return { kind: "fatal", row: accept.row };
          // §4.5 / §11.2 P14: a channel whose plaintext ceiling is not positive
          // fails during establishment, before it is released to the
          // application. The record session enforces it and erases the secrets
          // it was handed on any construction failure, so the throw lands in the
          // funnel below with nothing stranded.
          record = new E2eeRecordSession({
            secrets: accept.secrets,
            suite: accept.suite,
            sessionBindingHash: accept.sessionBindingHash,
            sendDirection: NODE_SEND_DIRECTION,
            plaintextCeiling: sources.plaintextCeiling,
            ...(sources.testOnlySyntheticSendState === undefined
              ? {}
              : { testOnlySyntheticSendState: sources.testOnlySyntheticSendState }),
            ...(sources.testOnlySyntheticReceiveState === undefined
              ? {}
              : { testOnlySyntheticReceiveState: sources.testOnlySyntheticReceiveState }),
          });
          closeMachine = new E2eeCloseMachine({
            sessionBindingHash: accept.sessionBindingHash,
            sendDirection: NODE_SEND_DIRECTION,
          });
          // Row N3's own emission (§8.6 step 8). It is a negotiation record, so
          // it goes out through the plain send handle and not the record
          // session. A send the queue will not take leaves the row untaken: the
          // registrations are still in flight, and the FATAL-PRE path retires
          // them.
          if (!sources.send(accept.record, { onRefused: "report" }).accepted) {
            return { kind: "fatal", row: "local" };
          }
          // Row N3 is complete: the accept is on the send path and the node's
          // mode machine is in `e2ee`, which is exactly §13.6's definition of an
          // active E2EE channel and §12.6's `e2ee` sweep class. The phase change
          // is made here, in the same turn as the flip it reports, and never
          // before it.
          mode = "e2ee";
          markEstablished?.();
          markEstablished = undefined;
          return { kind: "entered" };
        },
      );
      if (outcome.kind === "fatal") return fatalPreKey(outcome.row);
      return CLAIMED;
    } catch {
      // A local failure: key custody refusing the borrow, an encoder rejecting
      // material this node holds, the §4.5 ceiling. §11.2's table enumerates
      // peer-input conditions only, so none of them names a row — and the wire
      // surface is the identical generic reject either way.
      return fatalPreKey("local");
    }
  }

  // ─── §4.4: the node mode machine ───────────────────────────────────────────

  /** Rows N1, N2 and N17. */
  function lockLegacy(payload: Uint8Array): NodeE2eeInboundDisposition {
    // Row N1 / §11.2 P1 first: effective `requireE2EE` forbids entering `legacy`
    // at all. The read is this node's own committed policy, so a §12.6 commit
    // that landed while the channel was negotiating governs this input — which
    // is the reason §12.6 leaves a `negotiating` channel out of both of its
    // enumerations.
    if (sources.policy().requireE2EE) return fatalPreKey("P1");
    const admission = policyRegistration.lockLegacy({
      close: () => {
        // §12.6: a `legacy` channel holds no session keys, so it closes with
        // `channel_rejected` and NO record of any kind — in particular no
        // `E2EEHandshakeReject`, which is a negotiation record and would be row
        // K21 at the peer.
        if (mode === "closed") return;
        mode = "closed";
        releaseChannel();
        diagnostic({ phase: "pre_key", row: "P1" });
        sources.close(FATAL_CLOSE_REASON);
      },
    });
    if (admission.kind === "refused") return fatalPreKey("P1");
    mode = "legacy";
    // Rows N2 and N17 partition legacy admission by whether the node actually
    // advertised: an advertisement it could not emit was already counted once,
    // in the advertisement-unavailable class, and MUST NOT also be counted as
    // evidence that a legacy peer population exists (§12.3, §12.5).
    if (advertised !== undefined) sources.recordPeerLegacyFallback();
    return { kind: "rpc", message: payload };
  }

  async function negotiating(
    payload: Uint8Array,
    klass: PostStripPayloadClass,
  ): Promise<NodeE2eeInboundDisposition> {
    switch (klass.kind) {
      case "legacy-json":
        // The keepalive `Ping` is classified here exactly as any other plaintext
        // RPC message (§4.4).
        return lockLegacy(payload);
      case "negotiation": {
        // §4.3 step 4 and §15: the per-type bound before any body parse, and the
        // §3.4 direction registry. An unknown, misdirected, or over-bound record
        // is row N5 / §11.2 P3.
        const decoded = decodeE2eeNegotiationRecord(payload);
        if (decoded.kind === "error") return fatalPreKey("P3");
        // `E2EEServerAccept` and `E2EEHandshakeReject` are node-to-client
        // records (§3.4); either arriving here is misdirected.
        if (decoded.value.recordType !== E2EE_NEGOTIATION_TYPE_CLIENT_HELLO) {
          return fatalPreKey("P3");
        }
        return runHandshake(payload);
      }
      case "envelope":
        // Row N6 / §11.2 P5: an envelope before establishment.
        return fatalPreKey("P5");
      case "other":
        // Row N7 / §11.2 P6 — the zero-length post-strip payload included, which
        // is never a benign no-op and never silently dropped.
        return fatalPreKey("P6");
    }
  }

  function legacy(payload: Uint8Array, klass: PostStripPayloadClass): NodeE2eeInboundDisposition {
    switch (klass.kind) {
      case "legacy-json":
        // Row N12.
        return { kind: "rpc", message: payload };
      case "envelope":
        // Row N13's envelope half / §11.2 P5.
        return fatalPreKey("P5");
      case "negotiation":
        // Row N13's negotiation half / §11.2 P24. No session keys exist in
        // `legacy`, so the disposition is FATAL-PRE and never FATAL-POST.
        return fatalPreKey("P24");
      case "other":
        // Row N14 / §11.2 P6.
        return fatalPreKey("P6");
    }
  }

  /**
   * §8.9: the first valid client-to-node envelope is the implicit finish. Until
   * it authenticates the node MUST NOT emit node-to-client application RPC and
   * MUST NOT invoke the RPC handler for anything — which is why this runs before
   * the authenticated record is dispatched, and not after.
   */
  async function authenticateFinish(at: number): Promise<NodeE2eeInboundDisposition | undefined> {
    const responder = handshake;
    if (responder === undefined || implicitFinishAuthenticated) return undefined;
    const finish = responder.authenticateImplicitFinish({
      now: at,
      // §13.6's last re-check before a withdrawn authority could reach
      // application state, read under the snapshot's FULL record key. Status
      // alone is not sufficient: a demotion or a capability removal leaves the
      // record `approved`.
      reReadAuthorization: (key: E2eeClientAuthorizationKey) =>
        sources.authorization.reReadAuthorization(key),
    });
    if (finish.kind === "fatal") {
      return fatalPostKey(
        finish.row,
        finish.errorCode === "policy" ? E2EE_ERROR_CODE_POLICY : E2EE_ERROR_CODE_PROTOCOL_VIOLATION,
      );
    }
    implicitFinishAuthenticated = true;
    return undefined;
  }

  async function established(
    payload: Uint8Array,
    klass: PostStripPayloadClass,
  ): Promise<NodeE2eeInboundDisposition> {
    // Row N11 / §11.3 Q6: a negotiation record, legacy JSON, or an unknown or
    // absent first byte in `e2ee`. Plaintext after E2EE never reaches the RPC
    // parser, and a close phase in progress grants no exemption (§10.2).
    if (klass.kind !== "envelope") return fatalPostKey("Q6", E2EE_ERROR_CODE_PROTOCOL_VIOLATION);
    const session = record;
    if (session === undefined) return fatalPostKey("Q10", E2EE_ERROR_CODE_INTERNAL);
    const result = session.unprotect(payload);
    if (result.kind === "fatal") {
      // Row N10 / §11.3 Q1–Q5: every one of them a protocol violation detected
      // on peer input, and none of them attributable (§9.7).
      return fatalPostKey(
        NODE_E2EE_RECEIVE_FATAL_ROWS[result.reason],
        E2EE_ERROR_CODE_PROTOCOL_VIOLATION,
      );
    }
    const at = now();
    const finished = await authenticateFinish(at);
    if (finished !== undefined) return finished;
    return dispatch(session, result.innerType, result.body, {
      epoch: result.epoch,
      counter: result.counter,
      epochCompleted: result.epochCompleted,
      at,
    });
  }

  // ─── §10: the authenticated close ──────────────────────────────────────────

  /**
   * The §9.2 next-send position, or `undefined` when the direction has spent its
   * last one (§9.6).
   *
   * `undefined` rather than a throw, because every caller below is on a path that
   * §9.6 gives a defined outcome — "protects as many close-machine records as
   * remaining capacity allows ... and records the close as **Unclean — abrupt**"
   * — and none of them is inside a `try`. An exception here would leave that
   * outcome unrecorded and escape into the inbound interceptor, which is the one
   * place §4.3 requires a decision rather than a crash.
   */
  function sendPosition(session: E2eeRecordSession): E2eeSequencePosition | undefined {
    const state = session.sendState;
    if (state.epoch === undefined || state.counter === undefined) return undefined;
    return { epoch: state.epoch, counter: state.counter };
  }

  /** The §9.2 expected-next receive position, or `undefined` per §9.6, as above. */
  function expectedRecv(session: E2eeRecordSession): E2eeSequencePosition | undefined {
    const state = session.receiveState;
    if (state.epoch === undefined || state.counter === undefined) return undefined;
    return { epoch: state.epoch, counter: state.counter };
  }

  /**
   * §9.6's degenerate outcome: no further close-machine record can be protected,
   * so the close is **Unclean — abrupt** (§10.4) and NO wire record is emitted
   * for it. §10.3's lower bound still governs the outer close, which is why this
   * goes through `finishClose` rather than closing here.
   */
  function endDegenerate(session: E2eeRecordSession, machine: E2eeCloseMachine): void {
    machine.noteChannelEnded({ at: now() });
    finishClose(session, machine);
  }

  /**
   * §10.2: mirror the machine's current `T_CLOSE`-bounded wait onto the
   * scheduler. The machine counts the waits — at most one on either sequential
   * path and two on the simultaneous one, never three — and nothing here
   * restarts or extends one.
   */
  function armCloseWait(session: E2eeRecordSession, machine: E2eeCloseMachine): void {
    if (closeTimer !== undefined) scheduler.clearTimeout(closeTimer);
    closeTimer = undefined;
    const deadline = machine.waitDeadlineAt;
    if (deadline === undefined) return;
    closeTimer = scheduler.setTimeout(
      () => {
        closeTimer = undefined;
        if (mode !== "e2ee" || !machine.waitExpired(now())) return;
        // §10.2, §10.4: the wait expired. Unclean — abrupt, unattributed, and no
        // wire record of any kind is emitted for it.
        machine.noteWaitExpired(now());
        finishClose(session, machine);
      },
      Math.max(1, deadline - now()),
    );
  }

  /**
   * §10.3: the outer `channel.close` after the exchange, with the last-record
   * linger the endpoint's role calls for.
   *
   * Never before the encrypted peer proof the role requires, or a `T_CLOSE`
   * expiry: enqueueing one's own final records is not delivering them, and the
   * relay gives no delivery guarantee for channel data queued when a channel
   * closes.
   */
  function finishClose(session: E2eeRecordSession, machine: E2eeCloseMachine): void {
    if (closePhaseFinished) return;
    if (!machine.outerCloseAllowed(now())) return;
    closePhaseFinished = true;
    if (closeTimer !== undefined) scheduler.clearTimeout(closeTimer);
    closeTimer = undefined;
    const emitOuterClose = (): void => {
      if (mode === "closed") return;
      mode = "closed";
      releaseChannel();
      // After a clean exchange the endpoint sends `channel.close` with no
      // reason — the relay protocol's orderly close (§10.3), which is a frame
      // the peer receives and not a silent teardown. A fatal outcome took
      // `channel_rejected` on its own path and never reaches here.
      sources.close(undefined, { notifyPeer: true });
    };
    if (machine.shouldLinger(now())) {
      const lingerFor = Math.max(1, (machine.lingerDeadlineAt ?? now()) - now());
      closeTimer = scheduler.setTimeout(() => {
        closeTimer = undefined;
        emitOuterClose();
      }, lingerFor);
      // §10.3: the verdict is already determined and MUST NOT depend on which of
      // the three events ends the linger, so the caller is released now.
      closeSettled?.();
      closeSettled = undefined;
      return;
    }
    emitOuterClose();
  }

  /**
   * What one close-machine record's transmission did.
   *
   * `refused` is §11.4 and NOTHING ELSE: the record was not built onto the wire,
   * no pair was consumed, and the channel is unaffected and remains usable. It
   * MUST NOT be escalated to a channel-fatal condition or to a close outcome —
   * the record simply stays owed, and the close phase's own `T_CLOSE` wait,
   * the peer's, or the channel ending is what bounds it. `ended` is §9.6's
   * degenerate state and §9.3's post-AEAD failure, both of which end the close.
   */
  type CloseTransmitOutcome = "transmitted" | "refused" | "ended";

  async function transmitCloseRecord(
    session: E2eeRecordSession,
    machine: E2eeCloseMachine,
    toSend: E2eeCloseRecordToSend,
  ): Promise<CloseTransmitOutcome> {
    const outcome = await protectRecord(session, toSend.innerType, toSend.body);
    if (outcome.kind === "refused") return "refused";
    if (outcome.kind !== "protected") {
      // §9.6's degenerate state and §9.3's post-AEAD failure alike: no further
      // close-machine record follows, the close is **Unclean — abrupt**, and no
      // wire record is emitted for it (§10.4).
      endDegenerate(session, machine);
      return "ended";
    }
    machine.noteTransmitted({
      record: toSend,
      epoch: outcome.epoch,
      counter: outcome.counter,
      epochCompleted: outcome.epochCompleted,
      at: now(),
    });
    return "transmitted";
  }

  /** Send whatever §10.2 currently obliges this endpoint to send, then wait or finish. */
  async function drainPendingCloseRecord(
    session: E2eeRecordSession,
    machine: E2eeCloseMachine,
  ): Promise<void> {
    while (machine.pendingRecord !== undefined) {
      // An ack answering the peer's `E2EEClose` MUST declare the expected-next
      // AS OF processing that close (§10.1.1); the final confirmation declares
      // the current one, and the machine reports which by leaving
      // `ackExpectedRecv` undefined.
      const declaration = machine.ackExpectedRecv ?? expectedRecv(session);
      const position = sendPosition(session);
      if (declaration === undefined || position === undefined) {
        endDegenerate(session, machine);
        return;
      }
      const toSend = machine.buildCloseAck({
        sendPosition: position,
        expectedRecv: declaration,
      });
      const outcome = await transmitCloseRecord(session, machine, toSend);
      // Backpressure leaves the record owed and the channel untouched (§11.4).
      // Re-running the loop would spin on a queue that is still full, so the
      // obligation is left standing and the wait — this endpoint's own if one is
      // armed, the peer's otherwise — is what ends the phase.
      if (outcome === "refused") break;
      if (outcome === "ended") return;
    }
    if (machine.exchangeComplete) finishClose(session, machine);
    else armCloseWait(session, machine);
  }

  async function beginClose(): Promise<void> {
    const session = record;
    const machine = closeMachine;
    if (mode !== "e2ee" || session === undefined || machine === undefined) return;
    if (machine.closePhaseActive) return;
    const position = sendPosition(session);
    const declaration = expectedRecv(session);
    if (position === undefined || declaration === undefined) {
      endDegenerate(session, machine);
      return;
    }
    const settled = new Promise<void>((resolve) => {
      closeSettled = resolve;
    });
    const toSend = machine.buildClose({
      sendPosition: position,
      expectedRecv: declaration,
    });
    const outcome = await transmitCloseRecord(session, machine, toSend);
    if (outcome === "refused") {
      // §11.4: no `E2EEClose` reached the relay, no pair was consumed, and the
      // close phase never opened — so there is nothing to wait for and nothing
      // to record. The channel is unaffected and a later attempt may still
      // close it cleanly, which is exactly what §9.6's reserve keeps possible.
      //
      // `closeSettled` is deliberately left as it stands rather than cleared:
      // the next attempt replaces it, and a terminal path calling a resolver
      // whose promise nobody awaits is a no-op — while clearing a field a
      // concurrent attempt may already own would strand that attempt.
      return;
    }
    if (outcome === "transmitted") armCloseWait(session, machine);
    await settled;
  }

  /**
   * Dispatch one AUTHENTICATED inner record (§4.3 step 3).
   *
   * Even an RPC record goes through the close machine, because §10.2 permits
   * authentic RPC only while the peer has not itself protected a close-machine
   * record; past that point the same record is Q7.
   */
  async function dispatch(
    session: E2eeRecordSession,
    innerType: E2eeInnerRecordType,
    body: Uint8Array,
    envelope: {
      readonly epoch: bigint;
      readonly counter: bigint;
      readonly epochCompleted: boolean;
      readonly at: number;
    },
  ): Promise<NodeE2eeInboundDisposition> {
    const machine = closeMachine;
    if (machine === undefined) return fatalPostKey("Q10", E2EE_ERROR_CODE_INTERNAL);
    const currentNextSend = sendPosition(session);
    if (currentNextSend === undefined) {
      // §9.6's degenerate state, reached on the RECEIVE path: this endpoint's
      // send direction spent its last position on a close-machine record, so
      // §10.1's passed-through rule has no current next-send to be evaluated
      // against and no further record can be protected in answer. §9.6 fixes the
      // outcome — **Unclean — abrupt**, no wire record — and nothing beyond it
      // is delivered to the application.
      endDegenerate(session, machine);
      return CLAIMED;
    }
    const outcome = machine.receive({
      innerType,
      body,
      envelope: { epoch: envelope.epoch, counter: envelope.counter },
      epochCompleted: envelope.epochCompleted,
      currentNextSend,
      at: envelope.at,
    });
    switch (outcome.kind) {
      case "application":
        return { kind: "rpc", message: body };
      case "close":
      case "close_ack":
        await drainPendingCloseRecord(session, machine);
        return CLAIMED;
      case "terminal_error":
        // §11.3: a received `E2EEError` is terminal — the receiver erases
        // secrets and closes, and MUST NOT reply. Verdict **Failed** (§10.4).
        if (mode !== "closed") {
          mode = "closed";
          releaseChannel();
          diagnostic({ phase: "post_key", row: "Q7", verdict: machine.verdict });
          sources.close(FATAL_CLOSE_REASON);
        }
        return REJECTED;
      case "fatal":
        return fatalPostKey(outcome.row, E2EE_ERROR_CODE_PROTOCOL_VIOLATION);
    }
  }

  // ─── the public surface ────────────────────────────────────────────────────

  async function intercept(payload: Uint8Array): Promise<NodeE2eeInboundDisposition> {
    if (mode === "closed") return REJECTED;
    // §4.3 step 2: discrimination happens HERE, on the reassembled and
    // prelude-stripped payload, and never on raw wire bytes.
    const klass = classifyPostStripPayload(payload);
    switch (mode) {
      case "negotiating":
        return negotiating(payload, klass);
      case "legacy":
        return legacy(payload, klass);
      case "e2ee":
        return established(payload, klass);
    }
  }

  async function emit(bytes: Uint8Array): Promise<boolean> {
    if (mode === "legacy") return sources.send(bytes, { onRefused: "report" }).accepted;
    if (mode !== "e2ee") return false;
    const session = record;
    const machine = closeMachine;
    if (session === undefined || machine === undefined) return false;
    // §8.9: no node-to-client application RPC before the implicit finish
    // authenticates. §10.2: none after this endpoint's first close-machine
    // record either — the keepalive `Ping` included, which is why the gate is
    // the machine's own and not a check for the close inner types.
    if (!implicitFinishAuthenticated || !machine.mayProtectApplicationRecord) return false;
    const outcome = await protectRecord(session, E2EE_INNER_TYPE_RPC, bytes);
    if (outcome.kind === "protected") return true;
    if (outcome.kind === "close_required") {
      // §9.6: protecting this record would leave less than the post-application
      // reserve. Nothing was consumed, and the endpoint MUST initiate §10's
      // close no later than this point rather than protect it.
      void beginClose();
      return false;
    }
    if (outcome.kind === "unusable") {
      // §11.3 Q10: no byte reached the relay, so no `E2EEError` may follow — it
      // would itself create the sequence gap being avoided.
      if (!closed()) {
        mode = "closed";
        const verdict = machine.noteFatal();
        releaseChannel();
        diagnostic({ phase: "post_key", row: "Q10", verdict });
        sources.close(FATAL_CLOSE_REASON);
      }
      return false;
    }
    // `refused` is §11.4 sender-local — `e2ee_message_too_large` or
    // `e2ee_send_unavailable`: no pair consumed, no wire record, channel
    // unaffected. Ordinary backpressure MUST NOT be escalated to channel-fatal.
    // `unavailable` is the send path declining this record in this state, or an
    // ambiguous delivery §9.3 leaves unattributed; neither is a condition this
    // sender may resolve by closing the channel, so both refuse the message and
    // leave the channel exactly as they found it.
    return false;
  }

  return {
    mode: () => mode,
    announce,
    intercept,
    emit,
    beginClose,
    dispose: (options = {}) => {
      // §10.4's channel-ended input reaches the machine whatever this session's
      // mode is, and that is the point rather than an oversight. A partial
      // reassembly when the channel ends "**is** truncation, regardless of any
      // other state", and §10.4 requires a higher-precedence condition arising
      // AFTER a verdict was recorded to supersede it — so the one input that can
      // supersede a **Clean** is the one a mode check would drop, in exactly the
      // case it exists for: a completed exchange (verdict recorded, session
      // closed), then chunks of a further message the peer never finished, then
      // the channel ending.
      //
      // The precedence rule is the machine's own and is not restated here: it
      // keeps **Failed**, it lets truncation displace **Clean**, and an abrupt
      // end never displaces either. A second copy of that ordering on this side
      // would be a second thing to disagree with §10.4.
      closeMachine?.noteChannelEnded({
        at: now(),
        ...(options.incompleteReassembly === undefined
          ? {}
          : { incompleteReassembly: options.incompleteReassembly }),
      });
      mode = "closed";
      releaseChannel();
    },
    verdict: () => closeMachine?.verdict,
  };
}
