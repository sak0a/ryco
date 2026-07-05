import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_BINARY_PATH, resolveCopilotCliPath } from "./CopilotAdapter.types.ts";
import { normalizeUsage } from "./CopilotAdapter.types.ts";

describe("resolveCopilotCliPath", () => {
  it("resolves the default copilot command from PATH", () => {
    const root = mkdtempSync(join(tmpdir(), "copilot-cli-path-"));
    const binDir = join(root, "bin");
    const copilotPath = join(binDir, "copilot");

    try {
      mkdirSync(binDir, { recursive: true });
      writeFileSync(copilotPath, "#!/bin/sh\n", { encoding: "utf8", mode: 0o755 });

      expect(resolveCopilotCliPath({ binaryPath: DEFAULT_BINARY_PATH }, { PATH: binDir })).toBe(
        copilotPath,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the default command name when copilot is not on PATH", () => {
    expect(resolveCopilotCliPath({ binaryPath: DEFAULT_BINARY_PATH }, { PATH: "" })).toBe(
      DEFAULT_BINARY_PATH,
    );
  });
});

describe("normalizeUsage", () => {
  it("treats cached reads as a discounted subset of input tokens", () => {
    const usage = normalizeUsage({
      type: "assistant.usage",
      timestamp: "2026-06-10T00:00:00.000Z",
      data: {
        inputTokens: 100,
        cacheReadTokens: 25,
        outputTokens: 10,
        reasoningTokens: 5,
      },
    } as never);

    expect(usage).toMatchObject({
      usedTokens: 135,
      totalProcessedTokens: 135,
      inputTokens: 125,
      cachedInputTokens: 25,
      outputTokens: 10,
      reasoningOutputTokens: 5,
      lastInputTokens: 125,
      lastCachedInputTokens: 25,
      lastOutputTokens: 10,
      lastReasoningOutputTokens: 5,
    });
  });
});
