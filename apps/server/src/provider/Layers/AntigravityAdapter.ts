import {
  DEFAULT_AGENT_TOKEN_MODE,
  EventId,
  type AntigravitySettings,
  type ChatAttachment,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  RuntimeRequestId,
  RuntimeTaskId,
  ThreadId,
  TurnId,
} from "@ryco/contracts";
import { Effect, Queue, Random, Semaphore, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { formatSourceControlContextsForAgent } from "@ryco/shared/sourceControlContextFormatter";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  type AntigravityConversationState,
  AntigravityRuntimeError,
  type AntigravityPromptProcess,
  runAntigravityPrompt,
} from "../antigravityRuntime.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { formatProjectCustomSystemPrompt } from "../ProjectCustomSystemPrompt.ts";
import type { AntigravityAdapterShape } from "../Services/AntigravityAdapter.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = ProviderDriverKind.make("antigravity");
const ANTIGRAVITY_RESUME_VERSION = 1 as const;
const AUTO_MODEL = "auto";

interface AntigravityResumeCursor {
  readonly schemaVersion: typeof ANTIGRAVITY_RESUME_VERSION;
  readonly conversationId?: string | undefined;
  readonly lastStepIdx: number;
}

interface AntigravityTurnSnapshot {
  readonly id: TurnId;
  readonly items: Array<unknown>;
}

interface AntigravitySessionContext {
  readonly threadId: ThreadId;
  session: ProviderSession;
  readonly cwd: string;
  readonly turns: Array<AntigravityTurnSnapshot>;
  readonly turnLock: Semaphore.Semaphore;
  conversationState: AntigravityConversationState;
  activeTurnId: TurnId | undefined;
  activeProcess: AntigravityPromptProcess | undefined;
  stopped: boolean;
  customSystemPrompt: string | undefined;
  readonly interruptedTurnIds: Set<TurnId>;
}

export interface AntigravityAdapterLiveOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAntigravityResumeCursor(raw: unknown): AntigravityConversationState {
  if (!isRecord(raw) || raw.schemaVersion !== ANTIGRAVITY_RESUME_VERSION) {
    return { lastStepIdx: 0 };
  }

  const conversationId =
    typeof raw.conversationId === "string" && raw.conversationId.trim().length > 0
      ? raw.conversationId.trim()
      : undefined;
  const lastStepIdx =
    typeof raw.lastStepIdx === "number" && Number.isFinite(raw.lastStepIdx) && raw.lastStepIdx >= 0
      ? Math.floor(raw.lastStepIdx)
      : 0;
  return {
    ...(conversationId ? { conversationId } : {}),
    lastStepIdx,
  };
}

function toResumeCursor(state: AntigravityConversationState): AntigravityResumeCursor {
  return {
    schemaVersion: ANTIGRAVITY_RESUME_VERSION,
    ...(state.conversationId ? { conversationId: state.conversationId } : {}),
    lastStepIdx: state.lastStepIdx,
  };
}

function selectModel(
  context: AntigravitySessionContext,
  inputModel:
    | {
        readonly instanceId: ProviderInstanceId;
        readonly model: string;
      }
    | undefined,
  boundInstanceId: ProviderInstanceId,
): Effect.Effect<string, ProviderAdapterValidationError> {
  if (inputModel !== undefined && inputModel.instanceId !== boundInstanceId) {
    return Effect.fail(
      new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "sendTurn",
        issue: `Antigravity model selection is bound to instance '${inputModel.instanceId}', expected '${boundInstanceId}'.`,
      }),
    );
  }
  return Effect.succeed(inputModel?.model ?? context.session.model ?? AUTO_MODEL);
}

