import { createHash } from "node:crypto";

import {
  E2EE_FALLBACK_RING_SIZE,
  E2EE_FALLBACK_WRITE_INTERVAL,
  E2EE_KEY_FINGERPRINT_BYTES,
} from "@ryco/shared/relayE2eeConstants";
import {
  canonicalizeE2eeHubOrigin,
  encodeCanonicalE2eeCbor,
  E2EE_FALLBACK_ORIGIN_DOMAIN,
} from "@ryco/shared/relayE2eeTranscripts";

import { openProtectedStateFile, type ProtectedStateFileFailure } from "./ProtectedStateFile.ts";

// The §12.5 fallback-occurrence instrumentation —
// docs/relay-e2ee-protocol.md §12.5 (the two classes, the durable bounded state,
// the leading-edge coalescing, the reset authority, and the display duty) and
// §12.3 (what the maintainers read it for, and why it is not a security
// mechanism).
//
// WHAT THIS OWNS: the two occurrence counters, the two ring-overflow counters,
// the observation-window start, the per-class last-occurrence timestamps, and
// the bounded ring — durably, and with the write schedule §12.5 mandates. What
// it deliberately does NOT own is the decision to count: §12.5 counts at most
// one occurrence per channel, at row N2 for `peer-legacy` and at `channel.accept`
// for `advertisement-unavailable`, and only the mode machine knows which row
// fired. This module counts what it is told and bounds what that can cost.
//
// ─── WHAT A RING ENTRY MAY CONTAIN, AND WHY IT IS SO LITTLE ─────────────────
//
// Exactly three fields: `originHash`, the occurrence timestamp, and the reason
// label. §12.5 says the label carries no account, channel, session, key, or
// payload data, and §12.3 adds that the ring "cannot be used to attribute
// individual occurrences" and MUST NOT be widened to make attribution easier —
// so this is a cap on retention, not a starting point. The Hub origin itself is
// hashed rather than stored: telling two origins apart is the whole of what the
// display needs, and the hash gives that without the record holding an origin a
// later reader could correlate.
//
// ─── WHY THE WRITES ARE LEADING-EDGE AND NOT DEBOUNCED ──────────────────────
//
// The event is driven by unauthenticated peer input with no authentication ahead
// of it, so a crash-consistent write per occurrence would let whoever opens
// channels drive this node's durable writes at a rate of their choosing. §12.5
// therefore coalesces — but it fixes the ORDER, and the order is the opposite of
// the debounce this repository already has (`makeKeyedCoalescingWorker`'s only
// consumer sleeps BEFORE writing). The first occurrence of a class after each
// flush is committed immediately; the rest of that class's interval is
// coalesced. §12.5 states the reason and it is not a performance one: the first
// occurrence of a class in a window is the one that puts that class in front of
// the maintainers at all, so losing it to a crash removes a whole class from the
// §12.3 review and biases toward a premature default flip — which is an
// availability break for every un-upgraded legacy client. Losing a later
// occurrence only lowers a count §12.3 already reads as a lower bound.
//
// Every commit writes the WHOLE state, which is how §12.5's three "travel in the
// same commit" rules — ring entries with their counters, and ring-overflow
// counters with the ring whose evictions they count — are satisfied by
// construction rather than by three separate arguments.

export type NodeE2eeFallbackCounterErrorCode =
  | "fallback_state_unavailable"
  | "fallback_state_locked"
  | "fallback_state_corrupt"
  | "fallback_state_operation_failed";

export class NodeE2eeFallbackCounterError extends Error {
  readonly code: NodeE2eeFallbackCounterErrorCode;

  constructor(code: NodeE2eeFallbackCounterErrorCode) {
    super("Node E2EE fallback counter operation failed.");
    this.name = "NodeE2eeFallbackCounterError";
    this.code = code;
  }
}

function stateError(code: NodeE2eeFallbackCounterErrorCode): never {
  throw new NodeE2eeFallbackCounterError(code);
}

/** §12.5's two disjoint classes. Every occurrence belongs to exactly one. */
export type E2eeFallbackClass = "peer-legacy" | "advertisement-unavailable";

/** §12.5's fixed reason-label set. */
export type E2eeFallbackReason = "peer-legacy" | "undersized-connection" | "statement-unavailable";

