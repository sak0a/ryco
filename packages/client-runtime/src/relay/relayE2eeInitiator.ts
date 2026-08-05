import {
  e2eeChannelSizeBudget,
  T_ADV,
  T_HANDSHAKE,
  T_KEEPALIVE_FLUSH_MARGIN,
  RPC_KEEPALIVE_INTERVAL,
} from "@ryco/shared/relayE2eeConstants";
import {
  verifyNodeE2eeCapabilityStatement,
  type NodeE2eeCapabilityAnchor,
  type NodeE2eeCapabilityVerification,
  type NodeE2eeVerifiedPin,
} from "@ryco/shared/relayE2eeCapabilityVerify";
import {
  E2eeClientHandshake,
  type E2eeAdvertisedChannelMaterial,
  type E2eeClientHandshakeCredentials,
} from "@ryco/shared/relayE2eeHandshake";
import { eraseE2eeSessionSecrets, type E2eeSessionSecrets } from "@ryco/shared/relayE2eeSession";
import type { NodeE2eeCapabilityStatement } from "@ryco/shared/relayE2eeTranscripts";
import { deriveE2eeWebSas } from "@ryco/shared/relayE2eeVerificationDisplay";
import {
  classifyPostStripPayload,
  decodeE2eeCapabilityCarrier,
  decodeE2eeNegotiationRecord,
  E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT,
  E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT,
  type E2eeSuiteId,
} from "@ryco/shared/relayE2eeWire";

import { makeRelayE2eeClientChannel } from "./relayE2eeChannel.ts";
import {
  relayE2eeFailure,
  type RelayE2eeChannel,
  type RelayE2eeCloseAttempt,
  type RelayE2eeHost,
  type RelayE2eeInboundDisposition,
} from "./relayEngine.ts";

// The CLIENT (initiator) mode machine — docs/relay-e2ee-protocol.md §4.4 rows
// K1–K24, the §4.4 send-buffer disposition, the §4.4 timers, and the §8.5/§8.8
// wiring of the shared client handshake onto the real relay path.
//
// IT IS THE STRUCTURAL MIRROR of the node's `NodeE2eeChannelSession` mode
// machine, and divergence that the direction does not force is a defect rather
// than a style: the two endpoints implement the same normative table from
// opposite sides.
//
// WHAT THIS OWNS: one channel's K-row dispatch, its `T_ADV` and `T_HANDSHAKE`
// deadlines, the single mode lock, and the mapping of every pre-key fatal
// condition onto §11.2's observable. It verifies no statement (§5.2 lives in
// `relayE2eeCapabilityVerify`), derives no key and builds no hello body (§8 lives
// in `E2eeClientHandshake`), classifies no selection (§12.1.1 is client-anchored
// state the caller resolves before the channel exists), and protects no record
// (§9 and §10 live in `relayE2eeChannel`).
//
// THE ONE RULE WORTH STATING AS A PROPERTY OF THE CODE RATHER THAN OF A COMMENT:
// §11.2 says "a client executing FATAL-PRE sends nothing and closes". There is
// therefore NO reject-emitting branch anywhere in this module — not a guarded
// one, not a dead one. The only bytes it ever puts on the wire are one
// `E2EEClientHello` on row K1, and every fatal path funnels through `fatalPre`,
// which emits nothing at all.

/**
 * §12.1.1's classification of the channel's selection, computed by the caller
 * from CLIENT-ANCHORED STATE ALONE — the resolved pin, the verified pins under
 * the pair, the device-level `anyNodeVerified(hubOrigin)` marker, and the
 * owner's recorded consent — and never from anything the Hub supplies or the
 * channel carries.
 *
 * §4.4 requires it to be resolvable "before it has received any payload", which
 * is why it arrives as a value on the attempt rather than as a callback this
 * machine could invoke at row-evaluation time against state that has since moved.
 */
export type RelayE2eeSelectionClass = "latched" | "legacy-eligible" | "unexpected";

/** What the client held about the node when the §13.2.1 surface was raised. */
export type RelayE2eeUnexpectedNodeEvidence = "none" | "first-contact-statement";

/**
 * A client-local diagnostic for one pre-key condition (§11.4).
 *
 * It carries the §11.2 row this client enumerated and nothing else — no
 * statement bytes, no fingerprint, no transcript value, no key. §11.2's
 * anti-oracle rule governs the WIRE; this is the operator's side of the same
 * event and MUST NOT alter it.
 */
