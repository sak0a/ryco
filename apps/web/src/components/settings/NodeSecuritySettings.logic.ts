// Every decision, every owner-facing sentence, and every gate the node security
// panel makes — docs/relay-e2ee-protocol.md §6.4, §7.5, §12.3–§12.6, §13.4–§13.6.
//
// A `.logic.ts` sibling for the reason `HostedRelayTrustNotice.logic.ts` and
// `HostedConnectionControls.logic.ts` are: a decision whose failure mode is
// security-relevant rather than cosmetic belongs somewhere a node test can reach
// it without a DOM, and copy that could mislead an owner about what is protected
// belongs under a prohibited-phrase scan. Anything written inside the `.tsx` is
// effectively untestable in this repository, so the `.tsx` owns layout and
// nothing else.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE PANEL DESCRIBES THE NODE. IT PROVES NOTHING ABOUT THE READER'S SESSION.
// ─────────────────────────────────────────────────────────────────────────────
// Reading a node's operator state says what that node will admit. It says
// nothing about the confidentiality of the channel the reader is using to read
// it — and in hosted mode §2.4 is explicit that it cannot: the Hub serves this
// very JavaScript, so a malicious one "may serve code that completes the genuine
// node handshake, displays the genuine session `WebSAS`, and separately
// exfiltrates plaintext or traffic keys". No sentence below may let a reader
// conclude otherwise, and where the panel shows a session's own code the shipped
// advisory travels with it — from `hostedE2eeVerificationView`, whose whole
// design is that the characters and the denial are one value.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE TWO MODES ARE NOT TWO SKINS
// ─────────────────────────────────────────────────────────────────────────────
// `apps/desktop` has no `.tsx` of its own: it loads the local node's HTTP URL and
// the node serves `apps/web/dist`, so one implementation is both the desktop UI
// and the Hub-hosted PWA. What differs is the CONNECTION MODE, and it differs in
// a way that decides this panel's whole shape — see {@link NodeSecurityMode}.

import { E2EE_SAFETY_NUMBER_DIGITS } from "@ryco/shared/relayE2eeConstants";

import type {
  NodeE2eeClientListing,
  NodeE2eeClientRecord,
  NodeE2eeContinuity,
  NodeE2eeFallback,
  NodeE2eePolicy,
  NodeE2eePolicyChange,
  NodeE2eePolicyProposal,
  NodeE2eePrekey,
  NodeE2eeSession,
} from "@ryco/client-runtime/connection";
import type { HostedConnectionStatusIndicator } from "../../hostedHub/connectionStatus";

/**
 * Which of the two connection modes this build is running in.
 *
 * `local` — the browser (or the Electron window, which is the same bundle)
 * reaches a node on this machine directly. There is no relay in the path, so
 * there is no §4 channel and nothing for §4 to encrypt.
 *
 * `hosted` — the Hub serves this bundle and the relay carries `ryco.rpc`. The §4
 * NX channel exists and is already shipped; the node's OPERATOR routes are not
 * on the relay at all.
 *
 * IT IS DERIVED FROM THE BUILD MODE AND NOT FROM A LIVE SESSION, and that choice
 * is load-bearing rather than incidental — see
 * {@link nodeE2eeStrictPolicyDisposition}.
 */
export type NodeSecurityMode = "local" | "hosted";

export function nodeSecurityMode(hostedHubMode: boolean): NodeSecurityMode {
  return hostedHubMode ? "hosted" : "local";
}

// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS CONNECTION IS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The panel's statement about the connection the reader is holding.
 *
 * `warn` is deliberately absent from the local shape. In local mode there is no
 * relay, so there is nothing to encrypt and no downgrade to report; a red badge
 * there would be a warning about a risk that does not exist, and an owner taught
 * to dismiss one indicator learns to dismiss the one that matters. The local
 * copy therefore states what the connection IS and says nothing at all about
 * relay encryption in either direction.
 */
export interface NodeConnectionStatement {
  readonly headline: string;
  readonly body: string;
}

/**
 * §2.2's claim vocabulary is NOT re-derived here.
 *
 * `packages/client-runtime/src/authorization/connectionStatus.ts` exists because
 * deriving indicators independently once shipped a contradictory pill, so the
 * hosted statement takes the already-derived indicator and quotes its own words.
 * This module adds no status noun of its own.
 */
