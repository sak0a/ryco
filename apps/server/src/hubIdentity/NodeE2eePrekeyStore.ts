import { canonicalizeHubOrigin } from "@ryco/shared/nodeIdentity";
import {
  E2EE_AGREEMENT_PUBLIC_KEY_BYTES,
  E2EE_PREKEY_LIFETIME,
  ED25519_SIGNATURE_BYTES,
} from "@ryco/shared/relayE2eeConstants";

import { openProtectedStateFile, type ProtectedStateFileFailure } from "./ProtectedStateFile.ts";

// The node's durable §6.4 prekey slots —
// docs/relay-e2ee-protocol.md §6.2 (static agreement keys), §6.3 (custody),
// §6.4 (lifetime, staged rotation, and the overlap window), and §7.3 (the
// certificate this record carries).
//
// WHAT THIS OWNS: the active prekey slot, the overlap slot a rotation displaced,
// and nothing else. The agreement SECRETS live in the protected secret store;
// what is here is the public certificate a channel advertises plus the
// protected-store name that reaches the secret half.
//
// ─── WHY THIS IS NOT IN `hub-identity.json` ─────────────────────────────────
//
// The same reason the §7.5 continuity lineage is not
// (`NodeIdentityContinuityStore`), applied to the one thing this record holds
// that cannot be regenerated: `parseState` reconstructs the identity state from
// its known keys alone, so a binary older than this feature deletes every field
// it does not recognize on its next write. A downgrade to a release that
// predates E2EE is an ordinary operator action.
//
// For the CERTIFICATE that would be harmless — §6.4 makes a missing prekey a
// re-signing trigger, so a node that lost it simply issues a new one. For the
// SECRET NAMES it is not. They are the only handles the node has on live
// agreement private keys: the protected store is get/create/remove with no
// listing, so a name this record forgets is a key nothing can ever destroy.
// §6.4 requires the displaced key to be destroyed once its overlap ends, and an
// undestroyed static responder key is exactly what a recorded IK handshake
// needs to be opened later. Keeping the names in a file no already-released
// binary writes is what makes "part of what a leave erases" true rather than
// aspirational.
//
// This record's own parser preserves unknown top-level keys, so the same trap is
// not rebuilt one version later.

export type NodeE2eePrekeyStoreErrorCode =
  | "prekey_state_unavailable"
  | "prekey_state_locked"
  | "prekey_state_corrupt"
  | "prekey_state_operation_failed";

export class NodeE2eePrekeyStoreError extends Error {
  readonly code: NodeE2eePrekeyStoreErrorCode;

  constructor(code: NodeE2eePrekeyStoreErrorCode) {
    super("Node E2EE prekey state operation failed.");
    this.name = "NodeE2eePrekeyStoreError";
    this.code = code;
  }
}

function stateError(code: NodeE2eePrekeyStoreErrorCode): never {
  throw new NodeE2eePrekeyStoreError(code);
}

/**
 * The node's active E2EE agreement prekey and its §7.3 certificate.
 *
 * PUBLIC MATERIAL ONLY. The agreement secret lives in the protected secret
 * store under `secretName`, exactly like the identity key; what is recorded here
 * is the certificate a channel advertises plus the metadata needed to decide
 * whether it is still usable. Persisting it is what lets §5.2's advertisement
 * reuse one signature for every channel instead of re-signing per handshake.
 *
 * The identity fields are carried, not re-derived, because they are what the
 * cross-signature covers: a certificate signed under an identity key that has
 * since rotated is stale evidence, and comparing these fields against the
 * current active key is how that is detected (§6.4, §7.6).
 */
export interface NodeE2eePrekeyState {
  readonly hubOrigin: string;
  readonly nodeId: string;
  /** §7.3 element 4: the node identity key id that signed the cross-signature. */
  readonly identityKeyId: string;
  /** §7.3 element 5. */
  readonly prekeyId: string;
  /** Protected-store name of the X25519 secret half. */
  readonly secretName: string;
  /** §7.3 element 8, base64url. */
  readonly agreementPublicKey: string;
  /** The §7.3 cross-signature, base64url. */
  readonly crossSignature: string;
  /** §7.3 element 11. */
  readonly createdAt: number;
  /** §7.3 element 12; `expiresAt - createdAt` is bounded by `E2EE_PREKEY_LIFETIME` (§6.4). */
  readonly expiresAt: number;
}

