import "../../index.css";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { ReasoningChip } from "./ReasoningChip";

const effortDescriptor = {
  id: "effort",
  label: "Reasoning",
  type: "select" as const,
  options: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High", isDefault: true },
    { id: "ultrathink", label: "Ultrathink" },
  ],
  currentValue: "high",
  promptInjectedValues: ["ultrathink"],
} as const;

describe("ReasoningChip", () => {
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

  it("always renders an ordinary reasoning level as text without icons or dots", async () => {
    mounted = await render(
      <ReasoningChip
        descriptor={effortDescriptor}
        descriptors={[effortDescriptor]}
        prompt=""
        primarySelectDescriptorId="effort"
        ultrathinkInBodyText={false}
        ultrathinkPromptControlled={false}
        onChangeDescriptors={vi.fn()}
        onPromptChange={vi.fn()}
      />,
    );
    await vi.waitFor(() => {
      const button = document.querySelector("button");
      expect(button?.textContent ?? "").toContain("High");
      expect(button?.querySelector("svg")).toBeNull();
      expect(document.querySelector('[data-testid^="reasoning-dot-"]')).toBeNull();
    });
  });

  it("opens the menu on click and applies the chosen level", async () => {
    const onChangeDescriptors = vi.fn();
    mounted = await render(
      <ReasoningChip
        descriptor={effortDescriptor}
        descriptors={[effortDescriptor]}
        prompt=""
        primarySelectDescriptorId="effort"
        ultrathinkInBodyText={false}
        ultrathinkPromptControlled={false}
        onChangeDescriptors={onChangeDescriptors}
        onPromptChange={vi.fn()}
      />,
    );
    await page.getByLabelText(/reasoning/i).click();
    await vi.waitFor(() => {
      const low = document.querySelector<HTMLElement>('[data-reasoning-level="low"]');
      const medium = document.querySelector<HTMLElement>('[data-reasoning-level="medium"]');
      const high = document.querySelector<HTMLElement>('[data-reasoning-level="high"]');
      const ultrathink = document.querySelector<HTMLElement>('[data-reasoning-level="ultrathink"]');
      expect(low?.className).toContain("text-slate-600");
      expect(medium?.className).toContain("text-blue-600");
      expect(high?.className).toContain("text-indigo-600");
      expect(ultrathink?.className).toContain("text-fuchsia-600");
      expect(
        new Set([low, medium, high, ultrathink].map((item) => getComputedStyle(item!).color)).size,
      ).toBe(4);
    });
    await page.getByText("Low").click();
    expect(onChangeDescriptors).toHaveBeenCalledOnce();
    const [next] = onChangeDescriptors.mock.calls[0]!;
    expect(next[0]!.currentValue).toBe("low");
  });

  it("shows the Ultrathink variant when prompt-controlled", async () => {
    mounted = await render(
      <ReasoningChip
        descriptor={effortDescriptor}
        descriptors={[effortDescriptor]}
        prompt="Ultrathink: yes"
        primarySelectDescriptorId="effort"
        ultrathinkInBodyText={false}
        ultrathinkPromptControlled={true}
        onChangeDescriptors={vi.fn()}
        onPromptChange={vi.fn()}
      />,
    );
    await vi.waitFor(() => {
      const button = document.querySelector("button");
      expect(button?.textContent ?? "").toMatch(/Ultra/i);
      expect(button?.querySelector("svg")).not.toBeNull();
    });
  });

  it("renders the Ultracode level instead of falling back to Medium", async () => {
    // Opus 4.8 exposes an "ultracode" effort. It must render with its own label,
    // not silently normalize to "Med" (the pre-fix fallback behavior).
    const opus48Descriptor = {
      id: "effort",
      label: "Reasoning",
      type: "select" as const,
      options: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High", isDefault: true },
        { id: "xhigh", label: "Extra High" },
        { id: "max", label: "Max" },
        { id: "ultracode", label: "Ultracode" },
        { id: "ultrathink", label: "Ultrathink" },
      ],
      currentValue: "ultracode",
      promptInjectedValues: ["ultrathink"],
    } as const;
    mounted = await render(
      <ReasoningChip
        descriptor={opus48Descriptor}
        descriptors={[opus48Descriptor]}
        prompt=""
        primarySelectDescriptorId="effort"
        ultrathinkInBodyText={false}
        ultrathinkPromptControlled={false}
        onChangeDescriptors={vi.fn()}
        onPromptChange={vi.fn()}
      />,
    );
    await vi.waitFor(() => {
      const button = document.querySelector("button");
      const text = button?.textContent ?? "";
      expect(text).toContain("UCode");
      expect(text).not.toContain("Med");
    });
  });

  it("renders the native Ultra level instead of falling back to Medium", async () => {
    const gpt56Descriptor = {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select" as const,
      options: [
        { id: "none", label: "None" },
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra High" },
        { id: "max", label: "Max" },
        { id: "ultra", label: "Ultra", isDefault: true },
      ],
      currentValue: "ultra",
    } as const;
    mounted = await render(
      <ReasoningChip
        descriptor={gpt56Descriptor}
        descriptors={[gpt56Descriptor]}
        prompt=""
        primarySelectDescriptorId="reasoningEffort"
        ultrathinkInBodyText={false}
        ultrathinkPromptControlled={false}
        onChangeDescriptors={vi.fn()}
        onPromptChange={vi.fn()}
      />,
    );
    await vi.waitFor(() => {
      const button = document.querySelector("button");
      const text = button?.textContent ?? "";
      expect(text).toContain("Ultra");
      expect(text).not.toContain("Med");
    });
  });

  it("preserves the advertised label for an unrecognized future effort", async () => {
    const futureEffortDescriptor = {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select" as const,
      options: [
        { id: "medium", label: "Medium" },
        { id: "ultra-deep", label: "Ultra Deep", isDefault: true },
      ],
      currentValue: "ultra-deep",
    } as const;
    mounted = await render(
      <ReasoningChip
        descriptor={futureEffortDescriptor}
        descriptors={[futureEffortDescriptor]}
        prompt=""
        primarySelectDescriptorId="reasoningEffort"
        ultrathinkInBodyText={false}
        ultrathinkPromptControlled={false}
        onChangeDescriptors={vi.fn()}
        onPromptChange={vi.fn()}
      />,
    );
    await vi.waitFor(() => {
      const button = document.querySelector("button");
      const text = button?.textContent ?? "";
      expect(text).toContain("Ultra Deep");
      expect(text).not.toContain("Med");
      expect(button?.getAttribute("aria-label")).toBe("Reasoning: Ultra Deep");
      expect(button?.getAttribute("title")).toBe("Reasoning: Ultra Deep");
      expect(button?.className).toContain("bg-slate-400/15");
      expect(button?.querySelector("svg")).toBeNull();
    });

    await page.getByRole("button", { name: "Reasoning: Ultra Deep" }).click();
    await vi.waitFor(() => {
      const menuItem = Array.from(document.querySelectorAll('[role="menuitemradio"]')).find(
        (item) => item.textContent?.includes("Ultra Deep"),
      );
      expect(menuItem).toBeTruthy();
    });
  });
});
