import type { NodeE2eeAdmissionPolicy as NodeE2eeAdmissionPolicyMode } from "@ryco/contracts/native-e2ee";
import { E2EE_SUITE_REGISTRY_MAX_ENTRIES } from "@ryco/shared/relayE2eeConstants";
import type { E2eeNoisePattern } from "@ryco/shared/relayE2eeTranscripts";
import {
  E2EE_SUITE_25519_CHACHAPOLY_SHA256,
  E2EE_SUITE_ACCOUNT_GRANT_25519_CHACHAPOLY_SHA256,
  isE2eeSuiteId,
} from "@ryco/shared/relayE2eeWire";
import type { E2eeSuiteId } from "@ryco/shared/relayE2eeWire";

import { NodeContinuityAnchorError, type NodeContinuityAnchor } from "./NodeContinuityAnchor.ts";
import { openProtectedStateFile, type ProtectedStateFileFailure } from "./ProtectedStateFile.ts";

// The node's durable admission policy and its §5.7 policy generation —
// docs/relay-e2ee-protocol.md §12.3 (`requireE2EE`), §12.4
// (`requireApprovedClientE2EE`, the implication, and the restart rule), §12.6
// (policy withdrawal), and §5.7 (the generation and its high-water anchor).
//
// WHAT THIS OWNS: the durable record, the effective-policy rule, the §12.6
// classification vocabulary, and the (a) half of §12.6's ordered procedure — the
// durable commit and the generation bump. The (b) sweep and the (c)
// acknowledgement belong to `NodeE2eePolicyClient`, which is the only intended
// caller, because they act on live channels and this module holds no runtime
// state.
//
// ─── WHY THE POLICY IS NOT IN `ServerConfig` AND NOT IN `ServerSettings` ─────
//
// §12.4 requires the effective policy to be "recomputed deterministically from
// durable configuration on every start", and neither existing surface is durable
// configuration in that sense.
//
// `ServerConfig` is assembled once per process from flags, environment, and the
// bootstrap envelope. An operator who exported `RYCO_HUB_REQUIRE_E2EE=true` in
// one shell has recorded nothing at all: the next start, from a launcher or a
// service manager, silently runs wide open. That is precisely the silent
// weakening §12.4 forbids. So the flags remain the operator's INPUT and this
// record is the state — a configured value is committed here, and an absent one
// leaves the committed value untouched. Absence never weakens.
//
// `ServerSettings` is durable and runtime-mutable, but `serverUpdateSettings` is
// classified `owner`, and `hostedRoleAllows` grants a relay-transported owner
// channel every method not classified `authenticated` or `direct_owner`. §2.1
// concedes the Hub can originate such a channel at the legacy and NX tiers, so
// putting these two booleans there would let the party this protocol treats as
// the adversary widen the node's admission policy. It also strips
// default-valued entries on write — making an explicit `false` byte-identical to
// "never configured", which §12.3's default flip reads differently — and it is
// written without an fsync, which §12.6(a) and §5.7 both rule out.
//
// ─── WHY THIS IS ITS OWN RECORD ─────────────────────────────────────────────
//
// The same reason the §6.4 prekey slots, the §7.5 lineage, and the §13.6
// authorization records are (`NodeE2eePrekeyStore`,
// `NodeIdentityContinuityStore`, `NodeClientAuthorizationStore`): `parseState`
// reconstructs `hub-identity.json` from its known keys alone, so a binary older
// than this feature deletes every field it does not recognize on its next write,
// and a downgrade to a release that predates E2EE is an ordinary operator
// action. Here that would clear an operator's `requireE2EE` — a silent policy
// widening performed by a downgrade — and reset the §5.7 generation, which
// clients treat as a rollback. This record's own parser preserves unknown
// top-level keys, so the same trap is not rebuilt one version later.

export type NodeE2eePolicyStoreErrorCode =
  | "policy_state_unavailable"
  | "policy_state_locked"
  | "policy_state_corrupt"
  | "policy_state_operation_failed"
  /** §5.7: the stored generation is below the anchor's high-water mark. */
  | "policy_generation_rolled_back"
  /** The §5.7 anchor could not be read or written; never advertise without it. */
  | "policy_anchor_unavailable";

export class NodeE2eePolicyStoreError extends Error {
  readonly code: NodeE2eePolicyStoreErrorCode;

  constructor(code: NodeE2eePolicyStoreErrorCode) {
    super("Node E2EE policy state operation failed.");
    this.name = "NodeE2eePolicyStoreError";
    this.code = code;
  }
}

