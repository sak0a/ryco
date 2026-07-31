import type {
  AgentTokenMode,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
} from "@ryco/contracts";
import { DEFAULT_AGENT_TOKEN_MODE } from "@ryco/contracts";
import { derivePendingThreadRequestState } from "@ryco/shared/threadActivity";
import { canSettleThread, type ThreadSettlementBlocker } from "@ryco/shared/threadSettlement";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import {
  listThreadsByProjectId,
  listThreadsByWorktree,
  findWorktreeById,
  requireProject,
  requireProjectAbsent,
  requireThread,
  requireThreadHasUserMessage,
  requireThreadArchived,
  requireThreadAbsent,
  requireThreadNotArchived,
  requireWorktree,
} from "./commandInvariants.ts";
import { projectEvent } from "./projector.ts";

const nowIso = () => new Date().toISOString();
const defaultMetadata: Omit<OrchestrationEvent, "sequence" | "type" | "payload"> = {
  eventId: crypto.randomUUID() as OrchestrationEvent["eventId"],
  aggregateKind: "thread",
  aggregateId: "" as OrchestrationEvent["aggregateId"],
  occurredAt: nowIso(),
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
};

function withEventBase(
  input: Pick<OrchestrationCommand, "commandId"> & {
    readonly aggregateKind: OrchestrationEvent["aggregateKind"];
    readonly aggregateId: OrchestrationEvent["aggregateId"];
    readonly occurredAt: string;
    readonly metadata?: OrchestrationEvent["metadata"];
  },
): Omit<OrchestrationEvent, "sequence" | "type" | "payload"> {
  return {
    ...defaultMetadata,
    eventId: crypto.randomUUID() as OrchestrationEvent["eventId"],
    aggregateKind: input.aggregateKind,
    aggregateId: input.aggregateId,
    occurredAt: input.occurredAt,
    commandId: input.commandId,
    correlationId: input.commandId,
    metadata: input.metadata ?? {},
  };
}

type PlannedOrchestrationEvent = Omit<OrchestrationEvent, "sequence">;

const normalizeTokenMode = (mode: AgentTokenMode | undefined): AgentTokenMode =>
  mode ?? DEFAULT_AGENT_TOKEN_MODE;

function threadWorktree(
  readModel: OrchestrationReadModel,
  thread: OrchestrationReadModel["threads"][number],
) {
  if (thread.worktreeId !== null && thread.worktreeId !== undefined) {
    return findWorktreeById(readModel, thread.worktreeId);
  }
  if (thread.worktreePath === null) {
    return undefined;
  }
  return readModel.worktrees?.find(
    (worktree) =>
      worktree.projectId === thread.projectId && worktree.worktreePath === thread.worktreePath,
  );
}

function latestUserMessageAt(thread: OrchestrationReadModel["threads"][number]): string | null {
  return (
    thread.messages
      .filter((message) => message.role === "user")
      .map((message) => message.createdAt)
      .toSorted()
      .at(-1) ?? null
  );
}

function settlementBlockerDetail(blocker: ThreadSettlementBlocker): string {
  switch (blocker) {
    case "thread-archived":
      return "the thread is archived";
    case "thread-deleted":
      return "the thread is deleted";
    case "worktree-archived":
      return "its worktree is archived";
    case "pending-approval":
      return "an approval is pending";
    case "pending-user-input":
      return "user input is pending";
    case "session-starting":
      return "its provider session is starting";
    case "session-running":
      return "its provider session is running";
    case "queued-turn":
      return "a turn may still be queued";
    case "local-queue":
      return "a local message is queued";
    case "delivery-unknown":
      return "message delivery is unresolved";
    case "unsupported":
      return "thread settlement is unsupported";
  }
}

function activityUnsettledEvent(input: {
  readonly command: OrchestrationCommand;
  readonly thread: OrchestrationReadModel["threads"][number];
  readonly occurredAt: string;
}): PlannedOrchestrationEvent | null {
  if (input.thread.settledOverride === null) {
    return null;
  }
  return {
    ...withEventBase({
      aggregateKind: "thread",
      aggregateId: input.thread.id,
      occurredAt: input.occurredAt,
      commandId: input.command.commandId,
    }),
    type: "thread.unsettled",
    payload: {
      threadId: input.thread.id,
      reason: "activity",
      updatedAt: input.occurredAt,
    },
  };
}

