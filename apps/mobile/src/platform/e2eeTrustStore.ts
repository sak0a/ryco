import { encodeBase64Url } from "@ryco/client-runtime/relay";
import { E2EE_PIN_NODE_ID_HINTS_MAX } from "@ryco/shared/relayE2eeConstants";
import {
  e2eeKeyFingerprint,
  formatE2eeKeyFingerprint,
  validateE2eeClientIdentityPublicKey,
  validateE2eeNodeIdentityPublicKey,
} from "@ryco/shared/relayE2eeKeys";
import { deriveE2eeSafetyNumber } from "@ryco/shared/relayE2eeVerificationDisplay";

import { assertE2eeRuntimeGlobals } from "./e2eeRuntime";
import {
  E2EE_TRUST_DOCUMENT_KEY,
  mobileE2eeSecureStore,
  type E2eeSecureStore,
} from "./e2eeSecureStore";
import {
  classifyE2eeTrustSnapshot,
  isE2eeVerifiedPinRecord,
  resolveE2eeTrustRecord,
  snapshotE2eeContinuityIdResolution,
  snapshotE2eeSelection,
  tightenE2eeTrustClassification,
  type E2eeLatch,
  type E2eeLegacyConsent,
  type E2eeStrictLegacyPolicy,
  type E2eeTrustClassification,
  type E2eeTrustRecord,
  type E2eeTrustRecordIndex,
  type E2eeTrustSelection,
  type E2eeTrustSnapshot,
  type E2eeVerificationMarker,
  type E2eeVerifiedPinRecord,
} from "./e2eeTrustModel";

// Durable custody of the §13 client trust state —
// docs/relay-e2ee-protocol.md §13.1 (pin records and the device-level
// `anyNodeVerified` marker), §13.1.1 (what its loss means), §13.2 step 5 (the
// promotion), §13.3 (silent rotation and the owner-initiated re-pair), §12.1 (the
// latch), and §12.1.1 (classification and owner consent).
//
// ONE DOCUMENT, ONE WRITE. §13.1 requires the marker write to be "crash-atomic
// with the pin's promotion to `verified`: a crash leaves both applied or neither,
// never the pin alone", and neither platform secure store offers a transaction
// across entries. Every mutation therefore builds a NEW document, writes it, and
// only then swaps it into memory — so a refused or crashed write leaves neither
// half applied on disk nor in the process.
//
// EVERYTHING IS SECRET-CLASS, INCLUDING THE PARTS THAT ARE NOT SECRETS. §13.1.1
// puts "pin records and their states, verified fingerprints, recorded continuity
// ids, latches, policy generations, approval state, owner legacy consents, the
// strict-mode policy, and the `anyNodeVerified(hubOrigin)` marker" in the §6.3
// device-only class together. Splitting the non-secret half into the plain KV
// would make the marker losable independently of the pins it summarizes — and
// survivable independently of them, since the plain KV is carried by platform
// backup — which is precisely the lower bound §13.1 says must not be breakable.
//
// NOT LOADED IS NOT EMPTY. `loaded` starts `null` and becomes a state only when a
// read completed and parsed. A store that threw, or a document that would not
// parse, stays `null`, which `snapshotE2eeSelection` turns into `unobtainable`
// and the classifier turns into UNEXPECTED — §4.4's "MUST NOT treat unobtainable
// evidence as an unset latch or an unset marker", implemented as the only state a
// caller can reach before a load succeeds. `classify` DOES NOT hydrate on demand,
// for exactly that reason: an implicit load would make the first channel after a
// cold start wait on the keychain and answer from it, where §13.1.1 wants the
// fail-closed answer and the owner-visible surface instead.
//
// NOTHING THE HUB SENDS WRITES TRUST. The mutators that create, promote, latch,
// or consent all take an owner decision minted below or a statement the client
// already authenticated to its own pin. The only Hub-influenced write is a
// node-id hint, which §13.1 stores "explicitly as **untrusted**
// selection-resolution hints" on a record that already exists, and which decides
// only which strict guard applies.

export type MobileE2eeTrustStoreErrorCode =
  /** The secure store failed, or the durable document could not be read. */
  | "trust_store_unavailable"
  /** The §14.5 runtime preflight refused, so no handle can be minted. */
  | "trust_store_runtime_unavailable"
  /** The selection has no record, so there is nothing to mutate. */
  | "trust_store_selection_unknown"
  /** §12.1.1: a latched pin is never offered a legacy consent. */
  | "trust_store_selection_latched"
  /** The local record bound below would be exceeded. Nothing is evicted. */
  | "trust_store_capacity_exceeded"
  /** The owner decision does not describe a comparison this device can reproduce. */
  | "trust_store_decision_invalid";