function stateError(code: NodeE2eePolicyStoreErrorCode): never {
  throw new NodeE2eePolicyStoreError(code);
}

// ─── the policy vocabulary (§12.3, §12.4, §12.6) ────────────────────────────

/**
 * The RAW policy: exactly the values §7.6 elements 9, 12 and 13 advertise.
 *
 * "Raw" is the spec's word and it matters here: element 12 carries
 * `requireE2EE` as configured, not the effective value, so a statement from a
 * node running `requireApprovedClientE2EE` alone says `requireE2EE: false` and
 * `admittedPatterns: ["IK"]`, and a client reads the admission it will actually
 * get from element 14. Only `EffectiveNodeE2eePolicy` below decides admission.
 */
export interface NodeE2eeAdmissionPolicy {
  /** The sole durable policy choice; every remaining field is its wire projection. */
  readonly mode: NodeE2eeAdmissionPolicyMode;
  readonly requireE2EE: boolean;
  readonly requireApprovedClientE2EE: boolean;
  /** §7.6 element 9. Non-empty, ascending, no duplicates. */
  readonly suiteRegistry: readonly E2eeSuiteId[];
}

/**
 * The policy every admission decision reads.
 *
 * THE SHAPE IS THE POINT. `requireE2EE` on this object is the EFFECTIVE value —
 * §12.4's `requireE2EE OR requireApprovedClientE2EE` — and the raw pair is
 * reachable only through `advertised`, whose one legitimate consumer is the §7.6
 * transcript encoder. A caller that reads the obvious field therefore gets the
 * right answer, and a caller that wants the raw value has to say so. That is
 * what makes "computed in one place" a property of the type rather than a
 * convention every future call site has to remember: there is no field on this
 * object that looks like the admission rule but is not it.
 */
export interface EffectiveNodeE2eePolicy {
  readonly mode: NodeE2eeAdmissionPolicyMode;
  /** §12.4: `requireE2EE OR requireApprovedClientE2EE`. */
  readonly requireE2EE: boolean;
  readonly requireApprovedClientE2EE: boolean;
  /** §7.6 element 14, from the shared derivation; never configured. */
  readonly admittedPatterns: readonly E2eeNoisePattern[];
  readonly suiteRegistry: readonly E2eeSuiteId[];
  /** Whether suite 0x02 may authorize a new channel under this mode. */
  readonly accountGrantsAllowed: boolean;
  /** The raw §7.6 elements 9, 12 and 13. For the transcript encoder and the CLI display. */
  readonly advertised: NodeE2eeAdmissionPolicy;
}

/**
 * §12.4's deterministic effective-policy rule, and the only place it is applied.
 */
export function nodeE2eeAdmissionPolicyForMode(
  mode: NodeE2eeAdmissionPolicyMode,
): NodeE2eeAdmissionPolicy {
  switch (mode) {
    case "compatibility":
      return {
        mode,
        requireE2EE: false,
        requireApprovedClientE2EE: false,
        suiteRegistry: [
          E2EE_SUITE_ACCOUNT_GRANT_25519_CHACHAPOLY_SHA256,
          E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        ],
      };
    case "require-e2ee":
      return {
        mode,
        requireE2EE: true,
        requireApprovedClientE2EE: false,
        suiteRegistry: [
          E2EE_SUITE_ACCOUNT_GRANT_25519_CHACHAPOLY_SHA256,
          E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        ],
      };
    case "require-native-e2ee":
      return {
        mode,
        requireE2EE: true,
        requireApprovedClientE2EE: false,
        suiteRegistry: [
          E2EE_SUITE_ACCOUNT_GRANT_25519_CHACHAPOLY_SHA256,
          E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        ],
      };
    case "require-locally-approved-native-e2ee":
      return {
        mode,
        requireE2EE: true,
        requireApprovedClientE2EE: true,
        suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
      };
  }
}

export function effectiveNodeE2eePolicy(
  advertised: NodeE2eeAdmissionPolicy,
): EffectiveNodeE2eePolicy {
  const nativeOnly =
    advertised.mode === "require-native-e2ee" ||
    advertised.mode === "require-locally-approved-native-e2ee";
  return {
    mode: advertised.mode,
    requireE2EE: advertised.mode !== "compatibility",
    requireApprovedClientE2EE: advertised.requireApprovedClientE2EE,
    admittedPatterns: nativeOnly ? ["IK"] : ["IK", "NX"],
    suiteRegistry: advertised.suiteRegistry,
    accountGrantsAllowed: advertised.mode !== "require-locally-approved-native-e2ee",
    advertised,
  };
}