/**
 * The class a reason belongs to.
 *
 * §12.3 keeps these separate on purpose: `advertisement-unavailable` is excluded
 * from the default-flip criterion because U1 is triggered by an integer the Hub
 * asserts, and folding it in would let the adversary hold the counter above zero
 * and veto the rollout aimed at it. One map, so no caller can conflate them.
 */
const REASON_CLASS: Readonly<Record<E2eeFallbackReason, E2eeFallbackClass>> = {
  "peer-legacy": "peer-legacy",
  "undersized-connection": "advertisement-unavailable",
  "statement-unavailable": "advertisement-unavailable",
};

export function e2eeFallbackClassOf(reason: E2eeFallbackReason): E2eeFallbackClass {
  return REASON_CLASS[reason];
}

const FALLBACK_CLASSES: readonly E2eeFallbackClass[] = ["peer-legacy", "advertisement-unavailable"];

const FALLBACK_REASONS: ReadonlySet<string> = new Set(Object.keys(REASON_CLASS));

export interface E2eeFallbackRingEntry {
  /** `SHA-256(canonical-CBOR([ "ryco.relay-e2ee.fallback-origin.v1", hubOrigin ]))`, base64url. */
  readonly originHash: string;
  readonly occurredAt: number;
  readonly reason: E2eeFallbackReason;
}

export interface E2eeFallbackClassState {
  readonly occurrences: number;
  readonly ringOverflows: number;
  readonly lastOccurrenceAt: number | undefined;
}

export interface NodeE2eeFallbackState {
  /** Set at the first occurrence and by an explicit reset; never advanced automatically. */
  readonly windowStartedAt: number | undefined;
  readonly classes: Readonly<Record<E2eeFallbackClass, E2eeFallbackClassState>>;
  /** Oldest first, so the display can render the shape §12.3 reads in time order. */
  readonly ring: readonly E2eeFallbackRingEntry[];
}

/**
 * `SHA-256(canonical-CBOR([ domain, hubOrigin ]))` (§12.5), base64url.
 *
 * The origin passes the same §7.1 validator every signed structure uses, and the
 * bytes come from the same canonical encoder, so a ring entry and a statement
 * cannot disagree about what "this Hub origin" is. It throws on an origin that
 * is not already in canonical form — the validator normalizes nothing, by
 * design — which is why `record` below treats a rejection as a missing ring
 * entry rather than as a missing occurrence.
 */
export function e2eeFallbackOriginHash(hubOrigin: string): string {
  const canonical = canonicalizeE2eeHubOrigin(hubOrigin);
  const encoded = encodeCanonicalE2eeCbor([E2EE_FALLBACK_ORIGIN_DOMAIN, canonical]);
  return createHash("sha256").update(encoded).digest("base64url");
}

const ORIGIN_HASH_CHARS = Math.ceil((E2EE_KEY_FINGERPRINT_BYTES * 4) / 3);

/**
 * Bounded by construction: the ring is the only part that grows, and it is
 * capped at `E2EE_FALLBACK_RING_SIZE` entries of a fixed shape.
 */
const MAX_RING_ENTRY_BYTES = 192;
const MAX_FALLBACK_STATE_BYTES = 4 * 1024 + MAX_RING_ENTRY_BYTES * E2EE_FALLBACK_RING_SIZE;

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  "version",
  "revision",
  "windowStartedAt",
  "classes",
  "ring",
]);

const FORBIDDEN_FORWARD_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

interface StoredFallbackRecord {
  readonly version: 1;
  readonly revision: number;
  readonly windowStartedAt: number | null;
  readonly classes: Readonly<Record<E2eeFallbackClass, E2eeFallbackClassState>>;
  readonly ring: readonly E2eeFallbackRingEntry[];
}

interface StoredFallbackFile {
  readonly record: StoredFallbackRecord;
  /** Top-level keys a newer binary wrote, preserved verbatim across this binary's writes. */
  readonly forwardFields: Readonly<Record<string, unknown>>;
}

function emptyClassState(): E2eeFallbackClassState {
  return { occurrences: 0, ringOverflows: 0, lastOccurrenceAt: undefined };
}

function emptyClasses(): Record<E2eeFallbackClass, E2eeFallbackClassState> {
  return {
    "peer-legacy": emptyClassState(),
    "advertisement-unavailable": emptyClassState(),
  };
}

