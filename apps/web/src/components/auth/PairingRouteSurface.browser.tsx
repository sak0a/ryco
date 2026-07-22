// The pairing entry surface on the phone tier.
//
// What was measured: the surface was a `min-h-screen items-center
// justify-center overflow-hidden` card inside a root that is itself
// `overflow-y: hidden`, so **no user-scrollable ancestor existed anywhere in
// the pairing surface's ancestry**. Its default state does fit 320x568 — this
// file does not claim otherwise — but any state taller than the viewport was
// then clipped at both ends with no way to reach it, because `items-center`
// pushes the overflow out through the top as well as the bottom. The fixture
// below forces such a state with a long bounded error message rather than
// exercising the short default, which would hide the bound entirely. Both
// pairing buttons were also `size="sm"`, 32px tall against a 44px floor.
//
// Production CSS is part of the behaviour under test, so the real stylesheet
// is imported rather than approximated.
import "../../index.css";

import type { AuthSessionState } from "@ryco/contracts";
import { page } from "vite-plus/test/browser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { resetPointerEmulation, setCoarsePointerEmulation } from "../../../test/browserPointer";
import { measureEffectiveHitTarget } from "../../../test/touchTargets";
import { syncDocumentPresentationTier } from "../../lib/presentationTier";
import { PairingRouteSurface } from "./PairingRouteSurface";

const TOUCH_FLOOR_PX = 44;

const auth: AuthSessionState["auth"] = {
  bootstrapMethods: ["desktop-bootstrap", "one-time-token"],
  policy: "remote-reachable",
  sessionCookieName: "ryco_session",
  sessionMethods: ["browser-session-cookie"],
};

/**
 * The tallest reachable state, not the default one: a pairing failure renders
 * an error block above the actions, and that is exactly the state in which the
 * primary action used to be unreachable.
 */
const INITIAL_ERROR = [
  "The pairing token was rejected by this environment.",
  "Request a new pairing link from the environment that issued it and try again.",
  "If the environment is desktop-managed, open it from the desktop application instead,",
  "which pairs this browser without a one-time token.",
  "A pairing token is single use and expires shortly after it is issued, so a link",
  "that was opened once, forwarded, or left in a background tab will not be accepted",
  "a second time even when it still looks valid.",
  "Check that this browser can reach the environment over HTTPS as well:",
  "a mixed-content or CORS rejection surfaces here with the same wording.",
].join(" ");

/**
 * The nearest ancestor a person could actually scroll. `overflow: hidden`
 * boxes still answer programmatic scrolling, so they do not count.
 */