/**
 * The strictest policy the vocabulary can express.
 *
 * §12.4: "A recovery procedure that cannot read the durable policy MUST fail
 * closed rather than admit broader tiers." A node that cannot read its record
 * does not know what it promised, so it promises the most and admits the least.
 * The suite registry is left at the built-in default because narrowing it below
 * the one suite this version defines would admit nothing at all, which is a
 * different failure from admitting too much.
 */
export const NODE_E2EE_FAIL_CLOSED_POLICY: EffectiveNodeE2eePolicy = effectiveNodeE2eePolicy(
  nodeE2eeAdmissionPolicyForMode("require-locally-approved-native-e2ee"),
);

/**
 * §12.6's four narrowing cases, evaluated as one predicate.
 *
 * Case 4 is implied by case 2 in version 1 — `requireApprovedClientE2EE`
 * removing `"NX"` is the only way the admitted pattern set can shrink — and is
 * tested anyway, because §12.6 enumerates it separately and a later version that
 * gains another way to reduce element 14 must not have to remember to add it
 * here.
 *
 * A change that both narrows and widens IS a withdrawal: this returns true if
 * ANY clause narrows, and the caller runs the procedure. A pure widening returns
 * false and sweeps nothing.
 */
export function e2eePolicyNarrows(
  previous: EffectiveNodeE2eePolicy,
  next: EffectiveNodeE2eePolicy,
): boolean {
  if (next.requireE2EE && !previous.requireE2EE) return true;
  if (next.requireApprovedClientE2EE && !previous.requireApprovedClientE2EE) return true;
  if (previous.suiteRegistry.some((suite) => !next.suiteRegistry.includes(suite))) return true;
  return previous.admittedPatterns.some((pattern) => !next.admittedPatterns.includes(pattern));
}

/**
 * Whether two advertised policies are the same values.
 *
 * Exported because two callers need the answer and they MUST NOT disagree: the
 * commit spends a §5.7 generation exactly when this is false, and §12.6's
 * warning tells the operator whether the command will change anything at all. A
 * second implementation of the comparison is a second chance for the warning to
 * promise something the commit then does not do.
 */
export function sameNodeE2eeAdmissionPolicy(
  left: NodeE2eeAdmissionPolicy,
  right: NodeE2eeAdmissionPolicy,
): boolean {
  return (
    left.mode === right.mode &&
    left.requireE2EE === right.requireE2EE &&
    left.requireApprovedClientE2EE === right.requireApprovedClientE2EE &&
    left.suiteRegistry.length === right.suiteRegistry.length &&
    left.suiteRegistry.every((suite, index) => right.suiteRegistry[index] === suite)
  );
}

/** The §12.6(c) classes, in the order the per-channel test states them. */
export type E2eeWithdrawnChannelClass = "legacy" | "nx_e2ee" | "suite_withdrawn";

/**
 * The §4.4 mode a channel holds, plus the one distinction §12.6 adds.
 *
 * `in_flight` is not a fourth §4.4 mode: it is still `negotiating`, but past
 * §8.6 step 2 and before row N3, which is exactly the window §12.6 aborts as
 * FATAL-PRE `P25`. A channel that has not reached step 2 stays `negotiating` and
 * is never swept — step (a)'s commit makes the new policy govern its next input,
 * and both outcomes there are fail-closed.
 */
export type E2eeChannelPhase = "negotiating" | "in_flight" | "legacy" | "e2ee";

/**
 * The per-channel state the §12.6 test reads, and nothing else.
 *
 * §12.6 is explicit that the test requires no new per-channel state and MUST NOT
 * be implemented in terms of the §8.6 step 6 admitted-authority snapshot, which
 * is §13.6's subject and which NX channels do not carry at all. This type is
 * that constraint written down: there is no field here to reach it through.
 */
export interface E2eeChannelPolicyState {
  readonly phase: E2eeChannelPhase;
  /** Fixed at §8.6 step 4 by the pattern the channel ran. Absent while `negotiating`. */
  readonly pattern?: E2eeNoisePattern | undefined;
  /** The established suite (§9.1, §4.3 already reject any envelope that differs). */
  readonly suite?: E2eeSuiteId | undefined;
}

