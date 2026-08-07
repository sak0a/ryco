import { hostedHubStore } from "@ryco/client-runtime/authorization";
import {
  relayE2eeUnresolvedAttemptFailure,
  type RelayE2eeChannel,
  type RelayE2eeHost,
  type RelayE2eeInitiatorAttempt,
  type RelayE2eeProvider,
  type RelayE2eeSelectionClass,
} from "@ryco/client-runtime/relay";
import { e2eeKeyFingerprint, formatE2eeKeyFingerprint } from "@ryco/shared/relayE2eeKeys";
import { E2EE_SUITE_25519_CHACHAPOLY_SHA256 } from "@ryco/shared/relayE2eeWire";

import { getMobileDeviceIdentityPublicKey } from "../platform/deviceKey";
import { mobileE2eeAgreementKey } from "../platform/e2eeAgreementKey";
import { mobileClientE2eePrekey } from "../platform/e2eeClientPrekey";
import { makeMobileRelayE2eeProvider } from "../platform/e2eeRelayProvider";
import {
  isE2eeVerifiedPinRecord,
  type E2eeTrustClassification,
  type E2eeVerifiedPinRecord,
} from "../platform/e2eeTrustModel";
import { mobileE2eeTrustStore } from "../platform/e2eeTrustStore";
import {
  beginMobileE2eeChannel,
  beginMobileE2eeChannelAttempt,
  beginMobileE2eeFailClosedSelection,
  deriveMobileE2eeIdentityDisplay,
  lockMobileE2eeChannelMode,
  markMobileE2eeKeyCustodyUnavailable,
  observeMobileE2eeStatement,
  raiseMobileE2eeUnexpectedNode,
  recordMobileE2eeInitiatorDiagnostic,
  resetMobileE2eeSession,
  type MobileE2eeIdentityDisplay,
} from "./e2eeSession";
import { getMobileHostedConfig } from "./runtimeConfig";

// Where the native tier's §4.4 mode machine is actually WIRED to the relay —
// docs/relay-e2ee-protocol.md §4.4 (every selection guard resolved before the
// channel receives any payload), §12.1.1 (the classification), §13.1 (the pin and
// the release gate), §8.5 (the credentials the hello carries).
//
// THE TIMING IS THE WHOLE PROBLEM THIS MODULE SOLVES. `createRelaySocket` is
// synchronous — the shared transport calls it the instant a ticket resolves — and
// §4.4 requires the pin, the classification, the device marker and the owner's
// consent to be "evaluable before it has received any payload". Reading a
// keychain and a secure store is not synchronous, so the attempt is resolved
// AHEAD of the socket and read from a slot at socket construction.
//
// THE SLOT KEY IS THE SELECTION *AND* THE TRUST DOCUMENT'S REVISION. Keying it on
// the selection alone made the cache outlive the owner's decisions: §13.2 step 5's
// promotion, §13.3's re-pair and §12.1.1's consent all change exactly the inputs
// resolved here, and none of them changes the account or the node. Every channel
// after such a decision then evaluated §12.1's latch, §12.1.1's class and §13.1's
// pin against pre-decision state — a forgotten node still reporting a verified pin,
// a freshly verified one still reporting none. The revision is bumped by the store
// on every commit, so a committed decision invalidates this slot by construction.
//
// THREE OUTCOMES, AND ONLY ONE OF THEM IS LEGACY:
//
//   1. A resolved attempt for this selection → the §4.4 machine, which decides
//      `e2ee`, `legacy`, or FATAL-PRE from the rows and the classification.
//   2. No key custody at all — §6.3 admits "no software-key fallback and no
//      degraded mode", so a device that cannot hold the agreement key simply has
//      no E2EE — → NO provider, an unchanged legacy channel, and §12.2's label
//      applied to it in every surface. It is withheld even then from a selection
//      §12.1 has latched or whose §12.1.1 policy forbids legacy: those close.
//   3. Anything else that is not ready — including an unreadable trust document —
//      → a channel that closes without releasing anything. NOT a legacy channel:
//      the classification is exactly what has not been read, and §12.1.1 admits
//      nothing into the legacy-eligible class on absence of evidence.