/**
 * One fixed message for every code, for the same reason the agreement key has
 * one: a fingerprint, an origin, an account scope, or a handle must not reach a
 * caller, a log, a crash report, or a view through an error.
 */
export class MobileE2eeTrustStoreError extends Error {
  readonly code: MobileE2eeTrustStoreErrorCode;

  constructor(code: MobileE2eeTrustStoreErrorCode) {
    super("Device trust store operation failed.");
    this.name = "MobileE2eeTrustStoreError";
    this.code = code;
  }
}

function trustError(code: MobileE2eeTrustStoreErrorCode): never {
  throw new MobileE2eeTrustStoreError(code);
}

/**
 * Local storage bounds. Neither is a specification limit: §13.1 bounds only the
 * node-id hints. They exist because one secure-store entry holds the whole
 * document, and an unbounded document is an unbounded write on a platform store.
 *
 * A document at the record bound REFUSES a new record rather than evicting one.
 * Oldest-first eviction is right for hints, which are untrusted; applying it to
 * records would silently drop a latched pin, and §12.1 makes losing a latch a
 * downgrade the owner never authorized.
 */
const TRUST_RECORDS_MAX = 64;
const TRUST_FIELD_MAX_LENGTH = 512;
/** 128 bits from the §14.5-verified source, rendered unpadded base64url. */
const LOCAL_NODE_HANDLE_BYTES = 16;

interface StoredTrustRecord {
  readonly hubOrigin: string;
  readonly accountId: string;
  readonly localNodeHandle: string;
  readonly state: "none" | "unverified" | "verified";
  readonly nodeIdHints: readonly string[];
  readonly environmentId?: string;
  readonly legacyConsentAt?: number;
  readonly verifiedFingerprint?: string;
  readonly recordedContinuityId?: string;
  readonly acceptedPolicyGeneration?: number;
  readonly latchedAt?: number;
  readonly approvedClientFingerprint?: string;
  readonly approvedAt?: number;
}

interface StoredStrictLegacyOrigin {
  readonly hubOrigin: string;
  readonly recordedAt: number;
}

/**
 * The two origin-keyed lists are OPTIONAL on read and always written.
 *
 * §13.1 names the reconciliation "the required behavior for any release that
 * adds the marker to an install whose pins were created by an earlier build", so
 * a document holding pins and no marker list has to parse rather than fail — an
 * unparseable document would take the whole device to `unobtainable` and lose the
 * pins the migration exists to keep. Absent reads as empty, which for the marker
 * is the value reconciliation then corrects upward, and for the strict-legacy
 * policy is the opt-in's own default.
 */
interface StoredTrustDocument {
  readonly version: 1;
  readonly records: readonly StoredTrustRecord[];
  readonly verifiedMarkerOrigins?: readonly string[];
  readonly strictLegacyOrigins?: readonly StoredStrictLegacyOrigin[];
}

interface TrustState {
  readonly records: readonly E2eeTrustRecord[];
  readonly verifiedMarkerOrigins: ReadonlySet<string>;
  readonly strictLegacyOrigins: ReadonlyMap<string, number>;
}

const EMPTY_STATE: TrustState = {
  records: [],
  verifiedMarkerOrigins: new Set(),
  strictLegacyOrigins: new Map(),
};

function boundedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > TRUST_FIELD_MAX_LENGTH) return null;
  return value;
}

