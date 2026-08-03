import { e2eeChannelSizeBudget } from "@ryco/shared/relayE2eeConstants";
import {
  E2EE_ERROR_CODE_PROTOCOL_VIOLATION,
  E2eeCloseMachine,
  encodeE2eeErrorRecordBody,
  type E2eeCloseRecordToSend,
  type E2eeCloseVerdict,
  type E2eeErrorCode,
  type E2eeSequencePosition,
} from "@ryco/shared/relayE2eeClose";
import {
  E2eeRecordSession,
  type E2eeProtectResult,
  type E2eeReceiveFatalReason,
  type E2eeSessionSecrets,
  type E2eeSyntheticDirectionState,
} from "@ryco/shared/relayE2eeSession";
import {
  classifyPostStripPayload,
  E2EE_INNER_TYPE_ERROR,
  E2EE_INNER_TYPE_RPC,
  type E2eeDirection,
  type E2eeInnerRecordType,
  type E2eeSuiteId,
} from "@ryco/shared/relayE2eeWire";

import {
  relayE2eeFailure,
  type RelayE2eeChannel,
  type RelayE2eeCloseAttempt,
  type RelayE2eeFailureKind,
  type RelayE2eeHost,
  type RelayE2eeInboundDisposition,
  type RelayE2eeReservation,
} from "./relayEngine.ts";

// The client half of the relay E2EE layer, on the real relay path —
// docs/relay-e2ee-protocol.md §4.2 (send pipeline), §4.3 (discrimination and
// receive order), §4.5 (the plaintext ceiling), §9 (record protection), §10
// (the authenticated close), and §11 (the error mapping).
//
// IT IS THE STRUCTURAL MIRROR of the node's `NodeE2eeChannelSession`, down to
// the shape of the protect wrapper and the close drive loop, and divergence
// between the two is a defect rather than a style: the two endpoints implement
// the same normative machine from opposite directions, and a difference that is
// not forced by the direction is a difference in behavior nobody asked for.
//
// WHAT THIS OWNS: one channel's `E2eeRecordSession` and `E2eeCloseMachine`, the
// §9.3 admission wiring, and the mapping of every fatal condition onto §11's
// observable. It builds no envelope, derives no key, and decides no verdict —
// each of those belongs to a module below it.
//
// AND THE ORDERING RULE THE PROTOCOL SINGLES OUT: §9.3 requires transmission
// admission for the WHOLE record — every chunk of it — before the
// `(epoch, counter)` pair is assigned. `E2eeRecordSession.protect` takes an
// `admit` callback for exactly that, and `protectRecord` below wires the relay
// engine's reservation into it. A refused admission consumes no pair, encrypts
// nothing, and puts no byte on the wire; an implementation that encrypted first
// and rolled the counter back on refusal would reuse that nonce with different
// plaintext, which is an AEAD failure and not a backpressure bug.

/** §3.4: the client sends `c2n` and receives `n2c`. */
const CLIENT_SEND_DIRECTION: E2eeDirection = "c2n";

const REJECTED: RelayE2eeInboundDisposition = Object.freeze({ kind: "rejected" } as const);
const CLAIMED: RelayE2eeInboundDisposition = Object.freeze({ kind: "claimed" } as const);

/**
 * Every §9 receive failure, mapped onto its §11.3 row for the client-local
 * diagnostic.
 *
 * Exported because it is a normative enumeration rather than an implementation
 * detail: §11.3's table is the definition site, §16.2 requires every expected
 * failure to name a row of it, and a mapping that only ever appears inside a
 * closure is one no conformance test can hold to the table.
 */
export const CLIENT_E2EE_RECEIVE_FATAL_ROWS: Readonly<Record<E2eeReceiveFatalReason, string>> = {
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
  // — which is what this module emits for every row of this table.
  receive_terminated: "Q2",
};

/**
 * A client-local diagnostic for one channel-fatal condition (§11.4).
 *
 * It carries the §11 row this client enumerated and the §10.4 verdict it
 * recorded, and never a byte of the payload, a key, a fingerprint, or a
 * transcript value. §11.2's anti-oracle rule governs the WIRE; this is the
 * operator's side of the same event and MUST NOT alter it.
 */
export interface RelayE2eeChannelDiagnostic {
  readonly phase: "post_key";
  /** A §11.3 row, or `local` for a failure §11.3's table does not enumerate. */
  readonly row: string;
  readonly verdict?: E2eeCloseVerdict | undefined;
}

