// Production CSS is part of the behavior under test: the comparison in
// docs/relay-e2ee-protocol.md §13.5 is character by character, so the face, the
// tracking, and whether the string wraps are the feature rather than styling.
import "../../index.css";

import { E2EE_WEB_SAS_CHARS } from "@ryco/shared/relayE2eeConstants";
import { page } from "vite-plus/test/browser";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import {
  applyWebE2eeChannelStatus,
  applyWebE2eeVerificationCode,
} from "../../../test/hostedConnectionVocabulary";
import {
  beginWebE2eeChannelAttempt,
  publishWebE2eeVerificationCode,
  resetWebE2eeSession,
  webE2eeSessionState,
} from "../../hostedHub/e2eeSession";
import { useWebE2eeChannelStatus } from "../../hostedHub/useWebE2eeSession";
import {
  buildDiagnosticsBundle,
  serializeDiagnosticsBundle,
} from "../settings/DiagnosticsPanel.logic";
import {
  E2EE_WEB_SAS_ADVISORY,
  E2EE_WEB_SAS_DETAIL,
  E2EE_WEB_SAS_MORE,
  E2EE_WEB_SAS_UNAVAILABLE,
} from "./HostedE2eeVerification.logic";
import { HostedE2eeVerification } from "./HostedE2eeVerification";

/** Two well-formed §13.5 renderings, built from the constants rather than typed. */
const FIRST_CODE = ["3QRT", "9KZ0"].join(E2EE_WEB_SAS_CHARS.separator);
const SECOND_CODE = ["W1XE", "BF7H"].join(E2EE_WEB_SAS_CHARS.separator);

let mounted: Awaited<ReturnType<typeof render>> | null = null;

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  resetWebE2eeSession();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const section = () =>
  document.querySelector<HTMLElement>('[data-testid="hosted-e2ee-verification"]');
const codeElement = () =>
  document.querySelector<HTMLElement>('[data-testid="hosted-e2ee-verification-code"]');

/**
 * A sibling that draws the live §4.4 projection, so a DISAPPEARANCE can be
 * asserted without polling for it.
 *
 * `await vi.waitFor(() => expect(section()).toBeNull())` against a DOM that is
 * already empty resolves on its first synchronous attempt — before React has
 * re-rendered anything — so it passes whether or not the surface's lock gate
 * exists. Mounted in the same tree, this probe changes in the SAME commit the
 * gate acts in: waiting for the probe to report the new state and then reading
 * the section synchronously observes exactly the render the gate decided.
 */
function ChannelStatusProbe() {
  return <span data-testid="channel-status-probe">{useWebE2eeChannelStatus()}</span>;
}

/** Wait for the probe to report `status`, then hand back that same commit. */
async function settledAt(status: string): Promise<void> {
  await vi.waitFor(() => {
    expect(
      document.querySelector<HTMLElement>('[data-testid="channel-status-probe"]')?.textContent,
    ).toBe(status);
  });
}

