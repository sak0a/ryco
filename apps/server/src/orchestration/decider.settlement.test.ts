import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  WorktreeId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@ryco/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asCommandId = (value: string) => CommandId.make(value);
const asEventId = (value: string) => EventId.make(value);
const asProjectId = (value: string) => ProjectId.make(value);
const asThreadId = (value: string) => ThreadId.make(value);

async function seedThread(): Promise<OrchestrationReadModel> {
  const createdAt = "2026-07-31T00:00:00.000Z";
  const projectId = asProjectId("project-settlement");
  const threadId = asThreadId("thread-settlement");
  const withProject = await Effect.runPromise(
    projectEvent(createEmptyReadModel(createdAt), {
      sequence: 1,
      eventId: asEventId("event-project-created"),
      aggregateKind: "project",
      aggregateId: projectId,
      type: "project.created",
      occurredAt: createdAt,
      commandId: asCommandId("command-project-created"),
      causationEventId: null,
      correlationId: asCommandId("command-project-created"),
      metadata: {},
      payload: {
        projectId,
        title: "Settlement",
        workspaceRoot: "/tmp/settlement",
        defaultModelSelection: null,
        scripts: [],
        createdAt,
        updatedAt: createdAt,
      },
    }),
  );
  return Effect.runPromise(
    projectEvent(withProject, {
      sequence: 2,
      eventId: asEventId("event-thread-created"),
      aggregateKind: "thread",
      aggregateId: threadId,
      type: "thread.created",
      occurredAt: createdAt,
      commandId: asCommandId("command-thread-created"),
      causationEventId: null,
      correlationId: asCommandId("command-thread-created"),
      metadata: {},
      payload: {
        threadId,
        projectId,
        title: "Settlement",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        runtimeMode: "full-access",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        createdAt,
        updatedAt: createdAt,
      },
    }),
  );
}

function asEvents(
  result:
    | Omit<OrchestrationEvent, "sequence">
    | ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
) {
  return Array.isArray(result) ? result : [result];
}

