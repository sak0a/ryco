import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_BINARY_PATH, resolveCopilotCliPath } from "./CopilotAdapter.types.ts";

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
