import {
  E2EE_CROCKFORD_ALPHABET,
  E2EE_WEB_SAS_CHARS,
  E2EE_WEB_SAS_MIN_DISPLAYED_BITS,
} from "@ryco/shared/relayE2eeConstants";
import { describe, expect, it } from "vite-plus/test";

import {
  e2eeWebSasGroups,
  hostedE2eeVerificationView,
  isE2eeWebSasDisplay,
  E2EE_WEB_SAS_ADVISORY,
  E2EE_WEB_SAS_CAPTION,
  type HostedE2eeVerificationView,
} from "./HostedE2eeVerification.logic";

/** A well-formed §13.5 rendering, built from the constants rather than typed. */
const VALID = ["ABCD", "EFGH"].join(E2EE_WEB_SAS_CHARS.separator);

describe("§13.5 the display format is the checksum", () => {
  it("accepts the exact format and returns its groups in order", () => {
    expect(e2eeWebSasGroups(VALID)).toEqual(["ABCD", "EFGH"]);
    expect(isE2eeWebSasDisplay(VALID)).toBe(true);
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
      expect(isE2eeWebSasDisplay(rejected), JSON.stringify(rejected)).toBe(false);
    }
  });

  it("accepts every character of the alphabet and nothing outside it", () => {
    for (const character of E2EE_CROCKFORD_ALPHABET) {
      const filled = character.repeat(E2EE_WEB_SAS_CHARS.charsPerGroup);
      expect(
        isE2eeWebSasDisplay([filled, filled].join(E2EE_WEB_SAS_CHARS.separator)),
        character,
      ).toBe(true);
    }
    for (const character of "IiLlOoUu-_+/= ") {
      const filled = character.repeat(E2EE_WEB_SAS_CHARS.charsPerGroup);
      expect(
        isE2eeWebSasDisplay([filled, filled].join(E2EE_WEB_SAS_CHARS.separator)),
        character,
      ).toBe(false);
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
  it("carries the format numbers from `relayE2eeConstants`, not literals", () => {
    // A §13.5 length change rewrites this sentence in the same edit, which is
    // the whole reason the caption is assembled rather than written.
    expect(E2EE_WEB_SAS_CAPTION).toContain(String(E2EE_WEB_SAS_CHARS.chars));
    expect(E2EE_WEB_SAS_CAPTION).toContain(String(E2EE_WEB_SAS_CHARS.groups));
    expect(E2EE_WEB_SAS_CAPTION).toContain(String(E2EE_WEB_SAS_CHARS.charsPerGroup));
    expect(E2EE_WEB_SAS_CAPTION).toContain(String(E2EE_WEB_SAS_MIN_DISPLAYED_BITS));
  });

  it("states the entropy floor as a floor, bounded by the handshake window", () => {
    // §17.5: the floor "is justified by that window and not by an offline work
    // factor", and §13.5 forbids using the derivation "to strengthen the claims
    // of §2.4 or §17.5".
    const lower = E2EE_WEB_SAS_CAPTION.toLowerCase();
    expect(lower).toContain("at least");
    expect(lower).toContain("one attempt");
    expect(lower).toContain("not an amount of work an attacker has to do offline");
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