function initialRecord(): StoredFallbackRecord {
  return { version: 1, revision: 0, windowStartedAt: null, classes: emptyClasses(), ring: [] };
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseClassState(value: unknown): E2eeFallbackClassState {
  if (value === undefined || value === null) return emptyClassState();
  if (typeof value !== "object" || Array.isArray(value)) {
    return stateError("fallback_state_corrupt");
  }
  const candidate = value as Partial<E2eeFallbackClassState>;
  if (!isCount(candidate.occurrences) || !isCount(candidate.ringOverflows)) {
    return stateError("fallback_state_corrupt");
  }
  if (
    candidate.lastOccurrenceAt !== undefined &&
    candidate.lastOccurrenceAt !== null &&
    !isCount(candidate.lastOccurrenceAt)
  ) {
    return stateError("fallback_state_corrupt");
  }
  return {
    occurrences: candidate.occurrences,
    ringOverflows: candidate.ringOverflows,
    lastOccurrenceAt: candidate.lastOccurrenceAt ?? undefined,
  };
}

function parseRing(value: unknown): readonly E2eeFallbackRingEntry[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > E2EE_FALLBACK_RING_SIZE) {
    return stateError("fallback_state_corrupt");
  }
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return stateError("fallback_state_corrupt");
    }
    const candidate = entry as Partial<E2eeFallbackRingEntry>;
    if (
      typeof candidate.originHash !== "string" ||
      candidate.originHash.length !== ORIGIN_HASH_CHARS ||
      !/^[A-Za-z0-9_-]+$/.test(candidate.originHash) ||
      !isCount(candidate.occurredAt) ||
      typeof candidate.reason !== "string" ||
      !FALLBACK_REASONS.has(candidate.reason)
    ) {
      return stateError("fallback_state_corrupt");
    }
    return {
      originHash: candidate.originHash,
      occurredAt: candidate.occurredAt,
      reason: candidate.reason as E2eeFallbackReason,
    };
  });
}

function parseFile(value: unknown): StoredFallbackFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return stateError("fallback_state_corrupt");
  }
  const candidate = value as Partial<StoredFallbackRecord> & Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    !isCount(candidate.revision) ||
    (candidate.windowStartedAt !== undefined &&
      candidate.windowStartedAt !== null &&
      !isCount(candidate.windowStartedAt))
  ) {
    return stateError("fallback_state_corrupt");
  }
  const rawClasses = (candidate.classes ?? {}) as Record<string, unknown>;
  if (typeof rawClasses !== "object" || Array.isArray(rawClasses)) {
    return stateError("fallback_state_corrupt");
  }
  const classes = emptyClasses();
  for (const fallbackClass of FALLBACK_CLASSES) {
    classes[fallbackClass] = parseClassState(rawClasses[fallbackClass]);
  }
  const forwardFields: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(candidate)) {
    if (KNOWN_KEYS.has(key) || FORBIDDEN_FORWARD_KEYS.has(key)) continue;
    forwardFields[key] = entry;
  }
  return {
    record: {
      version: 1,
      revision: candidate.revision,
      windowStartedAt: candidate.windowStartedAt ?? null,
      classes,
      ring: parseRing(candidate.ring),
    },
    forwardFields,
  };
}

function encodeFile(file: StoredFallbackFile): unknown {
  // Forward fields first so a key this binary owns can never be shadowed by a
  // stale value a newer binary happened to write under the same name.
  return { ...file.forwardFields, ...file.record };
}

/**
 * Fold what another process committed into this process's view.
 *
 * §12.5's counters are lower bounds that "must never lose an occurrence", and
 * every commit writes the WHOLE record — so a second process holding the same
 * file would otherwise have its occurrences overwritten by whatever this process
 * happened to be carrying. `baseline` is the record this process has already
 * accounted for, so `stored - baseline` is exactly the part of the durable state
 * that is somebody else's, and it is ADDED rather than max'd: two processes
 * counting different channels have counted different events.
 *
 * The ring is merged and re-bounded rather than added, because it is bounded and
 * lossy by construction; ties keep the newest entries, which is the shape §12.3
 * reads in time order.
 */
