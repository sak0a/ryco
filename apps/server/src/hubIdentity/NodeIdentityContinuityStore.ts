import { randomBytes } from "node:crypto";

import { canonicalizeHubOrigin } from "@ryco/shared/nodeIdentity";
import {
  E2EE_CONTINUITY_CHAIN_MAX_LENGTH,
  E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES,
  ED25519_SIGNATURE_BYTES,
} from "@ryco/shared/relayE2eeConstants";
import {
  E2EE_NODE_IDENTITY_ALGORITHM,
  e2eeBytesEqual,
  verifyE2eeSignature,
} from "@ryco/shared/relayE2eeKeys";
import {
  decodeNodeIdentityContinuityTranscript,
  encodeNodeIdentityContinuityTranscript,
  type NodeIdentityContinuityCertificate,
  type NodeIdentityContinuityChainEntry,
  validateNodeE2eeContinuityChain,
} from "@ryco/shared/relayE2eeTranscripts";

import {
  type NodeContinuityAnchor,
  NodeContinuityAnchorError,
  type NodeContinuityAnchorRecord,
} from "./NodeContinuityAnchor.ts";
import { openProtectedStateFile, type ProtectedStateFileFailure } from "./ProtectedStateFile.ts";

// The node's §7.5 identity-continuity lineage —
// docs/relay-e2ee-protocol.md §7.5 (the certificate, the continuity id, the
// chain rules, and both storage lifecycles) and §13.3 (what a client does with
// the result).
//
// WHAT THIS OWNS: the continuity id and its anchor, the bounded ordered chain,
// the rotation-generation high-water mark, and the explicit breaks. It never
// signs — the outgoing identity key does, through the caller's signing
// interface — and it never decides *whether* a rotation is a continuity
// rotation; §7.5 makes that an operator choice recorded before the rotation is
// staged.
//
// ─── WHY THIS IS NOT IN `hub-identity.json` ─────────────────────────────────
//
// Two independent reasons, either of which is sufficient.
//
// 1. **An older binary would delete it.** `parseState` reconstructs the identity
//    state from its known keys alone, so every field it does not recognize
//    disappears on that binary's next write. Continuity lineage must survive a
//    downgrade — a rollback to a release that predates E2EE is an ordinary
//    operator action — and a lineage silently dropped by a downgrade is exactly
//    the fleet-wide re-verification storm §7.5's anchor exists to prevent.
//    Teaching the identity parser to preserve unknown keys does not fix this:
//    it would only help binaries *newer* than that change, while every already
//    released binary keeps deleting. The state therefore has to live somewhere
//    an already-released binary never writes, which means its own file. This
//    record's own parser preserves unknown top-level keys anyway, so the same
//    trap is not rebuilt one version later.
// 2. **It does not fit.** The identity state is capped at 16 KiB, and a full
//    `E2EE_CONTINUITY_CHAIN_MAX_LENGTH` chain at the §7.1 transcript bound is
//    ~12 KiB base64url before the prekey certificate and everything else already
//    in that file. §7.6.1 forbids pruning the chain to make something fit, so a
//    node that outgrew the cap would have no legal move.
//
// ─── WHAT LIVES HERE, AND WHAT DELIBERATELY DOES NOT ────────────────────────
//
// §7.5 and §5.7 require the continuity-id anchor and the rotation-generation
// high-water mark to be (a) updated crash-atomically and (b) resident outside
// the operator-restorable state and configuration set. This record satisfies
// (a) and, by construction, cannot satisfy (b): it is the state a restore
// replaces. So neither value is kept here. Both live in `NodeContinuityAnchor`,
// a record of its own under a root the caller places outside the state
// directory, and this module reads them from there.
//
// The consequence for the rollback check matters and is the reason the split
// exists at all: a high-water mark stored beside the chain rolls back with the
// chain, so the cross-check would compare a rolled-back mark against a
// rolled-back chain and see nothing wrong. `generationHighWater` therefore
// appears on the record type below as a value the store fills in from the
// anchor on every read; it is never written to this file, and a copy left in
// this file by any other writer is dropped rather than believed.

export type NodeIdentityContinuityErrorCode =
  | "continuity_state_unavailable"
  | "continuity_state_locked"
  | "continuity_state_corrupt"
  | "continuity_state_operation_failed"
  /** The anchor could not be read or written; §7.5 fails closed rather than minting. */
  | "continuity_anchor_unavailable"
  /**
   * The stored value and the anchor disagree, or the anchor is unreadable.
   *
   * §5.5 U2 `statement-unavailable`: the node declines to advertise and declines
   * to mint until an operator resolves it.
   */
  | "continuity_unresolvable"
  /** The rotation's previous generation cannot be determined (§7.5 fail-closed). */
  | "continuity_generation_unavailable"
  /** The chain the append would produce does not satisfy the §7.5 chain rules. */
  | "continuity_chain_invalid";

export class NodeIdentityContinuityError extends Error {
  readonly code: NodeIdentityContinuityErrorCode;

  constructor(code: NodeIdentityContinuityErrorCode) {
    super("Node identity continuity operation failed.");
    this.name = "NodeIdentityContinuityError";
    this.code = code;
  }
}

