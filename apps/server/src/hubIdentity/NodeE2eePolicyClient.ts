import type { E2eeNoisePattern } from "@ryco/shared/relayE2eeTranscripts";
import type { E2eeSuiteId } from "@ryco/shared/relayE2eeWire";

import {
  e2eePolicyNarrows,
  e2eePolicyRefusesInFlightHandshake,
  e2eeWithdrawnChannelClass,
  effectiveNodeE2eePolicy,
  NODE_E2EE_FAIL_CLOSED_POLICY,
  NodeE2eePolicyStoreError,
  resolveNodeE2eePolicyProposal,
  sameNodeE2eeAdmissionPolicy,
  type E2eeChannelPhase,
  type E2eeChannelPolicyState,
  type E2eeWithdrawnChannelClass,
  type EffectiveNodeE2eePolicy,
  type NodeE2eePolicyProposal,
  type NodeE2eePolicyStore,
} from "./NodeE2eePolicyStore.ts";

// The §12.6 policy-withdrawal procedure and the live-channel state it runs over
// — docs/relay-e2ee-protocol.md §12.6 (the ordered procedure and the
// one-snapshot rule), §12.4 (the restart rule and the fail-closed recovery
// reading), and §5.7 (the generation the procedure spends).
//
// WHAT THIS OWNS: the in-memory registration of every channel the node is
// carrying, the single consistent snapshot §12.6(b) enumerates, and the ordering
// (a) → (b) → (c). The durable record and the generation belong to
// `NodeE2eePolicyStore`; the per-channel test and the effective-policy rule are
// its exports and are applied, never restated, here.
//
// ─── WHY THE CHANNELS ARE REGISTERED HERE AND NOT WALKED IN THE REGISTRY ────
//
// §12.6(b) requires the live-channel set and the §15 in-flight handshake list to
// be walked as ONE consistent snapshot, with each channel dispatched exactly
// once by the mode it holds IN that snapshot, and says why: two sequential
// passes let a channel cross row N3 between them and be missed by both, leaving
// an established channel the new policy refuses open behind an acknowledgement
// that says none is.
//
// The construction that makes that structurally impossible is one registration
// per channel that carries its own phase, rather than two collections a channel
// moves between. A channel is on both "lists" at once because it IS one object;
// `Array.from` over the registration set is therefore already the single
// consistent snapshot, and the dispatch reads the phase the snapshot froze. No
// ordering between the two enumerations exists to get wrong, because there are
// not two enumerations.
//
// This mirrors `NodeClientAuthorizationClient`, which registers §13.6's channels
// the same way and for the same reason — the two sweeps are disjoint and §12.6
// requires an implementation to run BOTH, so they deliberately do not share a
// registry: a channel withdrawn by one test and not the other must be closed
// exactly once by the test that names it, and merging the registries would make
// that a matter of which sweep ran first.

export type NodeE2eePolicyErrorCode =
  /** At least one close or abort in step (b) failed; the change is NOT acknowledgeable. */
  | "policy_sweep_failed"
  /** The durable policy could not be read; §12.4 requires the fail-closed reading. */
  | "policy_unreadable";

export class NodeE2eePolicyError extends Error {
  readonly code: NodeE2eePolicyErrorCode;

  constructor(code: NodeE2eePolicyErrorCode) {
    super("Node E2EE policy operation failed.");
    this.name = "NodeE2eePolicyError";
    this.code = code;
  }
}

/** §12.6(c): the counts the acknowledgement MUST report, broken out by class. */
export interface NodeE2eePolicyWithdrawalCounts {
  readonly legacy: number;
  readonly nxE2ee: number;
  readonly suiteWithdrawn: number;
  readonly abortedHandshakes: number;
}

const NO_COUNTS: NodeE2eePolicyWithdrawalCounts = {
  legacy: 0,
  nxE2ee: 0,
  suiteWithdrawn: 0,
  abortedHandshakes: 0,
};