function userScrollableAncestor(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element.parentElement;
  while (current) {
    const { overflowY } = getComputedStyle(current);
    if (overflowY === "auto" || overflowY === "scroll") return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * The nearest ancestor that clips the element horizontally. Containment must
 * be asserted here rather than on a control's rectangle: `overflow-x: hidden`
 * still answers programmatic scrolling (only `clip` blocks both), so any
 * right-edge assertion taken after `scrollIntoView` measures a panned
 * viewport and cannot fail.
 */
function horizontalClippingAncestor(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element.parentElement;
  while (current) {
    const { overflowX } = getComputedStyle(current);
    if (overflowX !== "visible") return current;
    current = current.parentElement;
  }
  return null;
}

function operableControls(): ReadonlyArray<HTMLElement> {
  return [...document.querySelectorAll<HTMLElement>("button, input")].filter(
    (element) => (element.checkVisibility?.() ?? true) && !(element as HTMLButtonElement).disabled,
  );
}

let mounted: Awaited<ReturnType<typeof render>> | null = null;

async function usePhoneViewport(width: number, height: number): Promise<void> {
  await page.viewport(width, height);
  await setCoarsePointerEmulation(true);
  await vi.waitFor(() => {
    expect(document.documentElement.getAttribute("data-tier")).toBe("phone");
  });
  expect(window.matchMedia("(pointer: coarse)").matches).toBe(true);
  expect(window.innerWidth).toBe(width);
  expect(window.innerHeight).toBe(height);
}

describe("PairingRouteSurface", () => {
  beforeAll(() => {
    syncDocumentPresentationTier();
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    document.documentElement.style.fontSize = "";
    await resetPointerEmulation();
    await page.viewport(1_280, 720);
  });

  it("keeps the pairing action reachable and 44px on a phone at 320x568", async () => {
    await usePhoneViewport(320, 568);
    mounted = await render(
      <PairingRouteSurface
        auth={auth}
        initialErrorMessage={INITIAL_ERROR}
        onAuthenticated={vi.fn()}
      />,
    );
    await expect.element(page.getByRole("button", { name: "Continue" })).toBeVisible();
    await expect.element(page.getByText(INITIAL_ERROR)).toBeVisible();

    const continueButton = document.querySelector<HTMLElement>('button[type="submit"]')!;
    const scroller = userScrollableAncestor(continueButton);
    expect(scroller, "the pairing surface must be user-scrollable").not.toBeNull();
    expect(
      scroller!.scrollHeight,
      "the fixture must actually overflow, or reachability is untested",
    ).toBeGreaterThan(scroller!.clientHeight);
    expect(scroller!.scrollTop, "measured at rest, before any scrolling").toBe(0);

    // The surface fills the viewport instead of floating a centred card, and
    // its content column is the growing flex column the phone layout needs.
    // The desktop case below asserts the exact opposite of all three.
    const card = document.querySelector<HTMLElement>("section")!;
    const cardStyle = getComputedStyle(card);
    expect(cardStyle.borderTopWidth, "phone card border").toBe("0px");
    expect(cardStyle.borderTopLeftRadius, "phone card radius").toBe("0px");
    expect(cardStyle.display, "phone content column").toBe("flex");

    const rect = continueButton.getBoundingClientRect();
    expect(rect.top, "above the viewport").toBeGreaterThanOrEqual(0);
    expect(rect.bottom, "below the fold").toBeLessThanOrEqual(window.innerHeight);

    // ...and it stays on screen while the content above it scrolls.
    scroller!.scrollTop = scroller!.scrollHeight;
    await vi.waitFor(() => {
      const scrolled = continueButton.getBoundingClientRect();
      expect(scrolled.top).toBeGreaterThanOrEqual(0);
      expect(scrolled.bottom).toBeLessThanOrEqual(window.innerHeight);
    });
    scroller!.scrollTop = 0;

    for (const element of operableControls()) {
      element.scrollIntoView({ block: "center", inline: "nearest" });
      const hit = measureEffectiveHitTarget(element);
      const where = `"${element.getAttribute("aria-label") ?? element.textContent?.trim()}"`;
      expect(hit.width, `${where}: effective width`).toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
      expect(hit.height, `${where}: effective height`).toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
      // Sized, not slopped: the shared `pointer-coarse` slop happens to reach
      // the floor on this surface, but it is clipped by an `overflow` ancestor
      // elsewhere in the app, so the pairing controls do not depend on it.
      expect(
        element.getBoundingClientRect().height,
        `${where}: border-box height`,
      ).toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
    }

    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    expect(document.body.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });

  it("bottom-anchors the pairing action row when the surface fits at 390x844", async () => {
    // The default, error-free state fits the viewport, so `sticky` never
    // engages and `mt-auto` inside the growing flex column is the only rule
    // that puts the row in the thumb zone. Without this case the row's
    // anchoring is untested in the state a person normally sees.
    await usePhoneViewport(390, 844);
    mounted = await render(<PairingRouteSurface auth={auth} onAuthenticated={vi.fn()} />);
    await expect.element(page.getByRole("button", { name: "Continue" })).toBeVisible();

    const continueButton = document.querySelector<HTMLElement>('button[type="submit"]')!;
    const scroller = userScrollableAncestor(continueButton)!;
    expect(
      scroller.scrollHeight,
      "the error-free surface must fit at 390x844, or `mt-auto` is untested",
    ).toBe(scroller.clientHeight);

    // Measured against the form, which is the growing flex column `mt-auto`
    // resolves inside — not against the section, whose last child is the
    // supported-methods note that deliberately stays below the actions.
    const group = continueButton.parentElement!.getBoundingClientRect();
    const formBottom = continueButton.closest("form")!.getBoundingClientRect().bottom;
    expect(
      Math.abs(formBottom - group.bottom),
      "pairing action row not flush with the bottom of its column",
    ).toBeLessThanOrEqual(1);
    expect(group.bottom, "below the fold").toBeLessThanOrEqual(window.innerHeight);
  });

  it("keeps every pairing control on screen at 200% text scaling at 320px", async () => {
    await usePhoneViewport(320, 568);
    document.documentElement.style.fontSize = "32px";
    mounted = await render(
      <PairingRouteSurface
        auth={auth}
        initialErrorMessage={INITIAL_ERROR}
        onAuthenticated={vi.fn()}
      />,
    );
    await expect.element(page.getByRole("button", { name: "Continue" })).toBeVisible();

    // No control collapses away. Deliberately not a per-control right-edge
    // check after `scrollIntoView` — see `horizontalClippingAncestor`.
    for (const element of operableControls()) {
      const rect = element.getBoundingClientRect();
      const where = `"${element.getAttribute("aria-label") ?? element.textContent?.trim()}" at 200% text`;
      expect(rect.width, `${where}: collapsed`).toBeGreaterThan(0);
      expect(rect.height, `${where}: collapsed`).toBeGreaterThan(0);
    }

    const continueButton = document.querySelector<HTMLElement>('button[type="submit"]')!;
    const clipper = horizontalClippingAncestor(continueButton)!;
    expect(clipper.scrollLeft, "measured unpanned").toBe(0);
    expect(
      clipper.scrollWidth,
      "pairing content wider than its clipping box at 200% text",
    ).toBeLessThanOrEqual(clipper.clientWidth);

    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    expect(document.body.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });

  it("keeps the desktop pairing card centred with its actions in flow", async () => {
    await page.viewport(1_280, 720);
    await vi.waitFor(() => {
      expect(document.documentElement.getAttribute("data-tier")).toBe("desktop");
    });
    mounted = await render(
      <PairingRouteSurface
        auth={auth}
        initialErrorMessage={INITIAL_ERROR}
        onAuthenticated={vi.fn()}
      />,
    );
    await expect.element(page.getByRole("button", { name: "Continue" })).toBeVisible();

    const card = document.querySelector<HTMLElement>("section")!;
    const cardStyle = getComputedStyle(card);
    expect(Number.parseFloat(cardStyle.borderTopLeftRadius)).toBeGreaterThan(0);
    expect(Number.parseFloat(cardStyle.borderTopWidth)).toBeGreaterThan(0);
    expect(cardStyle.display).not.toBe("flex");

    // Horizontally centred and vertically centred in the viewport, as before.
    const rect = card.getBoundingClientRect();
    expect(Math.abs(rect.left - (window.innerWidth - rect.right))).toBeLessThanOrEqual(1);
    expect(Math.abs(rect.top - (window.innerHeight - rect.bottom))).toBeLessThanOrEqual(1);

    // The action row is still in flow, at the compact desktop density.
    const continueButton = document.querySelector<HTMLElement>('button[type="submit"]')!;
    expect(getComputedStyle(continueButton.parentElement!).position).toBe("static");
    expect(continueButton.getBoundingClientRect().height).toBeLessThan(TOUCH_FLOOR_PX);
  });
});
