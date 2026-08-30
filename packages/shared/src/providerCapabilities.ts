import type { ProviderDriverKind } from "@ryco/contracts";

/** Drivers whose native turn API accepts arbitrary file bytes, not only images. */
export function providerSupportsGeneralFileAttachments(provider: ProviderDriverKind): boolean {
  return provider === "copilot" || provider === "opencode";
}