/** §8.2: this client's fixed local suite-preference order. One suite is defined. */
const LOCAL_SUITE_PREFERENCE: readonly number[] = [E2EE_SUITE_25519_CHACHAPOLY_SHA256];

/**
 * How many times one preparation re-reads the live selection before giving up.
 *
 * A pass that lands on a selection or a trust revision that has since moved
 * cannot assign its result — it would be an attempt about state that is no longer
 * current — so it starts over. The bound exists because the inputs it re-reads
 * are owner-driven and can in principle change faster than a keychain read: after
 * it, the slot is simply left empty and the next channel fails closed and
 * re-primes, which is the same answer one pass further on.
 */
const PREPARATION_MAX_PASSES = 4;

interface PreparedAttempt {
  readonly key: string;
  readonly attempt: RelayE2eeInitiatorAttempt;
  /** The attempt-owned copy of the X25519 scalar, zeroized on disposal. */
  readonly agreementSecretKey: Uint8Array;
}

let prepared: PreparedAttempt | null = null;
let preparing: Promise<void> | undefined;
/**
 * The slot whose §6.3 key custody this device does not have, which is the ONLY
 * state that answers `undefined` — an unchanged legacy channel.
 *
 * It is keyed by slot rather than kept as a flag so that a custody failure for
 * one node cannot silently make a different node legacy too, and it is cleared on
 * every fresh preparation, so the answer is retried rather than latched for the
 * session.
 */
let custodyUnavailableFor: string | null = null;
/** A resolved strict failure whose owner-visible trust context survives retries. */
let strictUnavailableFor: string | null = null;
/**
 * Underlying authenticated trust mutations, keyed independently of cache
 * revision and lifecycle generation. A deadline closes only the channel that
 * was waiting; it never clears this fence or pretends the OS write was cancelled.
 */
const pendingTrustCommits = new Map<string, Promise<void>>();

/**
 * The selection an attempt belongs to, as one comparable string.
 *
 * NUL-joined rather than concatenated: `accountId` and `nodeId` are Hub-issued
 * (§12.1.1), so a separator they could contain would let one selection's key be
 * spelled by another's fields.
 */
function selectionKey(input: {
  readonly hubOrigin: string;
  readonly accountId: string;
  readonly nodeId: string;
}): string {
  return `${input.hubOrigin}\u0000${input.accountId}\u0000${input.nodeId}`;
}

/** The selection, lifecycle owner, and trust document it was resolved against. */
function slotKey(selection: CurrentSelection): string {
  return `${selectionKey(selection)}\u0000${selection.generation}\u0000${mobileE2eeTrustStore.revision()}`;
}

interface CurrentSelection {
  readonly hubOrigin: string;
  readonly accountId: string;
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly environmentId: string | null;
  readonly generation: number;
}

/** The hosted selection a channel would be opened for, or `null`. */
function currentSelection(): CurrentSelection | null {
  const config = getMobileHostedConfig();
  if (config === null) return null;
  const state = hostedHubStore.getState();
  const node = state.selectedNode;
  if (state.accountStatus !== "authenticated" || state.account === null || node === null) {
    return null;
  }
  return {
    hubOrigin: config.hubOrigin,
    accountId: state.account.id,
    nodeId: node.id,
    nodeLabel: node.label,
    environmentId: node.environmentId,
    generation: state.generation,
  };
}

function ownsSelection(selection: CurrentSelection): boolean {
  const live = currentSelection();
  return (
    live !== null &&
    live.generation === selection.generation &&
    selectionKey(live) === selectionKey(selection)
  );
}

/** §12.1.1's coarse class, which is all the §4.4 machine consumes. */
function selectionClassOf(classification: E2eeTrustClassification): RelayE2eeSelectionClass {
  return classification.class;
}

/**
 * §13.2.1 situation 2's other half: the §13.4 pair for the identity the presented
 * one is being COMPARED AGAINST.
 *
 * It is the pin this selection resolves to, and where the selection resolves to
 * none it is the account's single verified pin — which is the only case in which
 * "the previously verified fingerprint" names one identity. An account holding
 * several is deliberately shown NOTHING rather than an arbitrary sibling: §13.2.1
 * asks the owner to compare two values that are supposed to match, and a
 * mismatch against a node that was never the subject carries no information and
 * trains exactly the click-through the surface exists to prevent.
 *
 * It is recomputed here from the stored public key rather than read from a
 * stored display value, so §13.4's "only the pending-record copy of §13.2 is
 * persisted" stays true of this client. `null` whenever the account holds no
 * verified pin, which is every situation except 2 — and §13.2.1 forbids showing
 * one in situation 3.
 */
