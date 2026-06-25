import type { BrowserSessionSnapshot, ProviderDriverKind } from "@ryco/contracts";
import { Context, Effect, Layer } from "effect";

import { BrowserService } from "../../browser/BrowserService.ts";
import {
  type BrowserRuntimeToolCallError,
  type BrowserRuntimeToolCallInput,
  type ProviderBrowserToolSupport,
  executeBrowserRuntimeToolCall,
  resolveProviderBrowserToolSupport,
} from "./BrowserRuntimeTool.ts";

export interface ProviderRuntimeToolRegistryShape {
  readonly getBrowserSupport: (provider: ProviderDriverKind) => ProviderBrowserToolSupport;
  readonly executeBrowserTool: (
    input: BrowserRuntimeToolCallInput,
  ) => Effect.Effect<BrowserSessionSnapshot, BrowserRuntimeToolCallError>;
}

export class ProviderRuntimeToolRegistry extends Context.Service<
  ProviderRuntimeToolRegistry,
  ProviderRuntimeToolRegistryShape
>()("ryco/provider/tools/ProviderRuntimeToolRegistry") {}

export const ProviderRuntimeToolRegistryLive = Layer.effect(
  ProviderRuntimeToolRegistry,
  Effect.gen(function* () {
    const browser = yield* BrowserService;
    return {
      getBrowserSupport: resolveProviderBrowserToolSupport,
      executeBrowserTool: (input) => executeBrowserRuntimeToolCall(browser, input),
    } satisfies ProviderRuntimeToolRegistryShape;
  }),
);
