import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

import {
  HOSTED_CONNECTION_STATUS_INDICATORS,
  HOSTED_CONNECTION_STATUS_TEXTS,
  type HostedConnectionGuarantee,
  type HostedConnectionStatusIndicator,
} from "../../hostedHub/connectionStatus";
import { hostedConnectionStatusPresentation } from "./HostedConnectionControls.logic";

const CONTROLS_SOURCE = readFileSync(
  fileURLToPath(new URL("./HostedConnectionControls.tsx", import.meta.url)),
  "utf8",
);

function indicator(
  guarantee: HostedConnectionGuarantee,
  connected: boolean,
  shortLabel = "Whatever",
): HostedConnectionStatusIndicator {
  return { shortLabel, connected, guarantee };
}

describe("every derivation call site supplies the §4.4 channel state", () => {
  it("passes `e2eeStatus` at all three status call sites", () => {
    // §12.2 makes the legacy label mandatory "in every user-facing surface", and
    // the derivation's `e2eeStatus` is optional with an `unavailable` default —
    // so a surface that simply forgot it renders a plaintext downgrade as a
    // green `Online` and nothing type-checks differently. Read off the source
    // because that is where the omission would live: a runtime test can only
    // observe the call sites it already knows to mount.
    const callSites = CONTROLS_SOURCE.match(/deriveHostedConnectionStatus(?:Text|Indicator)\(/gu);
    expect(
      callSites,
      "no derivation call sites found — this test is testing nothing",
    ).not.toBeNull();
    // Three surfaces (menu, sheet, pill), each deriving text and indicator from
    // one shared `statusInput`.
    expect(callSites).toHaveLength(6);
    // Every surface builds exactly one input object, and every one of them
    // carries the channel state.
    const inputs = CONTROLS_SOURCE.match(/const statusInput = \{[^}]*\}/gu) ?? [];
    expect(inputs).toHaveLength(3);
    for (const input of inputs) expect(input).toContain("e2eeStatus");
    // …and nothing derives from an inline object that could quietly omit it.
    expect(CONTROLS_SOURCE).not.toMatch(/deriveHostedConnectionStatus(?:Text|Indicator)\(\{/u);
  });

  it("reads the projection through the tier-fenced hook in all three", () => {
    expect(CONTROLS_SOURCE.match(/useWebE2eeChannelStatus\(\)/gu)).toHaveLength(3);
  });

  it("chooses no glyph from the transport or from connectedness", () => {
    // The three defects this replaced, pinned as source facts because each of
    // them was a conditional that type-checked perfectly.
    expect(CONTROLS_SOURCE).not.toContain('transport === "online" ? (');
    expect(CONTROLS_SOURCE).not.toContain("connected ? (");
    // Every glyph comes from the one shared component, which reads the claim.
    expect(CONTROLS_SOURCE.match(/<HostedConnectionStatusIcon/gu)).toHaveLength(3);
  });
});

describe("§2.2 the presentation is a pure function of the claim", () => {
  it("ignores everything about the indicator except `guarantee` and reachability", () => {
    // A presentation that keyed on the label would be a second source of truth
    // for the property §2.2 forbids overstating, and the two would disagree the
    // first time a label was reworded.
    for (const text of HOSTED_CONNECTION_STATUS_TEXTS) {
      const real = HOSTED_CONNECTION_STATUS_INDICATORS[text];
      expect(hostedConnectionStatusPresentation(real), text).toEqual(
        hostedConnectionStatusPresentation(indicator(real.guarantee, real.connected, "Renamed")),
      );
    }
  });

  it("is decided by the claim alone wherever a claim exists", () => {
    // Connectedness may not move a claimed state's presentation: a `legacy`
    // channel is a usable session, and the whole defect was reading it as one.
    for (const guarantee of ["legacy", "web", "e2ee"] as const) {
      expect(hostedConnectionStatusPresentation(indicator(guarantee, true)), guarantee).toEqual(
        hostedConnectionStatusPresentation(indicator(guarantee, false)),
      );
    }
  });

  it("falls through to reachability only where there is no claim", () => {
    expect(hostedConnectionStatusPresentation(indicator("none", true)).glyph).toBe("connected");
    expect(hostedConnectionStatusPresentation(indicator("none", false)).glyph).toBe("disconnected");
    for (const guarantee of ["none"] as const) {
      expect(hostedConnectionStatusPresentation(indicator(guarantee, true)).claimRank).toBeNull();
    }
  });
});

describe("§2.2 no stronger claim for a weaker configuration", () => {
  it("ranks legacy strictly below the browser row, and that strictly below the native one", () => {
    const legacy = hostedConnectionStatusPresentation(indicator("legacy", true));
    const web = hostedConnectionStatusPresentation(indicator("web", true));
    const native = hostedConnectionStatusPresentation(indicator("e2ee", true));
    expect(legacy.claimRank).not.toBeNull();
    expect(legacy.claimRank!).toBeLessThan(web.claimRank!);
    expect(web.claimRank!).toBeLessThan(native.claimRank!);
  });

  it("never draws the browser row the way the native verified row is drawn", () => {
    // The claim this slice is forbidden to make, as an assertion: a Hub that
    // controls the served JavaScript can complete a genuine NX handshake and
    // display a genuine `WebSAS`, so §2.2's web row may not borrow the signed
    // tier's glyph or its colour (§2.4).
    const web = hostedConnectionStatusPresentation(indicator("web", true));
    const native = hostedConnectionStatusPresentation(indicator("e2ee", true));
    expect(web.glyph).not.toBe(native.glyph);
    expect(web.iconClassName).not.toBe(native.iconClassName);
  });

  it("never draws a claimed state the way an unclaimed connected one is drawn", () => {
    // `Online` — a usable session with no channel — is the success colour, and
    // §12.2's fallback and §2.2's web row must both be distinguishable from it.
    const plain = hostedConnectionStatusPresentation(indicator("none", true));
    for (const guarantee of ["legacy", "web"] as const) {
      const claimed = hostedConnectionStatusPresentation(indicator(guarantee, true));
      expect(claimed.glyph, guarantee).not.toBe(plain.glyph);
    }
  });

  it("gives every claim its own glyph and its own colour", () => {
    // Text and icon in every state, never colour alone — and never one glyph
    // standing in for two claims.
    const presentations = (["none", "legacy", "web", "e2ee"] as const).map((guarantee) =>
      hostedConnectionStatusPresentation(indicator(guarantee, true)),
    );
    expect(new Set(presentations.map((entry) => entry.glyph)).size).toBe(presentations.length);
    // Colours may repeat where the glyphs already separate the rows — the
    // disconnected amber and the legacy amber are both "something is wrong" —
    // but the three connected rows must not share one.
    const connectedTones = presentations
      .filter((entry) => entry.claimRank !== null)
      .map((entry) => entry.iconClassName);
    expect(new Set(connectedTones).size).toBe(connectedTones.length);
  });

  it("uses no hardcoded colour values", () => {
    for (const guarantee of ["none", "legacy", "web", "e2ee"] as const) {
      for (const connected of [true, false]) {
        const { iconClassName } = hostedConnectionStatusPresentation(
          indicator(guarantee, connected),
        );
        expect(iconClassName, guarantee).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
        expect(iconClassName, guarantee).not.toMatch(/\brgba?\(/u);
        expect(iconClassName, guarantee).not.toMatch(/\bdark:/u);
      }
    }
  });
});
