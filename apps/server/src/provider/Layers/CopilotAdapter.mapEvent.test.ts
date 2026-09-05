import { describe, expect, it } from "vite-plus/test";
import {
  EventId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
} from "@ryco/contracts";
import type { SessionEvent } from "@github/copilot-sdk";
import { Effect } from "effect";

import { mapEvent } from "./CopilotAdapter.mapEvent.ts";
import type { ActiveCopilotSession } from "./CopilotAdapter.types.ts";

describe("mapEvent", () => {
  it("keeps the active turn id on Copilot idle completion events", async () => {
    const turnId = TurnId.make("turn-1");
    const session = {
      activeTurnId: turnId,
      threadId: ThreadId.make("thread-1"),
      providerInstanceId: ProviderInstanceId.make("copilot"),
      lastUsage: undefined,
    } as ActiveCopilotSession;
    const event = {
      type: "session.idle",
      timestamp: "2026-05-12T00:00:00.000Z",
      data: { aborted: false },
    } as SessionEvent;

    const events = await Effect.runPromise(
      mapEvent(
        {
          makeEventStamp: () =>
            Effect.succeed({
              eventId: EventId.make("event-1"),
              createdAt: "2026-05-12T00:00:00.000Z",
            }),
          nextEventId: Effect.succeed(EventId.make("event-2")),
        },
        session,
        event,
      ),
    );

    const completed = events.find(
      (candidate): candidate is Extract<ProviderRuntimeEvent, { type: "turn.completed" }> =>
        candidate.type === "turn.completed",
    );
    expect(completed?.turnId).toBe(turnId);
  });
  it("keeps authoritative current context through billing events and compaction", async () => {
    const session = {
      threadId: ThreadId.make("thread-usage"),
      activeTurnId: TurnId.make("turn-usage"),
      providerInstanceId: ProviderInstanceId.make("copilot"),
      lastUsage: undefined,
    } as ActiveCopilotSession;
    const send = (type: string, data: unknown) =>
      Effect.runPromise(
        mapEvent(
          {
            makeEventStamp: () =>
              Effect.succeed({
                eventId: EventId.make("usage"),
                createdAt: "2026-09-05T00:00:00.000Z",
              }),
            nextEventId: Effect.succeed(EventId.make("next")),
          },
          session,
          { type, data, timestamp: "2026-09-05T00:00:00.000Z" } as SessionEvent,
        ),
      );

    const usage = await send("session.usage_info", {
      currentTokens: 50_000,
      tokenLimit: 128_000,
      messagesLength: 5,
    });
    expect(usage).toMatchObject([
      {
        type: "thread.token-usage.updated",
        payload: { usage: { usedTokens: 50_000, maxTokens: 128_000 } },
      },
    ]);
    const billed = await send("assistant.usage", {
      inputTokens: 200,
      outputTokens: 100,
      model: "test-model",
    });
    expect(billed).toMatchObject([
      { payload: { usage: { usedTokens: 50_000, maxTokens: 128_000, outputTokens: 100 } } },
    ]);
    expect(
      await send("assistant.usage", {
        inputTokens: 999_000,
        initiator: "sub-agent",
        model: "test-model",
      }),
    ).toEqual([]);
    expect(await send("session.usage_info", { currentTokens: -1, tokenLimit: 128_000 })).toEqual(
      [],
    );
    expect(session.lastUsage?.usedTokens).toBe(50_000);
    await send("session.usage_info", {
      currentTokens: 10_000,
      tokenLimit: 64_000,
      messagesLength: 2,
    });
    expect(session.lastUsage).toMatchObject({ usedTokens: 10_000, maxTokens: 64_000 });
    await send("session.usage_info", { currentTokens: 0, tokenLimit: 64_000, messagesLength: 0 });
    const completed = await send("session.idle", { aborted: false });
    expect(completed).toContainEqual(
      expect.objectContaining({
        type: "turn.completed",
        payload: expect.objectContaining({
          usage: expect.objectContaining({ usedTokens: 0, maxTokens: 64_000 }),
        }),
      }),
    );
  });
});
