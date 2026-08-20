import { useAtomValue } from "@effect/atom-react";
import { LegendList, type LegendListRenderItemProps } from "@legendapp/list/react-native";
import { useNavigation } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Pressable, ScrollView, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { serverConfigAtom } from "@ryco/client-runtime/rpc";
import {
  getProviderInteractionModeToggle,
  getProviderSupportsAskMode,
} from "@ryco/client-runtime/state/composer";
import { scopeProjectRef, scopeThreadRef } from "@ryco/client-runtime/scoped";
import type { TimelineEntry } from "@ryco/client-runtime/state/session";
import {
  buildQueuedMessageSteerCommand,
  resolveQueuedMessageSteerEligibility,
} from "@ryco/client-runtime/state/message-queue";
import { EnvironmentId, MessageId, ThreadId } from "@ryco/contracts";
import { IMAGE_ONLY_BOOTSTRAP_PROMPT } from "@ryco/client-runtime/state/composer";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { ErrorBanner } from "../../components/ErrorBanner";
import { SymbolView } from "../../components/AppSymbol";
import { ensureEnvironmentApi } from "../../connection/environmentApi";
import {
  loadOlderThreadMessages,
  retainThreadDetailSubscription,
} from "../../connection/threadDetail";
import { useThreadConnectionRetarget } from "../../connection/useThreadConnectionRetarget";
import type { DraftComposerImageAttachment } from "../../lib/composerImages";
import { newCommandId, newMessageId } from "../../lib/ids";
import { useThemeColor } from "../../lib/useThemeColor";
import {
  selectAgentControlProposalsForThread,
  useAgentControlStore,
} from "../../state/agentControlRuntime";
import { useAgentControlSync } from "../../state/agentControlSync";
import { useHomeWorkspaceData } from "../../state/homeData";
import {
  useWsConnectionStatusForEnvironment,
  wsUiStateForEnvironment,
} from "../../rpc/wsConnectionState";
import {
  enqueueThreadOutboxMessage,
  listThreadOutboxMessages,
  removeThreadOutboxMessage,
  subscribeThreadOutbox,
} from "../../state/threadOutbox";
import { buildQueuedThreadMessageAttachments } from "../../state/queuedThreadMessageAttachments";
import type { QueuedThreadMessage } from "../../state/threadOutboxModel";
import { useThreadTimeline } from "../../state/threadTimeline";
import {
  selectEnvironmentHydratedFromCacheAt,
  selectProjectByRef,
  selectThreadByRef,
  useStore,
} from "../../state/threadsRuntime";
import { useHomeEnvironments } from "../home/useHomeEnvironments";
import { AgentControlProposalCard } from "./AgentControlProposalCard";
import { executeSendTurn } from "./executeSendTurn";
import { PendingApprovalCard } from "./PendingApprovalCard";
import { PendingUserInputCard } from "./PendingUserInputCard";
import { sendThreadTurn } from "./sendThreadTurn";
import {
  interruptThreadTurn,
  renameThread,
  setThreadArchived,
  setThreadInteractionMode,
  setThreadModelSelection,
  setThreadRuntimeMode,
} from "./sessionActions";
import { useThreadChecks } from "./useThreadChecks";
import { buildThreadTimelineRows, toggleFold, type ThreadTimelineRow } from "./threadActivityFold";
import { ThreadActivityFoldRow } from "./ThreadActivityFoldRow";
import {
  applyModelOption,
  buildModelPickerModel,
  resolveModelPickerSelection,
} from "./modelPickerModel";
import { ModelPickerSheet } from "./ModelPickerSheet";
import { buildSessionPolicyModel, resolveSessionPolicySelection } from "./sessionPolicyModel";
import { SessionPolicySheet } from "./SessionPolicySheet";
import { ThreadActionsSheet } from "./ThreadActionsSheet";
import { ThreadComposer } from "./ThreadComposer";
import { deriveThreadCachedView } from "./threadCachedViewModel";
import { ThreadQueuedMessages } from "./ThreadQueuedMessages";
import { ThreadContextBar } from "./ThreadContextBar";
import {
  buildThreadHeaderModel,
  findThreadWorktree,
  type ThreadHeaderModel,
} from "./threadHeaderModel";
import { ThreadMessage } from "./ThreadMessage";
import { proposedPlanPresentation } from "./threadPresentation";

