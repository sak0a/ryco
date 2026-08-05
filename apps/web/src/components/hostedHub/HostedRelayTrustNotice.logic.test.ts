import { describe, expect, it } from "vite-plus/test";

import {
  HOSTED_E2EE_CHANNEL_STATUSES,
  type WebHostedE2eeChannelStatus,
} from "../../hostedHub/connectionStatus";
import { E2EE_WEB_SAS_ADVISORY, E2EE_WEB_SAS_CAPTION } from "./HostedE2eeVerification.logic";
import {
  hostedRelayTrustDisclosure,
  HOSTED_RELAY_TRUST_DISCLOSURE_STATES,
} from "./HostedRelayTrustNotice.logic";

/**
 * The prohibited-claims scan over every user-facing string this slice ships.
 *
 * Every sentence in these two modules is a security claim, and
 * `docs/relay-e2ee-protocol.md` bounds all of them. The scan is deliberately a
 * bare, case-insensitive substring match: it cannot tell a claim from its
 * negation, so the modules under test do not use the banned tokens in either
 * form. That direction is the safe one — a scan that tried to allow negations
 * would pass "this is end-to-end encrypted" the day someone deleted a "not".
 */

/** Every string a user can read, flattened. */
function everyDisclosure(): ReadonlyArray<{ readonly where: string; readonly text: string }> {
  return [
    ...HOSTED_RELAY_TRUST_DISCLOSURE_STATES.map((status) => ({
      where: `disclosure(${status})`,
      text: hostedRelayTrustDisclosure(status).body,
    })),
    { where: "webSasCaption", text: E2EE_WEB_SAS_CAPTION },
    { where: "webSasAdvisory", text: E2EE_WEB_SAS_ADVISORY },
  ];
}

/** The two channel states this tier is fenced out of (`connectionStatus.ts`). */
const NATIVE_ONLY_STATUSES = ["verified", "unverified"] as const;

describe("the hosted relay trust disclosure is a function of the channel state", () => {
  it("has copy for every channel state this tier can be in, and only those", () => {
    // Exhaustive over the SHARED enumeration, so a member added to
    // `HostedE2eeChannelStatus` fails here at runtime as well as at compile
    // time: `WebHostedE2eeChannelStatus` is `Exclude<…, "verified" |
    // "unverified">`, so a new member becomes a required key of the `Record`
    // backing `hostedRelayTrustDisclosure` in the same edit.
    const expected = HOSTED_E2EE_CHANNEL_STATUSES.filter(
      (status): status is WebHostedE2eeChannelStatus =>
        !(NATIVE_ONLY_STATUSES as ReadonlyArray<string>).includes(status),
    );
    expect([...HOSTED_RELAY_TRUST_DISCLOSURE_STATES].toSorted()).toEqual([...expected].toSorted());
    for (const status of expected) {
      expect(hostedRelayTrustDisclosure(status).body.length, status).toBeGreaterThan(0);
    }
  });

  it("says something different in every state", () => {
    // A selector that returned one string for every state would pass every
    // content assertion below while shipping exactly the defect this replaced.
    const bodies = HOSTED_RELAY_TRUST_DISCLOSURE_STATES.map(
      (status) => hostedRelayTrustDisclosure(status).body,
    );
    expect(new Set(bodies).size).toBe(bodies.length);
  });

  it("never retires into the sentence it replaced", () => {
    // §2.2: the retired constant asserts the opposite of what a locked NX
    // channel makes true, so no state may resurrect it — including the ones
    // where it happens to be accurate.
    for (const { where, text } of everyDisclosure()) {
      expect(text, where).not.toContain("not application-level end-to-end encrypted");
    }
  });
});

