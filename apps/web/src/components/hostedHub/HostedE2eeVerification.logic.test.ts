import {
  E2EE_CROCKFORD_ALPHABET,
  E2EE_WEB_SAS_CHARS,
  E2EE_WEB_SAS_MIN_DISPLAYED_BITS,
} from "@ryco/shared/relayE2eeConstants";
import { describe, expect, it } from "vite-plus/test";

import {
  e2eeWebSasGroups,
  hostedE2eeVerificationView,
  E2EE_WEB_SAS_ADVISORY,
  E2EE_WEB_SAS_COMPARE,
  E2EE_WEB_SAS_DETAIL,
  E2EE_WEB_SAS_DISPLAYED_BITS,
  E2EE_WEB_SAS_MORE,
  E2EE_WEB_SAS_UNAVAILABLE,
  HOSTED_E2EE_VERIFICATION_PLACEMENTS,
  type HostedE2eeVerificationView,
} from "./HostedE2eeVerification.logic";

/** A well-formed §13.5 rendering, built from the constants rather than typed. */
const VALID = ["ABCD", "EFGH"].join(E2EE_WEB_SAS_CHARS.separator);

/**
 * Format acceptance as the RENDERER decides it.
 *
 * Asserted through the two functions the surface actually calls — the splitter
 * and the view builder — rather than through a boolean wrapper. The wrapper this
 * replaced had no production caller at all, so a change that broke validation
 * for the renderer while leaving the wrapper correct would still have been
 * reported green by every line below. Every placement is required to agree: a
 * length is a choice about words, never about which strings are a valid code.
 */
function accepted(display: string): boolean {
  return (
    e2eeWebSasGroups(display).length > 0 &&
    HOSTED_E2EE_VERIFICATION_PLACEMENTS.every(
      (placement) => hostedE2eeVerificationView(display, placement) !== null,
    )
  );
}

describe("§13.5 the display format is the checksum", () => {
  it("accepts the exact format and returns its groups in order", () => {
    expect(e2eeWebSasGroups(VALID)).toEqual(["ABCD", "EFGH"]);
    expect(accepted(VALID)).toBe(true);
  });

  it("refuses everything that is not the exact format", () => {
    // §13.5: "There is no separate check character; as with the safety number,
    // the fixed length and grouping are the checksum." A splitter that repaired
    // any of these would show the owner a value the node CLI is not showing, in
    // the one ceremony that consists of comparing the two.
    for (const rejected of [
      "",
      "ABCDEFGH", // no separator: one group
      "AB-CD-EF-GH", // four groups
      "ABC-DEFGH", // right length, wrong grouping
      "ABCDE-FGH", // right length, wrong grouping the other way
      "ABCD EFGH", // wrong separator
      "ABCD--EFGH", // an empty group between two separators
      "ABCD-EFG", // short
      "ABCD-EFGHI", // long
      "abcd-efgh", // Crockford base32 renders upper case
      "ABCD-EFGU", // `U` is not in the alphabet
      "ABCD-EFGI", // nor is `I`
      " ABCD-EFGH",
      "ABCD-EFGH ",
    ]) {
      expect(e2eeWebSasGroups(rejected), JSON.stringify(rejected)).toEqual([]);
      expect(accepted(rejected), JSON.stringify(rejected)).toBe(false);
    }
  });

  it("accepts every character of the alphabet and nothing outside it", () => {
    for (const character of E2EE_CROCKFORD_ALPHABET) {
      const filled = character.repeat(E2EE_WEB_SAS_CHARS.charsPerGroup);
      expect(accepted([filled, filled].join(E2EE_WEB_SAS_CHARS.separator)), character).toBe(true);
    }
    for (const character of "IiLlOoUu-_+/= ") {
      const filled = character.repeat(E2EE_WEB_SAS_CHARS.charsPerGroup);
      expect(accepted([filled, filled].join(E2EE_WEB_SAS_CHARS.separator)), character).toBe(false);
    }
  });

  it("agrees with the constants rather than with a literal", () => {
    // The splitter reads `groups`, `charsPerGroup`, and `separator`, so this is
    // what makes a §13.5 format change break the split instead of silently
    // re-grouping the owner's comparison value.
    expect(E2EE_WEB_SAS_CHARS.groups * E2EE_WEB_SAS_CHARS.charsPerGroup).toBe(
      E2EE_WEB_SAS_CHARS.chars,
    );
    expect(VALID.replaceAll(E2EE_WEB_SAS_CHARS.separator, "")).toHaveLength(
      E2EE_WEB_SAS_CHARS.chars,
    );
  });
});

