import { describe, expect, it } from "vitest";
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
});
