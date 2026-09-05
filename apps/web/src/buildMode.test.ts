import { ProviderDriverKind, ProviderInstanceId, type ModelSelection } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveBuildModeModelSelection } from "./buildMode";

describe("resolveBuildModeModelSelection", () => {
  const selection: ModelSelection = {
    instanceId: ProviderInstanceId.make("custom-instance"),
    model: "test-model",
    options: [
      { id: "agent", value: "plan" },
      { id: "variant", value: "high" },
    ],
  };

  it("overrides a saved OpenCode plan agent while preserving model and other options", () => {
    expect(resolveBuildModeModelSelection(ProviderDriverKind.make("opencode"), selection)).toEqual({
      ...selection,
      options: [
        { id: "variant", value: "high" },
        { id: "agent", value: "build" },
      ],
    });
    expect(selection.options?.[0]?.value).toBe("plan");
  });

  it("explicitly selects build when OpenCode has no agent option", () => {
    expect(
      resolveBuildModeModelSelection(ProviderDriverKind.make("opencode"), {
        instanceId: selection.instanceId,
        model: selection.model,
      }).options,
    ).toEqual([{ id: "agent", value: "build" }]);
  });

  it.each(["cursor", "copilot", "codex", "claudeAgent"])(
    "preserves %s options because it uses the shared interaction mode",
    (provider) => {
      expect(resolveBuildModeModelSelection(ProviderDriverKind.make(provider), selection)).toBe(
        selection,
      );
    },
  );
});
