import { describe, expect, it } from "vitest";
import { CopilotSettings } from "@ryco/contracts";
import { Schema } from "effect";

import { getCopilotFallbackModels } from "./CopilotProvider.ts";

describe("getCopilotFallbackModels", () => {
  it("exposes built-in Copilot models with reasoning effort capabilities", () => {
    const models = getCopilotFallbackModels(Schema.decodeSync(CopilotSettings)({}));

    const gpt5 = models.find((model) => model.slug === "gpt-5");
    const gpt5Mini = models.find((model) => model.slug === "gpt-5-mini");
    const claudeSonnet = models.find((model) => model.slug === "claude-sonnet-4");

    expect(gpt5?.capabilities?.optionDescriptors).toEqual([
      {
        id: "reasoningEffort",
        label: "Reasoning",
        type: "select",
        options: [
          { id: "xhigh", label: "Extra High" },
          { id: "high", label: "High", isDefault: true },
          { id: "medium", label: "Medium" },
          { id: "low", label: "Low" },
        ],
        currentValue: "high",
      },
    ]);
    expect(gpt5Mini?.capabilities).toEqual(gpt5?.capabilities);
    expect(claudeSonnet?.capabilities?.optionDescriptors).toEqual([]);
  });

  it("normalizes custom Copilot model aliases", () => {
    const models = getCopilotFallbackModels({
      customModels: ["gpt-5.4", "gpt-5.4-mini", "custom-copilot-model"],
    });

    expect(models.map((model) => model.slug)).toEqual([
      "gpt-5",
      "gpt-5-mini",
      "claude-sonnet-4",
      "custom-copilot-model",
    ]);
  });
});