function previouslyVerifiedDisplay(
  selection: CurrentSelection,
  resolved: E2eeVerifiedPinRecord | null,
  clientIdentityPublicKey: Uint8Array,
): MobileE2eeIdentityDisplay | null {
  const underAccount = mobileE2eeTrustStore.verifiedRecordsForAccount(
    selection.hubOrigin,
    selection.accountId,
  );
  const record = resolved ?? (underAccount.length === 1 ? (underAccount[0] ?? null) : null);
  if (record === null) return null;
  try {
    return deriveMobileE2eeIdentityDisplay({
      nodeIdentityPublicKey: record.verifiedIdentityPublicKey,
      clientIdentityPublicKey,
      hubOrigin: selection.hubOrigin,
      accountId: selection.accountId,
    });
  } catch {
    return null;
  }
}

/**
 * Resolve everything one channel attempt needs, for the CURRENT selection.
 *
 * Idempotent per slot and serialized: two callers racing at launch resolve once.
 * A failure leaves the slot empty rather than half-filled, so the next channel
 * either gets a complete attempt, gets no provider at all (§6.3), or fails closed.
 */
export function prepareMobileRelayE2eeAttempt(): Promise<void> {
  // The clear is a `.finally` on the DERIVED promise rather than a `finally`
  // block inside the body. A preparation that returns before its first `await`
  // — no selection, or a slot that is already current — otherwise runs its
  // whole body synchronously, clears the slot, and is then assigned INTO it, so
  // `??=` would short-circuit every later call against a settled promise and the
  // attempt would never be re-resolved again.
  preparing ??= runPreparation().finally(() => {
    preparing = undefined;
  });
  return preparing;
}

/**
 * Passes, not one shot.
 *
 * `preparing` de-duplicates by "a preparation is running", so a selection change
 * that arrives while one is in flight joins it rather than scheduling its own.
 * Each pass therefore re-reads the live selection after its awaits and starts
 * over when it moved, instead of settling an attempt for the node the owner just
 * left — which is deterministic, not a race: switching nodes inside one
 * preparation window always produced it.
 */
async function runPreparation(): Promise<void> {
  for (let pass = 0; pass < PREPARATION_MAX_PASSES; pass += 1) {
    if (await runPreparationPass()) return;
  }
}

