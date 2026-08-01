import {
  LocalHubIdentityStateError,
  type LocalHubIdentityStateErrorCode,
} from "./LocalHubIdentityState.ts";
import { openProtectedStateFile, type ProtectedStateFileFailure } from "./ProtectedStateFile.ts";

// The identity-key destroy queue — the durable half of the commit-then-destroy
// rule the §7.5 rotation promotion runs under
// (docs/relay-e2ee-protocol.md §7.5, and `HubKeyRotationClient`).
//
// WHAT THIS OWNS: the protected-store names of node identity secrets that must
// be destroyed, recorded before the destruction and dropped only after it. The
// protected store is get/create/remove with no listing, so a name this record
// forgets is a private key nothing can ever collect — and a retired identity key
// left alive is a key that can still sign a §7.5 continuity certificate, i.e.
// exactly the material a substitution needs.
//
// ─── WHY THIS IS NOT IN `hub-identity.json` ─────────────────────────────────
//
// The same reason the §7.5 lineage (`NodeIdentityContinuityStore`) and the §6.4
// prekey slots (`NodeE2eePrekeyStore`) are not: `parseState` reconstructs the
// identity state from its known keys alone, so a binary older than this feature
// deletes every field it does not recognize on its next write. A downgrade to a
// release that predates E2EE is an ordinary operator action, and the release
// this queue was added in is the first one that has it — every already released
// binary drops it.
//
// For most identity state that would be recoverable. For THESE names it is not:
// they are the only handles the node has on live identity private keys that
// nothing else references any more, so a downgrade that drops them orphans the
// keys in the credential store permanently, with no listing to find them again
// and no later binary able to name them. Teaching `parseState` to preserve
// unknown keys does not fix that — it would only help binaries newer than the
// change — so the queue has to live somewhere an already released binary never
// writes, which means its own file. This record's own parser preserves unknown
// top-level keys, so the same trap is not rebuilt one version later.
//
// ─── WHAT MOVING IT COSTS, AND HOW THAT IS PAID ─────────────────────────────
//
// The promotion can no longer queue the outgoing key in the same atomic write
// that promotes its successor: the two live in different files and no write
// spans both. So the queue is written FIRST, before the promotion commits, and
// the meaning of an entry weakens accordingly — from "this key is retired" to
// "this key is retired, unless the promotion that queued it never committed".
//
// The drain resolves that against the identity state, which is the record that
// knows: a queued name the state still calls in service belongs to a promotion
// that has not committed, so it is SKIPPED and, crucially, never dequeued —
// dropping it would orphan the key the moment that promotion did commit. The
// ordering is what makes both failure modes benign:
//
//   crash after the enqueue, before the commit → the name is queued and still in
//     service; the drain skips it, and the promotion's retry re-queues (a no-op)
//     and commits, after which the drain destroys it;
//   crash after the commit → the name is queued and no longer in service, which
//     is the ordinary outstanding-work case any later drain finishes.
//
// The reverse order — commit, then queue — is the one that cannot be repaired:
// between the two the outgoing key is named by nothing at all.
//
// The queue therefore holds at most one stale entry, because the name a
// promotion queues is always the CURRENT active key's: a second attempt against
// the same active key queues the same name, and a rotation that never commits
// leaves the active key unchanged. Such an entry is inert while it is in service
// and is destroyed by whichever later promotion genuinely retires that key.

const SECRET_NAME = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/**
 * Headroom, not a working limit.
 *
 * Every promotion drains the queue before it adds to it, and the name it adds is
 * the active key's, so the queue holds at most one key awaiting destruction plus
 * at most one stale entry for a promotion that never committed. The bound exists
 * so the record cannot grow without limit if that invariant is ever broken; an
 * enqueue past it is refused, which aborts the promotion before it commits and
 * leaves the outgoing key intact.
 */
const MAX_RETIRING_SECRETS = 8;

/** Two names and their envelope, plus room for a newer binary's fields. */
const MAX_RETIREMENT_STATE_BYTES = 8 * 1024;

const KNOWN_KEYS: ReadonlySet<string> = new Set(["version", "revision", "retiringSecretNames"]);

/** Never adopted as a forward field: reflecting these back would touch the prototype. */
const FORBIDDEN_FORWARD_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

function stateError(code: LocalHubIdentityStateErrorCode): never {
  throw new LocalHubIdentityStateError(code);
}

interface StoredRetirementRecord {
  readonly version: 1;
  readonly revision: number;
  readonly retiringSecretNames: readonly string[];
}

interface StoredRetirementFile {
  readonly record: StoredRetirementRecord;
  /** Top-level keys a newer binary wrote, preserved verbatim across this binary's writes. */
  readonly forwardFields: Readonly<Record<string, unknown>>;
}