/**
 * The §12.6 per-channel withdrawal test.
 *
 * Returns the class to count the close under, or `undefined` when the channel
 * survives. The bullets are evaluated in the order §12.6 states them, so a
 * channel matching more than one — an NX channel whose suite also left the
 * registry — is closed once and counted once, in the first class that names it.
 *
 * The second bullet reaches no IK channel, and §12.6 spells out why that is a
 * consequence rather than an exemption: §8.6 step 6 admits no IK channel without
 * an `approved` Branch A record, and element 14 under `requireApprovedClientE2EE`
 * is exactly `["IK"]`, so every established IK channel already satisfies what
 * cases 2 and 4 require. The third bullet is unqualified by tier on purpose and
 * DOES close IK channels: a suite leaves the registry when the operator has
 * concluded its construction is not one they will run, and §15 arms no idle
 * deadline in established `e2ee` that would ever retire such a channel.
 */
export function e2eeWithdrawnChannelClass(
  channel: E2eeChannelPolicyState,
  policy: EffectiveNodeE2eePolicy,
): E2eeWithdrawnChannelClass | undefined {
  if (channel.phase === "legacy") return policy.requireE2EE ? "legacy" : undefined;
  if (channel.phase !== "e2ee") return undefined;
  if (channel.pattern === "NX" && !policy.admittedPatterns.includes("NX")) return "nx_e2ee";
  if (channel.suite !== undefined && !policy.suiteRegistry.includes(channel.suite)) {
    return "suite_withdrawn";
  }
  return undefined;
}

/**
 * The §12.6 in-flight test: a handshake past §8.6 step 2 whose tier or selected
 * suite the new policy would not admit.
 *
 * It is P9's condition re-evaluated after step 2 rather than at it, which is why
 * it reads the same two fields and nothing about authority.
 */
export function e2eePolicyRefusesInFlightHandshake(
  handshake: E2eeChannelPolicyState,
  policy: EffectiveNodeE2eePolicy,
): boolean {
  if (handshake.phase !== "in_flight") return false;
  if (handshake.pattern !== undefined && !policy.admittedPatterns.includes(handshake.pattern)) {
    return true;
  }
  return handshake.suite !== undefined && !policy.suiteRegistry.includes(handshake.suite);
}

// ─── the durable record ─────────────────────────────────────────────────────

/** One closed mode and an envelope, plus room for a newer binary's fields. */
const MAX_POLICY_STATE_BYTES = 8 * 1024;

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  "version",
  "revision",
  "generation",
  "mode",
  "requireE2EE",
  "requireApprovedClientE2EE",
  "suiteRegistry",
]);

const FORBIDDEN_FORWARD_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export interface NodeE2eePolicyRecordFile {
  readonly version: 2;
  readonly revision: number;
  /** §5.7. Strictly increasing across every committed change; never silently reset. */
  readonly generation: number;
  /** §18.8. The compatibility booleans and suite registry are derived, never stored. */
  readonly mode: NodeE2eeAdmissionPolicyMode;
}

interface StoredPolicyFile {
  readonly record: NodeE2eePolicyRecordFile;
  /** Top-level keys a newer binary wrote, preserved verbatim across this binary's writes. */
  readonly forwardFields: Readonly<Record<string, unknown>>;
  readonly migrationRequired: boolean;
}

/**
 * The §12.3/§12.4 defaults, and the suite registry this version advertises.
 *
 * Both policies default false "at introduction", per §12.3 and §12.4. A default
 * FLIP is not a change to this constant alone: §12.3 makes it a policy
 * withdrawal, so the flip ships as a configured narrowing that runs the §12.6
 * procedure, not as a quietly different initial record.
 */
export function initialNodeE2eePolicyRecord(): NodeE2eePolicyRecordFile {
  return {
    version: 2,
    revision: 0,
    generation: 0,
    mode: "compatibility",
  };
}

const POLICY_MODES: ReadonlySet<string> = new Set([
  "compatibility",
  "require-e2ee",
  "require-native-e2ee",
  "require-locally-approved-native-e2ee",
]);

function legacyMode(value: {
  readonly requireE2EE: boolean;
  readonly requireApprovedClientE2EE: boolean;
}): NodeE2eeAdmissionPolicyMode {
  if (value.requireApprovedClientE2EE) return "require-locally-approved-native-e2ee";
  if (value.requireE2EE) return "require-e2ee";
  return "compatibility";
}

