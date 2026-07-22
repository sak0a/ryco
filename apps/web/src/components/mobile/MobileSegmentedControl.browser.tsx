// Production CSS is part of the behavior under test: the 44px segment floor and
// the caution tone are classes, not measured constants in the component.
import "../../index.css";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import {
  cdpSession,
  resetPointerEmulation,
  setCoarsePointerEmulation,
} from "../../../test/browserPointer";
import {
  MobileSegmentedControl,
  type MobileSegmentedControlOption,
} from "./MobileSegmentedControl";

const PHONE_VIEWPORT = { width: 390, height: 844 } as const;
/** Comfortably longer than the primitive's 120-character bound. */
const LONG_REASON = `Changing access is unavailable ${"because the relay authorization is stale ".repeat(8)}`;

const ACCESS_OPTIONS: MobileSegmentedControlOption[] = [
  {
    id: "approval-required",
    label: "Supervised",
    description: "Ask before commands and file changes.",
  },
  {
    id: "auto-accept-edits",
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
  },
  {
    id: "full-access",
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    tone: "caution",
  },
];

function segments(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[data-slot="mobile-segmented-option"]')];
}

/**
 * The browser runner scales the emulated viewport, so CDP input coordinates and
 * client coordinates do not coincide. Probing two points recovers the affine
 * mapping instead of assuming one.
 */
async function probeClientPosition(x: number, y: number): Promise<{ x: number; y: number }> {
  const position = new Promise<{ x: number; y: number }>((resolve) => {
    const onMove = (event: PointerEvent) => {
      window.removeEventListener("pointermove", onMove, true);
      resolve({ x: event.clientX, y: event.clientY });
    };
    window.addEventListener("pointermove", onMove, true);
  });
  await cdpSession().send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
  return position;
}

async function calibratePointer(): Promise<{
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}> {
  const firstClient = await probeClientPosition(60, 60);
  const secondClient = await probeClientPosition(240, 240);
  const scaleX = (secondClient.x - firstClient.x) / 180;
  const scaleY = (secondClient.y - firstClient.y) / 180;
  expect(scaleX, "horizontal pointer calibration").toBeGreaterThan(0);
  expect(scaleY, "vertical pointer calibration").toBeGreaterThan(0);
  return {
    scaleX,
    scaleY,
    offsetX: firstClient.x - 60 * scaleX,
    offsetY: firstClient.y - 60 * scaleY,
  };
}

/**
 * Drags a real pointer horizontally through CDP: press on one client point,
 * move across, release on another. This is the "swipe past other options"
 * gesture the design forbids from committing a consequential selection.
 */
async function dragHorizontally(
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const transform = await calibratePointer();
  const toInput = (clientX: number, clientY: number) => ({
    x: (clientX - transform.offsetX) / transform.scaleX,
    y: (clientY - transform.offsetY) / transform.scaleY,
  });
  const session = cdpSession();
  const start = toInput(from.x, from.y);
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...start, buttons: 0 });
  await session.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...start,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  const steps = 12;
  for (let step = 1; step <= steps; step += 1) {
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...toInput(from.x + ((to.x - from.x) * step) / steps, from.y),
      button: "left",
      buttons: 1,
    });
  }
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...toInput(to.x, to.y),
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

