// The node security panel in HOSTED mode — the Hub-served PWA.
//
// THE FILE EXISTS BECAUSE THE MODE IS READ AT MODULE SCOPE. `isHostedHubMode()`
// answers a build-time flag and the panel reads it on render, so a suite cannot
// hold both answers at once; the hoisted `vi.mock` below is the only way to get
// the hosted answer, and it applies to the whole file. `AccountSettings.
// browser.tsx` is a hosted-only file for the same reason.
//
// What is pinned here:
//
//   * `requireApprovedClientE2EE` cannot be applied from a browser the Hub
//     serves — the control is rendered, inert, and carries the reason and the
//     node command, and nothing in the panel can start that change;
//   * a hosted browser never reaches for the node's operator routes at all,
//     because the relay carries `ryco.rpc` and there is no HTTP tunnel;
//   * the channel panel exists here (it does not in local mode) and makes only
//     the claim the shared derivation allows this tier.
import "../../index.css";

import { page } from "vite-plus/test/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { E2EE_WEB_SAS_CHARS } from "@ryco/shared/relayE2eeConstants";

// Hosted mode, which no browser test gets by default: there is no `.env` in this
// harness, so `isHostedHubMode()` answers false and every hosted gate runs as
// the standard client.
vi.mock("../../env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../env")>()),
  readRycoClientMode: () => "hosted-hub" as const,
  isHostedHubMode: () => true,
}));

const calls: string[] = [];

/**
 * The node's operator routes, counted rather than answered.
 *
 * Counted at the module the panel imports rather than at `fetch`, because the
 * property under test is that the panel never ASKS. The hosted HTTP boundary in
 * `environments/primary/target.ts` throws on the way out, so a `fetch`-level
 * stub could not tell "asked and was refused" from "never asked" — and only the
 * second is what this panel is supposed to do.
 */
vi.mock("~/environments/primary", async (importOriginal) => {
  const record = (name: string) =>
    vi.fn(async () => {
      calls.push(name);
      throw new Error("Node HTTP routes are unavailable in hosted Hub mode.");
    });
  return {
    ...(await importOriginal<typeof import("~/environments/primary")>()),
    fetchHubEnrollment: record("enrollment"),
    fetchNodeE2eeClients: record("clients"),
    fetchNodeE2eeSessions: record("sessions"),
    fetchNodeE2eePolicy: record("policy"),
    fetchNodeE2eePrekey: record("prekey"),
    fetchNodeE2eeContinuity: record("continuity"),
    fetchNodeE2eeFallback: record("fallback"),
    applyNodeE2eeAuthorization: record("authorization"),
    createNodeE2eeClientApprovalQr: record("approval-qr"),
    setNodeE2eePairingWindow: record("pairing-window"),
    clearNodeE2eeRefusals: record("refusals"),
    previewNodeE2eePolicy: record("policy-preview"),
    applyNodeE2eePolicy: record("policy-apply"),
    recoverNodeE2eePolicyGeneration: record("policy-recover"),
    rotateNodeE2eePrekey: record("prekey-rotate"),
    applyNodeE2eeContinuity: record("continuity-apply"),
    resetNodeE2eeFallback: record("fallback-reset"),
  };
});

import { applyWebE2eeVerificationCode } from "../../../test/hostedConnectionVocabulary";
import { resetWebE2eeSession } from "../../hostedHub/e2eeSession";
import { isHostedHubMode } from "../../env";
import {
  deriveHostedConnectionStatusIndicator,
  HOSTED_CONNECTION_STATUS_INDICATORS,
} from "../../hostedHub/connectionStatus";
import { useHostedHubStore } from "../../hostedHub/state";
import { webE2eeSessionState } from "../../hostedHub/e2eeSession";
import {
  E2EE_WEB_SAS_COMPARE,
  E2EE_WEB_SAS_DETAIL,
  E2EE_WEB_SAS_MORE,
} from "../hostedHub/HostedE2eeVerification.logic";
import { NodeSecuritySettings } from "./NodeSecuritySettings";
import {
  nodeConnectionStatement,
  nodeE2eeStrictPolicyDisposition,
} from "./NodeSecuritySettings.logic";

