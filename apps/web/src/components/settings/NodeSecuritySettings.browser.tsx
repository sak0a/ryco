// The node security panel in LOCAL mode — the desktop app and a browser pointed
// at a node on this machine, which are the same bundle.
//
// The hosted half is `NodeSecuritySettingsHosted.browser.tsx`. Two files rather
// than one because `isHostedHubMode()` is read at module scope through a hoisted
// `vi.mock`, and a suite cannot hold both answers at once — the same reason
// `AccountSettings.browser.tsx` is a hosted-only file.
//
// What is pinned here is not markup. It is the things that would be a security
// defect rather than a cosmetic one:
//
//   * the §13.4 comparison number and the §13.5 session codes reach no storage,
//     no console, no DOM attribute, and no diagnostics export — extending the
//     coverage `HostedE2eeVerification.browser.tsx` already has over this tab's
//     own `WebSAS` to every value this panel draws;
//   * local mode raises no alarm about a relay that is not in the path, and
//     draws no channel panel for a channel that does not exist.
import "../../index.css";

import { page } from "vite-plus/test/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { E2EE_SAFETY_NUMBER_DIGITS, E2EE_WEB_SAS_CHARS } from "@ryco/shared/relayE2eeConstants";

import type {
  NodeE2eeClientListing,
  NodeE2eeContinuity,
  NodeE2eeFallback,
  NodeE2eePolicy,
  NodeE2eePrekey,
  NodeE2eeSessionList,
} from "@ryco/client-runtime/connection";

const calls: string[] = [];

/**
 * The node's sixteen operator routes, stubbed at the module the panel imports.
 *
 * Stubbed HERE rather than at `fetch`, because the assertion that matters in
 * hosted mode is that the panel never ASKS — the hosted HTTP boundary would
 * throw on the way out, and a `fetch`-level stub would hide the difference
 * between "asked and was refused" and "never asked".
 */
vi.mock("~/environments/primary", async (importOriginal) => ({
  // Spread the real module: this panel is not its only consumer, and replacing
  // the whole surface would strand every other importer in the graph.
  ...(await importOriginal<typeof import("~/environments/primary")>()),
  fetchHubEnrollment: vi.fn(async () => {
    calls.push("enrollment");
    return { fingerprint: "SHA256:ZZZZenrollmentZZZZ" };
  }),
  fetchNodeE2eeClients: vi.fn(async () => {
    calls.push("clients");
    return CLIENTS;
  }),
  fetchNodeE2eeSessions: vi.fn(async () => {
    calls.push("sessions");
    return SESSIONS;
  }),
  fetchNodeE2eePolicy: vi.fn(async () => {
    calls.push("policy");
    return POLICY;
  }),
  fetchNodeE2eePrekey: vi.fn(async () => {
    calls.push("prekey");
    return PREKEY;
  }),
  fetchNodeE2eeContinuity: vi.fn(async () => {
    calls.push("continuity");
    return CONTINUITY;
  }),
  fetchNodeE2eeFallback: vi.fn(async () => {
    calls.push("fallback");
    return FALLBACK;
  }),
  applyNodeE2eeAuthorization: vi.fn(async () => {
    calls.push("authorization");
    return { closedChannels: 0, abortedHandshakes: 0 };
  }),
  setNodeE2eePairingWindow: vi.fn(async () => {
    calls.push("pairing-window");
    return CLIENTS;
  }),
  clearNodeE2eeRefusals: vi.fn(async () => {
    calls.push("refusals");
    return CLIENTS;
  }),
  previewNodeE2eePolicy: vi.fn(async () => {
    calls.push("policy-preview");
    return { policy: POLICY, withdrawal: true, changed: true, counts: COUNTS };
  }),
  applyNodeE2eePolicy: vi.fn(async () => {
    calls.push("policy-apply");
    return { policy: POLICY, withdrawal: true, changed: true, counts: COUNTS };
  }),
  recoverNodeE2eePolicyGeneration: vi.fn(async () => {
    calls.push("policy-recover");
    return { policy: POLICY, withdrawal: false, changed: true, counts: COUNTS };
  }),
  rotateNodeE2eePrekey: vi.fn(async () => {
    calls.push("prekey-rotate");
    return PREKEY;
  }),
  applyNodeE2eeContinuity: vi.fn(async () => {
    calls.push("continuity-apply");
    return { outcome: "reminted" as const };
  }),
  resetNodeE2eeFallback: vi.fn(async () => {
    calls.push("fallback-reset");
    return FALLBACK;
  }),
}));

