// Production CSS is part of the behavior under test: the 44px row floor, the
// detent offset, and the safe-area padding are all CSS.
import "../../index.css";

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { resetPointerEmulation, setCoarsePointerEmulation } from "../../../test/browserPointer";
import { MobileSelectSheet, type MobileSelectSheetGroup } from "./MobileSelectSheet";

const PHONE_VIEWPORT = { width: 390, height: 844 } as const;
/** Comfortably longer than the primitive's 120-character bound. */
const LONG_REASON = `Selection is unavailable ${"because the relay authorization is stale ".repeat(8)}`;

const GROUPS: MobileSelectSheetGroup[] = [
  {
    id: "favorites",
    label: "Favorites",
    options: [{ id: "codex:gpt-5-codex", label: "GPT-5 Codex", secondaryText: "Codex" }],
  },
  {
    id: "claudeAgent",
    label: "Claude",
    options: [
      { id: "claudeAgent:opus", label: "Claude Opus 4.6", secondaryText: "Claude", selected: true },
      { id: "claudeAgent:sonnet", label: "Claude Sonnet 4.6", secondaryText: "Claude" },
    ],
  },
];

/**
 * Enough options that the sheet is taller than the viewport. Base UI clamps
 * both snap points to the popup's own height, so a short sheet collapses the
 * two detents onto one another and a detent assertion on it could not fail.
 */
const TALL_GROUPS: MobileSelectSheetGroup[] = [
  {
    id: "codex",
    label: "Codex",
    options: Array.from({ length: 24 }, (_, index) => ({
      id: `codex:model-${index}`,
      label: `Codex model ${index}`,
      secondaryText: "Codex",
    })),
  },
];

function popupElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-mobile-sheet]");
}

function rows(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[data-slot="mobile-list-row"]')];
}

function searchInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('[data-slot="mobile-select-sheet-search"] input');
}

/**
 * Waits for the popup to exist and for its position to stop moving. Detent
 * assertions are geometric and must not read a mid-transition frame — the enter
 * transition is running when the element first appears.
 */
async function waitForSettledPopup(): Promise<HTMLElement> {
  const element = await vi.waitFor(() => {
    const found = popupElement();
    expect(found).not.toBeNull();
    expect(found!.getBoundingClientRect().height).toBeGreaterThan(0);
    return found!;
  });
  let previousTop = Number.NaN;
  await vi.waitFor(() => {
    const { top } = element.getBoundingClientRect();
    const settled = top === previousTop;
    previousTop = top;
    expect(settled, "the sheet is still animating").toBe(true);
  });
  return element;
}

function Harness({
  disabled = false,
  disabledReason,
  onSelect = () => {},
  groups = GROUPS,
  withSearch = true,
}: {
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly onSelect?: (optionId: string) => void;
  readonly groups?: MobileSelectSheetGroup[];
  readonly withSearch?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  return (
    <div>
      <button type="button" data-testid="sheet-trigger" onClick={() => setOpen(true)}>
        Open sheet
      </button>
      <MobileSelectSheet
        open={open}
        onOpenChange={setOpen}
        label="Model"
        groups={groups}
        disabled={disabled}
        {...(disabledReason ? { disabledReason } : {})}
        {...(withSearch
          ? { search: { value: query, placeholder: "Search models", onChange: setQuery } }
          : {})}
        onSelect={onSelect}
      />
    </div>
  );
}

/**
 * A harness whose close goes through the CONSUMER rather than through any Base
 * UI dismissal, mirroring what committing a selection does.
 */
function ConsumerClosedHarness() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  return (
    <div>
      <button type="button" data-testid="sheet-trigger" onClick={() => setOpen(true)}>
        Open sheet
      </button>
      <button type="button" data-testid="close-from-consumer" onClick={() => setOpen(false)}>
        Close from consumer
      </button>
      <MobileSelectSheet
        open={open}
        onOpenChange={setOpen}
        label="Model"
        groups={TALL_GROUPS}
        search={{ value: query, placeholder: "Search models", onChange: setQuery }}
        onSelect={() => setOpen(false)}
      />
    </div>
  );
}