export function nodeConnectionStatement(
  mode: NodeSecurityMode,
  indicator: HostedConnectionStatusIndicator | null,
): NodeConnectionStatement {
  if (mode === "local") {
    return {
      headline: "Direct to a node on this machine",
      body: "This window talks to a Ryco node running here, on this machine. No Ryco Hub sits between them and nothing you send leaves this machine on its way to the node.",
    };
  }
  return {
    headline: indicator === null ? "Through the Ryco Hub" : indicator.shortLabel,
    body: "This browser reaches your node through the Ryco Hub relay. What that channel is worth is stated with the channel itself, below.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WHERE THE OPERATOR DATA COMES FROM, AND WHERE IT DOES NOT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether the node's operator routes can be reached from this build at all.
 *
 * NOT A PREFERENCE — A BOUNDARY THAT ALREADY EXISTS.
 * `apps/web/src/environments/primary/target.ts` throws
 * "Node HTTP routes are unavailable in hosted Hub mode." from
 * `resolvePrimaryEnvironmentHttpUrl`, and `hostedHttpBoundary.test.ts` pins it.
 * The relay carries `ryco.rpc` channels and there is no HTTP tunnel, so the
 * sixteen `/api/hub/e2ee/…` routes are unreachable from a hosted browser however
 * a surface asks for them.
 *
 * The panel therefore does not render an empty client table with a spinner in
 * hosted mode. It says where the data lives and how to reach it.
 */
export interface NodeOperatorDataAvailability {
  readonly available: boolean;
  readonly unavailableBody: string;
}

export function nodeOperatorDataAvailability(mode: NodeSecurityMode): NodeOperatorDataAvailability {
  if (mode === "local") return { available: true, unavailableBody: "" };
  return {
    available: false,
    unavailableBody:
      "Your node's client list, live sessions, admission policy, prekey and fallback counters are held on the node and read over its own local interface, which the relay does not carry. Open Ryco on that machine to see them, or run `ryco e2ee` there.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE HARD BLOCK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What this build may do with `requireApprovedClientE2EE` (§12.4).
 *
 * §12.4's policy admits only approved native client keys, which closes web and
 * legacy access by design. Applying it FROM a browser therefore ends the session
 * doing the applying, and the operator is locked out of the surface they were
 * holding — with no way back in through it, because §12.4 is exactly the policy
 * that refuses the web tier.
 *
 * A typed confirmation is not sufficient and is not offered. A confirmation
 * changes how deliberate the action is; it does not change the end state, and
 * the end state is the lockout. In hosted mode the control is inert and says
 * why; in local mode it is available, because a local operator who narrows their
 * node too far still has the machine in front of them.
 */
export type NodeE2eeStrictPolicyDisposition =
  | { readonly kind: "available" }
  | { readonly kind: "blocked"; readonly reason: string };

/**
 * KEYED ON THE BUILD MODE, NEVER ON A LIVE RELAY SESSION.
 *
 * "Is a hosted channel up right now?" is the wrong question and answering it
 * would invert the guard exactly when it matters: a hosted tab whose transport
 * has dropped holds no session, so a session-keyed gate would UNBLOCK the
 * lockout control precisely while the operator's connection was already broken.
 * The build mode cannot flicker — `VITE_RYCO_CLIENT_MODE` is fixed when the
 * bundle is built, and it is the same fact that decides whether the Hub served
 * this page — so it is what the block reads.
 */
export function nodeE2eeStrictPolicyDisposition(
  mode: NodeSecurityMode,
): NodeE2eeStrictPolicyDisposition {
  if (mode === "local") return { kind: "available" };
  return {
    kind: "blocked",
    reason:
      "This one can only be changed from the node itself. It admits approved native client keys and closes browser and legacy access — including this browser, which is how you are reading this — so turning it on from here would end this session and leave no way back in through it. Run `ryco e2ee policy set --require-approved-client-e2ee` on the machine running the node, where you can still reach it if the result is not what you wanted.",
  };
}

/**
 * The gate every policy proposal passes before it is allowed near the network.
 *
 * THE FIELD IS REFUSED IN HOSTED MODE WHETHER IT IS BEING SET OR CLEARED.
 * Distinguishing the two would make the guard depend on reading a boolean
 * correctly, and the clearing direction is not a case that has to work here: a
 * hosted browser can only be talking to a node that does NOT have the policy on,
 * because a node that did would not admit it. Refusing the field outright costs
 * nothing real and cannot be got wrong.
 *
 * This is the INNER half of the block. The outer half is the hosted HTTP
 * boundary, which throws before a request is built — so reaching the network
 * with this proposal takes defeating both, in two packages, in one change.
 */
export type NodeE2eePolicyGate =
  | { readonly allowed: true; readonly proposal: NodeE2eePolicyProposal }
  | { readonly allowed: false; readonly refusal: string };

export function nodeE2eePolicyGate(
  mode: NodeSecurityMode,
  proposal: NodeE2eePolicyProposal,
): NodeE2eePolicyGate {
  if (mode === "hosted" && proposal.requireApprovedClientE2EE !== undefined) {
    const disposition = nodeE2eeStrictPolicyDisposition(mode);
    return {
      allowed: false,
      refusal: disposition.kind === "blocked" ? disposition.reason : "",
    };
  }
  return { allowed: true, proposal };
}

// ─────────────────────────────────────────────────────────────────────────────
// §13.4 — THE SAFETY NUMBER AND ITS CEILING ARE ONE VALUE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * §13.4's rendered value, its format caption, and what a comparison is worth —
 * as ONE object with three required fields.
 *
 * THE MECHANISM IS `hostedE2eeVerificationView`'S, AND IT IS COPIED ON PURPOSE
 * RATHER THAN CALLED. That function validates §13.5's `WebSAS` — eight Crockford
 * characters in two groups — and returns `null` for anything else, so a §13.4
 * safety number (sixty decimal digits in twelve groups) does not survive it.
 * Every §13.5 value this panel draws goes through the shipped function untouched
 * (the live-sessions panel and the connection panel both import it); this exists
 * only for the value that function cannot represent, and it is built the same
 * way for the same reason: there is no exported accessor that hands back the
 * digits alone, so drawing the number without its advisory takes deleting a
 * field from a returned object rather than forgetting a second call.
 *
 * Every number in the caption is read from `E2EE_SAFETY_NUMBER_DIGITS`, so a
 * §13.4 format change rewrites the sentence and breaks the split in one edit.
 */
export interface NodeSafetyNumberView {
  readonly groups: ReadonlyArray<string>;
  /** The groups re-joined with the format's own separator. */
  readonly display: string;
  readonly caption: string;
  readonly advisory: string;
}

/**
 * §13.4's format, restated as a validator: `groups` runs of `digitsPerGroup`
 * decimal digits joined by a single `separator`.
 *
 * A surface that silently re-grouped, truncated, or padded would show the owner
 * a different string from the one their device shows, in the one ceremony that
 * consists of comparing the two — and §13.4 is explicit that "the fixed length
 * and grouping are the checksum — there is no separate check digit".
 */
export function nodeSafetyNumberGroups(display: string): ReadonlyArray<string> {
  const groups = display.split(E2EE_SAFETY_NUMBER_DIGITS.separator);
  if (groups.length !== E2EE_SAFETY_NUMBER_DIGITS.groups) return [];
  for (const group of groups) {
    if (group.length !== E2EE_SAFETY_NUMBER_DIGITS.digitsPerGroup) return [];
    for (const character of group) {
      if (character < "0" || character > "9") return [];
    }
  }
  return groups;
}

export const NODE_SAFETY_NUMBER_CAPTION =
  `${E2EE_SAFETY_NUMBER_DIGITS.digits} digits, in ${E2EE_SAFETY_NUMBER_DIGITS.groups} groups of ` +
  `${E2EE_SAFETY_NUMBER_DIGITS.digitsPerGroup}. The length and the grouping are the only check ` +
  `there is, so read all ${E2EE_SAFETY_NUMBER_DIGITS.digits} in order.`;

/**
 * What a §13.4 comparison catches, and what it is for.
 *
 * §13.4's own duties: the value is long-term, it covers both identity keys and
 * the Hub/account namespace, and the same key pair paired under a different
 * account yields a different number. §13.2 step 5 is where an owner uses it —
 * they compare it against the device before approving the key.
 *
 * It carries none of the tokens the prohibited-claims scan forbids, including in
 * the negative: the scan is a bare substring match and cannot tell a claim from
 * its denial, so the words simply do not appear.
 */
export const NODE_SAFETY_NUMBER_ADVISORY =
  "Compare this with the number the device itself shows, on the device, before approving it. " +
  "They match only for this key pair under this Hub account — the same device under a different " +
  "account reads differently. Approve nothing whose number you have not read off the other " +
  "screen yourself.";

export function nodeSafetyNumberView(value: string): NodeSafetyNumberView | null {
  const groups = nodeSafetyNumberGroups(value);
  if (groups.length === 0) return null;
  return {
    groups,
    display: groups.join(E2EE_SAFETY_NUMBER_DIGITS.separator),
    caption: NODE_SAFETY_NUMBER_CAPTION,
    advisory: NODE_SAFETY_NUMBER_ADVISORY,
  };
}

/**
 * What the surface says when a record carries no readable §13.4 value.
 *
 * The absence gets a sentence for the reason §13.5's does: rendering nothing
 * would leave an owner unable to tell "this build shows none" from "this record
 * has none", while the row still invited them to approve the key.
 */
export const NODE_SAFETY_NUMBER_UNAVAILABLE =
  "No comparison number is readable for this record, so there is nothing here to check against " +
  "the device.";

// ─────────────────────────────────────────────────────────────────────────────
// THIS NODE'S IDENTITY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether the node's own enrollment fingerprint can be shown right now.
 *
 * IT USUALLY CANNOT, AND THAT IS A GAP IN THE NODE'S ROUTES RATHER THAN A CHOICE
 * MADE HERE. §13.2 step 5 has the owner compare "the safety number and node
 * fingerprint against the local node CLI/enrollment surface", and §13.2's final
 * paragraph allows a product to require entry of the node enrollment fingerprint
 * before any pairing exchange — so the value is one an owner needs before pairing
 * a phone. The node serves it from `GET /api/hub/enrollment`, which answers 404
 * once the ceremony is over, and `GET /api/hub/identity` carries "no origin, no
 * node/key/environment identifier, and no fingerprint" by design. No route on
 * this node exposes its long-term identity fingerprint after enrollment
 * completes.
 *
 * So the panel shows it while a ceremony is pending and states its absence
 * otherwise, rather than showing the §6.4 AGREEMENT prekey fingerprint under the
 * identity heading. Those are different keys, and labelling one as the other
 * would send an owner into a pairing comparison with the wrong value.
 */
export interface NodeEnrollmentFingerprintView {
  readonly available: boolean;
  readonly fingerprint: string | null;
  readonly caption: string;
}

export function nodeEnrollmentFingerprintView(
  pendingCeremonyFingerprint: string | null,
): NodeEnrollmentFingerprintView {
  if (pendingCeremonyFingerprint !== null) {
    return {
      available: true,
      fingerprint: pendingCeremonyFingerprint,
      caption:
        "This node's identity fingerprint, from the enrollment now waiting for approval. Compare it character for character wherever you are asked to confirm this machine.",
    };
  }
  return {
    available: false,
    fingerprint: null,
    caption:
      "This node's identity fingerprint is shown here only while an enrollment is waiting for approval. At other times, read it from the node with `ryco hub status` on the machine running it.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §6.4 PREKEY, §7.5 CONTINUITY
// ─────────────────────────────────────────────────────────────────────────────

export interface NodeFactRow {
  readonly label: string;
  readonly value: string;
  /** Rendered in a face that makes character-by-character reading possible. */
  readonly mono?: boolean;
}

const UNKNOWN = "unknown";

/** Epoch millis as a readable local time, or a stated absence. */
export function formatNodeEpoch(value: number | undefined): string {
  if (value === undefined) return "never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? UNKNOWN : date.toLocaleString();
}

/**
 * §6.4's prekey, with its remedy carried rather than restated.
 *
 * `present: false` is a node holding no prekey for this origin at all, which
 * §6.4 distinguishes from an expired one — a surface that drew them the same way
 * would send an operator to rotate a key that was never there.
 */
export function nodePrekeyRows(prekey: NodeE2eePrekey | null): ReadonlyArray<NodeFactRow> {
  if (prekey === null) return [{ label: "Agreement prekey", value: UNKNOWN }];
  if (!prekey.present) return [{ label: "Agreement prekey", value: "none held" }];
  return [
    { label: "Prekey", value: prekey.prekeyId ?? UNKNOWN, mono: true },
    { label: "Fingerprint", value: prekey.fingerprint ?? UNKNOWN, mono: true },
    { label: "Validity", value: prekey.validity ?? UNKNOWN },
    { label: "Created", value: formatNodeEpoch(prekey.createdAt) },
    { label: "Expires", value: formatNodeEpoch(prekey.expiresAt) },
  ];
}

/** §6.4's own repair sentence, from the module that defines the diagnostic. */
export function nodePrekeyRemedy(prekey: NodeE2eePrekey | null): string | null {
  if (prekey === null) return null;
  if (!prekey.present) {
    return "This node holds no agreement prekey for its Hub origin. It re-signs one at startup; rotate to issue one now.";
  }
  return prekey.remedy ?? null;
}

/**
 * §7.5's lineage. An unresolvable one carries §7.5's own remedy, so this surface
 * cannot drift from the condition that raised it.
 */
export function nodeContinuityRows(
  continuity: NodeE2eeContinuity | null,
): ReadonlyArray<NodeFactRow> {
  if (continuity === null) return [{ label: "Continuity", value: UNKNOWN }];
  if (continuity.status === "unavailable") {
    return [
      { label: "Continuity", value: "unresolvable" },
      { label: "Reason", value: continuity.reason ?? UNKNOWN },
    ];
  }
  return [
    { label: "Continuity", value: "advertisable" },
    { label: "Lineage", value: continuity.continuityId ?? UNKNOWN, mono: true },
    { label: "Rotation generation", value: String(continuity.generation ?? 0) },
    { label: "Retained chain length", value: String(continuity.chainLength ?? 0) },
    ...(continuity.repair === undefined
      ? []
      : [{ label: "Startup repair", value: continuity.repair }]),
    ...(continuity.lastBreakReason === undefined
      ? []
      : [
          {
            label: "Last break",
            value: `${continuity.lastBreakReason} at ${formatNodeEpoch(continuity.lastBreakAt)}`,
          },
        ]),
  ];
}

export function nodeContinuityRemedy(continuity: NodeE2eeContinuity | null): string | null {
  return continuity?.remedy ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// §13.6 CLIENT RECORDS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The §13.6 record status, reused verbatim.
 *
 * The node's three words are the vocabulary; this module invents none. In
 * particular there is no "trusted", no "secure", and no word borrowed from
 * §2.2's connection ladder — a record's status is a statement about what the
 * node will admit, not about what any channel is worth.
 */
export function nodeClientStatusTone(
  status: NodeE2eeClientRecord["status"],
): "warning" | "success" | "error" {
  switch (status) {
    case "pending":
      return "warning";
    case "approved":
      return "success";
    case "revoked":
      return "error";
  }
}

export function nodeClientRows(record: NodeE2eeClientRecord): ReadonlyArray<NodeFactRow> {
  return [
    { label: "Fingerprint", value: record.fingerprint, mono: true },
    { label: "Hub origin", value: record.hubOrigin },
    { label: "Account", value: record.accountId },
    { label: "Maximum role", value: record.maxRole === "" ? "none granted" : record.maxRole },
    {
      label: "Capabilities",
      value: record.capabilitySet.length === 0 ? "none" : record.capabilitySet.join(", "),
    },
    { label: "Created", value: formatNodeEpoch(record.createdAt) },
    ...(record.approvedAt === undefined
      ? []
      : [{ label: "Approved", value: formatNodeEpoch(record.approvedAt) }]),
    ...(record.revokedAt === undefined
      ? []
      : [{ label: "Revoked", value: formatNodeEpoch(record.revokedAt) }]),
    { label: "Last seen", value: formatNodeEpoch(record.lastSeenAt) },
    ...(record.pairingReserved ? [{ label: "Pairing reservation", value: "held" }] : []),
  ];
}

/**
 * §13.6's three instrumentation duties, as sentences rather than as counts the
 * owner has to infer a meaning for.
 *
 * The refusal count names the action that clears it, because §13.6 makes it
 * "bounded, owner-clearable" and a counter an owner can read but not reset stops
 * being instrumentation after the first flood.
 */
export function nodeClientListingNotices(
  listing: NodeE2eeClientListing | null,
): ReadonlyArray<string> {
  if (listing === null) return [];
  const notices: string[] = [];
  if (listing.pendingGlobalSaturated || listing.saturatedAccounts.length > 0) {
    notices.push(
      "Pending pairing is saturated, so a new device may not be able to introduce itself. Purge a pending record, or read the fingerprint off the device and open a pairing window naming it.",
    );
  }
  if (listing.refusedPairingAttempts > 0) {
    notices.push(
      `${listing.refusedPairingAttempts} pairing attempt(s) were refused because the pending list was full. Clear the count once you have dealt with them, or later readings will be dominated by history.`,
    );
  }
  return notices;
}

/** §13.6: while a window is open, all three of these facts, or it is closed. */
export function nodePairingWindowRows(
  listing: NodeE2eeClientListing | null,
): ReadonlyArray<NodeFactRow> {
  const window = listing?.pairingWindow;
  if (window === undefined) return [{ label: "Pairing window", value: "closed" }];
  return [
    { label: "Pairing window", value: "open" },
    { label: "Only this fingerprint", value: window.fingerprint, mono: true },
    { label: "Expires", value: formatNodeEpoch(window.expiresAt) },
    { label: "Reservation", value: window.spent ? "spent" : "unspent" },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// §13.5 LIVE SESSIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How one live session is labelled.
 *
 * The tier word is the node's own (`native` / `web`) and the suite is the §3.4
 * registry number. No confidentiality claim is attached to either: a session
 * being open says a handshake completed, and this panel does not restate what
 * §2.2 says that is worth.
 */
export function nodeSessionRows(session: NodeE2eeSession): ReadonlyArray<NodeFactRow> {
  return [
    {
      label: "Tier",
      value: session.tier === "native" ? "native (IK)" : "browser (NX)",
    },
    { label: "Suite", value: String(session.suite) },
    { label: "Established", value: formatNodeEpoch(session.establishedAt) },
  ];
}

/**
 * What a native session offers instead of a §13.5 code.
 *
 * §13.5 has no native meaning — the long-term §13.4 value on the record is the
 * one to compare for a signed client — so the row points at it rather than
 * rendering a blank that reads as a missing value.
 */
export const NODE_SESSION_NATIVE_CODE_ABSENT =
  "Native sessions have no per-session code. Compare this device's long-term number on its record above instead.";

// ─────────────────────────────────────────────────────────────────────────────
// §12.3–§12.6 ADMISSION POLICY
// ─────────────────────────────────────────────────────────────────────────────

export function nodePolicyRows(policy: NodeE2eePolicy | null): ReadonlyArray<NodeFactRow> {
  if (policy === null) return [{ label: "Admission policy", value: UNKNOWN }];
  return [
    // §12.4's implication makes the raw and the effective value differ, and a
    // display showing only one would either understate the guarantee or
    // misreport the configuration. Both, always.
    { label: "requireE2EE", value: String(policy.requireE2EE), mono: true },
    {
      label: "requireApprovedClientE2EE",
      value: String(policy.requireApprovedClientE2EE),
      mono: true,
    },
    { label: "Effective requireE2EE", value: String(policy.effectiveRequireE2EE), mono: true },
    { label: "Admitted patterns", value: policy.admittedPatterns.join(", ") || "none" },
    { label: "Suite registry", value: policy.suiteRegistry.join(", ") || "none" },
    { label: "Policy generation", value: String(policy.generation) },
  ];
}

/**
 * §12.6's pre-change warnings, computed from a preview and never from a guess.
 *
 * THE PREVIEW IS NOT OPTIONAL AND IS NOT A FLAG ON THE CHANGE. §12.6 puts the
 * display duty BEFORE the change runs and the node keeps `policy/preview` a
 * separate route that mutates nothing, so the panel asks it first, shows what
 * comes back, and only then offers to apply. One request that could warn or
 * sweep depending on a boolean is the shape most likely to sweep when an
 * operator meant to look.
 *
 * The counts are approximate by nature — channels open and close while the
 * operator reads them — and §12.6 says so in as many words, so the sentence does
 * too.
 */
export function nodePolicyPreviewWarnings(
  preview: NodeE2eePolicyChange,
  proposal: NodeE2eePolicyProposal,
): ReadonlyArray<string> {
  const warnings: string[] = [];
  if (proposal.requireApprovedClientE2EE === true) {
    // §12.4 requires the warning at enable time and requires it to say three
    // things: that the policy closes web and legacy access entirely, that it can
    // strand remote access if every approved native client key is lost, and that
    // enabling it closes the live channels it no longer admits.
    warnings.push(
      "requireApprovedClientE2EE closes browser and legacy access entirely. Only approved native client keys reach application payload after this, and losing every approved key strands remote access to this node until someone recovers it at the machine — which never relaxes admission policy.",
    );
  }
  if (preview.withdrawal) {
    warnings.push(
      `This narrows what the node admits, so it closes live channels. Roughly matching now: ${preview.counts.legacy} legacy, ${preview.counts.nxE2ee} browser, ${preview.counts.suiteWithdrawn} on a withdrawn suite, and ${preview.counts.abortedHandshakes} handshake(s) in flight. These move while you read them.`,
    );
  }
  if (!preview.changed) {
    warnings.push("This changes nothing: the node already admits exactly this.");
  }
  return warnings;
}

/** What the node reported after a change actually ran (§12.6(c)). */
export function nodePolicyChangeSummary(change: NodeE2eePolicyChange): string {
  return [
    change.changed ? "Policy committed." : "Policy unchanged.",
    `Closed ${change.counts.legacy} legacy channel(s), ${change.counts.nxE2ee} browser channel(s), ${change.counts.suiteWithdrawn} suite-withdrawn channel(s); aborted ${change.counts.abortedHandshakes} handshake(s) in flight.`,
  ].join(" ");
}

/**
 * §5.7's recovery warning, which the node's CLI prints before the jump and this
 * panel shows before the confirmation for the same reason: §5.7 requires the
 * jump to be deliberate, and requires the operator to be told that clients
 * accept only a strictly higher generation than the one they remember.
 */
export const NODE_POLICY_RECOVER_WARNING =
  "This advances the policy generation past every value this node may already have advertised, and the jump is deliberate. Clients accept only a higher generation than the one they remember, so nothing below the new value can be advertised again. If the record was rolled back, recovery commits the fail-closed policy rather than restoring the old values — widen it back afterwards with an explicit change.";

// ─────────────────────────────────────────────────────────────────────────────
// §12.5 FALLBACK DIAGNOSTICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * §12.5's counters, as the thing an owner actually watches during a rollout
 * observation window rather than as a dump of the record.
 *
 * The two classes stay SEPARATE and are never summed: §12.5 requires it, and
 * they mean different things — a peer that spoke legacy is not the same event as
 * this node failing to emit an advertisement, and one total would hide which was
 * happening.
 */
export interface NodeFallbackReport {
  readonly windowStarted: string;
  readonly classes: ReadonlyArray<{
    readonly label: string;
    readonly meaning: string;
    readonly occurrences: number;
    readonly lastOccurrence: string;
    readonly ringOverflows: number;
  }>;
  /**
   * The retained occurrences in time order with their reason labels — §12.5
   * requires the SHAPE to be legible, and a bare count is not a shape.
   *
   * `ordinal` is the position after sorting, and it exists because two entries
   * can share a millisecond and a reason: without it the only key a list could
   * form from this data is a duplicate.
   */
  readonly entries: ReadonlyArray<{
    readonly ordinal: number;
    readonly at: string;
    readonly reason: string;
  }>;
  /** Present only when a ring overflowed, and adjacent to the ring by §12.5. */
  readonly overflowNotice: string | null;
  /** Present only while the condition is live (§12.5 scopes it to the connection). */
  readonly undersizedNotice: string | null;
  readonly quiet: boolean;
}

export function nodeFallbackReport(fallback: NodeE2eeFallback | null): NodeFallbackReport | null {
  if (fallback === null) return null;
  const overflowed =
    fallback.peerLegacy.ringOverflows > 0 || fallback.advertisementUnavailable.ringOverflows > 0;
  return {
    windowStarted: formatNodeEpoch(fallback.windowStartedAt),
    classes: [
      {
        label: "Peer spoke legacy",
        meaning:
          "The other end did not take the encrypted channel, so this one carried readable payload.",
        occurrences: fallback.peerLegacy.occurrences,
        lastOccurrence: formatNodeEpoch(fallback.peerLegacy.lastOccurrenceAt),
        ringOverflows: fallback.peerLegacy.ringOverflows,
      },
      {
        label: "No advertisement",
        meaning:
          "This node could not offer an encrypted channel, or the offer did not survive the path. It cannot tell which.",
        occurrences: fallback.advertisementUnavailable.occurrences,
        lastOccurrence: formatNodeEpoch(fallback.advertisementUnavailable.lastOccurrenceAt),
        ringOverflows: fallback.advertisementUnavailable.ringOverflows,
      },
    ],
    entries: [...fallback.ring]
      .toSorted((left, right) => left.occurredAt - right.occurredAt)
      .map((entry, ordinal) => ({
        ordinal,
        at: formatNodeEpoch(entry.occurredAt),
        reason: entry.reason,
      })),
    overflowNotice: overflowed
      ? "The retained list overflowed, so it is an incomplete account of this window. The shape of what is left is not evidence in either direction."
      : null,
    undersizedNotice:
      fallback.undersizedConnection === undefined
        ? null
        : `This connection asserts a maximum chunk of ${fallback.undersizedConnection.assertedMaxDataChunkBytes} bytes, below the ${fallback.undersizedConnection.advertisementMinChunkBytes} bytes an offer needs. Nothing that fits can carry one, so this node offers nothing on this connection.`,
    quiet:
      fallback.peerLegacy.occurrences === 0 &&
      fallback.advertisementUnavailable.occurrences === 0 &&
      fallback.ring.length === 0,
  };
}

export const NODE_FALLBACK_QUIET =
  "Nothing has fallen back in this window. This counts what happened, not what could — a quiet window is not a statement about the next one.";

// ─────────────────────────────────────────────────────────────────────────────
// OWNER ACTIONS AND THEIR CONFIRMATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every mutation the panel offers, with a confirmation proportionate to its
 * consequence.
 *
 * `destructive` is not a colour decision. It marks the actions whose effect
 * reaches beyond this panel and cannot be taken back by pressing the same button
 * again: §13.6's withdrawals close the target's live channels before the node
 * acknowledges them, and §7.5's re-mint sends every paired client back through a
 * fresh pairing ceremony.
 *
 * The body of each is what the owner is agreeing to, in the consequence's own
 * terms. `confirmLabel` never repeats the neutral verb — an owner scanning two
 * buttons reads the labels, not the paragraph.
 */
export type NodeE2eeActionId =
  | "approve"
  | "narrow"
  | "revoke"
  | "purge"
  | "open-window"
  | "close-window"
  | "clear-refusals"
  | "rotate-prekey"
  | "recover-policy"
  | "reset-fallback"
  | "remint-continuity"
  | "break-continuity";

export interface NodeE2eeActionConfirmation {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly destructive: boolean;
}

const ACTION_CONFIRMATIONS = {
  approve: {
    title: "Approve this client key?",
    // §13.6: a first approval is authority-widening, so it takes effect only on
    // a fresh ticket, channel, and handshake — never on one already open.
    body: "The device holding this key may then reach this node, up to the role and capabilities you grant here. Compare its number against the device first. It takes effect on its next connection, not on anything open now.",
    confirmLabel: "Approve key",
    destructive: false,
  },
  narrow: {
    title: "Reduce what this client may do?",
    body: "Anything this device has open under the wider authority closes immediately — the node will not confirm the change until those channels are shut. The device reconnects with the smaller authority.",
    confirmLabel: "Reduce authority",
    destructive: true,
  },
  revoke: {
    title: "Revoke this client key?",
    body: "The device loses access now: every channel it has open closes before this is confirmed, and it cannot reconnect until you approve it again. The record stays, so you can see it was revoked.",
    confirmLabel: "Revoke key",
    destructive: true,
  },
  purge: {
    title: "Delete this client record?",
    body: "The same immediate disconnection as revoking, and the record goes with it — there will be nothing left showing this device was ever here. If it connects again it arrives as a stranger and pairs from scratch.",
    confirmLabel: "Delete record",
    destructive: true,
  },
  "open-window": {
    title: "Open a pairing window for this fingerprint?",
    body: "For a short time this node will accept one introduction, and only from the key whose fingerprint you name. Read that fingerprint off the device itself — a window naming the wrong one lets the wrong device in.",
    confirmLabel: "Open window",
    destructive: false,
  },
  "close-window": {
    title: "Close the pairing window?",
    body: "No new device can introduce itself until you open another. Anything already introduced keeps its record.",
    confirmLabel: "Close window",
    destructive: false,
  },
  "clear-refusals": {
    title: "Clear the refused-attempt count?",
    body: "The count goes back to zero. Do this once you have dealt with what caused it, so the next reading is about the next thing rather than about history.",
    confirmLabel: "Clear count",
    destructive: false,
  },
  "rotate-prekey": {
    title: "Issue a new agreement prekey?",
    body: "The node makes a fresh key pair and certificate immediately. Clients pick the new one up on their next connection; nothing already open is disturbed.",
    confirmLabel: "Rotate prekey",
    destructive: false,
  },
  "recover-policy": {
    title: "Advance the policy generation?",
    body: NODE_POLICY_RECOVER_WARNING,
    confirmLabel: "Advance generation",
    destructive: true,
  },
  "reset-fallback": {
    title: "Reset the fallback counters?",
    body: "Both counts and the retained list go back to empty and a new observation window starts. What was recorded is gone; nothing else changes.",
    confirmLabel: "Reset counters",
    destructive: false,
  },
  "remint-continuity": {
    title: "Break continuity and mint a fresh lineage?",
    body: "Every device that has paired with this node has to go through the whole pairing ceremony again, in person, before it can reconnect. Do this when you believe the lineage is wrong, not to tidy it up.",
    confirmLabel: "Mint fresh lineage",
    destructive: true,
  },
  "break-continuity": {
    title: "Break the continuity chain?",
    body: "The lineage keeps its name, but every device that pinned this node has to go through the pairing ceremony again before it can reconnect.",
    confirmLabel: "Break chain",
    destructive: true,
  },
} as const satisfies Record<NodeE2eeActionId, NodeE2eeActionConfirmation>;

export function nodeE2eeActionConfirmation(action: NodeE2eeActionId): NodeE2eeActionConfirmation {
  return ACTION_CONFIRMATIONS[action];
}

/**
 * §8.3's role ordering, as the roles an approval may name.
 *
 * THE OWNER NAMES THE ROLE. §13.6: "`approved` requires explicit owner action
 * naming the maximum role and capability set." A single Approve button that
 * silently picked one would be the panel naming it, not the owner — and the
 * value it picked would become the ceiling every channel that key opens is
 * admitted under, which is the one decision here that cannot be taken back
 * without closing those channels.
 *
 * Ordered least-authority first, so the first thing under the cursor is the
 * smallest grant.
 */
export const NODE_E2EE_APPROVABLE_ROLES = ["viewer", "operator", "owner"] as const;
export type NodeE2eeApprovableRole = (typeof NODE_E2EE_APPROVABLE_ROLES)[number];

const APPROVAL_ROLE_MEANINGS: Record<NodeE2eeApprovableRole, string> = {
  viewer: "read what is there",
  operator: "edit files and run terminals",
  owner: "also change credentials and server policy",
};

/**
 * The approval confirmation, with the role the owner picked written into it.
 *
 * The capability set is granted EMPTY and the sentence says so. §13.6 has the
 * owner name it too, and a panel that inferred one would be granting authority
 * nobody asked for; an empty set is the least it can be, and widening it later
 * is an explicit `ryco e2ee client approve --capability …` on the node.
 */
export function nodeApproveConfirmation(role: NodeE2eeApprovableRole): NodeE2eeActionConfirmation {
  const base = ACTION_CONFIRMATIONS.approve;
  return {
    title: `Approve this client key as ${role}?`,
    body: `${base.body} At most it will be able to ${APPROVAL_ROLE_MEANINGS[role]}. No extra capabilities are granted here — add those from the node if you need them.`,
    confirmLabel: `Approve as ${role}`,
    destructive: false,
  };
}

/** Every action, for the scan that reads them all. */
export const NODE_E2EE_ACTION_IDS = Object.keys(
  ACTION_CONFIRMATIONS,
) as ReadonlyArray<NodeE2eeActionId>;

/**
 * Every owner-facing sentence this module ships, flattened.
 *
 * The prohibited-claims scan walks this rather than a hand-kept list, so a
 * constant added above is covered the moment it exists.
 */
export function everyNodeSecurityString(): ReadonlyArray<{
  readonly where: string;
  readonly text: string;
}> {
  const strings: { where: string; text: string }[] = [];
  for (const mode of ["local", "hosted"] as const) {
    const statement = nodeConnectionStatement(mode, null);
    strings.push({ where: `connection(${mode}).headline`, text: statement.headline });
    strings.push({ where: `connection(${mode}).body`, text: statement.body });
    const availability = nodeOperatorDataAvailability(mode);
    if (availability.unavailableBody !== "")
      strings.push({ where: `availability(${mode})`, text: availability.unavailableBody });
    const disposition = nodeE2eeStrictPolicyDisposition(mode);
    if (disposition.kind === "blocked")
      strings.push({ where: `strictPolicy(${mode})`, text: disposition.reason });
  }
  for (const action of NODE_E2EE_ACTION_IDS) {
    const confirmation = nodeE2eeActionConfirmation(action);
    strings.push({ where: `action(${action}).title`, text: confirmation.title });
    strings.push({ where: `action(${action}).body`, text: confirmation.body });
    strings.push({ where: `action(${action}).confirmLabel`, text: confirmation.confirmLabel });
  }
  for (const role of NODE_E2EE_APPROVABLE_ROLES) {
    const confirmation = nodeApproveConfirmation(role);
    strings.push({ where: `approve(${role}).title`, text: confirmation.title });
    strings.push({ where: `approve(${role}).body`, text: confirmation.body });
    strings.push({ where: `approve(${role}).confirmLabel`, text: confirmation.confirmLabel });
  }
  for (const fingerprint of [null, "SHA256:example"]) {
    strings.push({
      where: `enrollmentFingerprint(${fingerprint === null ? "absent" : "pending"})`,
      text: nodeEnrollmentFingerprintView(fingerprint).caption,
    });
  }
  strings.push({ where: "safetyNumberCaption", text: NODE_SAFETY_NUMBER_CAPTION });
  strings.push({ where: "safetyNumberAdvisory", text: NODE_SAFETY_NUMBER_ADVISORY });
  strings.push({ where: "safetyNumberUnavailable", text: NODE_SAFETY_NUMBER_UNAVAILABLE });
  strings.push({ where: "nativeSessionCode", text: NODE_SESSION_NATIVE_CODE_ABSENT });
  strings.push({ where: "policyRecoverWarning", text: NODE_POLICY_RECOVER_WARNING });
  strings.push({ where: "fallbackQuiet", text: NODE_FALLBACK_QUIET });
  return strings;
}
