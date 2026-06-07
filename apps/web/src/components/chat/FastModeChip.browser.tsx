import "../../index.css";

import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { FastModeChip } from "./FastModeChip";

const offDescriptor = {
  id: "fastMode",
  label: "Fast Mode",
  type: "boolean" as const,
  currentValue: false,
} as const;

const onDescriptor = {
  id: "fastMode",
  label: "Fast Mode",
  type: "boolean" as const,
  currentValue: true,
} as const;

describe("FastModeChip", () => {
  let mounted:
    | (Awaited<ReturnType<typeof render>> & {
        cleanup?: () => Promise<void>;
        unmount?: () => Promise<void>;
      })
    | null = null;

  afterEach(async () => {
    if (mounted) {
      const teardown = mounted.cleanup ?? mounted.unmount;
      await teardown?.call(mounted).catch(() => {});
    }
    mounted = null;
    document.body.innerHTML = "";
  });

  it("renders aria-pressed=false when off and toggles to on", async () => {
    const onChangeDescriptors = vi.fn();
    mounted = await render(
      <FastModeChip
        descriptor={offDescriptor}
        descriptors={[offDescriptor]}
        onChangeDescriptors={onChangeDescriptors}
      />,
    );
    const chip = page.getByRole("button", { name: /fast mode/i });
    await vi.waitFor(async () => {
      await expect.element(chip).toHaveAttribute("aria-pressed", "false");
    });
    await chip.click();
    expect(onChangeDescriptors).toHaveBeenCalledOnce();
    const [next] = onChangeDescriptors.mock.calls[0]!;
    expect(next[0]!.currentValue).toBe(true);
  });

  it("renders aria-pressed=true when on and toggles to off", async () => {
    const onChangeDescriptors = vi.fn();
    mounted = await render(
      <FastModeChip
        descriptor={onDescriptor}
        descriptors={[onDescriptor]}
        onChangeDescriptors={onChangeDescriptors}
      />,
    );
    const chip = page.getByRole("button", { name: /fast mode/i });
    await vi.waitFor(async () => {
      await expect.element(chip).toHaveAttribute("aria-pressed", "true");
    });
    await chip.click();
    expect(onChangeDescriptors).toHaveBeenCalledOnce();
    const [next] = onChangeDescriptors.mock.calls[0]!;
    expect(next[0]!.currentValue).toBe(false);
  });
});
