// How the hosted connection surfaces DRAW one bounded status — the glyph and
// the colour beside the word.
//
// ─────────────────────────────────────────────────────────────────────────────
// THERE IS EXACTLY ONE OF THESE, AND IT READS `guarantee`
// ─────────────────────────────────────────────────────────────────────────────
// All three surfaces — the desktop menu, the phone sheet, the phone pill — chose
// their glyph from `connected` (and the menu, from `transportStatus` alone). Both
// `legacy` and `web-unsigned` are usable sessions, so both were `connected:
// true`, so a plaintext downgrade and a locked NX channel drew the identical
// green connected glyph. `docs/relay-e2ee-protocol.md` §2.2 forbids exactly
// that: "implementations and user-facing documentation MUST NOT present a
// stronger claim for a weaker configuration", and §12.2 requires the fallback to
// be labeled legacy "in every user-facing surface" — a label the fallback was
// wearing the verified session's colour under.
//
// `HostedConnectionStatusIndicator.guarantee` exists to be the single source of
// truth for that decision (see its doc comment in the runtime), so this mapper
// switches on it with `satisfies never` in the default arm. A member added to
// `HostedConnectionGuarantee` is then a compile error here rather than a silent
// fall-through into whichever branch happened to be last — which is precisely
// how an `if (guarantee === "legacy")` chain absorbed the web row into the
// connected branch in the first place.
//
// React-free on purpose: glyphs are named, not imported, so every decision below
// is assertable from a node test and the `.tsx` owns only the name-to-component
// mapping.

import type {
  HostedConnectionGuarantee,
  HostedConnectionStatusIndicator,
} from "../../hostedHub/connectionStatus";

/**
 * The glyphs the hosted surfaces draw, as names.
 *
 * `connected` / `disconnected` are the reachability pair the surfaces already
 * had. The other three are §2.2 claims and are deliberately a different family
 * of glyph — a shield rather than a signal bar — because a claim about who can
 * read the payload is not a claim about whether the socket is up, and drawing
 * both on the same glyph is what let one be mistaken for the other.
 */
export type HostedConnectionGlyph =
  | "connected"
  | "disconnected"
  | "legacy"
  | "browser-encrypted"
  | "native-verified";

export interface HostedConnectionStatusPresentation {
  readonly glyph: HostedConnectionGlyph;
  /** The glyph's colour utility. Never the only carrier of the state. */
  readonly iconClassName: string;
}

// THERE IS NO ORDINAL FIELD HERE, and there deliberately is not one. A
// `claimRank: 1 | 2 | 3 | null` shipped in this shape with no reader outside its
// own unit test: nothing rendered it, so the `legacy < web < e2ee` assertion
// written over it restated three integer literals declared eleven lines away and
// credited itself with defending §2.2's ladder. The UI has no ladder — it has
// three claims that must stay TELLABLE APART — so what the suite asserts is what
// the surface draws: a distinct glyph and a distinct colour per claim, none of
// them the plain-connected pair, and the web row never the native one
// (`HostedConnectionControls.logic.test.ts`, and the rendered comparison of
// colour and path in `HostedConnectionControls.browser.tsx`).

/**
 * The presentation of each §2.2 claim that asserts something, as an exhaustive
 * map over the guarantee union minus its one non-claim.
 *
 * A `Record` rather than a conditional chain, for the reason every other
 * exhaustive map in this area exists: adding a member to
 * `HostedConnectionGuarantee` has to force a decision about how it is drawn,
 * and `Exclude<…, "none">` makes the new key required here the moment it is
 * added. `e2ee` is present even though this tier can never reach it
 * (`connectionStatus.ts` fences `verified` out before the derivation sees it):
 * the ladder is only checkable if its top rung exists, and the property worth
 * pinning is that the `web` row's presentation is not the `e2ee` row's.
 */
const HOSTED_CLAIM_PRESENTATIONS = {
  // §12.2's mandatory label, drawn as the negative assertion it is. A struck
  // shield rather than a signal bar, and never the success colour.
  legacy: { glyph: "legacy", iconClassName: "text-amber-500" },
  // §2.2's *Web, unsigned ephemeral* row and §2.4's ceiling: a usable,
  // encrypted channel whose code the Hub serves. It gets the informational
  // colour — the one connected tone that is neither the fallback's amber nor
  // the row the success colour means — so the scale reads legacy, then browser,
  // then verified, rather than grouping the browser row with the one §2.2
  // forbids it from claiming.
  web: { glyph: "browser-encrypted", iconClassName: "text-sky-500" },
  // Native only, and unreachable from this tier by construction.
  e2ee: { glyph: "native-verified", iconClassName: "text-emerald-500" },
} as const satisfies Record<
  Exclude<HostedConnectionGuarantee, "none">,
  HostedConnectionStatusPresentation
>;

/**
 * How one bounded status is drawn.
 *
 * Reachability decides only where §2.2 has nothing to say. Where it does, the
 * claim decides — so no surface can render a state that claims `legacy` with the
 * glyph or the colour a state claiming `web` gets, and neither can be drawn as
 * the native verified row.
 */
export function hostedConnectionStatusPresentation(
  indicator: HostedConnectionStatusIndicator,
): HostedConnectionStatusPresentation {
  if (indicator.guarantee !== "none") return HOSTED_CLAIM_PRESENTATIONS[indicator.guarantee];
  return indicator.connected
    ? { glyph: "connected", iconClassName: "text-emerald-500" }
    : { glyph: "disconnected", iconClassName: "text-amber-500" };
}