/** One pass. `true` when the slot now describes the live selection. */
async function runPreparationPass(): Promise<boolean> {
  const selection = currentSelection();
  if (selection === null) {
    disposeMobileRelayE2eeAttempt();
    custodyUnavailableFor = null;
    strictUnavailableFor = null;
    resetMobileE2eeSession();
    return true;
  }
  // A previous channel authenticated a durable trust advance for this same
  // selection. Until the underlying OS-backed write settles, no attempt may
  // classify the old generation or borrow the old pin. Keep the complete cached
  // attempt intact for the callback that still owns its scalar, but mark this
  // preparation complete and let provider resolution close new channels.
  if (pendingTrustCommits.has(selectionKey(selection))) return true;
  const key = slotKey(selection);
  if (prepared?.key === key) return true;
  const retainsCurrentFailureClaim = custodyUnavailableFor === key || strictUnavailableFor === key;
  disposeMobileRelayE2eeAttempt();
  // The old projection belongs to the disposed slot just as surely as its
  // scalar does. Clear it before any awaited guard or credential operation so
  // a failure for the new selection cannot leave the previous channel's
  // `verified` or `legacy` claim visible beside a channel that failed closed.
  // A successful pass publishes the complete replacement below; a permitted
  // no-custody legacy result publishes its bounded legacy claim explicitly.
  // A same-slot retry after either resolved failure keeps that bounded claim
  // while the key stores are retried. Clearing it here would let
  // `resolveMobileRelayE2eeProvider` erase the legacy label or unexpected-node
  // ceremony merely by scheduling the retry it promises to perform.
  if (!retainsCurrentFailureClaim) resetMobileE2eeSession();
  custodyUnavailableFor = null;
  strictUnavailableFor = null;

  // §4.4: the client-anchored guards are resolved HERE, before any channel
  // exists and BEFORE any custody call, and `classify` runs §13.1's marker
  // reconciliation first. A store that cannot answer them throws, and that is
  // NOT the §6.3 no-custody outcome: §4.4 forbids treating unobtainable evidence
  // as an unset latch or an unset marker, so the slot is left empty and the
  // channel fails closed.
  let guards: ResolvedGuards;
  try {
    guards = await resolveGuards(selection);
  } catch {
    const live = currentSelection();
    // A moved selection needs another pass. A current selection whose guards
    // are unobtainable is already a complete fail-closed result; retry it on
    // the next channel, not four times inside this preparation.
    return live !== null && slotKey(live) === key;
  }

  // §7.4 / §6.4 and §6.3's key custody. A failure here is outcome 2 — but only
  // where §12.1.1 classified this exact selection as legacy-eligible and local
  // policy still permits a legacy channel. `unexpected`, `latched`, and
  // unobtainable evidence are all strict local classes: no credential failure
  // may convert any of them into plaintext eligibility.
  let credentials: ResolvedCredentials;
  try {
    credentials = await resolveCredentials(selection);
  } catch {
    const live = currentSelection();
    if (live === null || slotKey(live) !== key) return false;
    // §6.3: no software fallback and no degraded mode. The device has no E2EE
    // for this selection; the channel runs legacy and every surface says legacy
    // only for the exact legacy-eligible/permitted conjunction. A local failure
    // cannot talk an unexpected, latched, or policy-forbidden selection out of
    // its fail-closed result.
    if (guards.classification.class !== "legacy-eligible" || !guards.legacyPermitted) {
      strictUnavailableFor = key;
      beginMobileE2eeFailClosedSelection({
        selection: {
          hubOrigin: selection.hubOrigin,
          accountId: selection.accountId,
          nodeId: selection.nodeId,
          nodeLabel: selection.nodeLabel,
          environmentId: selection.environmentId,
          localNodeHandle: guards.record?.index.localNodeHandle ?? null,
        },
        classification: guards.classification,
        legacyPermitted: guards.legacyPermitted,
        markerSet: guards.markerSet,
        pinVerified: guards.verified !== null,
      });
      // This keyed strict result is complete. The unresolved provider retries
      // once for the next channel; the preparation loop must not hammer secure
      // storage four times for the same persistent failure.
      return true;
    }
    custodyUnavailableFor = key;
    markMobileE2eeKeyCustodyUnavailable();
    return true;
  }

  // The selection, the account, or the trust document may all have moved while
  // the keychain was read. An attempt describes the state it was resolved from,
  // so one that no longer matches is zeroized and dropped rather than assigned.
  const live = currentSelection();
  if (live === null || slotKey(live) !== key) {
    credentials.agreementSecretKey.fill(0);
    return false;
  }

  const record = guards.record;
  const verified = guards.verified;
  beginMobileE2eeChannel({
    selection: {
      hubOrigin: selection.hubOrigin,
      accountId: selection.accountId,
      nodeId: selection.nodeId,
      nodeLabel: selection.nodeLabel,
      environmentId: selection.environmentId,
      localNodeHandle: record?.index.localNodeHandle ?? null,
      clientIdentityPublicKey: credentials.clientIdentityPublicKey,
    },
    classification: guards.classification,
    legacyPermitted: guards.legacyPermitted,
    markerSet: guards.markerSet,
    // §13.1: the release gate's own input, published with the guards it was
    // resolved beside rather than carried into the lock by a closure the suite
    // cannot see — `e2ee` alone is not §2.2's bottom row, and the pin decides.
    pinVerified: verified !== null,
    previouslyVerified: previouslyVerifiedDisplay(
      selection,
      verified,
      credentials.clientIdentityPublicKey,
    ),
  });

  const attempt: RelayE2eeInitiatorAttempt = {
    hubOrigin: selection.hubOrigin,
    selectionClass: selectionClassOf(guards.classification),
    legacyPermitted: guards.legacyPermitted,
    // §13.2 step 2's flag, which closes BOTH valves: a ceremony channel flushes
    // no buffered application send and locks no mode at all, whatever the node
    // answers. §13.1's release gate is the other valve and is not this flag —
    // the initiator refuses the `e2ee` lock to any native attempt that resolved
    // to no verified pin, so genuine first contact is still free to fall back to
    // legacy under §12.1.1 branch (a) while releasing nothing over E2EE.
    pairingOnly: record !== null && record.state === "unverified",
    localSuitePreference: LOCAL_SUITE_PREFERENCE,
    credentials: {
      tier: "native",
      accountId: selection.accountId,
      identityPublicKey: credentials.certificate.identityPublicKey,
      agreementPublicKey: credentials.certificate.agreementPublicKey,
      agreementSecretKey: credentials.agreementSecretKey,
      prekeyTranscript: credentials.certificate.transcript,
      prekeySignature: credentials.certificate.signature,
    },
    // §8.3 elements 9 and 17 come from the RESOLVED VERIFIED PIN, never from
    // a statement: "a key merely carried by a self-signed first-contact
    // statement is not a trust anchor". An `unverified` record anchors
    // nothing and is deliberately not passed.
    ...(verified === null
      ? {}
      : {
          verifiedPin: {
            // §7.1 fingerprint BYTES, recomputed from the pinned key rather
            // than parsed back out of its display form.
            identityFingerprint: e2eeKeyFingerprint(
              "node-identity",
              verified.verifiedIdentityPublicKey,
            ),
            continuityId: verified.recordedContinuityId,
          },
          acceptedPolicyGeneration: verified.acceptedPolicyGeneration,
        }),
    accountId: selection.accountId,
    onStatement: async (verification) => {
      if (!ownsSelection(selection)) throw new Error("Mobile E2EE selection was superseded.");
      // Establish the per-selection fence before publishing to session
      // listeners. A listener may synchronously open another channel; it must
      // observe the pending mutation and fail closed, never borrow stale trust.
      const persistence = recordAuthenticatedStatement(
        selection,
        record?.index.localNodeHandle ?? null,
        verification,
      );
      observeMobileE2eeStatement(verification);
      await persistence;
      // The authenticated old selection may still tighten its own durable
      // record after a deadline or navigation. It cannot resume or project into
      // a lifecycle generation that did not own this callback.
      if (!ownsSelection(selection)) throw new Error("Mobile E2EE selection was superseded.");
    },
    onUnexpectedNode: (evidence) => raiseMobileE2eeUnexpectedNode(evidence),
    onDiagnostic: (diagnostic) => recordMobileE2eeInitiatorDiagnostic(diagnostic),
  };
  prepared = { key, attempt, agreementSecretKey: credentials.agreementSecretKey };
  return true;
}