describe("§3.2.1 S11 is an invariant over the constants, not a sentence", () => {
  it("keeps the shipped format above the displayed-entropy floor", () => {
    // The caption that used to state this number is gone: §17.5 makes the
    // entropy "justified by that window and not by an offline work factor", so
    // it was a derivation an owner could not act on, and §13.5 forbids using the
    // derivation "to strengthen the claims of §2.4 or §17.5" — which is the only
    // thing a number beside the code could have been read as doing.
    //
    // THE RELATIONSHIP IS NOT COPY AND DID NOT LEAVE WITH THE SENTENCE. A format
    // change that quietly dropped the rendered value below the floor would be a
    // real regression whether or not any surface mentions bits.
    expect(E2EE_WEB_SAS_DISPLAYED_BITS).toBe(
      E2EE_WEB_SAS_CHARS.chars * Math.log2(E2EE_CROCKFORD_ALPHABET.length),
    );
    expect(Number.isInteger(E2EE_WEB_SAS_DISPLAYED_BITS)).toBe(true);
    expect(E2EE_WEB_SAS_DISPLAYED_BITS).toBeGreaterThanOrEqual(E2EE_WEB_SAS_MIN_DISPLAYED_BITS);
  });
});

describe("§13.5 the inline form is short, and still discharges the duty", () => {
  it("carries both clauses of the advisory-only disclosure duty", () => {
    const lower = E2EE_WEB_SAS_ADVISORY.toLowerCase();
    // "MUST state that the comparison catches accidental wrong-node routing and
    // some network interposition while the loaded code is honest, and **cannot**
    // protect against the Hub operator, who serves the code that displays it."
    // A bare code violates that MUST, so shortening may drop wording and may
    // never drop either clause.
    expect(lower).toContain("accidental wrong-node routing");
    expect(lower).toContain("some network interposition");
    expect(lower).toContain("while the loaded code is honest");
    expect(lower).toContain("cannot protect against the hub operator, who serves this page");
    // It is the pointer at the ceremony, and it is here rather than in the trust
    // notice because this value renders only where the characters do.
    expect(lower).toContain("compare this code with the one your node's cli shows");
  });

  it("no longer states the format, the arithmetic, or the hedge", () => {
    // The three things the owner did not need while comparing eight characters:
    // the character count and grouping (visible in the code itself), the bit
    // total and the window-and-one-attempt justification behind it, and the
    // trailing "a match does not rule out someone sitting in the middle", which
    // restated the clause immediately before it.
    const lower = E2EE_WEB_SAS_ADVISORY.toLowerCase();
    expect(E2EE_WEB_SAS_ADVISORY).not.toMatch(/\d/u);
    for (const cut of [
      "groups of",
      "in order",
      "bits",
      "bounded in time",
      "one attempt",
      "offline",
      "does not rule out",
    ]) {
      expect(lower, `the inline form still says ${cut}`).not.toContain(cut);
    }
  });

  it("is materially shorter than what an owner opens Settings to read", () => {
    // "Short" has to be a measured property or it is only a name: this line is
    // the whole of the accompanying text on the surface where an owner is
    // mid-comparison, and copy creeping back into it is exactly the regression
    // this shape exists to stop. The ceiling is generous enough for a reword and
    // far below the two paragraphs it replaced.
    expect(E2EE_WEB_SAS_ADVISORY.length).toBeLessThanOrEqual(260);
    expect(E2EE_WEB_SAS_MORE.length).toBeLessThanOrEqual(80);
    expect(E2EE_WEB_SAS_ADVISORY.length).toBeLessThan(E2EE_WEB_SAS_DETAIL.length);
  });

  it("ships the pointer at the long form, and names where it is", () => {
    // A short form whose pointer a caller could drop is a short form that
    // silently becomes the only account an owner is ever offered.
    expect(E2EE_WEB_SAS_MORE).toContain("Settings → Security");
  });
});

describe("§2.2 the long form keeps both reasons, and keeps them apart", () => {
  it("states §13.5's duty at full strength", () => {
    const lower = E2EE_WEB_SAS_DETAIL.toLowerCase();
    expect(lower).toContain("accidental wrong-node routing");
    expect(lower).toContain("some network interposition");
    expect(lower).toContain("while the loaded code is honest");
    expect(lower).toContain("cannot protect against the hub operator");
    expect(lower).toContain("compare this code with the one your node's cli shows");
  });

  it("names the reason that needs no substituted bundle at all", () => {
    // §2.2's web row: "**Not protected** — the Hub can originate an unsigned NX
    // session **and** controls the served code". §8.10: NX client→node is "never
    // authenticated at the Noise level … a Hub can originate an NX session", and
    // node→client encrypts "to an **anonymous ephemeral initiator** — any active
    // party, including the Hub". This tier holds no pin with which to tell the
    // far end apart (§2.3's web bullet, §6.3, §13.1), and that half of the denial
    // is true even of an honest bundle.
    const lower = E2EE_WEB_SAS_DETAIL.toLowerCase();
    expect(lower).toContain("pins no node identity");
    expect(lower).toContain("your machine or the hub standing in for it");
  });

  it("does not let the two reasons read as one", () => {
    // Collapsing them leaves a reader who has no cause to doubt the bundle
    // concluding the Hub is outside the channel. It is not: one reason needs a
    // substituted bundle and the other needs nothing, so the sentence counts
    // them and the no-pin clause is stated before the served-code one.
    const lower = E2EE_WEB_SAS_DETAIL.toLowerCase();
    expect(lower).toContain("two separate things it cannot do");
    expect(lower.indexOf("pins no node identity")).toBeLessThan(
      lower.indexOf("cannot protect against the hub operator"),
    );
  });

  it("is trimmed the same way the inline form is", () => {
    // §13.5's own rule for this surface: an owner reading Settings wants what
    // this protects them from and what it does not, not the derivation.
    const lower = E2EE_WEB_SAS_DETAIL.toLowerCase();
    expect(E2EE_WEB_SAS_DETAIL).not.toMatch(/\d/u);
    for (const cut of ["groups of", "bits", "offline", "does not rule out"]) {
      expect(lower, `the long form still says ${cut}`).not.toContain(cut);
    }
  });

  it("says what to do about it, with the command that produces the other end", () => {
    expect(E2EE_WEB_SAS_COMPARE).toContain("ryco e2ee sessions");
  });
});

