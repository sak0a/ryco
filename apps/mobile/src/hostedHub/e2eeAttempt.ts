import { hostedHubStore } from "@ryco/client-runtime/authorization";
import {
  relayE2eeFailure,
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
import { isE2eeVerifiedPinRecord, type E2eeTrustClassification } from "../platform/e2eeTrustModel";
import { mobileE2eeTrustStore } from "../platform/e2eeTrustStore";
import {
  beginMobileE2eeChannel,
  deriveMobileE2eeIdentityDisplay,
  lockMobileE2eeChannelMode,
  markMobileE2eeUnavailable,
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
// AHEAD of the socket and read from a slot at socket construction. The slot is
// keyed by the exact selection it was resolved for, so a stale one is never used
// for a different node, account, or Hub.
//
// THREE OUTCOMES, AND ONLY ONE OF THEM IS LEGACY BY DEFAULT:
//
//   1. A resolved attempt for this selection → the §4.4 machine, which decides
//      `e2ee`, `legacy`, or FATAL-PRE from the rows and the classification.
//   2. No credentials at all — §6.3 admits "no software-key fallback and no
//      degraded mode", so a device that cannot hold the agreement key simply has
//      no E2EE — → NO provider, an unchanged legacy channel, and §12.2's label
//      applied to it in every surface.
//   3. An attempt that is not ready yet → a channel that closes FATAL-PRE
//      without releasing anything. NOT a legacy channel: the classification is
//      exactly what has not been read, and §12.1.1 admits nothing into the
//      legacy-eligible class on absence of evidence.

/** §8.2: this client's fixed local suite-preference order. One suite is defined. */
const LOCAL_SUITE_PREFERENCE: readonly number[] = [E2EE_SUITE_25519_CHACHAPOLY_SHA256];

interface PreparedAttempt {
  readonly key: string;
  readonly attempt: RelayE2eeInitiatorAttempt;
  /** The attempt-owned copy of the X25519 scalar, zeroized on disposal. */
  readonly agreementSecretKey: Uint8Array;
}

let prepared: PreparedAttempt | null = null;
let preparing: Promise<void> | undefined;
/**
 * The selection whose credentials this device could not build (§6.3), which is
 * the ONLY state that answers `undefined` — an unchanged legacy channel.
 *
 * It is keyed by selection rather than kept as a flag so that a custody failure
 * for one node cannot silently make a different node legacy too, and it is
 * cleared on every fresh preparation.
 */
let credentialsUnavailableFor: string | null = null;

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

interface CurrentSelection {
  readonly hubOrigin: string;
  readonly accountId: string;
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly environmentId: string | null;
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
  };
}

/** §12.1.1's coarse class, which is all the §4.4 machine consumes. */
function selectionClassOf(classification: E2eeTrustClassification): RelayE2eeSelectionClass {
  return classification.class;
}

/**
 * §13.2.1 situation 2's other half: the §13.4 pair for a node this account has
 * ALREADY verified.
 *
 * It is recomputed here from the stored public key rather than read from a
 * stored display value, so §13.4's "only the pending-record copy of §13.2 is
 * persisted" stays true of this client. `null` whenever the account holds no
 * verified pin, which is every situation except 2 — and §13.2.1 forbids showing
 * one in situation 3.
 */
function previouslyVerifiedDisplay(
  selection: CurrentSelection,
  clientIdentityPublicKey: Uint8Array,
): MobileE2eeIdentityDisplay | null {
  const record = mobileE2eeTrustStore.verifiedRecordsForAccount(
    selection.hubOrigin,
    selection.accountId,
  )[0];
  if (record === undefined) return null;
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
 * Idempotent per selection and serialized: two callers racing at launch resolve
 * once. A failure leaves the slot empty rather than half-filled, so the next
 * channel either gets a complete attempt or gets no provider at all.
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

async function runPreparation(): Promise<void> {
  try {
    const selection = currentSelection();
    if (selection === null) {
      disposeMobileRelayE2eeAttempt();
      resetMobileE2eeSession();
      return;
    }
    const key = selectionKey(selection);
    if (prepared?.key === key) return;
    disposeMobileRelayE2eeAttempt();
    credentialsUnavailableFor = null;

    // §7.4 / §6.4: this device's certificate for the namespace it is in, re-signed
    // when §6.4 says it must be. A custody failure here is outcome 2 above.
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

    // §4.4: the classification is resolved HERE, before any channel exists,
    // and `classify` runs §13.1's marker reconciliation first.
    const classification = await mobileE2eeTrustStore.classify({
      kind: "node-id-hint",
      hubOrigin: selection.hubOrigin,
      accountId: selection.accountId,
      nodeId: selection.nodeId,
    });
    const record = mobileE2eeTrustStore.resolve({
      kind: "node-id-hint",
      hubOrigin: selection.hubOrigin,
      accountId: selection.accountId,
      nodeId: selection.nodeId,
    });
    const verified = record !== null && isE2eeVerifiedPinRecord(record) ? record : null;
    const marker = mobileE2eeTrustStore.marker(selection.hubOrigin);
    const legacyPermitted =
      mobileE2eeTrustStore.strictLegacyPolicy(selection.hubOrigin).kind === "permitted";

    beginMobileE2eeChannel({
      selection: {
        hubOrigin: selection.hubOrigin,
        accountId: selection.accountId,
        nodeId: selection.nodeId,
        nodeLabel: selection.nodeLabel,
        environmentId: selection.environmentId,
        localNodeHandle: record?.index.localNodeHandle ?? null,
        clientIdentityPublicKey,
      },
      classification,
      legacyPermitted,
      markerSet: marker.kind === "unobtainable" ? null : marker.kind === "set",
      previouslyVerified: previouslyVerifiedDisplay(selection, clientIdentityPublicKey),
    });

    const attempt: RelayE2eeInitiatorAttempt = {
      hubOrigin: selection.hubOrigin,
      selectionClass: selectionClassOf(classification),
      legacyPermitted,
      // §13.1's release gate, as the flag §13.2 step 2 defines: an `unverified`
      // record is the ceremony and nothing else, so its channel flushes no
      // buffered application send whatever the node answers.
      pairingOnly: record !== null && record.state === "unverified",
      localSuitePreference: LOCAL_SUITE_PREFERENCE,
      credentials: {
        tier: "native",
        accountId: selection.accountId,
        identityPublicKey: certificate.identityPublicKey,
        agreementPublicKey: certificate.agreementPublicKey,
        agreementSecretKey,
        prekeyTranscript: certificate.transcript,
        prekeySignature: certificate.signature,
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
      onStatement: (verification) => {
        observeMobileE2eeStatement(verification);
        void recordAuthenticatedStatement(
          selection,
          record?.index.localNodeHandle ?? null,
          verification,
        );
      },
      onUnexpectedNode: (evidence) => raiseMobileE2eeUnexpectedNode(evidence),
      onDiagnostic: (diagnostic) => recordMobileE2eeInitiatorDiagnostic(diagnostic),
    };
    prepared = { key, attempt, agreementSecretKey };
  } catch {
    // §6.3: no software fallback and no degraded mode. The device has no E2EE
    // this launch; the channel runs legacy and every surface says legacy.
    disposeMobileRelayE2eeAttempt();
    const selection = currentSelection();
    credentialsUnavailableFor = selection === null ? null : selectionKey(selection);
    markMobileE2eeUnavailable();
  }
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
  await mobileE2eeTrustStore
    .recordAuthenticatedStatement({
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
    })
    .catch(() => undefined);
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
 * A channel that closes FATAL-PRE without releasing anything and without a
 * record (§11.2: "a client executing FATAL-PRE sends nothing and closes").
 *
 * This is what an unresolved attempt gets. It is deliberately NOT a legacy
 * channel: the thing that has not been read IS the classification, and §12.1.1
 * admits nothing into the legacy-eligible class on absent evidence.
 */
function unresolvedAttemptChannel(host: RelayE2eeHost): RelayE2eeChannel {
  host.close(relayE2eeFailure("fatal_pre_key"));
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
 * build §8.5 credentials, so it has no E2EE at all and the engine runs the
 * unchanged legacy channel.
 */
export function resolveMobileRelayE2eeProvider(): RelayE2eeProvider | undefined {
  const selection = currentSelection();
  if (selection === null) return undefined;
  // §6.3's one legacy answer, and the only `undefined` this function returns.
  if (credentialsUnavailableFor === selectionKey(selection)) return undefined;
  const held = prepared;
  if (held === null) {
    // Not ready. Re-prime for the next attempt and fail this one closed.
    void prepareMobileRelayE2eeAttempt();
    return unresolvedAttemptChannel;
  }
  if (held.key !== selectionKey(selection)) {
    void prepareMobileRelayE2eeAttempt();
    return unresolvedAttemptChannel;
  }
  const provider = makeMobileRelayE2eeProvider({ attempt: held.attempt });
  const verified = held.attempt.verifiedPin !== undefined;
  return (host) => {
    const machine = provider(host);
    // §4.4's mode lock has no callback — it is a state the machine holds — so
    // the pill is synced after every operation that can cause one. Publishing is
    // idempotent, and a mode that never locks (an abort, a FATAL-PRE) leaves the
    // store holding `negotiating`, which claims nothing.
    const sync = () => {
      const mode = machine.mode();
      if (mode === "e2ee" || mode === "legacy") lockMobileE2eeChannelMode(mode, verified);
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

/** Test seam: drop the slot without zeroizing a buffer a test may still read. */
export function resetMobileRelayE2eeAttemptForTests(): void {
  prepared = null;
  preparing = undefined;
  credentialsUnavailableFor = null;
}