export interface NodeE2eePolicyChangeResult {
  readonly policy: EffectiveNodeE2eePolicy;
  /** The §5.7 generation now in force. Unchanged when `changed` is false. */
  readonly generation: number;
  /** True when §12.6's test found a reduction in THIS transition. */
  readonly withdrawal: boolean;
  /** False when the proposal changed nothing at all. */
  readonly changed: boolean;
  /**
   * What step (b) actually terminated, which is what §12.6(c) acknowledges.
   *
   * These are the authoritative numbers, not `withdrawal`: a retry of a
   * withdrawal whose sweep failed arrives with `changed` and `withdrawal` false
   * — the narrowing is already durable — and still closes the channels the
   * first attempt could not.
   */
  readonly counts: NodeE2eePolicyWithdrawalCounts;
}

/** §12.6's display duty: what a change WOULD do, for the warning before it runs. */
export interface NodeE2eePolicyPreview {
  readonly policy: EffectiveNodeE2eePolicy;
  readonly withdrawal: boolean;
  readonly changed: boolean;
  /** Approximate by nature: channels open and close while the operator reads it. */
  readonly counts: NodeE2eePolicyWithdrawalCounts;
}

/**
 * Row N3's admission verdict.
 *
 * A handshake that completes while a withdrawal is committing is refused here
 * rather than established and immediately swept, which keeps the acknowledgement
 * true without depending on the sweep having reached it.
 */
export type NodeE2eeChannelAdmission =
  | { readonly kind: "entered" }
  | { readonly kind: "refused"; readonly reason: "policy_withdrawn" };

/**
 * Row N3's admission verdict for a handshake, and the second half of the row.
 *
 * Row N3 is "run the responder handshake; **on success emit
 * `E2EEServerAccept`**", resulting state `e2ee` (§4.4, §8.6 step 8). The test
 * below is decided before the accept exists — it has to be, because a refusal
 * must stop the accept from being built at all — so passing it is not yet the
 * transition. `established` is: the caller calls it once the accept is on the
 * send path and its own mode machine is in `e2ee`, and only then does the sweep
 * see an established `e2ee` channel.
 *
 * Until it is called the registration stays on the §15 in-flight handshake list,
 * where a sweep takes the FATAL-PRE abort (`P25`). That is the truthful
 * disposition for a channel whose peer has received no accept: §12.6 dispatches
 * "still pre-N3" as `P25` and "already `e2ee`" as `Q12`, and the step-8 work
 * between the test and the accept can still fail — a Noise failure, the §4.5
 * ceiling, a send the queue will not take — with the failure landing in a LATER
 * turn than the test.
 *
 * IT MUST BE CALLED IN THE SAME SYNCHRONOUS TURN AS THE `establish` THAT
 * RETURNED IT. Row N3 is one transition and both halves of it are one turn's
 * work; a caller that awaited in between would leave the sweep's frozen dispatch
 * reading a phase the channel has since left. It is idempotent and never
 * resurrects a registration a sweep or a release has already retired.
 */
export type NodeE2eeHandshakeAdmission =
  | { readonly kind: "entered"; readonly established: () => void }
  | { readonly kind: "refused"; readonly reason: "policy_withdrawn" };

/**
 * The row-N3 transition, and the ONLY way to reach it.
 *
 * It is what `selectHandshake` returns rather than a method on the channel
 * registration, and that is the whole point: §12.6's row-N3 test is evaluated
 * against the channel's pattern and suite, and both are fixed by the selection
 * (§8.6 step 4). A transition callable before the selection would build its
 * candidate from unset fields and answer an authorization question from values
 * no handshake ever chose — a verdict derived from nothing, and one that then
 * latches a channel into `e2ee` carrying no pattern for the sweep's NX clause
 * and no suite for its registry clause to see. Handing the transition out only
 * at the selection makes that unrepresentable rather than a rule callers are
 * asked to keep.
 */
export interface NodeE2eeSelectedHandshake {
  /**
   * Row N3's test, and — through `established` on the result — the phase change
   * the completed row makes.
   *
   * `close` is the FATAL-POST disposition of §11.3 Q12: one `E2EEError` with
   * error code `policy` when the send path is usable, then `channel.close` with
   * reason `channel_rejected`. It is installed by `established`, alongside the
   * phase it belongs to, so no snapshot can ever freeze an `e2ee` entry whose
   * close callback is missing.
   */
  readonly establish: (input: {
    readonly close: () => void | Promise<void>;
  }) => NodeE2eeHandshakeAdmission;
}