import { applyWebE2eeVerificationCode } from "../../../test/hostedConnectionVocabulary";
import { resetWebE2eeSession } from "../../hostedHub/e2eeSession";
import { isHostedHubMode } from "../../env";
import { buildDiagnosticsBundle, serializeDiagnosticsBundle } from "./DiagnosticsPanel.logic";
import { NodeSecuritySettings } from "./NodeSecuritySettings";

/** A well-formed §13.4 rendering, built from the constants rather than typed. */
const SAFETY_NUMBER = Array.from({ length: E2EE_SAFETY_NUMBER_DIGITS.groups }, (_unused, index) =>
  String(24_680 + index).padStart(E2EE_SAFETY_NUMBER_DIGITS.digitsPerGroup, "0"),
).join(E2EE_SAFETY_NUMBER_DIGITS.separator);

/** Two well-formed §13.5 renderings: one from a node session, one from this tab. */
const NODE_SESSION_CODE = ["7HJ2", "MQ5T"].join(E2EE_WEB_SAS_CHARS.separator);
const OWN_CHANNEL_CODE = ["3QRT", "9KZ0"].join(E2EE_WEB_SAS_CHARS.separator);

const FINGERPRINT = "SHA256:AAAAclientAAAAclientAAAAclientAAAAclientAA0";

const CLIENTS: NodeE2eeClientListing = {
  records: [
    {
      status: "pending",
      hubOrigin: "https://hub.example.test",
      accountId: "acct_reader",
      fingerprint: FINGERPRINT,
      maxRole: "",
      capabilitySet: [],
      createdAt: 1_700_000_000_000,
      safetyNumber: SAFETY_NUMBER,
      pairingReserved: false,
    },
  ],
  pendingGlobalSaturated: false,
  saturatedAccounts: [],
  refusedPairingAttempts: 2,
};

const SESSIONS: NodeE2eeSessionList = {
  sessions: [
    {
      sessionIndex: 0,
      tier: "web",
      suite: 1,
      establishedAt: 1_700_000_000_000,
      verificationCode: NODE_SESSION_CODE,
    },
    { sessionIndex: 1, tier: "native", suite: 1, establishedAt: 1_700_000_000_000 },
  ],
};

const POLICY: NodeE2eePolicy = {
  requireE2EE: false,
  requireApprovedClientE2EE: false,
  effectiveRequireE2EE: false,
  admittedPatterns: ["IK", "NX"],
  suiteRegistry: [1],
  generation: 3,
};

const COUNTS = { legacy: 1, nxE2ee: 2, suiteWithdrawn: 0, abortedHandshakes: 0 };

const PREKEY: NodeE2eePrekey = {
  present: true,
  prekeyId: "prekey-1",
  fingerprint: "SHA256:BBBBprekeyBBBBprekeyBBBBprekeyBBBBprekeyBB0",
  createdAt: 1_700_000_000_000,
  expiresAt: 1_800_000_000_000,
  validity: "usable",
};

const CONTINUITY: NodeE2eeContinuity = {
  status: "advertisable",
  continuityId: "lineage-1",
  generation: 5,
  chainLength: 2,
};

const FALLBACK: NodeE2eeFallback = {
  windowStartedAt: 1_700_000_000_000,
  peerLegacy: { occurrences: 1, ringOverflows: 0, lastOccurrenceAt: 1_700_000_100_000 },
  advertisementUnavailable: { occurrences: 0, ringOverflows: 0 },
  ring: [{ occurredAt: 1_700_000_100_000, reason: "peer-legacy" }],
};

let mounted: Awaited<ReturnType<typeof render>> | null = null;

