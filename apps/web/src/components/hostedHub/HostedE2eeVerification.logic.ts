// docs/relay-e2ee-protocol.md §13.5's `WebSAS`, as the only shape a surface can
// render it in.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE CODE AND ITS CEILING ARE ONE VALUE
// ─────────────────────────────────────────────────────────────────────────────
// §13.5 puts an **advisory-only disclosure duty** on the display, not on the
// derivation: "The web UI text accompanying the `WebSAS` MUST state that the
// comparison catches accidental wrong-node routing and some network
// interposition while the loaded code is honest, and **cannot** protect against
// the Hub operator, who serves the code that displays it."
//
// A duty a caller can discharge separately is a duty a caller can forget, so
// {@link hostedE2eeVerificationView} returns the groups, the format caption, and
// that sentence as ONE object with three required fields. There is no exported
// function that hands back the eight characters alone: rendering the code
// without the denial requires deleting a field from a returned value rather than
// omitting a call, which is the difference between a rule and a mechanism.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE NUMBERS ARE QUOTED, NEVER WRITTEN
// ─────────────────────────────────────────────────────────────────────────────
// Both the splitter and the caption read `E2EE_WEB_SAS_CHARS` and
// `E2EE_WEB_SAS_MIN_DISPLAYED_BITS`, exactly as `apps/mobile`'s §13.4 caption
// reads the safety-number constants. A §13.5 format change therefore breaks the
// split and rewrites the sentence in the same edit; it can never leave a stale
// claim about a length behind.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE COPY MAY NOT SAY
// ─────────────────────────────────────────────────────────────────────────────
// §13.5: "Implementations MUST NOT present the `WebSAS` as unforgeable against
// an active interposer", "MUST NOT present the `WebSAS` as an operator-proof or
// E2EE-verification guarantee", and "MUST NOT describe a match as proof that no
// interposer is present". §17.5 adds that its entropy floor "is an online bound
// rather than an offline one", so the caption states the floor together with the
// two things that bound it — `T_HANDSHAKE` and §8.1's one attempt per channel —
// rather than as a work factor.
//
// The advisory mirrors the sentence `apps/server`'s CLI already prints beside
// the node-side code, so the two halves of the compare-out-of-band flow read as
// one instruction. It diverges in its final clause only: the CLI ends "a match
// is not proof that no interposer is present", and the scan in
// `HostedRelayTrustNotice.logic.test.ts` is a bare substring match that cannot
// tell that denial from a claim. This module makes the same denial without the
// tokens, so no future edit can strand one of them in the affirmative.

import {
  E2EE_CROCKFORD_ALPHABET,
  E2EE_WEB_SAS_CHARS,
  E2EE_WEB_SAS_MIN_DISPLAYED_BITS,
} from "@ryco/shared/relayE2eeConstants";

/**
 * Split §13.5's rendered value into its display groups, in derivation order.
 *
 * The rendering is the shared derivation's (`deriveE2eeWebSas`); this only
 * re-splits it, and refuses anything that is not the exact `E2EE_WEB_SAS_CHARS`
 * format — `groups` runs of `charsPerGroup` characters from
 * `E2EE_CROCKFORD_ALPHABET`, joined by a single `separator`. A surface that
 * silently re-grouped, truncated, padded, or lower-cased would show the owner a
 * different string from the one the node CLI prints, in the one ceremony that
 * consists of comparing the two — and §13.5 is explicit that "there is no
 * separate check character; as with the safety number, the fixed length and
 * grouping are the checksum".
 *
 * Returns `[]` for every non-conforming input, including the empty string.
 */
export function e2eeWebSasGroups(display: string): ReadonlyArray<string> {
  const groups = display.split(E2EE_WEB_SAS_CHARS.separator);
  if (groups.length !== E2EE_WEB_SAS_CHARS.groups) return [];
  for (const group of groups) {
    if (group.length !== E2EE_WEB_SAS_CHARS.charsPerGroup) return [];
    for (const character of group) {
      if (!E2EE_CROCKFORD_ALPHABET.includes(character)) return [];
    }
  }
  return groups;
}

/** True only for a value in the exact §13.5 display format. */
export function isE2eeWebSasDisplay(display: string): boolean {
  return e2eeWebSasGroups(display).length === E2EE_WEB_SAS_CHARS.groups;
}

/**
 * What the surface says about the string itself — format, and what its entropy
 * floor does and does not buy.
 *
 * Every number is quoted from `relayE2eeConstants.ts`. The floor is stated as a
 * floor ("at least"), because the shipped format sits about a thousandfold above
 * it (§13.5's non-normative note), and it is stated together with the window
 * that justifies it, because §17.5 is explicit that it "is justified by that
 * window and not by an offline work factor".
 */
export const E2EE_WEB_SAS_CAPTION =
  `${E2EE_WEB_SAS_CHARS.chars} characters, in ${E2EE_WEB_SAS_CHARS.groups} groups of ` +
  `${E2EE_WEB_SAS_CHARS.charsPerGroup}. The length and the grouping are the only check there is, ` +
  `so read all ${E2EE_WEB_SAS_CHARS.chars} in order. They carry at least ` +
  `${E2EE_WEB_SAS_MIN_DISPLAYED_BITS} bits, and that floor holds only because a handshake is ` +
  "bounded in time and each channel gets exactly one attempt — it is not an amount of work an " +
  "attacker has to do offline.";

/**
 * §13.5's advisory-only disclosure duty, in the words the specification bounds
 * it to: what the comparison catches, and what it cannot protect against.
 */
export const E2EE_WEB_SAS_ADVISORY =
  "Compare this code with the one your node's CLI shows for this session. A match catches " +
  "accidental wrong-node routing and some network interposition while the loaded code is honest; " +
  "it cannot protect against the Hub operator, who serves that code, and a match does not rule " +
  "out someone sitting in the middle.";

/**
 * Everything a surface needs to render §13.5, and nothing it can render without.
 *
 * All three fields are required. {@link E2EE_WEB_SAS_ADVISORY} in particular is
 * not optional and has no default: a caller holding this object has already been
 * handed the denial, so the only way to draw the code without it is to
 * deliberately drop a field.
 */
export interface HostedE2eeVerificationView {
  /** The validated groups, in derivation order. */
  readonly groups: ReadonlyArray<string>;
  /**
   * The groups re-joined with the format's own separator — what a surface
   * draws, so no renderer picks a separator of its own.
   */
  readonly display: string;
  readonly caption: string;
  readonly advisory: string;
}

/**
 * The §13.5 view for the current channel, or `null` when there is nothing this
 * tier may draw.
 *
 * `null` for an absent code and for anything that is not the exact display
 * format. A malformed value means this client did not derive the string the node
 * is showing, and half a comparison is worse than none: the owner would compare
 * something, see it differ, and learn nothing about why.
 */
export function hostedE2eeVerificationView(code: string | null): HostedE2eeVerificationView | null {
  if (code === null) return null;
  const groups = e2eeWebSasGroups(code);
  if (groups.length === 0) return null;
  return {
    groups,
    display: groups.join(E2EE_WEB_SAS_CHARS.separator),
    caption: E2EE_WEB_SAS_CAPTION,
    advisory: E2EE_WEB_SAS_ADVISORY,
  };
}