export interface RelayE2eeChannelSources {
  /** The engine seam: negotiated limits, admission, the assembler, the close. */
  readonly host: RelayE2eeHost;
  /** §6.5 secrets; OWNERSHIP TRANSFERS to the channel, which erases them (§9.5). */
  readonly secrets: E2eeSessionSecrets;
  /** The established suite (§3.4). Every envelope's `suite` must equal it (§9.1). */
  readonly suite: E2eeSuiteId;
  /** §8.8 `sessionBindingHash`; it enters the AAD of every envelope (§3.3). */
  readonly sessionBindingHash: Uint8Array;
  readonly onDiagnostic?: (diagnostic: RelayE2eeChannelDiagnostic) => void;
  /**
   * TEST AND FIXTURE USE ONLY (§16.3 F9), forwarded verbatim to the record
   * session's own synthetic start positions.
   *
   * It exists because §9.6's degenerate state — a direction that has spent its
   * last position — and the §9.4 threshold boundaries are otherwise unreachable
   * in finite time, and an unreachable state is one no test can hold this
   * module's behavior to. Production callers MUST omit it; the record session
   * validates every field and refuses anything outside the §9.2 ranges.
   */
  readonly testOnlySyntheticSendState?: E2eeSyntheticDirectionState | undefined;
  /** TEST AND FIXTURE USE ONLY (§16.3 F9). See `testOnlySyntheticSendState`. */
  readonly testOnlySyntheticReceiveState?: E2eeSyntheticDirectionState | undefined;
}

export interface RelayE2eeClientChannel extends RelayE2eeChannel {
  /** §10.4, for the client-local diagnostic and for tests. */
  readonly verdict: () => E2eeCloseVerdict | undefined;
  /** §9.2/§9.3 positions, for the client-local diagnostic and for tests. */
  readonly sendPosition: () => E2eeSequencePosition | undefined;
  readonly expectedRecv: () => E2eeSequencePosition | undefined;
}

/**
 * One established E2EE channel on the client side.
 *
 * The channel exists only for a session that is already established: §4.4 has
 * no mid-channel upgrade, so a handshake driver builds this once and the
 * channel is destroyed with the relay channel (§6.5).
 *
 * IT TAKES OWNERSHIP of `secrets`. Construction has exactly two outcomes — a
 * channel that owns them, or a throw that has already erased them, because
 * `E2eeRecordSession` is the first thing built and it erases on any failure.
 * §4.5's non-positive ceiling is one of those throws, which is what makes the
 * channel fail during establishment rather than carry a shrunk ceiling.
 */
