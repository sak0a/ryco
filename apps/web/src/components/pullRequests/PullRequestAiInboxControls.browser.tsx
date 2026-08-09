import "../../index.css";

import {
  ProviderInstanceId,
  type PullRequestAiConfiguration,
  type PullRequestAiModelSelection,
} from "@ryco/contracts";
import { useState } from "react";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  PullRequestAiInboxControls,
  type PullRequestAiModelChoice,
} from "./PullRequestAiInboxControls";

const codexInstanceId = ProviderInstanceId.make("codex");

const models: ReadonlyArray<PullRequestAiModelChoice> = [
  {
    key: "codex::gpt-5.6-luna",
    label: "Codex · GPT-5.6 Luna",
    description: "codex / gpt-5.6-luna",
    selection: { instanceId: codexInstanceId, model: "gpt-5.6-luna" },
    capabilities: {
      optionDescriptors: [
        {
          id: "reasoningEffort",
          label: "Effort",
          type: "select",
          options: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium", isDefault: true },
            { id: "high", label: "High" },
          ],
        },
        {
          id: "fastMode",
          label: "Fast mode",
          type: "boolean",
          currentValue: false,
        },
      ],
    },
  },
  {
    key: "codex::gpt-5.4-mini",
    label: "Codex · GPT-5.4 Mini",
    description: "codex / gpt-5.4-mini",
    selection: { instanceId: codexInstanceId, model: "gpt-5.4-mini" },
    capabilities: { optionDescriptors: [] },
  },
];

const initialConfiguration: PullRequestAiConfiguration = {
  backgroundEnabled: false,
  modelSelection: {
    instanceId: codexInstanceId,
    model: "gpt-5.6-luna",
    options: [
      { id: "reasoningEffort", value: "medium" },
      { id: "fastMode", value: false },
    ],
  },
  intervalMinutes: 180,
  maxPullRequests: 25,
  maxDeepAnalyses: 8,
  activeWindowDays: 14,
  includeDrafts: false,
  resourceMode: "balanced",
};

function Harness() {
  const [configuration, setConfiguration] = useState(initialConfiguration);
  const onModelChange = (modelSelection: PullRequestAiModelSelection) =>
    setConfiguration((current) => ({ ...current, modelSelection }));

  return (
    <PullRequestAiInboxControls
      configuration={configuration}
      models={models}
      activeRuns={[]}
      analyzedCount={0}
      visibleCount={4}
      error={null}
      onModelChange={onModelChange}
      onConfigurationChange={setConfiguration}
      onAnalyze={() => undefined}
      onCancel={() => undefined}
    />
  );
}

describe("PullRequestAiInboxControls", () => {
  let mounted: Awaited<ReturnType<typeof render>> | null = null;

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    document.body.innerHTML = "";
  });

  it("keeps model, effort, and fast mode together inside Configure", async () => {
    mounted = await render(<Harness />);

    await expect.element(page.getByRole("button", { name: /Configure/u })).toBeVisible();
    await expect
      .element(page.getByRole("combobox", { name: "AI inbox model" }))
      .not.toBeInTheDocument();

    await page.getByRole("button", { name: /Configure/u }).click();

    await expect.element(page.getByRole("combobox", { name: "AI inbox model" })).toBeVisible();
    await expect.element(page.getByRole("combobox", { name: "AI analysis effort" })).toBeVisible();
    const fastMode = page.getByRole("switch", { name: "Fast analysis" });
    await expect.element(fastMode).not.toBeChecked();

    await fastMode.click();
    await expect.element(fastMode).toBeChecked();

    await page.getByRole("combobox", { name: "AI analysis effort" }).click();
    await page.getByRole("option", { name: "High" }).click();
    await expect
      .element(page.getByRole("combobox", { name: "AI analysis effort" }))
      .toHaveTextContent("High");
  });
});
