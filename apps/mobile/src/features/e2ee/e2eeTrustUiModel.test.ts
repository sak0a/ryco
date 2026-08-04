import {
  E2EE_SAFETY_NUMBER_DIGITS,
  E2EE_SAFETY_NUMBER_MIN_DISPLAYED_BITS,
} from "@ryco/shared/relayE2eeConstants";
import { e2eeKeyFingerprint, formatE2eeKeyFingerprint } from "@ryco/shared/relayE2eeKeys";
import { deriveE2eeSafetyNumber } from "@ryco/shared/relayE2eeVerificationDisplay";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// The trust store reaches SecureStore, the plain KV, and `react-native`'s
// `Platform`. None of that belongs in a model suite.
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0xd,
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-sqlite/kv-store", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

import type {
  MobileE2eeIdentityDisplay,
  MobileE2eeSessionState,
} from "../../hostedHub/e2eeSession";
import type { E2eeTrustClassification } from "../../platform/e2eeTrustModel";
import {
  createE2eeVerificationDraft,
  deriveE2eeSecurityView,
  deriveE2eeVerificationView,
  e2eeSafetyNumberGroups,
  isE2eeSafetyNumberDisplay,
  E2EE_IDENTITY_CHANGE_MESSAGE,
  E2EE_SAFETY_NUMBER_CAPTION,
  E2EE_TRUST_SITUATION_MESSAGES,
  E2EE_UNEXPECTED_NODE_MESSAGES,
  type E2eeVerificationDraft,
} from "./e2eeTrustUiModel";

const HUB = "https://hub.example.com";
const ACCOUNT = "acct_0123456789";

function bytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.byteLength; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

// The §16.1-style deterministic material the trust-store suite uses. TEST ONLY.
const NODE_PUBLIC_KEY = bytes("03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8");
const OTHER_NODE_PUBLIC_KEY = bytes(
  "5866666666666666666666666666666666666666666666666666666666666666",
);
const CLIENT_PUBLIC_KEY = bytes(
  "047a593180860c4037c83c12749845c8ee1424dd297fadcb895e358255d2c7d2" +
    "b2a8ca25580f2626fe579062ff1b99ff91c24a0da06fb32b5be20148c9249f5650",
);

function display(nodeKey: Uint8Array): MobileE2eeIdentityDisplay {
  return {
    fingerprint: formatE2eeKeyFingerprint(e2eeKeyFingerprint("node-identity", nodeKey)),
    safetyNumber: deriveE2eeSafetyNumber({
      nodeIdentityPublicKey: nodeKey,
      clientIdentityPublicKey: CLIENT_PUBLIC_KEY,
      hubOrigin: HUB,
      accountId: ACCOUNT,
    }).display,
  };
}

const PRESENTED = display(NODE_PUBLIC_KEY);
const PREVIOUS = display(OTHER_NODE_PUBLIC_KEY);

const UNEXPECTED_FRESH: E2eeTrustClassification = {
  class: "unexpected",
  clause: "i",
  record: "unpinned",
  scope: { kind: "fresh" },
};

function session(overrides: Partial<MobileE2eeSessionState> = {}): MobileE2eeSessionState {
  return {
    channel: "negotiating",
    selection: {
      hubOrigin: HUB,
      accountId: ACCOUNT,
      nodeId: "node_1",
      nodeLabel: "Studio",
      environmentId: "env_1",
      localNodeHandle: null,
      clientIdentityPublicKey: CLIENT_PUBLIC_KEY,
    },
    classification: UNEXPECTED_FRESH,
    legacyPermitted: true,
    markerSet: false,
    presented: {
      nodeIdentityPublicKey: NODE_PUBLIC_KEY,
      display: PRESENTED,
      continuityId: "continuity-1",
      policyGeneration: 4,
    },
    previouslyVerified: null,
    event: null,
    diagnostics: [],
    ...overrides,
  };
}

