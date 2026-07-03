import { Effect, Layer } from "effect";

import { BrowserMcpBridge } from "../../browser/BrowserMcpBridge.ts";
import { resolveProviderBrowserToolSupport } from "./BrowserRuntimeTool.ts";
import { ProviderRuntimeToolRegistry } from "./ProviderRuntimeToolRegistry.ts";

export const providerRuntimeToolRegistryTestLayer = Layer.succeed(ProviderRuntimeToolRegistry, {
  getBrowserSupport: resolveProviderBrowserToolSupport,
  executeBrowserTool: () =>
    Effect.die("ProviderRuntimeToolRegistry.executeBrowserTool is not used in test"),
});

export const browserMcpBridgeTestLayer = Layer.succeed(BrowserMcpBridge, {
  start: () => Effect.succeed({ socketPath: "/tmp/ryco-browser-mcp-test.sock" }),
  stop: () => Effect.void,
});

export const browserRuntimeToolTestLayers = Layer.mergeAll(
  providerRuntimeToolRegistryTestLayer,
  browserMcpBridgeTestLayer,
);