function buildAttachmentNotes(input: {
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly attachmentsDir: string;
}): Effect.Effect<string, ProviderAdapterRequestError> {
  const lines: Array<string> = [];
  for (const attachment of input.attachments) {
    const attachmentPath = resolveAttachmentPath({
      attachmentsDir: input.attachmentsDir,
      attachment,
    });
    if (!attachmentPath) {
      return Effect.fail(
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "turn/start",
          detail: `Invalid attachment id '${attachment.id}'.`,
        }),
      );
    }
    lines.push(`- ${attachment.name} (${attachment.mimeType}): ${attachmentPath}`);
  }
  return Effect.succeed(
    lines.length > 0
      ? `Attached files are available at these local paths:\n${lines.join("\n")}`
      : "",
  );
}

function buildPrompt(input: {
  readonly turnInput: ProviderSendTurnInput;
  readonly attachmentsDir: string;
  readonly sessionCustomSystemPrompt?: string | undefined;
}): Effect.Effect<string, ProviderAdapterRequestError> {
  return Effect.gen(function* () {
    const sourceControl = formatSourceControlContextsForAgent(
      input.turnInput.sourceControlContexts ?? [],
    );
    const customSystemPrompt = formatProjectCustomSystemPrompt(
      input.turnInput.customSystemPrompt ?? input.sessionCustomSystemPrompt,
    );
    const userText = input.turnInput.input?.trim() ?? "";
    const attachmentNotes = yield* buildAttachmentNotes({
      attachments: input.turnInput.attachments ?? [],
      attachmentsDir: input.attachmentsDir,
    });

    return [customSystemPrompt, sourceControl, userText, attachmentNotes]
      .map((part) => part?.trim())
      .filter((part): part is string => part !== undefined && part.length > 0)
      .join("\n\n");
  });
}

function toRequestError(
  method: string,
  cause: AntigravityRuntimeError,
): ProviderAdapterRequestError {
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: cause.detail,
    cause,
  });
}

function remainingUnstreamedText(resultText: string, streamedText: string): string {
  if (streamedText.length === 0) {
    return resultText;
  }
  if (resultText === streamedText) {
    return "";
  }
  const streamedWithSeparator = `${streamedText}\n`;
  if (resultText.startsWith(streamedWithSeparator)) {
    return resultText.slice(streamedWithSeparator.length);
  }
  if (resultText.startsWith(streamedText)) {
    return resultText.slice(streamedText.length);
  }
  return resultText;
}