function sameSuites(left: readonly E2eeSuiteId[], right: readonly E2eeSuiteId[]): boolean {
  return left.length === right.length && left.every((suite, index) => suite === right[index]);
}

/** Translate new enum and deprecated boolean/API inputs through one deterministic boundary. */
export function resolveNodeE2eePolicyProposal(
  current: EffectiveNodeE2eePolicy,
  proposal: NodeE2eePolicyProposal,
): NodeE2eeAdmissionPolicy {
  let mode = proposal.mode ?? current.mode;
  const hasLegacyBooleans =
    proposal.requireE2EE !== undefined || proposal.requireApprovedClientE2EE !== undefined;
  if (proposal.mode === undefined && hasLegacyBooleans) {
    mode = legacyMode({
      requireE2EE: proposal.requireE2EE ?? current.advertised.requireE2EE,
      requireApprovedClientE2EE:
        proposal.requireApprovedClientE2EE ?? current.advertised.requireApprovedClientE2EE,
    });
  }
  if (
    proposal.mode === undefined &&
    proposal.suiteRegistry?.length === 1 &&
    proposal.suiteRegistry[0] === E2EE_SUITE_25519_CHACHAPOLY_SHA256
  ) {
    mode = "require-locally-approved-native-e2ee";
  }
  if (!POLICY_MODES.has(mode)) return stateError("policy_state_operation_failed");
  const projected = nodeE2eeAdmissionPolicyForMode(mode);
  if (
    (proposal.requireE2EE !== undefined && proposal.requireE2EE !== projected.requireE2EE) ||
    (proposal.requireApprovedClientE2EE !== undefined &&
      proposal.requireApprovedClientE2EE !== projected.requireApprovedClientE2EE) ||
    (proposal.suiteRegistry !== undefined &&
      !sameSuites(proposal.suiteRegistry, projected.suiteRegistry))
  ) {
    return stateError("policy_state_operation_failed");
  }
  return projected;
}

function parseFile(value: unknown): StoredPolicyFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return stateError("policy_state_corrupt");
  }
  const candidate = value as Record<string, unknown>;
  if (
    (candidate.version !== 1 && candidate.version !== 2) ||
    !Number.isSafeInteger(candidate.revision) ||
    Number(candidate.revision) < 0 ||
    !Number.isSafeInteger(candidate.generation) ||
    Number(candidate.generation) < 0
  ) {
    return stateError("policy_state_corrupt");
  }
  let mode: NodeE2eeAdmissionPolicyMode;
  const migrationRequired = candidate.version === 1;
  if (migrationRequired) {
    if (
      Object.prototype.hasOwnProperty.call(candidate, "mode") ||
      typeof candidate.requireE2EE !== "boolean" ||
      typeof candidate.requireApprovedClientE2EE !== "boolean" ||
      !Array.isArray(candidate.suiteRegistry) ||
      candidate.suiteRegistry.length < 1 ||
      candidate.suiteRegistry.length > E2EE_SUITE_REGISTRY_MAX_ENTRIES ||
      !candidate.suiteRegistry.every(
        (suite, index, suites) =>
          typeof suite === "number" &&
          suite === E2EE_SUITE_25519_CHACHAPOLY_SHA256 &&
          isE2eeSuiteId(suite) &&
          (index === 0 || Number(suites[index - 1]) < suite),
      )
    ) {
      return stateError("policy_state_corrupt");
    }
    mode = legacyMode({
      requireE2EE: candidate.requireE2EE,
      requireApprovedClientE2EE: candidate.requireApprovedClientE2EE,
    });
  } else {
    if (
      typeof candidate.mode !== "string" ||
      !POLICY_MODES.has(candidate.mode) ||
      Object.prototype.hasOwnProperty.call(candidate, "requireE2EE") ||
      Object.prototype.hasOwnProperty.call(candidate, "requireApprovedClientE2EE") ||
      Object.prototype.hasOwnProperty.call(candidate, "suiteRegistry")
    ) {
      return stateError("policy_state_corrupt");
    }
    mode = candidate.mode as NodeE2eeAdmissionPolicyMode;
  }
  const forwardFields: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(candidate)) {
    if (KNOWN_KEYS.has(key) || FORBIDDEN_FORWARD_KEYS.has(key)) continue;
    forwardFields[key] = entry;
  }
  return {
    record: {
      version: 2,
      revision: candidate.revision as number,
      generation: candidate.generation as number,
      mode,
    },
    forwardFields,
    migrationRequired,
  };
}