function boundedCount(value: unknown): number | null {
  if (typeof value !== "number") return null;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * Parse one record, or `null`.
 *
 * A `verified` record missing any promoted field is not a verified record, and it
 * is not quietly demoted to an unverified one either: §13.1 makes every one of
 * those fields the product of the owner's decision, so a document claiming the
 * state without them describes no decision this device can stand behind. `null`
 * here fails the WHOLE document below, which is the fail-closed reading.
 */
function parseRecord(value: unknown): E2eeTrustRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const stored = value as StoredTrustRecord;
  const hubOrigin = boundedString(stored.hubOrigin);
  const accountId = boundedString(stored.accountId);
  const localNodeHandle = boundedString(stored.localNodeHandle);
  if (hubOrigin === null || accountId === null || localNodeHandle === null) return null;
  if (!Array.isArray(stored.nodeIdHints)) return null;
  if (stored.nodeIdHints.length > E2EE_PIN_NODE_ID_HINTS_MAX) return null;
  const nodeIdHints: string[] = [];
  for (const hint of stored.nodeIdHints) {
    const bounded = boundedString(hint);
    if (bounded === null) return null;
    nodeIdHints.push(bounded);
  }

  let environmentId: string | null = null;
  if (stored.environmentId !== undefined) {
    environmentId = boundedString(stored.environmentId);
    if (environmentId === null) return null;
  }

  let legacyConsent: E2eeLegacyConsent = { kind: "absent" };
  if (stored.legacyConsentAt !== undefined) {
    const recordedAt = boundedCount(stored.legacyConsentAt);
    if (recordedAt === null) return null;
    legacyConsent = { kind: "recorded", recordedAt };
  }

  const base = {
    index: { hubOrigin, accountId, localNodeHandle },
    nodeIdHints,
    legacyConsent,
    environmentId,
  };
  if (stored.state === "none") return { ...base, state: "none" };
  if (stored.state === "unverified") return { ...base, state: "unverified" };
  if (stored.state !== "verified") return null;

  const verifiedFingerprint = boundedString(stored.verifiedFingerprint);
  const recordedContinuityId = boundedString(stored.recordedContinuityId);
  const approvedClientFingerprint = boundedString(stored.approvedClientFingerprint);
  const acceptedPolicyGeneration = boundedCount(stored.acceptedPolicyGeneration);
  const approvedAt = boundedCount(stored.approvedAt);
  if (verifiedFingerprint === null || recordedContinuityId === null) return null;
  if (approvedClientFingerprint === null || acceptedPolicyGeneration === null) return null;
  if (approvedAt === null) return null;

  let latch: E2eeLatch = { kind: "unset" };
  if (stored.latchedAt !== undefined) {
    const setAt = boundedCount(stored.latchedAt);
    if (setAt === null) return null;
    latch = { kind: "set", setAt };
  }

  return {
    ...base,
    state: "verified",
    verifiedFingerprint,
    recordedContinuityId,
    acceptedPolicyGeneration,
    latch,
    approval: { clientIdentityFingerprint: approvedClientFingerprint, approvedAt },
  };
}

function parseDocument(raw: string): TrustState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const document = parsed as StoredTrustDocument;
  if (document.version !== 1) return null;
  if (!Array.isArray(document.records) || document.records.length > TRUST_RECORDS_MAX) return null;
  const storedMarkerOrigins = document.verifiedMarkerOrigins ?? [];
  const storedStrictOrigins = document.strictLegacyOrigins ?? [];
  if (!Array.isArray(storedMarkerOrigins) || !Array.isArray(storedStrictOrigins)) return null;

  const records: E2eeTrustRecord[] = [];
  for (const entry of document.records) {
    const record = parseRecord(entry);
    if (record === null) return null;
    records.push(record);
  }

  const verifiedMarkerOrigins = new Set<string>();
  for (const origin of storedMarkerOrigins) {
    const bounded = boundedString(origin);
    if (bounded === null) return null;
    verifiedMarkerOrigins.add(bounded);
  }

  const strictLegacyOrigins = new Map<string, number>();
  for (const entry of storedStrictOrigins) {
    if (typeof entry !== "object" || entry === null) return null;
    const hubOrigin = boundedString(entry.hubOrigin);
    const recordedAt = boundedCount(entry.recordedAt);
    if (hubOrigin === null || recordedAt === null) return null;
    strictLegacyOrigins.set(hubOrigin, recordedAt);
  }

  return { records, verifiedMarkerOrigins, strictLegacyOrigins };
}

function serializeRecord(record: E2eeTrustRecord): StoredTrustRecord {
  const base = {
    hubOrigin: record.index.hubOrigin,
    accountId: record.index.accountId,
    localNodeHandle: record.index.localNodeHandle,
    nodeIdHints: record.nodeIdHints,
    ...(record.environmentId === null ? {} : { environmentId: record.environmentId }),
    ...(record.legacyConsent.kind === "recorded"
      ? { legacyConsentAt: record.legacyConsent.recordedAt }
      : {}),
  };
  if (!isE2eeVerifiedPinRecord(record)) return { ...base, state: record.state };
  return {
    ...base,
    state: "verified",
    verifiedFingerprint: record.verifiedFingerprint,
    recordedContinuityId: record.recordedContinuityId,
    acceptedPolicyGeneration: record.acceptedPolicyGeneration,
    approvedClientFingerprint: record.approval.clientIdentityFingerprint,
    approvedAt: record.approval.approvedAt,
    ...(record.latch.kind === "set" ? { latchedAt: record.latch.setAt } : {}),
  };
}

function serializeDocument(state: TrustState): string {
  const document: StoredTrustDocument = {
    version: 1,
    records: state.records.map(serializeRecord),
    verifiedMarkerOrigins: [...state.verifiedMarkerOrigins],
    strictLegacyOrigins: [...state.strictLegacyOrigins].map(([hubOrigin, recordedAt]) => ({
      hubOrigin,
      recordedAt,
    })),
  };
  return JSON.stringify(document);
}

declare const ownerDecisionBrand: unique symbol;

