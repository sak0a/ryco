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
  publishWebE2eeVerificationCode,
  resetWebE2eeSession,
  webE2eeSessionState,
} from "../../hostedHub/e2eeSession";
import {
  buildDiagnosticsBundle,
  serializeDiagnosticsBundle,
} from "../settings/DiagnosticsPanel.logic";
import { E2EE_WEB_SAS_ADVISORY, E2EE_WEB_SAS_CAPTION } from "./HostedE2eeVerification.logic";
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
    await expect.element(page.getByText(E2EE_WEB_SAS_CAPTION)).toBeVisible();
    // Structurally, not just visually: nothing between the code and either
    // sentence is a collapsible or a hidden container.
    expect(section()!.querySelector("details")).toBeNull();
    expect(section()!.querySelector("[hidden]")).toBeNull();
    for (const text of [E2EE_WEB_SAS_ADVISORY, E2EE_WEB_SAS_CAPTION]) {
      const node = [...section()!.querySelectorAll<HTMLElement>("p")].find((paragraph) =>
        paragraph.textContent?.includes(text),
      );
      expect(node, "the sentence is not in the same section as the code").not.toBeUndefined();
      const box = node!.getBoundingClientRect();
      expect(box.width, "the sentence has no box").toBeGreaterThan(0);
      expect(box.height, "the sentence has no box").toBeGreaterThan(0);
    }
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

  it("draws nothing until the channel has actually locked", async () => {
    // The §4.4 machine publishes §13.5's code from INSIDE its own `e2ee` lock,
    // so the projection is still `negotiating` at that instant. Drawing then
    // would show a comparison value for a channel this surface cannot yet say
    // is encrypted.
    resetWebE2eeSession();
    mounted = await render(<HostedE2eeVerification />);
    expect(section()).toBeNull();

    applyWebE2eeChannelStatus("negotiating");
    publishWebE2eeVerificationCode(FIRST_CODE);
    // The projection is holding it — so the absence below is the surface's
    // decision and not a missing value.
    expect(webE2eeSessionState()).toEqual({
      status: "negotiating",
      verificationCode: FIRST_CODE,
    });
    await vi.waitFor(() => {
      expect(section()).toBeNull();
    });

    // …and a fallen-back channel never shows one either: §12.2 forbids any E2EE
    // claim for it, and there is no channel to compare against.
    applyWebE2eeChannelStatus("legacy");
    await vi.waitFor(() => {
      expect(section()).toBeNull();
    });
    expect(webE2eeSessionState().verificationCode).toBeNull();
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