describe("prohibited claims", () => {
  it.each([
    // §2.2/§2.4: this tier may never spell the native row's claim, qualified or
    // not — the scan cannot judge qualification, so the phrase is absent.
    "end-to-end encrypted",
    // §13.5: "MUST NOT present the `WebSAS` as an operator-proof or
    // E2EE-verification guarantee". §2.2's `verified` row is native-only.
    "verified",
    // §13.5: "MUST NOT describe a match as proof that no interposer is
    // present" — and "operator-proof" carries the same token.
    "proof",
    "no interposer",
    // §2.6/§2.4: nothing here may be presented as unconditional.
    "cannot be intercepted",
    "unforgeable",
    "guaranteed",
  ])("never says %j", (phrase) => {
    for (const { where, text } of everyDisclosure()) {
      expect(text.toLowerCase(), `${where} says ${phrase}`).not.toContain(phrase);
    }
  });

  it("never describes the web latch as durable, cross-session, or Hub-resistant", () => {
    // §2.3: "It MUST NOT describe the web latch as durable, cross-session, or
    // Hub-resistant." §17.5: the web latch and the durable native latch "MUST
    // NOT be described in the same terms".
    for (const { where, text } of everyDisclosure()) {
      const lower = text.toLowerCase();
      for (const phrase of [
        "durable",
        "persists",
        "persistent",
        "remembers",
        "across sessions",
        "cross-session",
        "between sessions",
        "survives",
        "saved",
        "stored",
      ]) {
        expect(lower, `${where} says ${phrase}`).not.toContain(phrase);
      }
    }
  });
});

describe("§12.2 honest labeling of the fallback", () => {
  it("calls the fallen-back channel legacy and claims nothing about encryption", () => {
    const { body, tone } = hostedRelayTrustDisclosure("legacy");
    // "A client that falls back MUST label the channel **legacy** in every
    // user-facing surface and diagnostic and MUST NOT display any E2EE or
    // active-Hub confidentiality claim for it."
    expect(body.toLowerCase()).toContain("legacy");
    expect(body.toLowerCase()).toContain("plaintext");
    expect(body.toLowerCase()).not.toContain("encrypted channel to");
    expect(tone).toBe("caution");
  });

  it("does not blame the node for a fallback this client cannot attribute", () => {
    // §12.2 covers both "a missing or stripped advertisement" and one "the node
    // itself could not emit", and this client cannot tell them apart.
    const { body } = hostedRelayTrustDisclosure("legacy");
    expect(body.toLowerCase()).toContain("cannot tell");
  });
});

describe("§2.3 and §2.4 in the encrypted state", () => {
  const { body, tone } = hostedRelayTrustDisclosure("web-unsigned");

  it("states §2.4's served-code ceiling in its own terms", () => {
    const lower = body.toLowerCase();
    // "The Hub serves every byte of the web application's JavaScript. A
    // malicious Hub may serve code that completes the genuine node handshake,
    // displays the genuine session `WebSAS`, and separately exfiltrates
    // plaintext or traffic keys."
    expect(lower).toContain("cannot protect against the hub operator");
    expect(lower).toContain("every byte of this page's javascript");
    expect(lower).toContain("completes the same handshake");
    expect(lower).toContain("shows the same session code");
  });

  it("states §2.3's web bullet: in-memory only, empty again every session", () => {
    const lower = body.toLowerCase();
    expect(lower).toContain("in memory only");
    expect(lower).toContain("after every reload");
    expect(lower).toContain("worth nothing against that operator");
    // "Only node-enforced effective `requireE2EE` closes the plaintext path for
    // web."
    expect(lower).toContain("only your node can close the plaintext path");
  });

  it("is qualified about what the encryption is worth", () => {
    // §2.2's web row protects passive and retroactive read only "while the
    // served web code is honest", so the sentence carries the condition rather
    // than asserting the property.
    expect(body.toLowerCase()).toContain("while the code this page is running is honest");
  });

  it("never wears a success tone", () => {
    // §2.2: no stronger claim for a weaker configuration — including by colour.
    expect(tone).toBe("advisory");
    expect(hostedRelayTrustDisclosure("unavailable").tone).toBe("caution");
    expect(hostedRelayTrustDisclosure("negotiating").tone).toBe("caution");
  });
});

describe("the states with no channel", () => {
  it("makes no E2EE claim in either direction before a channel exists", () => {
    for (const status of ["unavailable", "negotiating"] as const) {
      const lower = hostedRelayTrustDisclosure(status).body.toLowerCase();
      expect(lower, status).toContain("hub");
      expect(lower, status).not.toContain("ciphertext");
      // `unavailable` is the sign-in and directory state: it must not read as a
      // downgrade report, which is the claim `legacy` alone is allowed to make.
      expect(lower, status).not.toContain("fell back");
    }
  });
});
