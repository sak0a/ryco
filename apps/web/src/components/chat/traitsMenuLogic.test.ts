import { describe, expect, it, vi } from "vitest";
import { applyDescriptorSelection } from "./traitsMenuLogic";

function selectDescriptor(
  id: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
  currentValue: string,
  promptInjectedValues?: ReadonlyArray<string>,
) {
  return {
    id,
    label: id,
    type: "select" as const,
    options: [...options],
    currentValue,
    ...(promptInjectedValues ? { promptInjectedValues: [...promptInjectedValues] } : {}),
  };
}

describe("applyDescriptorSelection", () => {
  const baseEffort = selectDescriptor(
    "effort",
    [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High", isDefault: true },
      { id: "ultrathink", label: "Ultrathink" },
    ],
    "high",
    ["ultrathink"],
  );

  it("replaces the descriptor's currentValue for a regular option", () => {
    const onChangeDescriptors = vi.fn();
    const onPromptChange = vi.fn();
    applyDescriptorSelection({
      descriptors: [baseEffort],
      descriptor: baseEffort,
      value: "medium",
      prompt: "",
      primarySelectDescriptorId: "effort",
      ultrathinkInBodyText: false,
      ultrathinkPromptControlled: false,
      onChangeDescriptors,
      onPromptChange,
    });
    expect(onChangeDescriptors).toHaveBeenCalledOnce();
    const [nextDescriptors] = onChangeDescriptors.mock.calls[0]!;
    expect(nextDescriptors[0].currentValue).toBe("medium");
    expect(onPromptChange).not.toHaveBeenCalled();
  });

  it("injects the Ultrathink: prefix when selecting a prompt-injected value", () => {
    const onChangeDescriptors = vi.fn();
    const onPromptChange = vi.fn();
    applyDescriptorSelection({
      descriptors: [baseEffort],
      descriptor: baseEffort,
      value: "ultrathink",
      prompt: "hello",
      primarySelectDescriptorId: "effort",
      ultrathinkInBodyText: false,
      ultrathinkPromptControlled: false,
      onChangeDescriptors,
      onPromptChange,
    });
    expect(onPromptChange).toHaveBeenCalledOnce();
    expect(onPromptChange.mock.calls[0]![0]).toMatch(/^Ultrathink:/i);
    expect(onChangeDescriptors).not.toHaveBeenCalled();
  });

  it("strips Ultrathink: prefix when switching away from ultrathink", () => {
    const onChangeDescriptors = vi.fn();
    const onPromptChange = vi.fn();
    applyDescriptorSelection({
      descriptors: [baseEffort],
      descriptor: baseEffort,
      value: "high",
      prompt: "Ultrathink: do the thing",
      primarySelectDescriptorId: "effort",
      ultrathinkInBodyText: false,
      ultrathinkPromptControlled: true,
      onChangeDescriptors,
      onPromptChange,
    });
    expect(onPromptChange).toHaveBeenCalledOnce();
    expect(onPromptChange.mock.calls[0]![0]).toBe("do the thing");
    expect(onChangeDescriptors).toHaveBeenCalledOnce();
    const [nextDescriptors] = onChangeDescriptors.mock.calls[0]!;
    expect(nextDescriptors[0].currentValue).toBe("high");
  });

  it("is a no-op when ultrathink appears in the body text for the primary descriptor", () => {
    const onChangeDescriptors = vi.fn();
    const onPromptChange = vi.fn();
    applyDescriptorSelection({
      descriptors: [baseEffort],
      descriptor: baseEffort,
      value: "low",
      prompt: "do the ultrathink thing",
      primarySelectDescriptorId: "effort",
      ultrathinkInBodyText: true,
      ultrathinkPromptControlled: true,
      onChangeDescriptors,
      onPromptChange,
    });
    expect(onChangeDescriptors).not.toHaveBeenCalled();
    expect(onPromptChange).not.toHaveBeenCalled();
  });
});
