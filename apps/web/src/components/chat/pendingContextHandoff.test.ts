import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@ryco/contracts";
import { createModelCapabilities, createModelSelection } from "@ryco/shared/model";
import { describe, expect, it } from "vite-plus/test";

import { deriveProviderInstanceEntries } from "../../providerInstances";
import { derivePendingContextHandoff } from "./pendingContextHandoff";

const sourceSelection = createModelSelection(ProviderInstanceId.make("codex_work"), "gpt-5.6-sol");
const targetSelection = createModelSelection(
  ProviderInstanceId.make("claude_work"),
  "claude-fable-5",
);

function provider(input: {
  readonly instanceId: string;
  readonly driverKind: string;
  readonly displayName: string;
  readonly models: ServerProvider["models"];
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driverKind),
    displayName: input.displayName,
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-05T00:00:00.000Z",
    models: input.models,
    slashCommands: [],
    skills: [],
  };
}

const capabilities = createModelCapabilities({ optionDescriptors: [] });
const providers = [
  provider({
    instanceId: sourceSelection.instanceId,
    driverKind: "codex",
    displayName: "Codex Work",
    models: [
      {
        slug: sourceSelection.model,
        name: "GPT-5.6 Sol",
        isCustom: false,
        capabilities,
      },
    ],
  }),
  provider({
    instanceId: targetSelection.instanceId,
    driverKind: "claudeAgent",
    displayName: "Claude Work",
    models: [
      {
        slug: targetSelection.model,
        name: "Claude Fable 5",
        shortName: "Fable 5",
        isCustom: false,
        capabilities,
      },
    ],
  }),
];
const entries = deriveProviderInstanceEntries(providers);
const modelOptionsByInstance = new Map(
  providers.map((snapshot) => [
    snapshot.instanceId,
    snapshot.models.map((model) => ({
      slug: model.slug,
      name: model.name,
      ...(model.shortName ? { shortName: model.shortName } : {}),
      ...(model.subProvider ? { subProvider: model.subProvider } : {}),
      isCustom: model.isCustom,
    })),
  ]),
);

describe("derivePendingContextHandoff", () => {
  it("presents an immediate picker-compatible source-to-target transition", () => {
    expect(
      derivePendingContextHandoff({
        threadStarted: true,
        isPhoneTier: false,
        canonicalSelection: sourceSelection,
        targetSelection,
        providerInstanceEntries: entries,
        modelOptionsByInstance,
      }),
    ).toMatchObject({
      source: {
        providerInstanceId: "codex_work",
        modelSlug: "gpt-5.6-sol",
        modelDisplayName: "GPT-5.6 Sol",
      },
      target: {
        providerInstanceId: "claude_work",
        modelSlug: "claude-fable-5",
        modelDisplayName: "Fable 5",
      },
    });
  });

  it("does not present a handoff for options-only changes or canonical reselection", () => {
    const optionsOnlyTarget = createModelSelection(
      sourceSelection.instanceId,
      sourceSelection.model,
      [{ id: "reasoningEffort", value: "high" }],
    );

    for (const selection of [sourceSelection, optionsOnlyTarget]) {
      expect(
        derivePendingContextHandoff({
          threadStarted: true,
          isPhoneTier: false,
          canonicalSelection: sourceSelection,
          targetSelection: selection,
          providerInstanceEntries: entries,
          modelOptionsByInstance,
        }),
      ).toBeNull();
    }
  });

  it("is absent before a thread starts and throughout the frozen phone tier", () => {
    for (const [threadStarted, isPhoneTier] of [
      [false, false],
      [true, true],
    ] as const) {
      expect(
        derivePendingContextHandoff({
          threadStarted,
          isPhoneTier,
          canonicalSelection: sourceSelection,
          targetSelection,
          providerInstanceEntries: entries,
          modelOptionsByInstance,
        }),
      ).toBeNull();
    }
  });

  it("leaves the raw slug as the rendering fallback for a missing model", () => {
    const unknownTarget = createModelSelection(targetSelection.instanceId, "custom/unknown");
    expect(
      derivePendingContextHandoff({
        threadStarted: true,
        isPhoneTier: false,
        canonicalSelection: sourceSelection,
        targetSelection: unknownTarget,
        providerInstanceEntries: entries,
        modelOptionsByInstance,
      })?.target,
    ).toEqual({
      providerInstanceId: targetSelection.instanceId,
      driverKind: ProviderDriverKind.make("claudeAgent"),
      providerDisplayName: "Claude Work",
      modelSlug: "custom/unknown",
    });
  });
});