function mergeUnobserved(
  mine: StoredFallbackRecord,
  baseline: StoredFallbackRecord,
  stored: StoredFallbackRecord,
): StoredFallbackRecord {
  const classes = emptyClasses();
  let changed = false;
  for (const fallbackClass of FALLBACK_CLASSES) {
    const own = mine.classes[fallbackClass];
    const seen = baseline.classes[fallbackClass];
    const disk = stored.classes[fallbackClass];
    const occurrences = own.occurrences + Math.max(0, disk.occurrences - seen.occurrences);
    const ringOverflows = own.ringOverflows + Math.max(0, disk.ringOverflows - seen.ringOverflows);
    const lastOccurrenceAt =
      own.lastOccurrenceAt === undefined
        ? disk.lastOccurrenceAt
        : disk.lastOccurrenceAt === undefined
          ? own.lastOccurrenceAt
          : Math.max(own.lastOccurrenceAt, disk.lastOccurrenceAt);
    if (
      occurrences !== own.occurrences ||
      ringOverflows !== own.ringOverflows ||
      lastOccurrenceAt !== own.lastOccurrenceAt
    ) {
      changed = true;
    }
    classes[fallbackClass] = { occurrences, ringOverflows, lastOccurrenceAt };
  }
  const known = new Set(
    mine.ring.map((entry) => `${entry.occurredAt}:${entry.reason}:${entry.originHash}`),
  );
  const extra = stored.ring.filter(
    (entry) => !known.has(`${entry.occurredAt}:${entry.reason}:${entry.originHash}`),
  );
  const ring =
    extra.length === 0
      ? mine.ring
      : [...mine.ring, ...extra]
          .toSorted((left, right) => left.occurredAt - right.occurredAt)
          .slice(-E2EE_FALLBACK_RING_SIZE);
  const windowStartedAt =
    mine.windowStartedAt ??
    (stored.windowStartedAt === baseline.windowStartedAt ? null : stored.windowStartedAt);
  if (extra.length === 0 && !changed && windowStartedAt === mine.windowStartedAt) return mine;
  return { ...mine, windowStartedAt, classes, ring };
}

function publicState(record: StoredFallbackRecord): NodeE2eeFallbackState {
  return {
    windowStartedAt: record.windowStartedAt ?? undefined,
    classes: record.classes,
    ring: record.ring,
  };
}

export interface NodeE2eeFallbackCounter {
  /**
   * Record one §12.5 occurrence.
   *
   * At most one call per channel, by §12.5. The returned promise settles when
   * the durable write this occurrence triggered has landed, or immediately when
   * it was coalesced into a later one; a caller on the receive path may ignore
   * it, and a caller that wants to observe the write may await it. It never
   * rejects for a write failure — instrumentation must not be able to fail a
   * channel — so a failed commit is reported by `lastWriteError` instead.
   */
  readonly record: (occurrence: {
    readonly hubOrigin: string;
    readonly reason: E2eeFallbackReason;
    readonly at?: number;
  }) => Promise<void>;
  /** Precise current state: the in-memory values, which the durable ones trail. */
  readonly read: () => NodeE2eeFallbackState;
  /** The durable state as stored, for a reader that wants what survived. */
  readonly readDurable: () => Promise<NodeE2eeFallbackState>;
  /** Commit anything coalesced. The interval boundary and clean shutdown both use this. */
  readonly flush: () => Promise<void>;
  /**
   * §12.5's reset authority: an explicit operator action, and the only one.
   *
   * Zeroes both occurrence counters, both ring-overflow counters, and the ring,
   * and records a new observation-window start.
   */
  readonly reset: (at?: number) => Promise<NodeE2eeFallbackState>;
  /** The last durable-write failure, for the CLI to surface. Cleared by a successful write. */
  readonly lastWriteError: () => unknown;
  /** Cancel the interval timer and flush. Idempotent. */
  readonly stop: () => Promise<void>;
}

const FAILURE_CODES: Readonly<Record<ProtectedStateFileFailure, NodeE2eeFallbackCounterErrorCode>> =
  {
    unavailable: "fallback_state_unavailable",
    locked: "fallback_state_locked",
    corrupt: "fallback_state_corrupt",
    operation_failed: "fallback_state_operation_failed",
  };