export interface RelayE2eeInitiatorDiagnostic {
  readonly phase: "pre_key";
  /** A §11.2 row, or `local` for a client-local condition that table does not enumerate. */
  readonly row: string;
}

/**
 * Everything one channel's attempt needs, resolved BEFORE `channel.accept`.
 *
 * §4.4 fixes the timing: "Every latch and pin guard in the client rows (K2, K3,
 * K9, K10, K13, K14, K23, K24) is evaluated against the pin the client resolves
 * from **its own** channel selection … A client MUST be able to evaluate these
 * guards before it has received any payload, and MUST NOT treat unobtainable
 * evidence as an unset latch or an unset marker." A store that has not completed
 * its load produces `unexpected`, and it does so in the CALLER, so this machine
 * has no state in which it could mistake absence for permission.
 */
export interface RelayE2eeInitiatorAttempt {
  /** §8.3 element 1: the canonical Hub origin this client is actually connected to. */
  readonly hubOrigin: string;
  readonly selectionClass: RelayE2eeSelectionClass;
  /**
   * §12.1.1's strict-legacy policy, recorded and evaluated under `hubOrigin`
   * ALONE. An unobtainable policy is `false` here, exactly as §13.2.1 answers a
   * forbidding one: withheld rather than guessed.
   */
  readonly legacyPermitted: boolean;
  /**
   * §13.2 step 2. A pairing attempt sends its one bounded hello to introduce the
   * client's identity and NOTHING ELSE follows from it: buffered application
   * sends are never flushed and no application payload is released, whatever the
   * node answers.
   */
  readonly pairingOnly: boolean;
  /** §8.2: this client's own fixed local suite-preference order. */
  readonly localSuitePreference: readonly number[];
  readonly credentials: E2eeClientHandshakeCredentials;
  /**
   * §8.3: the verified pin the selection resolved to, when it resolved to one.
   * It is the PROVENANCE of context elements 9 and 17 — an `unverified` record
   * anchors nothing and MUST NOT be passed here (§13.1).
   */
  readonly verifiedPin?: NodeE2eeVerifiedPin | undefined;
  /** §12.1.1: the Hub-issued account scope this selection resolved under. */
  readonly accountId?: string | undefined;
  /** §5.7: the highest policy generation already accepted for this node. */
  readonly acceptedPolicyGeneration?: number | undefined;
  /** §5.2's verdict, for the caller's durable trust state. Never a wire effect. */
  readonly onStatement?: ((verification: NodeE2eeCapabilityVerification) => void) | undefined;
  /** §13.2.1: the unexpected-node surface, raised locally on rows K23 and K24. */
  readonly onUnexpectedNode?: ((evidence: RelayE2eeUnexpectedNodeEvidence) => void) | undefined;
  readonly onDiagnostic?: ((diagnostic: RelayE2eeInitiatorDiagnostic) => void) | undefined;
  /**
   * §13.5: the RENDERED `WebSAS` for this session, once and only at the `e2ee`
   * lock, and only on the WEB tier.
   *
   * THE PAYLOAD IS THE DISPLAY STRING AND NOTHING ELSE. §13.5 derives the value
   * from this client's own Noise ephemeral and the §8.8 `sessionBindingHash`,
   * both of which stay inside this module and the shared handshake: an app tier
   * that received the ephemeral could render a code for a handshake this client
   * never completed, which is precisely the session binding §13.5 relies on for
   * non-precomputability. It is ephemeral display state — §13.5 forbids logging,
   * persisting, or sending it to analytics — and the disclosure duty that MUST
   * accompany it (advisory only; no protection against the Hub, which serves the
   * code that draws it) belongs to the surface that renders it.
   */
  readonly onWebVerificationCode?: ((code: string) => void) | undefined;
}

export interface RelayE2eeInitiatorSources {
  readonly host: RelayE2eeHost;
  readonly attempt: RelayE2eeInitiatorAttempt;
}

/** §4.4's client states, plus the terminal one a driver needs to stop at. */
export type RelayE2eeInitiatorMode = "negotiating" | "e2ee" | "legacy" | "closed";

export interface RelayE2eeInitiator extends RelayE2eeChannel {
  readonly mode: () => RelayE2eeInitiatorMode;
  /**
   * A CLIENT-INITIATED channel abort while `negotiating` (§11.2 P12's shape,
   * without the authorization ground): FATAL-PRE, no record of any kind, and the
   * buffer discarded.
   *
   * It exists for the React Native lifecycle. `T_HANDSHAKE_NODE` runs from the
   * node's advertisement emit and covers §8.9's implicit finish unconditionally,
   * so a client suspended between `channel.accept` and its first envelope earns
   * an encrypted Q8 and a dead channel it cannot even read. Aborting is the
   * fail-closed answer and it is the CLIENT's own decision, so it is here rather
   * than in a row.
   */
  readonly abort: () => void;
}

