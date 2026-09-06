import { ProviderDriverKind, ProviderInstanceId } from "@ryco/contracts";
import { expect, it } from "vite-plus/test";
import { BUNDLED_MODEL_MANIFEST } from "./ModelManifest.ts";
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
  expect(resolve("claude-fable-5").contextWindowTokens).toBe(1_000_000);
  expect(resolve("claude-unknown-1m").budgetSource).toBe("default");
});