/** §12.1.1's class, §13.1's pin and marker, and §12.1.1's strict-legacy policy. */
interface ResolvedGuards {
  readonly classification: E2eeTrustClassification;
  readonly record: ReturnType<typeof mobileE2eeTrustStore.resolve>;
  readonly verified: E2eeVerifiedPinRecord | null;
  readonly markerSet: boolean | null;
  readonly legacyPermitted: boolean;
}

async function resolveGuards(selection: CurrentSelection): Promise<ResolvedGuards> {
  const trustSelection = {
    kind: "node-id-hint",
    hubOrigin: selection.hubOrigin,
    accountId: selection.accountId,
    nodeId: selection.nodeId,
  } as const;
  const classification = await mobileE2eeTrustStore.classify(trustSelection);
  const record = mobileE2eeTrustStore.resolve(trustSelection);
  const marker = mobileE2eeTrustStore.marker(selection.hubOrigin);
  return {
    classification,
    record,
    verified: record !== null && isE2eeVerifiedPinRecord(record) ? record : null,
    markerSet: marker.kind === "unobtainable" ? null : marker.kind === "set",
    legacyPermitted:
      mobileE2eeTrustStore.strictLegacyPolicy(selection.hubOrigin).kind === "permitted",
  };
}

interface ResolvedCredentials {
  readonly certificate: Awaited<ReturnType<typeof mobileClientE2eePrekey.ensure>>;
  readonly clientIdentityPublicKey: Uint8Array;
  readonly agreementSecretKey: Uint8Array;
}

