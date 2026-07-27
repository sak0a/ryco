import { useAtomValue } from "@effect/atom-react";
import { LegendList, type LegendListRenderItemProps } from "@legendapp/list/react-native";
import { useNavigation } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import {
  getWsConnectionStatus,
  getWsConnectionUiState,
  serverConfigAtom,
} from "@ryco/client-runtime/rpc";
import {
  getProviderInteractionModeToggle,
  getProviderSupportsAskMode,
} from "@ryco/client-runtime/state/composer";
import { scopeProjectRef, scopeThreadRef } from "@ryco/client-runtime/scoped";
import type { TimelineEntry } from "@ryco/client-runtime/state/session";
import { EnvironmentId, ThreadId } from "@ryco/contracts";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { ErrorBanner } from "../../components/ErrorBanner";
import { SymbolView } from "../../components/AppSymbol";
import { ensureEnvironmentApi } from "../../connection/environmentApi";
import { retainThreadDetailSubscription } from "../../connection/threadDetail";
import type { DraftComposerImageAttachment } from "../../lib/composerImages";
import { newCommandId, newMessageId } from "../../lib/ids";
import { useThemeColor } from "../../lib/useThemeColor";
import { useHomeWorkspaceData } from "../../state/homeData";
import { enqueueThreadOutboxMessage } from "../../state/threadOutbox";
import { useThreadTimeline } from "../../state/threadTimeline";
import { selectProjectByRef, selectThreadByRef, useStore } from "../../state/threadsRuntime";
import { useHomeEnvironments } from "../home/useHomeEnvironments";
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
import { buildThreadTimelineRows, toggleFold, type ThreadTimelineRow } from "./threadActivityFold";
import { ThreadActivityFoldRow } from "./ThreadActivityFoldRow";
import { buildModelPickerModel, resolveModelPickerSelection } from "./modelPickerModel";
import { ModelPickerSheet } from "./ModelPickerSheet";
import { buildSessionPolicyModel, resolveSessionPolicySelection } from "./sessionPolicyModel";
import { SessionPolicySheet } from "./SessionPolicySheet";
import { ThreadActionsSheet } from "./ThreadActionsSheet";
import { ThreadComposer } from "./ThreadComposer";
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

function HeaderActions(props: {
  readonly model: ThreadHeaderModel;
  readonly iconColor: string;
  readonly onReview: () => void;
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
  const [expandedFoldIds, setExpandedFoldIds] = useState<ReadonlySet<string>>(() => new Set());
  const serverConfig = useAtomValue(serverConfigAtom);

  // Retain the supervisor's thread-detail subscription while mounted, and make
  // this node authoritative for the active task.
  useEffect(() => {
    useStore.getState().setActiveEnvironmentId(environmentId);
    return retainThreadDetailSubscription(environmentId, threadId);
  }, [environmentId, threadId]);

  const built = useThreadTimeline(environmentId, threadId);
  const thread = useStore((state) =>
    selectThreadByRef(state, scopeThreadRef(environmentId, threadId)),
  );
  const project = useStore((state) =>
    thread
      ? (selectProjectByRef(state, scopeProjectRef(environmentId, thread.projectId)) ?? null)
      : null,
  );
  const { worktrees } = useHomeWorkspaceData();
  const environments = useHomeEnvironments();
  const pendingApprovals = built?.viewModel.pendingApprovals ?? [];
  const pendingUserInputs = built?.viewModel.pendingUserInputs ?? [];
  const worktree = useMemo(
    () => (thread ? findThreadWorktree(thread, worktrees) : null),
    [thread, worktrees],
  );
  const nodeLabel =
    environments.find((environment) => environment.environmentId === environmentId)?.label ?? null;
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
          })
        : null,
    [nodeLabel, pendingApprovals.length, pendingUserInputs.length, project, thread, worktree],
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

  const openReview = useCallback(
    () =>
      navigation.navigate("ThreadReview", {
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
              onMore={() => {
                setActionError(null);
                setActionsVisible(true);
              }}
            />
          )
        : undefined,
    });
  }, [headerModel, iconColor, navigation, openReview]);

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
    const connected = getWsConnectionUiState(getWsConnectionStatus()) === "connected";

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

  // The running fold shows a live timer, so it needs a clock that advances. One
  // interval for the whole screen, and only while something is actually running.
  const runningTurnId =
    thread?.latestTurn?.state === "running" ? (thread.latestTurn.turnId ?? null) : null;
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  useEffect(() => {
    if (runningTurnId === null) return;
    const timer = setInterval(() => setNowIso(new Date().toISOString()), 1000);
    return () => clearInterval(timer);
  }, [runningTurnId]);

  const timelineRows = useMemo(
    () =>
      buildThreadTimelineRows({
        entries: built?.timeline ?? [],
        runningTurnId,
        expandedFoldIds,
        now: nowIso,
      }),
    [built?.timeline, expandedFoldIds, nowIso, runningTurnId],
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
  const hasPrompts = pendingApprovals.length > 0 || pendingUserInputs.length > 0;

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
          onPress={() => {
            setActionError(null);
            setActionsVisible(true);
          }}
        />
      ) : null}
      {visibleError ? <ErrorBanner message={visibleError} /> : null}

      <LegendList
        data={timelineRows}
        renderItem={renderItem}
        keyExtractor={(row) => row.id}
        alignItemsAtEnd
        initialScrollAtEnd
        maintainScrollAtEnd={{ animated: true, on: { dataChange: true, itemLayout: true } }}
        maintainVisibleContentPosition
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingVertical: 10 }}
        ListEmptyComponent={
          <View className="px-4 py-16">
            <EmptyState
              variant="plain"
              title={built ? (thread?.title ?? "Task") : "Loading task"}
              detail={
                built
                  ? "No messages yet. Send one to get started."
                  : "Syncing the conversation from the node."
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
        </ScrollView>
      ) : null}

      <ThreadComposer
        onSend={onSend}
        policyLabel={policyModel?.pillLabel}
        policyIcon={policyModel?.pillIcon}
        policyCaution={policyModel?.pillTone === "caution"}
        policyAccessibilityLabel={policyModel?.pillAccessibilityLabel}
        policyDisabled={policyBusy}
        onOpenPolicy={policyModel ? () => setPolicyVisible(true) : undefined}
        modelLabel={modelPicker?.pillLabel}
        modelProviderDriver={modelPicker?.pillProviderDriver}
        modelAccessibilityLabel={modelPicker?.pillAccessibilityLabel}
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
          busy={actionBusy}
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