export async function makeNodeE2eeFallbackCounter(options: {
  readonly path: string;
  readonly now?: () => number;
  /** Test seam only. Production uses `E2EE_FALLBACK_WRITE_INTERVAL`. */
  readonly writeIntervalMs?: number;
}): Promise<NodeE2eeFallbackCounter> {
  const now = options.now ?? Date.now;
  const interval = options.writeIntervalMs ?? E2EE_FALLBACK_WRITE_INTERVAL;
  const file = await openProtectedStateFile({
    path: options.path,
    maxBytes: MAX_FALLBACK_STATE_BYTES,
    fail: (failure) => stateError(FAILURE_CODES[failure]),
  });

  const load = async (): Promise<StoredFallbackFile> => {
    const raw = await file.readJson();
    return raw === null ? { record: initialRecord(), forwardFields: {} } : parseFile(raw);
  };

  // The precise state §12.5 keeps in memory. Loaded once so a restart resumes
  // from what survived rather than from zero; counters are never decremented and
  // this is the only place the durable values are ever read into memory.
  const loaded = await file.withLock(load);
  let state = loaded.record;
  /**
   * The durable record this process has already accounted for.
   *
   * Everything the file holds beyond this belongs to another writer, and
   * `mergeUnobserved` is what keeps it. Advanced only where the disk state is
   * known: at load, and to whatever each successful commit wrote.
   */
  let baseline = loaded.record;
  let forwardFields = loaded.forwardFields;
  let dirty = false;
  /**
   * §12.5's reset is an operator action that REPLACES the record, so the one
   * commit that carries it must not fold a concurrent writer's counters back in
   * — the reset would otherwise zero nothing.
   */
  let resetting = false;
  let lastWriteError: unknown;
  /**
   * Counts every in-memory mutation, so a write can tell whether one landed
   * while it was in flight.
   *
   * Without it a commit that finished after a concurrent occurrence would write
   * back its own snapshot and clear `dirty`, dropping that occurrence from both
   * the memory state and the next flush. Two channels recording at once is the
   * ordinary case on the receive path, not a contrived one, and §12.5's counter
   * is a lower bound precisely because it must never lose an occurrence it was
   * told about.
   */
  let mutations = 0;

  /**
   * Per class, the instant its coalescing interval ends.
   *
   * A class with no entry here has been flushed, so its next occurrence is the
   * leading edge and is committed at once. This is the whole of §12.5's write
   * schedule: the map decides "leading edge or coalesced", and nothing else does.
   */
  const intervalEnds = new Map<E2eeFallbackClass, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> = Promise.resolve();
  let stopped = false;

  /**
   * Serialize writes and always write the CURRENT state.
   *
   * Chaining rather than queueing snapshots is deliberate: every commit carries
   * the whole record, so a write that starts later supersedes one that started
   * earlier, and a coalesced occurrence never needs a commit of its own. It is
   * also what makes §12.5's three "travel in the same commit" rules hold without
   * any per-field bookkeeping.
   */
  const commit = (): Promise<void> => {
    writing = writing
      .catch(() => undefined)
      .then(() =>
        file.withLock(async () => {
          if (!dirty) return;
          const stored = await load();
          // A concurrent writer's forward fields win: they are the newer
          // binary's, and this process has only ever carried them through.
          forwardFields = stored.forwardFields;
          // Synchronous from here to the write: whatever another process
          // committed since this process last touched the file is folded into
          // `state` rather than overwritten by it, and `baseline` advances to
          // the disk state that has now been accounted for.
          if (!resetting) state = mergeUnobserved(state, baseline, stored.record);
          baseline = stored.record;
          resetting = false;
          const observed = mutations;
          const proposed: StoredFallbackFile = {
            record: { ...state, revision: stored.record.revision + 1 },
            forwardFields,
          };
          // Re-parsing on the way out is what makes a value mutated into an
          // impossible shape fail before it reaches the disk.
          await file.writeJson(encodeFile(parseFile(encodeFile(proposed))));
          // Take the revision this write spent, but never the rest of the
          // snapshot: an occurrence recorded while the write was in flight is
          // already in `state` and would be erased by assigning `proposed` back.
          state = { ...state, revision: proposed.record.revision };
          baseline = proposed.record;
          if (mutations === observed) dirty = false;
          lastWriteError = undefined;
        }),
      )
      .catch((error: unknown) => {
        // Instrumentation never fails a channel. The state stays dirty, so the
        // next flush retries it, and the failure is surfaced by `lastWriteError`.
        lastWriteError = error;
      });
    return writing;
  };

  /** One timer, set to the earliest interval boundary any class is waiting on. */
  const scheduleTimer = (): void => {
    if (stopped || timer !== undefined) return;
    let earliest: number | undefined;
    for (const end of intervalEnds.values()) {
      if (earliest === undefined || end < earliest) earliest = end;
    }
    if (earliest === undefined) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        const at = now();
        // Only the classes whose interval actually ended are reopened, so a
        // class still inside its window does not get an early leading edge.
        for (const [fallbackClass, end] of Array.from(intervalEnds)) {
          if (end <= at) intervalEnds.delete(fallbackClass);
        }
        if (dirty) void commit();
        scheduleTimer();
      },
      Math.max(earliest - now(), 0),
    );
    // Never a reason to hold the process open: `stop` flushes.
    timer.unref?.();
  };

  const applyOccurrence = (
    occurredAt: number,
    hubOrigin: string,
    reason: E2eeFallbackReason,
  ): void => {
    const fallbackClass = e2eeFallbackClassOf(reason);
    // An origin this node cannot hash yields no ring entry, and the occurrence
    // is still counted. §12.5 makes the COUNTER the authoritative measure — "no
    // such plaintext channel can go uncounted" — while the ring is bounded and
    // lossy by construction, so dropping the entry loses only what the ring is
    // already permitted to lose, whereas dropping the count would be a
    // suppression path.
    let entry: E2eeFallbackRingEntry | undefined;
    try {
      entry = { originHash: e2eeFallbackOriginHash(hubOrigin), occurredAt, reason };
    } catch {
      entry = undefined;
    }
    const evicting = entry !== undefined && state.ring.length >= E2EE_FALLBACK_RING_SIZE;
    const ring =
      entry === undefined
        ? state.ring
        : evicting
          ? [...state.ring.slice(state.ring.length - E2EE_FALLBACK_RING_SIZE + 1), entry]
          : [...state.ring, entry];
    const previous = state.classes[fallbackClass];
    state = {
      ...state,
      windowStartedAt: state.windowStartedAt ?? occurredAt,
      classes: {
        ...state.classes,
        [fallbackClass]: {
          occurrences: previous.occurrences + 1,
          // Once per evicted entry, in the class of the occurrence being
          // recorded (§12.5) — not in the class of the entry it evicted, which
          // §12.5 does not ask for and which the ring could not answer once the
          // entry is gone.
          ringOverflows: previous.ringOverflows + (evicting ? 1 : 0),
          lastOccurrenceAt: occurredAt,
        },
      },
      ring,
    };
    dirty = true;
    mutations += 1;
  };

  const flush = async (): Promise<void> => {
    intervalEnds.clear();
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    await commit();
  };

  return {
    record: async (occurrence) => {
      // An unknown reason is not counted at all: §12.5 fixes the label set, and
      // a value outside it would either widen what the ring retains or be
      // silently mapped into a class it does not belong to.
      if (!FALLBACK_REASONS.has(occurrence.reason)) return;
      const at = occurrence.at ?? now();
      applyOccurrence(at, occurrence.hubOrigin, occurrence.reason);
      const fallbackClass = e2eeFallbackClassOf(occurrence.reason);
      const end = intervalEnds.get(fallbackClass);
      if (end !== undefined && at < end) {
        // Coalesced: the boundary timer carries it, and so does a clean shutdown.
        scheduleTimer();
        return;
      }
      // The leading edge of this class (§12.5): committed before this returns.
      intervalEnds.set(fallbackClass, at + interval);
      scheduleTimer();
      await commit();
    },
    read: () => publicState(state),
    readDurable: () => file.withLock(async () => publicState((await load()).record)),
    flush,
    reset: async (at) => {
      state = { ...initialRecord(), revision: state.revision, windowStartedAt: at ?? now() };
      dirty = true;
      resetting = true;
      mutations += 1;
      await flush();
      return publicState(state);
    },
    lastWriteError: () => lastWriteError,
    stop: async () => {
      stopped = true;
      await flush();
    },
  };
}