function TimelineRow(props: { readonly entry: TimelineEntry }) {
  const { entry } = props;
  if (entry.kind === "message") {
    return <ThreadMessage message={entry.message} />;
  }
  if (entry.kind === "proposed-plan") {
    const presentation = proposedPlanPresentation();
    return (
      <View className={`mx-4 my-2 rounded-2xl p-4 ${presentation.containerClassName}`}>
        <Text
          className={`text-xs font-ryco-bold uppercase tracking-wide ${presentation.labelClassName}`}
        >
          Proposed plan
        </Text>
        <Text className="mt-1 font-sans text-sm text-foreground" selectable>
          {entry.proposedPlan.planMarkdown}
        </Text>
      </View>
    );
  }
  if (entry.kind === "context-compaction") {
    return (
      <View className="my-3 flex-row items-center gap-2 px-6">
        <View className="h-px flex-1 bg-border" />
        <Text className="text-2xs uppercase tracking-wide text-foreground-muted">
          Context compacted
        </Text>
        <View className="h-px flex-1 bg-border" />
      </View>
    );
  }
  // Work entries never reach here — buildThreadTimelineRows folds them before
  // the list sees them. This is the remaining unknown-kind fallback.
  return null;
}

/**
 * The cached / degraded strip. Sits with ErrorBanner between the context bar
 * and the timeline, and carries the context bar's `mx-4` so the three read as
 * one column. Copy and tone are decided in threadCachedViewModel.ts.
 */
function ThreadCachedBanner(props: { readonly text: string; readonly tone: "info" | "warning" }) {
  const warning = props.tone === "warning";
  return (
    <View
      accessibilityRole="alert"
      testID="thread-cached-banner"
      className={`mx-4 mb-1 rounded-2xl border px-3.5 py-3 ${
        warning ? "border-warning-border bg-warning-bg" : "border-border bg-card-translucent"
      }`}
    >
      <Text
        className={`font-ryco-medium text-sm ${warning ? "text-warning" : "text-foreground-muted"}`}
      >
        {props.text}
      </Text>
    </View>
  );
}

function HeaderActions(props: {
  readonly model: ThreadHeaderModel;
  readonly iconColor: string;
  readonly onReview: () => void;
  readonly onFiles: () => void;
  readonly onMore: () => void;
}) {
  return (
    <View className="flex-row items-center gap-1">
      {props.model.reviewVisible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Review changes"
          onPress={props.onReview}
          className="h-11 items-center justify-center rounded-full px-3 active:bg-subtle-strong"
        >
          <Text className="text-sm font-ryco-bold text-foreground">Review</Text>
        </Pressable>
      ) : null}
      {props.model.filesVisible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open files"
          onPress={props.onFiles}
          className="h-11 w-11 items-center justify-center rounded-full active:bg-subtle-strong"
        >
          <SymbolView name="folder" size={21} tintColor={props.iconColor} type="monochrome" />
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="More task actions"
        onPress={props.onMore}
        className="h-11 w-11 items-center justify-center rounded-full active:bg-subtle-strong"
      >
        <SymbolView name="ellipsis" size={21} tintColor={props.iconColor} type="monochrome" />
      </Pressable>
    </View>
  );
}