describe("thread settlement decider", () => {
  it("settles an eligible thread and preserves the timestamp when repeated", async () => {
    const readModel = await seedThread();
    const threadId = readModel.threads[0]!.id;
    const settled = asEvents(
      await Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.settle",
            commandId: asCommandId("command-settle"),
            threadId,
          },
          readModel,
        }),
      ),
    );

    expect(settled).toHaveLength(1);
    expect(settled[0]?.type).toBe("thread.settled");
    if (settled[0]?.type !== "thread.settled") {
      throw new Error("Expected thread.settled");
    }
    const projected = await Effect.runPromise(
      projectEvent(readModel, { ...settled[0], sequence: readModel.snapshotSequence + 1 }),
    );
    const repeated = asEvents(
      await Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.settle",
            commandId: asCommandId("command-settle-again"),
            threadId,
          },
          readModel: projected,
        }),
      ),
    );

    expect(repeated[0]?.type).toBe("thread.settled");
    if (repeated[0]?.type === "thread.settled") {
      expect(repeated[0].payload.settledAt).toBe(settled[0].payload.settledAt);
      expect(repeated[0].payload.updatedAt).toBe(settled[0].payload.updatedAt);
    }
  });

  it("rejects settlement while a provider session is running", async () => {
    const readModel = await seedThread();
    const thread = readModel.threads[0]!;
    const running: OrchestrationReadModel = {
      ...readModel,
      threads: [
        {
          ...thread,
          session: {
            threadId: thread.id,
            status: "running",
            providerName: "codex",
            runtimeMode: "full-access",
            tokenMode: "balanced",
            activeTurnId: TurnId.make("turn-running"),
            lastError: null,
            updatedAt: "2026-07-31T00:01:00.000Z",
          },
        },
      ],
    };

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.settle",
            commandId: asCommandId("command-settle-running"),
            threadId: thread.id,
          },
          readModel: running,
        }),
      ),
    ).rejects.toThrow("provider session is running");
  });

  it("rejects settlement for pending input and archived worktrees", async () => {
    const readModel = await seedThread();
    const thread = readModel.threads[0]!;
    const pendingInput: OrchestrationReadModel = {
      ...readModel,
      threads: [
        {
          ...thread,
          activities: [
            {
              id: asEventId("activity-input"),
              tone: "approval",
              kind: "user-input.requested",
              summary: "Input required",
              payload: { requestId: "request-input" },
              turnId: null,
              createdAt: "2026-07-31T00:01:00.000Z",
            },
          ],
        },
      ],
    };
    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.settle",
            commandId: asCommandId("command-settle-input"),
            threadId: thread.id,
          },
          readModel: pendingInput,
        }),
      ),
    ).rejects.toThrow("user input is pending");

    const worktreeId = WorktreeId.make("worktree-archived");
    const archivedWorktree: OrchestrationReadModel = {
      ...readModel,
      worktrees: [
        {
          worktreeId,
          projectId: thread.projectId,
          title: null,
          branch: "feature/settlement",
          worktreePath: "/tmp/settlement-worktree",
          origin: "manual",
          prNumber: null,
          issueNumber: null,
          prTitle: null,
          issueTitle: null,
          workItemProvider: null,
          workItemKey: null,
          workItemTitle: null,
          workItemState: null,
          workItemStateName: null,
          workItemUrl: null,
          prState: null,
          prIsDraft: null,
          issueState: null,
          createdAt: "2026-07-31T00:00:00.000Z",
          updatedAt: "2026-07-31T00:01:00.000Z",
          archivedAt: "2026-07-31T00:01:00.000Z",
          manualPosition: 0,
        },
      ],
      threads: [{ ...thread, worktreeId }],
    };
    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.settle",
            commandId: asCommandId("command-settle-archived-worktree"),
            threadId: thread.id,
          },
          readModel: archivedWorktree,
        }),
      ),
    ).rejects.toThrow("worktree is archived");
  });

  it("reopens an explicitly settled thread before real activity", async () => {
    const readModel = await seedThread();
    const thread = {
      ...readModel.threads[0]!,
      settledOverride: "settled" as const,
      settledAt: "2026-07-31T00:01:00.000Z",
    };
    const settledReadModel: OrchestrationReadModel = { ...readModel, threads: [thread] };
    const turnCommand: Extract<OrchestrationCommand, { type: "thread.turn.start" }> = {
      type: "thread.turn.start",
      commandId: asCommandId("command-turn-start"),
      threadId: thread.id,
      message: {
        messageId: MessageId.make("message-user"),
        role: "user",
        text: "Continue",
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-07-31T00:02:00.000Z",
    };

    const turnEvents = asEvents(
      await Effect.runPromise(
        decideOrchestrationCommand({ command: turnCommand, readModel: settledReadModel }),
      ),
    );
    expect(turnEvents.map((event) => event.type)).toEqual([
      "thread.unsettled",
      "thread.message-sent",
      "thread.turn-start-requested",
    ]);
    expect(turnEvents[2]?.causationEventId).toBe(turnEvents[1]?.eventId);

    const sessionEvents = asEvents(
      await Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.session.set",
            commandId: asCommandId("command-session-start"),
            threadId: thread.id,
            session: {
              threadId: thread.id,
              status: "starting",
              providerName: "codex",
              runtimeMode: "full-access",
              tokenMode: "balanced",
              activeTurnId: null,
              lastError: null,
              updatedAt: "2026-07-31T00:03:00.000Z",
            },
            createdAt: "2026-07-31T00:03:00.000Z",
          },
          readModel: settledReadModel,
        }),
      ),
    );
    expect(sessionEvents.map((event) => event.type)).toEqual([
      "thread.unsettled",
      "thread.session-set",
    ]);

    const requestEvents = asEvents(
      await Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.activity.append",
            commandId: asCommandId("command-input-request"),
            threadId: thread.id,
            activity: {
              id: asEventId("activity-request"),
              tone: "approval",
              kind: "approval.requested",
              summary: "Approval required",
              payload: { requestId: "request-approval" },
              turnId: null,
              createdAt: "2026-07-31T00:04:00.000Z",
            },
            createdAt: "2026-07-31T00:04:00.000Z",
          },
          readModel: settledReadModel,
        }),
      ),
    );
    expect(requestEvents.map((event) => event.type)).toEqual([
      "thread.unsettled",
      "thread.activity-appended",
    ]);
  });

  it("keeps neutral activity from reopening a settled thread", async () => {
    const readModel = await seedThread();
    const thread = {
      ...readModel.threads[0]!,
      settledOverride: "settled" as const,
      settledAt: "2026-07-31T00:01:00.000Z",
    };
    const result = asEvents(
      await Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.activity.append",
            commandId: asCommandId("command-neutral-activity"),
            threadId: thread.id,
            activity: {
              id: asEventId("activity-neutral"),
              tone: "info",
              kind: "runtime.note",
              summary: "Still idle",
              payload: {},
              turnId: null,
              createdAt: "2026-07-31T00:02:00.000Z",
            },
            createdAt: "2026-07-31T00:02:00.000Z",
          },
          readModel: { ...readModel, threads: [thread] },
        }),
      ),
    );

    expect(result.map((event) => event.type)).toEqual(["thread.activity-appended"]);
  });
});