const REJECTED: RelayE2eeInboundDisposition = Object.freeze({ kind: "rejected" } as const);
const CLAIMED: RelayE2eeInboundDisposition = Object.freeze({ kind: "claimed" } as const);

/**
 * §3.2.2 L1, asserted where the client can act on it rather than only where the
 * specification states it.
 *
 * While `negotiating` an E2EE-capable client writes no plaintext at all, so the
 * longest contiguous silent window is `T_ADV` followed by `T_HANDSHAKE`; L1
 * reserves `T_KEEPALIVE_FLUSH_MARGIN` on top so the `Ping` that window held is
 * flushed and its `Pong` returns before the next tick declares the peer dead. A
 * release in which this is false is a specification defect (§3.2.2), and it is
 * checked at module load because the only alternative is discovering it as a
 * dead transport in the middle of row K15.
 */
if (T_ADV + T_HANDSHAKE + T_KEEPALIVE_FLUSH_MARGIN > RPC_KEEPALIVE_INTERVAL) {
  throw new Error("Relay E2EE negotiating window exceeds the pinned keepalive budget.");
}

/**
 * §8.3: the node material of elements 7–9, 15, and 17, built from the statement
 * validated ON THIS CHANNEL — with elements 9 and 17 taken from the RESOLVED
 * VERIFIED PIN wherever one exists.
 *
 * The provenance rule is the whole point of this function. "A key merely carried
 * by a self-signed first-contact statement is not a trust anchor", so element 9
 * comes from the pin's verified fingerprint, or from the continuity chain
 * authenticated to it — which is what an `anchor` of `pin-updated` means, and is
 * why that case takes the statement's CURRENT identity fingerprint rather than
 * the pin's outgoing one. Element 17 follows element 9 exactly, and the pin's
 * recorded continuity id is unchanged by a rotation by construction (§7.5,
 * §13.3), so a resolved pin supplies it in both anchored cases. Only genuine
 * first contact — where no verified pin resolves — takes either from the
 * statement, and agreement there is agreed material and never evidence.
 *
 * WHERE THE TWO SOURCES CAN DIFFER AT ALL is `pin-updated` alone. §5.2 step 2
 * recomputes the statement's fingerprint from its own key and the §7.5 walk
 * reports `pin-unchanged` only when the pin equals that value; step 6 refuses a
 * statement whose continuity id differs from the pin's. On every other verified
 * path the two are byte-equal by construction, so a rotation is the one
 * configuration in which reading the wrong one is observable — and it is the
 * configuration the suite drives.
 */
function advertisedMaterial(
  statement: NodeE2eeCapabilityStatement,
  anchor: NodeE2eeCapabilityAnchor,
  pin: NodeE2eeVerifiedPin | undefined,
): E2eeAdvertisedChannelMaterial {
  return {
    nodeId: statement.nodeId,
    nodeIdentityFingerprint:
      pin !== undefined && anchor === "pin-unchanged"
        ? pin.identityFingerprint
        : statement.identityFingerprint,
    prekeyId: statement.prekeyCertificate.prekeyId,
    agreementPublicKey: statement.prekeyCertificate.agreementPublicKey,
    continuityChainTranscripts: statement.continuityChain.map((entry) => entry.transcript),
    continuityId: pin !== undefined ? pin.continuityId : statement.continuityId,
  };
}

/**
 * One channel's client mode machine, created at `channel.accept` and destroyed
 * when the channel closes.
 *
 * `T_ADV` is armed here — §4.4 measures it "from `channel.accept`" and this
 * function IS that instant — so a node that never advertises is decided by row
 * K13, K14, or K24 rather than by an idle channel the application is waiting on.
 */
