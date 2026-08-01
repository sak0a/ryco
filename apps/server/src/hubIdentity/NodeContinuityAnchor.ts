import { openProtectedStateFile, type ProtectedStateFile } from "./ProtectedStateFile.ts";

// The §7.5 continuity anchor and the §5.7 policy-generation anchor —
// docs/relay-e2ee-protocol.md §7.5 (the continuity-id anchor) and §5.7 (the two
// properties every high-water anchor must have, and the policy-generation mark
// itself).
//
// WHAT AN ANCHOR IS FOR. §5.7 requires a durable mark that is (a) updated
// crash-atomically and (b) resident outside the operator-restorable state and
// configuration set. Property (b) is the whole point: it is what distinguishes
// "this node has never advertised" from "this node advertised and its stored
// copy was rolled back", and what stops a restored backup from lowering a
// generation the node has already issued. A mark that a restore replaces
// alongside the state it polices proves nothing.
//
// WHY THIS IS A FILE OF ITS OWN, AND NOT THE PROTECTED SECRET STORE. The
// protected secret store is create-only — `get`, `create`, `remove`, with
// `create` conflicting on an existing name — so it cannot express a
// monotonically advancing counter without a remove-then-create window that is
// not crash-atomic, which fails property (a) for the rotation-generation mark.
// Its OS backends do satisfy property (b), but its permissioned-file backend
// does not: that root is caller-chosen and the connector derives it from the
// state directory. A record of this module's own, under a caller-chosen root
// that the connector places OUTSIDE the state directory, satisfies both
// properties on every backend and for every value that needs them, so they all
// live here together.
//
// WHY THE §5.7 POLICY GENERATION IS HERE TOO, AND NOT IN A SECOND ANCHOR. §5.7
// asks for the same two properties for the policy-generation high-water mark as
// §7.5 asks for the rotation generation, in the same paragraph. A second anchor
// file would be a second copy of the placement argument, a second
// crash-atomicity argument, and a second thing an operator can move or restore
// out from under the first — and the failure that would cause, a generation the
// node has advertised that no mark records, is precisely the one an anchor
// exists to prevent. One file, two independent monotone pairs, no shared
// arithmetic between them.
//
// What that does NOT buy: immunity from an operator who deletes or restores the
// whole base directory, or from a disk image rollback. Nothing durable on the
// node is immune to those, and §5.7 does not ask for it — the property it names
// is residence outside the state and configuration set a restore replaces, and
// its own note pins that set to the server state directory. A total wipe leaves
// no anchor and no stored value, which reads as "this node has never
// advertised" and is the correct reading of a node that has nothing left.
//
// The anchor holds no secret. §7.5 is explicit that the continuity id travels
// in cleartext in every statement the Hub relays; what the anchor buys is
// existence and integrity, not confidentiality. It is owner-only all the same,
// because integrity is exactly what it is for.
//
// CONCURRENCY. Every mutation here takes this file's own single-writer lock,
// and every one of them is a read-modify-write of the WHOLE record. That lock is
// not redundant with the callers' locks, and the reason is the paragraph above:
// the two monotone pairs are reached from two different records, so the
// continuity lineage's lock is held for one of them and the §12.6 policy
// record's lock for the other, and neither excludes the other. Without a lock
// here a policy-generation commit and a continuity-id write racing on this one
// file would each write back the record they read, and one of the two marks
// would be silently rolled back — the exact failure the anchor is for.
//
// This lock is always the LEAF: callers take their own record's lock and then
// reach the anchor, never the reverse, so there is one acquisition order and no
// cycle. Nothing in this module calls back into a caller.

export type NodeContinuityAnchorErrorCode =
  /** The anchor could not be read or written at all. */
  | "anchor_unavailable"
  /** The anchor exists but is not a record this binary can read (§7.5: never mint over it). */
  | "anchor_corrupt";

export class NodeContinuityAnchorError extends Error {
  readonly code: NodeContinuityAnchorErrorCode;

  constructor(code: NodeContinuityAnchorErrorCode) {
    super("Node continuity anchor operation failed.");
    this.name = "NodeContinuityAnchorError";
    this.code = code;
  }
}

