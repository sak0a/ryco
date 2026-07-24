import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

import { getWsConnectionStatus, getWsConnectionUiState } from "@ryco/client-runtime/rpc";
import { scopeProjectRef, scopeThreadRef } from "@ryco/client-runtime/scoped";
import { EnvironmentId, ThreadId } from "@ryco/contracts";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { ErrorBanner } from "../../components/ErrorBanner";
import { ensureEnvironmentApi } from "../../connection/environmentApi";
import { retainThreadDetailSubscription } from "../../connection/threadDetail";
import { newCommandId, newMessageId } from "../../lib/ids";
import { enqueueThreadOutboxMessage } from "../../state/threadOutbox";
import { useThreadTimeline } from "../../state/threadTimeline";
import { selectProjectByRef, selectThreadByRef, useStore } from "../../state/threadsRuntime";
import { executeSendTurn } from "./executeSendTurn";
import { sendThreadTurn } from "./sendThreadTurn";
import { PendingApprovalCard } from "./PendingApprovalCard";
import { PendingUserInputCard } from "./PendingUserInputCard";
import { ThreadComposer } from "./ThreadComposer";

export function ThreadDetailScreen(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const { environmentId, threadId } = props;
  const [sendError, setSendError] = useState<string | null>(null);

  // Retain the supervisor's thread-detail subscription while mounted, and make
  // this the active environment (spec Thread-row requirement + the B1 gap).
  useEffect(() => {
    useStore.getState().setActiveEnvironmentId(environmentId);
    return retainThreadDetailSubscription(environmentId, threadId);
  }, [environmentId, threadId]);

  const built = useThreadTimeline(environmentId, threadId);
  const thread = useStore((state) =>
    selectThreadByRef(state, scopeThreadRef(environmentId, threadId)),
  );

  const onSend = async (text: string): Promise<boolean> => {
    setSendError(null);
    const state = useStore.getState();
    const currentThread = selectThreadByRef(state, scopeThreadRef(environmentId, threadId));
    if (!currentThread) {
      setSendError("Thread is not loaded yet.");
      return false;
    }
    const project = selectProjectByRef(
      state,
      scopeProjectRef(environmentId, currentThread.projectId),
    );
    const modelSelection = project?.defaultModelSelection ?? null;
    if (!modelSelection) {
      setSendError("No model is configured for this project.");
      return false;
    }

    const tokenMode = currentThread.tokenMode ?? "balanced";
    // A turn already running (or a disconnected socket) routes the send into the
    // offline outbox instead of dispatching immediately (§3-14).
    const threadBusy = currentThread.latestTurn?.state === "running";
    const connected = getWsConnectionUiState(getWsConnectionStatus()) === "connected";

    return sendThreadTurn(
      {
        environmentId,
        threadId,
        text,
        attachments: [],
        modelSelection,
        runtimeMode: currentThread.runtimeMode,
        interactionMode: currentThread.interactionMode,
        tokenMode,
        threadBusy,
        connected,
      },
      {
        newMessageId,
        newCommandId,
        now: () => new Date().toISOString(),
        enqueue: enqueueThreadOutboxMessage,
        dispatch: () =>
          executeSendTurn({
            api: ensureEnvironmentApi(environmentId),
            thread: {
              threadId,
              isFirstMessage: currentThread.messages.length === 0,
              isServerThread: true,
              isLocalDraftThread: false,
              activeThreadBranch: currentThread.branch,
              worktreePath: currentThread.worktreePath,
              createdAt: currentThread.createdAt,
            },
            composer: {
              prompt: text,
              images: [],
              selectedModelSelection: modelSelection,
              selectedModel: modelSelection.model,
              hasSelectedModel: true,
            },
            project: {
              projectId: currentThread.projectId,
              projectCwd: project?.cwd ?? "",
              defaultModel: modelSelection.model,
            },
            settings: {
              runtimeMode: currentThread.runtimeMode,
              interactionMode: currentThread.interactionMode,
              tokenMode,
            },
            title: currentThread.title,
            clearDraft: () => {},
            restoreDraft: () => {},
            setThreadError: (_id, error) => setSendError(error),
          }),
      },
    );
  };

  const pendingApprovals = built?.viewModel.pendingApprovals ?? [];
  const pendingUserInputs = built?.viewModel.pendingUserInputs ?? [];

  return (
    <View className="flex-1 bg-screen">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        className="flex-1"
        contentContainerStyle={{ paddingVertical: 12 }}
      >
        {sendError ? <ErrorBanner message={sendError} /> : null}
        {!built ? (
          <View className="px-4 py-16">
            <EmptyState variant="plain" title="Loading thread" detail="Syncing the conversation." />
          </View>
        ) : built.timeline.length === 0 ? (
          <View className="px-4 py-16">
            <EmptyState
              variant="plain"
              title={thread?.title ?? "Thread"}
              detail="No messages yet. Send one to get started."
            />
          </View>
        ) : (
          built.timeline.map((entry) => {
            if (entry.kind === "message") {
              const isUser = entry.message.role === "user";
              return (
                <View
                  key={entry.id}
                  className={`px-4 py-2 ${isUser ? "items-end" : "items-start"}`}
                >
                  <View
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                      isUser ? "bg-primary" : "border border-border bg-card"
                    }`}
                  >
                    <Text
                      className={`font-sans text-base ${isUser ? "text-primary-foreground" : "text-foreground"}`}
                    >
                      {entry.message.text || (entry.message.streaming ? "…" : "")}
                    </Text>
                  </View>
                </View>
              );
            }
            if (entry.kind === "proposed-plan") {
              return (
                <View
                  key={entry.id}
                  className="mx-4 my-2 rounded-2xl border border-violet-500/40 bg-violet-500/10 p-4"
                >
                  <Text className="text-xs font-ryco-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                    Proposed plan
                  </Text>
                  <Text className="mt-1 font-sans text-sm text-foreground" numberOfLines={12}>
                    {entry.proposedPlan.planMarkdown}
                  </Text>
                </View>
              );
            }
            if (entry.kind === "context-compaction") {
              return (
                <View key={entry.id} className="my-3 flex-row items-center gap-2 px-6">
                  <View className="h-px flex-1 bg-border" />
                  <Text className="text-2xs uppercase tracking-wide text-foreground-muted">
                    Context compacted
                  </Text>
                  <View className="h-px flex-1 bg-border" />
                </View>
              );
            }
            return (
              <View key={entry.id} className="px-6 py-1">
                <Text className="font-mono text-xs text-foreground-muted" numberOfLines={2}>
                  {entry.entry.label ?? "Working…"}
                </Text>
              </View>
            );
          })
        )}

        {pendingApprovals.map((approval) => (
          <PendingApprovalCard
            key={approval.requestId}
            environmentId={environmentId}
            threadId={threadId}
            approval={approval}
          />
        ))}
        {pendingUserInputs.map((userInput) => (
          <PendingUserInputCard
            key={userInput.requestId}
            environmentId={environmentId}
            threadId={threadId}
            userInput={userInput}
          />
        ))}
      </ScrollView>

      <ThreadComposer onSend={onSend} />
    </View>
  );
}