const OWN_CHANNEL_CODE = ["3QRT", "9KZ0"].join(E2EE_WEB_SAS_CHARS.separator);

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

const strictControl = () =>
  document.querySelector<HTMLElement>('[data-testid="require-approved-client-e2ee"]');

describe("the requireApprovedClientE2EE lockout is blocked outright in hosted mode", () => {
  it("renders the control disabled, says why, and names the node command", async () => {
    expect(isHostedHubMode()).toBe(true);
    mounted = await render(<NodeSecuritySettings />);

    const control = await vi.waitFor(() => {
      const found = strictControl();
      expect(found, "the control is absent rather than disabled").not.toBeNull();
      return found!;
    });
    // Present, and inert BECAUSE the disposition blocked it — not because the
    // panel happened to be loading. `data-blocked` is written only from
    // `disposition.kind === "blocked"`, so this fails if the guard is removed
    // even while some other condition still greys the row out. An absent row
    // would leave an operator hunting for a setting they were told exists.
    expect(control.getAttribute("data-blocked")).toBe("hosted");
    // There is no switch to press, and nothing draws a position: hosted mode
    // never reads the node's policy, so an off switch here asserted
    // `requireApprovedClientE2EE: false` about a value this section had just
    // said it cannot see.
    expect(control.getAttribute("data-policy")).toBe("unknown");
    expect(control.getAttribute("role")).not.toBe("switch");
    expect(control.querySelector('[role="switch"]')).toBeNull();
    // The row is also a SINGLE row. Two of them was the earlier defect: the
    // hosted branch drew its own hardcoded `disabled`, so deleting the guard
    // from the shared one changed nothing here.
    expect(document.querySelectorAll('[data-testid="require-approved-client-e2ee"]')).toHaveLength(
      1,
    );
    // Pressing it does nothing, which is the property the attributes stand in
    // for.
    control.click();
    expect(calls).not.toContain("policy-preview");

    const disposition = nodeE2eeStrictPolicyDisposition("hosted");
    if (disposition.kind !== "blocked") throw new Error("unreachable");
    const body = document.body.textContent ?? "";
    expect(body).toContain(disposition.reason);
    // A refusal with no route out is a dead end: §12.4's policy is a legitimate
    // thing to want, so the copy says where it can be done.
    expect(body).toContain("ryco e2ee policy set --require-approved-client-e2ee");
  });

  it("offers no confirmation that could reach the change", async () => {
    mounted = await render(<NodeSecuritySettings />);
    await expect.element(page.getByTestId("require-approved-client-e2ee")).toBeVisible();

    // A typed confirmation is NOT sufficient and is not offered: the end state
    // would be the same lockout. Nothing in the panel starts the preview, and
    // nothing starts the apply.
    expect(calls).not.toContain("policy-preview");
    expect(calls).not.toContain("policy-apply");
  });

  it("never reaches for the node's operator routes at all", async () => {
    mounted = await render(<NodeSecuritySettings />);
    await expect.element(page.getByTestId("require-approved-client-e2ee")).toBeVisible();

    // The relay carries `ryco.rpc` and there is no HTTP tunnel, so these routes
    // are unreachable — and the panel says where the data lives rather than
    // spinning on requests that can never be answered.
    expect(calls).toEqual([]);
    expect(document.body.textContent).toContain("Open Ryco on that machine");
  });
});

