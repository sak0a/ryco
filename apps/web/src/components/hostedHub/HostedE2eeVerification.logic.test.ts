import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
  E2EE_WEB_SAS_CAPTION,
  E2EE_WEB_SAS_DISPLAYED_BITS,
  E2EE_WEB_SAS_UNAVAILABLE,
  type HostedE2eeVerificationView,
} from "./HostedE2eeVerification.logic";

const LOGIC_SOURCE = readFileSync(
  fileURLToPath(new URL("./HostedE2eeVerification.logic.ts", import.meta.url)),
  "utf8",
);

/** A well-formed §13.5 rendering, built from the constants rather than typed. */
const VALID = ["ABCD", "EFGH"].join(E2EE_WEB_SAS_CHARS.separator);

/**
 * Format acceptance as the RENDERER decides it.
 *
 * Asserted through the two functions the surface actually calls — the splitter
 * and the view builder — rather than through a boolean wrapper. The wrapper this
 * replaced had no production caller at all, so a change that broke validation
 * for the renderer while leaving the wrapper correct would still have been
 * reported green by every line below.
 */
function accepted(display: string): boolean {
  return e2eeWebSasGroups(display).length > 0 && hostedE2eeVerificationView(display) !== null;
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

describe("the caption quotes the constants", () => {
  it("puts each format number in the clause that number belongs to", () => {
    // Bare digit checks cannot tell a correct sentence from a scrambled one: a
    // caption reading "2 characters, in 4 groups of 8 … read all 2 in order"
    // contains every digit the shipped one does, and tells the owner to compare
    // two characters of an eight-character code. The ASSEMBLED phrases are what
    // pin the sentence, and §13.5 makes the length and the grouping the
    // checksum, so this caption is the owner's only instruction about what to
    // compare.
    expect(E2EE_WEB_SAS_CAPTION).toContain(`${E2EE_WEB_SAS_CHARS.chars} characters`);
    expect(E2EE_WEB_SAS_CAPTION).toContain(
      `${E2EE_WEB_SAS_CHARS.groups} groups of ${E2EE_WEB_SAS_CHARS.charsPerGroup}`,
    );
    expect(E2EE_WEB_SAS_CAPTION).toContain(`read all ${E2EE_WEB_SAS_CHARS.chars} in order`);
    expect(E2EE_WEB_SAS_CAPTION).toContain(`carry ${E2EE_WEB_SAS_DISPLAYED_BITS} bits`);
  });

  it("assembles those numbers rather than typing them", () => {
    // The runtime check above passes for a fully hardcoded string that happens
    // to carry the same digits, which defeats the property the caption is
    // assembled FOR: "a §13.5 format change rewrites this sentence in the same
    // edit". Only the source can show that, so the source is what is read —
    // the same belt-and-braces the connection controls' call-site test uses.
    const caption = LOGIC_SOURCE.match(/export const E2EE_WEB_SAS_CAPTION =\n([\s\S]*?);\n/u)?.[1];
    expect(caption, "the caption declaration moved — this test is testing nothing").toBeDefined();
    expect(caption).toContain("${E2EE_WEB_SAS_CHARS.chars}");
    expect(caption).toContain("${E2EE_WEB_SAS_CHARS.groups}");
    expect(caption).toContain("${E2EE_WEB_SAS_CHARS.charsPerGroup}");
    expect(caption).toContain("${E2EE_WEB_SAS_DISPLAYED_BITS}");
    // …and no digit is written into the sentence directly. The interpolations
    // are removed first, because the constant names carry digits of their own.
    expect(caption!.replaceAll(/\$\{[^}]*\}/gu, "")).not.toMatch(/\d/u);
  });

  it("states the entropy the shipped format displays, bounded by the handshake window", () => {
    // §13.5's non-normative note: at the shipped `E2EE_WEB_SAS_CHARS` the search
    // is "~2^40 expected trials … far beyond a large GPU fleet", while the
    // `E2EE_WEB_SAS_MIN_DISPLAYED_BITS` floor is "where a well-resourced
    // attacker becomes relevant". Quoting the floor understated the shipped
    // check about a thousandfold — a reason for an owner to skip the one
    // comparison they have.
    expect(E2EE_WEB_SAS_DISPLAYED_BITS).toBe(
      E2EE_WEB_SAS_CHARS.chars * Math.log2(E2EE_CROCKFORD_ALPHABET.length),
    );
    expect(Number.isInteger(E2EE_WEB_SAS_DISPLAYED_BITS)).toBe(true);
    // §3.2.1 S11's relationship, kept where it belongs: an invariant over the
    // constants rather than a number in a sentence an owner has to act on.
    expect(E2EE_WEB_SAS_DISPLAYED_BITS).toBeGreaterThanOrEqual(E2EE_WEB_SAS_MIN_DISPLAYED_BITS);

    // §17.5: the entropy "is justified by that window and not by an offline work
    // factor", and §13.5 forbids using the derivation "to strengthen the claims
    // of §2.4 or §17.5". Both bounds and the denial stay attached to the number.
    const lower = E2EE_WEB_SAS_CAPTION.toLowerCase();
    expect(lower).toContain("bounded in time");
    expect(lower).toContain("one attempt");
    expect(lower).toContain("not an amount of work an attacker has to do offline");
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
  it("makes the required denial and names what the comparison does catch", () => {
    const lower = E2EE_WEB_SAS_ADVISORY.toLowerCase();
    // The advisory-only disclosure duty, verbatim in substance: what a match
    // catches, and what it cannot protect against.
    expect(lower).toContain("accidental wrong-node routing");
    expect(lower).toContain("some network interposition");
    expect(lower).toContain("while the loaded code is honest");
    expect(lower).toContain("cannot protect against the hub operator, who serves that code");
    expect(lower).toContain("does not rule out someone sitting in the middle");
    // §2.2's web row denies the active-Hub column twice, and the half that needs
    // no substituted bundle — "the Hub can originate an unsigned NX session" —
    // is what this comparison is FOR. The clause names the party a match rules
    // out by construction, which is also why the same sentence has to deny the
    // Hub: on this tier the Hub always serves the page.
    expect(lower).toContain("anyone standing in for your node who is not also serving this page");
    // It is the pointer at the ceremony, and it is here rather than in the trust
    // notice because this value renders only where the characters do.
    expect(lower).toContain("compare this code with the one your node's cli shows");
  });

  it("comes back with the code, in one value, in every view the splitter accepts", () => {
    const view = hostedE2eeVerificationView(VALID);
    expect(view).not.toBeNull();
    expect(view!.groups).toEqual(["ABCD", "EFGH"]);
    expect(view!.display).toBe(VALID);
    expect(view!.caption).toBe(E2EE_WEB_SAS_CAPTION);
    expect(view!.advisory).toBe(E2EE_WEB_SAS_ADVISORY);
  });

  it("is required by the type, not merely populated by the constructor", () => {
    // If `advisory` ever became optional, `{ advisory?: string }` would stop
    // extending `{ advisory: string }`, `AdvisoryIsRequired` would resolve to
    // `false`, and this assignment would not compile. The runtime expectation
    // below is only here so the check is visible in the suite output.
    type AdvisoryIsRequired = HostedE2eeVerificationView extends { advisory: string }
      ? true
      : false;
    const advisoryIsRequired: AdvisoryIsRequired = true;
    expect(advisoryIsRequired).toBe(true);
  });

  it("returns nothing at all rather than a code with no advisory", () => {
    // The only way a surface gets the characters is by holding a view, and the
    // only views that exist carry the denial. There is no partial result.
    expect(hostedE2eeVerificationView(null)).toBeNull();
    for (const malformed of ["", "ABCDEFGH", "ABCD-EFG", "abcd-efgh", "ABCD EFGH"]) {
      expect(hostedE2eeVerificationView(malformed), JSON.stringify(malformed)).toBeNull();
    }
  });
});