beforeEach(() => {
  calls.length = 0;
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  resetWebE2eeSession();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const safetyNumber = () =>
  document.querySelector<HTMLElement>('[data-testid="node-safety-number"]');

describe("local mode: the node's operator state, and no alarm about a relay that is not there", () => {
  it("draws the node's data without a channel panel or a downgrade warning", async () => {
    // The harness has no `.env`, so `isHostedHubMode()` answers false — this is
    // genuinely the local build's behaviour and not a stub of it.
    expect(isHostedHubMode()).toBe(false);
    mounted = await render(<NodeSecuritySettings />);

    await expect.element(page.getByText(SAFETY_NUMBER)).toBeVisible();
    // Panel 6 is ABSENT: there is no relay in local mode, so there is no channel
    // to describe — and no "unavailable" badge inviting a reader to treat the
    // absence of relay encryption as a finding.
    expect(document.querySelector('[data-testid="node-connection-claim"]')).toBeNull();
    const body = document.body.textContent ?? "";
    for (const phrase of ["Not encrypted", "not encrypted", "Insecure", "Unencrypted"]) {
      expect(body, phrase).not.toContain(phrase);
    }
  });

  it("shows the §13.4 number with its caption and advisory, never behind a disclosure", async () => {
    mounted = await render(<NodeSecuritySettings />);
    await expect.element(page.getByText(SAFETY_NUMBER)).toBeVisible();

    const section = safetyNumber()!;
    expect(section.getAttribute("data-value")).toBe("present");
    // The duty is on the text accompanying the value, and text a reader has to
    // open is text most readers never see.
    expect(section.querySelector("details")).toBeNull();
    expect(section.querySelector("[hidden]")).toBeNull();
    expect(section.textContent).toContain("Compare this with the number the device itself shows");
    // Monospace: the comparison is digit by digit, which a proportional face
    // makes impossible.
    const value = section.querySelector<HTMLElement>('[data-testid="node-safety-number-value"]')!;
    expect(getComputedStyle(value).fontFamily.toLowerCase()).toMatch(/mono/u);
  });

  it("renders a node web session's §13.5 code through the shipped inseparable value", async () => {
    mounted = await render(<NodeSecuritySettings />);
    await expect.element(page.getByText(NODE_SESSION_CODE)).toBeVisible();
    // The advisory travels with the characters, from `hostedE2eeVerificationView`.
    expect(document.body.textContent).toContain("cannot protect against the Hub operator");
    // …and a native session gets the pointer at the long-term value instead of a
    // blank that reads as a missing code.
    expect(document.body.textContent).toContain("Native sessions have no per-session code");
  });
});

describe("§13.4 and §13.5 are never written down", () => {
  it("reaches no storage, no console, and no diagnostics export while the panel is up", async () => {
    // The handshake suite spies the publish path and
    // `HostedE2eeVerification.browser.tsx` spies the WebSAS render path. This
    // one spies THIS panel, which draws four kinds of value the others never
    // see: the §13.4 comparison number, a node session's §13.5 code, this tab's
    // own §13.5 code, and the node's enrollment fingerprint.
    localStorage.clear();
    sessionStorage.clear();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const clearStorage = vi.spyOn(Storage.prototype, "clear");
    const openDatabase = vi.spyOn(IDBFactory.prototype, "open");
    const sinks = (["debug", "error", "info", "log", "trace", "warn"] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => undefined),
    );

    applyWebE2eeVerificationCode(OWN_CHANNEL_CODE);
    mounted = await render(<NodeSecuritySettings />);
    await expect.element(page.getByText(SAFETY_NUMBER)).toBeVisible();
    await expect.element(page.getByText(NODE_SESSION_CODE)).toBeVisible();

    const secrets = [SAFETY_NUMBER, NODE_SESSION_CODE, OWN_CHANNEL_CODE, FINGERPRINT];

    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(clearStorage).not.toHaveBeenCalled();
    expect(openDatabase).not.toHaveBeenCalled();
    for (const sink of sinks) {
      for (const call of sink.mock.calls) {
        const serialized = call
          .map((argument) => `${String(argument)} ${safeJson(argument)}`)
          .join(" ");
        for (const secret of secrets) expect(serialized).not.toContain(secret);
      }
    }

    // Read back directly too, so a write that bypassed the prototype spies is
    // still caught.
    for (const store of [localStorage, sessionStorage]) {
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index)!;
        for (const secret of secrets) {
          expect(`${key} ${store.getItem(key) ?? ""}`).not.toContain(secret);
        }
      }
    }
    for (const secret of secrets) expect(document.cookie).not.toContain(secret);

    // The operator debug bundle is an allowlist, and none of these are on it.
    const bundle = serializeDiagnosticsBundle(
      buildDiagnosticsBundle({
        generatedAt: new Date(0).toISOString(),
        app: { version: "0.0.0", stage: "test", isElectron: false, userAgent: navigator.userAgent },
        environments: [],
        providers: [],
        observability: null,
        performance: null,
      }),
    );
    for (const secret of secrets) expect(bundle).not.toContain(secret);
  });

  it("puts no displayed value into a DOM attribute a browser could restore", async () => {
    // A `title`, a `value`, or a `data-` payload survives where the text does
    // not: form values are restored on reload and attributes are copied by
    // accessibility tooling.
    mounted = await render(<NodeSecuritySettings />);
    await expect.element(page.getByText(SAFETY_NUMBER)).toBeVisible();

    for (const element of document.querySelectorAll("*")) {
      for (const attribute of element.attributes) {
        for (const secret of [SAFETY_NUMBER, NODE_SESSION_CODE]) {
          expect(
            `${attribute.name}=${attribute.value}`,
            `${element.tagName} ${attribute.name}`,
          ).not.toContain(secret);
        }
      }
    }
  });
});

/** One argument flattened as far as it goes, for a string scan. */
function safeJson(argument: unknown): string {
  try {
    return JSON.stringify(argument) ?? "";
  } catch {
    return "";
  }
}
