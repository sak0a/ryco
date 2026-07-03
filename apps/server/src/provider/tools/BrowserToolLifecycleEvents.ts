import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  type ProviderRuntimeEvent,
  type TurnId,
} from "@ryco/contracts";
import { Effect, Random } from "effect";

import type { BrowserRuntimeToolCallInput } from "./BrowserRuntimeTool.ts";

export interface BrowserToolLifecycleContext {
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId?: ProviderInstanceId;
  readonly turnId?: TurnId;
}

const makeItemId = (toolName: string, suffix: string) =>
  RuntimeItemId.make(`browser-tool:${toolName}:${suffix}`);

export function makeBrowserToolStartedEvent(input: {
  readonly call: BrowserRuntimeToolCallInput;
  readonly context: BrowserToolLifecycleContext;
  readonly itemId?: RuntimeItemId;
  readonly createdAt?: string;
}): Effect.Effect<ProviderRuntimeEvent> {
  return Effect.gen(function* () {
    const eventId = EventId.make(yield* Random.nextUUIDv4);
    const itemId = input.itemId ?? makeItemId(input.call.name, yield* Random.nextUUIDv4);
    const createdAt = input.createdAt ?? new Date().toISOString();
    return {
      eventId,
      provider: input.context.provider,
      ...(input.context.providerInstanceId
        ? { providerInstanceId: input.context.providerInstanceId }
        : {}),
      threadId: input.call.threadId,
      createdAt,
      ...(input.context.turnId ? { turnId: input.context.turnId } : {}),
      itemId,
      raw: {
        source: "ryco.browser.tool",
        payload: {
          toolName: input.call.name,
          arguments: input.call,
        },
      },
      type: "item.started",
      payload: {
        itemType: "browser_tool_call",
        status: "inProgress",
        title: input.call.name,
        data: input.call,
      },
    } satisfies ProviderRuntimeEvent;
  });
}

export function makeBrowserToolCompletedEvent(input: {
  readonly call: BrowserRuntimeToolCallInput;
  readonly context: BrowserToolLifecycleContext;
  readonly itemId: RuntimeItemId;
  readonly success: boolean;
  readonly result?: unknown;
  readonly message?: string;
  readonly createdAt?: string;
}): Effect.Effect<ProviderRuntimeEvent> {
  return Effect.gen(function* () {
    const eventId = EventId.make(yield* Random.nextUUIDv4);
    const createdAt = input.createdAt ?? new Date().toISOString();
    return {
      eventId,
      provider: input.context.provider,
      ...(input.context.providerInstanceId
        ? { providerInstanceId: input.context.providerInstanceId }
        : {}),
      threadId: input.call.threadId,
      createdAt,
      ...(input.context.turnId ? { turnId: input.context.turnId } : {}),
      itemId: input.itemId,
      raw: {
        source: "ryco.browser.tool",
        payload: {
          toolName: input.call.name,
          success: input.success,
          ...(input.result !== undefined ? { result: input.result } : {}),
          ...(input.message ? { message: input.message } : {}),
        },
      },
      type: "item.completed",
      payload: {
        itemType: "browser_tool_call",
        status: input.success ? "completed" : "failed",
        title: input.call.name,
        ...(input.message ? { detail: input.message } : {}),
        ...(input.result !== undefined ? { data: input.result } : {}),
      },
    } satisfies ProviderRuntimeEvent;
  });
}