function continuityError(code: NodeIdentityContinuityErrorCode): never {
  throw new NodeIdentityContinuityError(code);
}

/**
 * The §7.5 recovery command, in the words the operator surface must use.
 *
 * §7.5 requires the two outcomes to be offered together and the second one to
 * state its cost at the point of use, so the sentence lives with the condition
 * that raises it rather than being restated by each caller.
 */
export const E2EE_CONTINUITY_UNRESOLVABLE_REMEDY =
  "Run the node continuity recovery command and choose one outcome deliberately: re-adopt a continuity id you confirm, which keeps every existing client verification; or break continuity, which mints a fresh id and requires every paired client to verify this node again.";

const CONTINUITY_ID = /^nct_[A-Za-z0-9_-]{22}$/;

/**
 * Generous next to the ~12 KiB a full chain occupies, and deliberately so: the
 * parser preserves unknown top-level keys written by a newer binary, and a bound
 * that left no room for them would turn forward compatibility into corruption.
 */
const MAX_CONTINUITY_STATE_BYTES = 64 * 1024;

/**
 * Keys this binary owns. Everything else is round-tripped untouched.
 *
 * `generationHighWater` is listed even though this record no longer stores it:
 * the mark belongs to the anchor, and a copy in this file — left by an older
 * binary or by a restore — must be dropped rather than preserved as a forward
 * field, where it would read back as a second, restorable source of truth.
 */
const KNOWN_KEYS: ReadonlySet<string> = new Set([
  "version",
  "revision",
  "continuityId",
  "hubOrigin",
  "chain",
  "generationHighWater",
  "lastBreak",
]);

/** Never adopted as a forward field: reflecting these back would touch the prototype. */
const FORBIDDEN_FORWARD_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export type NodeIdentityContinuityBreakReason =
  /** The operator left the Hub; the identity key that anchored the chain is erased. */
  | "left_hub"
  /** An explicit operator break, including the §7.5 compromise-rotation case. */
  | "operator_break"
  /** A rotation the operator marked as a deliberate break when staging it (§7.5). */
  | "rotation_break"
  /** The §7.5 startup cross-check found restored state below what the node had issued. */
  | "rollback_detected"
  /** The startup cross-check rejected the retained chain for any other reason. */
  | "cross_check_failed"
  /** The lineage id itself was replaced, which retires every certificate carrying the old one. */
  | "continuity_id_replaced";

export interface NodeIdentityContinuityBreak {
  readonly reason: NodeIdentityContinuityBreakReason;
  readonly at: number;
  /** The rotation generation in force when the break was recorded. */
  readonly generation: number;
}

/** One carried §7.5 certificate, base64url so the record stays JSON. */
export interface NodeIdentityContinuityStoredEntry {
  readonly transcript: string;
  readonly signature: string;
}

/** What this file holds. The high-water mark is deliberately not part of it. */
interface StoredContinuityRecord {
  readonly version: 1;
  readonly revision: number;
  /** §7.6 element 18. Null only before the node has ever advertised. */
  readonly continuityId: string | null;
  /** The origin every retained certificate carries; null when the chain is empty. */
  readonly hubOrigin: string | null;
  readonly chain: readonly NodeIdentityContinuityStoredEntry[];
  readonly lastBreak: NodeIdentityContinuityBreak | null;
}

export interface NodeIdentityContinuityRecord extends StoredContinuityRecord {
  /**
   * The highest rotation generation this node has ever issued.
   *
   * Read from the §5.7 anchor, never from this record's file, because it exists
   * to police exactly the restore that replaces this record. Retained across
   * pruning and across every break, since §7.5 forbids reusing or re-issuing a
   * generation even after the chain it belonged to is gone.
   */
  readonly generationHighWater: number;
}

interface StoredContinuityFile {
  readonly record: StoredContinuityRecord;
  /** Top-level keys a newer binary wrote, preserved verbatim across this binary's writes. */
  readonly forwardFields: Readonly<Record<string, unknown>>;
}

// ─── record parsing ──────────────────────────────────────────────────────────

function isVariableBase64UrlBytes(
  value: unknown,
  minBytes: number,
  maxBytes: number,
): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength < minBytes || decoded.byteLength > maxBytes) return false;
  // The re-encode equality rule of §3.6, applied to the storage encoding: a
  // final character carrying non-zero padding bits decodes to the right length
  // but is not the string this node wrote, and admitting it would let two
  // distinct records name one certificate.
  return decoded.toString("base64url") === value;
}

function parseEntry(value: unknown): NodeIdentityContinuityStoredEntry {
  if (typeof value !== "object" || value === null) {
    return continuityError("continuity_state_corrupt");
  }
  const candidate = value as Partial<NodeIdentityContinuityStoredEntry>;
  if (
    !isVariableBase64UrlBytes(candidate.transcript, 1, E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES) ||
    !isVariableBase64UrlBytes(candidate.signature, ED25519_SIGNATURE_BYTES, ED25519_SIGNATURE_BYTES)
  ) {
    return continuityError("continuity_state_corrupt");
  }
  return { transcript: candidate.transcript, signature: candidate.signature };
}