function anchorError(code: NodeContinuityAnchorErrorCode): never {
  throw new NodeContinuityAnchorError(code);
}

const CONTINUITY_ID = /^nct_[A-Za-z0-9_-]{22}$/;

/** Small by construction: two scalars and an id, plus room for a newer binary's fields. */
const MAX_ANCHOR_BYTES = 8 * 1024;

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  "version",
  "continuityId",
  "generationHighWater",
  "pendingGeneration",
  "policyGenerationHighWater",
  "pendingPolicyGeneration",
]);

const FORBIDDEN_FORWARD_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export interface NodeContinuityAnchorRecord {
  /** The continuity id this node has advertised, or null before it ever has. */
  readonly continuityId: string | null;
  /**
   * The highest rotation generation this node has COMMITTED to its chain (§7.5).
   *
   * Advanced only after the certificate carrying it is durable, so it never
   * accuses an interrupted rotation of being a rollback.
   */
  readonly generationHighWater: number;
  /**
   * The highest generation this node has ever begun issuing (§5.7 property (a)).
   *
   * Reserved before the certificate is signed, so no generation is ever signed
   * without a durable mark at or above it. It is never used to declare a
   * rollback — only `generationHighWater` is — because the gap between the two
   * is exactly what an interrupted rotation looks like.
   */
  readonly pendingGeneration: number;
  /**
   * The highest §5.7 POLICY generation this node has durably committed.
   *
   * Read by the startup cross-check: a stored policy record whose generation is
   * below this mark was rolled back, which §5.7 makes a hard startup condition
   * rather than a silently reusable value.
   */
  readonly policyGenerationHighWater: number;
  /**
   * The highest policy generation this node has ever begun issuing.
   *
   * Reserved before the policy record carrying it is written, which is what
   * satisfies §5.7's "updated crash-atomically BEFORE the corresponding
   * generation is first advertised". Like `pendingGeneration` it never declares
   * a rollback on its own: a crash between the reservation and the commit leaves
   * it above `policyGenerationHighWater`, and that gap is an interrupted change,
   * not evidence of a restore. The recovery command reads it so the value it
   * jumps to is above anything that may have been advertised.
   */
  readonly pendingPolicyGeneration: number;
}

interface StoredAnchorFile {
  readonly record: NodeContinuityAnchorRecord;
  readonly forwardFields: Readonly<Record<string, unknown>>;
}

export interface NodeContinuityAnchor {
  /** `null` when no anchor has ever been written. Throws `anchor_corrupt` when one cannot be read. */
  readonly read: () => Promise<NodeContinuityAnchorRecord | null>;
  /** Set or clear the anchored continuity id. Crash-atomic. */
  readonly setContinuityId: (continuityId: string | null) => Promise<void>;
  /** Record that `generation` is about to be signed. Monotonic; never lowers the mark. */
  readonly reserveGeneration: (generation: number) => Promise<void>;
  /** Record that `generation` is durably part of the chain. Monotonic. */
  readonly commitGeneration: (generation: number) => Promise<void>;
  /**
   * Record that a §5.7 policy generation is about to be committed and advertised.
   *
   * MUST return before the policy record carrying it is written; that ordering
   * is the whole of §5.7's crash-atomicity requirement for this mark.
   */
  readonly reservePolicyGeneration: (generation: number) => Promise<void>;
  /** Record that a policy generation is durably held by the policy record. Monotonic. */
  readonly commitPolicyGeneration: (generation: number) => Promise<void>;
  /**
   * Replace an anchor this binary cannot read, for the §7.5 continuity pair only.
   *
   * The only way out of §7.5's `anchor_unreadable` state — which the recovery
   * command exists to resolve and which every other operation here fails closed
   * on. It is therefore reachable only from that command, never from a startup
   * path, and the caller is responsible for supplying a mark no lower than any
   * evidence it still holds.
   *
   * IT TAKES ONLY THE PAIR ITS CALLER OWNS, AND IT LOWERS NOTHING. An earlier
   * shape took the whole record, so the continuity-driven repair passed zero for
   * the §5.7 policy pair it holds no evidence for, and the argument offered for
   * that was that the policy record is its own evidence — the cross-check raises
   * the mark to meet it. The argument is circular: the policy record lives in
   * the operator-restorable state directory and the mark does not, and the ONLY
   * thing that can tell a restored record from a current one is the mark. Zero it
   * and a restored policy record is silently blessed at whatever generation the
   * restore carried, which is precisely the rollback the anchor exists to make
   * unmistakable. So the policy pair is salvaged from whatever the existing file
   * still yields and never lowered; a file that yields nothing leaves it at zero,
   * which reads as "this node has never advertised" — the correct reading of a
   * node that has nothing left.
   */
  readonly reset: (record: {
    readonly continuityId: string | null;
    readonly generationHighWater: number;
    readonly pendingGeneration: number;
  }) => Promise<void>;
}

function isGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * A mark an anchor written before this binary does not carry at all.
 *
 * Absent reads as zero — "nothing issued" — rather than as corruption, because
 * an anchor minted by a release that predates the §5.7 policy generation is a
 * valid anchor for everything it does record. Zero is also the safe reading: it
 * accuses nothing of a rollback, and the first policy commit lifts it.
 */
function parseAbsentableGeneration(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (!isGeneration(value)) return anchorError("anchor_corrupt");
  return value;
}

function parseFile(value: unknown): StoredAnchorFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return anchorError("anchor_corrupt");
  }
  const candidate = value as Partial<NodeContinuityAnchorRecord> & Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    !isGeneration(candidate.generationHighWater) ||
    !isGeneration(candidate.pendingGeneration) ||
    // A reservation below the committed mark could not have been written by a
    // conforming node, and reading it would understate what has been issued.
    candidate.pendingGeneration < candidate.generationHighWater
  ) {
    return anchorError("anchor_corrupt");
  }
  const policyGenerationHighWater = parseAbsentableGeneration(candidate.policyGenerationHighWater);
  const pendingPolicyGeneration = parseAbsentableGeneration(candidate.pendingPolicyGeneration);
  if (pendingPolicyGeneration < policyGenerationHighWater) {
    return anchorError("anchor_corrupt");
  }
  if (
    candidate.continuityId !== undefined &&
    candidate.continuityId !== null &&
    (typeof candidate.continuityId !== "string" || !CONTINUITY_ID.test(candidate.continuityId))
  ) {
    return anchorError("anchor_corrupt");
  }
  const forwardFields: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(candidate)) {
    if (KNOWN_KEYS.has(key) || FORBIDDEN_FORWARD_KEYS.has(key)) continue;
    forwardFields[key] = entry;
  }
  return {
    record: {
      continuityId: candidate.continuityId ?? null,
      generationHighWater: candidate.generationHighWater,
      pendingGeneration: candidate.pendingGeneration,
      policyGenerationHighWater,
      pendingPolicyGeneration,
    },
    forwardFields,
  };
}

function encodeFile(file: StoredAnchorFile): unknown {
  return { ...file.forwardFields, version: 1, ...file.record };
}

const EMPTY: StoredAnchorFile = {
  record: {
    continuityId: null,
    generationHighWater: 0,
    pendingGeneration: 0,
    policyGenerationHighWater: 0,
    pendingPolicyGeneration: 0,
  },
  forwardFields: {},
};