function encodeFile(file: StoredPolicyFile): unknown {
  // Forward fields first so a key this binary owns can never be shadowed by a
  // stale value a newer binary happened to write under the same name.
  return { ...file.forwardFields, ...file.record };
}

/** What a caller proposes. An absent field leaves the committed value alone. */
export interface NodeE2eePolicyProposal {
  readonly mode?: NodeE2eeAdmissionPolicyMode | undefined;
  /** Deprecated compatibility input; translated to `mode`. */
  readonly requireE2EE?: boolean | undefined;
  /** Deprecated compatibility input; translated to `mode`. */
  readonly requireApprovedClientE2EE?: boolean | undefined;
  /** Deprecated compatibility input; `[0x01]` selects the strongest mode. */
  readonly suiteRegistry?: readonly E2eeSuiteId[] | undefined;
}

export interface NodeE2eePolicyCommit {
  readonly record: NodeE2eePolicyRecordFile;
  readonly policy: EffectiveNodeE2eePolicy;
  /** The policy in force before this commit, for the §12.6 sweep's test. */
  readonly previous: EffectiveNodeE2eePolicy;
  /** True when §12.6's test found a reduction; the caller MUST then run step (b). */
  readonly withdrawal: boolean;
  /** False when the proposal changed nothing; no generation was spent. */
  readonly changed: boolean;
}

export interface NodeE2eePolicyStore {
  /**
   * The committed policy, after the §5.7 startup cross-check.
   *
   * Throws `policy_generation_rolled_back` when the stored generation is below
   * the anchor's high-water mark. It also performs the one repair that is not a
   * rollback: a record whose generation is ABOVE the mark is a change that
   * committed before the mark caught up, so the mark is raised to meet it. The
   * record is the evidence — the node wrote it — and the mark is only ever
   * raised, never lowered.
   */
  readonly read: () => Promise<{
    readonly record: NodeE2eePolicyRecordFile;
    readonly policy: EffectiveNodeE2eePolicy;
  }>;
  /**
   * §12.6 step (a), in full: reserve the generation on the anchor, write the
   * record, then commit the mark.
   *
   * Returns before any sweep runs, which is the ordering §12.6 calls
   * load-bearing: every handshake reaching §8.6 step 2 after this returns reads
   * the narrowed policy and is refused there, so the only channels left for step
   * (b) are those already past it.
   */
  readonly commit: (proposal: NodeE2eePolicyProposal) => Promise<NodeE2eePolicyCommit>;
  /**
   * §5.7's recovery command: advance the generation strictly past anything this
   * node may ever have advertised, mark first and record second.
   *
   * It never adopts a policy it cannot account for. The only condition it
   * resolves is the §5.7 rollback — a record BELOW the anchor's mark, which is
   * what an operator restore of the state directory leaves — and the values in
   * such a record are whatever the restore put there, not what this node last
   * committed. Recovering them would durably re-adopt an old policy at a new
   * generation and make a rollback look like a legitimate change, so recovery
   * commits the §12.4 fail-closed policy in that case and leaves re-widening to
   * the owner's explicit `commit`.
   */
  readonly recoverGeneration: () => Promise<NodeE2eePolicyCommit>;
}

// THERE IS NO `reset` HERE, AND THAT IS THE POINT. The other node records have
// one because a `leave` erases Hub-scoped state; this record is not Hub-scoped.
// It is the operator's own admission policy, and §12.4's rule is that absence
// never weakens it — a reset to the §12.3/§12.4 defaults is `requireE2EE: false`
// and `requireApprovedClientE2EE: false`, which is precisely the silent widening
// this module exists to prevent, performed by a command whose name does not say
// so. An operator who wants the defaults back states them, through `commit`,
// where the change is explicit, spends a generation, and runs §12.6's procedure.

const FAILURE_CODES: Readonly<Record<ProtectedStateFileFailure, NodeE2eePolicyStoreErrorCode>> = {
  unavailable: "policy_state_unavailable",
  locked: "policy_state_locked",
  corrupt: "policy_state_corrupt",
  operation_failed: "policy_state_operation_failed",
};

export function nodeE2eeAdmissionPolicyOf(
  record: NodeE2eePolicyRecordFile,
): NodeE2eeAdmissionPolicy {
  return nodeE2eeAdmissionPolicyForMode(record.mode);
}