async function resolveCredentials(selection: CurrentSelection): Promise<ResolvedCredentials> {
  const certificate = await mobileClientE2eePrekey.ensure({
    hubOrigin: selection.hubOrigin,
    accountId: selection.accountId,
  });
  const clientIdentityPublicKey = await getMobileDeviceIdentityPublicKey();
  // The scalar has to outlive the borrow: §8.5's hello is built at row K1,
  // long after `channel.accept`, and the borrow contract is one operation
  // wide. The copy is this module's, and `disposeMobileRelayE2eeAttempt`
  // zeroizes it the moment the attempt stops being current.
  const agreementSecretKey = await mobileE2eeAgreementKey.withSecretKey((secretKey) =>
    Uint8Array.from(secretKey),
  );
  return { certificate, clientIdentityPublicKey, agreementSecretKey };
}

/**
 * §12.1's latch and §13.3's silent pin update, applied to durable state.
 *
 * Only the two anchors that AUTHENTICATED to the pin have a mutator to reach:
 * §13.3's chain failure updates no pin, and §5.7's policy-generation regression
 * is a local diagnostic that "MUST NOT by itself launch the §13.2 ceremony or the
 * §13.3 re-verification UI". `resolveE2eeTrustStatementOutcome` is what separates
 * them, and this call site can express nothing else.
 */
async function recordAuthenticatedStatement(
  selection: CurrentSelection,
  localNodeHandle: string | null,
  verification: Parameters<typeof observeMobileE2eeStatement>[0],
): Promise<void> {
  if (localNodeHandle === null) return;
  if (verification.kind !== "verified") return;
  if (verification.anchor === "none") return;
  const key = selectionKey(selection);
  if (pendingTrustCommits.has(key)) {
    throw new Error("Mobile E2EE trust commit is already pending.");
  }
  const operation = mobileE2eeTrustStore.recordAuthenticatedStatement({
    index: {
      hubOrigin: selection.hubOrigin,
      accountId: selection.accountId,
      localNodeHandle,
    },
    anchor: verification.anchor,
    identityFingerprint: formatStatementFingerprint(verification.statement.identityPublicKey),
    identityPublicKey: verification.statement.identityPublicKey,
    policyGeneration: verification.statement.policyGeneration,
    observedAt: Date.now(),
  });
  pendingTrustCommits.set(key, operation);
  const clear = (): void => {
    if (pendingTrustCommits.get(key) === operation) pendingTrustCommits.delete(key);
  };
  // Attach both arms immediately. A channel deadline does not cancel the store
  // promise, and a late rejection must remain handled even if its initiator has
  // already closed and released its own wait.
  void operation.then(clear, clear);
  await operation;
}

/** §7.1's display form of one node identity key. No namespace is involved. */
function formatStatementFingerprint(identityPublicKey: Uint8Array): string {
  return formatE2eeKeyFingerprint(e2eeKeyFingerprint("node-identity", identityPublicKey));
}

/** Zeroize and drop the attempt-owned scalar. Idempotent. */
export function disposeMobileRelayE2eeAttempt(): void {
  if (prepared === null) return;
  prepared.agreementSecretKey.fill(0);
  prepared = null;
}

/**
 * A channel that closes without releasing anything and without a record (§11.2:
 * "a client executing FATAL-PRE sends nothing and closes").
 *
 * This is what an unresolved attempt gets. It is deliberately NOT a legacy
 * channel: the thing that has not been read IS the classification, and §12.1.1
 * admits nothing into the legacy-eligible class on absent evidence.
 *
 * The close is the RETRYABLE one. On the wire it is §11.5's uniform observable,
 * identical to every other pre-key close; locally it must not be the
 * non-retryable disposition an actual cryptographic failure carries, because
 * that drives the transport to `terminal-failure` and stops reconnection
 * altogether — a warm-up race would take the whole hosted session down instead
 * of costing one channel.
 */
function unresolvedAttemptChannel(host: RelayE2eeHost): RelayE2eeChannel {
  host.close(relayE2eeUnresolvedAttemptFailure());
  return {
    intercept: async () => ({ kind: "rejected" }),
    emit: async () => false,
    beginClose: async () => "refused",
    dispose: () => undefined,
  };
}

