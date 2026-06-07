import "../../index.css";

import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { ThinkingChip } from "./ThinkingChip";

const offDescriptor = {
  id: "thinking",
  label: "Thinking",
  type: "boolean" as const,
  currentValue: false,
} as const;

describe("ThinkingChip", () => {
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

  it("toggles from off to on", async () => {
    const onChangeDescriptors = vi.fn();
    mounted = await render(
      <ThinkingChip
        descriptor={offDescriptor}
        descriptors={[offDescriptor]}
        onChangeDescriptors={onChangeDescriptors}
      />,
    );
    const chip = page.getByRole("button", { name: /thinking/i });
    await vi.waitFor(async () => {
      await expect.element(chip).toHaveAttribute("aria-pressed", "false");
    });
    await chip.click();
    expect(onChangeDescriptors).toHaveBeenCalledOnce();
    const [next] = onChangeDescriptors.mock.calls[0]!;
    expect(next[0]!.currentValue).toBe(true);
  });
});
