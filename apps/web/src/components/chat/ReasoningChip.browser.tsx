import "../../index.css";

import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { ReasoningChip } from "./ReasoningChip";
import { useUiStateStore } from "../../uiStateStore";

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
    useUiStateStore.getState().setReasoningIndicatorStyle("icon-dots");
  });

  it("renders dots matching the model's available levels for high", async () => {
    // Descriptor has 4 options total; one is prompt-injected (ultrathink).
    // Effective scale: 3 dots. "high" is the 3rd option → 3/3 filled.
    useUiStateStore.getState().setReasoningIndicatorStyle("icon-dots");
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
      const dotsOn = document.querySelectorAll('[data-testid="reasoning-dot-on"]');
      expect(dotsOn.length).toBe(3);
      const dotsOff = document.querySelectorAll('[data-testid="reasoning-dot-off"]');
      expect(dotsOff.length).toBe(0);
    });
  });

  it("scales dot count to the model's available levels (Codex GPT-5)", async () => {
    // A Codex-like descriptor with 4 non-injected levels: minimal/low/medium/high.
    // "medium" is the 3rd option → 3/4 filled, 1 off.
    useUiStateStore.getState().setReasoningIndicatorStyle("icon-dots");
    const codexDescriptor = {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select" as const,
      options: [
        { id: "minimal", label: "Minimal" },
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium", isDefault: true },
        { id: "high", label: "High" },
      ],
      currentValue: "medium",
    };
    mounted = await render(
      <ReasoningChip
        descriptor={codexDescriptor}
        descriptors={[codexDescriptor]}
        prompt=""
        primarySelectDescriptorId="reasoningEffort"
        ultrathinkInBodyText={false}
        ultrathinkPromptControlled={false}
        onChangeDescriptors={vi.fn()}
        onPromptChange={vi.fn()}
      />,
    );
    await vi.waitFor(() => {
      const dotsOn = document.querySelectorAll('[data-testid="reasoning-dot-on"]');
      expect(dotsOn.length).toBe(3);
      const dotsOff = document.querySelectorAll('[data-testid="reasoning-dot-off"]');
      expect(dotsOff.length).toBe(1);
    });
  });

  it("renders abbreviated text 'High' in text style", async () => {
    useUiStateStore.getState().setReasoningIndicatorStyle("text");
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
    });
  });

  it("opens the menu on click and applies the chosen level", async () => {
    const onChangeDescriptors = vi.fn();
    useUiStateStore.getState().setReasoningIndicatorStyle("icon-dots");
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
    await page.getByText("Low").click();
    expect(onChangeDescriptors).toHaveBeenCalledOnce();
    const [next] = onChangeDescriptors.mock.calls[0]!;
    expect(next[0]!.currentValue).toBe("low");
  });

  it("shows the Ultrathink variant when prompt-controlled", async () => {
    useUiStateStore.getState().setReasoningIndicatorStyle("icon-dots");
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
    });
  });
});