describe("§13.5 the WebSAS is legible enough to compare", () => {
  it.each([
    [320, 568, "the narrowest phone"],
    [1_280, 720, "desktop"],
  ])("renders the code monospace and unbroken at %ix%i (%s)", async (width, height) => {
    await page.viewport(width, height);
    applyWebE2eeVerificationCode(FIRST_CODE);
    // A container narrower than the desktop popover it actually lands in, so
    // the measurement is taken where the space is tightest.
    mounted = await render(
      <div style={{ width: "260px" }}>
        <HostedE2eeVerification />
      </div>,
    );

    const element = await vi.waitFor(() => {
      const found = codeElement();
      expect(found, "the code did not render").not.toBeNull();
      return found!;
    });
    expect(element.textContent).toBe(FIRST_CODE);

    const style = getComputedStyle(element);
    // Monospace: every character is the same advance, which is what makes a
    // position-by-position comparison possible at all.
    expect(style.fontFamily.toLowerCase()).toMatch(/mono/u);
    expect(style.whiteSpace).toBe("nowrap");
    // …and it is genuinely on one line: one client rect, and no horizontal
    // overflow of its own box or of the page.
    expect(element.getClientRects()).toHaveLength(1);
    expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    // Nothing is clipped away: the separator and both groups are present.
    expect(element.textContent).toContain(E2EE_WEB_SAS_CHARS.separator);
    expect(element.textContent!.replaceAll(E2EE_WEB_SAS_CHARS.separator, "")).toHaveLength(
      E2EE_WEB_SAS_CHARS.chars,
    );
  });

  it("shows §13.5's advisory in the same view, never behind a disclosure", async () => {
    await page.viewport(320, 568);
    applyWebE2eeVerificationCode(FIRST_CODE);
    mounted = await render(<HostedE2eeVerification />);

    await expect.element(page.getByText(FIRST_CODE)).toBeVisible();
    // The duty is on "the web UI text accompanying the `WebSAS`", and text a
    // reader has to open is text most readers never see.
    await expect.element(page.getByText(E2EE_WEB_SAS_ADVISORY)).toBeVisible();
    // …and the pointer at the long account travels with it, so the short form is
    // never presented as the whole of what an owner can know.
    await expect.element(page.getByText(E2EE_WEB_SAS_MORE)).toBeVisible();
    // Structurally, not just visually: nothing between the code and either
    // sentence is a collapsible or a hidden container.
    expect(section()!.querySelector("details")).toBeNull();
    expect(section()!.querySelector("[hidden]")).toBeNull();
    for (const text of [E2EE_WEB_SAS_ADVISORY, E2EE_WEB_SAS_MORE]) {
      const node = [...section()!.querySelectorAll<HTMLElement>("p")].find((paragraph) =>
        paragraph.textContent?.includes(text),
      );
      expect(node, "the sentence is not in the same section as the code").not.toBeUndefined();
      const box = node!.getBoundingClientRect();
      expect(box.width, "the sentence has no box").toBeGreaterThan(0);
      expect(box.height, "the sentence has no box").toBeGreaterThan(0);
    }
  });

  it("draws the short form here and leaves the long account to Settings", async () => {
    // The owner is mid-comparison on this surface: it gets the one line §13.5
    // requires plus the pointer, and nothing else. The long form is the same
    // duty at the length the Settings page has room for — drawing it here would
    // restore the block of prose this shape exists to remove, and it would still
    // pass every §13.5 assertion above.
    await page.viewport(320, 568);
    applyWebE2eeVerificationCode(FIRST_CODE);
    mounted = await render(<HostedE2eeVerification />);
    await expect.element(page.getByText(FIRST_CODE)).toBeVisible();

    expect(document.body.textContent).not.toContain(E2EE_WEB_SAS_DETAIL);
    // Two sentences under the code, and no third: the whole accompanying text of
    // this surface is the advisory and the pointer.
    const paragraphs = [...section()!.querySelectorAll<HTMLElement>("p")].map(
      (paragraph) => paragraph.textContent ?? "",
    );
    expect(paragraphs).toEqual([
      "Session code",
      FIRST_CODE,
      E2EE_WEB_SAS_ADVISORY,
      E2EE_WEB_SAS_MORE,
    ]);
  });
});

describe("§13.5 the code belongs to one session", () => {
  it("changes when the session changes and disappears when the channel does", async () => {
    // "making the string **session-bound**: it changes on every channel."
    applyWebE2eeVerificationCode(FIRST_CODE);
    mounted = await render(<HostedE2eeVerification />);
    await expect.element(page.getByText(FIRST_CODE)).toBeVisible();

    applyWebE2eeVerificationCode(SECOND_CODE);
    await vi.waitFor(() => {
      expect(codeElement()!.textContent).toBe(SECOND_CODE);
    });
    expect(document.body.textContent).not.toContain(FIRST_CODE);

    // A channel that ends takes the code with it, so a standing string can
    // never describe a session that is over.
    resetWebE2eeSession();
    await vi.waitFor(() => {
      expect(section()).toBeNull();
    });
  });

  it("stops drawing the code the moment the channel is no longer locked", async () => {
    // The §4.4 machine publishes §13.5's code from INSIDE its own `e2ee` lock,
    // so the projection is still `negotiating` at that instant. Drawing then
    // would show a comparison value for a channel this surface cannot yet say
    // is encrypted — and this gate is the only thing that stops it.
    //
    // DRIVEN FROM A DRAWN SECTION TOWARDS AN EMPTY ONE, because that is the
    // direction in which the gate changes the DOM. Started from an empty one,
    // every assertion below holds before React renders at all, and deleting the
    // gate costs nothing.
    applyWebE2eeVerificationCode(FIRST_CODE);
    mounted = await render(
      <>
        <ChannelStatusProbe />
        <HostedE2eeVerification />
      </>,
    );
    await settledAt("web-unsigned");
    expect(codeElement()!.textContent).toBe(FIRST_CODE);

    // A fresh channel begins and publishes its code from inside the lock, in the
    // order `resolveWebRelayE2eeProvider` drives: status `negotiating`, code
    // held. The projection IS holding it, so the absence is the surface's
    // decision and not a missing value.
    beginWebE2eeChannelAttempt();
    publishWebE2eeVerificationCode(SECOND_CODE);
    expect(webE2eeSessionState()).toEqual({
      status: "negotiating",
      verificationCode: SECOND_CODE,
    });
    await settledAt("negotiating");
    expect(section(), "the code is drawn for a channel that has not locked").toBeNull();
    expect(document.body.textContent).not.toContain(SECOND_CODE);

    // …and a fallen-back channel never shows one either: §12.2 forbids any E2EE
    // claim for it, and there is no channel to compare against.
    applyWebE2eeVerificationCode(FIRST_CODE);
    await settledAt("web-unsigned");
    expect(section()).not.toBeNull();
    applyWebE2eeChannelStatus("legacy");
    await settledAt("legacy");
    expect(section(), "the code survived a §12.2 fallback").toBeNull();
    expect(webE2eeSessionState().verificationCode).toBeNull();
  });
});