export function makeRelayE2eeClientChannel(
  sources: RelayE2eeChannelSources,
): RelayE2eeClientChannel {
  const host = sources.host;
  const now = (): number => host.now();
  const diagnostic = sources.onDiagnostic ?? ((): void => undefined);

  // §4.5: derived from this endpoint's own `ready` limits through the ONE
  // derivation `e2eeChannelSizeBudget` owns, never a second arithmetic here. A
  // budget §4.5 declares unestablishable yields 0, which the record session
  // refuses — so the channel fails during establishment, before it is released
  // to the application, rather than shrinking silently.
  const budget = e2eeChannelSizeBudget(host.limits);
  const session = new E2eeRecordSession({
    secrets: sources.secrets,
    suite: sources.suite,
    sessionBindingHash: sources.sessionBindingHash,
    sendDirection: CLIENT_SEND_DIRECTION,
    plaintextCeiling: budget.establishable ? budget.plaintextCeiling : 0,
    ...(sources.testOnlySyntheticSendState === undefined
      ? {}
      : { testOnlySyntheticSendState: sources.testOnlySyntheticSendState }),
    ...(sources.testOnlySyntheticReceiveState === undefined
      ? {}
      : { testOnlySyntheticReceiveState: sources.testOnlySyntheticReceiveState }),
  });
  const machine = new E2eeCloseMachine({
    sessionBindingHash: sources.sessionBindingHash,
    sendDirection: CLIENT_SEND_DIRECTION,
  });

  let closed = false;
  let closeTimer: unknown;
  let closeSettled: (() => void) | undefined;
  let closePhaseFinished = false;

  /**
   * §9.5 on every terminal path.
   *
   * Idempotent, because several of the paths that reach it can run twice — a
   * `T_CLOSE` expiry racing the peer's proof, the engine disposing a channel
   * that has already failed.
   */
  function release(): void {
    session.erase();
    if (closeTimer !== undefined) host.clearTimeout(closeTimer);
    closeTimer = undefined;
    closeSettled?.();
    closeSettled = undefined;
    closePhaseFinished = true;
  }

  // ─── §9.3: admission, then the pair, then the AEAD ─────────────────────────

  /**
   * The channel's SEND CRITICAL SECTION, which every `protect` this channel
   * issues runs inside.
   *
   * It is not a second copy of `E2eeRecordSession`'s own send serialization —
   * that one already makes the pair assignment, the AEAD, and the state advance
   * atomic. It is the rule one level up: a close-machine record's BODY and the
   * pair it is protected at are chosen TOGETHER. §10.1 fields 0–1 MUST byte-equal
   * the carrying envelope's header, and the pair `protect` assigns is knowable
   * only inside its own serialization — so a position read outside it is a
   * position another send may take first, and the record declaring it is already
   * sealed onto the relay by the time `noteTransmitted` can object. The peer then
   * rejects a conforming endpoint's close as §11.3 Q7.
   */
  let sendCritical: Promise<unknown> = Promise.resolve();
  function serializeSend<T>(run: () => Promise<T>): Promise<T> {
    const result = sendCritical.then(run, run);
    sendCritical = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

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
   * consults the engine's reservation and the capacity it returns is what
   * `transmit` spends. A refusal returns `false`, which
   * `E2eeRecordSession.protect` reports as the sender-local
   * `e2ee_send_unavailable` having consumed no pair, encrypted nothing, and
   * produced no wire record at all.
   *
   * The reservation is released in a `finally` because `protect` has two paths
   * that admit and then decline to transmit — an erasure racing the admission,
   * and a local AEAD or encoder failure — and an unspent reservation would
   * otherwise hold relay capacity until the channel closed.
   *
   * CALLERS MUST BE INSIDE `serializeSend`: every position this channel reads
   * for a record body is read in the same section as the assignment.
   */
  async function protectRecord(
    innerType: E2eeInnerRecordType,
    body: Uint8Array,
  ): Promise<ProtectOutcome> {
    // §9.5: the section this send waited for may have erased the session. The
    // record session asserts on an erased session before its own funnel can
    // answer, and this is that answer — the send path declines the record and
    // the caller leaves the channel exactly as it found it.
    if (session.erased) return { kind: "unavailable" };
    let admission: RelayE2eeReservation | undefined;
    let result: E2eeProtectResult;
    try {
      result = await session.protect({
        innerType,
        body,
        admit: (envelopeBytes) => {
          admission = host.admit(envelopeBytes);
          return admission !== undefined;
        },
        transmit: (envelope) => {
          const held = admission;
          admission = undefined;
          // The reservation covers every payload of this record, so the send
          // path is all-or-nothing: a refusal means no byte of it reached the
          // relay — §9.3's `none` branch, under which no further record may be
          // protected and no `E2EEError` may follow, because that record would
          // itself create the sequence gap being avoided.
          return held !== undefined && held.send(envelope)
            ? { kind: "sent" }
            : { kind: "failed", delivery: "none" };
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
  ): Promise<RelayE2eeInboundDisposition> {
    if (closed) return REJECTED;
    closed = true;
    const verdict = machine.noteFatal();
    await serializeSend(async () => {
      // §11.5's "none when the send path is unusable", and §10.2's carve-out of
      // exactly one terminal record. Both are read INSIDE the section, because
      // both are properties of the send state at the moment the record would be
      // protected and a send admitted ahead of this one can change either.
      if (!session.sendPathUsable || !machine.mayProtectTerminalError) return;
      const result = await protectRecord(
        E2EE_INNER_TYPE_ERROR,
        encodeE2eeErrorRecordBody(errorCode),
      );
      if (result.kind === "protected") machine.noteTerminalErrorTransmitted();
    });
    release();
    diagnostic({ phase: "post_key", row, verdict });
    host.close(relayE2eeFailure("fatal_post_key"));
    return REJECTED;
  }

  /**
   * §11.3 Q10: a local failure, on a path that has no caller to report it to.
   *
   * No `E2EEError` follows and none may: the condition IS this endpoint's send
   * path, and a record protected out of it would create the very sequence gap
   * being avoided. Verdict **Failed** (§10.4), secrets erased (§9.5), and §11.1's
   * non-retryable close.
   */
  function failLocal(kind: RelayE2eeFailureKind): void {
    if (closed) return;
    closed = true;
    const verdict = machine.noteFatal();
    release();
    diagnostic({ phase: "post_key", row: "Q10", verdict });
    host.close(relayE2eeFailure(kind));
  }

  // ─── §10: the authenticated close ──────────────────────────────────────────

  /**
   * The §9.2 next-send position, or `undefined` when the direction has spent its
   * last one (§9.6).
   *
   * `undefined` rather than a throw, because every caller below is on a path that
   * §9.6 gives a defined outcome — "protects as many close-machine records as
   * remaining capacity allows ... and records the close as **Unclean — abrupt**"
   * — and none of them is inside a `try`.
   */
  function sendPosition(): E2eeSequencePosition | undefined {
    const state = session.sendState;
    if (state.epoch === undefined || state.counter === undefined) return undefined;
    return { epoch: state.epoch, counter: state.counter };
  }

  /** The §9.2 expected-next receive position, or `undefined` per §9.6, as above. */
  function expectedRecv(): E2eeSequencePosition | undefined {
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
  function endDegenerate(): void {
    machine.noteChannelEnded({ at: now() });
    finishClose();
  }

  /**
   * §10.2: mirror the machine's current `T_CLOSE`-bounded wait onto the host's
   * timers. The machine counts the waits — at most one on either sequential
   * path and two on the simultaneous one, never three — and nothing here
   * restarts or extends one.
   */
  function armCloseWait(): void {
    if (closeTimer !== undefined) host.clearTimeout(closeTimer);
    closeTimer = undefined;
    const deadline = machine.waitDeadlineAt;
    if (deadline === undefined) return;
    closeTimer = host.setTimeout(
      () => {
        closeTimer = undefined;
        if (closed || !machine.waitExpired(now())) return;
        // §10.2, §10.4: the wait expired. Unclean — abrupt, unattributed, and no
        // wire record of any kind is emitted for it.
        machine.noteWaitExpired(now());
        finishClose();
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
  function finishClose(): void {
    if (closePhaseFinished) return;
    if (!machine.outerCloseAllowed(now())) return;
    closePhaseFinished = true;
    if (closeTimer !== undefined) host.clearTimeout(closeTimer);
    closeTimer = undefined;
    const emitOuterClose = (): void => {
      if (closed) return;
      closed = true;
      release();
      host.close();
    };
    if (machine.shouldLinger(now())) {
      const lingerFor = Math.max(1, (machine.lingerDeadlineAt ?? now()) - now());
      closeTimer = host.setTimeout(() => {
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
   * `none` is the obligation having changed inside the section — a peer record
   * authenticated while this attempt waited — and nothing was built for it.
   */
  type CloseTransmitOutcome = "transmitted" | "refused" | "ended" | "none";

  /**
   * What the §10 driver decided for one attempt, INSIDE the send critical
   * section and against the position that attempt will actually be protected at.
   */
  type CloseRecordPlan =
    | { readonly kind: "send"; readonly record: E2eeCloseRecordToSend }
    /** §9.6: no position left to declare, so no conforming record exists. */
    | { readonly kind: "degenerate" }
    /** The obligation changed while this attempt waited for the section. */
    | { readonly kind: "none" };

  /**
   * Build one close-machine record and transmit it, with the §9.2 position read,
   * the §10.1 body built from it, the AEAD, and the machine's commit all inside
   * one send critical section — see `serializeSend` for why that is the rule
   * rather than an optimization.
   */
  async function transmitCloseRecord(
    plan: (position: E2eeSequencePosition | undefined) => CloseRecordPlan,
  ): Promise<CloseTransmitOutcome> {
    return serializeSend(async () => {
      const planned = plan(sendPosition());
      if (planned.kind === "none") return "none";
      if (planned.kind === "degenerate") {
        endDegenerate();
        return "ended";
      }
      const toSend = planned.record;
      const outcome = await protectRecord(toSend.innerType, toSend.body);
      if (outcome.kind === "refused") return "refused";
      if (outcome.kind !== "protected") {
        // §9.6's degenerate state and §9.3's post-AEAD failure alike: no further
        // close-machine record follows, the close is **Unclean — abrupt**, and
        // no wire record is emitted for it (§10.4).
        endDegenerate();
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
    });
  }

  /** Send whatever §10.2 currently obliges this endpoint to send, then wait or finish. */
  async function drainPendingCloseRecord(): Promise<void> {
    while (machine.pendingRecord !== undefined) {
      const outcome = await transmitCloseRecord((position) => {
        if (closed || machine.pendingRecord === undefined) return { kind: "none" };
        // An ack answering the peer's `E2EEClose` MUST declare the expected-next
        // AS OF processing that close (§10.1.1); the final confirmation declares
        // the current one, and the machine reports which by leaving
        // `ackExpectedRecv` undefined.
        const declaration = machine.ackExpectedRecv ?? expectedRecv();
        if (declaration === undefined || position === undefined) return { kind: "degenerate" };
        return {
          kind: "send",
          record: machine.buildCloseAck({ sendPosition: position, expectedRecv: declaration }),
        };
      });
      // Backpressure leaves the record owed and the channel untouched (§11.4).
      // Re-running the loop would spin on a queue that is still full, so the
      // obligation is left standing and the wait — this endpoint's own if one is
      // armed, the peer's otherwise — is what ends the phase.
      if (outcome === "refused" || outcome === "none") break;
      if (outcome === "ended") return;
    }
    if (closed) return;
    if (machine.exchangeComplete) finishClose();
    else armCloseWait();
  }

  async function beginClose(): Promise<RelayE2eeCloseAttempt> {
    if (closed || machine.closePhaseActive) return "opened";
    const settled = new Promise<void>((resolve) => {
      closeSettled = resolve;
    });
    const outcome = await transmitCloseRecord((position) => {
      // Re-read inside the section: the peer's own `E2EEClose` may have been
      // authenticated while this attempt waited for it, and this endpoint is
      // then the responder of §10.2 step 2 and owes an ack rather than a close.
      if (closed || machine.closePhaseActive) return { kind: "none" };
      const declaration = expectedRecv();
      if (position === undefined || declaration === undefined) return { kind: "degenerate" };
      return {
        kind: "send",
        record: machine.buildClose({ sendPosition: position, expectedRecv: declaration }),
      };
    });
    if (outcome === "refused") {
      // §11.4: no `E2EEClose` reached the relay, no pair was consumed, and the
      // close phase never opened — so there is nothing to wait for, nothing to
      // record, and nothing bounding this channel. The caller is TOLD, because
      // the channel is unaffected and a later attempt may still close it
      // cleanly, which is exactly what §9.6's reserve keeps possible.
      //
      // `closeSettled` is deliberately left as it stands rather than cleared:
      // the next attempt replaces it, and a terminal path calling a resolver
      // whose promise nobody awaits is a no-op — while clearing a field a
      // concurrent attempt may already own would strand that attempt.
      return "refused";
    }
    if (outcome === "transmitted") armCloseWait();
    // A degenerate end, or a phase another attempt already finished, has already
    // released every waiter; awaiting a resolver nobody will call again would
    // strand this one.
    if (closePhaseFinished) return "opened";
    await settled;
    return "opened";
  }

  /**
   * Dispatch one AUTHENTICATED inner record (§4.3 step 3).
   *
   * Even an RPC record goes through the close machine, because §10.2 permits
   * authentic RPC only while the peer has not itself protected a close-machine
   * record; past that point the same record is Q7.
   */
  async function dispatch(
    innerType: E2eeInnerRecordType,
    body: Uint8Array,
    envelope: {
      readonly epoch: bigint;
      readonly counter: bigint;
      readonly epochCompleted: boolean;
      readonly at: number;
    },
  ): Promise<RelayE2eeInboundDisposition> {
    const currentNextSend = sendPosition();
    if (currentNextSend === undefined) {
      // §9.6's degenerate state, reached on the RECEIVE path: this endpoint's
      // send direction spent its last position on a close-machine record, so
      // §10.1's passed-through rule has no current next-send to be evaluated
      // against and no further record can be protected in answer. §9.6 fixes the
      // outcome — **Unclean — abrupt**, no wire record — and nothing beyond it
      // is delivered to the application.
      endDegenerate();
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
        await drainPendingCloseRecord();
        return CLAIMED;
      case "terminal_error":
        // §11.3: a received `E2EEError` is terminal — the receiver erases
        // secrets and closes, and MUST NOT reply. Verdict **Failed** (§10.4).
        if (!closed) {
          closed = true;
          release();
          diagnostic({ phase: "post_key", row: "Q7", verdict: machine.verdict });
          host.close(relayE2eeFailure("fatal_post_key"));
        }
        return REJECTED;
      case "fatal":
        return fatalPostKey(outcome.row, E2EE_ERROR_CODE_PROTOCOL_VIOLATION);
    }
  }

  // ─── the public surface ────────────────────────────────────────────────────

  async function intercept(payload: Uint8Array): Promise<RelayE2eeInboundDisposition> {
    if (closed) return REJECTED;
    // §4.3 step 2: discrimination happens HERE, on the reassembled and
    // prelude-stripped payload, and never on raw wire bytes. Row K18 / §11.3
    // Q6: a negotiation record, legacy JSON, or an unknown or absent first byte
    // in `e2ee`. Plaintext after E2EE never reaches the RPC parser, and a close
    // phase in progress grants no exemption (§10.2).
    if (classifyPostStripPayload(payload).kind !== "envelope") {
      return fatalPostKey("Q6", E2EE_ERROR_CODE_PROTOCOL_VIOLATION);
    }
    const result = session.unprotect(payload);
    if (result.kind === "fatal") {
      // §11.3 Q1–Q5: every one of them a protocol violation detected on peer
      // input, and none of them attributable (§9.7).
      return fatalPostKey(
        CLIENT_E2EE_RECEIVE_FATAL_ROWS[result.reason],
        E2EE_ERROR_CODE_PROTOCOL_VIOLATION,
      );
    }
    return dispatch(result.innerType, result.body, {
      epoch: result.epoch,
      counter: result.counter,
      epochCompleted: result.epochCompleted,
      at: now(),
    });
  }

  async function emit(message: Uint8Array): Promise<boolean> {
    if (closed) return false;
    // §10.2: no application RPC record after this endpoint's first
    // close-machine record — the keepalive `Ping` included, which is why the
    // gate is the machine's own and not a check for the close inner types. A
    // `Ping` the close phase stalls is DISCARDED, not buffered.
    if (!machine.mayProtectApplicationRecord) return false;
    const outcome = await serializeSend(() => protectRecord(E2EE_INNER_TYPE_RPC, message));
    if (outcome.kind === "protected") return true;
    if (outcome.kind === "close_required") {
      // §9.6: protecting this record would leave less than the post-application
      // reserve. Nothing was consumed, and the endpoint MUST initiate §10's
      // close no later than this point rather than protect it. The close is
      // driven rather than awaited — this caller is owed only its `false` — so
      // a throw escaping it has no caller to reach and takes the fail-closed
      // teardown every other local defect takes.
      void beginClose().catch(() => failLocal("fatal_post_key"));
      return false;
    }
    if (outcome.kind === "unusable") {
      // §11.3 Q10: no byte reached the relay, so no `E2EEError` may follow — it
      // would itself create the sequence gap being avoided.
      failLocal("send_path_unusable");
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
    intercept,
    emit,
    beginClose,
    dispose: (options = {}) => {
      // §10.4's channel-ended input reaches the machine whatever this channel's
      // state is, and that is the point rather than an oversight. A partial
      // reassembly when the channel ends "**is** truncation, regardless of any
      // other state", and §10.4 requires a higher-precedence condition arising
      // AFTER a verdict was recorded to supersede it — so the one input that can
      // supersede a **Clean** is the one a state check would drop, in exactly
      // the case it exists for: a completed exchange (verdict recorded, channel
      // closed), then chunks of a further message the peer never finished, then
      // the channel ending.
      //
      // The precedence rule is the machine's own and is not restated here: it
      // keeps **Failed**, it lets truncation displace **Clean**, and an abrupt
      // end never displaces either. A second copy of that ordering on this side
      // would be a second thing to disagree with §10.4.
      machine.noteChannelEnded({
        at: now(),
        ...(options.incompleteReassembly === undefined
          ? {}
          : { incompleteReassembly: options.incompleteReassembly }),
      });
      closed = true;
      release();
    },
    verdict: () => machine.verdict,
    sendPosition,
    expectedRecv,
  };
}