/**
 * The prekey a rotation displaced, retained for the §6.4 overlap window.
 *
 * §6.4 requires the outgoing agreement private key to survive
 * `E2EE_PREKEY_ROTATION_OVERLAP` past activation, because a channel that already
 * received the old advertisement must still be able to complete its handshake
 * against the prekey it was advertised. Modelling the window as a durable
 * deadline rather than a timer makes the destroy step idempotent and resumable
 * after a crash — the same reasoning that produced `PendingHubTeardownState`.
 */
export interface RetiredNodeE2eePrekeyState extends NodeE2eePrekeyState {
  /** Destroy the secret once the clock passes this; bounded by the §6.4 overlap. */
  readonly retainUntil: number;
}

export interface NodeE2eePrekeyRecord {
  readonly version: 1;
  readonly revision: number;
  readonly e2eePrekey: NodeE2eePrekeyState | null;
  readonly outgoingE2eePrekey: RetiredNodeE2eePrekeyState | null;
  /**
   * Agreement secrets that must be destroyed, recorded before the destruction.
   *
   * §6.4 requires a retired agreement private key to be destroyed, and the
   * protected store has no listing, so a name dropped from this record before
   * its key is gone is a key nothing can ever collect. Naming it here first —
   * in the same atomic write that stops calling it usable — makes the destroy
   * step resumable after a crash without ever leaving a usable slot pointing at
   * a secret that no longer exists.
   */
  readonly retiringSecretNames: readonly string[];
}

export interface NodeE2eePrekeyStore {
  readonly read: () => Promise<NodeE2eePrekeyRecord>;
  /**
   * Compare and update under this record's single-writer lock.
   *
   * `change` must bump `revision`; a proposal that does not is refused, which is
   * what keeps a caller from committing a decision it made against a snapshot
   * another writer has already replaced.
   */
  readonly update: (
    change: (current: NodeE2eePrekeyRecord) => NodeE2eePrekeyRecord,
  ) => Promise<NodeE2eePrekeyRecord>;
  /** Every protected-store name this record still references (§6.3, leave). */
  readonly secretNames: () => Promise<ReadonlyArray<string>>;
  /**
   * Discard both slots and the destroy queue.
   *
   * The caller MUST erase every name `secretNames` reported first: this drops
   * the last reference to all of them at once, including a queue entry whose
   * key a crash left alive.
   */
  readonly reset: () => Promise<NodeE2eePrekeyRecord>;
}

const NODE_ID = /^node_[A-Za-z0-9_-]{22,43}$/;
const NODE_KEY_ID = /^nkey_[A-Za-z0-9_-]{22}$/;
const NODE_PREKEY_ID = /^epk_[A-Za-z0-9_-]{22}$/;
const SECRET_NAME = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/** Two certificates and their metadata, plus room for a newer binary's fields. */
const MAX_PREKEY_STATE_BYTES = 16 * 1024;

/**
 * Headroom, not a working limit.
 *
 * Every issuing and sweeping path drains the list before it adds to it, so it
 * holds at most the one name that path is retiring. The bound exists so a
 * record cannot grow without limit if that invariant is ever broken.
 */
const MAX_RETIRING_SECRETS = 4;

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  "version",
  "revision",
  "e2eePrekey",
  "outgoingE2eePrekey",
  "retiringSecretNames",
]);

const FORBIDDEN_FORWARD_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