function parseBreak(value: unknown): NodeIdentityContinuityBreak | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object") return continuityError("continuity_state_corrupt");
  const candidate = value as Partial<NodeIdentityContinuityBreak>;
  const reasons: ReadonlySet<string> = new Set([
    "left_hub",
    "operator_break",
    "rotation_break",
    "rollback_detected",
    "cross_check_failed",
    "continuity_id_replaced",
  ]);
  const at = candidate.at;
  const generation = candidate.generation;
  if (
    typeof candidate.reason !== "string" ||
    !reasons.has(candidate.reason) ||
    typeof at !== "number" ||
    !Number.isSafeInteger(at) ||
    at < 0 ||
    typeof generation !== "number" ||
    !Number.isSafeInteger(generation) ||
    generation < 0
  ) {
    return continuityError("continuity_state_corrupt");
  }
  return { reason: candidate.reason as NodeIdentityContinuityBreakReason, at, generation };
}

function parseFile(value: unknown): StoredContinuityFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return continuityError("continuity_state_corrupt");
  }
  const candidate = value as Partial<StoredContinuityRecord> & Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    !Number.isSafeInteger(candidate.revision) ||
    Number(candidate.revision) < 0 ||
    !Array.isArray(candidate.chain) ||
    candidate.chain.length > E2EE_CONTINUITY_CHAIN_MAX_LENGTH
  ) {
    return continuityError("continuity_state_corrupt");
  }
  if (
    candidate.continuityId !== undefined &&
    candidate.continuityId !== null &&
    (typeof candidate.continuityId !== "string" || !CONTINUITY_ID.test(candidate.continuityId))
  ) {
    return continuityError("continuity_state_corrupt");
  }
  let hubOrigin: string | null = null;
  if (candidate.hubOrigin !== undefined && candidate.hubOrigin !== null) {
    try {
      hubOrigin = canonicalizeHubOrigin(candidate.hubOrigin);
    } catch {
      return continuityError("continuity_state_corrupt");
    }
  }
  const chain = candidate.chain.map((entry) => parseEntry(entry));
  // A chain cannot exist without the lineage it belongs to: every entry carries
  // the continuity id as a signed element, so a record naming certificates but
  // no id could not have been written by a conforming node.
  if (chain.length > 0 && (candidate.continuityId == null || hubOrigin === null)) {
    return continuityError("continuity_state_corrupt");
  }
  const forwardFields: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(candidate)) {
    if (KNOWN_KEYS.has(key) || FORBIDDEN_FORWARD_KEYS.has(key)) continue;
    forwardFields[key] = entry;
  }
  return {
    record: {
      version: 1,
      revision: candidate.revision as number,
      continuityId: candidate.continuityId ?? null,
      hubOrigin,
      chain,
      lastBreak: parseBreak(candidate.lastBreak),
    },
    forwardFields,
  };
}

function encodeFile(file: StoredContinuityFile): unknown {
  // Forward fields first so a key this binary owns can never be shadowed by a
  // stale value a newer binary happened to write under the same name.
  return { ...file.forwardFields, ...file.record };
}

function initialFile(): StoredContinuityFile {
  return {
    record: {
      version: 1,
      revision: 0,
      continuityId: null,
      hubOrigin: null,
      chain: [],
      lastBreak: null,
    },
    forwardFields: {},
  };
}

// ─── the §7.5 startup cross-check ────────────────────────────────────────────

export type NodeIdentityContinuityChainBreak =
  /** Restored state sits below a generation this node had already issued (§7.5). */
  | "rolled_back"
  /** The newest certificate does not name a key this node currently holds (§7.5). */
  | "identity_key_mismatch"
  /** The retained chain belongs to a different Hub origin than the one being served. */
  | "hub_origin_changed"
  /** The retained chain does not satisfy the §7.5 chain rules at all. */
  | "chain_invalid";

export type NodeIdentityContinuityChainStatus =
  | {
      readonly status: "intact";
      readonly entries: readonly NodeIdentityContinuityChainEntry[];
      readonly generation: number;
    }
  | { readonly status: "broken"; readonly reason: NodeIdentityContinuityChainBreak };

export function decodeContinuityEntries(
  chain: readonly NodeIdentityContinuityStoredEntry[],
): readonly NodeIdentityContinuityChainEntry[] {
  return chain.map((entry) => ({
    transcript: Uint8Array.from(Buffer.from(entry.transcript, "base64url")),
    signature: Uint8Array.from(Buffer.from(entry.signature, "base64url")),
  }));
}

/**
 * §7.5's "backup rollback fails closed", evaluated against what the node holds.
 *
 * The chain rules themselves are NOT re-implemented here: the walk, the
 * signatures, the fingerprint recomputation, the consecutive generations, and
 * the link equality all come from the Phase 1 validator, which is the same code
 * a client runs against this node's advertisement. What this adds is the three
 * node-local comparisons a client cannot make — the retained generation against
 * the durable high-water mark, the retained origin against the origin being
 * served, and the newest certificate against the identity key the node actually
 * holds.
 *
 * `record.generationHighWater` MUST be the value the §5.7 anchor holds, which
 * is what the store's `read` supplies. Comparing a chain against a mark that
 * the same restore could have rolled back detects nothing, and that comparison
 * is the entire point of this check.
 *
 * `stagedIdentityPublicKey` is what keeps an honest rotation from reading as a
 * rollback. §7.5 requires the certificate to be durable *before* the promotion
 * it describes completes, so there is a legitimate window in which the chain
 * already ends at the incoming key while the identity record still names the
 * outgoing one. During that window the incoming key is staged and held, so
 * accepting it is not a relaxation: it is the only reading under which the
 * required write ordering is observable.
 *
 * Either key may be `undefined`: the node's state names key material it no
 * longer holds. That is a condition with a defined §7.5 answer — a chain that
 * reaches no key in custody is a broken chain, `identity_key_mismatch` — and not
 * a reason to fail an operation whose caller has only the two statuses below to
 * act on.
 */