/**
 * §13.2 step 5, as a value.
 *
 * IT CANNOT BE BUILT FROM STATEMENT MATERIAL. The brand keeps it from being
 * written as a literal, and `mintE2eeOwnerVerificationDecision` — the only
 * constructor — re-derives the §13.4 safety number from BOTH identity public keys
 * and the namespace and refuses unless the value the owner says they compared is
 * the one this device computes. A capability statement carries the node's key and
 * not the client's, so nothing a Hub can deliver produces one: "In no flow may a
 * product silently promote a self-signed first-contact key to a verified pin".
 *
 * The pinned fingerprint is DERIVED here from the key the owner compared, never
 * copied out of a statement field.
 */
export interface E2eeOwnerVerificationDecision {
  readonly [ownerDecisionBrand]: "verification";
  readonly index: E2eeTrustRecordIndex;
  readonly verifiedFingerprint: string;
  readonly clientIdentityFingerprint: string;
  readonly continuityId: string;
  readonly acceptedPolicyGeneration: number;
  readonly decidedAt: number;
}

/** §12.1.1's explicit owner legacy consent, per selection. */
export interface E2eeOwnerLegacyConsentDecision {
  readonly [ownerDecisionBrand]: "legacy-consent";
  readonly index: E2eeTrustRecordIndex;
  readonly decidedAt: number;
}

/** §12.1.1's opt-in "never legacy on this Hub", per Hub origin and nothing else. */
export interface E2eeOwnerStrictLegacyDecision {
  readonly [ownerDecisionBrand]: "strict-legacy";
  readonly hubOrigin: string;
  readonly policy: "forbid" | "permit";
  readonly decidedAt: number;
}

export interface E2eeOwnerVerificationDecisionInput {
  readonly index: E2eeTrustRecordIndex;
  /** Ed25519 node identity key the owner compared (§7.1, §13.4). */
  readonly nodeIdentityPublicKey: Uint8Array;
  /** This device's P-256 client identity key (§7.1, §13.4). */
  readonly clientIdentityPublicKey: Uint8Array;
  /** The §13.4 display value the owner read at the node CLI and compared. */
  readonly comparedSafetyNumber: string;
  /** §7.6 element 18, recorded at promotion as a classification anchor only. */
  readonly continuityId: string;
  /** §5.7's generation carried by the statement the ceremony ran against. */
  readonly acceptedPolicyGeneration: number;
  readonly decidedAt: number;
}

export function mintE2eeOwnerVerificationDecision(
  input: E2eeOwnerVerificationDecisionInput,
): E2eeOwnerVerificationDecision {
  const continuityId = boundedString(input.continuityId);
  const acceptedPolicyGeneration = boundedCount(input.acceptedPolicyGeneration);
  const decidedAt = boundedCount(input.decidedAt);
  if (continuityId === null || acceptedPolicyGeneration === null || decidedAt === null) {
    trustError("trust_store_decision_invalid");
  }
  let verifiedFingerprint: string;
  let clientIdentityFingerprint: string;
  let derived: string;
  try {
    const nodeIdentityPublicKey = validateE2eeNodeIdentityPublicKey(input.nodeIdentityPublicKey);
    const clientIdentityPublicKey = validateE2eeClientIdentityPublicKey(
      input.clientIdentityPublicKey,
    );
    verifiedFingerprint = formatE2eeKeyFingerprint(
      e2eeKeyFingerprint("node-identity", nodeIdentityPublicKey),
    );
    clientIdentityFingerprint = formatE2eeKeyFingerprint(
      e2eeKeyFingerprint("client-identity", clientIdentityPublicKey),
    );
    derived = deriveE2eeSafetyNumber({
      nodeIdentityPublicKey,
      clientIdentityPublicKey,
      hubOrigin: input.index.hubOrigin,
      accountId: input.index.accountId,
    }).display;
  } catch {
    // A malformed key, origin, or account scope. None of it may travel out of
    // here as its own message.
    trustError("trust_store_decision_invalid");
  }
  if (input.comparedSafetyNumber !== derived) trustError("trust_store_decision_invalid");
  return {
    index: input.index,
    verifiedFingerprint,
    clientIdentityFingerprint,
    continuityId,
    acceptedPolicyGeneration,
    decidedAt,
  } as E2eeOwnerVerificationDecision;
}

export function mintE2eeOwnerLegacyConsentDecision(input: {
  readonly index: E2eeTrustRecordIndex;
  readonly decidedAt: number;
}): E2eeOwnerLegacyConsentDecision {
  const decidedAt = boundedCount(input.decidedAt);
  if (decidedAt === null) trustError("trust_store_decision_invalid");
  return { index: input.index, decidedAt } as E2eeOwnerLegacyConsentDecision;
}

export function mintE2eeOwnerStrictLegacyDecision(input: {
  readonly hubOrigin: string;
  readonly policy: "forbid" | "permit";
  readonly decidedAt: number;
}): E2eeOwnerStrictLegacyDecision {
  const hubOrigin = boundedString(input.hubOrigin);
  const decidedAt = boundedCount(input.decidedAt);
  if (hubOrigin === null || decidedAt === null) trustError("trust_store_decision_invalid");
  return { hubOrigin, policy: input.policy, decidedAt } as E2eeOwnerStrictLegacyDecision;
}

