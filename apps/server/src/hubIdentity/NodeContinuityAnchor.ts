import { openProtectedStateFile, type ProtectedStateFile } from "./ProtectedStateFile.ts";

// The §7.5 continuity anchor — docs/relay-e2ee-protocol.md §7.5 (the
// continuity-id anchor) and §5.7 (the two properties both high-water anchors
// must have).
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
// properties on every backend and for both values, so both live here together.
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
// CONCURRENCY. This module takes no lock. Every mutation happens while the
// caller holds the continuity record's single-writer lock, which is what keeps
// the anchor and the record it anchors from being updated by two writers in
// different orders. Giving the anchor a second lock would add a second
// acquisition order and buy nothing.

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
   * Replace an anchor this binary cannot read.
   *
   * The one operation that does not read before it writes, and the only way out
   * of §7.5's `anchor_unreadable` state — which the recovery command exists to
   * resolve and which every other operation here fails closed on. It is
   * therefore reachable only from that command, never from a startup path, and
   * the caller is responsible for supplying a high-water mark no lower than any
   * evidence it still holds.
   */
  readonly reset: (record: NodeContinuityAnchorRecord) => Promise<void>;
}

function isGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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
    },
    forwardFields,
  };
}

function encodeFile(file: StoredAnchorFile): unknown {
  return { ...file.forwardFields, version: 1, ...file.record };
}

const EMPTY: StoredAnchorFile = {
  record: { continuityId: null, generationHighWater: 0, pendingGeneration: 0 },
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

  const mutate = async (
    change: (current: NodeContinuityAnchorRecord) => NodeContinuityAnchorRecord,
  ): Promise<void> => {
    const current = (await load()) ?? EMPTY;
    const next = change(current.record);
    // A no-op writes nothing, so an anchor that has never been written stays
    // unwritten. That is what keeps "this node has never advertised" — the one
    // state in which §7.5 permits a mint — distinguishable from every other.
    if (
      next.continuityId === current.record.continuityId &&
      next.generationHighWater === current.record.generationHighWater &&
      next.pendingGeneration === current.record.pendingGeneration
    ) {
      return;
    }
    await file.writeJson(encodeFile({ record: next, forwardFields: current.forwardFields }));
  };

  return {
    read: async () => (await load())?.record ?? null,
    setContinuityId: (continuityId) => mutate((current) => ({ ...current, continuityId })),
    // Both marks are monotonic in the record itself, not only in their callers:
    // a lower value reaching either of them would be the rollback these exist to
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
    reset: (record) =>
      file.writeJson(
        encodeFile({
          record: {
            ...record,
            pendingGeneration: Math.max(record.pendingGeneration, record.generationHighWater),
          },
          forwardFields: {},
        }),
      ),
  };
}