export interface NodeIdentityKeyRetirementStore {
  /** Every identity secret queued for destruction, in the order it was queued. */
  readonly names: () => Promise<readonly string[]>;
  /**
   * Queue one identity secret for destruction. Idempotent on the name.
   *
   * MUST be called before the write that stops calling the key in service, and
   * its failure MUST abort that write: a key promoted away from without a queue
   * entry is a key nothing names.
   */
  readonly enqueue: (name: string) => Promise<void>;
  /**
   * Drop names whose keys are gone. Callers MUST have destroyed them first.
   *
   * The reverse order is exactly the orphan this record exists to prevent, and a
   * failure here is harmless: the name stays queued and the next drain deletes an
   * already-absent key, which is a no-op.
   */
  readonly dequeue: (names: readonly string[]) => Promise<void>;
  /**
   * Forget the queue entirely, for a leave.
   *
   * The caller MUST have erased every name `names` reported first: this drops the
   * last reference to all of them at once, including an entry whose key a crash
   * left alive.
   */
  readonly reset: () => Promise<void>;
}

const FAILURE_CODES: Readonly<Record<ProtectedStateFileFailure, LocalHubIdentityStateErrorCode>> = {
  unavailable: "identity_state_unavailable",
  locked: "identity_state_locked",
  corrupt: "identity_state_corrupt",
  operation_failed: "identity_state_operation_failed",
};

function isSecretName(value: unknown): value is string {
  return typeof value === "string" && SECRET_NAME.test(value);
}

function parseNames(value: unknown): readonly string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_RETIRING_SECRETS) {
    return stateError("identity_state_corrupt");
  }
  const names = value.map((entry) =>
    isSecretName(entry) ? entry : stateError("identity_state_corrupt"),
  );
  if (new Set(names).size !== names.length) return stateError("identity_state_corrupt");
  return names;
}

function parseFile(value: unknown): StoredRetirementFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return stateError("identity_state_corrupt");
  }
  const candidate = value as Partial<StoredRetirementRecord> & Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    !Number.isSafeInteger(candidate.revision) ||
    Number(candidate.revision) < 0
  ) {
    return stateError("identity_state_corrupt");
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
      retiringSecretNames: parseNames(candidate.retiringSecretNames),
    },
    forwardFields,
  };
}

function encodeFile(file: StoredRetirementFile): unknown {
  // Forward fields first so a key this binary owns can never be shadowed by a
  // stale value a newer binary happened to write under the same name.
  return { ...file.forwardFields, ...file.record };
}

function initialFile(): StoredRetirementFile {
  return {
    record: { version: 1, revision: 0, retiringSecretNames: [] },
    forwardFields: {},
  };
}

export async function makeNodeIdentityKeyRetirementStore(options: {
  readonly path: string;
}): Promise<NodeIdentityKeyRetirementStore> {
  const file = await openProtectedStateFile({
    path: options.path,
    maxBytes: MAX_RETIREMENT_STATE_BYTES,
    fail: (failure) => stateError(FAILURE_CODES[failure]),
  });

  const load = async (): Promise<StoredRetirementFile> => {
    const raw = await file.readJson();
    return raw === null ? initialFile() : parseFile(raw);
  };

  /**
   * Commit a new list, or nothing at all.
   *
   * A no-op writes nothing, so the common case — a drain that found the queue
   * already empty — does not create a record for a node that has never rotated.
   */
  const commit = async (names: readonly string[]): Promise<void> => {
    const current = await load();
    if (
      names.length === current.record.retiringSecretNames.length &&
      names.every((name, index) => current.record.retiringSecretNames[index] === name)
    ) {
      return;
    }
    const next: StoredRetirementFile = {
      record: {
        ...current.record,
        revision: current.record.revision + 1,
        retiringSecretNames: names,
      },
      forwardFields: current.forwardFields,
    };
    // Re-parse before writing for the same reason the identity state does: the
    // shape that reaches the disk is the shape a reader will have to accept.
    await file.writeJson(encodeFile(parseFile(encodeFile(next))));
  };

  return {
    names: () => file.withLock(async () => (await load()).record.retiringSecretNames),
    enqueue: (name) =>
      file.withLock(async () => {
        if (!isSecretName(name)) return stateError("identity_state_operation_failed");
        const current = (await load()).record.retiringSecretNames;
        if (current.includes(name)) return;
        // Refused rather than written and rejected on the way out, so the caller
        // sees the operation it attempted rather than a corrupt record.
        if (current.length >= MAX_RETIRING_SECRETS) {
          return stateError("identity_state_operation_failed");
        }
        await commit([...current, name]);
      }),
    dequeue: (names) =>
      file.withLock(async () => {
        const current = (await load()).record.retiringSecretNames;
        await commit(current.filter((candidate) => !names.includes(candidate)));
      }),
    reset: () => file.withLock(() => commit([])),
  };
}
