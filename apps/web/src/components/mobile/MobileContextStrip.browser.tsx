// Production CSS is part of the behavior under test: the rail's overflow
// behaviour, the 44px pill floor and the chip material are all CSS.
import "../../index.css";

import { GitBranchIcon } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { resetPointerEmulation, setCoarsePointerEmulation } from "../../../test/browserPointer";
import {
  APPEARANCE_PREFERENCES_STORAGE_KEY,
  applyAppearancePreferencesToDocument,
  setAppearancePreference,
} from "../../themes/appearancePreferences";
import { MobileContextStrip, type MobileContextStripItem } from "./MobileContextStrip";

const NARROW_VIEWPORT = { width: 320, height: 568 } as const;

function pills(): HTMLButtonElement[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>('[data-slot="mobile-context-strip-pill"]'),
  ];
}

function rail(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="mobile-context-strip-rail"]');
}

const ITEMS: MobileContextStripItem[] = [
  {
    id: "branch",
    label: "Branch",
    value: "feature/liquid-glass-phone-experience",
    icon: <GitBranchIcon aria-hidden className="size-3.5 shrink-0" />,
    onSelect: () => {},
  },
  { id: "find", label: "Find in thread", onSelect: () => {} },
  { id: "sessions", label: "Sessions", value: "3", onSelect: () => {} },
  { id: "workspace", label: "Workspace", selected: true, onSelect: () => {} },
  { id: "overview", label: "Source control", onSelect: () => {} },
];

