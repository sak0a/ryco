import "../../index.css";

import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { ContextWindowChip } from "./ContextWindowChip";

const ctxDescriptor = {
  id: "contextWindow",
  label: "Context Window",
  type: "select" as const,
  options: [
    { id: "200k", label: "200k", isDefault: true },
    { id: "1m", label: "1M" },
  ],
  currentValue: "200k",
} as const;

describe("ContextWindowChip", () => {
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

  it("renders the current value label and opens menu to pick another", async () => {
    const onChangeDescriptors = vi.fn();
    mounted = await render(
      <ContextWindowChip
        descriptor={ctxDescriptor}
        descriptors={[ctxDescriptor]}
        onChangeDescriptors={onChangeDescriptors}
      />,
    );
    const chip = page.getByRole("button", { name: /context window/i });
    await vi.waitFor(async () => {
      await expect.element(chip).toHaveTextContent("200k");
    });
    await chip.click();
    await page.getByText("1M").click();
    expect(onChangeDescriptors).toHaveBeenCalledOnce();
    const [next] = onChangeDescriptors.mock.calls[0]!;
    expect(next[0]!.currentValue).toBe("1m");
  });
});