export function nodeIdentityContinuityChainStatus(input: {
  readonly record: NodeIdentityContinuityRecord;
  readonly continuityId: string;
  readonly hubOrigin: string;
  readonly activeIdentityPublicKey: Uint8Array | undefined;
  readonly stagedIdentityPublicKey?: Uint8Array | undefined;
}): NodeIdentityContinuityChainStatus {
  const { record } = input;
  if (record.chain.length === 0) {
    // An empty chain is the ordinary state of a node that has never rotated, and
    // it is also what a recorded break leaves behind. The two are separated by
    // the break marker: a high-water mark above zero with no break recorded
    // means certificates this node issued are simply gone.
    if (record.generationHighWater > 0 && record.lastBreak === null) {
      return { status: "broken", reason: "rolled_back" };
    }
    return { status: "intact", entries: [], generation: record.generationHighWater };
  }
  if (record.hubOrigin !== input.hubOrigin) {
    return { status: "broken", reason: "hub_origin_changed" };
  }
  const entries = decodeContinuityEntries(record.chain);
  const validateAgainst = (identityPublicKey: Uint8Array) =>
    validateNodeE2eeContinuityChain({
      chain: entries,
      hubOrigin: input.hubOrigin,
      continuityId: input.continuityId,
      identityPublicKey,
    });

  // In custody order: the key the record calls active, then the staged
  // successor. A node holding neither cannot be reached by this chain at all.
  const held = [input.activeIdentityPublicKey, input.stagedIdentityPublicKey].filter(
    (key): key is Uint8Array => key !== undefined,
  );
  const primary = held[0];
  if (primary === undefined) return { status: "broken", reason: "identity_key_mismatch" };
  let result = validateAgainst(primary);
  const fallback = held[1];
  if (
    result.kind === "error" &&
    result.failure === "identity_key_mismatch" &&
    fallback !== undefined
  ) {
    result = validateAgainst(fallback);
  }
  if (result.kind === "error") {
    return {
      status: "broken",
      reason:
        result.failure === "identity_key_mismatch" ? "identity_key_mismatch" : "chain_invalid",
    };
  }
  const newest = result.certificates[result.certificates.length - 1];
  if (newest === undefined) return { status: "broken", reason: "chain_invalid" };
  // The durable high-water mark is the half of the rollback check the chain
  // cannot make about itself: a chain truncated back to an earlier, internally
  // valid state still reads as consistent to the validator.
  //
  // Only a mark ABOVE the chain is a rollback. A mark below it is the crash
  // window between retaining a certificate and advancing the mark — the store
  // heals that on load, and reading it as a break here would turn a power cut
  // into a fleet-wide re-verification.
  if (record.generationHighWater > newest.generation) {
    return { status: "broken", reason: "rolled_back" };
  }
  return { status: "intact", entries, generation: newest.generation };
}

// ─── the continuity id and its anchor ────────────────────────────────────────

export type NodeIdentityContinuityRepair =
  /** Anchor set, stored value absent: the stored copy was restored from the anchor. */
  | "restored_from_anchor"
  /** Anchor absent, stored value present: the stored value was adopted into the anchor. */
  | "anchor_adopted";

export type NodeIdentityContinuityUnresolvable = "anchor_disagrees" | "anchor_unreadable";

export type NodeIdentityContinuityResolution =
  | {
      readonly status: "resolved";
      readonly continuityId: string;
      readonly repair: NodeIdentityContinuityRepair | null;
      readonly minted: boolean;
      /**
       * The record as it stands after any repair this resolution committed.
       *
       * Returned rather than left to a second call so that the cross-check runs
       * against one snapshot taken under one lock acquisition: re-reading would
       * let a rotation land between the two and be judged against the wrong
       * lineage.
       */
      readonly record: NodeIdentityContinuityRecord;
    }
  | {
      readonly status: "unresolvable";
      readonly reason: NodeIdentityContinuityUnresolvable;
      readonly remedy: string;
    };

export interface NodeIdentityContinuityAppendInput {
  readonly hubOrigin: string;
  readonly continuityId: string;
  readonly oldKeyId: string;
  readonly oldPublicKey: Uint8Array;
  readonly newKeyId: string;
  readonly newPublicKey: Uint8Array;
  readonly createdAt: number;
  /** Signs with the OUTGOING identity key. Called while that key still exists (§7.5). */
  readonly sign: (transcript: Uint8Array) => Promise<Uint8Array>;
}