function verificationView(
  state: MobileE2eeSessionState,
  draft: E2eeVerificationDraft = createE2eeVerificationDraft(),
) {
  let held = draft;
  const view = deriveE2eeVerificationView({
    session: state,
    draft,
    onDraftChange: (next) => {
      held = next;
    },
    onCompleted: () => undefined,
    now: () => 1_000,
  });
  return { view, read: () => held };
}

function securityView(state: MobileE2eeSessionState, overrides: { unreadable?: boolean } = {}) {
  return deriveE2eeSecurityView({
    session: state,
    hostedModeAvailable: true,
    trustStateUnreadable: overrides.unreadable ?? false,
    onOpenVerification: () => undefined,
    now: () => 1_000,
  });
}

/**
 * Every string any §13 surface can render, so a claim cannot hide in a branch
 * the spot checks below did not visit.
 */
function everyRenderedString(): readonly string[] {
  const strings: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) for (const entry of value) collect(entry);
    else if (value !== null && typeof value === "object") {
      for (const entry of Object.values(value)) collect(entry);
    }
  };
  for (const channel of [
    "unavailable",
    "negotiating",
    "verified",
    "unverified",
    "legacy",
  ] as const) {
    for (const markerSet of [true, false, null]) {
      for (const legacyPermitted of [true, false]) {
        for (const event of [
          null,
          { kind: "identity-change" } as const,
          { kind: "unexpected-node", situation: 1, evidence: "none" } as const,
          { kind: "unexpected-node", situation: 2, evidence: "first-contact-statement" } as const,
          { kind: "unexpected-node", situation: 3, evidence: "first-contact-statement" } as const,
        ]) {
          const state = session({
            channel,
            markerSet,
            legacyPermitted,
            event,
            previouslyVerified: PREVIOUS,
          });
          collect(securityView(state, { unreadable: true }));
          collect(
            verificationView(state, {
              ...createE2eeVerificationDraft(),
              enteredFingerprint: PRESENTED.fingerprint,
              comparisonAcknowledged: true,
            }).view,
          );
          collect(verificationView(state).view);
        }
      }
    }
  }
  return strings;
}

/* -------------------------------------------------------------------------- */

describe("§13.4 safety number rendering", () => {
  it("renders 12 groups of 5 zero-padded digits, in derivation order", () => {
    const groups = e2eeSafetyNumberGroups(PRESENTED.safetyNumber);
    expect(groups.length).toBe(E2EE_SAFETY_NUMBER_DIGITS.groups);
    expect(groups.length).toBe(12);
    for (const group of groups) {
      expect(group.length).toBe(E2EE_SAFETY_NUMBER_DIGITS.digitsPerGroup);
      expect(group.length).toBe(5);
      expect(group).toMatch(/^\d{5}$/);
    }
    // Derivation order: re-joining reproduces the shared renderer's output
    // exactly, so no surface can reflow, sort, or reverse it.
    expect(groups.join(E2EE_SAFETY_NUMBER_DIGITS.separator)).toBe(PRESENTED.safetyNumber);
  });

  it("refuses anything that is not the exact §13.4 display format", () => {
    expect(isE2eeSafetyNumberDisplay(PRESENTED.safetyNumber)).toBe(true);
    for (const wrong of [
      "",
      "1234",
      PRESENTED.safetyNumber.replaceAll(" ", ""),
      `${PRESENTED.safetyNumber} 00000`,
      PRESENTED.safetyNumber.slice(0, -1),
      PRESENTED.safetyNumber.replace(/\d$/u, "x"),
    ]) {
      expect(isE2eeSafetyNumberDisplay(wrong), wrong).toBe(false);
      expect(e2eeSafetyNumberGroups(wrong)).toEqual([]);
    }
  });

  it("quotes its entropy floor from the constant rather than a stale sentence", () => {
    expect(E2EE_SAFETY_NUMBER_CAPTION).toContain(String(E2EE_SAFETY_NUMBER_DIGITS.groups));
    expect(E2EE_SAFETY_NUMBER_CAPTION).toContain(String(E2EE_SAFETY_NUMBER_MIN_DISPLAYED_BITS));
  });

  it("never lets a rendered string carry the number itself", () => {
    // §13.4: the value "never travels in any protocol message, log, or analytics
    // surface". The complement of that — it MAY be displayed — is exactly the
    // safety-number card, which receives the groups. No message, title, caption,
    // or error may embed it, or a copied diagnostic would carry it out.
    const number = PRESENTED.safetyNumber;
    const rendered = everyRenderedString().filter(
      (value) => value !== number && !number.split(" ").includes(value),
    );
    for (const value of rendered) {
      expect(value.includes(number), value).toBe(false);
    }
  });
});

