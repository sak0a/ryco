import { BrowserArtifactId, ProviderDriverKind } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveProviderBrowserToolSupport } from "./BrowserRuntimeTool.ts";
import {
  enrichBrowserRuntimeToolCallToolResult,
  mapBrowserRuntimeToolResultToCallToolResult,
} from "./BrowserRuntimeToolHelpers.ts";

describe("BrowserRuntimeToolHelpers", () => {
  it("reports Codex browser tools as unsupported until dynamicTools is in thread/start", () => {
    const codex = resolveProviderBrowserToolSupport(ProviderDriverKind.make("codex"));
    expect(codex.supported).toBe(false);
    expect(codex.reason).toContain("dynamicTools");
    expect(codex.definitions).toEqual([]);
  });

  it("adds screenshot image content when artifact bytes are available", async () => {
    const artifactId = BrowserArtifactId.make("browser-artifact:test");
    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    const mapped = mapBrowserRuntimeToolResultToCallToolResult({
      success: true,
      result: {
        session: { sessionId: "browser-session:test" },
        artifact: {
          artifactId,
          kind: "screenshot",
          mimeType: "image/png",
          byteSize: pngBytes.byteLength,
          createdAt: new Date().toISOString(),
          expiresAt: new Date().toISOString(),
        },
      },
    });

    const enriched = await enrichBrowserRuntimeToolCallToolResult({
      toolName: "browser_screenshot",
      result: mapped,
      readArtifactData: async (id) => (id === artifactId ? pngBytes : null),
    });

    expect(enriched.content).toHaveLength(2);
    expect(enriched.content[0]).toMatchObject({ type: "text" });
    expect(enriched.content[1]).toEqual({
      type: "image",
      data: Buffer.from(pngBytes).toString("base64"),
      mimeType: "image/png",
    });
  });
});
