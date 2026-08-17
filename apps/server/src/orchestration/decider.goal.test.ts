import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
} from "@ryco/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const threadId = ThreadId.make("goal-thread");
const projectId = ProjectId.make("goal-project");
type WithoutSequence<T> = T extends unknown ? Omit<T, "sequence"> : never;
type PlannedEvent = WithoutSequence<OrchestrationEvent>;

function expectSingleEvent(value: unknown): PlannedEvent {
  if (Array.isArray(value)) {
    throw new Error(`Expected one event, received ${value.length}.`);
  }
  return value as PlannedEvent;
}

async function seedThread(at: string) {
  const projectEventValue = {
    sequence: 1,
    eventId: EventId.make("goal-project-created"),
    aggregateKind: "project" as const,
    aggregateId: projectId,
    type: "project.created" as const,
    occurredAt: at,
    commandId: CommandId.make("goal-project-create"),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: {
      projectId,
      title: "Goal project",
      workspaceRoot: "/tmp/goal-project",
      defaultModelSelection: null,
      scripts: [],
      createdAt: at,
      updatedAt: at,
    },
  } satisfies OrchestrationEvent;
  const withProject = await Effect.runPromise(
    projectEvent(createEmptyReadModel(at), projectEventValue),
  );
  return Effect.runPromise(
    projectEvent(withProject, {
      sequence: 2,
      eventId: EventId.make("goal-thread-created"),
      aggregateKind: "thread",
      aggregateId: threadId,
      type: "thread.created",
      occurredAt: at,
      commandId: CommandId.make("goal-thread-create"),
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        threadId,
        projectId,
        title: "Goal thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        createdAt: at,
        updatedAt: at,
      },
    }),
  );
}

describe("thread goal decider", () => {
  it("sets, pauses with elapsed accounting, and clears a goal", async () => {
    const createdAt = "2026-08-17T10:00:00.000Z";
    const initial = await seedThread(createdAt);
    const setEvent = expectSingleEvent(
      await Effect.runPromise(
        decideOrchestrationCommand({
          readModel: initial,
          command: {
            type: "thread.goal.set",
            commandId: CommandId.make("goal-set"),
            threadId,
            objective: "Ship durable thread goals",
            createdAt,
          },
        }),
      ),
    );
    if (setEvent.type !== "thread.goal-updated") return;
    expect(setEvent.payload.goal).toMatchObject({
      objective: "Ship durable thread goals",
      status: "active",
      timeUsedSeconds: 0,
      tokensUsed: 0,
    });

    const withGoal = await Effect.runPromise(
      projectEvent(initial, { ...setEvent, sequence: 3 } as OrchestrationEvent),
    );
    const pausedAt = "2026-08-17T10:01:01.000Z";
    const pauseEvent = expectSingleEvent(
      await Effect.runPromise(
        decideOrchestrationCommand({
          readModel: withGoal,
          command: {
            type: "thread.goal.set",
            commandId: CommandId.make("goal-pause"),
            threadId,
            status: "paused",
            createdAt: pausedAt,
          },
        }),
      ),
    );
    if (pauseEvent.type !== "thread.goal-updated") return;
    expect(pauseEvent.payload.goal.status).toBe("paused");
    expect(pauseEvent.payload.goal.timeUsedSeconds).toBe(61);

    const paused = await Effect.runPromise(
      projectEvent(withGoal, { ...pauseEvent, sequence: 4 } as OrchestrationEvent),
    );
    const clearEvent = expectSingleEvent(
      await Effect.runPromise(
        decideOrchestrationCommand({
          readModel: paused,
          command: {
            type: "thread.goal.clear",
            commandId: CommandId.make("goal-clear"),
            threadId,
            createdAt: pausedAt,
          },
        }),
      ),
    );
    expect(clearEvent.type).toBe("thread.goal-cleared");
  });
});
