// Production CSS is part of the behavior under test: the 44px touch target is
// a class, not a measured constant in the component.
import "../../index.css";

import { CheckIcon, SearchIcon } from "lucide-react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { resetPointerEmulation, setCoarsePointerEmulation } from "../../../test/browserPointer";
import { MobileListRow } from "./MobileListRow";

const PHONE_VIEWPORT = { width: 390, height: 844 } as const;
/** Comfortably longer than the primitive's bound. */
const LONG_REASON = `Switching is unavailable ${"because the directory is stale ".repeat(12)}`;

function rows(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[data-slot="mobile-list-row"]')];
}

describe("MobileListRow", () => {
  let mounted: Awaited<ReturnType<typeof render>> | null = null;

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    document.body.innerHTML = "";
    await resetPointerEmulation();
    await page.viewport(1_280, 720);
  });

  it("measures at least 44px on its smaller axis under coarse-pointer emulation", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    await setCoarsePointerEmulation(true);

    mounted = await render(
      <div>
        <MobileListRow
          label="Find in thread"
          icon={<SearchIcon aria-hidden className="size-4" />}
        />
        <MobileListRow label="Bare label" />
        <MobileListRow
          label="Selected session"
          selected
          trailing={<CheckIcon aria-hidden className="size-4" />}
        />
        <MobileListRow label="With detail" secondaryText="Second line" />
        <MobileListRow label="Danger" destructive />
      </div>,
    );

    expect(window.matchMedia("(pointer: coarse)").matches).toBe(true);
    const rendered = rows();
    expect(rendered).toHaveLength(5);
    for (const row of rendered) {
      const rect = row.getBoundingClientRect();
      expect(
        Math.min(rect.width, rect.height),
        `touch target for "${row.textContent?.trim()}"`,
      ).toBeGreaterThanOrEqual(44);
    }
  });

  it("renders a disabled presentation with a bounded reason that is a description, not the name", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);

    mounted = await render(
      <MobileListRow
        label="Second node"
        secondaryText="Last seen 2 minutes ago"
        trailing={<span>Online</span>}
        disabled
        disabledReason={LONG_REASON}
      />,
    );

    const row = rows()[0]!;
    expect(row.disabled).toBe(true);
    // The reason changes the description, never the name: a disabled row reads
    // exactly as it would enabled, trailing state included. Regression —
    // pointing `aria-labelledby` at the label alone silently dropped the
    // presence indicator from the name of precisely the rows a person cannot
    // activate.
    await expect
      .element(
        page.getByRole("button", {
          name: "Second node Last seen 2 minutes ago Online",
          exact: true,
        }),
      )
      .toBeDisabled();

    const describedBy = row.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    const description = document.getElementById(describedBy!);
    expect(description).not.toBeNull();
    const reason = description!.textContent ?? "";
    expect(reason.length).toBeLessThanOrEqual(120);
    expect(reason.length).toBeLessThan(LONG_REASON.length);
    expect(reason.startsWith("Switching is unavailable")).toBe(true);

    // Disabled rows do not carry the destructive or interactive presentation.
    expect(row.className).toContain("disabled:pointer-events-none");
  });

  it("carries no reason element when the row is enabled and keeps the same name", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    mounted = await render(
      <MobileListRow
        label="Second node"
        secondaryText="Last seen 2 minutes ago"
        trailing={<span>Online</span>}
        disabledReason={LONG_REASON}
      />,
    );

    const row = rows()[0]!;
    expect(row.disabled).toBe(false);
    expect(row.getAttribute("aria-describedby")).toBeNull();
    expect(row.getAttribute("aria-labelledby")).toBeNull();
    // The enabled name is the row's own content, and it is the same string the
    // disabled case above asserts.
    await expect
      .element(
        page.getByRole("button", {
          name: "Second node Last seen 2 minutes ago Online",
          exact: true,
        }),
      )
      .toBeEnabled();
  });
});