describe("§13.2 first contact, enrollment-fingerprint first", () => {
  it("shows no safety number until the entered fingerprint matches the advertised one", () => {
    const { view } = verificationView(session());
    expect(view.stage).toBe("enrollment-fingerprint");
    expect(view.safetyNumberGroups).toEqual([]);
    // And no promotion is reachable from here at all.
    expect(view.confirm).toBeNull();
  });

  it("refuses a fingerprint that is not the one this channel advertised", () => {
    const { view } = verificationView(session(), {
      ...createE2eeVerificationDraft(),
      enteredFingerprint: PREVIOUS.fingerprint,
    });
    expect(view.stage).toBe("enrollment-fingerprint");
    expect(view.confirm).toBeNull();
  });

  it("advances to the comparison once it matches, ignoring whitespace only", () => {
    const { view } = verificationView(session(), {
      ...createE2eeVerificationDraft(),
      enteredFingerprint: `  ${PRESENTED.fingerprint}\n`,
    });
    expect(view.stage).toBe("compare");
    expect(view.safetyNumberGroups.length).toBe(12);
  });

  it("has no ceremony at all on a channel that advertised nothing (rows K23/K24)", () => {
    const { view } = verificationView(session({ presented: null }));
    expect(view.stage).toBe("no-evidence");
    expect(view.confirm).toBeNull();
    expect(view.safetyNumberGroups).toEqual([]);
  });
});

describe("the explicit user act (§13.2 step 5)", () => {
  it("offers no promotion until the owner says they compared the number", () => {
    const matched = {
      ...createE2eeVerificationDraft(),
      enteredFingerprint: PRESENTED.fingerprint,
    };
    // ABSENT, not disabled: there is no action object to fire by any route.
    expect(verificationView(session(), matched).view.confirm).toBeNull();
    expect(
      verificationView(session(), { ...matched, comparisonAcknowledged: true }).view.confirm,
    ).not.toBeNull();
  });

  it("keeps the acknowledgement a value the owner sets, never a default", () => {
    expect(createE2eeVerificationDraft().comparisonAcknowledged).toBe(false);
    const { view, read } = verificationView(session(), {
      ...createE2eeVerificationDraft(),
      enteredFingerprint: PRESENTED.fingerprint,
    });
    view.onAcknowledgeComparison(true);
    expect(read().comparisonAcknowledged).toBe(true);
  });
});