describe("this tab's own channel", () => {
  it("is drawn here, with the claim the shared derivation allows and its advisory", async () => {
    applyWebE2eeVerificationCode(OWN_CHANNEL_CODE);
    mounted = await render(<NodeSecuritySettings />);

    const claim = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-testid="node-connection-claim"]');
      expect(found, "the hosted channel panel is missing").not.toBeNull();
      return found!;
    });
    // THE CHIP IS TIED TO THE DERIVATION, not checked against one forbidden
    // word. `not.toBe("Encrypted")` was a one-string denylist against a chip
    // that reads "Idle" in this state: replacing `{indicator.shortLabel}` with
    // the literal `"Protected"` — a claim this tier has not earned — left both
    // suites green.
    const state = useHostedHubStore.getState();
    const expected = deriveHostedConnectionStatusIndicator({
      browserStatus: state.browserStatus,
      sessionStatus: state.sessionStatus,
      selectionStatus: state.selectionStatus,
      transportStatus: state.transportStatus,
      e2eeStatus: webE2eeSessionState().status,
    });
    expect(claim.textContent?.trim()).toBe(expected.shortLabel);
    // …and whatever it turned out to be is a member of the shared bounded
    // vocabulary, and not §2.2's bottom row, which this tier cannot reach.
    const vocabulary = Object.values(HOSTED_CONNECTION_STATUS_INDICATORS).map(
      (entry) => entry.shortLabel,
    );
    expect(vocabulary).toContain(claim.textContent?.trim());
    expect(expected.guarantee).not.toBe("e2ee");

    const body = document.body.textContent ?? "";
    expect(body).toContain(OWN_CHANNEL_CODE);
    // §13.5's advisory travels with the characters, from the shipped
    // inseparable value — SCOPED TO THE VALUE'S OWN CONTAINER, because the
    // `web-unsigned` trust disclosure rendered above it contains the same
    // sentence: deleting `<p>{view.advisory}</p>` outright left this green while
    // this tab's WebSAS was drawn as bare characters.
    const code = document.querySelector<HTMLElement>('[data-testid="node-session-code"]')!;
    expect(code.textContent).toContain(OWN_CHANNEL_CODE);
    expect(code.textContent).toContain("cannot protect against the Hub operator");
    // THIS PAGE IS WHERE THE POINTER LEADS, SO IT DRAWS THE LONG FORM. The node
    // menu shows one line and says "Settings → Security explains what else this
    // tab cannot check"; if this panel drew that same short line, the pointer
    // would be circular and §2.2's second reason — this tab pins no node
    // identity — would be stated nowhere an owner was sent to read it.
    expect(code.textContent).toContain(E2EE_WEB_SAS_DETAIL);
    expect(code.textContent).toContain(E2EE_WEB_SAS_COMPARE);
    expect(body).not.toContain(E2EE_WEB_SAS_MORE);
    // §2.4: nothing on this page may claim the native row for a bundle the Hub
    // served.
    expect(body.toLowerCase()).not.toContain("end-to-end encrypted");
  });

  it("does not tell a Hub-served reader that nothing leaves this machine", async () => {
    // The hosted statement had no live assertion: its only check was that the
    // body contained "hub", which the LOCAL body also satisfies ("No Ryco Hub
    // sits between them"). Returning the local statement for hosted left all
    // node and browser tests green while a Hub-served panel rendered §2.4's
    // forbidden conclusion.
    mounted = await render(<NodeSecuritySettings />);
    await expect.element(page.getByTestId("require-approved-client-e2ee")).toBeVisible();

    const body = document.body.textContent ?? "";
    expect(body).toContain(nodeConnectionStatement("hosted", null).body);
    expect(body).not.toContain("No Ryco Hub sits between them");
    expect(body).not.toContain("nothing you send leaves this machine");
    // §2.3's web bullet denies the peer's identity, so the sentence does not
    // name it as the reader's own node.
    expect(body).not.toContain("This browser reaches your node");
  });

  it("carries the shipped trust disclosure with its tone, not a re-derived copy", async () => {
    // The panel re-derived `hostedRelayTrustDisclosure` and rendered only
    // `.body`, so §12.2's legacy-fallback disclosure drew in the same muted grey
    // as the advisory one — the single presentational signal separating "the Hub
    // can read this" from "the Hub relays ciphertext", gone at the panel about
    // security.
    mounted = await render(<NodeSecuritySettings />);
    const notice = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>("[data-hosted-relay-trust-notice]");
      expect(found, "the shipped disclosure component is not mounted").not.toBeNull();
      return found!;
    });
    expect(notice.getAttribute("data-e2ee-status")).not.toBeNull();
    expect(notice.getAttribute("data-tone")).not.toBeNull();
  });
});