describe("§13.5 the absence of a code is a state with words", () => {
  it("says the channel has nothing to compare, rather than saying nothing", () => {
    // §13.5's duty is a DISPLAY duty and the derivation is allowed to fail
    // without costing the channel (`publishWebVerificationCode` returns silently
    // on a derivation failure). Rendering nothing there left the strongest claim
    // this tier can make standing with its only check silently missing.
    const lower = E2EE_WEB_SAS_UNAVAILABLE.toLowerCase();
    expect(lower).toContain("no session code is available");
    expect(lower).toContain("nothing here to compare");
    // It is an absence, not a fallback report: §12.2's `legacy` label is the one
    // sentence allowed to say the channel went to plaintext.
    expect(lower).not.toContain("plaintext");
    expect(lower).not.toContain("legacy");
  });
});

describe("§13.5 the advisory cannot be left out", () => {
  it("comes back with the code, in one value, in every placement and every accepted format", () => {
    for (const placement of HOSTED_E2EE_VERIFICATION_PLACEMENTS) {
      const view = hostedE2eeVerificationView(VALID, placement);
      expect(view, placement).not.toBeNull();
      expect(view!.groups, placement).toEqual(["ABCD", "EFGH"]);
      expect(view!.display, placement).toBe(VALID);
      // BOTH sentences travel with the characters, at every length. Neither is
      // defaulted and neither is empty, so a placement cannot ship a code with
      // one sentence and a gap where the other belongs.
      expect(view!.advisory.trim().length, `${placement}.advisory`).toBeGreaterThan(0);
      expect(view!.more.trim().length, `${placement}.more`).toBeGreaterThan(0);
    }
  });

  it("gives each placement its own pair, and no placement the other's", () => {
    // A builder that returned one pair for every placement would pass every
    // assertion about the strings above while shipping the long account on the
    // surface the owner was comparing on, or the pointer-to-here on the page it
    // points at.
    const inline = hostedE2eeVerificationView(VALID, "inline")!;
    const settings = hostedE2eeVerificationView(VALID, "settings")!;
    expect(inline.advisory).toBe(E2EE_WEB_SAS_ADVISORY);
    expect(inline.more).toBe(E2EE_WEB_SAS_MORE);
    expect(settings.advisory).toBe(E2EE_WEB_SAS_DETAIL);
    expect(settings.more).toBe(E2EE_WEB_SAS_COMPARE);
    expect(HOSTED_E2EE_VERIFICATION_PLACEMENTS.toSorted()).toEqual(["inline", "settings"]);
  });

  it("is required by the type, not merely populated by the constructor", () => {
    // If either field ever became optional, `{ advisory?: string }` would stop
    // extending `{ advisory: string }`, the alias would resolve to `false`, and
    // this assignment would not compile. The runtime expectation below is only
    // here so the check is visible in the suite output.
    type BothAreRequired = HostedE2eeVerificationView extends {
      advisory: string;
      more: string;
    }
      ? true
      : false;
    const bothAreRequired: BothAreRequired = true;
    expect(bothAreRequired).toBe(true);
  });

  it("returns nothing at all rather than a code with no advisory", () => {
    // The only way a surface gets the characters is by holding a view, and the
    // only views that exist carry the denial. There is no partial result.
    for (const placement of HOSTED_E2EE_VERIFICATION_PLACEMENTS) {
      expect(hostedE2eeVerificationView(null, placement), placement).toBeNull();
      for (const malformed of ["", "ABCDEFGH", "ABCD-EFG", "abcd-efgh", "ABCD EFGH"]) {
        expect(
          hostedE2eeVerificationView(malformed, placement),
          `${placement} ${JSON.stringify(malformed)}`,
        ).toBeNull();
      }
    }
  });
});