describe("§13.2.1 and §13.3: four situations, four messages", () => {
  it("gives all four distinct copy", () => {
    expect(new Set(E2EE_TRUST_SITUATION_MESSAGES).size).toBe(4);
    expect(E2EE_TRUST_SITUATION_MESSAGES).toContain(E2EE_IDENTITY_CHANGE_MESSAGE);
  });

  it("never words situation 3 as an identity change", () => {
    const situation3 = E2EE_UNEXPECTED_NODE_MESSAGES[3];
    // §13.2.1: "It MUST NOT be worded as an identity change" — nothing is being
    // contradicted, and the copy says so in as many words.
    expect(situation3).not.toContain("different identity");
    expect(situation3.toLowerCase()).not.toContain("identity changed");
    expect(situation3).toContain("contradicted");
    // §13.3's message is the one that reports a contradiction.
    expect(E2EE_IDENTITY_CHANGE_MESSAGE).toContain("different identity");
  });

  it("renders each situation's own message on the ceremony surface", () => {
    for (const situation of [1, 2, 3] as const) {
      const { view } = verificationView(
        session({ event: { kind: "unexpected-node", situation, evidence: "none" } }),
      );
      expect(view.message).toBe(E2EE_UNEXPECTED_NODE_MESSAGES[situation]);
    }
    const changed = verificationView(session({ event: { kind: "identity-change" } })).view;
    expect(changed.message).toBe(E2EE_IDENTITY_CHANGE_MESSAGE);
  });

  it("shows the previously verified pair beside the new one in situation 2, and only there", () => {
    const withPrevious = (situation: 1 | 2 | 3) =>
      verificationView(
        session({
          previouslyVerified: PREVIOUS,
          event: { kind: "unexpected-node", situation, evidence: "first-contact-statement" },
        }),
      ).view;
    const two = withPrevious(2);
    expect(two.previouslyVerified).toEqual(PREVIOUS);
    expect(two.presented).toEqual(PRESENTED);
    // Both halves are present BEFORE any pairing step: the stage is still the
    // fingerprint entry, and no promotion exists.
    expect(two.stage).toBe("enrollment-fingerprint");
    expect(two.confirm).toBeNull();
    // §13.2.1 situation 3: "no previously verified fingerprint is being
    // contradicted, so displaying one would be misleading."
    expect(withPrevious(3).previouslyVerified).toBeNull();
    expect(withPrevious(1).previouslyVerified).toBeNull();
  });
});

describe("§13.2.1: exactly two resolutions, neither of them a default", () => {
  it("offers pairing and the consent resolution where policy permits legacy", () => {
    const view = securityView(
      session({ event: { kind: "unexpected-node", situation: 1, evidence: "none" } }),
    );
    expect(view.resolutions.map((action) => action.id)).toEqual([
      "start-pairing",
      "record-legacy-consent",
    ]);
    // Neither is a default: both are actions the owner has to press, and the
    // destructive one carries its own confirmation.
    expect(view.resolutions[1]?.confirm).toBeDefined();
    expect(view.resolutions[1]?.destructive).toBe(true);
  });

  it("withholds the consent resolution where local policy forbids legacy", () => {
    const view = securityView(
      session({
        legacyPermitted: false,
        event: { kind: "unexpected-node", situation: 1, evidence: "none" },
      }),
    );
    // §12.1.1 / §13.2.1: "the consent resolution is unavailable, not defaulted".
    expect(view.resolutions.map((action) => action.id)).toEqual(["start-pairing"]);
  });

  it("never offers a latched pin the consent resolution", () => {
    const view = securityView(
      session({
        classification: { class: "latched" },
        legacyPermitted: true,
        event: { kind: "unexpected-node", situation: 1, evidence: "none" },
      }),
    );
    expect(view.resolutions.map((action) => action.id)).toEqual(["start-pairing"]);
  });

  it("offers no resolution at all where no surface was raised", () => {
    expect(securityView(session({ event: null })).resolutions).toEqual([]);
  });

  it("has no dismissal that could stand in for either resolution", () => {
    const view = securityView(
      session({ event: { kind: "unexpected-node", situation: 1, evidence: "none" } }),
    );
    const ids = Object.values(view).flatMap((value) =>
      Array.isArray(value)
        ? value.map((entry: { readonly id?: string }) => entry.id)
        : value !== null && typeof value === "object" && "id" in value
          ? [(value as { readonly id: string }).id]
          : [],
    );
    expect(ids).not.toContain("dismiss");
  });
});

