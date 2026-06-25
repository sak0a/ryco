import {
  ApprovalRequestId,
  CommandId,
  EventId,
  MessageId,
  RuntimeSubagentId,
  ThreadId,
  type TurnId,
  type OrchestrationEvent,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
} from "@ryco/contracts";
import { makeDrainableWorker } from "@ryco/shared/DrainableWorker";
import { Cause, Effect, Layer, Option, Stream } from "effect";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ManagedSubagentReactor,
  type ManagedSubagentReactorShape,
} from "../Services/ManagedSubagentReactor.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

type ManagedSubagentEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.managed-subagents-launch-requested"
      | "thread.session-set"
      | "thread.activity-appended";
  }
>;

const serverCommandId = (tag: string): CommandId =>
  CommandId.make(`server:managed-subagent:${tag}:${crypto.randomUUID()}`);

function buildWorkerPrompt(prompt: string): string {
  return [
    "You are a managed subagent launched from a parent Ryco thread.",
    "",
    "Constraints:",
    "- Work read-only unless the parent explicitly changes your permissions.",
    "- Do not edit files, apply patches, commit, push, install packages, or run commands that mutate the workspace.",
    "- Research, inspect, reason, and return a concise report with evidence and file references where useful.",
    "",
    "Task:",
    prompt,
  ].join("\n");
}