/** §5.2 authenticated to a pin, or §13.3's chain that verified to it. */
export interface E2eeAuthenticatedStatementInput {
  readonly index: E2eeTrustRecordIndex;
  /** §5.2's anchor. `none` is first contact and never reaches this call. */
  readonly anchor: "pin-unchanged" | "pin-updated";
  /** §7.1 display form of the statement's CURRENT node identity fingerprint. */
  readonly identityFingerprint: string;
  /** §5.7's generation carried by the statement that authenticated. */
  readonly policyGeneration: number;
  readonly observedAt: number;
}

export interface MobileE2eeTrustStore {
  /** Load the durable document once. Never throws: a failure stays unobtainable. */
  readonly hydrate: () => Promise<void>;
  /**
   * §12.1.1 for one selection, with §13.1's marker reconciliation run FIRST.
   *
   * The reconciliation is here, and not at a call site, because §13.1 requires it
   * "before it evaluates any classification on that Hub origin", and a client
   * holding a verified pin with the marker unset is exactly the state an account
   * re-mint converts back into the legacy-eligible class.
   */
  readonly classify: (selection: E2eeTrustSelection) => Promise<E2eeTrustClassification>;
  /**
   * §12.1.1's late continuity-id resolution, applied to an existing verdict. It
   * can only tighten: the returned class is never looser than `initial`.
   */
  readonly tightenWithContinuityId: (input: {
    readonly hubOrigin: string;
    readonly accountId: string;
    readonly continuityId: string;
    readonly initial: E2eeTrustClassification;
  }) => Promise<E2eeTrustClassification>;
  /** §13.1's reconciliation, exposed for the bootstrap and for tests. */
  readonly reconcileMarker: (hubOrigin: string) => Promise<void>;
  readonly snapshot: (selection: E2eeTrustSelection) => E2eeTrustSnapshot;
  /** Display and diagnostics only. No guard reads a record through this. */
  readonly resolve: (selection: E2eeTrustSelection) => E2eeTrustRecord | null;
  readonly marker: (hubOrigin: string) => E2eeVerificationMarker;
  readonly strictLegacyPolicy: (hubOrigin: string) => E2eeStrictLegacyPolicy;
  /** §13.2 step 2: mint the client-side handle and open the pairing flow. */
  readonly beginPairing: (input: {
    readonly hubOrigin: string;
    readonly accountId: string;
    readonly nodeId?: string;
    readonly environmentId?: string;
  }) => Promise<E2eeTrustRecordIndex>;
  /** §13.2 step 5. The only path to a `verified` record, and it is atomic. */
  readonly promote: (decision: E2eeOwnerVerificationDecision) => Promise<void>;
  /** §12.1's native set condition and §13.3's silent pin update. */
  readonly recordAuthenticatedStatement: (input: E2eeAuthenticatedStatementInput) => Promise<void>;
  readonly recordLegacyConsent: (decision: E2eeOwnerLegacyConsentDecision) => Promise<void>;
  readonly setStrictLegacyPolicy: (decision: E2eeOwnerStrictLegacyDecision) => Promise<void>;
  /** §13.1's untrusted selection-resolution hint. Authorizes nothing. */
  readonly recordNodeIdHint: (index: E2eeTrustRecordIndex, nodeId: string) => Promise<void>;
  /** §13.3's owner-initiated re-pair: one selection, cleared together. */
  readonly clearSelection: (index: E2eeTrustRecordIndex) => Promise<void>;
  /** A Hub-domain change: everything recorded under that origin. */
  readonly forgetHubOrigin: (hubOrigin: string) => Promise<void>;
  /** The owner forgetting a node in the connection list. */
  readonly forgetEnvironment: (environmentId: string) => Promise<void>;
}

export interface MobileE2eeTrustStoreDependencies {
  readonly store?: E2eeSecureStore;
  readonly randomBytes?: (length: number) => Uint8Array;
}

function sameIndex(left: E2eeTrustRecordIndex, right: E2eeTrustRecordIndex): boolean {
  return (
    left.hubOrigin === right.hubOrigin &&
    left.accountId === right.accountId &&
    left.localNodeHandle === right.localNodeHandle
  );
}

/** §13.1: at most `E2EE_PIN_NODE_ID_HINTS_MAX`, oldest-first eviction. */
function withHint(hints: readonly string[], nodeId: string): readonly string[] {
  const next = [...hints, nodeId];
  return next.slice(Math.max(0, next.length - E2EE_PIN_NODE_ID_HINTS_MAX));
}