describe("§13.1.1: the persistent unverified-Hub indication", () => {
  it("shows it whenever the marker is unset after reconciliation", () => {
    expect(securityView(session({ markerSet: false })).unverifiedHub).toBe(true);
  });

  it("shows it when the marker is unobtainable, and never reads that as verified", () => {
    // §4.4 forbids treating unobtainable as unset in a GUARD; for the owner-
    // visible fact the two are the same — this device can point at no verified
    // node on this Hub either way.
    expect(securityView(session({ markerSet: null })).unverifiedHub).toBe(true);
  });

  it("drops it only when the marker is genuinely set", () => {
    expect(securityView(session({ markerSet: true })).unverifiedHub).toBe(false);
  });

  it("offers no dismiss for it, in any state", () => {
    for (const markerSet of [true, false, null]) {
      const view = securityView(session({ markerSet }));
      expect("dismissUnverifiedHub" in view).toBe(false);
      expect(view.pair?.id).not.toBe("dismiss");
    }
  });

  it("keeps the §13.2 entry point beside it", () => {
    expect(securityView(session({ markerSet: false })).pair?.id).toBe("open-verification");
  });
});

describe("§13.1's release gate and §12.2's honest labelling", () => {
  it("claims nothing for an unverified pin, and names the ceremony as the whole channel", () => {
    const view = securityView(session({ channel: "unverified" }));
    expect(view.claim).toBe("pairing-only");
    expect(view.channelLabel).toBe("Not verified");
    expect(view.channelMessage.toLowerCase()).toContain("pairing ceremony and nothing else");
  });

  it("exposes no action that releases application payload from the ceremony surface", () => {
    // The UI half of the §13.1 release gate: with an `unverified` pin the app is
    // restricted to the ceremony, and the model's whole action vocabulary is
    // pairing, verifying, consenting, forgetting, and closing.
    const state = session({ channel: "unverified", event: { kind: "identity-change" } });
    const ids = [
      ...securityView(state).resolutions.map((action) => action.id),
      securityView(state).pair?.id,
      securityView(state).rePair?.id,
      verificationView(state).view.dismiss.id,
      verificationView(state, {
        ...createE2eeVerificationDraft(),
        enteredFingerprint: PRESENTED.fingerprint,
        comparisonAcknowledged: true,
      }).view.confirm?.id,
    ].filter((id) => id !== undefined);
    for (const id of ids) {
      expect([
        "start-pairing",
        "confirm-verification",
        "record-legacy-consent",
        "re-pair",
        "destroy-unreadable-trust-state",
        "open-verification",
        "dismiss",
      ]).toContain(id);
    }
  });

  it("labels a fallback channel legacy and makes no E2EE claim for it", () => {
    const view = securityView(session({ channel: "legacy" }));
    expect(view.claim).toBe("legacy");
    expect(view.channelLabel).toBe("Legacy");
    expect(view.channelMessage).toContain("legacy");
    expect(view.channelMessage.toLowerCase()).toContain("not encrypting");
  });

  it("makes the E2EE claim only for a verified channel", () => {
    const claims = (
      ["unavailable", "negotiating", "verified", "unverified", "legacy"] as const
    ).map((channel) => securityView(session({ channel })));
    for (const view of claims) {
      if (view.channelMessage.includes("encrypted end to end")) {
        expect(view.claim).toBe("verified");
      }
    }
    expect(securityView(session({ channel: "verified" })).claim).toBe("verified");
  });
});

