import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@ryco/contracts";

import { providerSupportsGeneralFileAttachments } from "./providerCapabilities.ts";

describe("providerSupportsGeneralFileAttachments", () => {
  it("accepts general file attachments for every driver", () => {
    for (const driver of [
      "copilot",
      "opencode",
      "codex",
      "claudeAgent",
      "cursor",
      "grok",
    ] as const) {
      expect(providerSupportsGeneralFileAttachments(ProviderDriverKind.make(driver))).toBe(true);
    }
  });
});
