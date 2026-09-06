import { ProviderDriverKind, ProviderInstanceId } from "@ryco/contracts";
import { expect, it } from "vite-plus/test";
import { BUNDLED_MODEL_MANIFEST, type ModelManifestData } from "./ModelManifest.ts";
import { resolveHandoffBudgetFromManifest } from "./ModelContextWindow.ts";

it("resolves bundled Claude defaults, selections and fixed windows", () => {
  const resolve = (model: string, options?: Array<{ id: string; value: string }>) =>
    resolveHandoffBudgetFromManifest(
      BUNDLED_MODEL_MANIFEST,
      ProviderDriverKind.make("claudeAgent"),
      { instanceId: ProviderInstanceId.make("claude"), model, ...(options ? { options } : {}) },
    );
  expect(resolve("claude-opus-5").contextWindowTokens).toBe(1_000_000);
  expect(
    resolve("claude-opus-5", [{ id: "contextWindow", value: "200k" }]).contextWindowTokens,
  ).toBe(200_000);
  expect(resolve("OPUS-5").contextWindowTokens).toBe(1_000_000);
  expect(
    resolve("claude-opus-5", [{ id: "contextWindow", value: " 200k " }]).contextWindowTokens,
  ).toBe(200_000);
  expect(
    resolve("claude-opus-5", [{ id: "contextWindow", value: "obsolete" }]).contextWindowTokens,
  ).toBe(1_000_000);
  expect(resolve("claude-fable-5").contextWindowTokens).toBe(1_000_000);
  expect(resolve("claude-unknown-1m").budgetSource).toBe("default");
});

it("honors the provider's current window over the descriptor default", () => {
  const manifest: ModelManifestData = {
    ...BUNDLED_MODEL_MANIFEST,
    providers: {
      claudeAgent: {
        profiles: {
          test: {
            capabilities: {
              optionDescriptors: [
                {
                  id: "contextWindow",
                  label: "Context window",
                  type: "select",
                  currentValue: "200k",
                  options: [
                    { id: "200k", label: "200k" },
                    { id: "1m", label: "1M", isDefault: true },
                  ],
                },
              ],
            },
            adapter: { claudeCode: { contextWindowTokens: { "200k": 200_000, "1m": 1_000_000 } } },
          },
        },
        models: [{ slug: "test", name: "Test", profile: "test", status: "current" }],
      },
    },
  };
  expect(
    resolveHandoffBudgetFromManifest(manifest, ProviderDriverKind.make("claudeAgent"), {
      instanceId: ProviderInstanceId.make("claude"),
      model: "test",
    }).contextWindowTokens,
  ).toBe(200_000);
});