export async function makeNodeContinuityAnchor(options: {
  /**
   * Where the anchor lives.
   *
   * The caller MUST place this outside the state directory an operator restore
   * replaces; that placement is property (b) of §5.7 and this module cannot
   * check it.
   */
  readonly path: string;
}): Promise<NodeContinuityAnchor> {
  let file: ProtectedStateFile;
  try {
    file = await openProtectedStateFile({
      path: options.path,
      maxBytes: MAX_ANCHOR_BYTES,
      fail: (failure) =>
        anchorError(failure === "corrupt" ? "anchor_corrupt" : "anchor_unavailable"),
    });
  } catch (error: unknown) {
    if (error instanceof NodeContinuityAnchorError) throw error;
    return anchorError("anchor_unavailable");
  }

  const load = async (): Promise<StoredAnchorFile | null> => {
    const raw = await file.readJson();
    return raw === null ? null : parseFile(raw);
  };

  /**
   * The §5.7 policy marks the existing file still yields, for `reset`.
   *
   * The repair runs precisely when the record as a whole cannot be validated, so
   * this reads the two marks on their own rather than through `parseFile`: a
   * file whose continuity fields are unreadable can still carry an intact policy
   * mark, and discarding it there would hand a restored policy record a clean
   * bill of health. Only a value that is already a generation is taken — a
   * missing or malformed one reads as zero — and every mark this returns is used
   * as a floor, so a salvaged value can only ever raise what is written back.
   */
  const salvagePolicyMarks = async (): Promise<{
    readonly policyGenerationHighWater: number;
    readonly pendingPolicyGeneration: number;
  }> => {
    let raw: unknown;
    try {
      raw = await file.readJson();
    } catch {
      raw = null;
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { policyGenerationHighWater: 0, pendingPolicyGeneration: 0 };
    }
    const candidate = raw as Record<string, unknown>;
    const mark = candidate["policyGenerationHighWater"];
    const pending = candidate["pendingPolicyGeneration"];
    return {
      policyGenerationHighWater: isGeneration(mark) ? mark : 0,
      pendingPolicyGeneration: isGeneration(pending) ? pending : 0,
    };
  };

  const mutate = (
    change: (current: NodeContinuityAnchorRecord) => NodeContinuityAnchorRecord,
  ): Promise<void> =>
    // Under this file's own lock: the two monotone pairs are driven from two
    // different records with two different locks, so nothing above excludes
    // them from each other (see the CONCURRENCY note).
    file.withLock(async () => {
      const current = (await load()) ?? EMPTY;
      const next = change(current.record);
      // A no-op writes nothing, so an anchor that has never been written stays
      // unwritten. That is what keeps "this node has never advertised" — the one
      // state in which §7.5 permits a mint — distinguishable from every other.
      if (
        next.continuityId === current.record.continuityId &&
        next.generationHighWater === current.record.generationHighWater &&
        next.pendingGeneration === current.record.pendingGeneration &&
        next.policyGenerationHighWater === current.record.policyGenerationHighWater &&
        next.pendingPolicyGeneration === current.record.pendingPolicyGeneration
      ) {
        return;
      }
      await file.writeJson(encodeFile({ record: next, forwardFields: current.forwardFields }));
    });

  return {
    read: async () => (await load())?.record ?? null,
    setContinuityId: (continuityId) => mutate((current) => ({ ...current, continuityId })),
    // Every mark is monotonic in the record itself, not only in its callers:
    // a lower value reaching one of them would be the rollback these exist to
    // detect, and accepting it would erase the evidence.
    reserveGeneration: (generation) =>
      mutate((current) => ({
        ...current,
        pendingGeneration: Math.max(current.pendingGeneration, generation),
      })),
    commitGeneration: (generation) =>
      mutate((current) => ({
        ...current,
        generationHighWater: Math.max(current.generationHighWater, generation),
        pendingGeneration: Math.max(current.pendingGeneration, generation),
      })),
    reservePolicyGeneration: (generation) =>
      mutate((current) => ({
        ...current,
        pendingPolicyGeneration: Math.max(current.pendingPolicyGeneration, generation),
      })),
    commitPolicyGeneration: (generation) =>
      mutate((current) => ({
        ...current,
        policyGenerationHighWater: Math.max(current.policyGenerationHighWater, generation),
        pendingPolicyGeneration: Math.max(current.pendingPolicyGeneration, generation),
      })),
    reset: (record) =>
      file.withLock(async () => {
        const salvaged = await salvagePolicyMarks();
        await file.writeJson(
          encodeFile({
            record: {
              continuityId: record.continuityId,
              generationHighWater: record.generationHighWater,
              pendingGeneration: Math.max(record.pendingGeneration, record.generationHighWater),
              policyGenerationHighWater: salvaged.policyGenerationHighWater,
              pendingPolicyGeneration: Math.max(
                salvaged.pendingPolicyGeneration,
                salvaged.policyGenerationHighWater,
              ),
            },
            forwardFields: {},
          }),
        );
      }),
  };
}
