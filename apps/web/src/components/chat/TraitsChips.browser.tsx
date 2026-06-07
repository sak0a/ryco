import "../../index.css";

import { ProviderDriverKind } from "@ryco/contracts";
import { createModelCapabilities } from "@ryco/shared/model";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { TraitsChips } from "./TraitsChips";

const provider = ProviderDriverKind.make("claudeAgent");

function selectDescriptor(
  id: string,
  label: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
) {
  return {
    id,
    label,
    type: "select" as const,
    options: [...options],
  };
}

function booleanDescriptor(id: string, label: string) {
  return { id, label, type: "boolean" as const };
}

function modelWith(
  optionDescriptors: ReadonlyArray<
    ReturnType<typeof selectDescriptor> | ReturnType<typeof booleanDescriptor>
  >,
) {
  return {
    slug: "test-model",
    name: "Test Model",
    isCustom: false,
    capabilities: createModelCapabilities({ optionDescriptors: [...optionDescriptors] }),
  };
}

describe("TraitsChips", () => {
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

  it("renders Reasoning + Fast + Context chips when all capabilities are present", async () => {
    const onModelOptionsChange = vi.fn();
    mounted = await render(
      <TraitsChips
        provider={provider}
        model="test-model"
        models={[
          modelWith([
            selectDescriptor("effort", "Reasoning", [
              { id: "low", label: "Low" },
              { id: "medium", label: "Medium" },
              { id: "high", label: "High", isDefault: true },
            ]),
            booleanDescriptor("fastMode", "Fast Mode"),
            selectDescriptor("contextWindow", "Context Window", [
              { id: "200k", label: "200k", isDefault: true },
              { id: "1m", label: "1M" },
            ]),
          ]),
        ]}
        prompt=""
        modelOptions={undefined}
        onPromptChange={() => {}}
        onModelOptionsChange={onModelOptionsChange}
      />,
    );
    await expect.element(page.getByRole("button", { name: /reasoning/i })).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: /fast mode/i })).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: /context window/i })).toBeInTheDocument();
  });

  it("omits Fast chip when capability is absent", async () => {
    mounted = await render(
      <TraitsChips
        provider={provider}
        model="test-model"
        models={[
          modelWith([
            selectDescriptor("effort", "Reasoning", [
              { id: "low", label: "Low" },
              { id: "high", label: "High", isDefault: true },
            ]),
            selectDescriptor("contextWindow", "Context Window", [
              { id: "200k", label: "200k", isDefault: true },
            ]),
          ]),
        ]}
        prompt=""
        modelOptions={undefined}
        onPromptChange={() => {}}
        onModelOptionsChange={() => {}}
      />,
    );
    await expect.element(page.getByRole("button", { name: /reasoning/i })).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: /fast mode/i })).not.toBeInTheDocument();
  });

  it("renders a generic chip for unknown select descriptors (OpenCode variant)", async () => {
    mounted = await render(
      <TraitsChips
        provider={provider}
        model="test-model"
        models={[
          modelWith([
            selectDescriptor("variant", "Variant", [
              { id: "small", label: "Small" },
              { id: "large", label: "Large", isDefault: true },
            ]),
            selectDescriptor("agent", "Agent", [{ id: "build", label: "Build", isDefault: true }]),
          ]),
        ]}
        prompt=""
        modelOptions={undefined}
        onPromptChange={() => {}}
        onModelOptionsChange={() => {}}
      />,
    );
    await expect.element(page.getByRole("button", { name: /variant/i })).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: /agent/i })).toBeInTheDocument();
  });

  it("renders only the Thinking chip for Haiku-like capability", async () => {
    mounted = await render(
      <TraitsChips
        provider={provider}
        model="test-model"
        models={[modelWith([booleanDescriptor("thinking", "Thinking")])]}
        prompt=""
        modelOptions={undefined}
        onPromptChange={() => {}}
        onModelOptionsChange={() => {}}
      />,
    );
    await expect.element(page.getByRole("button", { name: /thinking/i })).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: /reasoning/i })).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: /fast mode/i })).not.toBeInTheDocument();
  });
});