describe("MobileSelectSheet", () => {
  let mounted: Awaited<ReturnType<typeof render>> | null = null;

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    document.body.innerHTML = "";
    await resetPointerEmulation();
    await page.viewport(1_280, 720);
  });

  it("opens browse-first at the partial detent with search unfocused, and expands on focus", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    mounted = await render(<Harness groups={TALL_GROUPS} />);
    await page.getByTestId("sheet-trigger").click();

    const partial = await waitForSettledPopup();
    // The sheet is at the partial detent, not the full one: Base UI marks the
    // full detent with `data-expanded`, and the partial stop sits roughly at
    // half the viewport rather than at the 48px viewport gutter (`pt-12`).
    expect(partial.hasAttribute("data-expanded")).toBe(false);
    const partialTop = partial.getBoundingClientRect().top;
    expect(partialTop).toBeGreaterThan(PHONE_VIEWPORT.height / 2 - 40);

    // The focus trap has moved focus inside the sheet — but not onto the search
    // field, which would raise the software keyboard over the list on open.
    // The desktop picker this replaces does exactly that, three times over, in
    // a layout effect; the phone sheet must not inherit it.
    const input = searchInput();
    expect(input).not.toBeNull();
    await vi.waitFor(() => {
      expect(partial.contains(document.activeElement)).toBe(true);
    });
    expect(document.activeElement).not.toBe(input);
    expect(input!.autofocus).toBe(false);

    // An explicit focus is the signal to make room for the keyboard: the sheet
    // moves to the full detent.
    input!.focus();
    expect(document.activeElement).toBe(input);
    await vi.waitFor(() => {
      expect(popupElement()?.hasAttribute("data-expanded")).toBe(true);
    });
    const expanded = await waitForSettledPopup();
    expect(expanded.getBoundingClientRect().top).toBeLessThan(partialTop - 100);
  });

  it("renders every row as a 44px target with its selected state exposed to assistive tech", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    await setCoarsePointerEmulation(true);
    mounted = await render(<Harness />);
    await page.getByTestId("sheet-trigger").click();
    await waitForSettledPopup();
    expect(window.matchMedia("(pointer: coarse)").matches).toBe(true);

    const rendered = rows();
    expect(rendered).toHaveLength(3);
    for (const row of rendered) {
      const rect = row.getBoundingClientRect();
      expect(
        Math.min(rect.width, rect.height),
        `touch target for "${row.textContent?.trim()}"`,
      ).toBeGreaterThanOrEqual(44);
    }

    // Selection is announced, not merely styled.
    const selected = page.getByRole("button", { name: /Claude Opus 4\.6/u });
    expect((selected.element() as HTMLElement).getAttribute("aria-pressed")).toBe("true");
    const unselected = page.getByRole("button", { name: /Claude Sonnet 4\.6/u });
    expect((unselected.element() as HTMLElement).getAttribute("aria-pressed")).toBe("false");
  });

  it("returns to the partial detent when the consumer closes it, not only Base UI", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    // A consumer-driven close: `open` flips from outside, which is what
    // committing a selection does. Base UI resets its snap point only on the
    // closes it resolves itself, so this is the path that used to leave the
    // sheet stuck at the full detent.
    mounted = await render(<ConsumerClosedHarness />);
    await page.getByTestId("sheet-trigger").click();
    const first = await waitForSettledPopup();
    expect(first.hasAttribute("data-expanded")).toBe(false);

    searchInput()!.focus();
    await vi.waitFor(() => {
      expect(popupElement()?.hasAttribute("data-expanded")).toBe(true);
    });

    // Close from OUTSIDE the sheet, bypassing every Base UI close path.
    page
      .getByTestId("close-from-consumer")
      .element()
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(popupElement()).toBeNull();
    });

    await page.getByTestId("sheet-trigger").click();
    const second = await waitForSettledPopup();
    expect(second.hasAttribute("data-expanded")).toBe(false);
  });

  it("renders a bounded reason and commits nothing when it is disabled", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    const onSelect = vi.fn();
    mounted = await render(<Harness disabled disabledReason={LONG_REASON} onSelect={onSelect} />);
    await page.getByTestId("sheet-trigger").click();
    await waitForSettledPopup();

    const reason = document.querySelector<HTMLElement>('[data-slot="mobile-select-sheet-reason"]');
    expect(reason).not.toBeNull();
    const text = reason!.textContent ?? "";
    expect(text.length).toBeLessThanOrEqual(120);
    expect(text.length).toBeLessThan(LONG_REASON.length);
    expect(text.startsWith("Selection is unavailable")).toBe(true);

    // Every row is disabled, the search field is disabled, and a forced click
    // still commits nothing.
    for (const row of rows()) {
      expect(row.disabled, `"${row.textContent?.trim()}" should be disabled`).toBe(true);
    }
    expect(searchInput()!.disabled).toBe(true);
    rows()[0]!.click();
    rows()[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("reports the selected option id and keeps a row action reachable beside the row", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    await setCoarsePointerEmulation(true);
    const onSelect = vi.fn();
    const onAction = vi.fn();
    mounted = await render(
      <Harness
        onSelect={onSelect}
        groups={[
          {
            id: "codex",
            label: "Codex",
            options: [
              {
                id: "codex:gpt-5-codex",
                label: "GPT-5 Codex",
                action: {
                  label: "Add to favorites",
                  icon: <span aria-hidden>★</span>,
                  onSelect: onAction,
                },
              },
            ],
          },
        ]}
      />,
    );
    await page.getByTestId("sheet-trigger").click();
    await waitForSettledPopup();

    // The action is a sibling control, not a nested button: a button may not
    // contain another one, and the row is a button.
    const action = page.getByRole("button", { name: "Add to favorites" });
    const actionElement = action.element() as HTMLElement;
    expect(actionElement.closest('[data-slot="mobile-list-row"]')).toBeNull();
    const actionRect = actionElement.getBoundingClientRect();
    expect(Math.min(actionRect.width, actionRect.height)).toBeGreaterThanOrEqual(44);
    await action.click();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();

    await page.getByRole("button", { name: /GPT-5 Codex/u }).click();
    expect(onSelect).toHaveBeenCalledWith("codex:gpt-5-codex");
  });

  it("scrolls its own list rather than the page at 320px with a very long option label", async () => {
    await page.viewport(320, 568);
    mounted = await render(
      <Harness
        withSearch
        groups={[
          {
            id: "codex",
            label: "Codex",
            options: Array.from({ length: 24 }, (_, index) => ({
              id: `codex:model-${index}`,
              label: `Claude Opus 4.6 (long context, extended thinking) preview build ${index}`,
              secondaryText: "OpenCode · GitHub Copilot · Anthropic",
            })),
          },
        ]}
      />,
    );
    await page.getByTestId("sheet-trigger").click();
    const popup = await waitForSettledPopup();

    // Measured, not the literal the viewport was REQUESTED at: the runner
    // scales the emulated viewport, so asserting against a constant the page
    // never confirmed is the shape of the 151px-column incident.
    const width = window.innerWidth;
    expect(width).toBeLessThanOrEqual(320);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    expect(document.body.scrollWidth).toBeLessThanOrEqual(width);
    expect(popup.getBoundingClientRect().right).toBeLessThanOrEqual(width + 0.5);

    const panel = document.querySelector<HTMLElement>('[data-slot="mobile-sheet-panel"]')!;
    expect(getComputedStyle(panel).overflowY).toBe("auto");
    expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight);
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 0.5);
  });
});