function subagentActivity(input: {
  readonly id: EventId;
  readonly kind: "subagent.started" | "subagent.completed";
  readonly summary: string;
  readonly createdAt: string;
  readonly tone: OrchestrationThreadActivity["tone"];
  readonly parentTurnId: TurnId | null;
  readonly subagentId: RuntimeSubagentId;
  readonly childThreadId: ThreadId;
  readonly label: string;
  readonly status: "running" | "completed" | "failed" | "stopped";
  readonly detail?: string | undefined;
}): OrchestrationThreadActivity {
  return {
    id: input.id,
    tone: input.tone,
    kind: input.kind,
    summary: input.summary,
    payload: {
      itemType: "collab_agent_tool_call",
      status: input.status,
      subagent: {
        subagentId: input.subagentId,
        origin: "managed",
        capability: "managed",
        label: input.label,
        childThreadId: input.childThreadId,
      },
      ...(input.detail ? { detail: input.detail } : {}),
    },
    turnId: input.parentTurnId,
    createdAt: input.createdAt,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function findManagedSubagentLaunchTurnId(input: {
  readonly parentThread: OrchestrationThread;
  readonly parentSubagentId: RuntimeSubagentId;
  readonly childThreadId: ThreadId;
}): TurnId | null {
  const parentSubagentId = String(input.parentSubagentId);
  const childThreadId = String(input.childThreadId);
  for (let index = input.parentThread.activities.length - 1; index >= 0; index -= 1) {
    const activity = input.parentThread.activities[index];
    if (!activity) {
      continue;
    }
    if (activity.kind !== "subagent.started") {
      continue;
    }
    const subagent = asRecord(asRecord(activity.payload)?.subagent);
    if (!subagent) {
      continue;
    }
    if (
      String(subagent.subagentId) === parentSubagentId ||
      String(subagent.childThreadId) === childThreadId
    ) {
      return activity.turnId;
    }
  }
  return null;
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const launchTurnIdByChildThreadId = new Map<string, TurnId | null>();
  const completedChildThreads = new Set<string>();
  const declinedApprovalRequests = new Set<string>();

  const resolveThread = (threadId: ThreadId) =>
    projectionSnapshotQuery.getThreadDetailById(threadId).pipe(Effect.map(Option.getOrNull));

  const appendParentActivity = (input: {
    readonly parentThread: OrchestrationThread;
    readonly activity: OrchestrationThreadActivity;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("parent-activity"),
      threadId: input.parentThread.id,
      activity: input.activity,
      createdAt: input.activity.createdAt,
    });

  const processLaunchRequested = Effect.fn("processLaunchRequested")(function* (
    event: Extract<ManagedSubagentEvent, { type: "thread.managed-subagents-launch-requested" }>,
  ) {
    const parentThread = yield* resolveThread(event.payload.threadId);
    if (!parentThread || parentThread.deletedAt !== null) {
      return;
    }

    const count = Math.min(Math.max(event.payload.count, 1), 4);
    for (let index = 0; index < count; index += 1) {
      const subagentId = RuntimeSubagentId.make(`managed:${crypto.randomUUID()}`);
      const childThreadId = ThreadId.make(`managed-subagent:${crypto.randomUUID()}`);
      const labelBase = event.payload.title ?? parentThread.title;
      const label = count === 1 ? labelBase : `${labelBase} ${index + 1}`;
      const createdAt = event.payload.createdAt;
      const modelSelection = event.payload.modelSelection ?? parentThread.modelSelection;
      const parentTurnId = parentThread.latestTurn?.turnId ?? null;
      launchTurnIdByChildThreadId.set(String(childThreadId), parentTurnId);

      yield* orchestrationEngine.dispatch({
        type: "thread.create",
        commandId: serverCommandId("thread-create"),
        threadId: childThreadId,
        projectId: parentThread.projectId,
        title: label,
        modelSelection,
        runtimeMode: "approval-required",
        interactionMode: parentThread.interactionMode,
        ...(parentThread.tokenMode !== undefined ? { tokenMode: parentThread.tokenMode } : {}),
        branch: parentThread.branch,
        worktreePath: parentThread.worktreePath,
        threadKind: "managed-subagent",
        visibility: "nested",
        parentThreadId: parentThread.id,
        parentSubagentId: subagentId,
        createdAt,
      });

      if (parentThread.worktreeId !== undefined && parentThread.worktreeId !== null) {
        yield* orchestrationEngine.dispatch({
          type: "thread.attach-to-worktree",
          commandId: serverCommandId("thread-attach-worktree"),
          threadId: childThreadId,
          worktreeId: parentThread.worktreeId,
          attachedAt: createdAt,
        });
      }

      yield* appendParentActivity({
        parentThread,
        activity: subagentActivity({
          id: EventId.make(`managed-subagent:${subagentId}:started`),
          kind: "subagent.started",
          summary: `${label} started`,
          tone: "tool",
          createdAt,
          parentTurnId,
          subagentId,
          childThreadId,
          label,
          status: "running",
        }),
      });

      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: serverCommandId("turn-start"),
        threadId: childThreadId,
        message: {
          messageId: MessageId.make(`managed-subagent:${subagentId}:prompt`),
          role: "user",
          text: buildWorkerPrompt(event.payload.prompt),
          attachments: [],
        },
        runtimeMode: "approval-required",
        interactionMode: parentThread.interactionMode,
        modelSelection,
        titleSeed: label,
        ...(parentThread.tokenMode !== undefined ? { tokenMode: parentThread.tokenMode } : {}),
        createdAt,
      });
    }
  });

  const processSessionSet = Effect.fn("processSessionSet")(function* (
    event: Extract<ManagedSubagentEvent, { type: "thread.session-set" }>,
  ) {
    const childThread = yield* resolveThread(event.payload.threadId);
    if (
      !childThread ||
      childThread.threadKind !== "managed-subagent" ||
      childThread.parentThreadId == null ||
      childThread.parentSubagentId == null
    ) {
      return;
    }
    const status = event.payload.session.status;
    if (
      event.payload.session.activeTurnId !== null ||
      (status !== "ready" && status !== "error" && status !== "stopped")
    ) {
      return;
    }

    const completionKey = childThread.id;
    if (completedChildThreads.has(completionKey)) {
      return;
    }
    completedChildThreads.add(completionKey);

    const parentThreadId = childThread.parentThreadId;
    const parentSubagentId = childThread.parentSubagentId;
    const parentThread = yield* resolveThread(parentThreadId);
    if (!parentThread) {
      return;
    }

    const parentTurnId =
      findManagedSubagentLaunchTurnId({
        parentThread,
        parentSubagentId,
        childThreadId: childThread.id,
      }) ??
      launchTurnIdByChildThreadId.get(String(childThread.id)) ??
      null;
    const completedStatus =
      status === "error" ? "failed" : status === "stopped" ? "stopped" : "completed";
    yield* appendParentActivity({
      parentThread,
      activity: subagentActivity({
        id: EventId.make(`managed-subagent:${parentSubagentId}:completed:${status}`),
        kind: "subagent.completed",
        summary:
          completedStatus === "failed"
            ? `${childThread.title} failed`
            : completedStatus === "stopped"
              ? `${childThread.title} stopped`
              : `${childThread.title} completed`,
        tone: completedStatus === "failed" ? "error" : "tool",
        createdAt: event.occurredAt,
        parentTurnId,
        subagentId: parentSubagentId,
        childThreadId: childThread.id,
        label: childThread.title,
        status: completedStatus,
        ...(event.payload.session.lastError ? { detail: event.payload.session.lastError } : {}),
      }),
    });
  });

  const processActivityAppended = Effect.fn("processActivityAppended")(function* (
    event: Extract<ManagedSubagentEvent, { type: "thread.activity-appended" }>,
  ) {
    if (event.payload.activity.kind !== "approval.requested") {
      return;
    }
    const childThread = yield* resolveThread(event.payload.threadId);
    if (!childThread || childThread.threadKind !== "managed-subagent") {
      return;
    }
    const payload = event.payload.activity.payload as {
      readonly requestId?: string | undefined;
      readonly requestKind?: string | undefined;
      readonly requestType?: string | undefined;
    };
    if (
      payload.requestId === undefined ||
      (payload.requestKind !== "file-change" &&
        payload.requestType !== "file_change_approval" &&
        payload.requestType !== "apply_patch_approval")
    ) {
      return;
    }
    const key = `${childThread.id}:${payload.requestId}`;
    if (declinedApprovalRequests.has(key)) {
      return;
    }
    declinedApprovalRequests.add(key);

    yield* orchestrationEngine.dispatch({
      type: "thread.approval.respond",
      commandId: serverCommandId("approval-decline"),
      threadId: childThread.id,
      requestId: ApprovalRequestId.make(payload.requestId),
      decision: "decline",
      createdAt: new Date().toISOString(),
    });
  });

  const processEvent = Effect.fn("processEvent")(function* (event: ManagedSubagentEvent) {
    switch (event.type) {
      case "thread.managed-subagents-launch-requested":
        yield* processLaunchRequested(event);
        return;
      case "thread.session-set":
        yield* processSessionSet(event);
        return;
      case "thread.activity-appended":
        yield* processActivityAppended(event);
        return;
    }
  });

  const processEventSafely = (event: ManagedSubagentEvent) =>
    processEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("managed subagent reactor failed to process event", {
          eventType: event.type,
          threadId: event.payload.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processEventSafely);

  const start: ManagedSubagentReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (
          event.type !== "thread.managed-subagents-launch-requested" &&
          event.type !== "thread.session-set" &&
          event.type !== "thread.activity-appended"
        ) {
          return Effect.void;
        }
        return worker.enqueue(event);
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies ManagedSubagentReactorShape;
});

export const ManagedSubagentReactorLive = Layer.effect(ManagedSubagentReactor, make);