function defaultRandomBytes(length: number): Uint8Array {
  // §14.5's fail-closed preflight, for the same reason the agreement key runs it:
  // a handle drawn from a source this device cannot vouch for is a selection
  // index two nodes could share.
  assertE2eeRuntimeGlobals();
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

export function makeMobileE2eeTrustStore(
  dependencies: MobileE2eeTrustStoreDependencies = {},
): MobileE2eeTrustStore {
  const store = dependencies.store ?? mobileE2eeSecureStore;
  const randomBytes = dependencies.randomBytes ?? defaultRandomBytes;

  let loaded: TrustState | null = null;
  let hydration: Promise<void> | undefined;
  /**
   * Why `loaded` is still null, which the two owner-driven wipes below have to
   * tell apart: a document this device READ and could not parse is already
   * unusable and a wipe recovers it, while a store that would not answer may be
   * holding every pin the owner has, and discarding those on a transient
   * keychain failure would be the client losing trust state on its own.
   */
  let failure: "unparseable" | "unavailable" | null = null;

  const hydrate = (): Promise<void> =>
    (hydration ??= (async () => {
      let raw: string | null;
      try {
        raw = await store.get(E2EE_TRUST_DOCUMENT_KEY);
      } catch {
        // Unobtainable, not empty. The attempt is not memoized: a locked keychain
        // or a transient failure is a condition to retry, and until one load
        // completes every classification stays UNEXPECTED.
        failure = "unavailable";
        hydration = undefined;
        return;
      }
      // An absent document IS a completed load: a fresh install, a device whose
      // §6.3 namespace was destroyed, or one the owner cleared. A document that
      // will not parse is not — it is evidence this device cannot read, which
      // §4.4 forbids reading as unset state.
      const state = raw === null ? EMPTY_STATE : parseDocument(raw);
      if (state === null) {
        failure = "unparseable";
        hydration = undefined;
        return;
      }
      failure = null;
      loaded = state;
    })());

  /**
   * Serializes every mutation, so two owner actions cannot both read the same
   * document, both write, and leave the loser's record absent from the winner's.
   */
  let pending: Promise<unknown> = Promise.resolve();
  const exclusive = <A>(operation: () => Promise<A>): Promise<A> => {
    const run = pending.then(operation, operation);
    pending = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  /**
   * Write, then adopt.
   *
   * The in-memory state is replaced only after the durable write resolved, which
   * is what makes §13.2 step 5's atomicity hold in the process as well as on
   * disk: a crash or a refusal at the write leaves the promotion and the marker
   * both unapplied, rather than promoting in memory and telling the owner the
   * ceremony succeeded.
   */
  const commit = async (next: TrustState): Promise<void> => {
    try {
      await store.set(E2EE_TRUST_DOCUMENT_KEY, serializeDocument(next));
    } catch {
      trustError("trust_store_unavailable");
    }
    loaded = next;
  };

  /**
   * Every mutator loads first. A mutation over an unread document would drop
   * every record it could not see, so an unreadable document refuses the write
   * instead — the pins it holds are not this call's to discard.
   */
  const mutable = async (): Promise<TrustState> => {
    await hydrate();
    return loaded ?? trustError("trust_store_unavailable");
  };

  const replaceRecord = (state: TrustState, record: E2eeTrustRecord): TrustState => ({
    ...state,
    records: state.records.map((candidate) =>
      sameIndex(candidate.index, record.index) ? record : candidate,
    ),
  });

  const findRecord = (state: TrustState, index: E2eeTrustRecordIndex): E2eeTrustRecord =>
    state.records.find((record) => sameIndex(record.index, index)) ??
    trustError("trust_store_selection_unknown");

  /**
   * §13.1: set the marker wherever a verified pin exists and the marker does not.
   *
   * It only ever SETS. The marker is "a lower bound on the client's own pin set",
   * so reconciliation is the direction that restores the bound after a crash or a
   * staged rollout, and it is also "the required behavior for any release that
   * adds the marker to an install whose pins were created by an earlier build".
   * Clearing is an owner action alone (§13.3) and lives in the clear paths below.
   * This reads client-side state only.
   */
  const reconcileMarker = async (hubOrigin: string): Promise<void> => {
    const state = loaded;
    if (state === null) return;
    if (state.verifiedMarkerOrigins.has(hubOrigin)) return;
    const holdsVerified = state.records.some(
      (record) => isE2eeVerifiedPinRecord(record) && record.index.hubOrigin === hubOrigin,
    );
    if (!holdsVerified) return;
    await commit({
      ...state,
      verifiedMarkerOrigins: new Set([...state.verifiedMarkerOrigins, hubOrigin]),
    });
  };

  /** §13.3: clear the marker only if no verified pin under that origin remains. */
  const clearMarkerIfUnbacked = (state: TrustState, hubOrigin: string): TrustState => {
    const holdsVerified = state.records.some(
      (record) => isE2eeVerifiedPinRecord(record) && record.index.hubOrigin === hubOrigin,
    );
    if (holdsVerified) return state;
    const origins = new Set(state.verifiedMarkerOrigins);
    origins.delete(hubOrigin);
    return { ...state, verifiedMarkerOrigins: origins };
  };

  /**
   * The owner asked to forget part of a document this device cannot read.
   *
   * A document that would not parse is removed whole: it can no longer be edited
   * selectively, removing it is strictly more destructive than what was asked
   * for, and that is the safe direction for a wipe. A store that would not ANSWER
   * is refused instead — the pins it may still hold are not this call's to
   * discard over a locked keychain.
   */
  const forgetUnreadable = async (): Promise<void> => {
    if (failure !== "unparseable") trustError("trust_store_unavailable");
    try {
      await store.remove(E2EE_TRUST_DOCUMENT_KEY);
    } catch {
      trustError("trust_store_unavailable");
    }
    failure = null;
    loaded = EMPTY_STATE;
  };

  return {
    hydrate,

    classify: (selection) =>
      exclusive(async () => {
        await reconcileMarker(selection.hubOrigin);
        return classifyE2eeTrustSnapshot(snapshotE2eeSelection(loaded, selection));
      }),

    tightenWithContinuityId: (input) =>
      exclusive(async () => {
        await reconcileMarker(input.hubOrigin);
        const late = classifyE2eeTrustSnapshot(snapshotE2eeContinuityIdResolution(loaded, input));
        return tightenE2eeTrustClassification(input.initial, late);
      }),

    reconcileMarker: (hubOrigin) => exclusive(() => reconcileMarker(hubOrigin)),

    snapshot: (selection) => snapshotE2eeSelection(loaded, selection),

    resolve: (selection) => (loaded === null ? null : resolveE2eeTrustRecord(loaded, selection)),

    marker: (hubOrigin) => {
      const state = loaded;
      if (state === null) return { kind: "unobtainable" };
      return state.verifiedMarkerOrigins.has(hubOrigin) ? { kind: "set" } : { kind: "unset" };
    },

    strictLegacyPolicy: (hubOrigin) => {
      const state = loaded;
      if (state === null) return { kind: "unobtainable" };
      const recordedAt = state.strictLegacyOrigins.get(hubOrigin);
      return recordedAt === undefined ? { kind: "permitted" } : { kind: "forbidden", recordedAt };
    },

    beginPairing: (input) =>
      exclusive(async () => {
        const state = await mutable();
        if (state.records.length >= TRUST_RECORDS_MAX) {
          trustError("trust_store_capacity_exceeded");
        }
        let localNodeHandle: string;
        try {
          localNodeHandle = encodeBase64Url(randomBytes(LOCAL_NODE_HANDLE_BYTES));
        } catch {
          trustError("trust_store_runtime_unavailable");
        }
        const index: E2eeTrustRecordIndex = {
          hubOrigin: input.hubOrigin,
          accountId: input.accountId,
          localNodeHandle,
        };
        // §13.1: between §13.2 step 2 and step 5 the record carries the pairing
        // flow and nothing more. There is no field here to write a fingerprint,
        // a continuity id, a generation, a latch, or an approval into.
        const record: E2eeTrustRecord = {
          index,
          state: "unverified",
          nodeIdHints: input.nodeId === undefined ? [] : [input.nodeId],
          legacyConsent: { kind: "absent" },
          environmentId: input.environmentId ?? null,
        };
        await commit({ ...state, records: [...state.records, record] });
        return index;
      }),

    promote: (decision) =>
      exclusive(async () => {
        const state = await mutable();
        const existing = findRecord(state, decision.index);
        // §13.2 step 5 populates the record and sets the marker in ONE document,
        // so no interval exists in which the pin is verified and the marker is
        // not. The latch is set here because a completed ceremony is §12.1's
        // other native set condition. The strict-legacy map is carried through
        // untouched: §12.1.1 forbids strict mode becoming "a silent consequence
        // of the first verified pin".
        const promoted: E2eeVerifiedPinRecord = {
          index: existing.index,
          nodeIdHints: existing.nodeIdHints,
          legacyConsent: existing.legacyConsent,
          environmentId: existing.environmentId,
          state: "verified",
          verifiedFingerprint: decision.verifiedFingerprint,
          recordedContinuityId: decision.continuityId,
          acceptedPolicyGeneration: decision.acceptedPolicyGeneration,
          latch: { kind: "set", setAt: decision.decidedAt },
          approval: {
            clientIdentityFingerprint: decision.clientIdentityFingerprint,
            approvedAt: decision.decidedAt,
          },
        };
        await commit({
          ...replaceRecord(state, promoted),
          verifiedMarkerOrigins: new Set([
            ...state.verifiedMarkerOrigins,
            decision.index.hubOrigin,
          ]),
        });
      }),

    recordAuthenticatedStatement: (input) =>
      exclusive(async () => {
        const state = await mutable();
        const existing = findRecord(state, input.index);
        // §12.1's set condition is "authenticated a capability statement to an
        // **already verified** pin". A record that is not verified has no anchor
        // it could have authenticated against, so this is not a promotion path
        // and refuses rather than creating one.
        if (!isE2eeVerifiedPinRecord(existing)) trustError("trust_store_selection_unknown");
        const updated: E2eeVerifiedPinRecord = {
          ...existing,
          // §13.3: the pin follows the chain silently, and the latch, the
          // policy-generation memory and the approval state carry over; the
          // continuity id is unchanged by construction.
          verifiedFingerprint:
            input.anchor === "pin-updated"
              ? input.identityFingerprint
              : existing.verifiedFingerprint,
          // §5.7 remembers the HIGHEST accepted generation, so a replayed older
          // statement cannot lower it.
          acceptedPolicyGeneration: Math.max(
            existing.acceptedPolicyGeneration,
            input.policyGeneration,
          ),
          latch:
            existing.latch.kind === "set"
              ? existing.latch
              : { kind: "set", setAt: input.observedAt },
        };
        await commit(replaceRecord(state, updated));
      }),

    recordLegacyConsent: (decision) =>
      exclusive(async () => {
        const state = await mutable();
        const existing = findRecord(state, decision.index);
        // §12.1.1: a legacy consent "never applies to a latched pin", and §13.2.1
        // says a latched pin "is not offered a legacy consent at all". Refusing
        // here makes that true of the durable state, not only of the screen that
        // would have offered it.
        if (isE2eeVerifiedPinRecord(existing) && existing.latch.kind === "set") {
          trustError("trust_store_selection_latched");
        }
        await commit(
          replaceRecord(state, {
            ...existing,
            legacyConsent: { kind: "recorded", recordedAt: decision.decidedAt },
          }),
        );
      }),

    setStrictLegacyPolicy: (decision) =>
      exclusive(async () => {
        const state = await mutable();
        const origins = new Map(state.strictLegacyOrigins);
        // §12.1.1 keys this on `hubOrigin` ALONE: the pair is half Hub-chosen, and
        // a pair-keyed strict mode is shed by re-minting the account scope.
        if (decision.policy === "forbid") origins.set(decision.hubOrigin, decision.decidedAt);
        else origins.delete(decision.hubOrigin);
        await commit({ ...state, strictLegacyOrigins: origins });
      }),

    recordNodeIdHint: (index, nodeId) =>
      exclusive(async () => {
        const state = await mutable();
        const existing = findRecord(state, index);
        if (existing.nodeIdHints.includes(nodeId)) return;
        await commit(
          replaceRecord(state, {
            ...existing,
            nodeIdHints: withHint(existing.nodeIdHints, nodeId),
          }),
        );
      }),

    clearSelection: (index) =>
      exclusive(async () => {
        const state = await mutable();
        // §13.3 clears the pin, its state, the latch, the remembered policy
        // generation, the recorded continuity id, the approval state, and any
        // legacy consent "together and atomically" — one record out of one
        // document — and clears the marker only if no verified pin under that Hub
        // origin remains.
        const remaining = {
          ...state,
          records: state.records.filter((record) => !sameIndex(record.index, index)),
        };
        await commit(clearMarkerIfUnbacked(remaining, index.hubOrigin));
      }),

    forgetHubOrigin: (hubOrigin) =>
      exclusive(async () => {
        await hydrate();
        const state = loaded;
        if (state === null) {
          await forgetUnreadable();
          return;
        }
        const origins = new Set(state.verifiedMarkerOrigins);
        origins.delete(hubOrigin);
        const strict = new Map(state.strictLegacyOrigins);
        strict.delete(hubOrigin);
        await commit({
          records: state.records.filter((record) => record.index.hubOrigin !== hubOrigin),
          verifiedMarkerOrigins: origins,
          strictLegacyOrigins: strict,
        });
      }),

    forgetEnvironment: (environmentId) =>
      exclusive(async () => {
        await hydrate();
        const state = loaded;
        if (state === null) {
          await forgetUnreadable();
          return;
        }
        const removed = state.records.filter((record) => record.environmentId === environmentId);
        if (removed.length === 0) return;
        let next: TrustState = {
          ...state,
          records: state.records.filter((record) => record.environmentId !== environmentId),
        };
        for (const record of removed) next = clearMarkerIfUnbacked(next, record.index.hubOrigin);
        await commit(next);
      }),
  };
}

export const mobileE2eeTrustStore = makeMobileE2eeTrustStore();