export interface NodeIdentityContinuityAppendResult {
  readonly generation: number;
  readonly chain: readonly NodeIdentityContinuityChainEntry[];
  /** True when the append displaced the oldest retained certificate (§7.5 pruning). */
  readonly pruned: boolean;
}

export interface NodeIdentityContinuityStore {
  readonly read: () => Promise<NodeIdentityContinuityRecord>;
  /**
   * The §7.5 startup cross-check for the continuity id, including its mint.
   *
   * Minting happens here and nowhere else, exactly once, anchor first. Callers
   * MUST NOT call this before the node has an identity to advertise: the anchor
   * is what distinguishes "has never advertised" from "advertised and was rolled
   * back", and creating one for a node that will never advertise would bind the
   * protected-store class for nothing.
   */
  readonly resolveContinuityId: () => Promise<NodeIdentityContinuityResolution>;
  /** Issue and durably retain one §7.5 certificate. Returns before the caller may destroy the old key. */
  readonly append: (
    input: NodeIdentityContinuityAppendInput,
  ) => Promise<NodeIdentityContinuityAppendResult>;
  /** Record an explicit break: the chain is dropped, the lineage and the high-water mark are kept. */
  readonly recordBreak: (input: {
    readonly reason: NodeIdentityContinuityBreakReason;
    readonly at: number;
  }) => Promise<NodeIdentityContinuityRecord>;
  /** §7.5 recovery, outcome one: re-adopt a continuity id the operator confirms. */
  readonly adoptContinuityId: (continuityId: string, at: number) => Promise<string>;
  /** §7.5 recovery, outcome two: deliberately break continuity and mint a fresh id. */
  readonly breakAndRemint: (input: {
    readonly reason: NodeIdentityContinuityBreakReason;
    readonly at: number;
  }) => Promise<string>;
}

const FAILURE_CODES: Readonly<Record<ProtectedStateFileFailure, NodeIdentityContinuityErrorCode>> =
  {
    unavailable: "continuity_state_unavailable",
    locked: "continuity_state_locked",
    corrupt: "continuity_state_corrupt",
    operation_failed: "continuity_state_operation_failed",
  };

function mintContinuityId(): string {
  return `nct_${randomBytes(16).toString("base64url")}`;
}

/** What an anchor that has never been written means: nothing advertised, nothing issued. */
const EMPTY_ANCHOR: NodeContinuityAnchorRecord = {
  continuityId: null,
  generationHighWater: 0,
  pendingGeneration: 0,
};