/**
 * The `RelayE2eeProvider` the hosted socket is built with, resolved
 * synchronously at `createRelaySocket`.
 *
 * `undefined` means outcome 2 above and nothing else: this device could not
 * build §8.5 credentials for a selection §12.1.1 still permits legacy for, so it
 * has no E2EE at all and the engine runs the unchanged legacy channel. Every
 * other unresolved state — including no selection at all — closes.
 */
export function resolveMobileRelayE2eeProvider(): RelayE2eeProvider | undefined {
  const selection = currentSelection();
  // Nothing to secure and nothing to classify. The store can move between the
  // transport's reconnect gate and this synchronous construction — a sign-out or
  // a Hub-profile change during backoff — so this is unresolved evidence like
  // any other, never a plaintext channel nobody decided on.
  if (selection === null) return unresolvedAttemptChannel;
  if (pendingTrustCommits.has(selectionKey(selection))) return unresolvedAttemptChannel;
  const key = slotKey(selection);
  // §6.3's one legacy answer, and the only `undefined` this function returns.
  // The preparation is re-primed either way, so the answer is retried on the
  // next channel rather than latched for the session.
  if (custodyUnavailableFor === key) {
    void prepareMobileRelayE2eeAttempt();
    return undefined;
  }
  const held = prepared;
  if (held === null || held.key !== key) {
    // Not ready, or resolved against a selection or a trust document that has
    // since moved. Re-prime for the next attempt and fail this one closed.
    void prepareMobileRelayE2eeAttempt();
    return unresolvedAttemptChannel;
  }
  const provider = makeMobileRelayE2eeProvider({ attempt: held.attempt });
  return (host) => {
    // §13's projection is PER CHANNEL, not per preparation: a claim earned by one
    // channel may not describe the next one. Publishing `negotiating` here is
    // what keeps a verified label from surviving the socket that earned it.
    beginMobileE2eeChannelAttempt();
    const machine = provider(host);
    // §4.4's mode lock has no callback — it is a state the machine holds — so
    // the pill is synced after every operation that can cause one. Publishing is
    // idempotent, and a mode that never locks (an abort, a FATAL-PRE) leaves the
    // store holding `negotiating`, which claims nothing.
    const sync = () => {
      const mode = machine.mode();
      if (mode === "e2ee" || mode === "legacy") lockMobileE2eeChannelMode(mode);
    };
    return {
      ...machine,
      intercept: async (payload) => {
        const disposition = await machine.intercept(payload);
        sync();
        return disposition;
      },
      emit: async (message) => {
        const emitted = await machine.emit(message);
        sync();
        return emitted;
      },
      dispose: (options) => {
        machine.dispose(options);
      },
    };
  };
}

/**
 * The resolved attempt, for the suite that asserts what it carries.
 *
 * Every field below is a §4.4 guard, a §13.1 anchor, or §13.2's release flag, and
 * none of them is observable through the provider the engine receives — which is
 * how five separate mutations of them once survived the whole suite. It is a
 * BOUNDED PROJECTION rather than the attempt: no credential, no scalar, no
 * transcript and no signature is exposed, and the pin is reported as presence
 * plus its §7.1 display form, never as key material.
 */
export function inspectMobileRelayE2eeAttemptForTests(): {
  readonly selectionClass: RelayE2eeSelectionClass;
  readonly legacyPermitted: boolean;
  readonly pairingOnly: boolean;
  readonly verifiedPinFingerprint: string | null;
  readonly acceptedPolicyGeneration: number | undefined;
} | null {
  const held = prepared;
  if (held === null) return null;
  const pin = held.attempt.verifiedPin;
  return {
    selectionClass: held.attempt.selectionClass,
    legacyPermitted: held.attempt.legacyPermitted,
    pairingOnly: held.attempt.pairingOnly,
    verifiedPinFingerprint:
      pin === undefined ? null : formatE2eeKeyFingerprint(pin.identityFingerprint),
    acceptedPolicyGeneration: held.attempt.acceptedPolicyGeneration,
  };
}

/** Test seam: drop the slot without zeroizing a buffer a test may still read. */
export function resetMobileRelayE2eeAttemptForTests(): void {
  prepared = null;
  preparing = undefined;
  custodyUnavailableFor = null;
  strictUnavailableFor = null;
  pendingTrustCommits.clear();
}
