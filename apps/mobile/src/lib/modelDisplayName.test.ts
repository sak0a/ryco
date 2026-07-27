import { describe, expect, it } from "vite-plus/test";

import { shortModelName } from "./modelDisplayName";

describe("shortModelName", () => {
  it("drops the provider prefix the surrounding UI already states", () => {
    expect(shortModelName("Claude Opus 4.8", "Claude")).toBe("Opus 4.8");
    expect(shortModelName("Claude Fable 5", "Claude")).toBe("Fable 5");
    expect(shortModelName("Claude Sonnet 4.6", "Claude")).toBe("Sonnet 4.6");
    expect(shortModelName("Claude Haiku 4.5", "Claude")).toBe("Haiku 4.5");
  });

  it("leaves a name alone when it does not start with the provider", () => {
    expect(shortModelName("GPT-5.4", "Codex")).toBe("GPT-5.4");
    expect(shortModelName("Opus 4.8", "Claude")).toBe("Opus 4.8");
  });

  it("only strips on a word boundary", () => {
    // Not "ual" — the prefix has to be a whole word.
    expect(shortModelName("Codexual", "Codex")).toBe("Codexual");
    expect(shortModelName("Codex-Mini", "Codex")).toBe("Mini");
    expect(shortModelName("Codex: Fast", "Codex")).toBe("Fast");
  });

  it("never returns an empty label", () => {
    // A model named exactly after its provider keeps its name.
    expect(shortModelName("Claude", "Claude")).toBe("Claude");
    expect(shortModelName("Claude   ", "Claude")).toBe("Claude");
  });

  it("is case-insensitive about the prefix but preserves the rest verbatim", () => {
    expect(shortModelName("claude Opus 4.8", "Claude")).toBe("Opus 4.8");
    expect(shortModelName("CLAUDE Opus 4.8", "Claude")).toBe("Opus 4.8");
  });

  it("tolerates a missing or blank provider label", () => {
    expect(shortModelName("Claude Opus 4.8", "")).toBe("Claude Opus 4.8");
    expect(shortModelName("Claude Opus 4.8", "   ")).toBe("Claude Opus 4.8");
  });

  it("trims surrounding whitespace", () => {
    expect(shortModelName("  Claude Opus 4.8  ", "Claude")).toBe("Opus 4.8");
  });
});
