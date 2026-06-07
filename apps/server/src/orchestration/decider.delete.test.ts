import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  ProviderInstanceId,
  WorktreeId,
} from "@ryco/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asCommandId = (value: string): CommandId => CommandId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asWorktreeId = (value: string): WorktreeId => WorktreeId.make(value);

async function seedReadModel(): Promise<OrchestrationReadModel> {
  const now = new Date().toISOString();
  const initial = createEmptyReadModel(now);
  const withProject = await Effect.runPromise(
    projectEvent(initial, {
      sequence: 1,
      eventId: asEventId("evt-project-create"),
      aggregateKind: "project",
      aggregateId: asProjectId("project-delete"),
      type: "project.created",
      occurredAt: now,
      commandId: asCommandId("cmd-project-create"),
      causationEventId: null,
      correlationId: asCommandId("cmd-project-create"),
      metadata: {},
      payload: {
        projectId: asProjectId("project-delete"),
        title: "Project Delete",
        workspaceRoot: "/tmp/project-delete",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  const withFirstThread = await Effect.runPromise(
    projectEvent(withProject, {
      sequence: 2,
      eventId: asEventId("evt-thread-create-1"),
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-delete-1"),
      type: "thread.created",
      occurredAt: now,
      commandId: asCommandId("cmd-thread-create-1"),
      causationEventId: null,
      correlationId: asCommandId("cmd-thread-create-1"),
      metadata: {},
      payload: {
        threadId: asThreadId("thread-delete-1"),
        projectId: asProjectId("project-delete"),
        title: "Thread Delete 1",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  return Effect.runPromise(
    projectEvent(withFirstThread, {
      sequence: 3,
      eventId: asEventId("evt-thread-create-2"),
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-delete-2"),
      type: "thread.created",
      occurredAt: now,
      commandId: asCommandId("cmd-thread-create-2"),
      causationEventId: null,
      correlationId: asCommandId("cmd-thread-create-2"),
      metadata: {},
      payload: {
        threadId: asThreadId("thread-delete-2"),
        projectId: asProjectId("project-delete"),
        title: "Thread Delete 2",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
}

type PlannedEvent = Omit<OrchestrationEvent, "sequence">;

function normalizeDeleteEvent(event: PlannedEvent | ReadonlyArray<PlannedEvent>) {
  const events = Array.isArray(event) ? event : [event];
  return events.map((entry) => {
    switch (entry.type) {
      case "thread.deleted":
        return {
          type: entry.type,
          aggregateKind: entry.aggregateKind,
          aggregateId: entry.aggregateId,
          commandId: entry.commandId,
          correlationId: entry.correlationId,
          payload: {
            threadId: entry.payload.threadId,
          },
        };
      case "project.deleted":
        return {
          type: entry.type,
          aggregateKind: entry.aggregateKind,
          aggregateId: entry.aggregateId,
          commandId: entry.commandId,
          correlationId: entry.correlationId,
          payload: {
            projectId: entry.payload.projectId,
          },
        };
      case "worktree.deleted":
        return {
          type: entry.type,
          aggregateKind: entry.aggregateKind,
          aggregateId: entry.aggregateId,
          commandId: entry.commandId,
          correlationId: entry.correlationId,
          payload: {
            worktreeId: entry.payload.worktreeId,
          },
        };
      default:
        return entry;
    }
  });
}

describe("decider deletion flows", () => {
  it("rejects deleting a non-empty project without force", async () => {
    const readModel = await seedReadModel();

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "project.delete",
            commandId: asCommandId("cmd-project-delete-no-force"),
            projectId: asProjectId("project-delete"),
          },
          readModel,
        }),
      ),
    ).rejects.toThrow("cannot be deleted without force=true");
  });

  it("reuses thread.delete semantics when force-deleting a non-empty project", async () => {
    const readModel = await seedReadModel();
    const projectDeleteCommand: Extract<OrchestrationCommand, { type: "project.delete" }> = {
      type: "project.delete",
      commandId: asCommandId("cmd-project-delete-force"),
      projectId: asProjectId("project-delete"),
      force: true,
    };

    const forcedResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: projectDeleteCommand,
        readModel,
      }),
    );
    const forcedEvents = Array.isArray(forcedResult) ? forcedResult : [forcedResult];

    expect(forcedEvents.map((event) => event.type)).toEqual([
      "thread.deleted",
      "thread.deleted",
      "project.deleted",
    ]);

    let sequentialReadModel = readModel;
    let nextSequence = readModel.snapshotSequence;
    const sequentialEvents: PlannedEvent[] = [];
    for (const nextCommand of [
      {
        type: "thread.delete",
        commandId: projectDeleteCommand.commandId,
        threadId: asThreadId("thread-delete-1"),
      },
      {
        type: "thread.delete",
        commandId: projectDeleteCommand.commandId,
        threadId: asThreadId("thread-delete-2"),
      },
      {
        type: "project.delete",
        commandId: projectDeleteCommand.commandId,
        projectId: asProjectId("project-delete"),
      },
    ] satisfies ReadonlyArray<OrchestrationCommand>) {
      const decided = await Effect.runPromise(
        decideOrchestrationCommand({
          command: nextCommand,
          readModel: sequentialReadModel,
        }),
      );
      const nextEvents = Array.isArray(decided) ? decided : [decided];
      sequentialEvents.push(...nextEvents);
      for (const nextEvent of nextEvents) {
        nextSequence += 1;
        sequentialReadModel = await Effect.runPromise(
          projectEvent(sequentialReadModel, {
            ...nextEvent,
            sequence: nextSequence,
          }),
        );
      }
    }

    expect(normalizeDeleteEvent(forcedResult)).toEqual(normalizeDeleteEvent(sequentialEvents));
  });

  it("deletes worktree sessions before deleting a worktree", async () => {
    const now = new Date().toISOString();
    const worktreeId = asWorktreeId("worktree-delete-1");
    let readModel = await seedReadModel();

    for (const nextEvent of [
      {
        sequence: 4,
        eventId: asEventId("evt-worktree-create"),
        aggregateKind: "worktree",
        aggregateId: worktreeId,
        type: "worktree.created",
        occurredAt: now,
        commandId: asCommandId("cmd-worktree-create"),
        causationEventId: null,
        correlationId: asCommandId("cmd-worktree-create"),
        metadata: {},
        payload: {
          worktreeId,
          projectId: asProjectId("project-delete"),
          branch: "feature/delete-worktree",
          worktreePath: "/tmp/project-delete-worktree",
          origin: "branch",
          prNumber: null,
          issueNumber: null,
          prTitle: null,
          issueTitle: null,
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        sequence: 5,
        eventId: asEventId("evt-thread-attach-1"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-delete-1"),
        type: "thread.attachedToWorktree",
        occurredAt: now,
        commandId: asCommandId("cmd-thread-attach-1"),
        causationEventId: null,
        correlationId: asCommandId("cmd-thread-attach-1"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-delete-1"),
          worktreeId,
          attachedAt: now,
        },
      },
      {
        sequence: 6,
        eventId: asEventId("evt-thread-attach-2"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-delete-2"),
        type: "thread.attachedToWorktree",
        occurredAt: now,
        commandId: asCommandId("cmd-thread-attach-2"),
        causationEventId: null,
        correlationId: asCommandId("cmd-thread-attach-2"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-delete-2"),
          worktreeId,
          attachedAt: now,
        },
      },
    ] satisfies OrchestrationEvent[]) {
      readModel = await Effect.runPromise(projectEvent(readModel, nextEvent));
    }

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "worktree.delete",
          commandId: asCommandId("cmd-worktree-delete"),
          worktreeId,
          deletedAt: now,
          deletedBranch: false,
        },
        readModel,
      }),
    );
    const events = Array.isArray(result) ? result : [result];

    expect(events.map((event) => event.type)).toEqual([
      "thread.deleted",
      "thread.deleted",
      "worktree.deleted",
    ]);
    expect(normalizeDeleteEvent(result)).toEqual([
      {
        type: "thread.deleted",
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-delete-1"),
        commandId: asCommandId("cmd-worktree-delete"),
        correlationId: asCommandId("cmd-worktree-delete"),
        payload: {
          threadId: asThreadId("thread-delete-1"),
        },
      },
      {
        type: "thread.deleted",
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-delete-2"),
        commandId: asCommandId("cmd-worktree-delete"),
        correlationId: asCommandId("cmd-worktree-delete"),
        payload: {
          threadId: asThreadId("thread-delete-2"),
        },
      },
      {
        type: "worktree.deleted",
        aggregateKind: "worktree",
        aggregateId: worktreeId,
        commandId: asCommandId("cmd-worktree-delete"),
        correlationId: asCommandId("cmd-worktree-delete"),
        payload: {
          worktreeId,
        },
      },
    ]);
  });
});