export async function makeNodeE2eePolicyStore(options: {
  readonly path: string;
  readonly anchor: NodeContinuityAnchor;
}): Promise<NodeE2eePolicyStore> {
  const file = await openProtectedStateFile({
    path: options.path,
    maxBytes: MAX_POLICY_STATE_BYTES,
    fail: (failure) => stateError(FAILURE_CODES[failure]),
  });

  /** Every anchor failure is fatal here: §5.7 forbids advertising without the mark. */
  const withAnchor = async <A>(operation: () => Promise<A>): Promise<A> => {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof NodeContinuityAnchorError) {
        return stateError("policy_anchor_unavailable");
      }
      throw error;
    }
  };

  const load = async (): Promise<StoredPolicyFile> => {
    const raw = await file.readJson();
    if (raw !== null) return parseFile(raw);
    // Not written on read: an unwritten record is the §12.3/§12.4 defaults, and
    // materializing it would spend a write — and, worse, make "never
    // configured" indistinguishable from "explicitly set to the defaults" for
    // any later reader.
    return {
      record: initialNodeE2eePolicyRecord(),
      forwardFields: {},
      migrationRequired: false,
    };
  };

  const write = (proposed: StoredPolicyFile): Promise<void> =>
    // Re-parsing on the way out is what makes a value a caller mutated into an
    // impossible shape fail before it reaches the disk.
    file.writeJson(encodeFile(parseFile(encodeFile(proposed))));

  /**
   * The §5.7 cross-check and the one repair it permits.
   *
   * Runs under the record lock so the mark this compares against cannot move
   * between the read and the raise.
   */
  const crossCheck = async (record: NodeE2eePolicyRecordFile): Promise<void> => {
    const anchor = await withAnchor(() => options.anchor.read());
    const mark = anchor?.policyGenerationHighWater ?? 0;
    if (record.generation < mark) return stateError("policy_generation_rolled_back");
    if (record.generation > mark) {
      await withAnchor(() => options.anchor.commitPolicyGeneration(record.generation));
    }
  };

  const read: NodeE2eePolicyStore["read"] = () =>
    file.withLock(async () => {
      let current = await load();
      await crossCheck(current.record);
      current = await migrate(current);
      return {
        record: current.record,
        policy: effectiveNodeE2eePolicy(nodeE2eeAdmissionPolicyOf(current.record)),
      };
    });

  /**
   * Write one generation-bearing record: reserve, write, commit.
   *
   * The reservation is durable BEFORE the record exists, which is §5.7's "updated
   * crash-atomically before the corresponding generation is first advertised".
   * The two anchor marks then make both crash windows readable rather than
   * ambiguous:
   *
   *   crash after the reservation, before the write → `pendingPolicyGeneration`
   *     is ahead of both the record and the high-water mark. That is an
   *     interrupted change, not a rollback, so the cross-check passes and the
   *     retry simply takes a higher number — §5.7 permits the generation to
   *     advance by more than 1 for exactly this reason;
   *   crash after the write, before the commit → the record is ahead of the
   *     mark. The record is the evidence, so the cross-check raises the mark to
   *     meet it.
   *
   * Only the reverse — a record BELOW the mark — is the rollback §5.7 makes a
   * hard startup condition, and no ordering here can produce it.
   */
  const commitRecord = async (
    current: StoredPolicyFile,
    next: Omit<NodeE2eePolicyRecordFile, "version" | "revision">,
  ): Promise<NodeE2eePolicyRecordFile> => {
    await withAnchor(() => options.anchor.reservePolicyGeneration(next.generation));
    const record: NodeE2eePolicyRecordFile = {
      ...next,
      version: 2,
      revision: current.record.revision + 1,
    };
    await write({ record, forwardFields: current.forwardFields, migrationRequired: false });
    await withAnchor(() => options.anchor.commitPolicyGeneration(record.generation));
    return record;
  };

  /** One above everything the node has, has reserved, or has ever marked. */
  const nextGeneration = async (record: NodeE2eePolicyRecordFile): Promise<number> => {
    const anchor = await withAnchor(() => options.anchor.read());
    return (
      Math.max(
        record.generation,
        anchor?.policyGenerationHighWater ?? 0,
        anchor?.pendingPolicyGeneration ?? 0,
      ) + 1
    );
  };

  const migrate = async (current: StoredPolicyFile): Promise<StoredPolicyFile> => {
    if (!current.migrationRequired) return current;
    const record = await commitRecord(current, {
      generation: await nextGeneration(current.record),
      mode: current.record.mode,
    });
    return { record, forwardFields: current.forwardFields, migrationRequired: false };
  };

  /** The whole of §12.6 step (a), for whichever advertised policy the caller resolved. */
  const apply = async (
    current: StoredPolicyFile,
    mode: NodeE2eeAdmissionPolicyMode,
  ): Promise<NodeE2eePolicyCommit> => {
    const previous = effectiveNodeE2eePolicy(nodeE2eeAdmissionPolicyOf(current.record));
    const advertised = nodeE2eeAdmissionPolicyForMode(mode);
    const policy = effectiveNodeE2eePolicy(advertised);
    const samePolicy = sameNodeE2eeAdmissionPolicy(advertised, previous.advertised);
    if (samePolicy && current.record.generation > 0) {
      // No generation is spent on a no-op: §5.7 increments "whenever any
      // advertised admission policy ... changes", and a restart that re-applies
      // the same configuration changes nothing. Without this every restart would
      // burn a generation and clients would see a node whose policy generation
      // climbs while its policy never moves.
      //
      // This says nothing about §12.6 step (b). "Nothing left to commit" is not
      // "nothing left to do": the caller runs the sweep on every change,
      // including this one, because a retry after a failed sweep arrives here
      // with the narrowing already durable and a channel the acknowledgement
      // claims is closed still open.
      return { record: current.record, policy, previous, withdrawal: false, changed: false };
    }
    // Generation 0 is the fail-closed, never-advertised sentinel. The first
    // successful start must therefore materialize even an unchanged default
    // policy at generation 1; otherwise a freshly enrolled node can remain
    // permanently unable to publish its account-grant capability statement.
    // This initialization changes no policy value and sweeps nothing, but its
    // durable record and high-water mark are what make the first advertisement
    // safe across restart and restore.
    const initializing = samePolicy && current.record.generation === 0;
    const record = await commitRecord(current, {
      generation: await nextGeneration(current.record),
      mode,
    });
    return {
      record,
      policy,
      previous,
      withdrawal: !initializing && e2eePolicyNarrows(previous, policy),
      changed: !initializing,
    };
  };

  const commit: NodeE2eePolicyStore["commit"] = (proposal) =>
    file.withLock(async () => {
      let current = await load();
      await crossCheck(current.record);
      current = await migrate(current);
      const policy = effectiveNodeE2eePolicy(nodeE2eeAdmissionPolicyOf(current.record));
      return apply(current, resolveNodeE2eePolicyProposal(policy, proposal).mode);
    });

  const recoverGeneration: NodeE2eePolicyStore["recoverGeneration"] = () =>
    file.withLock(async () => {
      // Deliberately NOT cross-checked first: this is the one command whose job
      // is to resolve the condition the cross-check reports. It cannot go
      // through `apply` either, whose no-op guard would refuse to spend the
      // generation this exists to spend.
      const current = await load();
      const anchor = await withAnchor(() => options.anchor.read());
      const mark = anchor?.policyGenerationHighWater ?? 0;
      const previous = effectiveNodeE2eePolicy(nodeE2eeAdmissionPolicyOf(current.record));
      // THE ONE THING RECOVERY MUST NOT DO IS LAUNDER A ROLLBACK. A record below
      // the mark is, by §5.7's own definition, one this node did not write last:
      // the record lives in the operator-restorable state directory and the mark
      // does not, so the gap is evidence that a restore replaced the record. Its
      // values are therefore not this node's committed policy, and re-committing
      // them at a fresh generation would durably re-adopt an OLD policy —
      // possibly one the owner narrowed away from — under a generation clients
      // accept as current. Recovery takes the §12.4 fail-closed policy instead:
      // it advances the generation, which is what the command is for, and
      // weakens nothing. Re-widening is the owner's explicit `commit`.
      const rolledBack = current.record.generation < mark;
      const advertised = rolledBack
        ? NODE_E2EE_FAIL_CLOSED_POLICY.advertised
        : nodeE2eeAdmissionPolicyOf(current.record);
      const policy = effectiveNodeE2eePolicy(advertised);
      const record = await commitRecord(current, {
        generation: await nextGeneration(current.record),
        mode: advertised.mode,
      });
      return {
        record,
        policy,
        previous,
        // A recovery that fails closed over a restored record IS a narrowing,
        // and §12.6's step (b) is owed for it like any other.
        withdrawal: e2eePolicyNarrows(previous, policy),
        changed: true,
      };
    });

  return { read, commit, recoverGeneration };
}
