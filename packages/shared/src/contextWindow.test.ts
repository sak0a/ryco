import { describe, expect, it } from "vite-plus/test";
import { resolveContextHandoffInputBudget as budget } from "./contextWindow.ts";

const metadata = [
  {
    slug: "claude-model",
    aliases: ["alias"],
    defaultContextWindow: "200k",
    contextWindowTokens: { "200k": 200_000, "1m": 1_000_000 },
  },
];

describe("context window handoff budget", () => {
  it("uses authoritative metadata, aliases and selected windows", () => {
    expect(budget("claudeAgent", "alias", undefined, metadata)).toEqual({
      maxInputChars: 280_000,
      budgetSource: "manifest",
      contextWindowTokens: 200_000,
    });
    expect(
      budget(
        "claudeAgent",
        "claude-model",
        { options: [{ id: "contextWindow", value: "1m" }] },
        metadata,
      ).maxInputChars,
    ).toBe(1_400_000);
    expect(
      budget("claudeAgent", "model-1m", undefined, [
        { slug: "model-1m", fixedContextWindowTokens: 200_000 },
      ]).maxInputChars,
    ).toBe(280_000);
  });
  it.each(["model-1m", "model[1M]", "model_1000000", "1m"])(
    "parses conservative window slug %s",
    (slug) => {
      expect(budget("codex", slug)).toEqual({
        maxInputChars: 1_400_000,
        budgetSource: "slug",
        contextWindowTokens: 1_000_000,
      });
    },
  );
  it.each([
    "gpt-5.6-sol",
    "model-20260803",
    "model-1maybe",
    "model-200k-1m",
    "model-0k",
    "model-1.5m",
    "model-7b",
  ])("defaults for ambiguous or unrelated slug %s", (slug) => {
    expect(budget("codex", slug)).toEqual({
      maxInputChars: 120_000,
      budgetSource: "default",
      contextWindowTokens: null,
    });
  });
  it.each([
    undefined,
    null,
    {},
    [{ slug: "model-1m", fixedContextWindowTokens: NaN }],
    [{ slug: "model-1m", fixedContextWindowTokens: -1 }],
    [{ slug: "model-1m", fixedContextWindowTokens: "1000000" }],
  ])("defaults for absent or malformed authoritative metadata", (metadata) => {
    expect(budget("claudeAgent", "model-1m", undefined, metadata).maxInputChars).toBe(120_000);
  });
  it("does not parse unknown authoritative selections", () => {
    expect(
      budget(
        "claudeAgent",
        "claude-model",
        { options: [{ id: "contextWindow", value: "2m" }] },
        metadata,
      ).budgetSource,
    ).toBe("default");
  });
  it("clamps known windows to the supported input range", () => {
    expect(budget("codex", "model-4k").maxInputChars).toBe(120_000);
    expect(budget("codex", "model-10m").maxInputChars).toBe(1_400_000);
  });
});