export async function makeNodeIdentityContinuityStore(options: {
  readonly path: string;
  readonly anchor: NodeContinuityAnchor;
}): Promise<NodeIdentityContinuityStore> {
  const file = await openProtectedStateFile({
    path: options.path,
    maxBytes: MAX_CONTINUITY_STATE_BYTES,
    fail: (failure) => continuityError(FAILURE_CODES[failure]),
  });

  const load = async (): Promise<StoredContinuityFile> => {
    const raw = await file.readJson();
    if (raw !== null) return parseFile(raw);
    const initial = initialFile();
    await file.writeJson(encodeFile(initial));
    return initial;
  };

  const commit = async (
    current: StoredContinuityFile,
    change: Partial<Omit<StoredContinuityRecord, "version" | "revision">>,
  ): Promise<StoredContinuityRecord> => {
    const next: StoredContinuityFile = {
      record: { ...current.record, ...change, revision: current.record.revision + 1 },
      forwardFields: current.forwardFields,
    };
    // Re-parse before writing for the same reason the identity state does: the
    // shape that reaches the disk is the shape a reader will have to accept.
    await file.writeJson(encodeFile(parseFile(encodeFile(next))));
    return next.record;
  };

  /**
   * Read the §5.7 anchor.
   *
   * A record that is present but unreadable is `unreadable`, not `absent`: §7.5
   * forbids minting whenever a stored value exists, and treating an unparseable
   * anchor as absence would be a mint dressed up as a first run. An anchor that
   * cannot be reached at all is a hard failure rather than either.
   */
  const readAnchor = async (): Promise<
    | { readonly kind: "record"; readonly value: NodeContinuityAnchorRecord }
    | { readonly kind: "unreadable" }
  > => {
    try {
      return { kind: "record", value: (await options.anchor.read()) ?? EMPTY_ANCHOR };
    } catch (error: unknown) {
      if (error instanceof NodeContinuityAnchorError && error.code === "anchor_corrupt") {
        return { kind: "unreadable" };
      }
      return continuityError("continuity_anchor_unavailable");
    }
  };

  /** Every anchor mutation runs under this file's lock, so it needs no lock of its own. */
  const writeAnchor = async (operation: () => Promise<void>): Promise<void> => {
    try {
      await operation();
    } catch {
      return continuityError("continuity_anchor_unavailable");
    }
  };

  /**
   * Replace an unreadable anchor, from an operator recovery command only.
   *
   * The high-water mark cannot be recovered from an anchor nobody can read, so
   * it is taken from the strongest remaining evidence: the newest certificate
   * the node still retains. That is a floor, not a proof — which is exactly why
   * both callers are commands that break the chain, so the generations at stake
   * belong to a lineage that already requires fresh owner verification (§7.5,
   * §13).
   */
  const resetAnchor = (continuityId: string, record: StoredContinuityRecord): Promise<void> => {
    const observed = decodeNewestCertificate(record)?.generation ?? 0;
    return writeAnchor(() =>
      options.anchor.reset({
        continuityId,
        generationHighWater: observed,
        pendingGeneration: observed,
      }),
    );
  };

  const withHighWater = (
    record: StoredContinuityRecord,
    anchor: NodeContinuityAnchorRecord,
  ): NodeIdentityContinuityRecord => ({
    ...record,
    generationHighWater: anchor.generationHighWater,
  });

  /**
   * The record and the anchor, as one consistent pair.
   *
   * Repairs the one direction of disagreement that is not a rollback: a
   * certificate that reached the chain before the mark reached the anchor,
   * which is what a crash inside `append` leaves. The chain is the evidence
   * here — a retained certificate is one this node issued — so the mark is
   * raised to meet it, never the other way around, and never lowered.
   */
  const loadWithAnchor = async (): Promise<{
    readonly current: StoredContinuityFile;
    readonly anchor: NodeContinuityAnchorRecord | null;
  }> => {
    const current = await load();
    const read = await readAnchor();
    if (read.kind === "unreadable") return { current, anchor: null };
    const newest = decodeNewestCertificate(current.record);
    if (newest === null || newest.generation <= read.value.generationHighWater) {
      return { current, anchor: read.value };
    }
    await writeAnchor(() => options.anchor.commitGeneration(newest.generation));
    return {
      current,
      anchor: {
        ...read.value,
        generationHighWater: newest.generation,
        pendingGeneration: Math.max(read.value.pendingGeneration, newest.generation),
      },
    };
  };

  const read: NodeIdentityContinuityStore["read"] = () =>
    file.withLock(async () => {
      const { current, anchor } = await loadWithAnchor();
      if (anchor === null) return continuityError("continuity_unresolvable");
      return withHighWater(current.record, anchor);
    });

  const resolveContinuityId: NodeIdentityContinuityStore["resolveContinuityId"] = () =>
    file.withLock(async () => {
      const { current, anchor } = await loadWithAnchor();
      const stored = current.record.continuityId;

      if (anchor === null) {
        return {
          status: "unresolvable",
          reason: "anchor_unreadable",
          remedy: E2EE_CONTINUITY_UNRESOLVABLE_REMEDY,
        } as const;
      }
      const anchored = anchor.continuityId;

      if (anchored !== null) {
        if (stored === anchored) {
          return {
            status: "resolved",
            continuityId: stored,
            repair: null,
            minted: false,
            record: withHighWater(current.record, anchor),
          } as const;
        }
        if (stored === null) {
          // The benign restore of §17.11: the stored copy rolled back, the
          // anchor did not. Repair silently on the wire — the node re-advertises
          // the identical id and no client sees an identity event — and record
          // the repair for the operator.
          const record = await commit(current, { continuityId: anchored });
          return {
            status: "resolved",
            continuityId: anchored,
            repair: "restored_from_anchor",
            minted: false,
            record: withHighWater(record, anchor),
          } as const;
        }
        return {
          status: "unresolvable",
          reason: "anchor_disagrees",
          remedy: E2EE_CONTINUITY_UNRESOLVABLE_REMEDY,
        } as const;
      }

      if (stored !== null) {
        // Anchor lost, value kept. Adopting is mandatory and minting is
        // forbidden: a stored value exists, so this lineage is already decided.
        await writeAnchor(() => options.anchor.setContinuityId(stored));
        return {
          status: "resolved",
          continuityId: stored,
          repair: "anchor_adopted",
          minted: false,
          record: withHighWater(current.record, anchor),
        } as const;
      }

      // Neither exists: the node has never advertised. Anchor first, so a crash
      // between the two leaves the anchor-set/stored-absent case above, which
      // restores the identical value rather than minting a second one.
      const minted = mintContinuityId();
      await writeAnchor(() => options.anchor.setContinuityId(minted));
      const record = await commit(current, { continuityId: minted });
      return {
        status: "resolved",
        continuityId: minted,
        repair: null,
        minted: true,
        record: withHighWater(record, anchor),
      } as const;
    });

  const append: NodeIdentityContinuityStore["append"] = (input) =>
    file.withLock(async () => {
      const { current, anchor } = await loadWithAnchor();
      if (anchor === null) return continuityError("continuity_unresolvable");
      const record = current.record;
      let hubOrigin: string;
      try {
        hubOrigin = canonicalizeHubOrigin(input.hubOrigin);
      } catch {
        return continuityError("continuity_chain_invalid");
      }
      if (record.continuityId !== null && record.continuityId !== input.continuityId) {
        return continuityError("continuity_state_operation_failed");
      }
      if (record.chain.length > 0 && record.hubOrigin !== hubOrigin) {
        // The retained chain belongs to another Hub origin. §7.5 requires one
        // origin across every entry, so continuing here would produce a chain no
        // verifier accepts; the caller must record the break first.
        return continuityError("continuity_chain_invalid");
      }
      const highWater = anchor.generationHighWater;

      const newest = record.chain.length === 0 ? null : decodeNewestCertificate(record);
      // Idempotent on the old-to-new pair. The promotion this certificate
      // describes is committed after it, so a retry after any failure between
      // the two arrives here with the work already done: appending a second
      // certificate for one rotation would produce a chain whose links no
      // longer meet (the duplicate's old key is not its predecessor's new key),
      // wedging every later retry, and bumping the mark a second time would
      // skip a generation §7.5 forbids skipping.
      if (
        newest !== null &&
        newest.hubOrigin === hubOrigin &&
        newest.continuityId === input.continuityId &&
        newest.oldKeyId === input.oldKeyId &&
        newest.newKeyId === input.newKeyId &&
        e2eeBytesEqual(newest.oldPublicKey, input.oldPublicKey) &&
        e2eeBytesEqual(newest.newPublicKey, input.newPublicKey)
      ) {
        // The mark is already at or above this generation: `loadWithAnchor`
        // raised it to the retained chain before this point, which is the other
        // half of what a crash inside this operation can leave behind.
        return {
          generation: newest.generation,
          chain: decodeContinuityEntries(record.chain),
          pruned: false,
        };
      }
      // §7.5: a node that cannot determine the previous generation MUST NOT
      // issue a certificate. A retained chain whose newest generation disagrees
      // with the durable high-water mark is exactly that condition.
      if (newest !== null && newest.generation !== highWater) {
        return continuityError("continuity_generation_unavailable");
      }
      // The anchor's reservation is what makes this safe against a crash
      // between signing and committing: `pendingGeneration` already covers the
      // value, so the retry reuses it rather than skipping past a certificate
      // that was never retained and never advertised.
      const generation = highWater + 1;
      await writeAnchor(() => options.anchor.reserveGeneration(generation));

      let transcript: Uint8Array;
      try {
        transcript = encodeNodeIdentityContinuityTranscript({
          hubOrigin,
          continuityId: input.continuityId,
          generation,
          oldKeyId: input.oldKeyId,
          oldPublicKey: input.oldPublicKey,
          newKeyId: input.newKeyId,
          newPublicKey: input.newPublicKey,
          createdAt: input.createdAt,
        });
      } catch {
        return continuityError("continuity_chain_invalid");
      }
      const signature = await input.sign(transcript);

      const entry: NodeIdentityContinuityStoredEntry = {
        transcript: Buffer.from(transcript).toString("base64url"),
        signature: Buffer.from(signature).toString("base64url"),
      };
      // §7.5 retention: keep the most recent `E2EE_CONTINUITY_CHAIN_MAX_LENGTH`,
      // removing only the oldest and only when appending beyond the bound.
      const appended = [...record.chain, entry];
      const pruned = appended.length > E2EE_CONTINUITY_CHAIN_MAX_LENGTH;
      const chain = pruned
        ? appended.slice(appended.length - E2EE_CONTINUITY_CHAIN_MAX_LENGTH)
        : appended;

      const entries = decodeContinuityEntries(chain);
      const validated = validateNodeE2eeContinuityChain({
        chain: entries,
        hubOrigin,
        continuityId: input.continuityId,
        identityPublicKey: input.newPublicKey,
      });
      // Nothing is committed unless the chain a client would walk verifies. A
      // certificate this node cannot validate is not evidence it may advertise,
      // and failing here leaves the rotation to break the chain deliberately
      // rather than to carry a link no verifier accepts.
      if (validated.kind === "error") return continuityError("continuity_chain_invalid");

      // Chain first, mark second. The reverse order would let a crash between
      // them leave a mark above a chain that never received the certificate,
      // which the startup cross-check reads as a rollback — a fleet-wide
      // re-verification caused by a power cut. This order leaves the opposite
      // and benign state, which the idempotent path above heals on the retry
      // and `read` heals on the next pass.
      await commit(current, { chain, hubOrigin });
      await writeAnchor(() => options.anchor.commitGeneration(generation));
      return { generation, chain: entries, pruned };
    });

  const recordBreak: NodeIdentityContinuityStore["recordBreak"] = (input) =>
    file.withLock(async () => {
      const { current, anchor } = await loadWithAnchor();
      if (anchor === null) return continuityError("continuity_unresolvable");
      const record = current.record;
      // Idempotent: a resumed teardown or a second startup pass must not rewrite
      // a break it already recorded, and the reason of record is the first one.
      if (record.chain.length === 0 && record.lastBreak?.reason === input.reason) {
        return withHighWater(record, anchor);
      }
      // The mark is untouched. §7.5 keeps it across every break precisely so a
      // post-break rotation cannot land on a generation this node already
      // issued, and it lives in the anchor, so dropping the chain cannot lower
      // it even by accident.
      const next = await commit(current, {
        chain: [],
        hubOrigin: null,
        lastBreak: {
          reason: input.reason,
          at: input.at,
          generation: anchor.generationHighWater,
        },
      });
      return withHighWater(next, anchor);
    });

  const adoptContinuityId: NodeIdentityContinuityStore["adoptContinuityId"] = (continuityId, at) =>
    file.withLock(async () => {
      if (!CONTINUITY_ID.test(continuityId)) {
        return continuityError("continuity_state_operation_failed");
      }
      const { current, anchor } = await loadWithAnchor();
      const unchanged = current.record.continuityId === continuityId;
      // The anchor moves first, so a crash between the two writes leaves the
      // anchor-set/stored-absent case, which restores the confirmed value
      // rather than resurrecting the one the operator rejected.
      if (anchor === null) {
        await resetAnchor(continuityId, current.record);
      } else if (anchor.continuityId !== continuityId) {
        await writeAnchor(() => options.anchor.setContinuityId(continuityId));
      }
      if (unchanged) {
        await commit(current, { continuityId });
        return continuityId;
      }
      // Every retained certificate carries the previous id as a signed element,
      // so adopting a different lineage retires the chain rather than renaming
      // it. §7.5 forbids fabricating a substitute link, and rewriting is exactly
      // that.
      await commit(current, {
        continuityId,
        chain: [],
        hubOrigin: null,
        lastBreak: {
          reason: "continuity_id_replaced",
          at,
          generation: anchor?.generationHighWater ?? 0,
        },
      });
      return continuityId;
    });

  const breakAndRemint: NodeIdentityContinuityStore["breakAndRemint"] = (input) =>
    file.withLock(async () => {
      const { current, anchor } = await loadWithAnchor();
      // Ordered so that every crash point lands on a state the §7.5 startup
      // cross-check resolves without operator input, and never on two values
      // claiming the lineage:
      //   after (1) — anchor set, stored absent  → restored from the anchor, i.e.
      //               the old id survives and the operator re-runs the command;
      //   after (2) — neither set                → mint once, which is the
      //               intended outcome;
      //   after (3) — anchor set, stored absent  → restored from the anchor, now
      //               the new id.
      const cleared = await commit(current, {
        continuityId: null,
        chain: [],
        hubOrigin: null,
        lastBreak: {
          reason: input.reason,
          at: input.at,
          generation: anchor?.generationHighWater ?? 0,
        },
      });
      const minted = mintContinuityId();
      if (anchor === null) {
        await resetAnchor(minted, current.record);
      } else {
        await writeAnchor(() => options.anchor.setContinuityId(null));
        await writeAnchor(() => options.anchor.setContinuityId(minted));
      }
      await commit(
        { record: cleared, forwardFields: current.forwardFields },
        {
          continuityId: minted,
        },
      );
      return minted;
    });

  return { read, resolveContinuityId, append, recordBreak, adoptContinuityId, breakAndRemint };
}