export function ThreadDetailScreen(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const { environmentId, threadId } = props;
  const navigation = useNavigation();
  const headerHeight = useHeaderHeight();
  const iconColor = String(useThemeColor("--color-icon"));
  const [sendError, setSendError] = useState<string | null>(null);
  const [actionsVisible, setActionsVisible] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [policyVisible, setPolicyVisible] = useState(false);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [modelVisible, setModelVisible] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [steeringMessageIds, setSteeringMessageIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [expandedFoldIds, setExpandedFoldIds] = useState<ReadonlySet<string>>(() => new Set());
  const serverConfig = useAtomValue(serverConfigAtom);
  // This screen renders one environment's content; its connection banner and
  // gating must track THAT node's socket, not whichever socket wrote the
  // global status last.
  const connectionUiState = wsUiStateForEnvironment(
    useWsConnectionStatusForEnvironment(environmentId),
  );

  // Retain the supervisor's thread-detail subscription while mounted, and make
  // this node authoritative for the active task.
  useEffect(() => {
    useStore.getState().setActiveEnvironmentId(environmentId);
    return retainThreadDetailSubscription(environmentId, threadId);
  }, [environmentId, threadId]);

  // Wave 3a: opening a thread is the ONLY thing in the app that re-targets the
  // hosted connection. Not scroll, not inbox rendering, not prefetch — so this
  // call must stay the single caller of the hook. It returns the engine's
  // stated reason when the node cannot become the selection.
  const degradedReason = useThreadConnectionRetarget(environmentId);
  // Cache provenance for this environment. Deliberately NOT `connectionUiState`:
  // a demoted environment's socket slot is reset on dispose and then reads
  // "connecting" forever, which would render cached content as merely slow.
  const hydratedFromCacheAt = useStore((state) =>
    selectEnvironmentHydratedFromCacheAt(state, environmentId),
  );

  const built = useThreadTimeline(environmentId, threadId);
  const thread = useStore((state) =>
    selectThreadByRef(state, scopeThreadRef(environmentId, threadId)),
  );
  const outboxMessages = useSyncExternalStore(
    subscribeThreadOutbox,
    listThreadOutboxMessages,
    listThreadOutboxMessages,
  );
  const queuedMessages = useMemo(
    () =>
      outboxMessages.filter(
        (message) => message.environmentId === environmentId && message.threadId === threadId,
      ),
    [environmentId, outboxMessages, threadId],
  );
  const messageHistory = useStore(
    (state) =>
      state.environmentStateById[environmentId]?.threadHistoryByThreadId?.[threadId]?.messages,
  );
  const messageHistoryLoad = useStore(
    (state) =>
      state.environmentStateById[environmentId]?.threadHistoryLoadByThreadId?.[threadId]?.messages,
  );
  const loadOlderMessages = useCallback(() => {
    if (!messageHistory?.hasMoreBefore || messageHistoryLoad?.status === "loading") return;
    try {
      void loadOlderThreadMessages({
        environmentId,
        threadId,
        page: messageHistory,
      }).catch(() => undefined);
    } catch {
      // Demotion preserves `threadHistoryByThreadId`, so a cached thread still
      // advertises `hasMoreBefore` and the list happily calls this on scroll —
      // but with no client the pagination request throws SYNCHRONOUSLY, before
      // any promise exists for the `.catch` above to intercept. Scrolling a
      // cached thread to the top would crash the screen. There is nothing to
      // report: the banner already says the content is cached.
    }
  }, [environmentId, messageHistory, messageHistoryLoad?.status, threadId]);
  const project = useStore((state) =>
    thread
      ? (selectProjectByRef(state, scopeProjectRef(environmentId, thread.projectId)) ?? null)
      : null,
  );
  const { worktrees } = useHomeWorkspaceData();
  const environments = useHomeEnvironments();
  const pendingApprovals = built?.viewModel.pendingApprovals ?? [];
  const pendingUserInputs = built?.viewModel.pendingUserInputs ?? [];
  // Agent Control proposals share the web runtime state; mobile only syncs
  // while the server-side setting is enabled and renders the same queue.
  const agentControlEnabled = serverConfig?.settings.agentControl.enabled ?? false;
  useAgentControlSync(environmentId, agentControlEnabled);
  const agentControlQueue = useAgentControlStore(
    (state) => state.queueByEnvironmentId[environmentId] ?? null,
  );
  const agentControlProposals = useMemo(
    () =>
      agentControlEnabled && agentControlQueue !== null
        ? selectAgentControlProposalsForThread(agentControlQueue, threadId)
        : [],
    [agentControlEnabled, agentControlQueue, threadId],
  );
  const worktree = useMemo(
    () => (thread ? findThreadWorktree(thread, worktrees) : null),
    [thread, worktrees],
  );
  const environmentRow =
    environments.find((environment) => environment.environmentId === environmentId) ?? null;
  const nodeLabel = environmentRow?.label ?? null;
  const cachedView = useMemo(
    () =>
      deriveThreadCachedView({
        hydratedFromCacheAt,
        degradedReason,
        // Wave 2's presence-sourced phrase, reused verbatim so the same node is
        // not described two ways on two screens.
        staleDetail: environmentRow?.staleDetail ?? null,
        hasMessages: (built?.timeline.length ?? 0) > 0,
      }),
    [built?.timeline.length, degradedReason, environmentRow?.staleDetail, hydratedFromCacheAt],
  );
  const headerModel = useMemo(
    () =>
      thread
        ? buildThreadHeaderModel({
            thread,
            project,
            worktree,
            nodeLabel,
            hasPendingApproval: pendingApprovals.length > 0,
            hasPendingUserInput: pendingUserInputs.length > 0,
            forcedOffline: cachedView.headerForcedOffline,
          })
        : null,
    [
      cachedView.headerForcedOffline,
      nodeLabel,
      pendingApprovals.length,
      pendingUserInputs.length,
      project,
      thread,
      worktree,
    ],
  );

  // The capability gates key off the DRIVER, not the instance id, so resolve the
  // thread's provider instance through the server config first. A null/lagging
  // config (it is scoped to the active environment and nulls on switch) must not
  // hide the rail — the gates keep their upstream defaults, which is the same
  // thing web shows before its config arrives.
  // Memoized: `?? []` would allocate a fresh array every render and defeat both
  // memos below, recomputing the policy model on every keystroke in the composer.
  const providers = useMemo(() => serverConfig?.providers ?? [], [serverConfig]);
  const threadProviderDriver = useMemo(() => {
    const instanceId =
      thread?.modelSelection?.instanceId ?? project?.defaultModelSelection?.instanceId;
    if (!instanceId) return null;
    return providers.find((provider) => provider.instanceId === instanceId)?.driver ?? null;
  }, [project?.defaultModelSelection?.instanceId, providers, thread?.modelSelection?.instanceId]);

  const policyModel = useMemo(
    () =>
      thread
        ? buildSessionPolicyModel({
            runtimeMode: thread.runtimeMode,
            interactionMode: thread.interactionMode,
            interactionModeSupported: threadProviderDriver
              ? getProviderInteractionModeToggle(providers, threadProviderDriver)
              : true,
            askModeSupported: threadProviderDriver
              ? getProviderSupportsAskMode(providers, threadProviderDriver)
              : false,
            mutationBlockedReason: thread.archivedAt !== null ? "This task is archived." : null,
          })
        : null,
    [providers, thread, threadProviderDriver],
  );

  const modelPicker = useMemo(
    () =>
      thread
        ? buildModelPickerModel({
            serverConfig,
            currentSelection: thread.modelSelection ?? project?.defaultModelSelection ?? null,
            // A thread with a live session has committed to a provider; the
            // picker must not offer a way to swap it mid-session.
            providerLocked: thread.session !== null,
            query: modelQuery,
          })
        : null,
    [modelQuery, project?.defaultModelSelection, serverConfig, thread],
  );

  const getSteerEligibility = useCallback(
    (message: QueuedThreadMessage) => {
      const activeSelection = thread?.modelSelection ?? project?.defaultModelSelection;
      const providerInstanceId = thread?.session?.providerInstanceId ?? activeSelection?.instanceId;
      const provider = providers.find((entry) => entry.instanceId === providerInstanceId);
      return resolveQueuedMessageSteerEligibility({
        mutationReady: connectionUiState === "connected",
        turnRunning: thread?.latestTurn?.state === "running",
        activeTurnId: thread?.session?.activeTurnId,
        supportsTurnSteering: provider?.supportsTurnSteering === true,
        queuedModelSelection: message.modelSelection,
        activeModelSelection: activeSelection,
        queuedRuntimeMode: message.runtimeMode,
        activeRuntimeMode: thread?.runtimeMode,
        queuedInteractionMode: message.interactionMode,
        activeInteractionMode: thread?.interactionMode,
        queuedTokenMode: message.tokenMode,
        activeTokenMode: thread?.tokenMode ?? "balanced",
      });
    },
    [connectionUiState, project?.defaultModelSelection, providers, thread],
  );

  const getSteerUnavailableReason = useCallback(
    (message: QueuedThreadMessage): string | null => {
      const eligibility = getSteerEligibility(message);
      return eligibility.allowed ? null : eligibility.reason;
    },
    [getSteerEligibility],
  );

  const steerQueuedMessage = useCallback(
    async (message: QueuedThreadMessage) => {
      const eligibility = getSteerEligibility(message);
      if (!eligibility.allowed) {
        setSendError(eligibility.reason);
        return;
      }
      setSendError(null);
      setSteeringMessageIds((current) => new Set(current).add(message.messageId));
      try {
        const attachments = await buildQueuedThreadMessageAttachments(message);
        const requestedAt = new Date().toISOString();
        await ensureEnvironmentApi(environmentId).orchestration.dispatchCommand(
          buildQueuedMessageSteerCommand({
            commandId: newCommandId(),
            threadId,
            expectedTurnId: eligibility.expectedTurnId,
            messageId: MessageId.make(message.messageId),
            text: message.text.trim() || IMAGE_ONLY_BOOTSTRAP_PROMPT,
            attachments,
            createdAt: message.createdAt,
            requestedAt,
          }),
        );
      } catch (error) {
        setSteeringMessageIds((current) => {
          const next = new Set(current);
          next.delete(message.messageId);
          return next;
        });
        setSendError(error instanceof Error ? error.message : "The steer request failed.");
      }
    },
    [environmentId, getSteerEligibility, threadId],
  );

  useEffect(() => {
    if (!thread || steeringMessageIds.size === 0) return;
    const projectedIds = new Set(thread.messages.map((message) => String(message.id)));
    const rejected = new Map<string, string>();
    for (const activity of thread.activities) {
      if (activity.kind !== "provider.turn.steer.failed" || !activity.payload) continue;
      const payload = activity.payload as { messageId?: unknown; error?: unknown };
      if (typeof payload.messageId === "string") {
        rejected.set(
          payload.messageId,
          typeof payload.error === "string" ? payload.error : "The provider rejected steering.",
        );
      }
    }
    let rejectionMessage: string | null = null;
    for (const messageId of steeringMessageIds) {
      if (projectedIds.has(messageId)) {
        removeThreadOutboxMessage(messageId);
      } else if (rejected.has(messageId)) {
        rejectionMessage = rejected.get(messageId) ?? null;
      }
    }
    setSteeringMessageIds((current) => {
      const next = new Set(current);
      for (const messageId of current) {
        if (projectedIds.has(messageId) || rejected.has(messageId)) next.delete(messageId);
      }
      return next.size === current.size ? current : next;
    });
    if (rejectionMessage) setSendError(rejectionMessage);
  }, [steeringMessageIds, thread]);

  const applyPolicy = useCallback(async (apply: () => Promise<void>) => {
    setPolicyBusy(true);
    setSendError(null);
    try {
      await apply();
    } catch (error) {
      // Never fail silently: a policy change that did not land would otherwise
      // leave the pill showing a setting the node never received.
      setSendError(
        error instanceof Error ? error.message : "The session policy change did not apply.",
      );
    } finally {
      setPolicyBusy(false);
    }
  }, []);

  // One lookup for the open thread only. See useThreadChecks for why the inbox
  // deliberately does not do this.
  const checks = useThreadChecks({
    environmentId,
    cwd: worktree?.worktreePath ?? thread?.worktreePath ?? null,
    prNumber: worktree?.prNumber ?? null,
  });

  const openReview = useCallback(
    () =>
      navigation.navigate("ThreadReview", {
        environmentId,
        threadId,
      }),
    [environmentId, navigation, threadId],
  );

  const openFiles = useCallback(
    () =>
      navigation.navigate("ThreadFiles", {
        environmentId,
        threadId,
      }),
    [environmentId, navigation, threadId],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      title: headerModel?.title ?? "Task",
      headerRight: headerModel
        ? () => (
            <HeaderActions
              model={headerModel}
              iconColor={iconColor}
              onReview={openReview}
              onFiles={openFiles}
              onMore={() => {
                setActionError(null);
                setActionsVisible(true);
              }}
            />
          )
        : undefined,
    });
  }, [headerModel, iconColor, navigation, openFiles, openReview]);

  const onSend = async (
    text: string,
    attachments: ReadonlyArray<DraftComposerImageAttachment>,
  ): Promise<boolean> => {
    setSendError(null);
    const state = useStore.getState();
    const currentThread = selectThreadByRef(state, scopeThreadRef(environmentId, threadId));
    if (!currentThread) {
      setSendError("Thread is not loaded yet.");
      return false;
    }
    const currentProject = selectProjectByRef(
      state,
      scopeProjectRef(environmentId, currentThread.projectId),
    );
    const modelSelection = currentThread.modelSelection ?? currentProject?.defaultModelSelection;
    if (!modelSelection) {
      setSendError("No model is configured for this project.");
      return false;
    }

    const tokenMode = currentThread.tokenMode ?? "balanced";
    const threadBusy = currentThread.latestTurn?.state === "running";
    const connected = connectionUiState === "connected";

    return sendThreadTurn(
      {
        environmentId,
        threadId,
        text,
        attachments,
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
              // The runtime attachment pipeline expects the outgoing data URL,
              // not the image-picker preview file URI.
              images: attachments.map((attachment) => ({
                type: "image",
                id: attachment.id,
                name: attachment.name,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
                previewUrl: attachment.dataUrl,
              })),
              selectedModelSelection: modelSelection,
              selectedModel: modelSelection.model,
              hasSelectedModel: true,
            },
            project: {
              projectId: currentThread.projectId,
              projectCwd: currentProject?.cwd ?? "",
              defaultModel: currentProject?.defaultModelSelection?.model ?? modelSelection.model,
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

  const runAction = async (action: () => Promise<void>, closeAfter = true) => {
    setActionBusy(true);
    setActionError(null);
    try {
      await action();
      if (closeAfter) setActionsVisible(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The task action failed.");
    } finally {
      setActionBusy(false);
    }
  };

  const runningTurnId =
    thread?.latestTurn?.state === "running" ? (thread.latestTurn.turnId ?? null) : null;

  const timelineRows = useMemo(
    () =>
      buildThreadTimelineRows({
        entries: built?.timeline ?? [],
        runningTurnId,
        expandedFoldIds,
        // Running folds deliberately use a stable "Working…" label. Sampling
        // the clock only when the timeline changes avoids rebuilding the whole
        // virtualized list every second for a duration that is not displayed.
        now: new Date().toISOString(),
      }),
    [built?.timeline, expandedFoldIds, runningTurnId],
  );

  const renderItem = ({ item }: LegendListRenderItemProps<ThreadTimelineRow>) =>
    item.kind === "activity-fold" ? (
      <ThreadActivityFoldRow
        fold={item}
        onToggle={() => setExpandedFoldIds((current) => toggleFold(current, item))}
      />
    ) : (
      <TimelineRow entry={item.entry} />
    );
  const visibleError = sendError ?? thread?.error ?? null;
  const hasPrompts =
    pendingApprovals.length > 0 || pendingUserInputs.length > 0 || agentControlProposals.length > 0;

  return (
    <KeyboardAvoidingView
      behavior="padding"
      automaticOffset
      style={{ flex: 1, paddingTop: headerHeight }}
      className="bg-screen"
    >
      {headerModel ? (
        <ThreadContextBar
          model={headerModel}
          checks={checks}
          onPress={() => {
            setActionError(null);
            setActionsVisible(true);
          }}
        />
      ) : null}
      {cachedView.banner ? (
        <ThreadCachedBanner text={cachedView.banner.text} tone={cachedView.banner.tone} />
      ) : null}
      {visibleError ? <ErrorBanner message={visibleError} /> : null}

      <LegendList
        data={timelineRows}
        renderItem={renderItem}
        keyExtractor={(row) => row.id}
        alignItemsAtEnd
        initialScrollAtEnd
        maintainScrollAtEnd={{
          animated: true,
          on: { dataChange: true, itemLayout: true },
        }}
        maintainVisibleContentPosition
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingVertical: 10 }}
        onStartReached={loadOlderMessages}
        onStartReachedThreshold={0.35}
        ListHeaderComponent={
          messageHistory?.hasMoreBefore || messageHistoryLoad?.status === "loading" ? (
            <Pressable
              accessibilityRole="button"
              disabled={messageHistoryLoad?.status === "loading"}
              onPress={loadOlderMessages}
              className="items-center px-4 py-3"
            >
              <Text className="text-xs text-muted-foreground">
                {messageHistoryLoad?.status === "loading"
                  ? "Loading earlier history…"
                  : messageHistoryLoad?.status === "error"
                    ? "Retry earlier history"
                    : "Load earlier history"}
              </Text>
            </Pressable>
          ) : null
        }
        ListEmptyComponent={
          <View className="px-4 py-16">
            <EmptyState
              variant="plain"
              title={built ? (thread?.title ?? "Task") : "Loading task"}
              detail={
                cachedView.emptyStateDetail ??
                (built
                  ? "No messages yet. Send one to get started."
                  : "Syncing the conversation from the node.")
              }
            />
          </View>
        }
      />

      {hasPrompts ? (
        <ScrollView
          className="grow-0 border-t border-border"
          style={{ maxHeight: "42%" }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingVertical: 4 }}
        >
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
          {agentControlProposals.map((proposal) => (
            <AgentControlProposalCard
              key={proposal.proposalId}
              environmentId={environmentId}
              proposal={proposal}
            />
          ))}
        </ScrollView>
      ) : null}

      <ThreadQueuedMessages
        messages={queuedMessages}
        steeringIds={steeringMessageIds}
        getSteerUnavailableReason={getSteerUnavailableReason}
        onSteer={(message) => void steerQueuedMessage(message)}
        onRemove={(messageId) => {
          removeThreadOutboxMessage(messageId);
          setSteeringMessageIds((current) => {
            if (!current.has(messageId)) return current;
            const next = new Set(current);
            next.delete(messageId);
            return next;
          });
        }}
      />

      <ThreadComposer
        onSend={onSend}
        disabled={cachedView.composerDisabled}
        policyLabel={policyModel?.pillLabel}
        policyIcon={policyModel?.pillIcon}
        policyCaution={policyModel?.pillTone === "caution"}
        policyAccessibilityLabel={policyModel?.pillAccessibilityLabel}
        // `policyDisabled` gates both rail pills. The labels stay readable —
        // they are the thread's own configuration — but neither sheet can be
        // opened, because every write behind them goes through
        // ensureEnvironmentApi, which THROWS when the environment has no
        // connection. Disabling the pressables is the fix; catching the throw
        // would only turn a crash into an internal error string.
        policyDisabled={policyBusy || cachedView.actionsDisabled}
        onOpenPolicy={policyModel ? () => setPolicyVisible(true) : undefined}
        modelLabel={modelPicker?.pillLabel}
        modelProviderDriver={modelPicker?.pillProviderDriver}
        modelAccessibilityLabel={modelPicker?.pillAccessibilityLabel}
        modelReasoningLabel={modelPicker?.pillReasoningLabel}
        modelFastEnabled={modelPicker?.pillFastEnabled}
        onOpenModel={modelPicker ? () => setModelVisible(true) : undefined}
      />

      {modelPicker ? (
        <ModelPickerSheet
          visible={modelVisible}
          model={modelPicker}
          query={modelQuery}
          onChangeQuery={setModelQuery}
          onClose={() => {
            setModelVisible(false);
            setModelQuery("");
          }}
          onSelectOption={(optionId, value) => {
            // Options ride on the ModelSelection, so changing reasoning or fast
            // mode is the same write as changing the model itself.
            const current = thread?.modelSelection ?? project?.defaultModelSelection ?? null;
            if (!current) return;
            const capabilities =
              modelPicker.groups.flatMap((group) => group.entries).find((entry) => entry.selected)
                ?.capabilities ?? null;
            const next = applyModelOption(current, capabilities, optionId, value);
            void applyPolicy(() =>
              setThreadModelSelection(ensureEnvironmentApi(environmentId), threadId, next),
            );
          }}
          onSelect={(key) => {
            const next = resolveModelPickerSelection(modelPicker, key);
            if (!next) return;
            setModelVisible(false);
            setModelQuery("");
            void applyPolicy(() =>
              setThreadModelSelection(ensureEnvironmentApi(environmentId), threadId, next),
            );
          }}
        />
      ) : null}

      {policyModel ? (
        <SessionPolicySheet
          visible={policyVisible}
          model={policyModel}
          onClose={() => setPolicyVisible(false)}
          onSelectRuntimeMode={(value) => {
            const next = resolveSessionPolicySelection(policyModel.access, value);
            if (!next) return;
            void applyPolicy(() =>
              setThreadRuntimeMode(ensureEnvironmentApi(environmentId), threadId, next),
            );
          }}
          onSelectInteractionMode={(value) => {
            if (!policyModel.mode) return;
            const next = resolveSessionPolicySelection(policyModel.mode, value);
            if (!next) return;
            void applyPolicy(() =>
              setThreadInteractionMode(ensureEnvironmentApi(environmentId), threadId, next),
            );
          }}
        />
      ) : null}

      {headerModel ? (
        <ThreadActionsSheet
          visible={actionsVisible}
          model={headerModel}
          // Rename / stop / archive all call ensureEnvironmentApi, which throws
          // without a connection, so the sheet's rows are disabled rather than
          // left to surface an internal error. The sheet still opens: node,
          // project and worktree stay readable on a cached thread. `busy` is
          // the existing seam for that; it over-gates "Review changes" by one
          // row, which is acceptable — the review screen needs the same
          // connection this thread does not have.
          busy={actionBusy || cachedView.actionsDisabled}
          error={actionError}
          onClose={() => setActionsVisible(false)}
          onRename={(title) =>
            void runAction(() => renameThread(ensureEnvironmentApi(environmentId), threadId, title))
          }
          onStop={() =>
            void runAction(() => interruptThreadTurn(ensureEnvironmentApi(environmentId), threadId))
          }
          onToggleArchive={() =>
            void runAction(async () => {
              const shouldArchive = thread?.archivedAt === null;
              await setThreadArchived(ensureEnvironmentApi(environmentId), threadId, shouldArchive);
              if (shouldArchive && navigation.canGoBack()) navigation.goBack();
            })
          }
          onReview={() => {
            setActionsVisible(false);
            openReview();
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}