/**
 * One channel's handle on the sweep.
 *
 * The phase transitions are the §4.4 rows, named for them. Each is a synchronous
 * mutation of the single registration object, so a channel is never absent from
 * the snapshot and never present in it twice.
 */
export interface NodeE2eeChannelRegistration {
  /**
   * §8.6 step 2 passed: this handshake is on the §15 in-flight list.
   *
   * `abort` is the FATAL-PRE disposition of §11.2 `P25`: the generic fixed-size
   * `E2EEHandshakeReject` and never a distinguishable signal, for the same
   * reason §13.6's in-flight abort takes it.
   *
   * It returns the row-N3 transition because row N3 is only reachable from
   * here; see `NodeE2eeSelectedHandshake`.
   */
  readonly selectHandshake: (input: {
    readonly pattern: E2eeNoisePattern;
    readonly suite: E2eeSuiteId;
    readonly abort: () => void | Promise<void>;
  }) => NodeE2eeSelectedHandshake;
  /**
   * Row N2: the channel locked legacy.
   *
   * `close` emits `channel.close` with reason `channel_rejected` and NO record —
   * §12.6(b) is explicit that a legacy channel holds no session keys, so there is
   * nothing to encrypt, and in particular that an `E2EEHandshakeReject` MUST NOT
   * be sent, because it is a negotiation record and would be row K21 at the peer.
   *
   * It returns a verdict for the same reason `establish` does. §12.6 does not
   * sweep a `negotiating` channel, on the stated grounds that step (a)'s commit
   * makes the newly committed policy govern its NEXT input — legacy JSON under a
   * newly effective `requireE2EE` is row N1. That argument only holds if the
   * transition out of `negotiating` reads the committed policy: a channel that
   * was still negotiating when the snapshot was taken and then locked legacy
   * without re-checking is in neither enumeration and in no sweep, and §15 arms
   * no idle deadline in `legacy`. A refusal here is that row N1.
   */
  readonly lockLegacy: (input: {
    readonly close: () => void | Promise<void>;
  }) => NodeE2eeChannelAdmission;
  /** Retire the registration: authenticated finish, any fatal outcome, or channel close. */
  readonly release: () => void;
}

export interface NodeE2eePolicyClient {
  /**
   * The policy in force, for §8.6 step 2 and every §4.4 row.
   *
   * Synchronous by contract. §8.6 step 2 requires the policy read and the row-N3
   * transition to be atomic with respect to §12.6's commit, and the only way to
   * have that on this runtime is for neither to await. Before `start` has
   * published a policy, and after a read failure, this is the fail-closed policy
   * of §12.4.
   */
  readonly policy: () => EffectiveNodeE2eePolicy;
  /** The §5.7 generation the next advertisement carries. */
  readonly generation: () => number;
  /**
   * Read the durable policy and apply the operator's configured values.
   *
   * §12.4: the effective policy is recomputed deterministically from durable
   * configuration on every start. A configured value is an explicit operator
   * statement and is committed — narrowing it runs the full §12.6 procedure,
   * which at startup sweeps nothing because no channel survives a restart. An
   * ABSENT configured value leaves the committed value untouched, which is what
   * makes a restart in a shell without the environment variable incapable of
   * weakening the policy.
   */
  readonly start: (configured?: NodeE2eePolicyProposal) => Promise<NodeE2eePolicyChangeResult>;
  /** §12.6 in full: (a) commit and bump, (b) sweep one snapshot, (c) return the counts. */
  readonly applyChange: (proposal: NodeE2eePolicyProposal) => Promise<NodeE2eePolicyChangeResult>;
  /** What `applyChange` would do, without doing it. For the §12.6 warning. */
  readonly preview: (proposal: NodeE2eePolicyProposal) => NodeE2eePolicyPreview;
  readonly registerChannel: () => NodeE2eeChannelRegistration;
  /**
   * §5.7's recovery command, under the full §12.6 procedure.
   *
   * It can narrow: the store refuses to re-adopt the values of a record the
   * anchor says was rolled back, and commits the §12.4 fail-closed policy
   * instead. Step (b) is owed for that like any other narrowing.
   */
  readonly recoverGeneration: () => Promise<NodeE2eePolicyChangeResult>;
}

