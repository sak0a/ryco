import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@ryco/contracts";

import { providerSupportsGeneralFileAttachments } from "./providerCapabilities.ts";

describe("providerSupportsGeneralFileAttachments", () => {
  it("allows only provider APIs with native general file support", () => {
    expect(providerSupportsGeneralFileAttachments(ProviderDriverKind.make("copilot"))).toBe(true);
    expect(providerSupportsGeneralFileAttachments(ProviderDriverKind.make("opencode"))).toBe(true);
    expect(providerSupportsGeneralFileAttachments(ProviderDriverKind.make("codex"))).toBe(false);
    expect(providerSupportsGeneralFileAttachments(ProviderDriverKind.make("claudeAgent"))).toBe(
      false,
    );
    expect(providerSupportsGeneralFileAttachments(ProviderDriverKind.make("cursor"))).toBe(false);
  });
});