interface StoredPrekeyFile {
  readonly record: NodeE2eePrekeyRecord;
  readonly forwardFields: Readonly<Record<string, unknown>>;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSecretName(value: unknown): value is string {
  return typeof value === "string" && SECRET_NAME.test(value);
}

/**
 * Exactly `byteLength` bytes in canonical unpadded base64url.
 *
 * The re-encode equality is the point: a value whose final character carries
 * non-zero padding bits decodes to the right length but is not the encoding this
 * node wrote, and admitting it would let two distinct strings name one key.
 */
function isFixedBase64UrlBytes(value: unknown, byteLength: number): value is string {
  if (typeof value !== "string" || value.length !== Math.ceil((byteLength * 4) / 3)) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.byteLength === byteLength && decoded.toString("base64url") === value;
}

function parsePrekeyFields(value: unknown): NodeE2eePrekeyState {
  if (typeof value !== "object" || value === null) return stateError("prekey_state_corrupt");
  const candidate = value as Partial<NodeE2eePrekeyState>;
  if (
    typeof candidate.nodeId !== "string" ||
    !NODE_ID.test(candidate.nodeId) ||
    typeof candidate.identityKeyId !== "string" ||
    !NODE_KEY_ID.test(candidate.identityKeyId) ||
    typeof candidate.prekeyId !== "string" ||
    !NODE_PREKEY_ID.test(candidate.prekeyId) ||
    !isSecretName(candidate.secretName) ||
    !isFixedBase64UrlBytes(candidate.agreementPublicKey, E2EE_AGREEMENT_PUBLIC_KEY_BYTES) ||
    !isFixedBase64UrlBytes(candidate.crossSignature, ED25519_SIGNATURE_BYTES) ||
    !isTimestamp(candidate.createdAt) ||
    !isTimestamp(candidate.expiresAt) ||
    // §6.4 bounds the certificate lifetime. A record claiming a longer one is
    // not a certificate this node could have issued, so it is corrupt rather
    // than merely stale.
    Number(candidate.expiresAt) <= Number(candidate.createdAt) ||
    Number(candidate.expiresAt) - Number(candidate.createdAt) > E2EE_PREKEY_LIFETIME
  ) {
    return stateError("prekey_state_corrupt");
  }
  let hubOrigin: string;
  try {
    hubOrigin = canonicalizeHubOrigin(candidate.hubOrigin ?? "");
  } catch {
    return stateError("prekey_state_corrupt");
  }
  return {
    hubOrigin,
    nodeId: candidate.nodeId,
    identityKeyId: candidate.identityKeyId,
    prekeyId: candidate.prekeyId,
    secretName: candidate.secretName,
    agreementPublicKey: candidate.agreementPublicKey,
    crossSignature: candidate.crossSignature,
    createdAt: candidate.createdAt,
    expiresAt: candidate.expiresAt,
  };
}

function parsePrekey(value: unknown): NodeE2eePrekeyState | null {
  if (value === undefined || value === null) return null;
  return parsePrekeyFields(value);
}

function parseOutgoingPrekey(value: unknown): RetiredNodeE2eePrekeyState | null {
  if (value === undefined || value === null) return null;
  const fields = parsePrekeyFields(value);
  const candidate = value as Partial<RetiredNodeE2eePrekeyState>;
  // Only well-formedness is checked here. The deadline is set at rotation time
  // as `activation + E2EE_PREKEY_ROTATION_OVERLAP`, and a rotation may happen
  // arbitrarily long after the outgoing certificate was issued — a node that was
  // off for a year rotates a year-old prekey — so no relation to `createdAt`
  // holds in general. What bounds the outgoing key's usefulness is its own
  // validity window, evaluated at use.
  if (!isTimestamp(candidate.retainUntil)) return stateError("prekey_state_corrupt");
  return { ...fields, retainUntil: candidate.retainUntil };
}

function parseRetiring(value: unknown): readonly string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_RETIRING_SECRETS) {
    return stateError("prekey_state_corrupt");
  }
  const names = value.map((entry) =>
    isSecretName(entry) ? entry : stateError("prekey_state_corrupt"),
  );
  if (new Set(names).size !== names.length) return stateError("prekey_state_corrupt");
  return names;
}