type DecideOrchestrationCommandResult =
  | PlannedOrchestrationEvent
  | ReadonlyArray<PlannedOrchestrationEvent>;

const decideCommandSequence = Effect.fn("decideCommandSequence")(function* ({
  commands,
  readModel,
}: {
  readonly commands: ReadonlyArray<OrchestrationCommand>;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<ReadonlyArray<PlannedOrchestrationEvent>, OrchestrationCommandInvariantError> {
  let nextReadModel = readModel;
  let nextSequence = readModel.snapshotSequence;
  const plannedEvents: PlannedOrchestrationEvent[] = [];

  for (const nextCommand of commands) {
    const decided = yield* decideOrchestrationCommand({
      command: nextCommand,
      readModel: nextReadModel,
    });
    const nextEvents = Array.isArray(decided) ? decided : [decided];
    for (const nextEvent of nextEvents) {
      plannedEvents.push(nextEvent);
      nextSequence += 1;
      nextReadModel = yield* projectEvent(nextReadModel, {
        ...nextEvent,
        sequence: nextSequence,
      }).pipe(Effect.orDie);
    }
  }

  return plannedEvents;
});

export const decideOrchestrationCommand = Effect.fn("decideOrchestrationCommand")(function* ({
  command,
  readModel,
}: {
  readonly command: OrchestrationCommand;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<DecideOrchestrationCommandResult, OrchestrationCommandInvariantError> {
  switch (command.type) {
    case "project.create": {
      yield* requireProjectAbsent({
        readModel,
        command,
        projectId: command.projectId,
      });
      return {
        ...withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "project.created",
        payload: {
          projectId: command.projectId,
          title: command.title,
          workspaceRoot: command.workspaceRoot,
          projectMetadataDir: command.projectMetadataDir,
          defaultModelSelection: command.defaultModelSelection ?? null,
          customSystemPrompt: command.customSystemPrompt ?? null,
          scripts: [],
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "project.meta.update": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "project.meta-updated",
        payload: {
          projectId: command.projectId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.workspaceRoot !== undefined ? { workspaceRoot: command.workspaceRoot } : {}),
          ...(command.projectMetadataDir !== undefined
            ? { projectMetadataDir: command.projectMetadataDir }
            : {}),
          ...(command.defaultModelSelection !== undefined
            ? { defaultModelSelection: command.defaultModelSelection }
            : {}),
          ...(command.customSystemPrompt !== undefined
            ? { customSystemPrompt: command.customSystemPrompt }
            : {}),
          ...(command.scripts !== undefined ? { scripts: command.scripts } : {}),
          ...(command.preferredRemoteName !== undefined
            ? { preferredRemoteName: command.preferredRemoteName }
            : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "project.avatar.set": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "project.avatar-set",
        payload: {
          projectId: command.projectId,
          contentHash: command.contentHash,
          updatedAt: occurredAt,
        },
      };
    }

    case "project.delete": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const activeThreads = listThreadsByProjectId(readModel, command.projectId).filter(
        (thread) => thread.deletedAt === null,
      );
      if (activeThreads.length > 0 && command.force !== true) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Project '${command.projectId}' is not empty and cannot be deleted without force=true.`,
        });
      }
      if (activeThreads.length > 0) {
        return yield* decideCommandSequence({
          readModel,
          commands: [
            ...activeThreads.map(
              (thread): Extract<OrchestrationCommand, { type: "thread.delete" }> => ({
                type: "thread.delete",
                commandId: command.commandId,
                threadId: thread.id,
              }),
            ),
            {
              type: "project.delete",
              commandId: command.commandId,
              projectId: command.projectId,
            },
          ],
        });
      }

      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "project.deleted" as const,
        payload: {
          projectId: command.projectId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.create": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireThreadAbsent({
        readModel,
        command,
        threadId: command.threadId,
      });
      const tokenMode = normalizeTokenMode(command.tokenMode);
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.created",
        payload: {
          threadId: command.threadId,
          projectId: command.projectId,
          title: command.title,
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          tokenMode,
          branch: command.branch,
          worktreePath: command.worktreePath,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.delete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.deleted",
        payload: {
          threadId: command.threadId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.archive": {
      yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      yield* requireThreadHasUserMessage({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.archived",
        payload: {
          threadId: command.threadId,
          archivedAt: occurredAt,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.unarchive": {
      yield* requireThreadArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.unarchived",
        payload: {
          threadId: command.threadId,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.settle": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      if (thread.settledOverride === "settled" && thread.settledAt !== null) {
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: nowIso(),
            commandId: command.commandId,
          }),
          type: "thread.settled",
          payload: {
            threadId: command.threadId,
            settledAt: thread.settledAt,
            updatedAt: thread.updatedAt,
          },
        };
      }

      const pendingRequests = derivePendingThreadRequestState(thread.activities);
      const worktree = threadWorktree(readModel, thread);
      const occurredAt = nowIso();
      const eligibility = canSettleThread({
        threadSettlementSupported: true,
        archivedAt: thread.archivedAt,
        deletedAt: thread.deletedAt,
        worktreeArchivedAt: worktree?.archivedAt ?? null,
        settledOverride: thread.settledOverride,
        settledAt: thread.settledAt,
        sessionStatus: thread.session?.status ?? null,
        latestTurnState: thread.latestTurn?.state ?? null,
        latestTurnRequestedAt: thread.latestTurn?.requestedAt ?? null,
        latestTurnCompletedAt: thread.latestTurn?.completedAt ?? null,
        latestUserMessageAt: latestUserMessageAt(thread),
        hasPendingApprovals: pendingRequests.hasPendingApprovals,
        hasPendingUserInput: pendingRequests.hasPendingUserInput,
        hasLocalQueuedMessage: false,
        deliveryUnknown: false,
        prState: worktree?.prState ?? null,
        worktreeUpdatedAt: worktree?.updatedAt ?? null,
        updatedAt: thread.updatedAt,
        createdAt: thread.createdAt,
        nowMs: Date.parse(occurredAt),
      });
      if (!eligibility.canSettle) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Thread '${command.threadId}' cannot be settled because ${
            eligibility.blocker === null
              ? "its current state is ineligible"
              : settlementBlockerDetail(eligibility.blocker)
          }.`,
        });
      }

      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.settled",
        payload: {
          threadId: command.threadId,
          settledAt: occurredAt,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.unsettle": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      const alreadyExplicitlyActive = thread.settledOverride === "active";
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.unsettled",
        payload: {
          threadId: command.threadId,
          reason: command.reason,
          updatedAt: alreadyExplicitlyActive ? thread.updatedAt : occurredAt,
        },
      };
    }

    case "thread.meta.update": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.meta-updated",
        payload: {
          threadId: command.threadId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.branch !== undefined ? { branch: command.branch } : {}),
          ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.runtime-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.runtime-mode-set",
        payload: {
          threadId: command.threadId,
          runtimeMode: command.runtimeMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.interaction-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.interaction-mode-set",
        payload: {
          threadId: command.threadId,
          interactionMode: command.interactionMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.token-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.token-mode-set",
        payload: {
          threadId: command.threadId,
          tokenMode: command.tokenMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.turn.start": {
      const targetThread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      if (
        targetThread.session?.status === "running" &&
        targetThread.session.activeTurnId !== null
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Thread '${command.threadId}' already has active turn '${targetThread.session.activeTurnId}' and cannot start another turn until it finishes.`,
        });
      }
      const sourceProposedPlan = command.sourceProposedPlan;
      const sourceThread = sourceProposedPlan
        ? yield* requireThread({
            readModel,
            command,
            threadId: sourceProposedPlan.threadId,
          })
        : null;
      const sourcePlan =
        sourceProposedPlan && sourceThread
          ? sourceThread.proposedPlans.find((entry) => entry.id === sourceProposedPlan.planId)
          : null;
      if (sourceProposedPlan && !sourcePlan) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan.planId}' does not exist on thread '${sourceProposedPlan.threadId}'.`,
        });
      }
      if (sourceThread && sourceThread.projectId !== targetThread.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan?.planId}' belongs to thread '${sourceThread.id}' in a different project.`,
        });
      }
      const userMessageEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          role: "user",
          text: command.message.text,
          attachments: command.message.attachments,
          turnId: null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
      const turnStartRequestedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        causationEventId: userMessageEvent.eventId,
        type: "thread.turn-start-requested",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.titleSeed !== undefined ? { titleSeed: command.titleSeed } : {}),
          runtimeMode: targetThread.runtimeMode,
          interactionMode: targetThread.interactionMode,
          tokenMode: normalizeTokenMode(targetThread.tokenMode),
          ...(sourceProposedPlan !== undefined ? { sourceProposedPlan } : {}),
          createdAt: command.createdAt,
        },
      };
      const unsettledEvent = activityUnsettledEvent({
        command,
        thread: targetThread,
        occurredAt: command.createdAt,
      });
      return unsettledEvent === null
        ? [userMessageEvent, turnStartRequestedEvent]
        : [unsettledEvent, userMessageEvent, turnStartRequestedEvent];
    }

    case "thread.turn.interrupt": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.turn-interrupt-requested",
        payload: {
          threadId: command.threadId,
          ...(command.turnId !== undefined ? { turnId: command.turnId } : {}),
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.approval.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        }),
        type: "thread.approval-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          decision: command.decision,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.user-input.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        }),
        type: "thread.user-input-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          answers: command.answers,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.checkpoint.revert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.checkpoint-revert-requested",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.stop": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.session-stop-requested",
        payload: {
          threadId: command.threadId,
          createdAt: command.createdAt,
        },
      };
    }

    case "worktree.create": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      return {
        ...withEventBase({
          aggregateKind: "worktree",
          aggregateId: command.worktreeId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "worktree.created",
        payload: {
          worktreeId: command.worktreeId,
          projectId: command.projectId,
          branch: command.branch,
          worktreePath: command.worktreePath,
          origin: command.origin,
          prNumber: command.prNumber,
          issueNumber: command.issueNumber,
          prTitle: command.prTitle,
          issueTitle: command.issueTitle,
          workItemProvider: command.workItemProvider ?? null,
          workItemKey: command.workItemKey ?? null,
          workItemTitle: command.workItemTitle ?? null,
          workItemState: command.workItemState ?? null,
          workItemStateName: command.workItemStateName ?? null,
          workItemUrl: command.workItemUrl ?? null,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "worktree.archive": {
      return {
        ...withEventBase({
          aggregateKind: "worktree",
          aggregateId: command.worktreeId,
          occurredAt: command.archivedAt,
          commandId: command.commandId,
        }),
        type: "worktree.archived",
        payload: {
          worktreeId: command.worktreeId,
          archivedAt: command.archivedAt,
          deletedBranch: command.deletedBranch,
        },
      };
    }

    case "worktree.meta.update": {
      return {
        ...withEventBase({
          aggregateKind: "worktree",
          aggregateId: command.worktreeId,
          occurredAt: command.changedAt,
          commandId: command.commandId,
        }),
        type: "worktree.metaUpdated",
        payload: {
          worktreeId: command.worktreeId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.branch !== undefined ? { branch: command.branch } : {}),
          changedAt: command.changedAt,
        },
      };
    }

    case "worktree.source-control-state.update": {
      return {
        ...withEventBase({
          aggregateKind: "worktree",
          aggregateId: command.worktreeId,
          occurredAt: command.updatedAt,
          commandId: command.commandId,
        }),
        type: "worktree.sourceControlStateUpdated",
        payload: {
          worktreeId: command.worktreeId,
          ...(command.prNumber !== undefined ? { prNumber: command.prNumber } : {}),
          ...(command.prTitle !== undefined ? { prTitle: command.prTitle } : {}),
          prState: command.prState,
          prIsDraft: command.prIsDraft,
          issueState: command.issueState,
          updatedAt: command.updatedAt,
        },
      };
    }

    case "worktree.restore": {
      return {
        ...withEventBase({
          aggregateKind: "worktree",
          aggregateId: command.worktreeId,
          occurredAt: command.restoredAt,
          commandId: command.commandId,
        }),
        type: "worktree.restored",
        payload: {
          worktreeId: command.worktreeId,
          ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
          restoredAt: command.restoredAt,
        },
      };
    }

    case "worktree.delete": {
      const worktree = yield* requireWorktree({
        readModel,
        command,
        worktreeId: command.worktreeId,
      });
      const activeThreads = listThreadsByWorktree(readModel, worktree).filter(
        (thread) => thread.deletedAt === null,
      );
      if (activeThreads.length > 0) {
        return yield* decideCommandSequence({
          readModel,
          commands: [
            ...activeThreads.map(
              (thread): Extract<OrchestrationCommand, { type: "thread.delete" }> => ({
                type: "thread.delete",
                commandId: command.commandId,
                threadId: thread.id,
              }),
            ),
            command,
          ],
        });
      }
      return {
        ...withEventBase({
          aggregateKind: "worktree",
          aggregateId: command.worktreeId,
          occurredAt: command.deletedAt,
          commandId: command.commandId,
        }),
        type: "worktree.deleted",
        payload: {
          worktreeId: command.worktreeId,
          deletedAt: command.deletedAt,
          deletedBranch: command.deletedBranch,
        },
      };
    }

    case "thread.attach-to-worktree": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.attachedAt,
          commandId: command.commandId,
        }),
        type: "thread.attachedToWorktree",
        payload: {
          threadId: command.threadId,
          worktreeId: command.worktreeId,
          attachedAt: command.attachedAt,
        },
      };
    }

    case "thread.status-bucket.override": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.changedAt,
          commandId: command.commandId,
        }),
        type: "thread.statusBucketOverridden",
        payload: {
          threadId: command.threadId,
          bucket: command.bucket,
          changedAt: command.changedAt,
        },
      };
    }

    case "thread.manual-position.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.changedAt,
          commandId: command.commandId,
        }),
        type: "thread.manualPositionSet",
        payload: {
          threadId: command.threadId,
          position: command.position,
          changedAt: command.changedAt,
        },
      };
    }

    case "worktree.manual-position.set": {
      return {
        ...withEventBase({
          aggregateKind: "worktree",
          aggregateId: command.worktreeId,
          occurredAt: command.changedAt,
          commandId: command.commandId,
        }),
        type: "worktree.manualPositionSet",
        payload: {
          worktreeId: command.worktreeId,
          position: command.position,
          changedAt: command.changedAt,
        },
      };
    }

    case "thread.session.set": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const sessionEvent: PlannedOrchestrationEvent = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {},
        }),
        type: "thread.session-set",
        payload: {
          threadId: command.threadId,
          session: command.session,
        },
      };
      if (command.session.status !== "starting" && command.session.status !== "running") {
        return sessionEvent;
      }
      const unsettledEvent = activityUnsettledEvent({
        command,
        thread,
        occurredAt: command.createdAt,
      });
      return unsettledEvent === null ? sessionEvent : [unsettledEvent, sessionEvent];
    }

    case "thread.message.assistant.delta": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: command.delta,
          turnId: command.turnId ?? null,
          streaming: true,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.message.assistant.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: "",
          turnId: command.turnId ?? null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.proposed-plan.upsert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.proposed-plan-upserted",
        payload: {
          threadId: command.threadId,
          proposedPlan: command.proposedPlan,
        },
      };
    }

    case "thread.turn.diff.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.turn-diff-completed",
        payload: {
          threadId: command.threadId,
          turnId: command.turnId,
          checkpointTurnCount: command.checkpointTurnCount,
          checkpointRef: command.checkpointRef,
          status: command.status,
          files: command.files,
          assistantMessageId: command.assistantMessageId ?? null,
          completedAt: command.completedAt,
        },
      };
    }

    case "thread.revert.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.reverted",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
        },
      };
    }

    case "thread.activity.append": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const requestId =
        typeof command.activity.payload === "object" &&
        command.activity.payload !== null &&
        "requestId" in command.activity.payload &&
        typeof (command.activity.payload as { requestId?: unknown }).requestId === "string"
          ? ((command.activity.payload as { requestId: string })
              .requestId as OrchestrationEvent["metadata"]["requestId"])
          : undefined;
      const activityEvent: PlannedOrchestrationEvent = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          ...(requestId !== undefined ? { metadata: { requestId } } : {}),
        }),
        type: "thread.activity-appended",
        payload: {
          threadId: command.threadId,
          activity: command.activity,
        },
      };
      if (
        command.activity.kind !== "approval.requested" &&
        command.activity.kind !== "user-input.requested"
      ) {
        return activityEvent;
      }
      const unsettledEvent = activityUnsettledEvent({
        command,
        thread,
        occurredAt: command.createdAt,
      });
      return unsettledEvent === null ? activityEvent : [unsettledEvent, activityEvent];
    }

    default: {
      command satisfies never;
      const fallback = command as never as { type: string };
      return yield* new OrchestrationCommandInvariantError({
        commandType: fallback.type,
        detail: `Unknown command type: ${fallback.type}`,
      });
    }
  }
});