describe("MobileSegmentedControl", () => {
  let mounted: Awaited<ReturnType<typeof render>> | null = null;

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    document.body.innerHTML = "";
    await resetPointerEmulation();
    await page.viewport(1_280, 720);
  });

  it("measures every segment at 44px under coarse-pointer emulation and announces selection", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    await setCoarsePointerEmulation(true);
    const onChange = vi.fn();
    mounted = await render(
      <MobileSegmentedControl
        label="Access"
        value="approval-required"
        options={ACCESS_OPTIONS}
        onChange={onChange}
      />,
    );
    expect(window.matchMedia("(pointer: coarse)").matches).toBe(true);

    const rendered = segments();
    expect(rendered).toHaveLength(3);
    for (const segment of rendered) {
      const rect = segment.getBoundingClientRect();
      expect(
        Math.min(rect.width, rect.height),
        `touch target for "${segment.textContent?.trim()}"`,
      ).toBeGreaterThanOrEqual(44);
    }

    // Selection is announced, not merely styled.
    await expect.element(page.getByRole("group", { name: "Access" })).toBeVisible();
    expect(
      (page.getByRole("button", { name: "Supervised" }).element() as HTMLElement).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(
      (page.getByRole("button", { name: "Full access" }).element() as HTMLElement).getAttribute(
        "aria-pressed",
      ),
    ).toBe("false");

    await page.getByRole("button", { name: "Auto-accept edits" }).click();
    expect(onChange).toHaveBeenCalledWith("auto-accept-edits");
  });

  it("keeps the consequential option a deliberate activation, not something a swipe reaches", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    await setCoarsePointerEmulation(true);
    const onChange = vi.fn();
    mounted = await render(
      <MobileSegmentedControl
        label="Access"
        value="approval-required"
        options={ACCESS_OPTIONS}
        onChange={onChange}
      />,
    );

    const [supervised, autoAccept, fullAccess] = segments();
    // The caution tone is the warning treatment full access carries in the
    // composer, kept rather than translated away — and it is a different
    // resolved colour, not just a different class name.
    //
    // It is compared against the OTHER unselected segment on purpose. Comparing
    // it with the selected one would pass whether or not the tone exists, since
    // selected and unselected segments already differ in colour.
    expect(fullAccess!.dataset.tone).toBe("caution");
    expect(autoAccept!.dataset.tone).toBe("default");
    expect(autoAccept!.getAttribute("aria-pressed")).toBe(fullAccess!.getAttribute("aria-pressed"));
    expect(getComputedStyle(fullAccess!).color).not.toBe(getComputedStyle(autoAccept!).color);

    // Press on the first segment, sweep across the middle one, release over
    // full access. Nothing may be committed by that gesture.
    const supervisedRect = supervised!.getBoundingClientRect();
    const fullAccessRect = fullAccess!.getBoundingClientRect();
    await dragHorizontally(
      {
        x: supervisedRect.left + supervisedRect.width / 2,
        y: supervisedRect.top + supervisedRect.height / 2,
      },
      {
        x: fullAccessRect.left + fullAccessRect.width / 2,
        y: fullAccessRect.top + fullAccessRect.height / 2,
      },
    );
    expect(onChange).not.toHaveBeenCalled();

    // Its own activation still selects it.
    await page.getByRole("button", { name: "Full access" }).click();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("full-access");
  });

  it("renders a bounded reason and commits nothing when it is disabled", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    const onChange = vi.fn();
    mounted = await render(
      <MobileSegmentedControl
        label="Access"
        value="approval-required"
        options={ACCESS_OPTIONS}
        disabled
        disabledReason={LONG_REASON}
        onChange={onChange}
      />,
    );

    const reason = document.querySelector<HTMLElement>('[data-slot="mobile-segmented-reason"]');
    expect(reason).not.toBeNull();
    const text = reason!.textContent ?? "";
    expect(text.length).toBeLessThanOrEqual(120);
    expect(text.length).toBeLessThan(LONG_REASON.length);
    expect(text.startsWith("Changing access is unavailable")).toBe(true);
    // The reason describes the group rather than renaming it.
    const group = page.getByRole("group", { name: "Access" }).element() as HTMLElement;
    expect(group.getAttribute("aria-describedby")).toBe(reason!.id);

    for (const segment of segments()) {
      expect(segment.disabled, `"${segment.textContent?.trim()}" should be disabled`).toBe(true);
      segment.click();
      segment.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables a single unsupported option and explains it while the rest stay usable", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    const onChange = vi.fn();
    mounted = await render(
      <MobileSegmentedControl
        label="Mode"
        value="ask"
        options={[
          { id: "default", label: "Build", description: "Make changes and run commands." },
          { id: "plan", label: "Plan", description: "Chat toward a plan." },
          {
            id: "ask",
            label: "Ask",
            disabled: true,
            disabledReason: "Not supported by this provider.",
          },
        ]}
        onChange={onChange}
      />,
    );

    const ask = page.getByRole("button", { name: "Ask" }).element() as HTMLButtonElement;
    expect(ask.disabled).toBe(true);
    expect(document.querySelector('[data-slot="mobile-segmented-description"]')?.textContent).toBe(
      "Not supported by this provider.",
    );

    await page.getByRole("button", { name: "Plan" }).click();
    expect(onChange).toHaveBeenCalledWith("plan");
  });
});