interface Registration {
  phase: E2eeChannelPhase;
  pattern: E2eeNoisePattern | undefined;
  suite: E2eeSuiteId | undefined;
  close: (() => void | Promise<void>) | undefined;
  abort: (() => void | Promise<void>) | undefined;
}

function stateOf(registration: Registration): E2eeChannelPolicyState {
  return {
    phase: registration.phase,
    pattern: registration.pattern,
    suite: registration.suite,
  };
}

/**
 * The class a snapshot entry is swept under, or `undefined` when it survives.
 *
 * The two §12.6 tests agree on every registration, and that is what makes the
 * snapshot safe to act on across an await: a registration the in-flight clause
 * would abort is one whose tier or suite the new policy refuses, which is
 * exactly the condition `establish` re-checks at row N3 — so it cannot become
 * `e2ee` behind the sweep and be aborted as a handshake it is no longer. The
 * converse holds too: an entry the in-flight clause skips is one row N3 admits.
 *
 * Splitting the transition into the test and `established` does not weaken that:
 * the two are one turn's work by contract, so the phase a snapshot freezes is
 * still one a test under the CURRENT policy admitted.
 */
type Disposition = E2eeWithdrawnChannelClass | "handshake" | undefined;

function dispositionOf(
  state: E2eeChannelPolicyState,
  policy: EffectiveNodeE2eePolicy,
): Disposition {
  if (state.phase === "in_flight") {
    return e2eePolicyRefusesInFlightHandshake(state, policy) ? "handshake" : undefined;
  }
  return e2eeWithdrawnChannelClass(state, policy);
}

function tally(
  counts: NodeE2eePolicyWithdrawalCounts,
  disposition: Exclude<Disposition, undefined>,
): NodeE2eePolicyWithdrawalCounts {
  switch (disposition) {
    case "legacy":
      return { ...counts, legacy: counts.legacy + 1 };
    case "nx_e2ee":
      return { ...counts, nxE2ee: counts.nxE2ee + 1 };
    case "suite_withdrawn":
      return { ...counts, suiteWithdrawn: counts.suiteWithdrawn + 1 };
    case "handshake":
      return { ...counts, abortedHandshakes: counts.abortedHandshakes + 1 };
  }
}