describe("MobileContextStrip", () => {
  let mounted: Awaited<ReturnType<typeof render>> | null = null;

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    document.body.innerHTML = "";
    await resetPointerEmulation();
    localStorage.removeItem(APPEARANCE_PREFERENCES_STORAGE_KEY);
    applyAppearancePreferencesToDocument();
    await page.viewport(1_280, 720);
  });

  it("scrolls the rail rather than the page at 320px, with every pill a 44px target", async () => {
    await page.viewport(NARROW_VIEWPORT.width, NARROW_VIEWPORT.height);
    await setCoarsePointerEmulation(true);
    mounted = await render(<MobileContextStrip label="Thread context" items={ITEMS} />);
    expect(window.matchMedia("(pointer: coarse)").matches).toBe(true);

    const rendered = pills();
    expect(rendered).toHaveLength(ITEMS.length);
    for (const pill of rendered) {
      const rect = pill.getBoundingClientRect();
      expect(rect.width, `width of "${pill.textContent?.trim()}"`).toBeGreaterThanOrEqual(44);
      expect(rect.height, `height of "${pill.textContent?.trim()}"`).toBeGreaterThanOrEqual(44);
    }

    // The rail overflows — that is the point of the primitive — and it is the
    // rail that scrolls.
    const railElement = rail()!;
    expect(railElement.scrollWidth).toBeGreaterThan(railElement.clientWidth);
    expect(getComputedStyle(railElement).overflowX).toBe("auto");

    // The page does not scroll horizontally at any width the strip is used at.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(NARROW_VIEWPORT.width);
    expect(document.body.scrollWidth).toBeLessThanOrEqual(NARROW_VIEWPORT.width);

    // Off-screen pills are reachable by scrolling the rail, and the trailing
    // edge affordance never intercepts the tap that belongs to a pill.
    railElement.scrollLeft = railElement.scrollWidth;
    await vi.waitFor(() => {
      expect(railElement.scrollLeft).toBeGreaterThan(0);
    });
    const last = pills().at(-1)!;
    const lastRect = last.getBoundingClientRect();
    const hit = document.elementFromPoint(lastRect.right - 4, lastRect.top + lastRect.height / 2);
    expect(hit?.closest('[data-slot="mobile-context-strip-pill"]')).toBe(last);
  });

  it("names each pill from its label and value, and announces selection", async () => {
    await page.viewport(NARROW_VIEWPORT.width, NARROW_VIEWPORT.height);
    const onSelect = vi.fn();
    mounted = await render(
      <MobileContextStrip
        label="Thread context"
        items={[
          { id: "branch", label: "Branch", value: "main", onSelect },
          { id: "workspace", label: "Workspace", selected: true, onSelect: () => {} },
          { id: "model", label: "Model", value: "gpt-5", disabled: true, onSelect: () => {} },
        ]}
      />,
    );

    await expect.element(page.getByRole("group", { name: "Thread context" })).toBeVisible();
    const branch = page.getByRole("button", { name: "Branch main" });
    await expect.element(branch).toBeVisible();
    await branch.click();
    expect(onSelect).toHaveBeenCalledTimes(1);

    expect(
      (page.getByRole("button", { name: "Workspace" }).element() as HTMLElement).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(
      (page.getByRole("button", { name: "Model gpt-5" }).element() as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("renders its pills on the chip material tier", async () => {
    await page.viewport(NARROW_VIEWPORT.width, NARROW_VIEWPORT.height);
    mounted = await render(<MobileContextStrip label="Thread context" items={ITEMS} />);
    const pill = pills()[0]!;

    setAppearancePreference("surfaceTransparency", "default");
    applyAppearancePreferencesToDocument();
    expect(getComputedStyle(pill).backdropFilter).toBe("none");

    setAppearancePreference("surfaceTransparency", "glass");
    applyAppearancePreferencesToDocument();
    // The chip tier's blur radius, shared with the connection pill. The
    // contrast that makes it safe is asserted in `GlassSurface.browser.tsx`.
    expect(getComputedStyle(pill).backdropFilter).toContain("blur(14px)");
  });

  it("keeps a pill's focus indicator visible inside the scrolling rail", async () => {
    await page.viewport(NARROW_VIEWPORT.width, NARROW_VIEWPORT.height);
    mounted = await render(<MobileContextStrip label="Thread context" items={ITEMS} />);

    // Keyboard modality first: Chromium only matches `:focus-visible` when the
    // last interaction was a keyboard one, so a bare `focus()` would assert
    // nothing.
    await userEvent.keyboard("{Tab}");
    const pill = pills()[0]!;
    pill.focus();
    expect(document.activeElement).toBe(pill);
    expect(pill.matches(":focus-visible")).toBe(true);

    // `overflow-x: auto` forces the block axis to `auto` too, so an OUTSET ring
    // would be clipped by the rail and keyboard and switch users would lose the
    // indicator these actions had as sheet rows. The indicator is inset, so the
    // clip cannot hide it.
    const shadow = getComputedStyle(pill).boxShadow;
    expect(shadow).not.toBe("none");
    expect(shadow).toContain("inset");

    // …and the pill's own box sits inside the rail's visible box, so nothing
    // renders the indicator on a partly clipped element.
    const railRect = rail()!.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    expect(pillRect.top).toBeGreaterThanOrEqual(railRect.top - 0.5);
    expect(pillRect.bottom).toBeLessThanOrEqual(railRect.bottom + 0.5);
  });

  it("contributes no width to an ancestor sized by min-content", async () => {
    // The rail's pills do not shrink, so its min-content width is their sum.
    // `min-width: 0` clamps the used width but NOT that contribution, so inside
    // any ancestor sized by min-content — a grid or flex item taking
    // `min-width: auto` — the rail would widen the whole column. A call site in
    // that position gives the strip a zero base width; `PhoneThreadDock` does,
    // and this pins why.
    await page.viewport(NARROW_VIEWPORT.width, NARROW_VIEWPORT.height);
    mounted = await render(
      // `display: grid` without `minmax(0, 1fr)`: grid items take
      // `min-width: auto`, which is exactly the shape that exposes this.
      <div style={{ display: "grid", width: `${NARROW_VIEWPORT.width}px` }}>
        <div className="flex min-w-0 items-center gap-1.5" data-testid="row">
          <button type="button" className="size-11 shrink-0" aria-label="Leading" />
          <MobileContextStrip label="Thread context" items={ITEMS} className="w-0 grow" />
          <button type="button" className="size-11 shrink-0" aria-label="Trailing" />
        </div>
      </div>,
    );

    const row = document.querySelector<HTMLElement>('[data-testid="row"]')!;
    expect(row.getBoundingClientRect().width).toBeLessThanOrEqual(NARROW_VIEWPORT.width + 0.5);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(NARROW_VIEWPORT.width);
    // The rail still occupies the space left between the two controls, so the
    // zero base width costs nothing where the row has room.
    expect(rail()!.getBoundingClientRect().width).toBeGreaterThan(100);
  });

  it("renders nothing when it has no pills", async () => {
    await page.viewport(NARROW_VIEWPORT.width, NARROW_VIEWPORT.height);
    mounted = await render(<MobileContextStrip label="Thread context" items={[]} />);
    expect(document.querySelector('[data-slot="mobile-context-strip"]')).toBeNull();
  });
});