export function makeAntigravityAdapter(
  antigravitySettings: AntigravitySettings,
  options?: AntigravityAdapterLiveOptions,
) {
  return Effect.gen(function* () {
    const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("antigravity");
    const serverConfig = yield* ServerConfig;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const nativeEventLogger =
      options?.nativeEventLogger ??
      (options?.nativeEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, { stream: "native" })
        : undefined);
    const managedNativeEventLogger =
      options?.nativeEventLogger === undefined ? nativeEventLogger : undefined;
    const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, AntigravitySessionContext>();

    const emit = (event: ProviderRuntimeEvent) =>
      Queue.offer(runtimeEvents, event).pipe(Effect.asVoid);

    const writeNativeEvent = (threadId: ThreadId, event: Record<string, unknown>) =>
      nativeEventLogger
        ? nativeEventLogger
            .write(
              {
                observedAt: nowIso(),
                event,
              },
              threadId,
            )
            .pipe(Effect.catchCause(() => Effect.void))
        : Effect.void;

    const buildEventBase = (input: {
      readonly threadId: ThreadId;
      readonly turnId?: TurnId | undefined;
      readonly itemId?: string | undefined;
      readonly requestId?: string | undefined;
      readonly raw?: ProviderRuntimeEvent["raw"] | undefined;
    }) =>
      Random.nextUUIDv4.pipe(
        Effect.map((uuid) => ({
          eventId: EventId.make(uuid),
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: input.threadId,
          createdAt: nowIso(),
          ...(input.turnId ? { turnId: input.turnId } : {}),
          ...(input.itemId ? { itemId: RuntimeItemId.make(input.itemId) } : {}),
          ...(input.requestId ? { requestId: RuntimeRequestId.make(input.requestId) } : {}),
          ...(input.raw ? { raw: input.raw } : {}),
        })),
      );

    const requireSession = (
      threadId: ThreadId,
    ): Effect.Effect<
      AntigravitySessionContext,
      ProviderAdapterSessionNotFoundError | ProviderAdapterSessionClosedError
    > =>
      Effect.gen(function* () {
        const context = sessions.get(threadId);
        if (!context) {
          return yield* new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId });
        }
        if (context.stopped) {
          return yield* new ProviderAdapterSessionClosedError({ provider: PROVIDER, threadId });
        }
        return context;
      });

    const updateProviderSession = (
      context: AntigravitySessionContext,
      patch: Partial<ProviderSession>,
      options?: { readonly clearActiveTurnId?: boolean; readonly clearLastError?: boolean },
    ) => {
      const next: Record<string, unknown> = {
        ...context.session,
        ...patch,
        updatedAt: nowIso(),
      };
      if (options?.clearActiveTurnId) {
        delete next.activeTurnId;
      }
      if (options?.clearLastError) {
        delete next.lastError;
      }
      context.session = next as ProviderSession;
      return context.session;
    };

    const stopContext = Effect.fn("stopAntigravityContext")(function* (
      context: AntigravitySessionContext,
    ) {
      if (context.stopped) {
        return false;
      }
      context.stopped = true;
      const activeProcess = context.activeProcess;
      context.activeProcess = undefined;
      if (activeProcess) {
        yield* activeProcess.kill;
      }
      updateProviderSession(
        context,
        {
          status: "closed",
        },
        { clearActiveTurnId: true },
      );
      return true;
    });

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const contexts = [...sessions.values()];
        sessions.clear();
        yield* Effect.forEach(contexts, (context) => stopContext(context).pipe(Effect.ignore), {
          concurrency: "unbounded",
          discard: true,
        });
        if (managedNativeEventLogger !== undefined) {
          yield* managedNativeEventLogger.close();
        }
      }).pipe(Effect.ensuring(Queue.shutdown(runtimeEvents))),
    );

    const startSession: AntigravityAdapterShape["startSession"] = Effect.fn("startSession")(
      function* (input) {
        if (input.provider !== undefined && input.provider !== PROVIDER) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Cannot start Antigravity adapter for provider '${input.provider}'.`,
          });
        }
        if (
          input.providerInstanceId !== undefined &&
          input.providerInstanceId !== boundInstanceId
        ) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Cannot start Antigravity adapter for instance '${input.providerInstanceId}'.`,
          });
        }

        const existing = sessions.get(input.threadId);
        if (existing) {
          yield* stopContext(existing).pipe(Effect.ignore);
          sessions.delete(input.threadId);
        }

        const cwd = input.cwd ?? serverConfig.cwd;
        const conversationState = parseAntigravityResumeCursor(input.resumeCursor);
        const createdAt = nowIso();
        const tokenMode = input.tokenMode ?? DEFAULT_AGENT_TOKEN_MODE;
        const session: ProviderSession = {
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          status: "ready",
          runtimeMode: input.runtimeMode,
          tokenMode,
          cwd,
          model: input.modelSelection?.model ?? AUTO_MODEL,
          threadId: input.threadId,
          resumeCursor: toResumeCursor(conversationState),
          createdAt,
          updatedAt: createdAt,
        };
        const context: AntigravitySessionContext = {
          threadId: input.threadId,
          session,
          cwd,
          turns: [],
          turnLock: yield* Semaphore.make(1),
          conversationState,
          activeTurnId: undefined,
          activeProcess: undefined,
          stopped: false,
          customSystemPrompt: input.customSystemPrompt,
          interruptedTurnIds: new Set(),
        };
        sessions.set(input.threadId, context);

        yield* emit({
          ...(yield* buildEventBase({ threadId: input.threadId })),
          type: "session.started",
          payload: {
            message: "Antigravity session started",
            resume: toResumeCursor(conversationState),
          },
        });
        const threadStartedPayload = conversationState.conversationId
          ? { providerThreadId: conversationState.conversationId }
          : {};
        yield* emit({
          ...(yield* buildEventBase({ threadId: input.threadId })),
          type: "thread.started",
          payload: threadStartedPayload,
        });

        return session;
      },
    );

    const sendTurn: AntigravityAdapterShape["sendTurn"] = Effect.fn("sendTurn")(function* (input) {
      const context = yield* requireSession(input.threadId);
      return yield* context.turnLock.withPermit(
        Effect.gen(function* () {
          if (context.stopped) {
            return yield* new ProviderAdapterSessionClosedError({
              provider: PROVIDER,
              threadId: input.threadId,
            });
          }
          const turnId = TurnId.make(`antigravity-turn-${yield* Random.nextUUIDv4}`);
          const model = yield* selectModel(context, input.modelSelection, boundInstanceId);
          const prompt = yield* buildPrompt({
            turnInput: input,
            attachmentsDir: serverConfig.attachmentsDir,
            sessionCustomSystemPrompt: context.customSystemPrompt,
          });

          if (prompt.trim().length === 0) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: "Antigravity turns require non-empty text or at least one attachment.",
            });
          }

          if (input.customSystemPrompt !== undefined) {
            context.customSystemPrompt = input.customSystemPrompt;
          }

          const itemId = `antigravity-message-${turnId}`;
          const taskId = RuntimeTaskId.make(`antigravity-task-${turnId}`);
          const turnStartedAt = Date.now();
          context.activeTurnId = turnId;
          updateProviderSession(
            context,
            {
              status: "running",
              activeTurnId: turnId,
              model,
            },
            { clearLastError: true },
          );

          const turnStartedPayload = model !== AUTO_MODEL ? { model } : {};
          yield* emit({
            ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
            type: "turn.started",
            payload: turnStartedPayload,
          });
          yield* emit({
            ...(yield* buildEventBase({ threadId: input.threadId, turnId, itemId })),
            type: "item.started",
            payload: {
              itemType: "assistant_message",
              status: "inProgress",
              title: "Assistant message",
            },
          });
          yield* emit({
            ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
            type: "task.started",
            payload: {
              taskId,
              taskType: "antigravity",
              description: "Running Antigravity CLI",
            },
          });
          yield* emit({
            ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
            type: "task.progress",
            payload: {
              taskId,
              description: "Antigravity CLI is running",
              summary: "Antigravity CLI is running",
              lastToolName: "agy",
            },
          });

          const result = yield* runAntigravityPrompt({
            settings: antigravitySettings,
            cwd: context.cwd,
            prompt,
            runtimeMode: context.session.runtimeMode,
            model,
            state: context.conversationState,
            environment: options?.environment,
            onProcessStart: (process) =>
              Effect.sync(() => {
                context.activeProcess = process;
              }),
            onProcessExit: Effect.sync(() => {
              context.activeProcess = undefined;
            }),
            onTextDelta: (delta) =>
              Effect.gen(function* () {
                const raw = {
                  source: "antigravity.cli" as const,
                  payload: {
                    event: "prompt.delta",
                    conversationId: delta.conversationId,
                    lastStepIdx: delta.lastStepIdx,
                  },
                };
                yield* emit({
                  ...(yield* buildEventBase({
                    threadId: input.threadId,
                    turnId,
                    itemId,
                    raw,
                  })),
                  type: "content.delta",
                  payload: {
                    streamKind: "assistant_text",
                    delta: delta.text,
                  },
                });
              }),
            onActivity: (activity) =>
              buildEventBase({
                threadId: input.threadId,
                turnId,
              }).pipe(
                Effect.flatMap((base) =>
                  emit({
                    ...base,
                    type: "task.progress",
                    payload: {
                      taskId,
                      description: activity.summary,
                      summary: activity.summary,
                      lastToolName: "agy",
                      usage: {
                        elapsedMs: activity.elapsedMs,
                        ...(activity.conversationId
                          ? { conversationId: activity.conversationId }
                          : {}),
                      },
                    },
                  }),
                ),
              ),
          }).pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            Effect.tapError((cause) =>
              Effect.gen(function* () {
                const interrupted = context.interruptedTurnIds.delete(turnId);
                context.activeTurnId = undefined;
                context.activeProcess = undefined;
                updateProviderSession(
                  context,
                  {
                    status: "ready",
                    ...(interrupted ? {} : { lastError: cause.detail }),
                  },
                  {
                    clearActiveTurnId: true,
                    ...(interrupted ? { clearLastError: true } : {}),
                  },
                );
                yield* emit({
                  ...(yield* buildEventBase({ threadId: input.threadId, turnId, itemId })),
                  type: "item.completed",
                  payload: {
                    itemType: "assistant_message",
                    status: "failed",
                    title: "Assistant message",
                    detail: interrupted ? "Interrupted by user." : cause.detail,
                  },
                });
                yield* emit({
                  ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
                  type: "task.completed",
                  payload: {
                    taskId,
                    status: interrupted ? "stopped" : "failed",
                    summary: interrupted ? "Antigravity interrupted" : cause.detail,
                    usage: {
                      durationMs: Math.max(0, Date.now() - turnStartedAt),
                    },
                  },
                });
                if (interrupted) {
                  yield* emit({
                    ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
                    type: "turn.aborted",
                    payload: {
                      reason: "Interrupted by user.",
                    },
                  });
                } else {
                  yield* emit({
                    ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
                    type: "runtime.error",
                    payload: {
                      message: cause.detail,
                      class: "provider_error",
                      detail: { operation: cause.operation },
                    },
                  });
                }
                yield* emit({
                  ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
                  type: "turn.completed",
                  payload: {
                    state: interrupted ? "interrupted" : "failed",
                    stopReason: interrupted ? "interrupted" : "error",
                    ...(interrupted ? {} : { errorMessage: cause.detail }),
                  },
                });
              }),
            ),
            Effect.mapError((cause) => toRequestError("turn/start", cause)),
          );

          context.conversationState = {
            ...(result.conversationId ? { conversationId: result.conversationId } : {}),
            lastStepIdx: result.lastStepIdx,
          };
          const resumeCursor = toResumeCursor(context.conversationState);
          updateProviderSession(
            context,
            {
              status: "ready",
              model,
              resumeCursor,
            },
            { clearActiveTurnId: true, clearLastError: true },
          );
          context.activeTurnId = undefined;
          context.activeProcess = undefined;
          context.turns.push({
            id: turnId,
            items: [
              {
                type: "assistant_message",
                text: result.text,
                conversationId: result.conversationId,
                lastStepIdx: result.lastStepIdx,
              },
            ],
          });

          const raw = {
            source: "antigravity.cli" as const,
            payload: {
              exitCode: result.exitCode,
              stderr: result.stderr,
              conversationId: result.conversationId,
              lastStepIdx: result.lastStepIdx,
            },
          };

          yield* writeNativeEvent(input.threadId, {
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: input.threadId,
            turnId,
            event: "prompt.completed",
            payload: raw.payload,
          });
          const finalDelta = remainingUnstreamedText(result.text, result.streamedText);
          if (finalDelta.length > 0) {
            yield* emit({
              ...(yield* buildEventBase({ threadId: input.threadId, turnId, itemId, raw })),
              type: "content.delta",
              payload: {
                streamKind: "assistant_text",
                delta: finalDelta,
              },
            });
          }
          yield* emit({
            ...(yield* buildEventBase({ threadId: input.threadId, turnId, itemId, raw })),
            type: "item.completed",
            payload: {
              itemType: "assistant_message",
              status: "completed",
              title: "Assistant message",
              detail: result.text,
            },
          });
          yield* emit({
            ...(yield* buildEventBase({ threadId: input.threadId, turnId, raw })),
            type: "task.completed",
            payload: {
              taskId,
              status: "completed",
              summary: "Antigravity response received",
              usage: {
                durationMs: Math.max(0, Date.now() - turnStartedAt),
              },
            },
          });
          yield* emit({
            ...(yield* buildEventBase({ threadId: input.threadId, turnId, raw })),
            type: "turn.completed",
            payload: {
              state: "completed",
              stopReason: null,
            },
          });

          return {
            threadId: input.threadId,
            turnId,
            resumeCursor,
          };
        }),
      );
    });

    const interruptTurn: AntigravityAdapterShape["interruptTurn"] = Effect.fn("interruptTurn")(
      function* (threadId, turnId) {
        const context = yield* requireSession(threadId);
        const targetTurnId = turnId ?? context.activeTurnId;
        if (targetTurnId) {
          context.interruptedTurnIds.add(targetTurnId);
        }
        const activeProcess = context.activeProcess;
        if (activeProcess) {
          yield* activeProcess.kill;
        }
        if (targetTurnId) {
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId: targetTurnId })),
            type: "turn.aborted",
            payload: {
              reason: "Interrupted by user.",
            },
          });
        }
      },
    );

    const respondToRequest: AntigravityAdapterShape["respondToRequest"] = Effect.fn(
      "respondToRequest",
    )(function* (_threadId, requestId) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "respondToRequest",
        detail: `Antigravity CLI did not expose a pending approval request: ${requestId}`,
      });
    });

    const respondToUserInput: AntigravityAdapterShape["respondToUserInput"] = Effect.fn(
      "respondToUserInput",
    )(function* (_threadId, requestId) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "respondToUserInput",
        detail: `Antigravity CLI did not expose a pending user-input request: ${requestId}`,
      });
    });

    const stopSession: AntigravityAdapterShape["stopSession"] = Effect.fn("stopSession")(
      function* (threadId) {
        const context = yield* requireSession(threadId);
        const stopped = yield* stopContext(context);
        sessions.delete(threadId);
        if (!stopped) {
          return;
        }
        yield* emit({
          ...(yield* buildEventBase({ threadId })),
          type: "session.exited",
          payload: {
            reason: "Session stopped.",
            recoverable: false,
            exitKind: "graceful",
          },
        });
      },
    );

    const listSessions: AntigravityAdapterShape["listSessions"] = () =>
      Effect.sync(() => [...sessions.values()].map((context) => context.session));

    const hasSession: AntigravityAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const context = sessions.get(threadId);
        return context !== undefined && !context.stopped;
      });

    const readThread: AntigravityAdapterShape["readThread"] = Effect.fn("readThread")(
      function* (threadId) {
        const context = yield* requireSession(threadId);
        return {
          threadId,
          turns: context.turns,
        };
      },
    );

    const rollbackThread: AntigravityAdapterShape["rollbackThread"] = Effect.fn("rollbackThread")(
      function* (threadId, numTurns) {
        const context = yield* requireSession(threadId);
        if (!Number.isInteger(numTurns) || numTurns < 1) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: "numTurns must be an integer >= 1.",
          });
        }
        const nextLength = Math.max(0, context.turns.length - numTurns);
        context.turns.splice(nextLength);
        return {
          threadId,
          turns: context.turns,
        };
      },
    );

    const stopAll: AntigravityAdapterShape["stopAll"] = () =>
      Effect.gen(function* () {
        const contexts = [...sessions.values()];
        sessions.clear();
        yield* Effect.forEach(contexts, (context) => stopContext(context).pipe(Effect.ignore), {
          concurrency: "unbounded",
          discard: true,
        });
      });

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "in-session",
      },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      readThread,
      rollbackThread,
      stopAll,
      get streamEvents() {
        return Stream.fromQueue(runtimeEvents);
      },
    } satisfies AntigravityAdapterShape;
  });
}