export function makeNodeE2eePolicyClient(options: {
  readonly store: NodeE2eePolicyStore;
}): NodeE2eePolicyClient {
  const registrations = new Set<Registration>();
  // Fail closed until a durable read succeeds: an un-started client, and one
  // whose record could not be read, admit the least rather than the most
  // (§12.4). `generation` is deliberately 0 alongside it — a node in this state
  // must not advertise at all, and 0 is the value that has never been issued.
  let current: EffectiveNodeE2eePolicy = NODE_E2EE_FAIL_CLOSED_POLICY;
  let generation = 0;

  /**
   * §12.6(b), over ONE snapshot.
   *
   * The capture is synchronous and happens before the first await, so no channel
   * can change phase inside it. Each entry is dispatched by the phase the
   * snapshot froze and appears exactly once, because a channel is one
   * registration and not a member of two collections.
   *
   * A registration created during the awaits below is absent from the snapshot,
   * and that is correct rather than a gap: it was admitted after step (a)'s
   * commit, so it was already tested against the narrowed policy — at §8.6 step
   * 2, or by `establish` re-applying the test at row N3.
   */
  const sweep = async (
    policy: EffectiveNodeE2eePolicy,
  ): Promise<NodeE2eePolicyWithdrawalCounts> => {
    const snapshot = Array.from(registrations, (registration) => ({
      registration,
      state: stateOf(registration),
    }));
    let counts = NO_COUNTS;
    const failures: unknown[] = [];
    for (const entry of snapshot) {
      // Still the node's to terminate. The snapshot is a list of objects, not a
      // claim that each is still live: the awaits below give a channel room to
      // release itself, and row N3 room to refuse and retire a handshake. Either
      // way the registration has left the set, and terminating it again would
      // both act on a channel that is already gone and add a close to the counts
      // §12.6(c) acknowledges — which are what the operator reads.
      if (!registrations.has(entry.registration)) continue;
      const disposition = dispositionOf(entry.state, policy);
      if (disposition === undefined) continue;
      const terminate =
        disposition === "handshake" ? entry.registration.abort : entry.registration.close;
      if (terminate === undefined) {
        // Unreachable by construction — every phase that a disposition can name
        // has its callback set by the transition that put it there. Treated as a
        // failure rather than skipped anyway, because counting a channel as
        // closed without having closed it is precisely the lie §12.6's
        // acknowledgement must not tell.
        failures.push(new NodeE2eePolicyError("policy_sweep_failed"));
        continue;
      }
      try {
        await terminate();
      } catch (error: unknown) {
        // Deliberately left registered. A close that failed may not have
        // happened, and §12.6's acknowledgement means "no channel the new policy
        // would not admit is still open" — so a retry has to be able to find
        // this channel again.
        failures.push(error);
        continue;
      }
      registrations.delete(entry.registration);
      counts = tally(counts, disposition);
    }
    if (failures.length > 0) throw new NodeE2eePolicyError("policy_sweep_failed");
    return counts;
  };

  const publish = (policy: EffectiveNodeE2eePolicy, next: number): void => {
    current = policy;
    generation = next;
  };

  /**
   * Resynchronize the published policy after a commit that did not return one.
   *
   * A durable write can land and the operation still reject — the §5.7 mark is
   * committed after the record, and either step can fail on its own. Leaving the
   * previous policy published would then leave memory admitting more than disk
   * says it may, which is the one direction §12.4 does not tolerate. So the
   * record is re-read; a read that also fails publishes the fail-closed policy,
   * because a node that does not know what it promised must promise the most.
   */
  const resync = async (): Promise<void> => {
    try {
      const stored = await options.store.read();
      publish(stored.policy, stored.record.generation);
    } catch {
      publish(NODE_E2EE_FAIL_CLOSED_POLICY, 0);
    }
  };

  /**
   * The ordered procedure. (a) is the store's `commit`, which returns only after
   * the record and the §5.7 mark are durable; (b) is the sweep; (c) is the
   * return, which is what a CLI acknowledgement is allowed to be built from.
   *
   * STEP (b) RUNS ON EVERY CALL, not only when step (a) reported a narrowing,
   * and that is what makes the acknowledgement mean what §12.6 says it means.
   * The sweep's own test is evaluated against the policy now in force, so a
   * widening — and a no-op — close nothing by construction; there is no need to
   * gate it, and gating it is a bug. An operator whose first attempt committed
   * the narrowing and then failed to close a channel retries the same command:
   * step (a) finds nothing left to commit and reports `changed: false`, and if
   * that suppressed the sweep the retry would acknowledge success with all-zero
   * counts while the channel the withdrawal exists to close is still open.
   */
  const runChange = async (
    commit: () => Promise<Awaited<ReturnType<NodeE2eePolicyStore["commit"]>>>,
  ): Promise<NodeE2eePolicyChangeResult> => {
    let committed;
    try {
      committed = await commit();
    } catch (error: unknown) {
      await resync();
      throw error;
    }
    publish(committed.policy, committed.record.generation);
    const counts = await sweep(committed.policy);
    return {
      policy: committed.policy,
      generation: committed.record.generation,
      withdrawal: committed.withdrawal,
      changed: committed.changed,
      counts,
    };
  };

  const start: NodeE2eePolicyClient["start"] = async (configured) => {
    let stored;
    try {
      stored = await options.store.read();
    } catch (error: unknown) {
      // The record is unreadable, so the node does not know what it promised.
      // The published policy stays fail-closed and the caller is expected to
      // refuse to advertise; §5.7's recovery command is the way out.
      if (error instanceof NodeE2eePolicyStoreError) {
        throw new NodeE2eePolicyError("policy_unreadable");
      }
      throw error;
    }
    publish(stored.policy, stored.record.generation);
    return runChange(() => options.store.commit(configured ?? {}));
  };

  const preview: NodeE2eePolicyClient["preview"] = (proposal) => {
    const advertised = resolveNodeE2eePolicyProposal(current, proposal);
    const policy = effectiveNodeE2eePolicy(advertised);
    let counts = NO_COUNTS;
    for (const registration of registrations) {
      const disposition = dispositionOf(stateOf(registration), policy);
      if (disposition !== undefined) counts = tally(counts, disposition);
    }
    return {
      policy,
      // Both predicates are the store's own, so the warning cannot disagree with
      // what the command then does. A second copy of either comparison here
      // would be a second thing to keep in step with the commit.
      withdrawal: e2eePolicyNarrows(current, policy),
      changed: !sameNodeE2eeAdmissionPolicy(advertised, current.advertised),
      counts,
    };
  };

  /**
   * Row N3, on the registration the selection already fixed.
   *
   * The candidate is built from the SELECTION's own pattern and suite rather
   * than from whatever the registration currently holds, so the test cannot be
   * evaluated against values no handshake chose. They are the same two values —
   * `selectHandshake` wrote them onto the registration for the sweep to read —
   * and taking them from the argument is what makes that agreement a fact of the
   * call rather than an ordering the caller has to honour.
   */
  const establishOn = (
    registration: Registration,
    selection: { readonly pattern: E2eeNoisePattern; readonly suite: E2eeSuiteId },
    transition: { readonly close: () => void | Promise<void> },
  ): NodeE2eeHandshakeAdmission => {
    // The cheap second line §12.6 asks for on top of §8.6 step 2's atomicity: a
    // handshake that passed step 2 under the old policy and reaches row N3 after
    // the commit is refused here rather than admitted and swept, so the
    // acknowledgement is true even for a channel the snapshot could not have
    // contained.
    const candidate: E2eeChannelPolicyState = {
      phase: "e2ee",
      pattern: selection.pattern,
      suite: selection.suite,
    };
    if (e2eeWithdrawnChannelClass(candidate, current) !== undefined) {
      // Retired on refusal, exactly as `NodeClientAuthorizationClient` retires
      // its own: the caller takes the FATAL disposition itself, and leaving the
      // registration on the list would let a sweep already in progress abort a
      // handshake this refusal has already ended — one channel, two
      // terminations, and a count that over-reports.
      registrations.delete(registration);
      return { kind: "refused", reason: "policy_withdrawn" };
    }
    // The phase stays `in_flight` until the caller reports the accept away and
    // its own mode flipped. Passing the test is not the transition: see
    // `NodeE2eeHandshakeAdmission`.
    return {
      kind: "entered",
      established: () => {
        // Never resurrects a registration a sweep or a release has retired: a
        // channel that has been terminated is not one this phase change may put
        // back on the list under a disposition nothing will act on.
        if (!registrations.has(registration)) return;
        registration.phase = "e2ee";
        registration.close = transition.close;
      },
    };
  };

  const registerChannel: NodeE2eePolicyClient["registerChannel"] = () => {
    const registration: Registration = {
      phase: "negotiating",
      pattern: undefined,
      suite: undefined,
      close: undefined,
      abort: undefined,
    };
    registrations.add(registration);
    return {
      selectHandshake: (input) => {
        registration.phase = "in_flight";
        registration.pattern = input.pattern;
        registration.suite = input.suite;
        registration.abort = input.abort;
        return { establish: (transition) => establishOn(registration, input, transition) };
      },
      lockLegacy: (input) => {
        // Row N1 rather than row N2 when the policy narrowed under this channel
        // while it was still negotiating. §12.6 leaves a `negotiating` channel
        // out of both enumerations because the committed policy governs its next
        // input; this is where that governance actually happens for the legacy
        // transition, and without it the channel latches into a mode the sweep
        // has already walked past.
        if (e2eeWithdrawnChannelClass({ phase: "legacy" }, current) !== undefined) {
          return { kind: "refused", reason: "policy_withdrawn" };
        }
        registration.phase = "legacy";
        registration.close = input.close;
        return { kind: "entered" };
      },
      release: () => {
        registrations.delete(registration);
      },
    };
  };

  return {
    policy: () => current,
    generation: () => generation,
    start,
    applyChange: (proposal) => runChange(() => options.store.commit(proposal)),
    preview,
    registerChannel,
    // Through the same ordered procedure as every other change, because the
    // store's recovery may fail closed over a restored record and that is a
    // narrowing like any other — §12.6(b) is owed for it, and an acknowledgement
    // that skipped it would be the same lie.
    recoverGeneration: () => runChange(() => options.store.recoverGeneration()),
  };
}