export function makeRelayE2eeInitiator(sources: RelayE2eeInitiatorSources): RelayE2eeInitiator {
  const host = sources.host;
  const attempt = sources.attempt;
  const now = (): number => host.now();
  const diagnostic = attempt.onDiagnostic ?? ((): void => undefined);

  let mode: RelayE2eeInitiatorMode = "negotiating";
  let helloSent = false;
  /** §4.4 K4: one carrier per channel, whatever its content turned out to be. */
  let carrierConsumed = false;
  let handshake: E2eeClientHandshake | undefined;
  let established: RelayE2eeChannel | undefined;
  let advTimer: unknown;
  let handshakeTimer: unknown;
  /**
   * §13.5's node half, retained from the statement §5.2 VALIDATED on this
   * channel — the only source a web client has, since §13.1 gives it no durable
   * pin to anchor one against. Captured on the web tier alone, so the derivation
   * below is unreachable rather than merely unused when the tier is `native`.
   */
  let webSasNodeIdentityPublicKey: Uint8Array | undefined;

  function clearTimers(): void {
    if (advTimer !== undefined) host.clearTimeout(advTimer);
    if (handshakeTimer !== undefined) host.clearTimeout(handshakeTimer);
    advTimer = undefined;
    handshakeTimer = undefined;
  }

  /**
   * §11.2 FATAL-PRE, in the order the procedure states it: stop processing the
   * triggering input, erase partial handshake state, close with
   * `channel_rejected`, and deliver nothing to the application.
   *
   * THE STEP THIS PATH DOES NOT HAVE is the node's: §11.2 gives the reject
   * record to the node alone, and "a client executing FATAL-PRE sends nothing
   * and closes". The buffered sends are discarded unflushed by the engine's
   * single discard path, which `host.close` reaches through the channel's
   * teardown — no buffered byte is ever flushed as plaintext on a channel that
   * closed rather than locking `legacy`.
   */
  function fatalPre(row: string): RelayE2eeInboundDisposition {
    if (mode === "closed") return REJECTED;
    mode = "closed";
    clearTimers();
    handshake?.destroy();
    handshake = undefined;
    diagnostic({ phase: "pre_key", row });
    host.close(relayE2eeFailure("fatal_pre_key"));
    return REJECTED;
  }

  /**
   * Rows K9 and K13: the only two rows in this table that release plaintext.
   *
   * §13.2 step 2 is a property OF THE ATTEMPT and not of the accept path it is
   * read on: "the client marks the attempt pairing-only: buffered application
   * sends are never flushed, and no application payload is released regardless
   * of outcome", and §4.4's send-buffer rule closes with the same sentence —
   * "a pairing-only attempt never flushes". The lock IS the release valve, so
   * the flag has to guard it: genuine first contact classifies legacy-eligible
   * (§12.1.1 branch (a)), which is exactly the selection a pairing ceremony runs
   * under, and a Hub that then withholds the carrier past `T_ADV` would
   * otherwise take row K13 straight through the valve — flushing the ceremony's
   * buffered application sends as plaintext and opening a session on a channel
   * that is supposed to carry no application payload in either direction. §11.2
   * enumerates no row for it, because the condition is the client's own.
   *
   * A refusal is returned rather than swallowed so row K9's caller cannot
   * deliver the payload it was about to hand the RPC parser.
   */
  function lockLegacy(): RelayE2eeInboundDisposition | undefined {
    if (mode !== "negotiating") return undefined;
    if (attempt.pairingOnly) return fatalPre("local");
    mode = "legacy";
    clearTimers();
    host.lockMode("legacy");
    return undefined;
  }

  /**
   * §13.1's release gate, which is the SECOND valve and not the same one.
   *
   * `pairingOnly` closes both valves — a ceremony channel releases nothing at
   * all, plaintext included — and §13.2 step 2 sets it. This one closes the
   * E2EE valve alone: "A native client MUST NOT release application payload
   * under the active-Hub guarantee until the pin is `verified` (§2.2). With an
   * `unverified` pin the client is restricted to the pairing ceremony."
   *
   * IT CANNOT BE FOLDED INTO `pairingOnly`. Genuine first contact classifies
   * legacy-eligible (§12.1.1 branch (a)) and rows K9/K13 are exactly how a
   * native client reaches a node that runs no §4 channel at all; marking every
   * pin-less attempt pairing-only would make `lockLegacy` fatal and take that
   * away. So the two are separate, and only the E2EE lock consults this.
   *
   * The rule is native-only by its own words — web holds no durable pin of any
   * kind (§6.3, §13.1) and its §2.2 row is the passive-Hub one, which a pin
   * neither strengthens nor gates — so the tier the credentials already carry
   * selects it, rather than a flag a caller could forget to set.
   */
  function releaseGatedWithoutVerifiedPin(): boolean {
    return attempt.credentials.tier === "native" && attempt.verifiedPin === undefined;
  }

  /**
   * Row K5's second half: §8.8 step 6 has produced `sessionBindingHash`, so the
   * record layer can exist and the buffered sends may flush AS ENVELOPES.
   *
   * The channel takes ownership of the §6.5 secrets and erases them on any
   * construction failure, so the §4.5 non-positive ceiling (§11.2 P14) lands
   * here as a throw with nothing stranded — and the channel fails during
   * establishment rather than being released with a silently shrunk ceiling.
   */
  function lockE2ee(input: {
    readonly secrets: E2eeSessionSecrets;
    readonly suite: E2eeSuiteId;
    readonly sessionBindingHash: Uint8Array;
    readonly webEphemeralPublicKey: Uint8Array | undefined;
  }): RelayE2eeInboundDisposition {
    if (!e2eeChannelSizeBudget(host.limits).establishable) {
      // §4.5 / §11.2 P14. The channel would erase these itself, but it is never
      // constructed on this branch, and the §6.5 secrets are owned from the
      // moment `receiveServerAccept` handed them over.
      eraseE2eeSessionSecrets(input.secrets);
      return fatalPre("P14");
    }
    try {
      established = makeRelayE2eeClientChannel({
        host,
        secrets: input.secrets,
        suite: input.suite,
        sessionBindingHash: input.sessionBindingHash,
      });
    } catch {
      return fatalPre("P14");
    }
    mode = "e2ee";
    clearTimers();
    host.lockMode("e2ee");
    publishWebVerificationCode(input.sessionBindingHash, input.webEphemeralPublicKey);
    return CLAIMED;
  }

  /**
   * §13.5, AFTER the lock and never before it — the mirror of the node's own
   * rule that a value the owner can read must describe a session that exists.
   *
   * WHAT SELECTS THIS IS THE TIER THE CREDENTIALS ALREADY CARRY, exactly as
   * `releaseGatedWithoutVerifiedPin` above is selected, and for the same reason:
   * §13.5 is defined over the WEB client's Noise ephemeral, so a flag a caller
   * could forget to set would be a second source of truth for which tier the
   * channel is. On `native` there is no ephemeral on the established result to
   * derive from and the §13.4 safety number is the owner-facing value instead.
   *
   * A derivation failure costs the code and nothing else: this is a display
   * duty, and §11.2 admits no channel outcome that varies with one.
   */
  function publishWebVerificationCode(
    sessionBindingHash: Uint8Array,
    webEphemeralPublicKey: Uint8Array | undefined,
  ): void {
    if (attempt.credentials.tier !== "web") return;
    const publish = attempt.onWebVerificationCode;
    if (publish === undefined) return;
    const nodeIdentityPublicKey = webSasNodeIdentityPublicKey;
    if (webEphemeralPublicKey === undefined || nodeIdentityPublicKey === undefined) return;
    let code: string;
    try {
      code = deriveE2eeWebSas({
        nodeIdentityPublicKey,
        webEphemeralPublicKey,
        sessionBindingHash,
      }).display;
    } catch {
      return;
    }
    publish(code);
  }

  // ─── §4.4 timers ───────────────────────────────────────────────────────────

  /**
   * `T_ADV`, from `channel.accept` (rows K13, K14, K24).
   *
   * Cancelled when a hello is sent or a mode is locked, and a cancelled or
   * superseded timer is ignored: the guard below re-reads the state rather than
   * trusting that the cancellation won the race with the platform's callback.
   */
  advTimer = host.setTimeout(() => {
    advTimer = undefined;
    if (mode !== "negotiating" || helloSent) return;
    // Row K14 first: a latched selection, or local policy forbidding legacy,
    // closes rather than releasing anything (§11.2 P19). "Absence of evidence"
    // can never by itself select the legacy branch.
    if (attempt.selectionClass === "latched" || !attempt.legacyPermitted) {
      fatalPre("P19");
      return;
    }
    if (attempt.selectionClass === "unexpected") {
      // Row K24 / §11.2 P22: FATAL-PRE, the §13.2.1 surface raised LOCALLY, and
      // the buffered sends discarded unflushed. The wire surface is the ordinary
      // generic one.
      attempt.onUnexpectedNode?.("none");
      fatalPre("P22");
      return;
    }
    // Row K13.
    lockLegacy();
  }, T_ADV);

  /** `T_HANDSHAKE`, armed at hello emit (row K15). */
  function armHandshakeDeadline(): void {
    handshakeTimer = host.setTimeout(() => {
      handshakeTimer = undefined;
      if (mode !== "negotiating" || !helloSent) return;
      // Row K15 / §11.2 P20: never a legacy fallback after a hello.
      fatalPre("P20");
    }, T_HANDSHAKE);
  }

  // ─── §4.4 rows K1–K4: the capability carrier ───────────────────────────────

  /**
   * Rows K1–K4.
   *
   * `statement` is `undefined` for a payload that claimed the reserved §5.3 tag
   * and was not a conforming carrier: that is still the `CARRIER` class — §5.3
   * reserves the tag, so nothing else may legitimately carry it — and it fails
   * validation, which is rows K2/K3 and never K9's legacy lock.
   */
  function receiveCarrier(statement: Uint8Array | undefined): RelayE2eeInboundDisposition {
    // Row K4 / §11.2 P4: one carrier per channel. §4.4 admits exactly one
    // handshake attempt per channel and the carrier is the input that starts it.
    if (carrierConsumed) return fatalPre("P4");
    carrierConsumed = true;

    const verification =
      statement === undefined
        ? undefined
        : verifyNodeE2eeCapabilityStatement({
            statement,
            connectedHubOrigin: attempt.hubOrigin,
            tier: attempt.credentials.tier,
            localSuitePreference: attempt.localSuitePreference,
            now: now(),
            ...(attempt.accountId === undefined ? {} : { accountId: attempt.accountId }),
            ...(attempt.verifiedPin === undefined ? {} : { pin: attempt.verifiedPin }),
            ...(attempt.acceptedPolicyGeneration === undefined
              ? {}
              : { acceptedPolicyGeneration: attempt.acceptedPolicyGeneration }),
          });
    if (verification !== undefined) attempt.onStatement?.(verification);

    if (verification === undefined || verification.kind !== "verified") {
      // Rows K2 and K3. The statement failed validation, or validated and is
      // unusable — a protocol range excluding `E2EE_PROTOCOL_VERSION`, an empty
      // suite intersection, or an admitted pattern set omitting this tier's
      // pattern. §12.1 makes the three unusable cases "validated" for the web
      // latch; on this tier the disposition is the same either way.
      if (attempt.selectionClass === "latched") return fatalPre("P15"); // K2
      // Row K3: treat as absent evidence. No hello may be built on unvalidated
      // or unusable evidence, and the `T_ADV` rows still decide the channel.
      diagnostic({ phase: "pre_key", row: "K3" });
      return CLAIMED;
    }

    // Row K1. §4.4's no-legacy-after-evidence rule takes over from here: this
    // client either sends the hello or closes FATAL-PRE, and it may not idle
    // past `T_ADV`, so `T_ADV` is cancelled by the emit below and never by a
    // fallback that does not exist.
    return sendHello(verification.statement, verification.anchor, verification.selectedSuite);
  }

  function sendHello(
    statement: NodeE2eeCapabilityStatement,
    anchor: NodeE2eeCapabilityAnchor,
    selectedSuite: E2eeSuiteId,
  ): RelayE2eeInboundDisposition {
    const client = new E2eeClientHandshake({
      channel: {
        hubOrigin: attempt.hubOrigin,
        channelId: host.channel.channelId,
        relayProtocolMajor: host.channel.relayProtocolMajor,
        relayProtocolMinor: host.channel.relayProtocolMinor,
        channelOpenCapability: host.channel.capability,
        channelOpenEffectiveRole: host.channel.effectiveRole,
      },
      advertised: advertisedMaterial(statement, anchor, attempt.verifiedPin),
      selectedSuite,
      offeredSuites: attempt.localSuitePreference,
      credentials: attempt.credentials,
      // §8.3 elements 11–12, committed to the authority the `channel.open`
      // ACTUALLY PRESENTED. §8.3 requires exact equality with elements 13–14 at
      // both endpoints and treats a difference in EITHER direction — a silent
      // role reduction included — as a context mismatch, so there is one source
      // for both halves and no room for this client to commit to something the
      // Hub did not grant, or to accept less than it did.
      intendedCapability: host.channel.capability,
      intendedRole: host.channel.effectiveRole,
    });
    let hello;
    try {
      hello = client.createHello(now());
    } catch {
      // The handshake's own funnel has already erased what it built; §11.2's
      // table enumerates peer-input conditions and this is client-local.
      return fatalPre("local");
    }
    if (hello.kind === "fatal") {
      handshake = undefined;
      client.destroy();
      return fatalPre(hello.row);
    }
    // The §9.3 admission path, which is also the only send path this module has:
    // `send` on the engine buffers while `negotiating` by construction, so the
    // hello could not reach the wire through it even by mistake.
    const admission = host.admit(hello.record.byteLength);
    if (admission === undefined || !admission.send(hello.record)) {
      admission?.release();
      client.destroy();
      return fatalPre("local");
    }
    // §13.5's node half, taken from the statement this channel validated and
    // held only until the lock reads it. The web tier resolves to no pin, so
    // there is nothing else it could be anchored to; `advertisedMaterial` above
    // reads the pin for elements 9 and 17 for the same reason and finds none.
    if (attempt.credentials.tier === "web") {
      webSasNodeIdentityPublicKey = statement.identityPublicKey;
    }
    handshake = client;
    helloSent = true;
    if (advTimer !== undefined) host.clearTimeout(advTimer);
    advTimer = undefined;
    armHandshakeDeadline();
    return CLAIMED;
  }

  // ─── §4.4 rows K5–K8: negotiation records ──────────────────────────────────

  function receiveNegotiation(payload: Uint8Array): RelayE2eeInboundDisposition {
    // §4.3 step 4 and §3.3: the per-type bound before any body parse, and the
    // §3.4 direction registry. An unknown, misdirected, or over-bound record is
    // row K8 / §11.2 P3.
    const decoded = decodeE2eeNegotiationRecord(payload);
    if (decoded.kind === "error") return fatalPre("P3");
    if (decoded.value.recordType === E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT) {
      // Row K6's first clause / §11.2 P16: an accept with no hello sent.
      if (!helloSent || handshake === undefined) return fatalPre("P16");
      return receiveServerAccept(payload);
    }
    if (decoded.value.recordType === E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT) {
      // Row K7 / §11.2 P17: the handshake failed and a retry requires a fresh
      // ticket, channel, and handshake. A reject with no hello matches no guard
      // of K7 and falls to K8, which is P3.
      return fatalPre(helloSent ? "P17" : "P3");
    }
    // `E2EEClientHello` is a client-to-node record (§3.4): misdirected here.
    return fatalPre("P3");
  }

  /**
   * Rows K5 and K6, wired onto §8.8 steps 1–6.
   *
   * The client retains its OWN emitted hello wire bytes and RECONSTRUCTS
   * `ServerAcceptTBS` — both inside `E2eeClientHandshake`, which is why nothing
   * here slices the received record: §8.7 hashes exact wire bytes precisely so a
   * field mutated in transit after the client hashed its own hello breaks the
   * confirmation, and a transcript rebuilt from the bytes that arrived would
   * hash the attacker's version at both ends.
   */
  function receiveServerAccept(payload: Uint8Array): RelayE2eeInboundDisposition {
    const client = handshake!;
    const result = client.receiveServerAccept(payload, now());
    if (result.kind === "fatal") return fatalPre(result.row); // Row K6.
    if (attempt.pairingOnly || releaseGatedWithoutVerifiedPin()) {
      // §13.2: "the pairing attempt always ends without application
      // authorization", and the client "marks the attempt pairing-only:
      // buffered application sends are never flushed, and no application payload
      // is released regardless of outcome". A conforming node never emits an
      // accept to an unapproved client, so this is a node that answered
      // something no ceremony asked for; the verification above still ran, so a
      // forged accept is the ordinary K6 and this row is only ever reached by a
      // cryptographically sound one. §11.2 P21 is its row: a usable validated
      // statement is present and this client cannot proceed to an application
      // session.
      //
      // THE PIN CLAUSE IS THE SAME ROW FOR A DIFFERENT REASON, and it is the one
      // a node that DOES hold an approval reaches: the owner approved this
      // device at the node CLI (§13.2 step 5's node half) and has not yet marked
      // the pin `verified` on the device, or the device lost its trust document
      // while the node kept the approval (§13.1.1 partial loss). The node then
      // answers a sound `E2EEServerAccept`, and §13.1's release gate forbids
      // this client from carrying application payload over it. §13.2 step 6 says
      // the same thing from the other side: "Application traffic starts only on
      // a fresh ticket, channel, and handshake after both decisions are durable."
      eraseE2eeSessionSecrets(result.secrets);
      return fatalPre("P21");
    }
    return lockE2ee({
      secrets: result.secrets,
      suite: result.suite,
      sessionBindingHash: result.sessionBindingHash,
      // Present on the web arm alone (§13.5); absent by construction on IK.
      webEphemeralPublicKey: result.webEphemeralPublicKey,
    });
  }

  // ─── §4.4: the state dispatch ──────────────────────────────────────────────

  function negotiating(payload: Uint8Array): RelayE2eeInboundDisposition {
    const klass = classifyPostStripPayload(payload);
    switch (klass.kind) {
      case "legacy-json": {
        const carrier = decodeE2eeCapabilityCarrier(payload);
        if (carrier.kind === "ok") return receiveCarrier(carrier.value);
        if (carrier.reason === "malformed") return receiveCarrier(undefined);
        // `LEGACY-JSON (non-carrier)`. The keepalive `Ping` is classified here
        // exactly as any other plaintext RPC message (§4.4).
        //
        // Row K10 / §11.2 P18 first: a latched selection, local policy that
        // forbids legacy, or a hello already sent. §4.4 is explicit that a
        // client that let one plaintext frame escape would be answering N1 or,
        // far worse, N2 — a silent legacy lock of a channel that was about to go
        // E2EE — so this row's guards are the ones that keep that from being a
        // downgrade the Hub can simply ask for.
        if (helloSent || attempt.selectionClass === "latched" || !attempt.legacyPermitted) {
          return fatalPre("P18");
        }
        if (attempt.selectionClass === "unexpected") {
          // Row K23 / §11.2 P22. The buffered sends are discarded unflushed:
          // this row closes, and NOTHING it held is released as plaintext.
          attempt.onUnexpectedNode?.("none");
          return fatalPre("P22");
        }
        // Row K9: lock legacy, deliver, and flush the buffered sends as
        // plaintext — which the engine does inside `lockMode`, before this
        // payload reaches the parser, so the application's own earlier
        // submissions precede the node's first delivery.
        const refused = lockLegacy();
        return refused ?? { kind: "rpc", message: payload };
      }
      case "negotiation":
        return receiveNegotiation(payload);
      case "envelope":
        // Row K11 / §11.2 P5: an envelope before establishment.
        return fatalPre("P5");
      case "other":
        // Row K12 / §11.2 P6 — the zero-length post-strip payload included,
        // which is never a benign no-op and never silently dropped.
        return fatalPre("P6");
    }
  }

  function legacy(payload: Uint8Array): RelayE2eeInboundDisposition {
    const klass = classifyPostStripPayload(payload);
    switch (klass.kind) {
      case "legacy-json": {
        const carrier = decodeE2eeCapabilityCarrier(payload);
        if (carrier.kind === "ok" || carrier.reason === "malformed") {
          // Row K20: a carrier after a legacy lock is a no-op. MUST NOT upgrade
          // — §4.4's mode transitions are one-way and §5.1 forbids reopening a
          // channel to switch modes.
          diagnostic({ phase: "pre_key", row: "K20" });
          return CLAIMED;
        }
        // Row K19.
        return { kind: "rpc", message: payload };
      }
      case "envelope":
        // Row K21's envelope half / §11.2 P5.
        return fatalPre("P5");
      case "negotiation":
        // Row K21's negotiation half / §11.2 P24. No session keys exist in
        // `legacy`, so the disposition is FATAL-PRE and never FATAL-POST.
        return fatalPre("P24");
      case "other":
        // Row K22 / §11.2 P6.
        return fatalPre("P6");
    }
  }

  async function intercept(payload: Uint8Array): Promise<RelayE2eeInboundDisposition> {
    switch (mode) {
      case "negotiating":
        return negotiating(payload);
      case "legacy":
        return legacy(payload);
      case "e2ee":
        // Rows K16–K18 are the established channel's, unchanged.
        return established === undefined ? REJECTED : established.intercept(payload);
      case "closed":
        return REJECTED;
    }
  }

  return {
    intercept,
    emit: async (message) => (established === undefined ? false : established.emit(message)),
    beginClose: async (): Promise<RelayE2eeCloseAttempt> => {
      if (established !== undefined) return established.beginClose();
      // §10 has no meaning outside `e2ee`: there are no session keys to
      // authenticate a close with, so the outer close is the whole of it.
      mode = "closed";
      clearTimers();
      handshake?.destroy();
      handshake = undefined;
      host.close();
      return "opened";
    },
    dispose: (options = {}) => {
      mode = "closed";
      clearTimers();
      handshake?.destroy();
      handshake = undefined;
      established?.dispose(options);
    },
    mode: () => mode,
    abort: () => {
      if (mode !== "negotiating") return;
      fatalPre("local");
    },
  };
}
