import {
  DEFAULT_MODEL,
  defaultInstanceIdForDriver,
  type EnvironmentId,
  type MessageId,
  type ModelSelection,
  type ProjectId,
  ProviderInstanceId,
  type ServerProvider,
  type ScopedThreadRef,
  type ThreadId,
  type TurnId,
  OrchestrationThreadActivity,
  ProviderInteractionMode,
  ProviderDriverKind,
  RuntimeMode,
  AgentTokenMode,
} from "@ryco/contracts";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@ryco/client-runtime";
import { applyClaudePromptEffortPrefix, resolvePromptInjectedEffort } from "@ryco/shared/model";
import { projectScriptCwd } from "@ryco/shared/projectScripts";
import { truncate } from "@ryco/shared/String";
import { Debouncer } from "@tanstack/react-pacer";
import { useQueryClient } from "~/rpc/queryClient";
import { DateTime } from "effect";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import { useGitStatus } from "~/lib/gitStatusState";
import {
  issueDetailQueryOptions,
  changeRequestDetailQueryOptions,
} from "~/lib/sourceControlContextRpc";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { readEnvironmentApi } from "../environmentApi";
import { isElectron } from "../env";
import { isRightPanelOpen, parseRightPanelRouteSearch } from "../rightPanelRouteSearch";
import { deriveThreadSubagents } from "../threadWorkspaceViewModel";
import { parseStandaloneComposerSlashCommand } from "../composer-logic";
import {
  deriveCompletionDividerBeforeEntryId,
  derivePhase,
  deriveTimelineEntries,
  deriveActiveWorkStartedAt,
  deriveThreadActivityViewModel,
  findSidebarProposedPlan,
  findLatestProposedPlan,
  hasActionableProposedPlan,
  isLatestTurnSettled,
  formatElapsed,
} from "../session-logic";
import { type LegendListRef } from "@legendapp/list/react";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsForProjectRef,
  selectThreadsAcrossEnvironments,
  useStore,
} from "../store";
import { createProjectSelectorByRef, createThreadSelectorByRef } from "../storeSelectors";
import { useUiStateStore } from "../uiStateStore";
import { useSettingsDialogStore } from "../settingsDialogStore";
import {
  buildPlanImplementationThreadTitle,
  buildPlanImplementationPrompt,
  resolvePlanFollowUpSubmission,
} from "../proposedPlan";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_AGENT_TOKEN_MODE,
  DEFAULT_RUNTIME_MODE,
  MAX_TERMINALS_PER_GROUP,
  type ChatMessage,
  type TurnDiffSummary,
} from "../types";
import { useTheme } from "../hooks/useTheme";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { PREFERS_REDUCED_MOTION_QUERY } from "../lib/perf/motion";
import { useDelayedUnmount } from "../hooks/useDelayedUnmount";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import { BranchToolbar } from "./BranchToolbar";
import {
  matchesExactModShortcut,
  shouldIgnoreGlobalNavigationShortcut,
  shortcutLabelForCommand,
} from "../keybindings";
import { ChevronDownIcon, TriangleAlertIcon, WifiOffIcon } from "lucide-react";
import { cn, randomUUID } from "~/lib/utils";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { newCommandId, newDraftId, newMessageId, newThreadId } from "~/lib/utils";
import { getProviderModelCapabilities, resolveSelectableProvider } from "../providerModels";
import { useSettings } from "../hooks/useSettings";
import { resolveAppModelSelectionForInstance } from "../modelSelection";
import { deriveLogicalProjectKeyFromSettings } from "../logicalProject";
import {
  reconnectSavedEnvironment,
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
} from "../environments/runtime";
import { buildDraftThreadRouteParams } from "../threadRoutes";
import {
  type ComposerImageAttachment,
  type DraftThreadEnvMode,
  useComposerDraftStore,
  type DraftId,
} from "../composerDraftStore";
import { type TerminalContextDraft, type TerminalContextSelection } from "../lib/terminalContext";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { ChatComposer, type ChatComposerHandle } from "./chat/ChatComposer";
import { PersistentThreadTerminalDrawer } from "./chat/ChatTerminalShell";
import { ExpandedImageDialog } from "./chat/ExpandedImageDialog";
import { PullRequestThreadDialog } from "./PullRequestThreadDialog";
import { NewWorktreeDialog, type NewWorktreeDialogTab } from "./worktrees/NewWorktreeDialog";
import {
  LinkedWorktreeItemDialog,
  type LinkedWorktreeItem,
} from "./worktrees/LinkedWorktreeItemDialog";
import { MessagesTimeline } from "./chat/MessagesTimeline";
import { deriveRevertTurnCountByUserMessageId } from "./chat/MessagesTimeline.logic";
import { ChatHeader } from "./chat/ChatHeader";
import { type ChatSessionTabsItem } from "./chat/ChatSessionTabs";
import { useChatSessionTabsPrefetch } from "./chat/useChatSessionTabsPrefetch";
import { createSessionTabsSelector, draftThreadToSidebarSummary } from "../sessionTabs.selectors";
import type { SidebarThreadSummary } from "../types";
import { markTabSwitchClick, usePerfMark } from "../perf/tabSwitchInstrumentation";
import { type ExpandedImagePreview } from "./chat/ExpandedImagePreview";
import { NoActiveThreadState } from "./NoActiveThreadState";
import { resolveEffectiveEnvMode, resolveEnvironmentOptionLabel } from "./BranchToolbar.logic";
import { ProviderStatusBanner } from "./chat/ProviderStatusBanner";
import { ThreadErrorBanner } from "./chat/ThreadErrorBanner";
import { ComposerBannerStack, type ComposerBannerStackItem } from "./chat/ComposerBannerStack";
import { ComposerHintRow } from "./chat/ComposerHintRow";
import type { HintRowTrigger } from "./chat/ComposerHintRow.logic";
import { useSourceControlDiscovery } from "~/lib/sourceControlDiscoveryState";
import { useAtlassianProjectLink } from "~/rpc/useAtlassian";
import { fetchWorkItemDetail } from "~/rpc/useWorkItems";
import { parseContextAttachmentLinkedItem } from "~/lib/chatContextAttachments";
import type { ChatContextAttachment } from "../types";
import {
  ChatOverviewPanel,
  FloatingOverviewMotionFrame,
  OverviewSidebarMotionFrame,
  OVERVIEW_FLOATING_EXIT_DURATION_MS,
  OVERVIEW_SIDEBAR_EXIT_DURATION_MS,
  usePostPushWorkflowWatch,
  useOverviewPanelControls,
} from "./chat/ChatOverviewPanel";
import { useChatGlobalShortcuts } from "./chat/useChatGlobalShortcuts";
import { useChatPendingUserInput } from "./chat/useChatPendingUserInput";
import { useChatWorkspacePanels } from "./chat/useChatWorkspacePanels";
import { useThreadPlanCatalog } from "./chat/useThreadPlanCatalog";
import { useLocalDispatchState } from "./chat/useLocalDispatchState";
import { useChatProjectScripts } from "./chat/useChatProjectScripts";
import { useChatAttachmentPreviewHandoff } from "./chat/useChatAttachmentPreviewHandoff";
import { useChatSessionActions } from "../hooks/useChatSessionActions";
import { executeChatSendTurn } from "../hooks/executeChatSendTurn";
import {
  MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  buildExpiredTerminalContextToastCopy,
  buildLocalDraftThread,
  collectUserMessageBlobPreviewUrls,
  deriveComposerSendState,
  LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
  LastInvokedScriptByProjectSchema,
  PullRequestDialogState,
  deriveLockedProvider,
  reconcileMountedTerminalThreadIds,
  resolveSendEnvMode,
  resolveChatSendWorktreePlan,
  revokeUserMessagePreviewUrls,
  shouldWriteThreadErrorToCurrentServerThread,
  waitForStartedServerThread,
} from "./ChatView.logic";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useComposerHandleContext } from "../composerHandleContext";
import {
  useServerAvailableEditors,
  useServerConfig,
  useServerKeybindings,
} from "~/rpc/serverState";
import { sanitizeThreadErrorMessage } from "~/rpc/transportError";
import { retainThreadDetailSubscription } from "../environments/runtime/service";
import { RightPanelSheet } from "./RightPanelSheet";
import { Button } from "./ui/button";
import {
  buildVersionMismatchDismissalKey,
  dismissVersionMismatch,
  isVersionMismatchDismissed,
  resolveServerConfigVersionMismatch,
} from "../versionSkew";

const EMPTY_ACTIVITIES: OrchestrationThreadActivity[] = [];
const EMPTY_PROVIDERS: ServerProvider[] = [];
const EMPTY_PROVIDER_SKILLS: ServerProvider["skills"] = [];
const EMPTY_SESSION_TABS: ReadonlyArray<ChatSessionTabsItem> = Object.freeze([]);
const PROVIDER_STATUS_KEY_SEPARATOR = "\0";

function providerStatusesContentKey(providers: ReadonlyArray<ServerProvider>): string {
  const parts: string[] = [`${providers.length}`];
  for (const provider of providers) {
    parts.push(
      provider.instanceId,
      provider.driver,
      provider.displayName ?? "",
      provider.accentColor ?? "",
      provider.badgeLabel ?? "",
      provider.continuation?.groupKey ?? "",
      provider.showInteractionModeToggle ? "1" : "0",
      provider.enabled ? "1" : "0",
      provider.status,
      provider.installed ? "1" : "0",
      provider.availability ?? "",
      provider.unavailableReason ?? "",
      provider.auth.status,
      provider.auth.type ?? "",
      provider.auth.label ?? "",
      provider.auth.email ?? "",
      provider.message ?? "",
    );
    for (const model of provider.models) {
      parts.push(
        "model",
        model.slug,
        model.name,
        model.shortName ?? "",
        model.subProvider ?? "",
        model.isCustom ? "1" : "0",
        JSON.stringify(model.capabilities) ?? "",
      );
    }
    for (const command of provider.slashCommands) {
      parts.push("command", command.name, command.description ?? "", command.input?.hint ?? "");
    }
    for (const skill of provider.skills) {
      parts.push(
        "skill",
        skill.name,
        skill.path,
        skill.enabled ? "1" : "0",
        skill.scope ?? "",
        skill.displayName ?? "",
        skill.shortDescription ?? "",
        skill.description ?? "",
      );
    }
  }
  return parts.join(PROVIDER_STATUS_KEY_SEPARATOR);
}

function stabilizeProviderStatusesSnapshot(
  providers: ReadonlyArray<ServerProvider>,
  cache: { key: string; snapshot: ServerProvider[] },
): ServerProvider[] {
  const key = providerStatusesContentKey(providers);
  if (key === cache.key) {
    return cache.snapshot;
  }
  const snapshot = providers as ServerProvider[];
  cache.key = key;
  cache.snapshot = snapshot;
  return snapshot;
}

type EnvironmentUnavailableState = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connectionState: "connecting" | "disconnected" | "error";
};

function formatOutgoingPrompt(params: {
  provider: ProviderDriverKind;
  model: string | null;
  models: ReadonlyArray<ServerProvider["models"][number]>;
  effort: string | null;
  text: string;
}): string {
  const caps = getProviderModelCapabilities(params.models, params.model, params.provider);
  const promptEffort = resolvePromptInjectedEffort(caps, params.effort);
  return applyClaudePromptEffortPrefix(params.text, promptEffort);
}

type ChatViewProps =
  | {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      onDiffPanelOpen?: () => void;
      onPreviewPanelOpen?: () => void;
      onTerminalPanelOpen?: () => void;
      onAgentPanelOpen?: () => void;
      workspacePanelOpen?: boolean;
      onToggleWorkspacePanel?: () => void;
      reserveTitleBarControlInset?: boolean;
      routeKind: "server";
      draftId?: never;
    }
  | {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      onDiffPanelOpen?: () => void;
      onPreviewPanelOpen?: () => void;
      onTerminalPanelOpen?: () => void;
      onAgentPanelOpen?: () => void;
      workspacePanelOpen?: boolean;
      onToggleWorkspacePanel?: () => void;
      reserveTitleBarControlInset?: boolean;
      routeKind: "draft";
      draftId: DraftId;
    };

interface TerminalLaunchContext {
  threadId: ThreadId;
  cwd: string;
  worktreePath: string | null;
}

