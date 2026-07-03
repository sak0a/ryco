import type { ProviderDriverKind, ProviderRuntimeEvent, RuntimeItemId } from "@ryco/contracts";
import { Context, Effect, Layer, Option } from "effect";

import { BrowserService } from "../../browser/BrowserService.ts";
import {
  type BrowserRuntimeToolCallError,
  type BrowserRuntimeToolCallInput,
  type BrowserRuntimeToolCallResult,
  type ProviderBrowserToolSupport,
  executeBrowserRuntimeToolCall,
  resolveProviderBrowserToolSupport,
} from "./BrowserRuntimeTool.ts";
import {
  type BrowserToolLifecycleContext,
  makeBrowserToolCompletedEvent,
  makeBrowserToolStartedEvent,
} from "./BrowserToolLifecycleEvents.ts";
import { ProviderRuntimeEventHub } from "./ProviderRuntimeEventHub.ts";

export interface BrowserRuntimeToolExecutionOptions {
  readonly lifecycle?: BrowserToolLifecycleContext;
}

export interface ProviderRuntimeToolRegistryShape {
  readonly getBrowserSupport: (provider: ProviderDriverKind) => ProviderBrowserToolSupport;
  readonly executeBrowserTool: (
    input: BrowserRuntimeToolCallInput,
    options?: BrowserRuntimeToolExecutionOptions,
  ) => Effect.Effect<BrowserRuntimeToolCallResult, BrowserRuntimeToolCallError>;
}

export class ProviderRuntimeToolRegistry extends Context.Service<
  ProviderRuntimeToolRegistry,
  ProviderRuntimeToolRegistryShape
>()("ryco/provider/tools/ProviderRuntimeToolRegistry") {}

export const ProviderRuntimeToolRegistryLive = Layer.effect(
  ProviderRuntimeToolRegistry,
  Effect.gen(function* () {
    const browser = yield* BrowserService;
    const eventHub = yield* Effect.serviceOption(ProviderRuntimeEventHub);

    const publishEvents = (events: ReadonlyArray<ProviderRuntimeEvent>) =>
      Option.match(eventHub, {
        onNone: () => Effect.void,
        onSome: (hub) =>
          Effect.forEach(events, (event) => hub.publish(event), {
            concurrency: 1,
            discard: true,
          }),
      });

    return {
      getBrowserSupport: resolveProviderBrowserToolSupport,
      executeBrowserTool: (input, options) =>
        Effect.gen(function* () {
          let itemId: RuntimeItemId | undefined;
          if (options?.lifecycle) {
            const started = yield* makeBrowserToolStartedEvent({
              call: input,
              context: options.lifecycle,
            });
            itemId = started.itemId;
            yield* publishEvents([started]);
          }

          const result = yield* executeBrowserRuntimeToolCall(browser, input).pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                Effect.gen(function* () {
                  if (options?.lifecycle && itemId) {
                    const completed = yield* makeBrowserToolCompletedEvent({
                      call: input,
                      context: options.lifecycle,
                      itemId,
                      success: false,
                      message:
                        error &&
                        typeof error === "object" &&
                        "message" in error &&
                        typeof error.message === "string"
                          ? error.message
                          : "Browser runtime tool call failed.",
                    });
                    yield* publishEvents([completed]);
                  }
                  return yield* Effect.fail(error);
                }),
              onSuccess: (value) =>
                Effect.gen(function* () {
                  if (options?.lifecycle && itemId) {
                    const completed = yield* makeBrowserToolCompletedEvent({
                      call: input,
                      context: options.lifecycle,
                      itemId,
                      success: true,
                      result: value,
                    });
                    yield* publishEvents([completed]);
                  }
                  return value;
                }),
            }),
          );

          return result;
        }),
    } satisfies ProviderRuntimeToolRegistryShape;
  }),
);