/**
 * The newest retained certificate, or `null` when it cannot be read back.
 *
 * VERIFIED, NOT MERELY DECODED — and it is worth being exact about what that
 * does and does not buy. Every caller uses the generation this returns to move
 * something that only ever moves up: the §5.7 high-water mark, the reservation,
 * or the floor a recovery reset writes. A decoder alone checks shape and
 * recomputes fingerprints; the signature check adds that the transcript and the
 * signature cohere under the outgoing key the transcript itself names, which is
 * precisely the rule the Phase 1 chain walk applies to the same entry. So this
 * function cannot accept an entry the chain walk would reject, and it rejects
 * the entries a storage fault produces: a truncated or bit-flipped transcript,
 * a signature copied from a different entry, half of one certificate spliced
 * onto another.
 *
 * It is NOT an authenticity check against whoever wrote the file. The key the
 * signature is verified under is named by the same entry, so a party that can
 * write this record can also generate a keypair, sign a transcript claiming
 * generation 2^40, and raise the mark past every generation this node can
 * legitimately issue. That is not a gap this check could close, and it is not
 * the boundary that defends it: the record is owner-only, and a party that can
 * write it already holds the node's durable security state — including the
 * identity state and the protected-store handles — and has cheaper ways to stop
 * the node than wedging its rotation counter. What the anchor's placement
 * outside the restorable state set defends against is a RESTORE, which is the
 * threat §5.7 names, and that defence does not rest on this function.
 *
 * It is deliberately still not a second chain walk: the chain rules are checked
 * against the resulting chain by the Phase 1 validator, and duplicating them
 * here would be two implementations of one specification. An entry that will not
 * decode or will not verify is reported as "cannot determine", which the caller
 * turns into the §7.5 fail-closed refusal rather than a guess.
 */
function decodeNewestCertificate(record: {
  readonly chain: readonly NodeIdentityContinuityStoredEntry[];
}): NodeIdentityContinuityCertificate | null {
  const entries = decodeContinuityEntries(record.chain);
  const newest = entries[entries.length - 1];
  if (newest === undefined) return null;
  const decoded = decodeNodeIdentityContinuityTranscript(newest.transcript);
  if (decoded.kind !== "ok") return null;
  if (
    !verifyE2eeSignature({
      algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
      publicKey: decoded.value.oldPublicKey,
      message: newest.transcript,
      signature: newest.signature,
    })
  ) {
    return null;
  }
  return decoded.value;
}

/**
 * The newest retained certificate of a record read through `read`.
 *
 * Exported for the promotion path, which needs the outgoing key's PUBLIC half to
 * retry an interrupted certificate issuance and must be able to obtain it
 * without the secret half — the point of the retry is that the secret may
 * already be gone. Same verification, same "cannot determine" result.
 */
export function newestRetainedContinuityCertificate(record: {
  readonly chain: readonly NodeIdentityContinuityStoredEntry[];
}): NodeIdentityContinuityCertificate | null {
  return decodeNewestCertificate(record);
}
