import {
  EventId,
  TurnId,
  type ProviderRuntimeEvent,
  type UserInputQuestion,
} from "@ryco/contracts";
import type { SessionEvent } from "@github/copilot-sdk";
import { Effect } from "effect";

import {
  USER_INPUT_QUESTION_ID,
  type ActiveCopilotSession,
  eventBase,
  normalizeUsage,
} from "./CopilotAdapter.types.ts";

export interface MapEventDeps {
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly nextEventId: Effect.Effect<EventId>;
}

export const mapEvent = (
  deps: MapEventDeps,
  session: ActiveCopilotSession,
  event: SessionEvent,
): Effect.Effect<ReadonlyArray<ProviderRuntimeEvent>> =>
  Effect.gen(function* () {
    const turnId = session.activeTurnId;
    const stamp = yield* deps.makeEventStamp();
    const raw = {
      source: "copilot.sdk.session-event" as const,
      method: event.type,
      payload: event,
    };

    switch (event.type) {
      case "assistant.turn_start": {
        const eventTurnId = TurnId.make(event.data.turnId);
        return [
          {
            ...eventBase({
              eventId: stamp.eventId,
              createdAt: event.timestamp,
              threadId: session.threadId,
              providerInstanceId: session.providerInstanceId,
              turnId: eventTurnId,
              raw,
            }),
            type: "turn.started",
            payload: session.model ? { model: session.model } : {},
          },
        ];
      }
      case "assistant.message_delta":
        return [
          {
            ...eventBase({
              eventId: stamp.eventId,
              createdAt: event.timestamp,
              threadId: session.threadId,
              providerInstanceId: session.providerInstanceId,
              ...(turnId ? { turnId } : {}),
              itemId: event.data.messageId,
              raw,
            }),
            type: "content.delta",
            payload: {
              streamKind: "assistant_text",
              delta: event.data.deltaContent,
            },
          },
        ];
      case "assistant.reasoning_delta":
        return [
          {
            ...eventBase({
              eventId: stamp.eventId,
              createdAt: event.timestamp,
              threadId: session.threadId,
              providerInstanceId: session.providerInstanceId,
              ...(turnId ? { turnId } : {}),
              itemId: event.data.reasoningId,
              raw,
            }),
            type: "content.delta",
            payload: {
              streamKind: "reasoning_text",
              delta: event.data.deltaContent,
            },
          },
        ];
      case "assistant.reasoning":
        return [
          {
            ...eventBase({
              eventId: stamp.eventId,
              createdAt: event.timestamp,
              threadId: session.threadId,
              providerInstanceId: session.providerInstanceId,
              ...(turnId ? { turnId } : {}),
              itemId: event.data.reasoningId,
              raw,
            }),
            type: "item.completed",
            payload: {
              itemType: "reasoning",
              status: "completed",
              title: "Reasoning",
              detail: event.data.content,
              data: event.data,
            },
          },
        ];
      case "assistant.message":
        return [
          {
            ...eventBase({
              eventId: stamp.eventId,
              createdAt: event.timestamp,
              threadId: session.threadId,
              providerInstanceId: session.providerInstanceId,
              ...(turnId ? { turnId } : {}),
              itemId: event.data.messageId,
              raw,
            }),
            type: "item.completed",
            payload: {
              itemType: "assistant_message",
              status: "completed",
              title: "Assistant message",
              detail: event.data.content,
              data: event.data,
            },
          },
        ];
      case "session.usage_info":
      case "assistant.usage": {
        if (event.type === "session.usage_info") {
          const { currentTokens, tokenLimit } = event.data;
          if (
            !Number.isSafeInteger(currentTokens) ||
            currentTokens < 0 ||
            !Number.isSafeInteger(tokenLimit) ||
            tokenLimit <= 0
          ) {
            return [];
          }
          session.contextUsage = { usedTokens: currentTokens, maxTokens: tokenLimit };
          session.lastUsage = {
            ...session.lastUsage,
            ...session.contextUsage,
            lastUsedTokens: currentTokens,
          };
        } else {
          // Child/background API calls are not the main conversation's context.
          if (
            event.data.parentToolCallId ||
            event.data.initiator ||
            (event.data.interactionType &&
              !["conversation-agent", "conversation-user"].includes(event.data.interactionType))
          ) {
            return [];
          }
          session.lastUsage = {
            ...normalizeUsage(event),
            ...session.contextUsage,
            ...(session.contextUsage ? { lastUsedTokens: session.contextUsage.usedTokens } : {}),
          };
        }
        return [
          {
            ...eventBase({
              eventId: stamp.eventId,
              createdAt: event.timestamp,
              threadId: session.threadId,
              providerInstanceId: session.providerInstanceId,
              ...(turnId ? { turnId } : {}),
              raw,
            }),
            type: "thread.token-usage.updated",
            payload: { usage: session.lastUsage },
          },
        ];
      }
      case "session.idle": {
        const readyEventId = yield* deps.nextEventId;
        return [
          {
            ...eventBase({
              eventId: stamp.eventId,
              createdAt: event.timestamp,
              threadId: session.threadId,
              providerInstanceId: session.providerInstanceId,
              ...(turnId ? { turnId } : {}),
              raw,
            }),
            type: "turn.completed",
            payload: {
              state: event.data.aborted ? "interrupted" : "completed",
              ...(session.lastUsage ? { usage: session.lastUsage } : {}),
            },
          },
          {
            ...eventBase({
              eventId: readyEventId,
              createdAt: event.timestamp,
              threadId: session.threadId,
              providerInstanceId: session.providerInstanceId,
              raw,
            }),
            type: "session.state.changed",
            payload: { state: "ready", reason: "session.idle" },
          },
        ];
      }
      case "abort":
        return [
          {
            ...eventBase({
              eventId: stamp.eventId,
              createdAt: event.timestamp,
              threadId: session.threadId,
              providerInstanceId: session.providerInstanceId,
              ...(turnId ? { turnId } : {}),
              raw,
            }),
            type: "turn.aborted",
            payload: { reason: event.data.reason },
          },
        ];
      case "session.error":
        return [
          {
            ...eventBase({
              eventId: stamp.eventId,
              createdAt: event.timestamp,
              threadId: session.threadId,
              providerInstanceId: session.providerInstanceId,
              ...(turnId ? { turnId } : {}),
              raw,
            }),
            type: "runtime.error",
            payload: {
              message: event.data.message,
              class: "provider_error",
              detail: event.data,
            },
          },
        ];
      case "tool.execution_start": {
        const toolName = event.data.toolName ?? "";
        const isMcpTool = event.data.mcpToolName !== undefined;
        return [
          {
            ...eventBase({
              eventId: stamp.eventId,
              createdAt: event.timestamp,
              threadId: session.threadId,
              providerInstanceId: session.providerInstanceId,
              ...(turnId ? { turnId } : {}),
              itemId: event.data.toolCallId,
              raw,
            }),
            type: "item.started",
            payload: {
              itemType: isMcpTool ? "mcp_tool_call" : "dynamic_tool_call",
              status: "inProgress",
              title: toolName,
              ...(event.data.arguments ? { data: event.data.arguments } : {}),
            },
          },
        ];
      }
      case "tool.execution_complete": {
        const isMcpTool = "mcpToolName" in event.data && event.data.mcpToolName !== undefined;
        return [
          {
            ...eventBase({
              eventId: stamp.eventId,
              createdAt: event.timestamp,
              threadId: session.threadId,
              providerInstanceId: session.providerInstanceId,
              ...(turnId ? { turnId } : {}),
              itemId: event.data.toolCallId,
              raw,
            }),
            type: "item.completed",
            payload: {
              itemType: isMcpTool ? "mcp_tool_call" : "dynamic_tool_call",
              status: event.data.success ? "completed" : "failed",
              title: "Tool call",
              ...((event.data.result?.detailedContent ??
              event.data.result?.content ??
              event.data.error?.message)
                ? {
                    detail:
                      event.data.result?.detailedContent ??
                      event.data.result?.content ??
                      event.data.error?.message,
                  }
                : {}),
              data: event.data,
            },
          },
        ];
      }
      case "user_input.requested": {
        const question: UserInputQuestion = {
          id: USER_INPUT_QUESTION_ID,
          header: "Question",
          question: event.data.question,
          options: (event.data.choices ?? []).map((choice: string) => ({
            label: choice,
            description: choice,
          })),
        };
        return [
          {
            ...eventBase({
              eventId: stamp.eventId,
              createdAt: event.timestamp,
              threadId: session.threadId,
              providerInstanceId: session.providerInstanceId,
              ...(turnId ? { turnId } : {}),
              requestId: event.data.requestId,
              raw,
            }),
            type: "user-input.requested",
            payload: { questions: [question] },
          },
        ];
      }
      case "user_input.completed":
        return [
          {
            ...eventBase({
              eventId: stamp.eventId,
              createdAt: event.timestamp,
              threadId: session.threadId,
              providerInstanceId: session.providerInstanceId,
              ...(turnId ? { turnId } : {}),
              requestId: event.data.requestId,
              raw,
            }),
            type: "user-input.resolved",
            payload: { answers: { [USER_INPUT_QUESTION_ID]: event.data.answer ?? "" } },
          },
        ];
      default:
        return [];
    }
  });