describe("key loss (§13.1.1) and honest labelling (§2.2, §2.3, §12.2)", () => {
  it("claims no active-Hub guarantee anywhere while no node is verified", () => {
    for (const channel of ["unavailable", "negotiating", "legacy", "unverified"] as const) {
      const view = securityView(session({ channel, markerSet: false, previouslyVerified: null }));
      expect(view.claim).not.toBe("verified");
      expect(view.channelMessage).not.toContain("cannot read");
      expect(view.unverifiedHub).toBe(true);
    }
  });

  it("says the state does not survive reinstall, restore, or transfer", () => {
    // §2.3: "Disclosure text MUST NOT describe native downgrade resistance as
    // surviving reinstall, restore, or device transfer."
    const message = securityView(session({ markerSet: false })).unverifiedHubMessage;
    expect(message.toLowerCase()).toContain("reinstalling ryco");
    expect(message.toLowerCase()).toContain("restoring a backup");
    expect(message.toLowerCase()).toContain("new phone");
  });

  it("makes no claim any rendered string is forbidden to make", () => {
    const forbidden = [
      // §2.3's survival claim, in the shapes a copywriter reaches for.
      /surviv\w* (a )?(reinstall|restore|backup|transfer)/i,
      /stays? verified (across|after) (a )?(reinstall|restore|transfer)/i,
      // The unmeetable explanation §11.2 forbids.
      /(because|why)[^.]{0,40}(the node|your node) (rejected|refused|declined)/i,
      /(not approved|revoked|rate limited|clock is wrong)/i,
    ];
    for (const value of everyRenderedString()) {
      for (const pattern of forbidden) {
        expect(pattern.test(value), `"${value}" matched ${String(pattern)}`).toBe(false);
      }
      // §2.2: no stronger claim for a weaker configuration. The positive claim
      // and a weak label may never occupy the same string — a negative sentence
      // about a legacy channel ("Ryco is not encrypting it end to end") is
      // exactly what §12.2 asks for and is not caught here.
      if (/\bis encrypted end[- ]to[- ]end\b/i.test(value)) {
        expect(/legacy|not verified|unencrypted/i.test(value), value).toBe(false);
      }
    }
  });

  it("is honest that a pairing attempt's outcome is not reported to this app", () => {
    const { view } = verificationView(session());
    expect(view.outcomeMessage).toContain("not told why");
  });
});

describe("§11.4 diagnostics", () => {
  it("renders each sender-local diagnostic and says none of it left the device", () => {
    const view = securityView(
      session({
        diagnostics: [
          { id: "e2ee_message_too_large", row: "local" },
          { id: "e2ee_send_unavailable", row: "local" },
          { id: "e2ee_prekey_expired", row: "local" },
          { id: "e2ee_policy_generation_regressed", row: "local" },
        ],
      }),
    );
    expect(view.diagnostics.length).toBe(4);
    expect(new Set(view.diagnostics.map((row) => row.label)).size).toBe(4);
    expect(view.diagnosticsCaption).toContain("None of it is sent anywhere");
    // And none of them names a cause the node supplied — there is none.
    for (const row of view.diagnostics) {
      expect(row.label).not.toContain("node rejected");
    }
  });

  it("renders an unknown diagnostic id as the neutral line, never as the id", () => {
    const view = securityView(
      session({
        diagnostics: [{ id: "pre_key_local", row: "K23" }],
      }),
    );
    expect(view.diagnostics[0]?.label).not.toContain("K23");
  });
});

describe("the surface with no hosted plane", () => {
  it("renders nothing about E2EE at all", () => {
    const view = deriveE2eeSecurityView({
      session: session(),
      hostedModeAvailable: false,
      trustStateUnreadable: true,
      onOpenVerification: () => undefined,
      now: () => 0,
    });
    expect(view.available).toBe(false);
    expect(view.unverifiedHub).toBe(false);
    expect(view.pair).toBeNull();
    expect(view.resolutions).toEqual([]);
    expect(view.rePair).toBeNull();
    expect(view.destroyUnreadable).toBeNull();
  });
});

describe("§13.3's owner-initiated re-pair", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("is offered only for a selection this device already has a record for", () => {
    expect(securityView(session()).rePair).toBeNull();
    const withHandle = session({
      selection: { ...session().selection!, localNodeHandle: "handle-1" },
    });
    const action = securityView(withHandle).rePair;
    expect(action?.id).toBe("re-pair");
    expect(action?.destructive).toBe(true);
    expect(action?.confirm?.destructive).toBe(true);
  });
});