function parseFile(value: unknown): StoredPrekeyFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return stateError("prekey_state_corrupt");
  }
  const candidate = value as Partial<NodeE2eePrekeyRecord> & Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    !Number.isSafeInteger(candidate.revision) ||
    Number(candidate.revision) < 0
  ) {
    return stateError("prekey_state_corrupt");
  }
  const record: NodeE2eePrekeyRecord = {
    version: 1,
    revision: candidate.revision as number,
    e2eePrekey: parsePrekey(candidate.e2eePrekey),
    outgoingE2eePrekey: parseOutgoingPrekey(candidate.outgoingE2eePrekey),
    retiringSecretNames: parseRetiring(candidate.retiringSecretNames),
  };
  // A name queued for destruction must not also be a name in service. The drain
  // destroys every entry in this list, so an overlap between the two would let
  // it destroy the key a channel is about to hand shake against.
  for (const name of record.retiringSecretNames) {
    if (name === record.e2eePrekey?.secretName || name === record.outgoingE2eePrekey?.secretName) {
      return stateError("prekey_state_corrupt");
    }
  }
  // A retired prekey exists only because a rotation replaced it, so it cannot
  // outlive its successor, and it must never name the successor's key material:
  // the §6.4 sweep destroys the secret this slot names, and a state that pointed
  // both slots at one name would let that sweep destroy the active key.
  if (record.outgoingE2eePrekey !== null) {
    if (
      record.e2eePrekey === null ||
      record.outgoingE2eePrekey.prekeyId === record.e2eePrekey.prekeyId ||
      record.outgoingE2eePrekey.secretName === record.e2eePrekey.secretName
    ) {
      return stateError("prekey_state_corrupt");
    }
  }
  const forwardFields: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(candidate)) {
    if (KNOWN_KEYS.has(key) || FORBIDDEN_FORWARD_KEYS.has(key)) continue;
    forwardFields[key] = entry;
  }
  return { record, forwardFields };
}

function encodeFile(file: StoredPrekeyFile): unknown {
  return { ...file.forwardFields, ...file.record };
}

function initialRecord(): NodeE2eePrekeyRecord {
  return {
    version: 1,
    revision: 0,
    e2eePrekey: null,
    outgoingE2eePrekey: null,
    retiringSecretNames: [],
  };
}

const FAILURE_CODES: Readonly<Record<ProtectedStateFileFailure, NodeE2eePrekeyStoreErrorCode>> = {
  unavailable: "prekey_state_unavailable",
  locked: "prekey_state_locked",
  corrupt: "prekey_state_corrupt",
  operation_failed: "prekey_state_operation_failed",
};

export async function makeNodeE2eePrekeyStore(options: {
  readonly path: string;
}): Promise<NodeE2eePrekeyStore> {
  const file = await openProtectedStateFile({
    path: options.path,
    maxBytes: MAX_PREKEY_STATE_BYTES,
    fail: (failure) => stateError(FAILURE_CODES[failure]),
  });

  const load = async (): Promise<StoredPrekeyFile> => {
    const raw = await file.readJson();
    if (raw !== null) return parseFile(raw);
    const initial: StoredPrekeyFile = { record: initialRecord(), forwardFields: {} };
    await file.writeJson(encodeFile(initial));
    return initial;
  };

  const write = (file_: StoredPrekeyFile): Promise<void> =>
    // Re-parsing on the way out is what makes a value a caller mutated into an
    // impossible shape fail before it reaches the disk.
    file.writeJson(encodeFile(parseFile(encodeFile(file_))));

  const read: NodeE2eePrekeyStore["read"] = () => file.withLock(async () => (await load()).record);

  const update: NodeE2eePrekeyStore["update"] = (change) =>
    file.withLock(async () => {
      const current = await load();
      const proposed = parseFile(encodeFile({ ...current, record: change(current.record) })).record;
      if (proposed.revision <= current.record.revision) {
        return stateError("prekey_state_operation_failed");
      }
      await write({ record: proposed, forwardFields: current.forwardFields });
      return proposed;
    });

  const secretNames: NodeE2eePrekeyStore["secretNames"] = () =>
    file.withLock(async () => {
      const { record } = await load();
      return [
        record.e2eePrekey?.secretName,
        record.outgoingE2eePrekey?.secretName,
        ...record.retiringSecretNames,
      ].filter(
        (name, index, names): name is string =>
          typeof name === "string" && names.indexOf(name) === index,
      );
    });

  const reset: NodeE2eePrekeyStore["reset"] = () =>
    file.withLock(async () => {
      const current = await load();
      const record: NodeE2eePrekeyRecord = {
        ...initialRecord(),
        revision: current.record.revision + 1,
      };
      await write({ record, forwardFields: current.forwardFields });
      return record;
    });

  return { read, update, secretNames, reset };
}