describe("§13.5 a locked channel with no code says so", () => {
  it("draws the absence rather than nothing when the derivation produced none", async () => {
    // §13.5's duty is a DISPLAY duty and the derivation is allowed to fail
    // without costing the channel: `publishWebVerificationCode` returns silently
    // on a derivation failure, and the view refuses anything that is not the
    // exact display format. Rendering `null` there left the strongest claim this
    // tier can make standing with its only check silently gone.
    applyWebE2eeChannelStatus("web-unsigned");
    mounted = await render(
      <>
        <ChannelStatusProbe />
        <HostedE2eeVerification />
      </>,
    );
    await settledAt("web-unsigned");

    const drawn = section();
    expect(drawn, "a locked channel with no code drew nothing at all").not.toBeNull();
    expect(drawn!.getAttribute("data-code")).toBe("absent");
    expect(drawn!.textContent).toContain(E2EE_WEB_SAS_UNAVAILABLE);
    expect(codeElement()).toBeNull();

    // A value the §13.5 splitter refuses is the same state: half a comparison is
    // worse than none, and it may not be drawn as a code.
    applyWebE2eeVerificationCode("abcd-efgh");
    await vi.waitFor(() => {
      expect(section()!.getAttribute("data-code")).toBe("absent");
    });
    expect(document.body.textContent).not.toContain("abcd-efgh");

    // …and a conforming code replaces the sentence with the characters.
    applyWebE2eeVerificationCode(FIRST_CODE);
    await vi.waitFor(() => {
      expect(section()!.getAttribute("data-code")).toBe("present");
    });
    expect(codeElement()!.textContent).toBe(FIRST_CODE);
    expect(document.body.textContent).not.toContain(E2EE_WEB_SAS_UNAVAILABLE);
  });
});

describe("§13.5 the code is never written down", () => {
  it("reaches no storage, no console, and no diagnostics export across a whole session", async () => {
    // "The `WebSAS` is ephemeral display state: never logged, never persisted,
    // never sent to analytics." The handshake suite spies the publish path; this
    // one spies the RENDER path, which is where a copy button, a `title`, a
    // restored form value, or a debug log would live.
    localStorage.clear();
    sessionStorage.clear();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const clearStorage = vi.spyOn(Storage.prototype, "clear");
    const openDatabase = vi.spyOn(IDBFactory.prototype, "open");
    const sinks = (["debug", "error", "info", "log", "trace", "warn"] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => undefined),
    );

    applyWebE2eeVerificationCode(FIRST_CODE);
    mounted = await render(<HostedE2eeVerification />);
    await expect.element(page.getByText(FIRST_CODE)).toBeVisible();
    // A second session, and then the end of the channel: the whole lifecycle
    // the string exists for, inside the spied window.
    applyWebE2eeVerificationCode(SECOND_CODE);
    await vi.waitFor(() => {
      expect(codeElement()!.textContent).toBe(SECOND_CODE);
    });
    resetWebE2eeSession();
    await vi.waitFor(() => {
      expect(section()).toBeNull();
    });

    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(clearStorage).not.toHaveBeenCalled();
    expect(openDatabase).not.toHaveBeenCalled();
    for (const sink of sinks) {
      for (const call of sink.mock.calls) {
        const serialized = call
          .map((argument) => `${String(argument)} ${safeJson(argument)}`)
          .join(" ");
        for (const code of [FIRST_CODE, SECOND_CODE]) {
          expect(serialized).not.toContain(code);
        }
      }
    }

    // The stores are also read back directly, so a write that bypassed the
    // prototype spies would still be caught.
    for (const store of [localStorage, sessionStorage]) {
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index)!;
        for (const code of [FIRST_CODE, SECOND_CODE]) {
          expect(`${key} ${store.getItem(key) ?? ""}`).not.toContain(code);
        }
      }
    }
    expect(document.cookie).not.toContain(FIRST_CODE);
    expect(document.cookie).not.toContain(SECOND_CODE);

    // The operator debug bundle is an allowlist, and §13.5's code is not on it.
    // Built here rather than asserted about in prose, so a field added to the
    // bundle that reached the §13 projection would fail this.
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
    for (const code of [FIRST_CODE, SECOND_CODE]) {
      expect(bundle).not.toContain(code);
    }
  });
});

/** One argument flattened as far as it goes, for a string scan. */
function safeJson(argument: unknown): string {
  try {
    return JSON.stringify(argument) ?? "";
  } catch {
    // Cyclic or non-serializable; `String()` at the call site is the whole scan.
    return "";
  }
}