export default function ChatView(props: ChatViewProps) {
  usePerfMark("ChatView");
  const {
    environmentId,
    threadId,
    routeKind,
    onDiffPanelOpen,
    onPreviewPanelOpen,
    onTerminalPanelOpen,
    onAgentPanelOpen,
    onToggleWorkspacePanel: externalToggleWorkspacePanel,
    reserveTitleBarControlInset = true,
  } = props;
  const draftId = routeKind === "draft" ? props.draftId : null;
  const routeThreadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const routeThreadKey = useMemo(() => scopedThreadKey(routeThreadRef), [routeThreadRef]);
  const composerDraftTarget: ScopedThreadRef | DraftId =
    routeKind === "server" ? routeThreadRef : props.draftId;
  const serverThread = useStore(
    useMemo(
      () => createThreadSelectorByRef(routeKind === "server" ? routeThreadRef : null),
      [routeKind, routeThreadRef],
    ),
  );
  const setStoreThreadError = useStore((store) => store.setError);
  const markThreadVisited = useUiStateStore((store) => store.markThreadVisited);
  const activeThreadLastVisitedAt = useUiStateStore((store) =>
    routeKind === "server" ? store.threadLastVisitedAtById[routeThreadKey] : undefined,
  );
  const settings = useSettings();
  const setStickyComposerModelSelection = useComposerDraftStore(
    (store) => store.setStickyModelSelection,
  );
  const timestampFormat = settings.timestampFormat;
  const autoOpenPlanSidebar = settings.autoOpenPlanSidebar;
  const navigate = useNavigate();
  const openSettings = useSettingsDialogStore((s) => s.openSettings);
  const rawSearch = useSearch({
    strict: false,
    select: (params) => parseRightPanelRouteSearch(params),
  });
  const { resolvedTheme } = useTheme();
  // Granular store selectors — avoid subscribing to prompt changes.
  const composerRuntimeMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.runtimeMode ?? null,
  );
  const composerInteractionMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.interactionMode ?? null,
  );
  const composerTokenMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.tokenMode ?? null,
  );
  const composerActiveProvider = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.activeProvider ?? null,
  );
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
  const setComposerDraftTerminalContexts = useComposerDraftStore(
    (store) => store.setTerminalContexts,
  );
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setComposerDraftRuntimeMode = useComposerDraftStore((store) => store.setRuntimeMode);
  const setComposerDraftInteractionMode = useComposerDraftStore(
    (store) => store.setInteractionMode,
  );
  const setComposerDraftTokenMode = useComposerDraftStore((store) => store.setTokenMode);
  const clearComposerDraftContent = useComposerDraftStore((store) => store.clearComposerContent);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const getDraftSessionByLogicalProjectKey = useComposerDraftStore(
    (store) => store.getDraftSessionByLogicalProjectKey,
  );
  const getDraftSession = useComposerDraftStore((store) => store.getDraftSession);
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const draftThread = useComposerDraftStore((store) =>
    routeKind === "server"
      ? store.getDraftSessionByRef(routeThreadRef)
      : draftId
        ? store.getDraftSession(draftId)
        : null,
  );
  const promptRef = useRef("");
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>([]);
  const localComposerRef = useRef<ChatComposerHandle | null>(null);
  const composerRef = useComposerHandleContext() ?? localComposerRef;
  const readComposer = useCallback(() => composerRef.current, [composerRef]);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<ChatMessage[]>([]);
  const optimisticUserMessagesRef = useRef(optimisticUserMessages);
  optimisticUserMessagesRef.current = optimisticUserMessages;
  const [localDraftErrorsByDraftId, setLocalDraftErrorsByDraftId] = useState<
    Record<string, string | null>
  >({});
  const [isConnecting, _setIsConnecting] = useState(false);
  const [planSidebarOpen, setPlanSidebarOpen] = useState(true);
  const [overviewFloatingOpen, setOverviewFloatingOpen] = useState(false);
  const shouldUsePlanSidebarSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const prefersReducedMotion = useMediaQuery(PREFERS_REDUCED_MOTION_QUERY);
  // Tracks whether the user explicitly dismissed the sidebar for the active turn.
  const planSidebarDismissedForTurnRef = useRef<string | null>(null);
  // When set, the thread-change reset effect will open the sidebar instead of closing it.
  // Used by "Implement in a new thread" to carry the sidebar-open intent across navigation.
  const planSidebarOpenOnNextThreadRef = useRef(false);
  const [terminalFocusRequestId, setTerminalFocusRequestId] = useState(0);
  const [pullRequestDialogState, setPullRequestDialogState] =
    useState<PullRequestDialogState | null>(null);
  const [projectExplorerOpen, setProjectExplorerOpen] = useState(false);
  const projectExplorerOpenRef = useRef(projectExplorerOpen);
  projectExplorerOpenRef.current = projectExplorerOpen;
  const [projectExplorerInitialTab, setProjectExplorerInitialTab] =
    useState<NewWorktreeDialogTab>("prs");
  const [terminalLaunchContext, setTerminalLaunchContext] = useState<TerminalLaunchContext | null>(
    null,
  );
  const [pendingServerThreadBranch, setPendingServerThreadBranch] = useState<string | null>();
  const [lastInvokedScriptByProjectId, setLastInvokedScriptByProjectId] = useLocalStorage(
    LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
    {},
    LastInvokedScriptByProjectSchema,
  );
  const legendListRef = useRef<LegendListRef | null>(null);
  const isAtEndRef = useRef(true);
  const sendInFlightRef = useRef(false);
  const terminalOpenByThreadRef = useRef<Record<string, boolean>>({});

  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadKey, routeThreadRef),
  );
  const openTerminalThreadKeys = useTerminalStateStore(
    useShallow((state) =>
      Object.entries(state.terminalStateByThreadKey).flatMap(([nextThreadKey, nextTerminalState]) =>
        nextTerminalState.terminalOpen ? [nextThreadKey] : [],
      ),
    ),
  );
  const storeSetTerminalOpen = useTerminalStateStore((s) => s.setTerminalOpen);
  const storeSplitTerminal = useTerminalStateStore((s) => s.splitTerminal);
  const storeNewTerminal = useTerminalStateStore((s) => s.newTerminal);
  const storeSetActiveTerminal = useTerminalStateStore((s) => s.setActiveTerminal);
  const storeCloseTerminal = useTerminalStateStore((s) => s.closeTerminal);
  const serverThreadKeys = useStore(
    useShallow((state) =>
      selectThreadsAcrossEnvironments(state).map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    ),
  );
  const storeServerTerminalLaunchContext = useTerminalStateStore(
    (s) => s.terminalLaunchContextByThreadKey[scopedThreadKey(routeThreadRef)] ?? null,
  );
  const storeClearTerminalLaunchContext = useTerminalStateStore(
    (s) => s.clearTerminalLaunchContext,
  );
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftThreadKeys = useMemo(
    () =>
      Object.values(draftThreadsByThreadKey).map((draftThread) =>
        scopedThreadKey(scopeThreadRef(draftThread.environmentId, draftThread.threadId)),
      ),
    [draftThreadsByThreadKey],
  );
  const [mountedTerminalThreadKeys, setMountedTerminalThreadKeys] = useState<string[]>([]);
  const mountedTerminalThreadRefs = useMemo(
    () =>
      mountedTerminalThreadKeys.flatMap((mountedThreadKey) => {
        const mountedThreadRef = parseScopedThreadKey(mountedThreadKey);
        return mountedThreadRef ? [{ key: mountedThreadKey, threadRef: mountedThreadRef }] : [];
      }),
    [mountedTerminalThreadKeys],
  );

  const fallbackDraftProjectRef = draftThread
    ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
    : null;
  const fallbackDraftProject = useStore(
    useMemo(() => createProjectSelectorByRef(fallbackDraftProjectRef), [fallbackDraftProjectRef]),
  );
  const localDraftError =
    routeKind === "server" && serverThread
      ? null
      : ((draftId ? localDraftErrorsByDraftId[draftId] : null) ?? null);
  const localDraftThread = useMemo(
    () =>
      draftThread
        ? buildLocalDraftThread(
            threadId,
            draftThread,
            fallbackDraftProject?.defaultModelSelection ?? {
              instanceId: ProviderInstanceId.make("codex"),
              model: DEFAULT_MODEL,
            },
            localDraftError,
          )
        : undefined,
    [draftThread, fallbackDraftProject?.defaultModelSelection, localDraftError, threadId],
  );
  const isServerThread = routeKind === "server" && serverThread !== undefined;
  const activeThread = isServerThread ? serverThread : localDraftThread;
  // Defers heavy MessagesTimeline render to a transition. When threadId
  // changes, the urgent render paints with the placeholder branch (see
  // the JSX gate below); React then re-renders in a transition where
  // the deferred id catches up and the real timeline mounts.
  const activeThreadIdRaw = activeThread?.id ?? null;
  const deferredActiveThreadId = useDeferredValue(activeThreadIdRaw);
  const isActiveThreadIdFresh = deferredActiveThreadId === activeThreadIdRaw;
  const runtimeMode = composerRuntimeMode ?? activeThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  const interactionMode =
    composerInteractionMode ?? activeThread?.interactionMode ?? DEFAULT_INTERACTION_MODE;
  const tokenMode =
    composerTokenMode ??
    activeThread?.tokenMode ??
    settings.defaultAgentTokenMode ??
    DEFAULT_AGENT_TOKEN_MODE;
  const isLocalDraftThread = !isServerThread && localDraftThread !== undefined;
  const canCheckoutPullRequestIntoThread = isLocalDraftThread;
  const diffOpen = rawSearch.diff === "1";
  const workspacePanelOpen = props.workspacePanelOpen ?? isRightPanelOpen(rawSearch);
  const activeThreadId = activeThread?.id ?? null;
  const setThreadError = useCallback(
    (targetThreadId: ThreadId | null, error: string | null) => {
      if (!targetThreadId) return;
      const nextError = sanitizeThreadErrorMessage(error);
      const isCurrentServerThread = shouldWriteThreadErrorToCurrentServerThread({
        serverThread,
        routeThreadRef,
        targetThreadId,
      });
      if (isCurrentServerThread) {
        setStoreThreadError(targetThreadId, nextError);
        return;
      }
      const localDraftErrorKey = draftId ?? targetThreadId;
      setLocalDraftErrorsByDraftId((existing) => {
        if ((existing[localDraftErrorKey] ?? null) === nextError) {
          return existing;
        }
        return {
          ...existing,
          [localDraftErrorKey]: nextError,
        };
      });
    },
    [draftId, routeThreadRef, serverThread, setStoreThreadError],
  );
  const {
    interruptTurn: onInterrupt,
    respondToApproval: onRespondToApproval,
    respondToUserInput: onRespondToUserInput,
    revertToTurnCount,
    respondingRequestIds,
    respondingUserInputRequestIds,
    isRevertingCheckpoint,
  } = useChatSessionActions({
    environmentId,
    activeThreadId,
    setThreadError,
  });
  const activeThreadRef = useMemo(
    () => (activeThread ? scopeThreadRef(activeThread.environmentId, activeThread.id) : null),
    [activeThread],
  );
  const activeThreadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
  const existingOpenTerminalThreadKeys = useMemo(() => {
    const existingThreadKeys = new Set<string>([...serverThreadKeys, ...draftThreadKeys]);
    return openTerminalThreadKeys.filter((nextThreadKey) => existingThreadKeys.has(nextThreadKey));
  }, [draftThreadKeys, openTerminalThreadKeys, serverThreadKeys]);
  const activeLatestTurn = activeThread?.latestTurn ?? null;
  const threadPlanCatalog = useThreadPlanCatalog(
    useMemo(() => {
      const threadIds: ThreadId[] = [];
      if (activeThread?.id) {
        threadIds.push(activeThread.id);
      }
      const sourceThreadId = activeLatestTurn?.sourceProposedPlan?.threadId;
      if (sourceThreadId && sourceThreadId !== activeThread?.id) {
        threadIds.push(sourceThreadId);
      }
      return threadIds;
    }, [activeLatestTurn?.sourceProposedPlan?.threadId, activeThread?.id]),
  );
  useEffect(() => {
    setMountedTerminalThreadKeys((currentThreadIds) => {
      const nextThreadIds = reconcileMountedTerminalThreadIds({
        currentThreadIds,
        openThreadIds: existingOpenTerminalThreadKeys,
        activeThreadId: activeThreadKey,
        activeThreadTerminalOpen: Boolean(activeThreadKey && terminalState.terminalOpen),
        maxHiddenThreadCount: MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
      });
      return currentThreadIds.length === nextThreadIds.length &&
        currentThreadIds.every((nextThreadId, index) => nextThreadId === nextThreadIds[index])
        ? currentThreadIds
        : nextThreadIds;
    });
  }, [activeThreadKey, existingOpenTerminalThreadKeys, terminalState.terminalOpen]);
  const latestTurnSettled = isLatestTurnSettled(activeLatestTurn, activeThread?.session ?? null);
  const activeProjectRef = activeThread
    ? scopeProjectRef(activeThread.environmentId, activeThread.projectId)
    : null;
  const activeProject = useStore(
    useMemo(() => createProjectSelectorByRef(activeProjectRef), [activeProjectRef]),
  );

  const activeWorktreeSummary = useStore(
    useMemo(
      () => (state: Parameters<typeof selectSidebarThreadsForProjectRef>[0]) => {
        if (!activeThread || !activeThread.environmentId) return null;
        const wid = activeThread.worktreeId;
        if (!wid) return null;
        const env = state.environmentStateById[activeThread.environmentId];
        if (!env?.worktreeById) return null;
        return (
          (
            env.worktreeById as Record<
              string,
              (typeof env.worktreeById)[keyof typeof env.worktreeById]
            >
          )[wid] ?? null
        );
      },
      // Re-create the selector only when the identity inputs change.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [activeThread?.environmentId, activeThread?.worktreeId],
    ),
  );
  const [headerLinkedItem, setHeaderLinkedItem] = useState<LinkedWorktreeItem | null>(null);
  const handleOpenHeaderLinkedItem = useCallback((item: LinkedWorktreeItem) => {
    setHeaderLinkedItem(item);
  }, []);
  const handleHeaderLinkedItemDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setHeaderLinkedItem(null);
    }
  }, []);
  const sessionTabsSelector = useMemo(() => createSessionTabsSelector(), []);
  const tabsWorktreeId = activeThread?.worktreeId;
  const tabsWorktreePath = activeThread?.worktreePath;
  const draftThreadSummariesForProject = useMemo<SidebarThreadSummary[]>(() => {
    if (!activeProjectRef) return [];
    const drafts: SidebarThreadSummary[] = [];
    for (const draft of Object.values(draftThreadsByThreadKey)) {
      if (draft.promotedTo != null) continue;
      if (draft.environmentId !== activeProjectRef.environmentId) continue;
      if (draft.projectId !== activeProjectRef.projectId) continue;
      drafts.push(draftThreadToSidebarSummary(draft));
    }
    return drafts;
  }, [draftThreadsByThreadKey, activeProjectRef]);
  const activeWorktreeSessionTabs = useStore((state) => {
    if (!activeProjectRef || !activeThread) return EMPTY_SESSION_TABS;
    const serverThreads = selectSidebarThreadsForProjectRef(state, activeProjectRef);
    const allThreads =
      draftThreadSummariesForProject.length > 0
        ? [...serverThreads, ...draftThreadSummariesForProject]
        : serverThreads;
    return sessionTabsSelector(allThreads, {
      worktreeId: tabsWorktreeId ?? null,
      worktreePath: tabsWorktreePath ?? null,
    });
  });
  const activeSessionTabKey = activeThread
    ? scopedThreadKey(scopeThreadRef(activeThread.environmentId, activeThread.id))
    : null;
  const handleSelectSessionTab = useCallback(
    (key: string) => {
      const target = parseScopedThreadKey(key);
      if (!target) return;
      markTabSwitchClick(key);
      // Defer navigate to the next macrotask so React can commit the
      // optimistic pendingKey paint in ChatSessionTabs before the heavy
      // route-driven re-render kicks in. Wrapping in startTransition
      // composed badly with tanstack-router's internal Transitioner.
      setTimeout(() => {
        void navigate({
          to: "/$environmentId/$threadId",
          params: {
            environmentId: target.environmentId,
            threadId: target.threadId,
          },
        });
      }, 0);
    },
    [navigate],
  );

  const { handleTabPrefetchEnter, handleTabPrefetchLeave } = useChatSessionTabsPrefetch({
    activeWorktreeSessionTabs,
    activeSessionTabKey,
  });

  useEffect(() => {
    if (routeKind !== "server") {
      return;
    }
    return retainThreadDetailSubscription(environmentId, threadId);
  }, [environmentId, routeKind, threadId]);

  // Compute the list of environments this logical project spans, used to
  // drive the environment picker in BranchToolbar.
  const allProjects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const savedEnvironmentRegistry = useSavedEnvironmentRegistryStore((s) => s.byId);
  const savedEnvironmentRuntimeById = useSavedEnvironmentRuntimeStore((s) => s.byId);
  const activeSavedEnvironmentRecord =
    activeThread && activeThread.environmentId !== primaryEnvironmentId
      ? (savedEnvironmentRegistry[activeThread.environmentId] ?? null)
      : null;
  const activeSavedEnvironmentRuntime = activeSavedEnvironmentRecord
    ? (savedEnvironmentRuntimeById[activeSavedEnvironmentRecord.environmentId] ?? null)
    : null;
  const activeSavedEnvironmentConnectionState = activeSavedEnvironmentRecord
    ? (activeSavedEnvironmentRuntime?.connectionState ?? "disconnected")
    : "connected";
  const activeEnvironmentUnavailable =
    activeSavedEnvironmentRecord !== null && activeSavedEnvironmentConnectionState !== "connected";
  const activeSavedEnvironmentId = activeSavedEnvironmentRecord?.environmentId ?? null;
  const activeEnvironmentUnavailableLabel = activeSavedEnvironmentRecord
    ? resolveEnvironmentOptionLabel({
        isPrimary: false,
        environmentId: activeSavedEnvironmentRecord.environmentId,
        runtimeLabel: activeSavedEnvironmentRuntime?.descriptor?.label ?? null,
        savedLabel: activeSavedEnvironmentRecord.label,
      })
    : null;
  const activeEnvironmentUnavailableState = useMemo<EnvironmentUnavailableState | null>(() => {
    if (
      !activeEnvironmentUnavailable ||
      !activeEnvironmentUnavailableLabel ||
      !activeSavedEnvironmentId
    ) {
      return null;
    }

    return {
      environmentId: activeSavedEnvironmentId,
      label: activeEnvironmentUnavailableLabel,
      connectionState:
        activeSavedEnvironmentConnectionState === "connecting" ||
        activeSavedEnvironmentConnectionState === "error"
          ? activeSavedEnvironmentConnectionState
          : "disconnected",
    };
  }, [
    activeEnvironmentUnavailable,
    activeEnvironmentUnavailableLabel,
    activeSavedEnvironmentConnectionState,
    activeSavedEnvironmentId,
  ]);
  const [reconnectingEnvironmentId, setReconnectingEnvironmentId] = useState<EnvironmentId | null>(
    null,
  );
  const handleReconnectActiveEnvironment = useCallback(
    async (environmentId: EnvironmentId, label: string) => {
      setReconnectingEnvironmentId(environmentId);
      try {
        await reconnectSavedEnvironment(environmentId);
        toastManager.add({
          type: "success",
          title: "Environment reconnected",
          description: `${label} is ready.`,
        });
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not reconnect environment",
            description: error instanceof Error ? error.message : "Failed to reconnect.",
          }),
        );
      } finally {
        setReconnectingEnvironmentId(null);
      }
    },
    [],
  );
  const projectGroupingSettings = useSettings((settings) => ({
    sidebarProjectGroupingMode: settings.sidebarProjectGroupingMode,
    sidebarProjectGroupingOverrides: settings.sidebarProjectGroupingOverrides,
  }));
  const logicalProjectEnvironments = useMemo(() => {
    if (!activeProject) return [];
    const logicalKey = deriveLogicalProjectKeyFromSettings(activeProject, projectGroupingSettings);
    const memberProjects = allProjects.filter(
      (p) => deriveLogicalProjectKeyFromSettings(p, projectGroupingSettings) === logicalKey,
    );
    const seen = new Set<string>();
    const envs: Array<{
      environmentId: EnvironmentId;
      projectId: ProjectId;
      label: string;
      isPrimary: boolean;
    }> = [];
    for (const p of memberProjects) {
      if (seen.has(p.environmentId)) continue;
      seen.add(p.environmentId);
      const isPrimary = p.environmentId === primaryEnvironmentId;
      const savedRecord = savedEnvironmentRegistry[p.environmentId];
      const runtimeState = savedEnvironmentRuntimeById[p.environmentId];
      const label = resolveEnvironmentOptionLabel({
        isPrimary,
        environmentId: p.environmentId,
        runtimeLabel: runtimeState?.descriptor?.label ?? null,
        savedLabel: savedRecord?.label ?? null,
      });
      envs.push({
        environmentId: p.environmentId,
        projectId: p.id,
        label,
        isPrimary,
      });
    }
    // Sort: primary first, then alphabetical
    envs.sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    return envs;
  }, [
    activeProject,
    allProjects,
    projectGroupingSettings,
    primaryEnvironmentId,
    savedEnvironmentRegistry,
    savedEnvironmentRuntimeById,
  ]);
  const hasMultipleEnvironments = logicalProjectEnvironments.length > 1;

  const openPullRequestDialog = useCallback(
    (reference?: string) => {
      if (!canCheckoutPullRequestIntoThread) {
        return;
      }
      setPullRequestDialogState({
        initialReference: reference ?? null,
        key: Date.now(),
      });
    },
    [canCheckoutPullRequestIntoThread],
  );

  const closePullRequestDialog = useCallback(() => {
    setPullRequestDialogState(null);
  }, []);

  const openOrReuseProjectDraftThread = useCallback(
    async (input: { branch: string; worktreePath: string | null; envMode: DraftThreadEnvMode }) => {
      if (!activeProject) {
        throw new Error("No active project is available for this pull request.");
      }
      const activeProjectRef = scopeProjectRef(activeProject.environmentId, activeProject.id);
      const logicalProjectKey = deriveLogicalProjectKeyFromSettings(
        activeProject,
        projectGroupingSettings,
      );
      const storedDraftSession = getDraftSessionByLogicalProjectKey(logicalProjectKey);
      if (storedDraftSession) {
        setDraftThreadContext(storedDraftSession.draftId, input);
        setLogicalProjectDraftThreadId(
          logicalProjectKey,
          activeProjectRef,
          storedDraftSession.draftId,
          {
            threadId: storedDraftSession.threadId,
            ...input,
          },
        );
        if (routeKind !== "draft" || draftId !== storedDraftSession.draftId) {
          await navigate({
            to: "/draft/$draftId",
            params: buildDraftThreadRouteParams(storedDraftSession.draftId),
          });
        }
        return storedDraftSession.threadId;
      }

      const activeDraftSession = routeKind === "draft" && draftId ? getDraftSession(draftId) : null;
      if (
        !isServerThread &&
        activeDraftSession?.logicalProjectKey === logicalProjectKey &&
        draftId
      ) {
        setDraftThreadContext(draftId, input);
        setLogicalProjectDraftThreadId(logicalProjectKey, activeProjectRef, draftId, {
          threadId: activeDraftSession.threadId,
          createdAt: activeDraftSession.createdAt,
          runtimeMode: activeDraftSession.runtimeMode,
          interactionMode: activeDraftSession.interactionMode,
          tokenMode: activeDraftSession.tokenMode ?? DEFAULT_AGENT_TOKEN_MODE,
          ...input,
        });
        return activeDraftSession.threadId;
      }

      const nextDraftId = newDraftId();
      const nextThreadId = newThreadId();
      setLogicalProjectDraftThreadId(logicalProjectKey, activeProjectRef, nextDraftId, {
        threadId: nextThreadId,
        createdAt: new Date().toISOString(),
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        tokenMode: settings.defaultAgentTokenMode ?? DEFAULT_AGENT_TOKEN_MODE,
        ...input,
      });
      await navigate({
        to: "/draft/$draftId",
        params: buildDraftThreadRouteParams(nextDraftId),
      });
      return nextThreadId;
    },
    [
      activeProject,
      draftId,
      getDraftSession,
      getDraftSessionByLogicalProjectKey,
      isServerThread,
      navigate,
      projectGroupingSettings,
      routeKind,
      setDraftThreadContext,
      setLogicalProjectDraftThreadId,
      settings.defaultAgentTokenMode,
    ],
  );

  const handlePreparedPullRequestThread = useCallback(
    async (input: { branch: string; worktreePath: string | null }) => {
      await openOrReuseProjectDraftThread({
        branch: input.branch,
        worktreePath: input.worktreePath,
        envMode: input.worktreePath ? "worktree" : "local",
      });
    },
    [openOrReuseProjectDraftThread],
  );

  useEffect(() => {
    if (!serverThread?.id) return;
    if (!latestTurnSettled) return;
    if (!activeLatestTurn?.completedAt) return;
    const turnCompletedAt = Date.parse(activeLatestTurn.completedAt);
    if (Number.isNaN(turnCompletedAt)) return;
    const lastVisitedAt = activeThreadLastVisitedAt ? Date.parse(activeThreadLastVisitedAt) : NaN;
    if (!Number.isNaN(lastVisitedAt) && lastVisitedAt >= turnCompletedAt) return;

    markThreadVisited(
      scopedThreadKey(scopeThreadRef(serverThread.environmentId, serverThread.id)),
      activeLatestTurn.completedAt,
    );
  }, [
    activeLatestTurn?.completedAt,
    activeThreadLastVisitedAt,
    latestTurnSettled,
    markThreadVisited,
    serverThread?.environmentId,
    serverThread?.id,
  ]);

  const selectedProviderByThreadId = composerActiveProvider ?? null;
  const threadProvider =
    activeThread?.modelSelection.instanceId ??
    activeProject?.defaultModelSelection?.instanceId ??
    null;
  const lockedProvider = deriveLockedProvider({
    thread: activeThread,
    selectedProvider: selectedProviderByThreadId,
    threadProvider,
  });
  const primaryServerConfig = useServerConfig();
  const activeEnvRuntimeState = useSavedEnvironmentRuntimeStore((s) =>
    activeThread?.environmentId ? s.byId[activeThread.environmentId] : null,
  );
  // Use the server config for the thread's environment.  For the primary
  // environment fall back to the global atom; for remote environments use
  // the runtime state stored by the environment manager.
  const serverConfig =
    primaryEnvironmentId && activeThread?.environmentId === primaryEnvironmentId
      ? primaryServerConfig
      : (activeEnvRuntimeState?.serverConfig ?? primaryServerConfig);
  const versionMismatch = resolveServerConfigVersionMismatch(serverConfig);
  const versionMismatchDismissKey =
    versionMismatch && activeThread
      ? buildVersionMismatchDismissalKey(activeThread.environmentId, versionMismatch)
      : null;
  const [dismissedVersionMismatchKey, setDismissedVersionMismatchKey] = useState<string | null>(
    null,
  );
  const versionMismatchDismissed =
    versionMismatchDismissKey === dismissedVersionMismatchKey ||
    isVersionMismatchDismissed(versionMismatchDismissKey);
  const showVersionMismatchBanner =
    versionMismatch !== null && versionMismatchDismissKey !== null && !versionMismatchDismissed;
  const hasMultipleRegisteredEnvironments = Object.keys(savedEnvironmentRegistry).length > 0;
  const versionMismatchServerLabel = useMemo(() => {
    if (!hasMultipleRegisteredEnvironments || !activeThread) {
      return "server";
    }

    const isPrimary = activeThread.environmentId === primaryEnvironmentId;
    const savedRecord = savedEnvironmentRegistry[activeThread.environmentId];
    const runtimeState = savedEnvironmentRuntimeById[activeThread.environmentId];
    return `${resolveEnvironmentOptionLabel({
      isPrimary,
      environmentId: activeThread.environmentId,
      runtimeLabel: runtimeState?.descriptor?.label ?? serverConfig?.environment.label ?? null,
      savedLabel: savedRecord?.label ?? null,
    })} server`;
  }, [
    activeThread,
    hasMultipleRegisteredEnvironments,
    primaryEnvironmentId,
    savedEnvironmentRegistry,
    savedEnvironmentRuntimeById,
    serverConfig?.environment.label,
  ]);
  const composerBannerItems = useMemo<ComposerBannerStackItem[]>(() => {
    const items: ComposerBannerStackItem[] = [];
    if (activeEnvironmentUnavailableState) {
      items.push({
        id: `environment-unavailable:${activeEnvironmentUnavailableState.environmentId}`,
        variant:
          activeEnvironmentUnavailableState.connectionState === "error" ? "error" : "warning",
        icon: <WifiOffIcon />,
        title: (
          <>
            {activeEnvironmentUnavailableState.label} is{" "}
            {activeEnvironmentUnavailableState.connectionState === "connecting"
              ? "connecting"
              : "disconnected"}
          </>
        ),
        description: "Reconnect this environment before sending messages or running actions.",
        actions: (
          <>
            <Button
              size="xs"
              disabled={
                activeEnvironmentUnavailableState.connectionState === "connecting" ||
                reconnectingEnvironmentId === activeEnvironmentUnavailableState.environmentId
              }
              onClick={() =>
                void handleReconnectActiveEnvironment(
                  activeEnvironmentUnavailableState.environmentId,
                  activeEnvironmentUnavailableState.label,
                )
              }
            >
              {activeEnvironmentUnavailableState.connectionState === "connecting" ||
              reconnectingEnvironmentId === activeEnvironmentUnavailableState.environmentId
                ? "Reconnecting..."
                : "Reconnect"}
            </Button>
            <Button size="xs" variant="outline" onClick={() => openSettings("connections")}>
              Connections
            </Button>
          </>
        ),
      });
    }
    if (showVersionMismatchBanner && versionMismatch && versionMismatchDismissKey) {
      items.push({
        id: `version-mismatch:${versionMismatchDismissKey}`,
        variant: "warning",
        icon: <TriangleAlertIcon />,
        title: "Client and server versions differ",
        description: (
          <>
            Client {versionMismatch.clientVersion} is connected to {versionMismatchServerLabel}{" "}
            {versionMismatch.serverVersion}. Sync them if RPC calls or reconnects fail.
          </>
        ),
        dismissLabel: "Dismiss version mismatch warning",
        onDismiss: () => {
          dismissVersionMismatch(versionMismatchDismissKey);
          setDismissedVersionMismatchKey(versionMismatchDismissKey);
        },
      });
    }
    return items;
  }, [
    activeEnvironmentUnavailableState,
    handleReconnectActiveEnvironment,
    openSettings,
    reconnectingEnvironmentId,
    showVersionMismatchBanner,
    versionMismatch,
    versionMismatchDismissKey,
    versionMismatchServerLabel,
  ]);
  const sourceControlDiscoveryForHints = useSourceControlDiscovery();
  const hasSourceControlRemote = useMemo(
    () =>
      (sourceControlDiscoveryForHints.data?.sourceControlProviders ?? []).some(
        (provider) =>
          provider.status === "available" &&
          (provider.auth.status === "authenticated" || provider.auth.status === "unknown"),
      ),
    [sourceControlDiscoveryForHints.data],
  );
  // Jira availability follows the project's Atlassian link: a Jira connection
  // plus at least one linked project key (same predicate as the Project
  // Explorer's Jira tab).
  const atlassianProjectLinkQuery = useAtlassianProjectLink({
    environmentId,
    projectId: activeProject?.id ?? null,
    enabled: activeProject !== undefined,
  });
  const hasJiraProvider = useMemo(() => {
    const projectLink = atlassianProjectLinkQuery.data ?? null;
    return (
      projectLink?.jiraConnectionId !== null &&
      projectLink?.jiraConnectionId !== undefined &&
      projectLink.jiraProjectKeys.length > 0
    );
  }, [atlassianProjectLinkQuery.data]);
  // First-turn-only: hide as soon as anything has been sent. We check both the
  // persisted messages array and the optimistic send buffer because the latter
  // is populated immediately on send while the former only updates once the
  // server acknowledges; checking only messages.length would leave a brief
  // window where the row stays visible after the user presses send.
  const hintRowVisible =
    activeThread !== undefined &&
    activeThread.messages.length === 0 &&
    optimisticUserMessages.length === 0;
  const handleInsertHintTrigger = useCallback(
    (trigger: HintRowTrigger) => {
      composerRef.current?.insertTriggerAtCursor(trigger);
    },
    [composerRef],
  );
  const providerStatuses = serverConfig?.providers ?? EMPTY_PROVIDERS;
  const composerProviderStatusesCacheRef = useRef({
    key: "",
    snapshot: EMPTY_PROVIDERS,
  });
  const composerProviderStatuses = useMemo(
    () =>
      stabilizeProviderStatusesSnapshot(providerStatuses, composerProviderStatusesCacheRef.current),
    [providerStatuses],
  );
  const activeThreadSessionProviderInstanceId = activeThread?.session?.providerInstanceId ?? null;
  const unlockedSelectedProvider = resolveSelectableProvider(
    providerStatuses,
    selectedProviderByThreadId ?? threadProvider ?? ProviderDriverKind.make("codex"),
  );
  const selectedProvider: ProviderDriverKind = lockedProvider ?? unlockedSelectedProvider;
  const phase = derivePhase(activeThread?.session ?? null);
  const threadActivities = activeThread?.activities ?? EMPTY_ACTIVITIES;
  const threadActivityViewModel = useMemo(
    () => deriveThreadActivityViewModel(threadActivities, activeLatestTurn?.turnId),
    [activeLatestTurn?.turnId, threadActivities],
  );
  const {
    workLogEntries,
    contextCompactionEntries,
    latestTurnHasToolActivity,
    pendingApprovals,
    pendingUserInputs,
    activePlan,
  } = threadActivityViewModel;
  const threadSubagents = useMemo(
    () => deriveThreadSubagents(threadActivities),
    [threadActivities],
  );
  const {
    activePendingUserInput,
    activePendingDraftAnswers,
    activePendingQuestionIndex,
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingIsResponding,
    onSelectActivePendingUserInputOption,
    onChangeActivePendingUserInputCustomAnswer,
    onAdvanceActivePendingUserInput,
    onPreviousActivePendingUserInputQuestion,
  } = useChatPendingUserInput({
    pendingUserInputs,
    respondingUserInputRequestIds,
    readComposer,
    promptRef,
    onRespondToUserInput,
  });
  const activeProposedPlan = useMemo(() => {
    if (!latestTurnSettled) {
      return null;
    }
    return findLatestProposedPlan(
      activeThread?.proposedPlans ?? [],
      activeLatestTurn?.turnId ?? null,
    );
  }, [activeLatestTurn?.turnId, activeThread?.proposedPlans, latestTurnSettled]);
  const sidebarProposedPlan = useMemo(
    () =>
      findSidebarProposedPlan({
        threads: threadPlanCatalog,
        latestTurn: activeLatestTurn,
        latestTurnSettled,
        threadId: activeThread?.id ?? null,
      }),
    [activeLatestTurn, activeThread?.id, latestTurnSettled, threadPlanCatalog],
  );
  const planSidebarLabel = "Overview";
  const showPlanFollowUpPrompt =
    pendingUserInputs.length === 0 &&
    interactionMode === "plan" &&
    latestTurnSettled &&
    hasActionableProposedPlan(activeProposedPlan);
  const activePendingApproval = pendingApprovals[0] ?? null;
  const {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt,
    isPreparingWorktree,
    isSendBusy,
  } = useLocalDispatchState({
    activeThread,
    activeLatestTurn,
    phase,
    activePendingApproval: activePendingApproval?.requestId ?? null,
    activePendingUserInput: activePendingUserInput?.requestId ?? null,
    threadError: activeThread?.error,
  });
  const isWorking = phase === "running" || isSendBusy || isConnecting || isRevertingCheckpoint;
  const activeWorkStartedAt = deriveActiveWorkStartedAt(
    activeLatestTurn,
    activeThread?.session ?? null,
    localDispatchStartedAt,
  );
  const serverMessages = activeThread?.messages;
  const { attachmentPreviewHandoffByMessageId, handoffAttachmentPreviews } =
    useChatAttachmentPreviewHandoff({
      serverMessages,
      optimisticUserMessagesRef,
    });
  const timelineMessages = useMemo(() => {
    const messages = serverMessages ?? [];
    const serverMessagesWithPreviewHandoff =
      Object.keys(attachmentPreviewHandoffByMessageId).length === 0
        ? messages
        : // Spread only fires for the few messages that actually changed;
          // unchanged ones early-return their original reference.
          // In-place mutation would break React's immutable state contract.
          // oxlint-disable-next-line no-map-spread
          messages.map((message) => {
            if (
              message.role !== "user" ||
              !message.attachments ||
              message.attachments.length === 0
            ) {
              return message;
            }
            const handoffPreviewUrls = attachmentPreviewHandoffByMessageId[message.id];
            if (!handoffPreviewUrls || handoffPreviewUrls.length === 0) {
              return message;
            }

            let changed = false;
            let imageIndex = 0;
            const attachments = message.attachments.map((attachment) => {
              if (attachment.type !== "image") {
                return attachment;
              }
              const handoffPreviewUrl = handoffPreviewUrls[imageIndex];
              imageIndex += 1;
              if (!handoffPreviewUrl || attachment.previewUrl === handoffPreviewUrl) {
                return attachment;
              }
              changed = true;
              return {
                ...attachment,
                previewUrl: handoffPreviewUrl,
              };
            });

            return changed ? { ...message, attachments } : message;
          });

    if (optimisticUserMessages.length === 0) {
      return serverMessagesWithPreviewHandoff;
    }
    const serverIds = new Set(serverMessagesWithPreviewHandoff.map((message) => message.id));
    const pendingMessages = optimisticUserMessages.filter((message) => !serverIds.has(message.id));
    if (pendingMessages.length === 0) {
      return serverMessagesWithPreviewHandoff;
    }
    return [...serverMessagesWithPreviewHandoff, ...pendingMessages];
  }, [serverMessages, attachmentPreviewHandoffByMessageId, optimisticUserMessages]);
  const timelineEntries = useMemo(
    () =>
      deriveTimelineEntries(
        timelineMessages,
        activeThread?.proposedPlans ?? [],
        workLogEntries,
        contextCompactionEntries,
      ),
    [activeThread?.proposedPlans, contextCompactionEntries, timelineMessages, workLogEntries],
  );
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const turnDiffSummaryByAssistantMessageId = useMemo(() => {
    const byMessageId = new Map<MessageId, TurnDiffSummary>();
    for (const summary of turnDiffSummaries) {
      if (!summary.assistantMessageId) continue;
      byMessageId.set(summary.assistantMessageId, summary);
    }
    return byMessageId;
  }, [turnDiffSummaries]);
  const revertTurnCountByUserMessageId = useMemo(() => {
    return deriveRevertTurnCountByUserMessageId({
      timelineEntries,
      turnDiffSummaryByAssistantMessageId,
      inferredCheckpointTurnCountByTurnId,
    });
  }, [inferredCheckpointTurnCountByTurnId, timelineEntries, turnDiffSummaryByAssistantMessageId]);

  const completionSummary = useMemo(() => {
    if (!latestTurnSettled) return null;
    if (!activeLatestTurn?.startedAt) return null;
    if (!activeLatestTurn.completedAt) return null;
    if (!latestTurnHasToolActivity) return null;

    const elapsed = formatElapsed(activeLatestTurn.startedAt, activeLatestTurn.completedAt);
    return elapsed ? `Worked for ${elapsed}` : null;
  }, [
    activeLatestTurn?.completedAt,
    activeLatestTurn?.startedAt,
    latestTurnHasToolActivity,
    latestTurnSettled,
  ]);
  const completionDividerBeforeEntryId = useMemo(() => {
    if (!latestTurnSettled) return null;
    if (!completionSummary) return null;
    return deriveCompletionDividerBeforeEntryId(timelineEntries, activeLatestTurn);
  }, [activeLatestTurn, completionSummary, latestTurnSettled, timelineEntries]);
  const gitCwd = activeProject
    ? projectScriptCwd({
        project: { cwd: activeProject.cwd },
        worktreePath: activeThread?.worktreePath ?? null,
      })
    : null;
  const gitStatusQuery = useGitStatus({ environmentId, cwd: gitCwd });
  const queryClient = useQueryClient();
  const {
    postPushWorkflowWatch,
    handlePostPush: handlePostPushGitAction,
    clearWatch: clearPostPushWatch,
  } = usePostPushWorkflowWatch();
  const keybindings = useServerKeybindings();
  const availableEditors = useServerAvailableEditors();
  // Prefer an instance-id match so a custom Codex instance (e.g.
  // `codex_personal`) surfaces its own status/message in the banner rather
  // than the default Codex's. Falls back to first-match-by-kind when no
  // saved instance id is available or the instance no longer exists.
  const activeProviderInstanceId =
    activeThread?.session?.providerInstanceId ??
    activeThread?.modelSelection.instanceId ??
    activeProject?.defaultModelSelection?.instanceId ??
    null;
  const activeProviderStatus = useMemo(() => {
    if (activeProviderInstanceId) {
      return (
        providerStatuses.find((status) => status.instanceId === activeProviderInstanceId) ?? null
      );
    }
    const defaultInstanceId = defaultInstanceIdForDriver(selectedProvider);
    return providerStatuses.find((status) => status.instanceId === defaultInstanceId) ?? null;
  }, [activeProviderInstanceId, providerStatuses, selectedProvider]);
  const activeProjectCwd = activeProject?.cwd ?? null;
  const activeThreadWorktreePath = activeThread?.worktreePath ?? null;
  const activeWorkspaceRoot = activeThreadWorktreePath ?? activeProjectCwd ?? undefined;
  const activeTerminalLaunchContext =
    terminalLaunchContext?.threadId === activeThreadId
      ? terminalLaunchContext
      : (storeServerTerminalLaunchContext ?? null);
  // Default true while loading to avoid toolbar flicker.
  const isGitRepo = gitStatusQuery.data?.isRepo ?? true;
  const terminalShortcutLabelOptions = useMemo(
    () => ({
      context: {
        terminalFocus: true,
        terminalOpen: Boolean(terminalState.terminalOpen),
      },
    }),
    [terminalState.terminalOpen],
  );
  const terminalToggleShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.toggle"),
    [keybindings],
  );
  const splitTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.split", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const newTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.new", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const closeTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.close", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const {
    onOpenReviewPanel,
    onToggleDiff,
    onOpenFilesPanel,
    onOpenTerminalPanel,
    onToggleWorkspacePanel,
    onOpenTurnDiff,
    onCloseDiff,
    onOpenSubagentPanel,
  } = useChatWorkspacePanels({
    navigate,
    environmentId,
    threadId,
    routeKind,
    draftId,
    isServerThread,
    hasActiveProject: Boolean(activeProject),
    diffOpen,
    workspacePanelOpen,
    externalToggleWorkspacePanel,
    onDiffPanelOpen,
    onPreviewPanelOpen,
    onTerminalPanelOpen,
    onAgentPanelOpen,
  });
  const envLocked = Boolean(
    activeThread &&
    (activeThread.messages.length > 0 ||
      (activeThread.session !== null && activeThread.session.status !== "closed")),
  );

  // Handle environment change for draft threads.  When the user picks a
  // different environment we update the draft context to point at the physical
  // project in that environment while keeping the same logical project.
  const onEnvironmentChange = useCallback(
    (nextEnvironmentId: EnvironmentId) => {
      if (envLocked || !draftId) return;
      const target = logicalProjectEnvironments.find(
        (env) => env.environmentId === nextEnvironmentId,
      );
      if (!target) return;
      setDraftThreadContext(draftId, {
        projectRef: scopeProjectRef(target.environmentId, target.projectId),
      });
    },
    [draftId, envLocked, logicalProjectEnvironments, setDraftThreadContext],
  );

  const activeTerminalGroup =
    terminalState.terminalGroups.find(
      (group) => group.id === terminalState.activeTerminalGroupId,
    ) ??
    terminalState.terminalGroups.find((group) =>
      group.terminalIds.includes(terminalState.activeTerminalId),
    ) ??
    null;
  const hasReachedSplitLimit =
    (activeTerminalGroup?.terminalIds.length ?? 0) >= MAX_TERMINALS_PER_GROUP;
  const focusComposer = useCallback(() => {
    readComposer()?.focusAtEnd();
  }, [readComposer]);
  const scheduleComposerFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      focusComposer();
    });
  }, [focusComposer]);
  const addTerminalContextToDraft = useCallback(
    (selection: TerminalContextSelection) => {
      readComposer()?.addTerminalContext(selection);
    },
    [readComposer],
  );
  const setTerminalOpen = useCallback(
    (open: boolean) => {
      if (!activeThreadRef) return;
      storeSetTerminalOpen(activeThreadRef, open);
    },
    [activeThreadRef, storeSetTerminalOpen],
  );
  const toggleTerminalVisibility = useCallback(() => {
    if (!activeThreadRef) return;
    setTerminalOpen(!terminalState.terminalOpen);
  }, [activeThreadRef, setTerminalOpen, terminalState.terminalOpen]);
  const splitTerminal = useCallback(() => {
    if (!activeThreadRef || hasReachedSplitLimit) return;
    const terminalId = `terminal-${randomUUID()}`;
    storeSplitTerminal(activeThreadRef, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  }, [activeThreadRef, hasReachedSplitLimit, storeSplitTerminal]);
  const createNewTerminal = useCallback(() => {
    if (!activeThreadRef) return;
    const terminalId = `terminal-${randomUUID()}`;
    storeNewTerminal(activeThreadRef, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  }, [activeThreadRef, storeNewTerminal]);
  const closeTerminal = useCallback(
    (terminalId: string) => {
      const api = readEnvironmentApi(environmentId);
      if (!activeThreadId || !api) return;
      const isFinalTerminal = terminalState.terminalIds.length <= 1;
      const fallbackExitWrite = () =>
        api.terminal
          .write({ threadId: activeThreadId, terminalId, data: "exit\n" })
          .catch(() => undefined);
      if ("close" in api.terminal && typeof api.terminal.close === "function") {
        void (async () => {
          if (isFinalTerminal) {
            await api.terminal
              .clear({ threadId: activeThreadId, terminalId })
              .catch(() => undefined);
          }
          await api.terminal.close({
            threadId: activeThreadId,
            terminalId,
            deleteHistory: true,
          });
        })().catch(() => fallbackExitWrite());
      } else {
        void fallbackExitWrite();
      }
      if (activeThreadRef) {
        storeCloseTerminal(activeThreadRef, terminalId);
      }
      setTerminalFocusRequestId((value) => value + 1);
    },
    [
      activeThreadId,
      activeThreadRef,
      environmentId,
      storeCloseTerminal,
      terminalState.terminalIds.length,
    ],
  );
  const { runProjectScript, saveProjectScript, updateProjectScript, deleteProjectScript } =
    useChatProjectScripts({
      environmentId,
      activeThread,
      activeThreadId,
      activeThreadRef,
      activeProject,
      gitCwd,
      terminalState,
      setLastInvokedScriptByProjectId,
      setTerminalLaunchContext,
      setTerminalOpen,
      storeNewTerminal,
      storeSetActiveTerminal,
      setTerminalFocusRequestId,
      setThreadError,
    });

  const handleRuntimeModeChange = useCallback(
    (mode: RuntimeMode) => {
      if (mode === runtimeMode) return;
      setComposerDraftRuntimeMode(composerDraftTarget, mode);
      if (isLocalDraftThread) {
        setDraftThreadContext(composerDraftTarget, { runtimeMode: mode });
      }
      scheduleComposerFocus();
    },
    [
      isLocalDraftThread,
      runtimeMode,
      scheduleComposerFocus,
      composerDraftTarget,
      setComposerDraftRuntimeMode,
      setDraftThreadContext,
    ],
  );

  const handleInteractionModeChange = useCallback(
    (mode: ProviderInteractionMode) => {
      if (mode === interactionMode) return;
      setComposerDraftInteractionMode(composerDraftTarget, mode);
      if (isLocalDraftThread) {
        setDraftThreadContext(composerDraftTarget, { interactionMode: mode });
      }
      scheduleComposerFocus();
    },
    [
      interactionMode,
      isLocalDraftThread,
      scheduleComposerFocus,
      composerDraftTarget,
      setComposerDraftInteractionMode,
      setDraftThreadContext,
    ],
  );
  const handleTokenModeChange = useCallback(
    (mode: AgentTokenMode) => {
      if (mode === tokenMode) return;
      setComposerDraftTokenMode(composerDraftTarget, mode);
      if (isLocalDraftThread) {
        setDraftThreadContext(composerDraftTarget, { tokenMode: mode });
      }
      scheduleComposerFocus();
    },
    [
      composerDraftTarget,
      isLocalDraftThread,
      scheduleComposerFocus,
      setComposerDraftTokenMode,
      setDraftThreadContext,
      tokenMode,
    ],
  );
  const toggleInteractionMode = useCallback(() => {
    handleInteractionModeChange(interactionMode === "plan" ? "default" : "plan");
  }, [handleInteractionModeChange, interactionMode]);
  const setOverviewSidebarOpen = useCallback(
    (open: boolean) => {
      setPlanSidebarOpen(open);
      planSidebarDismissedForTurnRef.current = open
        ? null
        : (activePlan?.turnId ?? sidebarProposedPlan?.turnId ?? "__dismissed__");
    },
    [activePlan?.turnId, sidebarProposedPlan?.turnId],
  );
  const closePlanSidebar = useCallback(() => {
    setOverviewFloatingOpen(false);
    setOverviewSidebarOpen(false);
  }, [setOverviewSidebarOpen]);
  const toggleOverviewSidebar = useCallback(
    (nextOpen?: boolean) => {
      if (workspacePanelOpen) {
        const wantsOpen = typeof nextOpen === "boolean" ? nextOpen : !overviewFloatingOpen;
        setOverviewFloatingOpen(wantsOpen);
        setOverviewSidebarOpen(wantsOpen);
        return;
      }

      const wantsOpen = typeof nextOpen === "boolean" ? nextOpen : !planSidebarOpen;
      setOverviewFloatingOpen(false);
      setOverviewSidebarOpen(wantsOpen);
    },
    [overviewFloatingOpen, planSidebarOpen, setOverviewSidebarOpen, workspacePanelOpen],
  );

  const persistThreadSettingsForNextTurn = useCallback(
    async (input: {
      threadId: ThreadId;
      createdAt: string;
      modelSelection?: ModelSelection;
      runtimeMode: RuntimeMode;
      interactionMode: ProviderInteractionMode;
      tokenMode: AgentTokenMode;
    }) => {
      if (!serverThread) {
        return;
      }
      const api = readEnvironmentApi(environmentId);
      if (!api) {
        return;
      }

      if (
        input.modelSelection !== undefined &&
        (input.modelSelection.model !== serverThread.modelSelection.model ||
          input.modelSelection.instanceId !== serverThread.modelSelection.instanceId ||
          JSON.stringify(input.modelSelection.options ?? null) !==
            JSON.stringify(serverThread.modelSelection.options ?? null))
      ) {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: input.threadId,
          modelSelection: input.modelSelection,
        });
      }

      if (input.runtimeMode !== serverThread.runtimeMode) {
        await api.orchestration.dispatchCommand({
          type: "thread.runtime-mode.set",
          commandId: newCommandId(),
          threadId: input.threadId,
          runtimeMode: input.runtimeMode,
          createdAt: input.createdAt,
        });
      }

      if (input.interactionMode !== serverThread.interactionMode) {
        await api.orchestration.dispatchCommand({
          type: "thread.interaction-mode.set",
          commandId: newCommandId(),
          threadId: input.threadId,
          interactionMode: input.interactionMode,
          createdAt: input.createdAt,
        });
      }

      if (input.tokenMode !== (serverThread.tokenMode ?? DEFAULT_AGENT_TOKEN_MODE)) {
        await api.orchestration.dispatchCommand({
          type: "thread.token-mode.set",
          commandId: newCommandId(),
          threadId: input.threadId,
          tokenMode: input.tokenMode,
          createdAt: input.createdAt,
        });
      }
    },
    [environmentId, serverThread],
  );

  // Scroll helpers — LegendList handles auto-scroll via maintainScrollAtEnd.
  const scrollToEnd = useCallback((animated = false) => {
    legendListRef.current?.scrollToEnd?.({ animated });
  }, []);

  // Debounce *showing* the scroll-to-bottom pill so it doesn't flash during
  // thread switches.  LegendList fires scroll events with isAtEnd=false while
  // initialScrollAtEnd is settling; hiding is always immediate.
  const showScrollDebouncer = useRef(
    new Debouncer(() => setShowScrollToBottom(true), { wait: 150 }),
  );
  const onIsAtEndChange = useCallback((isAtEnd: boolean) => {
    if (isAtEndRef.current === isAtEnd) return;
    isAtEndRef.current = isAtEnd;
    if (isAtEnd) {
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
    } else {
      showScrollDebouncer.current.maybeExecute();
    }
  }, []);

  useEffect(() => {
    setPullRequestDialogState(null);
    isAtEndRef.current = true;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    // Honor an explicit "open the overview on the next thread" signal, set when
    // implementing a plan in a freshly created thread (`onImplementPlanInNewThread`).
    // In wide layouts the overview opens by default anyway, but in sheet/narrow
    // layouts it starts closed on every thread switch — without consuming this
    // signal the request to surface the new thread's plan would be silently lost.
    const openOverviewForNextThread = planSidebarOpenOnNextThreadRef.current;
    planSidebarOpenOnNextThreadRef.current = false;
    setPlanSidebarOpen(openOverviewForNextThread || !shouldUsePlanSidebarSheet);
    planSidebarDismissedForTurnRef.current = null;
  }, [activeThread?.id, shouldUsePlanSidebarSheet]);

  // Auto-open the plan sidebar when plan/todo steps arrive for the current turn.
  // Don't auto-open for plans carried over from a previous turn (the user can open manually).
  useEffect(() => {
    if (!autoOpenPlanSidebar) return;
    if (!activePlan) return;
    if (planSidebarOpen) return;
    const latestTurnId = activeLatestTurn?.turnId ?? null;
    if (latestTurnId && activePlan.turnId !== latestTurnId) return;
    const turnKey = activePlan.turnId ?? sidebarProposedPlan?.turnId ?? "__dismissed__";
    if (planSidebarDismissedForTurnRef.current === turnKey) return;
    setPlanSidebarOpen(true);
  }, [
    activePlan,
    activeLatestTurn?.turnId,
    autoOpenPlanSidebar,
    planSidebarOpen,
    sidebarProposedPlan?.turnId,
  ]);

  useEffect(() => {
    if (!activeThread?.id || terminalState.terminalOpen) return;
    const frame = window.requestAnimationFrame(() => {
      focusComposer();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeThread?.id, focusComposer, terminalState.terminalOpen]);

  useEffect(() => {
    if (!activeThread?.id) return;
    if (activeThread.messages.length === 0) {
      return;
    }
    const serverIds = new Set(activeThread.messages.map((message) => message.id));
    const removedMessages = optimisticUserMessages.filter((message) => serverIds.has(message.id));
    if (removedMessages.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setOptimisticUserMessages((existing) =>
        existing.filter((message) => !serverIds.has(message.id)),
      );
    }, 0);
    for (const removedMessage of removedMessages) {
      const previewUrls = collectUserMessageBlobPreviewUrls(removedMessage);
      if (previewUrls.length > 0) {
        handoffAttachmentPreviews(removedMessage.id, previewUrls);
        continue;
      }
      revokeUserMessagePreviewUrls(removedMessage);
    }
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeThread?.id, activeThread?.messages, handoffAttachmentPreviews, optimisticUserMessages]);

  useEffect(() => {
    setOptimisticUserMessages((existing) => {
      for (const message of existing) {
        revokeUserMessagePreviewUrls(message);
      }
      return [];
    });
    resetLocalDispatch();
    setExpandedImage(null);
  }, [draftId, resetLocalDispatch, threadId]);

  const closeExpandedImage = useCallback(() => {
    setExpandedImage(null);
  }, []);

  const activeWorktreePath = activeThread?.worktreePath ?? null;
  const envMode: DraftThreadEnvMode = resolveEffectiveEnvMode({
    activeWorktreePath,
    hasServerThread: isServerThread,
    draftThreadEnvMode: isLocalDraftThread ? draftThread?.envMode : undefined,
  });
  const canOverrideServerThreadBranch = Boolean(
    isServerThread &&
    activeThread &&
    activeThread.messages.length === 0 &&
    activeThread.worktreePath === null &&
    !envLocked,
  );
  const activeThreadBranch =
    canOverrideServerThreadBranch && pendingServerThreadBranch !== undefined
      ? pendingServerThreadBranch
      : (activeThread?.branch ?? null);
  const {
    sourceControlActions: overviewSourceControlActions,
    branchControl: overviewBranchControl,
  } = useOverviewPanelControls({
    gitCwd,
    activeThreadRef,
    routeKind,
    draftId,
    onPostPush: handlePostPushGitAction,
    branchControlThread: activeThread
      ? { environmentId: activeThread.environmentId, id: activeThread.id }
      : null,
    isGitRepo,
    canOverrideServerThreadBranch,
    activeThreadBranch,
    onActiveThreadBranchOverrideChange: setPendingServerThreadBranch,
    envLocked,
    onComposerFocusRequest: scheduleComposerFocus,
    canCheckoutPullRequestIntoThread,
    onCheckoutPullRequestRequest: openPullRequestDialog,
  });
  const sendEnvMode = resolveSendEnvMode({
    requestedEnvMode: envMode,
    isGitRepo,
  });

  useEffect(() => {
    setPendingServerThreadBranch(undefined);
  }, [activeThread?.id]);

  useEffect(() => {
    if (canOverrideServerThreadBranch) {
      return;
    }
    setPendingServerThreadBranch(undefined);
  }, [canOverrideServerThreadBranch]);

  useEffect(() => {
    if (!activeThreadId) {
      setTerminalLaunchContext(null);
      storeClearTerminalLaunchContext(routeThreadRef);
      return;
    }
    setTerminalLaunchContext((current) => {
      if (!current) return current;
      if (current.threadId === activeThreadId) return current;
      return null;
    });
  }, [activeThreadId, routeThreadRef, storeClearTerminalLaunchContext]);

  useEffect(() => {
    if (!activeThreadId || !activeProjectCwd) {
      return;
    }
    setTerminalLaunchContext((current) => {
      if (!current || current.threadId !== activeThreadId) {
        return current;
      }
      const settledCwd = projectScriptCwd({
        project: { cwd: activeProjectCwd },
        worktreePath: activeThreadWorktreePath,
      });
      if (
        settledCwd === current.cwd &&
        (activeThreadWorktreePath ?? null) === current.worktreePath
      ) {
        if (activeThreadRef) {
          storeClearTerminalLaunchContext(activeThreadRef);
        }
        return null;
      }
      return current;
    });
  }, [
    activeProjectCwd,
    activeThreadId,
    activeThreadRef,
    activeThreadWorktreePath,
    storeClearTerminalLaunchContext,
  ]);

  useEffect(() => {
    if (!activeThreadId || !activeProjectCwd || !storeServerTerminalLaunchContext) {
      return;
    }
    const settledCwd = projectScriptCwd({
      project: { cwd: activeProjectCwd },
      worktreePath: activeThreadWorktreePath,
    });
    if (
      settledCwd === storeServerTerminalLaunchContext.cwd &&
      (activeThreadWorktreePath ?? null) === storeServerTerminalLaunchContext.worktreePath
    ) {
      if (activeThreadRef) {
        storeClearTerminalLaunchContext(activeThreadRef);
      }
    }
  }, [
    activeProjectCwd,
    activeThreadId,
    activeThreadRef,
    activeThreadWorktreePath,
    storeClearTerminalLaunchContext,
    storeServerTerminalLaunchContext,
  ]);

  useEffect(() => {
    if (terminalState.terminalOpen) {
      return;
    }
    if (activeThreadRef) {
      storeClearTerminalLaunchContext(activeThreadRef);
    }
    setTerminalLaunchContext((current) => (current?.threadId === activeThreadId ? null : current));
  }, [
    activeThreadId,
    activeThreadRef,
    storeClearTerminalLaunchContext,
    terminalState.terminalOpen,
  ]);

  useEffect(() => {
    if (!activeThreadKey) return;
    const previous = terminalOpenByThreadRef.current[activeThreadKey] ?? false;
    const current = Boolean(terminalState.terminalOpen);

    if (!previous && current) {
      terminalOpenByThreadRef.current[activeThreadKey] = current;
      setTerminalFocusRequestId((value) => value + 1);
      return;
    } else if (previous && !current) {
      terminalOpenByThreadRef.current[activeThreadKey] = current;
      const frame = window.requestAnimationFrame(() => {
        focusComposer();
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    terminalOpenByThreadRef.current[activeThreadKey] = current;
  }, [activeThreadKey, focusComposer, terminalState.terminalOpen]);

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (shouldIgnoreGlobalNavigationShortcut(event) && !projectExplorerOpenRef.current) return;
      const isToggleProjectExplorer = matchesExactModShortcut(event, "p", {
        shiftKey: true,
      });
      if (!isToggleProjectExplorer) return;
      event.preventDefault();
      event.stopPropagation();
      setProjectExplorerInitialTab("prs");
      setProjectExplorerOpen((value) => !value);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  useChatGlobalShortcuts({
    activeThreadId,
    keybindings,
    terminalOpen: terminalState.terminalOpen,
    activeTerminalId: terminalState.activeTerminalId,
    readComposer,
    activeProject,
    toggleTerminalVisibility,
    splitTerminal,
    closeTerminal,
    createNewTerminal,
    setTerminalOpen,
    onToggleDiff,
    onOpenFilesPanel,
    onOpenReviewPanel,
    onOpenTerminalPanel,
    runProjectScript,
  });

  const onRevertToTurnCount = useCallback(
    async (turnCount: number) => {
      await revertToTurnCount({
        thread: activeThread ?? null,
        turnCount,
        environmentUnavailable: activeEnvironmentUnavailable,
        environmentUnavailableLabel: activeEnvironmentUnavailableLabel,
        turnInProgress: phase === "running" || isSendBusy || isConnecting,
      });
    },
    [
      activeEnvironmentUnavailable,
      activeEnvironmentUnavailableLabel,
      activeThread,
      isConnecting,
      isSendBusy,
      phase,
      revertToTurnCount,
    ],
  );

  const runSend = async (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    const api = readEnvironmentApi(environmentId);
    if (
      !api ||
      !activeThread ||
      isSendBusy ||
      isConnecting ||
      activeEnvironmentUnavailable ||
      sendInFlightRef.current
    )
      return;
    if (activePendingProgress) {
      onAdvanceActivePendingUserInput();
      return;
    }
    const sendCtx = readComposer()?.getSendContext();
    if (!sendCtx) return;
    const {
      images: composerImages,
      terminalContexts: composerTerminalContexts,
      sourceControlContexts: composerSourceControlContexts,
      workItemContexts: composerWorkItemContexts,
      selectedProvider: ctxSelectedProvider,
      selectedModel: ctxSelectedModel,
      selectedProviderModels: ctxSelectedProviderModels,
      selectedPromptEffort: ctxSelectedPromptEffort,
      selectedModelSelection: ctxSelectedModelSelection,
    } = sendCtx;
    const promptForSend = promptRef.current;
    const {
      trimmedPrompt: trimmed,
      sendableTerminalContexts: sendableComposerTerminalContexts,
      expiredTerminalContextCount,
      hasSendableContent,
    } = deriveComposerSendState({
      prompt: promptForSend,
      imageCount: composerImages.length,
      terminalContexts: composerTerminalContexts,
      sourceControlContexts: composerSourceControlContexts,
      workItemContexts: composerWorkItemContexts,
    });
    if (showPlanFollowUpPrompt && activeProposedPlan) {
      const followUp = resolvePlanFollowUpSubmission({
        draftText: trimmed,
        planMarkdown: activeProposedPlan.planMarkdown,
      });
      promptRef.current = "";
      clearComposerDraftContent(composerDraftTarget);
      setComposerDraftTokenMode(composerDraftTarget, tokenMode);
      readComposer()?.resetCursorState();
      await onSubmitPlanFollowUp({
        text: followUp.text,
        interactionMode: followUp.interactionMode,
      });
      return;
    }
    const standaloneSlashCommand =
      composerImages.length === 0 && sendableComposerTerminalContexts.length === 0
        ? parseStandaloneComposerSlashCommand(trimmed)
        : null;
    if (standaloneSlashCommand) {
      handleInteractionModeChange(standaloneSlashCommand);
      promptRef.current = "";
      clearComposerDraftContent(composerDraftTarget);
      setComposerDraftTokenMode(composerDraftTarget, tokenMode);
      readComposer()?.resetCursorState();
      return;
    }
    if (!hasSendableContent) {
      if (expiredTerminalContextCount > 0) {
        const toastCopy = buildExpiredTerminalContextToastCopy(
          expiredTerminalContextCount,
          "empty",
        );
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: toastCopy.title,
            description: toastCopy.description,
          }),
        );
      }
      return;
    }
    if (!activeProject) return;
    const threadIdForSend = activeThread.id;
    const isFirstMessage = !isServerThread || activeThread.messages.length === 0;
    const { shouldMaterializeLegacyBranchWorktree, baseBranchForWorktree, shouldCreateWorktree } =
      resolveChatSendWorktreePlan({
        isServerThread,
        isFirstMessage,
        threadWorktreePath: activeThread.worktreePath,
        activeThreadBranch,
        currentGitRefName: gitStatusQuery.data?.refName ?? null,
        sendEnvMode,
      });

    // In worktree mode, require an explicit base branch so we don't silently
    // fall back to local execution when branch selection is missing.
    if (shouldCreateWorktree && !activeThreadBranch) {
      setThreadError(threadIdForSend, "Select a base branch before sending in New worktree mode.");
      return;
    }

    await executeChatSendTurn({
      composer: {
        prompt: promptForSend,
        trimmedPrompt: trimmed,
        images: composerImages,
        sendableTerminalContexts: sendableComposerTerminalContexts,
        sourceControlContexts: composerSourceControlContexts,
        workItemContexts: composerWorkItemContexts,
        selectedProvider: ctxSelectedProvider,
        selectedModel: ctxSelectedModel,
        selectedProviderModels: ctxSelectedProviderModels,
        selectedPromptEffort: ctxSelectedPromptEffort,
        selectedModelSelection: ctxSelectedModelSelection,
        expiredTerminalContextCount,
      },
      thread: {
        threadId: threadIdForSend,
        isFirstMessage,
        isServerThread,
        isLocalDraftThread,
        activeThreadBranch,
        worktreePath: activeThread.worktreePath,
        createdAt: activeThread.createdAt,
        projectId: activeProject.id,
      },
      worktree: {
        shouldMaterializeLegacyBranchWorktree,
        baseBranchForWorktree,
        shouldCreateWorktree,
        pendingWorkspace: isLocalDraftThread ? (draftThread?.pendingWorkspace ?? null) : null,
      },
      settings: { runtimeMode, interactionMode, tokenMode },
      project: {
        projectId: activeProject.id,
        projectCwd: activeProject.cwd,
        defaultModelSelection: activeProject.defaultModelSelection ?? null,
      },
      scroll: {
        scrollToEndBeforeOptimistic: async () => {
          isAtEndRef.current = true;
          showScrollDebouncer.current.cancel();
          setShowScrollToBottom(false);
          await legendListRef.current?.scrollToEnd?.({ animated: false });
        },
      },
      draft: {
        composerDraftTarget,
        environmentId,
        clearComposerDraftContent,
        setComposerDraftTokenMode,
        setComposerDraftPrompt,
        addComposerDraftImages,
        setComposerDraftTerminalContexts,
        setDraftThreadContext,
      },
      dispatch: {
        api,
        beginLocalDispatch,
        resetLocalDispatch,
        setOptimisticUserMessages,
        setThreadError,
      },
      refs: { promptRef, composerImagesRef, composerTerminalContextsRef, sendInFlightRef },
      sourceControl: {
        fetcher: async (ctx) => {
          const cwd = gitCwd;
          if (!cwd) return ctx;
          const now = DateTime.fromDateUnsafe(new Date());
          const staleAfterDate = DateTime.fromDateUnsafe(new Date(Date.now() + 5 * 60 * 1000));
          if (ctx.kind === "issue") {
            const detail = await queryClient.fetchQuery(
              issueDetailQueryOptions({ environmentId, cwd, reference: String(ctx.detail.number) }),
            );
            return { ...ctx, detail, fetchedAt: now, staleAfter: staleAfterDate };
          }
          const detail = await queryClient.fetchQuery(
            changeRequestDetailQueryOptions({
              environmentId,
              cwd,
              reference: String(ctx.detail.number),
            }),
          );
          return { ...ctx, detail, fetchedAt: now, staleAfter: staleAfterDate };
        },
        workItemFetcher: async (ctx) => {
          const projectId = activeProject?.id ?? null;
          if (!projectId) return ctx;
          const now = DateTime.fromDateUnsafe(new Date());
          const staleAfterDate = DateTime.fromDateUnsafe(new Date(Date.now() + 5 * 60 * 1000));
          const detail = await fetchWorkItemDetail({ environmentId, projectId, key: ctx.key });
          return { ...ctx, detail, fetchedAt: now, staleAfter: staleAfterDate };
        },
      },
      persistSettings: { persistThreadSettingsForNextTurn },
      composerHandle: { readComposer },
      formatOutgoingPrompt,
    });
  };
  const runSendRef = useRef(runSend);
  runSendRef.current = runSend;
  const onSend = useCallback((e?: { preventDefault: () => void }) => {
    void runSendRef.current(e);
  }, []);

  const onSubmitPlanFollowUp = useCallback(
    async ({
      text,
      interactionMode: nextInteractionMode,
    }: {
      text: string;
      interactionMode: "default" | "plan";
    }) => {
      const api = readEnvironmentApi(environmentId);
      if (
        !api ||
        !activeThread ||
        !isServerThread ||
        isSendBusy ||
        isConnecting ||
        sendInFlightRef.current
      ) {
        return;
      }

      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      const sendCtx = readComposer()?.getSendContext();
      if (!sendCtx) {
        return;
      }
      const {
        selectedProvider: ctxSelectedProvider,
        selectedModel: ctxSelectedModel,
        selectedProviderModels: ctxSelectedProviderModels,
        selectedPromptEffort: ctxSelectedPromptEffort,
        selectedModelSelection: ctxSelectedModelSelection,
      } = sendCtx;

      const threadIdForSend = activeThread.id;
      const messageIdForSend = newMessageId();
      const messageCreatedAt = new Date().toISOString();
      const outgoingMessageText = formatOutgoingPrompt({
        provider: ctxSelectedProvider,
        model: ctxSelectedModel,
        models: ctxSelectedProviderModels,
        effort: ctxSelectedPromptEffort,
        text: trimmed,
      });

      sendInFlightRef.current = true;
      beginLocalDispatch({ preparingWorktree: false });
      setThreadError(threadIdForSend, null);

      // Scroll to the current end *before* adding the optimistic message.
      isAtEndRef.current = true;
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
      await legendListRef.current?.scrollToEnd?.({ animated: false });

      setOptimisticUserMessages((existing) => [
        ...existing,
        {
          id: messageIdForSend,
          role: "user",
          text: outgoingMessageText,
          createdAt: messageCreatedAt,
          streaming: false,
        },
      ]);

      try {
        await persistThreadSettingsForNextTurn({
          threadId: threadIdForSend,
          createdAt: messageCreatedAt,
          modelSelection: ctxSelectedModelSelection,
          runtimeMode,
          interactionMode: nextInteractionMode,
          tokenMode,
        });

        // Keep the mode toggle and plan-follow-up banner in sync immediately
        // while the same-thread implementation turn is starting.
        setComposerDraftInteractionMode(
          scopeThreadRef(activeThread.environmentId, threadIdForSend),
          nextInteractionMode,
        );
        setComposerDraftTokenMode(
          scopeThreadRef(activeThread.environmentId, threadIdForSend),
          tokenMode,
        );

        await api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: threadIdForSend,
          message: {
            messageId: messageIdForSend,
            role: "user",
            text: outgoingMessageText,
            attachments: [],
          },
          modelSelection: ctxSelectedModelSelection,
          titleSeed: activeThread.title,
          runtimeMode,
          interactionMode: nextInteractionMode,
          tokenMode,
          ...(nextInteractionMode === "default" && activeProposedPlan
            ? {
                sourceProposedPlan: {
                  threadId: activeThread.id,
                  planId: activeProposedPlan.id,
                },
              }
            : {}),
          createdAt: messageCreatedAt,
        });
        // Optimistically open the plan sidebar when implementing (not refining).
        // "default" mode here means the agent is executing the plan, which produces
        // step-tracking activities that the sidebar will display.
        if (nextInteractionMode === "default" && autoOpenPlanSidebar) {
          planSidebarDismissedForTurnRef.current = null;
          setPlanSidebarOpen(true);
        }
        sendInFlightRef.current = false;
      } catch (err) {
        setOptimisticUserMessages((existing) =>
          existing.filter((message) => message.id !== messageIdForSend),
        );
        setThreadError(
          threadIdForSend,
          err instanceof Error ? err.message : "Failed to send plan follow-up.",
        );
        sendInFlightRef.current = false;
        resetLocalDispatch();
      }
    },
    [
      activeThread,
      activeProposedPlan,
      beginLocalDispatch,
      isConnecting,
      isSendBusy,
      isServerThread,
      persistThreadSettingsForNextTurn,
      readComposer,
      resetLocalDispatch,
      runtimeMode,
      setComposerDraftInteractionMode,
      setComposerDraftTokenMode,
      setThreadError,
      autoOpenPlanSidebar,
      environmentId,
      tokenMode,
    ],
  );

  const onImplementPlanInNewThread = useCallback(async () => {
    const api = readEnvironmentApi(environmentId);
    if (
      !api ||
      !activeThread ||
      !activeProject ||
      !activeProposedPlan ||
      !isServerThread ||
      isSendBusy ||
      isConnecting ||
      activeEnvironmentUnavailable ||
      sendInFlightRef.current
    ) {
      return;
    }

    const sendCtx = readComposer()?.getSendContext();
    if (!sendCtx) {
      return;
    }
    const {
      selectedProvider: ctxSelectedProvider,
      selectedModel: ctxSelectedModel,
      selectedProviderModels: ctxSelectedProviderModels,
      selectedPromptEffort: ctxSelectedPromptEffort,
      selectedModelSelection: ctxSelectedModelSelection,
    } = sendCtx;

    const createdAt = new Date().toISOString();
    const nextThreadId = newThreadId();
    const planMarkdown = activeProposedPlan.planMarkdown;
    const implementationPrompt = buildPlanImplementationPrompt(planMarkdown);
    const outgoingImplementationPrompt = formatOutgoingPrompt({
      provider: ctxSelectedProvider,
      model: ctxSelectedModel,
      models: ctxSelectedProviderModels,
      effort: ctxSelectedPromptEffort,
      text: implementationPrompt,
    });
    const nextThreadTitle = truncate(buildPlanImplementationThreadTitle(planMarkdown));
    const nextThreadModelSelection: ModelSelection = ctxSelectedModelSelection;

    sendInFlightRef.current = true;
    beginLocalDispatch({ preparingWorktree: false });
    const finish = () => {
      sendInFlightRef.current = false;
      resetLocalDispatch();
    };

    await api.orchestration
      .dispatchCommand({
        type: "thread.create",
        commandId: newCommandId(),
        threadId: nextThreadId,
        projectId: activeProject.id,
        title: nextThreadTitle,
        modelSelection: nextThreadModelSelection,
        runtimeMode,
        interactionMode: "default",
        tokenMode,
        branch: activeThreadBranch,
        worktreePath: activeThread.worktreePath,
        createdAt,
      })
      .then(() => {
        return api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: nextThreadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: outgoingImplementationPrompt,
            attachments: [],
          },
          modelSelection: ctxSelectedModelSelection,
          titleSeed: nextThreadTitle,
          runtimeMode,
          interactionMode: "default",
          tokenMode,
          sourceProposedPlan: {
            threadId: activeThread.id,
            planId: activeProposedPlan.id,
          },
          createdAt,
        });
      })
      .then(() => {
        return waitForStartedServerThread(scopeThreadRef(activeThread.environmentId, nextThreadId));
      })
      .then(() => {
        // Signal that the plan sidebar should open on the new thread when enabled.
        planSidebarOpenOnNextThreadRef.current = autoOpenPlanSidebar;
        return navigate({
          to: "/$environmentId/$threadId",
          params: {
            environmentId: activeThread.environmentId,
            threadId: nextThreadId,
          },
        });
      })
      .catch(async (err: unknown) => {
        await api.orchestration
          .dispatchCommand({
            type: "thread.delete",
            commandId: newCommandId(),
            threadId: nextThreadId,
          })
          .catch(() => undefined);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not start implementation thread",
            description:
              err instanceof Error
                ? err.message
                : "An error occurred while creating the new thread.",
          }),
        );
      })
      .then(finish, finish);
  }, [
    activeProject,
    activeProposedPlan,
    activeThreadBranch,
    activeThread,
    beginLocalDispatch,
    activeEnvironmentUnavailable,
    isConnecting,
    isSendBusy,
    isServerThread,
    navigate,
    readComposer,
    resetLocalDispatch,
    runtimeMode,
    tokenMode,
    autoOpenPlanSidebar,
    environmentId,
  ]);

  const onProviderModelSelect = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      if (!activeThread) return;
      // Look up the configured instance so model normalization and custom
      // model lookup stay scoped to that exact instance. Unknown instance ids
      // are rejected by returning early; the server remains authoritative too.
      const entry = providerStatuses.find((snapshot) => snapshot.instanceId === instanceId);
      const resolvedDriverKind = entry?.driver ?? null;
      if (
        lockedProvider !== null &&
        resolvedDriverKind !== null &&
        resolvedDriverKind !== lockedProvider
      ) {
        scheduleComposerFocus();
        return;
      }
      if (lockedProvider !== null && activeThread.session?.providerInstanceId) {
        const currentEntry = providerStatuses.find(
          (snapshot) => snapshot.instanceId === activeThread.session?.providerInstanceId,
        );
        if (
          currentEntry?.continuation?.groupKey &&
          entry?.continuation?.groupKey &&
          currentEntry.continuation.groupKey !== entry.continuation.groupKey
        ) {
          scheduleComposerFocus();
          return;
        }
      }
      const resolvedModel = resolveAppModelSelectionForInstance(
        instanceId,
        settings,
        providerStatuses,
        model,
      );
      if (!resolvedModel) {
        scheduleComposerFocus();
        return;
      }
      const nextModelSelection: ModelSelection = {
        instanceId,
        model: resolvedModel,
      };
      setComposerDraftModelSelection(
        scopeThreadRef(activeThread.environmentId, activeThread.id),
        nextModelSelection,
      );
      setStickyComposerModelSelection(nextModelSelection);
      scheduleComposerFocus();
    },
    [
      activeThread,
      lockedProvider,
      scheduleComposerFocus,
      setComposerDraftModelSelection,
      setStickyComposerModelSelection,
      providerStatuses,
      settings,
    ],
  );
  const onExpandTimelineImage = useCallback((preview: ExpandedImagePreview) => {
    setExpandedImage(preview);
  }, []);
  const onOpenTimelineContextAttachment = useCallback((attachment: ChatContextAttachment) => {
    const linkedItem = parseContextAttachmentLinkedItem(attachment);
    if (linkedItem) {
      setHeaderLinkedItem(linkedItem);
      return;
    }
    // Cross-repo references aren't resolvable in this workspace; fall back to
    // the item's URL.
    window.open(attachment.url, "_blank", "noopener,noreferrer");
  }, []);
  // Both the Map and the revert handler are read from refs at call-time so
  // the callback reference is fully stable and never busts context identity.
  const revertTurnCountRef = useRef(revertTurnCountByUserMessageId);
  revertTurnCountRef.current = revertTurnCountByUserMessageId;
  const onRevertToTurnCountRef = useRef(onRevertToTurnCount);
  onRevertToTurnCountRef.current = onRevertToTurnCount;
  const onRevertUserMessage = useCallback((messageId: MessageId) => {
    const targetTurnCount = revertTurnCountRef.current.get(messageId);
    if (typeof targetTurnCount !== "number") {
      return;
    }
    void onRevertToTurnCountRef.current(targetTurnCount);
  }, []);

  useEffect(() => {
    if (!workspacePanelOpen) {
      setOverviewFloatingOpen(false);
    }
  }, [workspacePanelOpen]);

  useEffect(() => {
    setOverviewFloatingOpen(false);
  }, [activeThread?.id]);

  const overviewSidebarVisible = planSidebarOpen && !workspacePanelOpen;
  const showFloatingOverviewSidebar = overviewFloatingOpen && workspacePanelOpen;
  const overviewControlOpen = overviewSidebarVisible || showFloatingOverviewSidebar;
  const showInlineOverviewSidebar = overviewSidebarVisible && !shouldUsePlanSidebarSheet;
  const showOverviewSidebarSheet = overviewSidebarVisible && shouldUsePlanSidebarSheet;
  const renderFloatingOverviewSidebar = useDelayedUnmount(
    showFloatingOverviewSidebar,
    prefersReducedMotion || !workspacePanelOpen ? 0 : OVERVIEW_FLOATING_EXIT_DURATION_MS,
  );
  const renderInlineOverviewSidebar = useDelayedUnmount(
    showInlineOverviewSidebar,
    prefersReducedMotion || shouldUsePlanSidebarSheet || workspacePanelOpen
      ? 0
      : OVERVIEW_SIDEBAR_EXIT_DURATION_MS,
  );

  // Empty state: no active thread
  if (!activeThread) {
    return <NoActiveThreadState />;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      {/* Top bar */}
      <header
        className={cn(
          "border-b border-border bg-muted/24",
          isElectron
            ? cn(
                "drag-region flex min-h-[52px] items-stretch px-3 sm:px-5 wco:min-h-[env(titlebar-area-height)]",
                reserveTitleBarControlInset &&
                  "wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]",
              )
            : "pl-[calc(env(safe-area-inset-left)+0.75rem)] pr-[calc(env(safe-area-inset-right)+0.75rem)] sm:pl-[calc(env(safe-area-inset-left)+1.25rem)] sm:pr-[calc(env(safe-area-inset-right)+1.25rem)]",
        )}
      >
        <ChatHeader
          activeThreadEnvironmentId={activeThread.environmentId}
          activeThreadTitle={activeThread.title}
          activeProjectName={activeProject?.name}
          isGitRepo={isGitRepo}
          openInCwd={gitCwd}
          activeProjectScripts={activeProject?.scripts}
          preferredScriptId={
            activeProject ? (lastInvokedScriptByProjectId[activeProject.id] ?? null) : null
          }
          keybindings={keybindings}
          availableEditors={availableEditors}
          worktreeBranch={activeWorktreeSummary?.branch ?? activeThread.branch ?? null}
          worktreeTitle={activeWorktreeSummary?.title ?? null}
          worktreeOrigin={activeWorktreeSummary?.origin ?? null}
          worktreeIssueNumber={activeWorktreeSummary?.issueNumber ?? null}
          worktreeIssueState={activeWorktreeSummary?.issueState ?? null}
          worktreePrNumber={activeWorktreeSummary?.prNumber ?? null}
          worktreePrState={activeWorktreeSummary?.prState ?? null}
          worktreePrIsDraft={activeWorktreeSummary?.prIsDraft ?? null}
          worktreeWorkItemProvider={activeWorktreeSummary?.workItemProvider ?? null}
          worktreeWorkItemKey={activeWorktreeSummary?.workItemKey ?? null}
          worktreeWorkItemState={activeWorktreeSummary?.workItemState ?? null}
          worktreeWorkItemStateName={activeWorktreeSummary?.workItemStateName ?? null}
          sessionTabs={activeWorktreeSessionTabs}
          activeSessionTabKey={activeSessionTabKey}
          onOpenLinkedWorktreeItem={handleOpenHeaderLinkedItem}
          onSelectSessionTab={handleSelectSessionTab}
          onPrefetchTabEnter={handleTabPrefetchEnter}
          onPrefetchTabLeave={handleTabPrefetchLeave}
          workspacePanelOpen={workspacePanelOpen}
          onToggleWorkspacePanel={onToggleWorkspacePanel}
          overviewSidebarOpen={overviewControlOpen}
          onToggleOverviewSidebar={toggleOverviewSidebar}
          onRunProjectScript={runProjectScript}
          onAddProjectScript={saveProjectScript}
          onUpdateProjectScript={updateProjectScript}
          onDeleteProjectScript={deleteProjectScript}
        />
      </header>
      <LinkedWorktreeItemDialog
        open={headerLinkedItem !== null}
        item={headerLinkedItem}
        environmentId={activeProject?.environmentId ?? activeThread.environmentId}
        projectId={activeProject?.id ?? activeThread.projectId}
        cwd={activeProject?.cwd ?? gitCwd}
        onOpenChange={handleHeaderLinkedItemDialogOpenChange}
      />

      {/* Error banner */}
      <ProviderStatusBanner status={activeProviderStatus} />
      <ThreadErrorBanner
        error={activeThread.error}
        onDismiss={() => setThreadError(activeThread.id, null)}
      />
      {/* Main content area with optional plan sidebar */}
      <div className="flex min-h-0 min-w-0 flex-1">
        {/* Chat column */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Messages Wrapper */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            {/* Messages — LegendList handles virtualization and scrolling internally.
                Gated on useDeferredValue: the urgent render after a tab switch
                paints the placeholder, then React commits the heavy timeline in
                a low-priority transition. */}
            {isActiveThreadIdFresh ? (
              <MessagesTimeline
                key={activeThread.id}
                isWorking={isWorking}
                activeTurnInProgress={isWorking || !latestTurnSettled}
                activeTurnId={activeLatestTurn?.turnId ?? null}
                activeTurnStartedAt={activeWorkStartedAt}
                listRef={legendListRef}
                timelineEntries={timelineEntries}
                completionDividerBeforeEntryId={completionDividerBeforeEntryId}
                completionSummary={completionSummary}
                turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
                activeThreadEnvironmentId={activeThread.environmentId}
                routeThreadKey={routeThreadKey}
                openDiffTurnId={diffOpen ? (rawSearch.diffTurnId ?? null) : null}
                onOpenTurnDiff={onOpenTurnDiff}
                onCloseDiff={onCloseDiff}
                revertTurnCountByUserMessageId={revertTurnCountByUserMessageId}
                onRevertUserMessage={onRevertUserMessage}
                isRevertingCheckpoint={isRevertingCheckpoint}
                onImageExpand={onExpandTimelineImage}
                onOpenContextAttachment={onOpenTimelineContextAttachment}
                markdownCwd={gitCwd ?? undefined}
                resolvedTheme={resolvedTheme}
                timestampFormat={timestampFormat}
                workspaceRoot={activeWorkspaceRoot}
                skills={activeProviderStatus?.skills ?? EMPTY_PROVIDER_SKILLS}
                onIsAtEndChange={onIsAtEndChange}
              />
            ) : (
              <div aria-hidden className="flex min-h-0 flex-1" />
            )}

            {renderFloatingOverviewSidebar ? (
              <FloatingOverviewMotionFrame
                animate={!prefersReducedMotion}
                open={showFloatingOverviewSidebar}
              >
                <ChatOverviewPanel
                  environmentId={environmentId}
                  gitCwd={gitCwd}
                  activeWorktreeBranch={activeWorktreeSummary?.branch ?? null}
                  activeThreadBranch={activeThread?.branch ?? null}
                  activeWorktreePrNumber={activeWorktreeSummary?.prNumber ?? null}
                  activeWorktreePrState={activeWorktreeSummary?.prState}
                  activeWorktreeTitle={activeWorktreeSummary?.title}
                  postPushWorkflowWatch={postPushWorkflowWatch}
                  activeThreadKey={activeThreadKey}
                  activeEnvironmentUnavailableState={activeEnvironmentUnavailableState}
                  activePlan={activePlan}
                  sidebarProposedPlan={sidebarProposedPlan}
                  threadSubagents={threadSubagents}
                  changedFileSummaries={activeThread?.turnDiffSummaries}
                  sourceControlActions={overviewSourceControlActions}
                  branchControl={overviewBranchControl}
                  markdownCwd={gitCwd ?? undefined}
                  workspaceRoot={activeWorkspaceRoot}
                  mode="floating"
                  onOpenFiles={onOpenFilesPanel}
                  onOpenReview={onOpenReviewPanel}
                  onOpenSubagent={onOpenSubagentPanel}
                  onPostPushDiscoveryComplete={clearPostPushWatch}
                />
              </FloatingOverviewMotionFrame>
            ) : null}

            {/* scroll to bottom pill — shown when user has scrolled away from the bottom */}
            {showScrollToBottom && (
              <div className="pointer-events-none absolute bottom-1 left-1/2 z-30 flex -translate-x-1/2 justify-center py-1.5">
                <button
                  type="button"
                  onClick={() => scrollToEnd(true)}
                  className="pointer-events-auto flex items-center gap-1.5 rounded-full border-0 bg-card/80 px-3 py-1 text-muted-foreground text-xs shadow-md/5 ring-1 ring-inset ring-foreground/6 backdrop-blur transition-[background-color,color,box-shadow] hover:bg-card hover:text-foreground hover:shadow-lg/8 hover:cursor-pointer"
                >
                  <ChevronDownIcon className="size-3.5" />
                  Scroll to bottom
                </button>
              </div>
            )}
          </div>

          {/* Input bar */}
          <div
            className={cn(
              "pl-[calc(env(safe-area-inset-left)+0.75rem)] pr-[calc(env(safe-area-inset-right)+0.75rem)] pt-1.5 sm:pl-[calc(env(safe-area-inset-left)+1.25rem)] sm:pr-[calc(env(safe-area-inset-right)+1.25rem)] sm:pt-2",
              isGitRepo
                ? "pb-[calc(env(safe-area-inset-bottom)+0.25rem)]"
                : "pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-[calc(env(safe-area-inset-bottom)+1rem)]",
            )}
          >
            <div className="relative isolate">
              <ComposerBannerStack className="relative z-0" items={composerBannerItems} />
              <ComposerHintRow
                visible={hintRowVisible}
                hasSourceControlRemote={hasSourceControlRemote}
                hasJiraProvider={hasJiraProvider}
                onInsertTrigger={handleInsertHintTrigger}
              />
              <div className="relative z-10">
                <ChatComposer
                  ref={composerRef}
                  composerDraftTarget={composerDraftTarget}
                  environmentId={environmentId}
                  routeKind={routeKind}
                  routeThreadRef={routeThreadRef}
                  draftId={draftId}
                  activeThreadId={activeThreadId}
                  activeThreadEnvironmentId={activeThread?.environmentId}
                  activeThreadSessionProviderInstanceId={activeThreadSessionProviderInstanceId}
                  isServerThread={isServerThread}
                  isLocalDraftThread={isLocalDraftThread}
                  phase={phase}
                  isConnecting={isConnecting}
                  isSendBusy={isSendBusy}
                  isPreparingWorktree={isPreparingWorktree}
                  environmentUnavailable={activeEnvironmentUnavailableState}
                  activePendingApproval={activePendingApproval}
                  pendingApprovals={pendingApprovals}
                  pendingUserInputs={pendingUserInputs}
                  activePendingProgress={activePendingProgress}
                  activePendingResolvedAnswers={activePendingResolvedAnswers}
                  activePendingIsResponding={activePendingIsResponding}
                  activePendingDraftAnswers={activePendingDraftAnswers}
                  activePendingQuestionIndex={activePendingQuestionIndex}
                  respondingRequestIds={respondingRequestIds}
                  showPlanFollowUpPrompt={showPlanFollowUpPrompt}
                  activeProposedPlan={activeProposedPlan}
                  activePlan={activePlan as { turnId?: TurnId } | null}
                  sidebarProposedPlan={sidebarProposedPlan as { turnId?: TurnId } | null}
                  planSidebarLabel={planSidebarLabel}
                  planSidebarOpen={overviewControlOpen}
                  runtimeMode={runtimeMode}
                  interactionMode={interactionMode}
                  tokenMode={tokenMode}
                  lockedProvider={lockedProvider}
                  providerStatuses={composerProviderStatuses}
                  activeProjectDefaultModelSelection={activeProject?.defaultModelSelection}
                  activeThreadModelSelection={activeThread?.modelSelection}
                  activeThreadActivities={threadActivities}
                  resolvedTheme={resolvedTheme}
                  settings={settings}
                  keybindings={keybindings}
                  terminalOpen={Boolean(terminalState.terminalOpen)}
                  gitCwd={gitCwd}
                  activeProjectId={activeProject?.id ?? null}
                  hasJiraProvider={hasJiraProvider}
                  promptRef={promptRef}
                  composerImagesRef={composerImagesRef}
                  composerTerminalContextsRef={composerTerminalContextsRef}
                  shouldAutoScrollRef={isAtEndRef}
                  scheduleStickToBottom={scrollToEnd}
                  onSend={onSend}
                  onInterrupt={onInterrupt}
                  onImplementPlanInNewThread={onImplementPlanInNewThread}
                  onRespondToApproval={onRespondToApproval}
                  onSelectActivePendingUserInputOption={onSelectActivePendingUserInputOption}
                  onAdvanceActivePendingUserInput={onAdvanceActivePendingUserInput}
                  onPreviousActivePendingUserInputQuestion={
                    onPreviousActivePendingUserInputQuestion
                  }
                  onChangeActivePendingUserInputCustomAnswer={
                    onChangeActivePendingUserInputCustomAnswer
                  }
                  onProviderModelSelect={onProviderModelSelect}
                  toggleInteractionMode={toggleInteractionMode}
                  handleRuntimeModeChange={handleRuntimeModeChange}
                  handleInteractionModeChange={handleInteractionModeChange}
                  handleTokenModeChange={handleTokenModeChange}
                  togglePlanSidebar={toggleOverviewSidebar}
                  focusComposer={focusComposer}
                  scheduleComposerFocus={scheduleComposerFocus}
                  setThreadError={setThreadError}
                  onExpandImage={onExpandTimelineImage}
                />
              </div>
            </div>
            {isGitRepo && (
              <BranchToolbar
                environmentId={activeThread.environmentId}
                threadId={activeThread.id}
                {...(routeKind === "draft" && draftId ? { draftId } : {})}
                {...(canOverrideServerThreadBranch
                  ? {
                      activeThreadBranchOverride: activeThreadBranch,
                      onActiveThreadBranchOverrideChange: setPendingServerThreadBranch,
                    }
                  : {})}
                envLocked={envLocked}
                onComposerFocusRequest={scheduleComposerFocus}
                {...(canCheckoutPullRequestIntoThread
                  ? { onCheckoutPullRequestRequest: openPullRequestDialog }
                  : {})}
                {...(hasMultipleEnvironments ? { onEnvironmentChange } : {})}
                availableEnvironments={logicalProjectEnvironments}
                terminalAvailable={activeProject !== undefined}
                terminalOpen={terminalState.terminalOpen}
                terminalToggleShortcutLabel={terminalToggleShortcutLabel}
                onToggleTerminal={toggleTerminalVisibility}
                terminalCount={terminalState.terminalIds.length}
              />
            )}
          </div>

          {pullRequestDialogState ? (
            <PullRequestThreadDialog
              key={pullRequestDialogState.key}
              open
              environmentId={activeThread.environmentId}
              projectId={activeProject?.id ?? null}
              threadId={activeThread.id}
              cwd={activeProject?.cwd ?? null}
              initialReference={pullRequestDialogState.initialReference}
              onOpenChange={(open) => {
                if (!open) {
                  closePullRequestDialog();
                }
              }}
              onPrepared={handlePreparedPullRequestThread}
            />
          ) : null}
          <NewWorktreeDialog
            open={projectExplorerOpen}
            environmentId={activeThread.environmentId}
            projectId={activeProject?.id ?? null}
            cwd={activeProject?.cwd ?? null}
            initialTab={projectExplorerInitialTab}
            onCreated={(result) => {
              void navigate({
                to: "/$environmentId/$threadId",
                params: {
                  environmentId: activeThread.environmentId,
                  threadId: result.sessionId,
                },
              });
            }}
            onOpenChange={setProjectExplorerOpen}
          />
        </div>
        {/* end chat column */}
        {renderInlineOverviewSidebar ? (
          <OverviewSidebarMotionFrame
            animate={!prefersReducedMotion}
            open={showInlineOverviewSidebar}
          >
            <ChatOverviewPanel
              environmentId={environmentId}
              gitCwd={gitCwd}
              activeWorktreeBranch={activeWorktreeSummary?.branch ?? null}
              activeThreadBranch={activeThread?.branch ?? null}
              activeWorktreePrNumber={activeWorktreeSummary?.prNumber ?? null}
              activeWorktreePrState={activeWorktreeSummary?.prState}
              activeWorktreeTitle={activeWorktreeSummary?.title}
              postPushWorkflowWatch={postPushWorkflowWatch}
              activeThreadKey={activeThreadKey}
              activeEnvironmentUnavailableState={activeEnvironmentUnavailableState}
              activePlan={activePlan}
              sidebarProposedPlan={sidebarProposedPlan}
              threadSubagents={threadSubagents}
              changedFileSummaries={activeThread?.turnDiffSummaries}
              sourceControlActions={overviewSourceControlActions}
              branchControl={overviewBranchControl}
              markdownCwd={gitCwd ?? undefined}
              workspaceRoot={activeWorkspaceRoot}
              mode="sidebar"
              onOpenFiles={onOpenFilesPanel}
              onOpenReview={onOpenReviewPanel}
              onOpenSubagent={onOpenSubagentPanel}
              onPostPushDiscoveryComplete={clearPostPushWatch}
            />
          </OverviewSidebarMotionFrame>
        ) : null}
      </div>
      {/* end horizontal flex container */}

      {mountedTerminalThreadRefs.map(({ key: mountedThreadKey, threadRef: mountedThreadRef }) => (
        <PersistentThreadTerminalDrawer
          key={mountedThreadKey}
          threadRef={mountedThreadRef}
          threadId={mountedThreadRef.threadId}
          visible={mountedThreadKey === activeThreadKey && terminalState.terminalOpen}
          launchContext={
            mountedThreadKey === activeThreadKey ? (activeTerminalLaunchContext ?? null) : null
          }
          focusRequestId={mountedThreadKey === activeThreadKey ? terminalFocusRequestId : 0}
          splitShortcutLabel={splitTerminalShortcutLabel ?? undefined}
          newShortcutLabel={newTerminalShortcutLabel ?? undefined}
          closeShortcutLabel={closeTerminalShortcutLabel ?? undefined}
          keybindings={keybindings}
          onAddTerminalContext={addTerminalContextToDraft}
        />
      ))}
      {shouldUsePlanSidebarSheet ? (
        <RightPanelSheet open={showOverviewSidebarSheet} onClose={closePlanSidebar}>
          <ChatOverviewPanel
            environmentId={environmentId}
            gitCwd={gitCwd}
            activeWorktreeBranch={activeWorktreeSummary?.branch ?? null}
            activeThreadBranch={activeThread?.branch ?? null}
            activeWorktreePrNumber={activeWorktreeSummary?.prNumber ?? null}
            activeWorktreePrState={activeWorktreeSummary?.prState}
            activeWorktreeTitle={activeWorktreeSummary?.title}
            postPushWorkflowWatch={postPushWorkflowWatch}
            activeThreadKey={activeThreadKey}
            activeEnvironmentUnavailableState={activeEnvironmentUnavailableState}
            activePlan={activePlan}
            sidebarProposedPlan={sidebarProposedPlan}
            threadSubagents={threadSubagents}
            changedFileSummaries={activeThread?.turnDiffSummaries}
            sourceControlActions={overviewSourceControlActions}
            branchControl={overviewBranchControl}
            markdownCwd={gitCwd ?? undefined}
            workspaceRoot={activeWorkspaceRoot}
            mode="sheet"
            onOpenFiles={onOpenFilesPanel}
            onOpenReview={onOpenReviewPanel}
            onOpenSubagent={onOpenSubagentPanel}
            onPostPushDiscoveryComplete={clearPostPushWatch}
          />
        </RightPanelSheet>
      ) : null}

      {expandedImage && (
        <ExpandedImageDialog preview={expandedImage} onClose={closeExpandedImage} />
      )}
    </div>
  );
}
