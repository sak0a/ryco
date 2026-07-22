import { describe, expect, it } from "vite-plus/test";

import { parseAntigravityModels } from "./AntigravityProvider.ts";

describe("AntigravityProvider", () => {
  it("parses agy models output with Auto first and duplicate lines ignored", () => {
    expect(
      parseAntigravityModels(
        [
          "Gemini 3.5 Flash (Medium)",
          "Claude Sonnet 4.6 (Thinking)",
          "",
          "Gemini 3.5 Flash (Medium)",
        ].join("\n"),
      ).map((model) => model.slug),
    ).toEqual(["auto", "Gemini 3.5 Flash (Medium)", "Claude Sonnet 4.6 (Thinking)"]);
  });
});
