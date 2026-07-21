import type {
  ApprovalRequestId,
  ComposerSourceControlContext,
  EnvironmentId,
  ModelSelection,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  ResolvedKeybindingsConfig,
  RuntimeMode,
  AgentTokenMode,
  ScopedThreadRef,
  ServerProvider,
  ThreadId,
  TurnId,
} from "@ryco/contracts";
import { ProviderDriverKind, ProviderInstanceId } from "@ryco/contracts";
import { createModelSelection, normalizeModelSlug } from "@ryco/shared/model";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clampCollapsedComposerCursor,
  type ComposerTrigger,
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  replaceTextRange,
} from "../../composer-logic";
import { serializeComposerMentionPath } from "../../composerMentionSyntax";
import { readFileAsDataUrl } from "../ChatView.logic";
import {
  deriveComposerFooterActionLayoutKey,
  deriveComposerSendState,
  isComposerPrimaryActionDisabled,
  shouldBlurComposerOnSubmit,
} from "./ComposerSendPipeline";
import { ComposerFooter } from "./ComposerFooter";
import {
  type ComposerImageAttachment,
  type DraftId,
  type PersistedComposerImageAttachment,
  useComposerDraftStore,
} from "../../composerDraftStore";
import {
  useComposerThreadDraft,
  useEffectiveComposerModelState,
} from "../../composerDraftSelectors";
import {
  useComposerAttachmentMenus,
  useComposerSourceControlContextSelection,
} from "./ComposerAttachmentMenus";
import { useSourceControlDiscovery } from "~/lib/sourceControlDiscoveryState";
import {
  type TerminalContextDraft,
  type TerminalContextSelection,
  insertInlineTerminalContextPlaceholder,
  removeInlineTerminalContextPlaceholder,
} from "../../lib/terminalContext";
import {
  shouldUseCompactComposerPrimaryActions,
  shouldUseCompactComposerFooter,
} from "../composerFooterLayout";
import { type ComposerPromptEditorHandle } from "../ComposerPromptEditor";
import { type ComposerCommandItem } from "./ComposerCommandMenu";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { ApprovalCard } from "./ApprovalCard";
import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";
import { ComposerPlanFollowUpBanner } from "./ComposerPlanFollowUpBanner";
import { resolveComposerMenuActiveItemId } from "./composerMenuHighlight";
import {
  getComposerProviderState,
  renderProviderTraitsChips,
  renderProviderTraitsMenuContent,
} from "./composerProviderState";
import { type ExpandedImagePreview } from "./ExpandedImagePreview";
import { ComposerPromptShell } from "./ComposerPromptShell";
import { useComposerImageAttachments } from "./useComposerImageAttachments";
import { cn, randomUUID } from "~/lib/utils";
import { proposedPlanTitle } from "../../proposedPlan";
import { getProviderInteractionModeToggle, getProviderSupportsAskMode } from "../../providerModels";
import {
  deriveProviderInstanceEntries,
  resolveProviderDriverKindForInstanceSelection,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { type AppModelOption, getAppModelOptionsForInstance } from "../../modelSelection";
import type { UnifiedSettings } from "@ryco/contracts/settings";
import type { SessionPhase, Thread } from "../../types";
import type { PendingUserInputDraftAnswer } from "../../pendingUserInput";
import type { PendingApproval, PendingUserInput } from "../../session-logic";
import { deriveLatestContextWindowSnapshot } from "../../lib/contextWindow";
import { usePresentationTier } from "../../hooks/usePresentationTier";

const COMPOSER_FLOATING_LAYER_SELECTOR = [
  '[data-slot="popover-popup"]',
  '[data-slot="menu-popup"]',
  '[data-slot="select-popup"]',
  '[data-slot="combobox-popup"]',
  '[data-slot="autocomplete-popup"]',
].join(",");

const extendReplacementRangeForTrailingSpace = (
  text: string,
  rangeEnd: number,
  replacement: string,
): number => {
  if (!replacement.endsWith(" ")) {
    return rangeEnd;
  }
  return text[rangeEnd] === " " ? rangeEnd + 1 : rangeEnd;
};

const syncTerminalContextsByIds = (
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>,
): TerminalContextDraft[] => {
  const contextsById = new Map(contexts.map((context) => [context.id, context]));
  return ids.flatMap((id) => {
    const context = contextsById.get(id);
    return context ? [context] : [];
  });
};

const terminalContextIdListsEqual = (
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>,
): boolean =>
  contexts.length === ids.length && contexts.every((context, index) => context.id === ids[index]);

function isInsideComposerFloatingLayer(element: Element): boolean {
  return element.closest(COMPOSER_FLOATING_LAYER_SELECTOR) !== null;
}

// --------------------------------------------------------------------------
// Handle exposed to ChatView
// --------------------------------------------------------------------------

export interface ChatComposerHandle {
  focusAtEnd: () => void;
  focusAt: (cursor: number) => void;
  openModelPicker: () => void;
  toggleModelPicker: () => void;
  isModelPickerOpen: () => boolean;
  readSnapshot: () => {
    value: string;
    cursor: number;
    expandedCursor: number;
    terminalContextIds: string[];
  };
  /** Reset composer cursor/trigger/highlight after external prompt mutations (e.g. onSend). */
  resetCursorState: (options?: {
    cursor?: number;
    prompt?: string;
    detectTrigger?: boolean;
  }) => void;
  /** Insert a terminal context from the terminal drawer. */
  addTerminalContext: (selection: TerminalContextSelection) => void;
  /**
   * Inserts trigger text (e.g. "#i ", "#pr ", "#jira ", "/") at the current
   * cursor position, focuses the editor, and lets detectComposerTrigger pick
   * up the new trigger so the inline picker opens as if the user had typed
   * the same keys.
   */
  insertTriggerAtCursor: (text: string) => void;
  /** Get the current prompt/effort/model state for use in send. */
  getSendContext: () => {
    prompt: string;
    images: ComposerImageAttachment[];
    terminalContexts: TerminalContextDraft[];
    sourceControlContexts: ComposerSourceControlContext[];
    selectedPromptEffort: string | null;
    selectedModelOptionsForDispatch: unknown;
    selectedModelSelection: ModelSelection;
    selectedProvider: ProviderDriverKind;
    selectedModel: string;
    selectedProviderModels: ReadonlyArray<ServerProvider["models"][number]>;
  };
}

// --------------------------------------------------------------------------
// Props
// --------------------------------------------------------------------------

export interface ChatComposerProps {
  composerDraftTarget: ScopedThreadRef | DraftId;
  environmentId: EnvironmentId;
  routeKind: "server" | "draft";
  routeThreadRef: ScopedThreadRef;
  draftId: DraftId | null;

  // Thread context
  activeThreadId: ThreadId | null;
  activeThreadEnvironmentId: EnvironmentId | undefined;
  activeThreadSessionProviderInstanceId: ProviderInstanceId | null | undefined;
  isServerThread: boolean;
  isLocalDraftThread: boolean;

  // Session phase
  phase: SessionPhase;
  isConnecting: boolean;
  isSendBusy: boolean;
  isPreparingWorktree: boolean;
  environmentUnavailable: {
    readonly label: string;
    readonly connectionState: "connecting" | "disconnected" | "error";
  } | null;

  // Pending approvals / inputs
  activePendingApproval: PendingApproval | null;
  pendingApprovals: PendingApproval[];
  pendingUserInputs: PendingUserInput[];
  activePendingProgress: {
    questionIndex: number;
    isLastQuestion: boolean;
    canAdvance: boolean;
    customAnswer: string;
    activeQuestion: { id: string; multiSelect?: boolean | undefined } | null;
  } | null;
  activePendingResolvedAnswers: Record<string, unknown> | null;
  activePendingIsResponding: boolean;
  activePendingDraftAnswers: Record<string, PendingUserInputDraftAnswer>;
  activePendingQuestionIndex: number;
  respondingRequestIds: ApprovalRequestId[];

  // Plan
  showPlanFollowUpPrompt: boolean;
  activeProposedPlan: Thread["proposedPlans"][number] | null;
  activePlan: { turnId?: TurnId } | null;
  sidebarProposedPlan: { turnId?: TurnId } | null;
  planSidebarLabel: string;
  planSidebarOpen: boolean;

  // Mode
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  tokenMode: AgentTokenMode;

  // Provider / model
  lockedProvider: ProviderDriverKind | null;
  providerStatuses: ServerProvider[];
  activeProjectDefaultModelSelection: ModelSelection | null | undefined;
  activeThreadModelSelection: ModelSelection | null | undefined;

  // Context window
  activeThreadActivities: Thread["activities"] | undefined;

  // Misc
  resolvedTheme: "light" | "dark";
  settings: UnifiedSettings;
  keybindings: ResolvedKeybindingsConfig;
  terminalOpen: boolean;
  gitCwd: string | null;

  // Refs the parent needs kept in sync
  promptRef: React.MutableRefObject<string>;
  composerImagesRef: React.MutableRefObject<ComposerImageAttachment[]>;
  composerTerminalContextsRef: React.MutableRefObject<TerminalContextDraft[]>;

  // Scroll
  shouldAutoScrollRef: React.MutableRefObject<boolean>;
  scheduleStickToBottom: () => void;

  // Callbacks
  onSend: (e?: { preventDefault: () => void }) => void;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<void>;
  onSelectActivePendingUserInputOption: (questionId: string, optionLabel: string) => void;
  onAdvanceActivePendingUserInput: () => void;
  onPreviousActivePendingUserInputQuestion: () => void;
  onChangeActivePendingUserInputCustomAnswer: (
    questionId: string,
    value: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
  ) => void;

  onProviderModelSelect: (instanceId: ProviderInstanceId, model: string) => void;
  toggleInteractionMode: () => void;
  handleRuntimeModeChange: (mode: RuntimeMode) => void;
  handleInteractionModeChange: (mode: ProviderInteractionMode) => void;
  handleTokenModeChange: (mode: AgentTokenMode) => void;
  togglePlanSidebar: () => void;

  focusComposer: () => void;
  scheduleComposerFocus: () => void;
  setThreadError: (threadId: ThreadId | null, error: string | null) => void;
  onExpandImage: (preview: ExpandedImagePreview) => void;
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export const ChatComposer = memo(
  forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposer(props, ref) {
    const {
      composerDraftTarget,
      environmentId,
      routeKind,
      routeThreadRef,
      draftId,
      activeThreadId,
      activeThreadEnvironmentId: _activeThreadEnvironmentId,
      activeThreadSessionProviderInstanceId,
      isServerThread: _isServerThread,
      isLocalDraftThread: _isLocalDraftThread,
      phase,
      isConnecting,
      isSendBusy,
      isPreparingWorktree,
      environmentUnavailable,
      activePendingApproval,
      pendingApprovals,
      pendingUserInputs,
      activePendingProgress,
      activePendingResolvedAnswers,
      activePendingIsResponding,
      activePendingDraftAnswers,
      activePendingQuestionIndex,
      respondingRequestIds,
      showPlanFollowUpPrompt,
      activeProposedPlan,
      planSidebarLabel,
      planSidebarOpen,
      runtimeMode,
      interactionMode,
      tokenMode,
      lockedProvider,
      providerStatuses,
      activeProjectDefaultModelSelection,
      activeThreadModelSelection,
      activeThreadActivities,
      resolvedTheme,
      settings,
      keybindings,
      terminalOpen,
      gitCwd,
      promptRef,
      composerImagesRef,
      composerTerminalContextsRef,
      shouldAutoScrollRef,
      scheduleStickToBottom,
      onSend,
      onInterrupt,
      onImplementPlanInNewThread,
      onRespondToApproval,
      onSelectActivePendingUserInputOption,
      onAdvanceActivePendingUserInput,
      onPreviousActivePendingUserInputQuestion,
      onChangeActivePendingUserInputCustomAnswer,
      onProviderModelSelect,
      toggleInteractionMode,
      handleRuntimeModeChange,
      handleInteractionModeChange,
      handleTokenModeChange,
      togglePlanSidebar,
      focusComposer,
      scheduleComposerFocus,
      setThreadError,
      onExpandImage,
    } = props;

    // ------------------------------------------------------------------
    // Store subscriptions (prompt / images / terminal contexts)
    // ------------------------------------------------------------------
    const composerDraft = useComposerThreadDraft(composerDraftTarget);
    const prompt = composerDraft.prompt;
    const composerImages = composerDraft.images;
    const composerTerminalContexts = composerDraft.terminalContexts;
    const composerSourceControlContexts = composerDraft.sourceControlContexts;
    const nonPersistedComposerImageIds = composerDraft.nonPersistedImageIds;

    const sourceControlDiscovery = useSourceControlDiscovery();
    const hasSourceControlRemote = useMemo(
      () =>
        (sourceControlDiscovery.data?.sourceControlProviders ?? []).some(
          (provider) =>
            provider.status === "available" &&
            (provider.auth.status === "authenticated" || provider.auth.status === "unknown"),
        ),
      [sourceControlDiscovery.data],
    );

    const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
    const insertComposerDraftTerminalContext = useComposerDraftStore(
      (store) => store.insertTerminalContext,
    );
    const removeComposerDraftTerminalContext = useComposerDraftStore(
      (store) => store.removeTerminalContext,
    );
    const setComposerDraftTerminalContexts = useComposerDraftStore(
      (store) => store.setTerminalContexts,
    );
    const clearComposerDraftPersistedAttachments = useComposerDraftStore(
      (store) => store.clearPersistedAttachments,
    );
    const syncComposerDraftPersistedAttachments = useComposerDraftStore(
      (store) => store.syncPersistedAttachments,
    );
    const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);
    const addSourceControlContextToDraft = useComposerDraftStore(
      (store) => store.addSourceControlContext,
    );
    const removeSourceControlContextFromDraft = useComposerDraftStore(
      (store) => store.removeSourceControlContext,
    );

    // ------------------------------------------------------------------
    // Model state
    // ------------------------------------------------------------------
    // Instance-aware projection of the wire provider list. One entry per
    // configured instance (default built-in + any custom `providerInstances.*`),
    // sorted default-first per driver kind for a stable picker order.
    const providerInstanceEntries = useMemo<ReadonlyArray<ProviderInstanceEntry>>(
      () => sortProviderInstanceEntries(deriveProviderInstanceEntries(providerStatuses)),
      [providerStatuses],
    );
    const selectedProviderByThreadId = composerDraft.activeProvider ?? null;
    const threadProvider =
      activeThreadSessionProviderInstanceId ??
      activeThreadModelSelection?.instanceId ??
      activeProjectDefaultModelSelection?.instanceId ??
      null;
    const explicitSelectedInstanceId = selectedProviderByThreadId ?? threadProvider;

    const unlockedSelectedProvider =
      resolveProviderDriverKindForInstanceSelection(
        providerInstanceEntries,
        providerStatuses,
        explicitSelectedInstanceId,
      ) ?? ProviderDriverKind.make("codex");
    const selectedProvider: ProviderDriverKind = lockedProvider ?? unlockedSelectedProvider;
    const lockedContinuationGroupKey = useMemo((): string | null => {
      if (!lockedProvider) return null;
      const lockedInstanceId =
        activeThreadSessionProviderInstanceId ?? activeThreadModelSelection?.instanceId;
      if (!lockedInstanceId) return null;
      return (
        providerInstanceEntries.find((entry) => entry.instanceId === lockedInstanceId)
          ?.continuationGroupKey ?? null
      );
    }, [
      activeThreadModelSelection?.instanceId,
      activeThreadSessionProviderInstanceId,
      lockedProvider,
      providerInstanceEntries,
    ]);

    // Resolve which configured instance the composer is currently targeting.
    // Priority:
    //   1. The composer draft's `activeProvider` — the user's unsaved pick
    //      from the model picker (must win, otherwise the UI appears to
    //      ignore picker selections).
    //   2. Thread's persisted instance id (server-side saved selection).
    //   3. Project default's instance id.
    //   4. First enabled entry matching the current driver kind.
    //   5. First enabled entry overall / default instance for the kind.
    //
    const selectedInstanceId = useMemo<ProviderInstanceId>(() => {
      const candidates: Array<string | null | undefined> = [
        composerDraft.activeProvider,
        activeThreadSessionProviderInstanceId,
        activeThreadModelSelection?.instanceId,
        activeProjectDefaultModelSelection?.instanceId,
      ];
      for (const candidate of candidates) {
        if (!candidate) continue;
        const match = providerInstanceEntries.find(
          (entry) => entry.instanceId === candidate && entry.enabled,
        );
        if (match) {
          // When locked to a specific driver kind, ignore persisted instance
          // ids from a different kind or continuation group.
          if (lockedProvider && match.driverKind !== lockedProvider) continue;
          if (
            lockedContinuationGroupKey &&
            match.continuationGroupKey !== lockedContinuationGroupKey
          ) {
            continue;
          }
          return match.instanceId;
        }
      }
      if (explicitSelectedInstanceId) {
        return ProviderInstanceId.make(explicitSelectedInstanceId);
      }
      const byKind = providerInstanceEntries.find(
        (entry) =>
          entry.enabled &&
          entry.driverKind === selectedProvider &&
          (!lockedContinuationGroupKey ||
            entry.continuationGroupKey === lockedContinuationGroupKey),
      );
      if (byKind) return byKind.instanceId;
      const anyEnabled = providerInstanceEntries.find((entry) => entry.enabled);
      return (
        anyEnabled?.instanceId ??
        providerInstanceEntries[0]?.instanceId ??
        activeThreadModelSelection?.instanceId ??
        activeProjectDefaultModelSelection?.instanceId ??
        ProviderInstanceId.make("codex")
      );
    }, [
      activeProjectDefaultModelSelection?.instanceId,
      activeThreadSessionProviderInstanceId,
      activeThreadModelSelection?.instanceId,
      composerDraft.activeProvider,
      explicitSelectedInstanceId,
      lockedContinuationGroupKey,
      lockedProvider,
      providerInstanceEntries,
      selectedProvider,
    ]);

    const { modelOptions: composerModelOptions, selectedModel } = useEffectiveComposerModelState({
      threadRef: composerDraftTarget,
      providers: providerStatuses,
      selectedProvider,
      selectedInstanceId,
      threadModelSelection: activeThreadModelSelection,
      projectModelSelection: activeProjectDefaultModelSelection,
      settings,
    });

    // Resolve the active instance's snapshot by `instanceId` so a custom
    // instance gets its own slash commands, skills, and model list — not
    // the first snapshot for the same driver kind.
    const selectedProviderEntry = useMemo(
      () => providerInstanceEntries.find((entry) => entry.instanceId === selectedInstanceId),
      [providerInstanceEntries, selectedInstanceId],
    );
    const selectedProviderStatus = useMemo(
      () => selectedProviderEntry?.snapshot ?? null,
      [selectedProviderEntry],
    );
    const selectedProviderModels = useMemo<ReadonlyArray<ServerProvider["models"][number]>>(
      () => selectedProviderEntry?.models ?? [],
      [selectedProviderEntry],
    );

    const composerProviderState = useMemo(
      () =>
        getComposerProviderState({
          provider: selectedProvider,
          model: selectedModel,
          models: selectedProviderModels,
          prompt,
          modelOptions: composerModelOptions?.[selectedInstanceId],
        }),
      [
        composerModelOptions,
        prompt,
        selectedInstanceId,
        selectedModel,
        selectedProvider,
        selectedProviderModels,
      ],
    );

    const selectedPromptEffort = composerProviderState.promptEffort;
    const selectedModelOptionsForDispatch = composerProviderState.modelOptionsForDispatch;
    const composerProviderControls = useMemo(
      () => ({
        showInteractionModeToggle: getProviderInteractionModeToggle(
          providerStatuses,
          selectedProvider,
        ),
        askModeSupported: getProviderSupportsAskMode(providerStatuses, selectedProvider),
      }),
      [providerStatuses, selectedProvider],
    );
    const selectedModelSelection = useMemo<ModelSelection>(
      () =>
        createModelSelection(selectedInstanceId, selectedModel, selectedModelOptionsForDispatch),
      [selectedInstanceId, selectedModel, selectedModelOptionsForDispatch],
    );
    const selectedModelForPicker = selectedModel;
    // Instance-keyed option list so the picker can show each configured
    // instance (built-in + custom) as a first-class sidebar entry. The
    // options are server-reported models plus that exact instance's
    // configured custom models; selected slugs are not injected into lists.
    const modelOptionsByInstance = useMemo<
      ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>
    >(() => {
      const out = new Map<ProviderInstanceId, ReadonlyArray<AppModelOption>>();
      for (const entry of providerInstanceEntries) {
        out.set(entry.instanceId, getAppModelOptionsForInstance(settings, entry));
      }
      return out;
    }, [providerInstanceEntries, settings]);
    const selectedModelForPickerWithCustomFallback = useMemo(() => {
      const currentOptions = modelOptionsByInstance.get(selectedInstanceId) ?? [];
      return currentOptions.some((option) => option.slug === selectedModelForPicker)
        ? selectedModelForPicker
        : (normalizeModelSlug(selectedModelForPicker, selectedProvider) ?? selectedModelForPicker);
    }, [modelOptionsByInstance, selectedInstanceId, selectedModelForPicker, selectedProvider]);

    // ------------------------------------------------------------------
    // Context window
    // ------------------------------------------------------------------
    const activeContextWindow = useMemo(
      () => deriveLatestContextWindowSnapshot(activeThreadActivities ?? []),
      [activeThreadActivities],
    );
    const contextWindowRateLimits = selectedProviderStatus?.rateLimits;

    // ------------------------------------------------------------------
    // Composer-local state
    // ------------------------------------------------------------------
    const [composerCursor, setComposerCursor] = useState(() =>
      collapseExpandedComposerCursor(prompt, prompt.length),
    );
    const [composerTrigger, setComposerTrigger] = useState<ComposerTrigger | null>(() =>
      detectComposerTrigger(prompt, prompt.length),
    );
    const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null);
    const [composerHighlightedSearchKey, setComposerHighlightedSearchKey] = useState<string | null>(
      null,
    );
    const [isComposerFooterCompact, setIsComposerFooterCompact] = useState(false);
    const [isComposerPrimaryActionsCompact, setIsComposerPrimaryActionsCompact] = useState(false);
    const [isComposerModelPickerOpen, setIsComposerModelPickerOpen] = useState(false);
    const [isComposerFocused, setIsComposerFocused] = useState(false);
    // The collapse-to-pill behavior follows the presentation tier (not the
    // old <640 px query), so 640-767 px viewports and coarse-pointer
    // landscape phones collapse consistently with the rest of the phone UI.
    const isMobileViewport = usePresentationTier() === "phone";
    const isComposerCollapsedMobile = isMobileViewport && !isComposerFocused;

    // ------------------------------------------------------------------
    // Refs
    // ------------------------------------------------------------------
    const composerEditorRef = useRef<ComposerPromptEditorHandle>(null);
    const composerFormRef = useRef<HTMLFormElement>(null);
    const composerSurfaceRef = useRef<HTMLDivElement>(null);
    const composerFormHeightRef = useRef(0);
    const composerSelectLockRef = useRef(false);
    const composerMenuOpenRef = useRef(false);
    const composerMenuItemsRef = useRef<ComposerCommandItem[]>([]);
    const activeComposerMenuItemRef = useRef<ComposerCommandItem | null>(null);
    const composerBlurFrameRef = useRef<number | null>(null);

    // ------------------------------------------------------------------
    // Derived: composer send state
    // ------------------------------------------------------------------
    const composerSendState = useMemo(
      () =>
        deriveComposerSendState({
          prompt,
          imageCount: composerImages.length,
          terminalContexts: composerTerminalContexts,
          sourceControlContexts: composerSourceControlContexts,
        }),
      [composerImages.length, composerSourceControlContexts, composerTerminalContexts, prompt],
    );

    // ------------------------------------------------------------------
    // Derived: composer trigger / menu
    // ------------------------------------------------------------------
    const composerTriggerKind = composerTrigger?.kind ?? null;
    const {
      composerMenuItems,
      composerMenuOpen,
      composerMenuSearchKey,
      activeComposerMenuItem,
      isComposerMenuLoading,
      composerMenuEmptyState,
    } = useComposerAttachmentMenus({
      composerTrigger,
      environmentId,
      gitCwd,
      selectedProvider,
      selectedProviderStatus,
      composerHighlightedItemId,
      composerHighlightedSearchKey,
    });

    composerMenuOpenRef.current = composerMenuOpen;
    composerMenuItemsRef.current = composerMenuItems;
    activeComposerMenuItemRef.current = activeComposerMenuItem;

    const nonPersistedComposerImageIdSet = useMemo(
      () => new Set(nonPersistedComposerImageIds),
      [nonPersistedComposerImageIds],
    );

    const isComposerApprovalState = activePendingApproval !== null;
    const activePendingUserInput = pendingUserInputs[0] ?? null;
    const hasComposerHeader =
      isComposerApprovalState ||
      pendingUserInputs.length > 0 ||
      (showPlanFollowUpPrompt && activeProposedPlan !== null);
    // Presentation flag only: the collapsed editor is the same always-mounted
    // editor, so this decides whether the compact send affordance renders
    // beside it — nothing is swapped in or out.
    const showCollapsedMobileSendAction =
      isComposerCollapsedMobile && !isComposerApprovalState && pendingUserInputs.length === 0;
    // A disabled editor is not editable, so it cannot receive the activating
    // tap at all. The collapsed surface needs an explicit expand path in that
    // state (see the surface onClick below).
    const isComposerEditorDisabled =
      isConnecting ||
      isComposerApprovalState ||
      (environmentUnavailable !== null && activePendingProgress === null);

    const composerFooterHasWideActions = showPlanFollowUpPrompt || activePendingProgress !== null;
    const showPlanSidebarToggle = false;
    const composerFooterActionLayoutKey = useMemo(
      () =>
        deriveComposerFooterActionLayoutKey({
          pendingProgress: activePendingProgress,
          pendingIsResponding: activePendingIsResponding,
          phase,
          showPlanFollowUpPrompt,
          promptHasText: prompt.trim().length > 0,
          hasSendableContent: composerSendState.hasSendableContent,
          isSendBusy,
          isConnecting,
          isPreparingWorktree,
        }),
      [
        activePendingIsResponding,
        activePendingProgress,
        composerSendState.hasSendableContent,
        isConnecting,
        isPreparingWorktree,
        isSendBusy,
        phase,
        prompt,
        showPlanFollowUpPrompt,
      ],
    );

    // ------------------------------------------------------------------
    // Provider traits UI
    // ------------------------------------------------------------------
    const setPromptFromTraits = useCallback(
      (nextPrompt: string) => {
        if (nextPrompt === promptRef.current) {
          scheduleComposerFocus();
          return;
        }
        promptRef.current = nextPrompt;
        setComposerDraftPrompt(composerDraftTarget, nextPrompt);
        const nextCursor = collapseExpandedComposerCursor(nextPrompt, nextPrompt.length);
        setComposerCursor(nextCursor);
        setComposerTrigger(detectComposerTrigger(nextPrompt, nextPrompt.length));
        scheduleComposerFocus();
      },
      [composerDraftTarget, promptRef, scheduleComposerFocus, setComposerDraftPrompt],
    );

    const providerTraitsMenuContent = renderProviderTraitsMenuContent({
      provider: selectedProvider,
      instanceId: selectedInstanceId,
      ...(routeKind === "server" ? { threadRef: routeThreadRef } : {}),
      ...(routeKind === "draft" && draftId ? { draftId } : {}),
      model: selectedModel,
      models: selectedProviderModels,
      modelOptions: composerModelOptions?.[selectedInstanceId],
      prompt,
      onPromptChange: setPromptFromTraits,
    });
    const providerTraitsChips = renderProviderTraitsChips({
      provider: selectedProvider,
      instanceId: selectedInstanceId,
      ...(routeKind === "server" ? { threadRef: routeThreadRef } : {}),
      ...(routeKind === "draft" && draftId ? { draftId } : {}),
      model: selectedModel,
      models: selectedProviderModels,
      modelOptions: composerModelOptions?.[selectedInstanceId],
      prompt,
      onPromptChange: setPromptFromTraits,
    });
    const pendingPrimaryAction = useMemo(
      () =>
        activePendingProgress
          ? {
              questionIndex: activePendingProgress.questionIndex,
              isLastQuestion: activePendingProgress.isLastQuestion,
              canAdvance: activePendingProgress.canAdvance,
              isResponding: activePendingIsResponding,
              isComplete: Boolean(activePendingResolvedAnswers),
            }
          : null,
      [activePendingIsResponding, activePendingProgress, activePendingResolvedAnswers],
    );
    const collapsedComposerPrimaryActionDisabled = isComposerPrimaryActionDisabled({
      phase,
      isSendBusy,
      isConnecting,
      hasSendableContent: composerSendState.hasSendableContent,
    });
    const collapsedComposerPrimaryActionLabel = "Send message";
    const showMobilePendingAnswerActions =
      isMobileViewport && !isComposerCollapsedMobile && pendingPrimaryAction !== null;

    // ------------------------------------------------------------------
    // Prompt helpers
    // ------------------------------------------------------------------
    const setPrompt = useCallback(
      (nextPrompt: string) => {
        setComposerDraftPrompt(composerDraftTarget, nextPrompt);
      },
      [composerDraftTarget, setComposerDraftPrompt],
    );

    const removeComposerTerminalContextFromDraft = useCallback(
      (contextId: string) => {
        const contextIndex = composerTerminalContexts.findIndex(
          (context) => context.id === contextId,
        );
        if (contextIndex < 0) return;
        const removal = removeInlineTerminalContextPlaceholder(promptRef.current, contextIndex);
        promptRef.current = removal.prompt;
        setPrompt(removal.prompt);
        removeComposerDraftTerminalContext(composerDraftTarget, contextId);
        const nextCursor = collapseExpandedComposerCursor(removal.prompt, removal.cursor);
        setComposerCursor(nextCursor);
        setComposerTrigger(detectComposerTrigger(removal.prompt, removal.cursor));
      },
      [
        composerDraftTarget,
        composerTerminalContexts,
        promptRef,
        removeComposerDraftTerminalContext,
        setPrompt,
      ],
    );

    // ------------------------------------------------------------------
    // Sync refs back to parent
    // ------------------------------------------------------------------
    useEffect(() => {
      promptRef.current = prompt;
      setComposerCursor((existing) => clampCollapsedComposerCursor(prompt, existing));
    }, [prompt, promptRef]);

    useEffect(() => {
      composerImagesRef.current = composerImages;
    }, [composerImages, composerImagesRef]);

    useEffect(() => {
      composerTerminalContextsRef.current = composerTerminalContexts;
    }, [composerTerminalContexts, composerTerminalContextsRef]);

    // ------------------------------------------------------------------
    // Composer menu highlight sync
    // ------------------------------------------------------------------
    useEffect(() => {
      if (!composerMenuOpen) {
        setComposerHighlightedItemId(null);
        setComposerHighlightedSearchKey(null);
        return;
      }
      const nextActiveItemId = resolveComposerMenuActiveItemId({
        items: composerMenuItems,
        highlightedItemId: composerHighlightedItemId,
        currentSearchKey: composerMenuSearchKey,
        highlightedSearchKey: composerHighlightedSearchKey,
      });
      setComposerHighlightedItemId((existing) =>
        existing === nextActiveItemId ? existing : nextActiveItemId,
      );
      setComposerHighlightedSearchKey((existing) =>
        existing === composerMenuSearchKey ? existing : composerMenuSearchKey,
      );
    }, [
      composerHighlightedItemId,
      composerHighlightedSearchKey,
      composerMenuItems,
      composerMenuOpen,
      composerMenuSearchKey,
    ]);

    const lastSyncedPendingInputRef = useRef<{
      requestId: string | null;
      questionId: string | null;
    } | null>(null);

    useEffect(() => {
      const nextCustomAnswer = activePendingProgress?.customAnswer;
      if (typeof nextCustomAnswer !== "string") {
        lastSyncedPendingInputRef.current = null;
        return;
      }

      const nextRequestId = activePendingUserInput?.requestId ?? null;
      const nextQuestionId = activePendingProgress?.activeQuestion?.id ?? null;
      const questionChanged =
        lastSyncedPendingInputRef.current?.requestId !== nextRequestId ||
        lastSyncedPendingInputRef.current?.questionId !== nextQuestionId;
      const textChangedExternally = promptRef.current !== nextCustomAnswer;

      lastSyncedPendingInputRef.current = {
        requestId: nextRequestId,
        questionId: nextQuestionId,
      };

      if (!questionChanged && !textChangedExternally) {
        return;
      }

      promptRef.current = nextCustomAnswer;
      const nextCursor = collapseExpandedComposerCursor(nextCustomAnswer, nextCustomAnswer.length);
      setComposerCursor(nextCursor);
      setComposerTrigger(
        detectComposerTrigger(
          nextCustomAnswer,
          expandCollapsedComposerCursor(nextCustomAnswer, nextCursor),
        ),
      );
      setComposerHighlightedItemId(null);
    }, [
      activePendingProgress?.customAnswer,
      activePendingProgress?.activeQuestion?.id,
      activePendingUserInput?.requestId,
      promptRef,
    ]);

    // ------------------------------------------------------------------
    // Reset compositor state on thread/draft change
    // ------------------------------------------------------------------
    useEffect(() => {
      setComposerHighlightedItemId(null);
      setComposerCursor(
        collapseExpandedComposerCursor(promptRef.current, promptRef.current.length),
      );
      setComposerTrigger(detectComposerTrigger(promptRef.current, promptRef.current.length));
    }, [draftId, activeThreadId, promptRef]);

    // ------------------------------------------------------------------
    // Footer compact layout observation
    // ------------------------------------------------------------------
    useLayoutEffect(() => {
      const composerForm = composerFormRef.current;
      if (!composerForm) return;
      const measureComposerFormWidth = () => composerForm.clientWidth;
      const measureFooterCompactness = () => {
        const composerFormWidth = measureComposerFormWidth();
        const footerCompact = shouldUseCompactComposerFooter(composerFormWidth, {
          hasWideActions: composerFooterHasWideActions,
        });
        const primaryActionsCompact =
          footerCompact &&
          shouldUseCompactComposerPrimaryActions(composerFormWidth, {
            hasWideActions: composerFooterHasWideActions,
          });
        return {
          primaryActionsCompact,
          footerCompact,
        };
      };

      composerFormHeightRef.current = composerForm.getBoundingClientRect().height;
      const initialCompactness = measureFooterCompactness();
      setIsComposerPrimaryActionsCompact(initialCompactness.primaryActionsCompact);
      setIsComposerFooterCompact(initialCompactness.footerCompact);
      if (typeof ResizeObserver === "undefined") return;

      const observer = new ResizeObserver((entries) => {
        const [entry] = entries;
        if (!entry) return;
        const nextCompactness = measureFooterCompactness();
        setIsComposerPrimaryActionsCompact((previous) =>
          previous === nextCompactness.primaryActionsCompact
            ? previous
            : nextCompactness.primaryActionsCompact,
        );
        setIsComposerFooterCompact((previous) =>
          previous === nextCompactness.footerCompact ? previous : nextCompactness.footerCompact,
        );
        const nextHeight = entry.contentRect.height;
        const previousHeight = composerFormHeightRef.current;
        composerFormHeightRef.current = nextHeight;
        if (previousHeight > 0 && Math.abs(nextHeight - previousHeight) < 0.5) return;
        if (!shouldAutoScrollRef.current) return;
        scheduleStickToBottom();
      });

      observer.observe(composerForm);
      return () => {
        observer.disconnect();
      };
    }, [
      activeThreadId,
      composerFooterActionLayoutKey,
      composerFooterHasWideActions,
      scheduleStickToBottom,
      shouldAutoScrollRef,
    ]);

    // ------------------------------------------------------------------
    // Image persist effect
    // ------------------------------------------------------------------
    useEffect(() => {
      let cancelled = false;
      void (async () => {
        if (composerImages.length === 0) {
          clearComposerDraftPersistedAttachments(composerDraftTarget);
          return;
        }
        const getPersistedAttachmentsForThread = () =>
          getComposerDraft(composerDraftTarget)?.persistedAttachments ?? [];
        try {
          const currentPersistedAttachments = getPersistedAttachmentsForThread();
          const existingPersistedById = new Map(
            currentPersistedAttachments.map((attachment) => [attachment.id, attachment]),
          );
          const stagedAttachmentById = new Map<string, PersistedComposerImageAttachment>();
          await Promise.all(
            composerImages.map(async (image) => {
              try {
                const dataUrl = await readFileAsDataUrl(image.file);
                stagedAttachmentById.set(image.id, {
                  id: image.id,
                  name: image.name,
                  mimeType: image.mimeType,
                  sizeBytes: image.sizeBytes,
                  dataUrl,
                });
              } catch {
                const existingPersisted = existingPersistedById.get(image.id);
                if (existingPersisted) {
                  stagedAttachmentById.set(image.id, existingPersisted);
                }
              }
            }),
          );
          const serialized = Array.from(stagedAttachmentById.values());
          if (cancelled) return;
          syncComposerDraftPersistedAttachments(composerDraftTarget, serialized);
        } catch {
          const currentImageIds = new Set(composerImages.map((image) => image.id));
          const fallbackPersistedAttachments = getPersistedAttachmentsForThread();
          const fallbackPersistedIds = fallbackPersistedAttachments
            .map((attachment) => attachment.id)
            .filter((id) => currentImageIds.has(id));
          const fallbackPersistedIdSet = new Set(fallbackPersistedIds);
          const fallbackAttachments = fallbackPersistedAttachments.filter((attachment) =>
            fallbackPersistedIdSet.has(attachment.id),
          );
          if (cancelled) return;
          syncComposerDraftPersistedAttachments(composerDraftTarget, fallbackAttachments);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [
      composerDraftTarget,
      clearComposerDraftPersistedAttachments,
      composerImages,
      getComposerDraft,
      syncComposerDraftPersistedAttachments,
    ]);

    // ------------------------------------------------------------------
    // Callbacks: prompt change
    // ------------------------------------------------------------------
    const onPromptChange = useCallback(
      (
        nextPrompt: string,
        nextCursor: number,
        expandedCursor: number,
        cursorAdjacentToMention: boolean,
        terminalContextIds: string[],
      ) => {
        if (activePendingProgress?.activeQuestion && pendingUserInputs.length > 0) {
          setComposerCursor(nextCursor);
          setComposerTrigger(
            cursorAdjacentToMention ? null : detectComposerTrigger(nextPrompt, expandedCursor),
          );
          onChangeActivePendingUserInputCustomAnswer(
            activePendingProgress.activeQuestion.id,
            nextPrompt,
            nextCursor,
            expandedCursor,
            cursorAdjacentToMention,
          );
          return;
        }
        promptRef.current = nextPrompt;
        setPrompt(nextPrompt);
        if (!terminalContextIdListsEqual(composerTerminalContexts, terminalContextIds)) {
          setComposerDraftTerminalContexts(
            composerDraftTarget,
            syncTerminalContextsByIds(composerTerminalContexts, terminalContextIds),
          );
        }
        setComposerCursor(nextCursor);
        setComposerTrigger(
          cursorAdjacentToMention ? null : detectComposerTrigger(nextPrompt, expandedCursor),
        );
      },
      [
        activePendingProgress?.activeQuestion,
        pendingUserInputs.length,
        onChangeActivePendingUserInputCustomAnswer,
        promptRef,
        setPrompt,
        composerDraftTarget,
        composerTerminalContexts,
        setComposerDraftTerminalContexts,
      ],
    );

    // ------------------------------------------------------------------
    // Callbacks: prompt replacement / menu
    // ------------------------------------------------------------------
    const applyPromptReplacement = useCallback(
      (
        rangeStart: number,
        rangeEnd: number,
        replacement: string,
        options?: { expectedText?: string; focusEditorAfterReplace?: boolean },
      ): boolean => {
        const currentText = promptRef.current;
        const safeStart = Math.max(0, Math.min(currentText.length, rangeStart));
        const safeEnd = Math.max(safeStart, Math.min(currentText.length, rangeEnd));
        if (
          options?.expectedText !== undefined &&
          currentText.slice(safeStart, safeEnd) !== options.expectedText
        ) {
          return false;
        }
        const next = replaceTextRange(promptRef.current, rangeStart, rangeEnd, replacement);
        const nextCursor = collapseExpandedComposerCursor(next.text, next.cursor);
        const nextExpandedCursor = expandCollapsedComposerCursor(next.text, nextCursor);
        promptRef.current = next.text;
        const activePendingQuestion = activePendingProgress?.activeQuestion;
        if (activePendingQuestion && activePendingUserInput) {
          onChangeActivePendingUserInputCustomAnswer(
            activePendingQuestion.id,
            next.text,
            nextCursor,
            nextExpandedCursor,
            false,
          );
        } else {
          setPrompt(next.text);
        }
        setComposerCursor(nextCursor);
        setComposerTrigger(detectComposerTrigger(next.text, nextExpandedCursor));
        if (options?.focusEditorAfterReplace !== false) {
          window.requestAnimationFrame(() => {
            composerEditorRef.current?.focusAt(nextCursor);
          });
        }
        return true;
      },
      [
        activePendingProgress?.activeQuestion,
        activePendingUserInput,
        onChangeActivePendingUserInputCustomAnswer,
        promptRef,
        setPrompt,
      ],
    );

    const readComposerSnapshot = useCallback((): {
      value: string;
      cursor: number;
      expandedCursor: number;
      terminalContextIds: string[];
    } => {
      const editorSnapshot = composerEditorRef.current?.readSnapshot();
      if (editorSnapshot) {
        return editorSnapshot;
      }
      return {
        value: promptRef.current,
        cursor: composerCursor,
        expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
        terminalContextIds: composerTerminalContexts.map((context) => context.id),
      };
    }, [composerCursor, composerTerminalContexts, promptRef]);

    const resolveActiveComposerTrigger = useCallback((): {
      snapshot: { value: string; cursor: number; expandedCursor: number };
      trigger: ComposerTrigger | null;
    } => {
      const snapshot = readComposerSnapshot();
      return {
        snapshot,
        trigger: detectComposerTrigger(snapshot.value, snapshot.expandedCursor),
      };
    }, [readComposerSnapshot]);

    // ------------------------------------------------------------------
    // Callbacks: source-control context picker
    // ------------------------------------------------------------------
    const { handleSelectIssue, handleSelectChangeRequest } =
      useComposerSourceControlContextSelection({
        environmentId,
        gitCwd,
        composerDraftTarget,
        addSourceControlContext: addSourceControlContextToDraft,
      });

    const onSelectComposerItem = useCallback(
      (item: ComposerCommandItem) => {
        if (composerSelectLockRef.current) return;
        composerSelectLockRef.current = true;
        window.requestAnimationFrame(() => {
          composerSelectLockRef.current = false;
        });
        const { snapshot, trigger } = resolveActiveComposerTrigger();
        if (!trigger) return;
        if (item.type === "path") {
          const replacement = `@${serializeComposerMentionPath(item.path)} `;
          const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
            snapshot.value,
            trigger.rangeEnd,
            replacement,
          );
          const applied = applyPromptReplacement(
            trigger.rangeStart,
            replacementRangeEnd,
            replacement,
            { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
          );
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
        if (item.type === "slash-command") {
          if (item.command === "model") {
            const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
              expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
              focusEditorAfterReplace: false,
            });
            if (applied) {
              setComposerHighlightedItemId(null);
              setIsComposerModelPickerOpen(true);
            }
            return;
          }
          void handleInteractionModeChange(item.command === "plan" ? "plan" : "default");
          const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
            expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
          });
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
        if (item.type === "provider-slash-command") {
          const replacement = `/${item.command.name} `;
          const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
            snapshot.value,
            trigger.rangeEnd,
            replacement,
          );
          const applied = applyPromptReplacement(
            trigger.rangeStart,
            replacementRangeEnd,
            replacement,
            { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
          );
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
        if (item.type === "skill") {
          const replacement = `$${item.skill.name} `;
          const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
            snapshot.value,
            trigger.rangeEnd,
            replacement,
          );
          const applied = applyPromptReplacement(
            trigger.rangeStart,
            replacementRangeEnd,
            replacement,
            { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
          );
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
        if (item.type === "source-control-issue") {
          // Delete the `#...` text range from the composer
          const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
            expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
          });
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          // Fetch detail and attach chip (event-driven, non-blocking)
          void handleSelectIssue(item.summary);
          return;
        }
        if (item.type === "source-control-pr") {
          // Delete the `#...` text range from the composer
          const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
            expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
          });
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          // Fetch detail and attach chip (event-driven, non-blocking)
          void handleSelectChangeRequest(item.summary);
          return;
        }
      },
      [
        applyPromptReplacement,
        handleInteractionModeChange,
        handleSelectIssue,
        handleSelectChangeRequest,
        resolveActiveComposerTrigger,
      ],
    );

    const onComposerMenuItemHighlighted = useCallback(
      (itemId: string | null) => {
        setComposerHighlightedItemId(itemId);
        setComposerHighlightedSearchKey(composerMenuSearchKey);
      },
      [composerMenuSearchKey],
    );

    const nudgeComposerMenuHighlight = useCallback(
      (key: "ArrowDown" | "ArrowUp") => {
        if (composerMenuItems.length === 0) return;
        const highlightedIndex = composerMenuItems.findIndex(
          (item) => item.id === composerHighlightedItemId,
        );
        const normalizedIndex =
          highlightedIndex >= 0 ? highlightedIndex : key === "ArrowDown" ? -1 : 0;
        const offset = key === "ArrowDown" ? 1 : -1;
        const nextIndex =
          (normalizedIndex + offset + composerMenuItems.length) % composerMenuItems.length;
        const nextItem = composerMenuItems[nextIndex];
        setComposerHighlightedItemId(nextItem?.id ?? null);
      },
      [composerHighlightedItemId, composerMenuItems],
    );

    const blurMobileComposerAfterSend = useCallback(() => {
      if (!isMobileViewport) return;
      if (composerBlurFrameRef.current !== null) {
        window.cancelAnimationFrame(composerBlurFrameRef.current);
        composerBlurFrameRef.current = null;
      }
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) {
        activeElement.blur();
      }
      setIsComposerFocused(false);
    }, [isMobileViewport]);

    const shouldBlurMobileComposerOnSubmit = useCallback(
      () =>
        shouldBlurComposerOnSubmit({
          isMobileViewport,
          isSendBusy,
          isConnecting,
          phase,
          pendingProgress: activePendingProgress,
          hasResolvedAnswers: Boolean(activePendingResolvedAnswers),
          showPlanFollowUpPrompt,
          hasSendableContent: composerSendState.hasSendableContent,
        }),
      [
        activePendingProgress,
        activePendingResolvedAnswers,
        composerSendState.hasSendableContent,
        isConnecting,
        isMobileViewport,
        isSendBusy,
        phase,
        showPlanFollowUpPrompt,
      ],
    );

    const submitComposer = useCallback(
      (event?: { preventDefault: () => void }) => {
        onSend(event);
        if (shouldBlurMobileComposerOnSubmit()) {
          blurMobileComposerAfterSend();
        }
      },
      [blurMobileComposerAfterSend, onSend, shouldBlurMobileComposerOnSubmit],
    );

    // ------------------------------------------------------------------
    // Callbacks: command key
    // ------------------------------------------------------------------
    const onComposerCommandKey = (
      key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab",
      event: KeyboardEvent,
    ) => {
      if (key === "Tab" && event.shiftKey) {
        toggleInteractionMode();
        return true;
      }
      const { trigger } = resolveActiveComposerTrigger();
      const menuIsActive = composerMenuOpenRef.current || trigger !== null;
      if (menuIsActive) {
        const currentItems = composerMenuItemsRef.current;
        const selectedItem = activeComposerMenuItemRef.current ?? currentItems[0];
        if (key === "ArrowDown" && currentItems.length > 0) {
          nudgeComposerMenuHighlight("ArrowDown");
          return true;
        }
        if (key === "ArrowUp" && currentItems.length > 0) {
          nudgeComposerMenuHighlight("ArrowUp");
          return true;
        }
        if ((key === "Enter" || key === "Tab") && selectedItem) {
          onSelectComposerItem(selectedItem);
          return true;
        }
      }
      if (key === "Enter" && !event.shiftKey) {
        submitComposer();
        return true;
      }
      return false;
    };

    // ------------------------------------------------------------------
    // Callbacks: images / file attachments / drag / paste
    // ------------------------------------------------------------------
    const {
      isDragOverComposer,
      addComposerAttachments,
      removeComposerImage,
      onComposerPaste,
      onComposerDragEnter,
      onComposerDragOver,
      onComposerDragLeave,
      onComposerDrop,
    } = useComposerImageAttachments({
      composerDraftTarget,
      environmentId,
      activeThreadId,
      draftId,
      routeThreadRef,
      runtimeMode,
      gitCwd,
      pendingUserInputCount: pendingUserInputs.length,
      composerImagesRef,
      editorRef: composerEditorRef,
      setThreadError,
      focusComposer,
    });

    const handleRemoveSourceControlContext = useCallback(
      (id: string) => {
        removeSourceControlContextFromDraft(composerDraftTarget, id);
      },
      [composerDraftTarget, removeSourceControlContextFromDraft],
    );

    const handleInterruptPrimaryAction = useCallback(() => {
      void onInterrupt();
    }, [onInterrupt]);
    const handleImplementPlanInNewThreadPrimaryAction = useCallback(() => {
      void onImplementPlanInNewThread();
    }, [onImplementPlanInNewThread]);
    const scheduleComposerCollapseCheck = useCallback(() => {
      if (!isMobileViewport) {
        return;
      }
      if (composerBlurFrameRef.current !== null) {
        window.cancelAnimationFrame(composerBlurFrameRef.current);
      }
      composerBlurFrameRef.current = window.requestAnimationFrame(() => {
        composerBlurFrameRef.current = null;
        const composerSurface = composerSurfaceRef.current;
        const activeElement = document.activeElement;
        if (activeElement instanceof Element && isInsideComposerFloatingLayer(activeElement)) {
          return;
        }
        if (
          composerSurface &&
          activeElement instanceof Node &&
          composerSurface.contains(activeElement)
        ) {
          return;
        }
        setIsComposerFocused(false);
      });
    }, [isMobileViewport]);

    useEffect(() => {
      return () => {
        if (composerBlurFrameRef.current !== null) {
          window.cancelAnimationFrame(composerBlurFrameRef.current);
        }
      };
    }, []);

    // ------------------------------------------------------------------
    // Imperative handle
    // ------------------------------------------------------------------
    useImperativeHandle(
      ref,
      () => ({
        focusAtEnd: () => {
          composerEditorRef.current?.focusAtEnd();
        },
        focusAt: (cursor: number) => {
          composerEditorRef.current?.focusAt(cursor);
        },
        openModelPicker: () => {
          setIsComposerModelPickerOpen(true);
        },
        toggleModelPicker: () => {
          setIsComposerModelPickerOpen((open) => !open);
        },
        isModelPickerOpen: () => isComposerModelPickerOpen,
        readSnapshot: () => {
          return readComposerSnapshot();
        },
        resetCursorState: (options?: {
          cursor?: number;
          prompt?: string;
          detectTrigger?: boolean;
        }) => {
          const promptForState = options?.prompt ?? promptRef.current;
          const cursor = clampCollapsedComposerCursor(promptForState, options?.cursor ?? 0);
          setComposerHighlightedItemId(null);
          setComposerCursor(cursor);
          setComposerTrigger(
            options?.detectTrigger
              ? detectComposerTrigger(
                  promptForState,
                  expandCollapsedComposerCursor(promptForState, cursor),
                )
              : null,
          );
        },
        addTerminalContext: (selection: TerminalContextSelection) => {
          if (!activeThreadId) return;
          const snapshot = composerEditorRef.current?.readSnapshot() ?? {
            value: promptRef.current,
            cursor: composerCursor,
            expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
            terminalContextIds: composerTerminalContexts.map((context) => context.id),
          };
          const insertion = insertInlineTerminalContextPlaceholder(
            snapshot.value,
            snapshot.expandedCursor,
          );
          const nextCollapsedCursor = collapseExpandedComposerCursor(
            insertion.prompt,
            insertion.cursor,
          );
          const inserted = insertComposerDraftTerminalContext(
            composerDraftTarget,
            insertion.prompt,
            {
              id: randomUUID(),
              threadId: activeThreadId,
              createdAt: new Date().toISOString(),
              ...selection,
            },
            insertion.contextIndex,
          );
          if (!inserted) return;
          promptRef.current = insertion.prompt;
          setComposerCursor(nextCollapsedCursor);
          setComposerTrigger(detectComposerTrigger(insertion.prompt, insertion.cursor));
          window.requestAnimationFrame(() => {
            composerEditorRef.current?.focusAt(nextCollapsedCursor);
          });
        },
        insertTriggerAtCursor: (text: string) => {
          if (isMobileViewport) {
            setIsComposerFocused(true);
          }
          const snapshot = composerEditorRef.current?.readSnapshot() ?? {
            value: promptRef.current,
            cursor: composerCursor,
            expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
            terminalContextIds: composerTerminalContexts.map((context) => context.id),
          };
          const { text: nextPrompt, cursor: nextExpandedCursor } = replaceTextRange(
            snapshot.value,
            snapshot.expandedCursor,
            snapshot.expandedCursor,
            text,
          );
          const nextCollapsedCursor = collapseExpandedComposerCursor(
            nextPrompt,
            nextExpandedCursor,
          );
          promptRef.current = nextPrompt;
          setComposerDraftPrompt(composerDraftTarget, nextPrompt);
          setComposerCursor(nextCollapsedCursor);
          setComposerTrigger(detectComposerTrigger(nextPrompt, nextExpandedCursor));
          window.requestAnimationFrame(() => {
            composerEditorRef.current?.focusAt(nextCollapsedCursor);
          });
        },
        getSendContext: () => ({
          prompt: promptRef.current,
          images: composerImagesRef.current,
          terminalContexts: composerTerminalContextsRef.current,
          sourceControlContexts: composerSourceControlContexts,
          selectedPromptEffort,
          selectedModelOptionsForDispatch,
          selectedModelSelection,
          selectedProvider,
          selectedModel,
          selectedProviderModels,
        }),
      }),
      [
        activeThreadId,
        composerDraftTarget,
        composerCursor,
        composerSourceControlContexts,
        composerTerminalContexts,
        insertComposerDraftTerminalContext,
        isMobileViewport,
        promptRef,
        composerImagesRef,
        composerTerminalContextsRef,
        isComposerModelPickerOpen,
        readComposerSnapshot,
        selectedModel,
        selectedModelOptionsForDispatch,
        selectedModelSelection,
        selectedPromptEffort,
        selectedProvider,
        selectedProviderModels,
        setComposerDraftPrompt,
      ],
    );

    // Render
    // ------------------------------------------------------------------
    return (
      <form
        ref={composerFormRef}
        onSubmit={submitComposer}
        className="mx-auto w-full min-w-0 max-w-208"
        data-chat-composer-form="true"
      >
        <div
          className={cn(
            "group rounded-3xl p-px transition-colors duration-200",
            composerProviderState.composerFrameClassName,
          )}
          onDragEnter={onComposerDragEnter}
          onDragOver={onComposerDragOver}
          onDragLeave={onComposerDragLeave}
          onDrop={onComposerDrop}
        >
          <div
            ref={composerSurfaceRef}
            data-chat-composer-mobile-collapsed={isComposerCollapsedMobile ? "true" : "false"}
            className={cn(
              "rounded-[max(0px,calc(var(--radius-3xl)-2px))] border-0 bg-card/82 shadow-[0_6px_18px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.05)] outline-none transition-[background-color,box-shadow] duration-200 hover:bg-card/92 hover:shadow-[0_8px_22px_rgba(0,0,0,0.08),0_1px_4px_rgba(0,0,0,0.06)] has-focus-visible:bg-card/95 has-focus-visible:shadow-[0_8px_24px_rgba(0,0,0,0.09),0_1px_4px_rgba(0,0,0,0.07)]",
              isDragOverComposer
                ? "bg-accent/30 shadow-lg/12 ring-1 ring-inset ring-primary/45"
                : null,
              environmentUnavailable ? "opacity-75" : null,
              composerProviderState.composerSurfaceClassName,
            )}
            onFocusCapture={(event) => {
              const activeElement = event.target;
              // Still required after the collapsed pills were removed: the
              // container also holds the approval actions and the pending
              // user-input panel. Focusing one of those is an answer to that
              // panel, not a request to open the composer, so it must not
              // expand the composer under the user's finger. Focus reaching
              // the editor itself is outside this container and does expand.
              if (
                isComposerCollapsedMobile &&
                activeElement instanceof HTMLElement &&
                activeElement.closest('[data-chat-composer-collapsed-controls="true"]')
              ) {
                return;
              }
              if (composerBlurFrameRef.current !== null) {
                window.cancelAnimationFrame(composerBlurFrameRef.current);
                composerBlurFrameRef.current = null;
              }
              setIsComposerFocused(true);
            }}
            onBlurCapture={() => {
              scheduleComposerCollapseCheck();
            }}
            onClick={(event) => {
              // Normal case: the collapsed editor is the tap target and the
              // browser focuses it natively, which expands through
              // onFocusCapture. A disabled editor is `contenteditable="false"`
              // and cannot take focus, and the collapsed surface has no other
              // focusable node, so without this the composer would be an inert
              // line whenever the environment is connecting or unavailable.
              // Expanding here cannot reintroduce the deferred-focus defect: a
              // disabled editor raises no software keyboard either way.
              if (!isComposerCollapsedMobile || !isComposerEditorDisabled) {
                return;
              }
              const target = event.target;
              if (
                target instanceof HTMLElement &&
                target.closest('[data-chat-composer-collapsed-controls="true"]')
              ) {
                return;
              }
              setIsComposerFocused(true);
            }}
          >
            {!isComposerCollapsedMobile &&
              (activePendingApproval ? (
                <div className="rounded-t-[max(0px,calc(var(--radius-3xl)-3px))] border-b border-border/65 bg-muted/20">
                  <ApprovalCard
                    approval={activePendingApproval}
                    pendingCount={pendingApprovals.length}
                    isResponding={respondingRequestIds.includes(activePendingApproval.requestId)}
                    onRespondToApproval={onRespondToApproval}
                  />
                </div>
              ) : pendingUserInputs.length > 0 ? (
                <div className="rounded-t-[max(0px,calc(var(--radius-3xl)-3px))] border-b border-border/65 bg-muted/20">
                  <ComposerPendingUserInputPanel
                    pendingUserInputs={pendingUserInputs}
                    respondingRequestIds={respondingRequestIds}
                    answers={activePendingDraftAnswers}
                    questionIndex={activePendingQuestionIndex}
                    onToggleOption={onSelectActivePendingUserInputOption}
                    onAdvance={onAdvanceActivePendingUserInput}
                  />
                </div>
              ) : showPlanFollowUpPrompt && activeProposedPlan ? (
                <div className="rounded-t-[max(0px,calc(var(--radius-3xl)-3px))] border-b border-border/65 bg-muted/20">
                  <ComposerPlanFollowUpBanner
                    key={activeProposedPlan.id}
                    planTitle={proposedPlanTitle(activeProposedPlan.planMarkdown) ?? null}
                  />
                </div>
              ) : null)}

            {isComposerCollapsedMobile && activePendingApproval ? (
              <div
                className="rounded-t-[max(0px,calc(var(--radius-3xl)-3px))] border-b border-border/65 bg-muted/20"
                data-chat-composer-collapsed-controls="true"
              >
                <ApprovalCard
                  approval={activePendingApproval}
                  pendingCount={pendingApprovals.length}
                  isResponding={respondingRequestIds.includes(activePendingApproval.requestId)}
                  onRespondToApproval={onRespondToApproval}
                />
              </div>
            ) : isComposerCollapsedMobile && pendingUserInputs.length > 0 ? (
              <div
                className="rounded-t-[max(0px,calc(var(--radius-3xl)-3px))] border-b border-border/65 bg-muted/20"
                data-chat-composer-collapsed-controls="true"
              >
                <ComposerPendingUserInputPanel
                  pendingUserInputs={pendingUserInputs}
                  respondingRequestIds={respondingRequestIds}
                  answers={activePendingDraftAnswers}
                  questionIndex={activePendingQuestionIndex}
                  onToggleOption={onSelectActivePendingUserInputOption}
                  onAdvance={onAdvanceActivePendingUserInput}
                />
                {activePendingProgress?.activeQuestion?.multiSelect ? (
                  <div className="px-3 pb-3 sm:px-4">
                    <div
                      data-chat-composer-mobile-pending-compact="true"
                      className="flex min-w-0 items-center justify-end gap-2 rounded-lg border border-border/55 bg-background/55 p-1.5"
                    >
                      <ComposerPrimaryActions
                        compact
                        pendingAction={pendingPrimaryAction}
                        isRunning={false}
                        showPlanFollowUpPrompt={false}
                        promptHasText={false}
                        isSendBusy={isSendBusy}
                        isConnecting={isConnecting}
                        isEnvironmentUnavailable={environmentUnavailable !== null}
                        isPreparingWorktree={false}
                        hasSendableContent={false}
                        preserveComposerFocusOnPointerDown
                        onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
                        onInterrupt={handleInterruptPrimaryAction}
                        onImplementPlanInNewThread={handleImplementPlanInNewThreadPrimaryAction}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <ComposerPromptShell
              editorRef={composerEditorRef}
              isComposerCollapsedMobile={isComposerCollapsedMobile}
              hasComposerHeader={hasComposerHeader}
              isComposerApprovalState={isComposerApprovalState}
              resolvedTheme={resolvedTheme}
              composerMenuOpen={composerMenuOpen}
              composerMenuItems={composerMenuItems}
              isComposerMenuLoading={isComposerMenuLoading}
              composerTriggerKind={composerTriggerKind}
              composerTrigger={composerTrigger}
              composerMenuEmptyState={composerMenuEmptyState}
              activeComposerMenuItemId={activeComposerMenuItem?.id ?? null}
              onComposerMenuItemHighlighted={onComposerMenuItemHighlighted}
              onSelectComposerItem={onSelectComposerItem}
              composerSourceControlContexts={composerSourceControlContexts}
              onRemoveSourceControlContext={handleRemoveSourceControlContext}
              composerImages={composerImages}
              nonPersistedComposerImageIdSet={nonPersistedComposerImageIdSet}
              onExpandImage={onExpandImage}
              onRemoveImage={removeComposerImage}
              pendingUserInputCount={pendingUserInputs.length}
              prompt={prompt}
              composerCursor={composerCursor}
              composerTerminalContexts={composerTerminalContexts}
              skills={selectedProviderStatus?.skills ?? []}
              showMobilePendingAnswerActions={showMobilePendingAnswerActions}
              onRemoveTerminalContext={removeComposerTerminalContextFromDraft}
              onPromptChange={onPromptChange}
              onComposerCommandKey={onComposerCommandKey}
              onComposerPaste={onComposerPaste}
              activePendingProgress={activePendingProgress}
              showPlanFollowUpPrompt={showPlanFollowUpPrompt}
              activeProposedPlan={activeProposedPlan}
              environmentUnavailable={environmentUnavailable}
              phase={phase}
              isConnecting={isConnecting}
              isEditorDisabled={isComposerEditorDisabled}
              showCollapsedSendAction={showCollapsedMobileSendAction}
              collapsedSendActionLabel={collapsedComposerPrimaryActionLabel}
              collapsedSendActionDisabled={collapsedComposerPrimaryActionDisabled}
              onCollapsedSend={submitComposer}
              isSendBusy={isSendBusy}
              pendingPrimaryAction={pendingPrimaryAction}
              onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
              onInterrupt={handleInterruptPrimaryAction}
              onImplementPlanInNewThread={handleImplementPlanInNewThreadPrimaryAction}
            />

            {/* Bottom toolbar. During a pending approval the approval card
                above the editor carries the single action set, so the footer
                stays hidden exactly as before. */}
            {isComposerCollapsedMobile ? null : activePendingApproval ? null : (
              <ComposerFooter
                isFooterCompact={isComposerFooterCompact}
                isPrimaryActionsCompact={isComposerPrimaryActionsCompact}
                isMobileViewport={isMobileViewport}
                hideOnMobilePendingAnswers={showMobilePendingAnswerActions}
                environmentId={environmentId}
                gitCwd={gitCwd}
                hasSourceControlRemote={hasSourceControlRemote}
                onSelectIssue={handleSelectIssue}
                onSelectChangeRequest={handleSelectChangeRequest}
                onAttachFile={(file) => {
                  void addComposerAttachments([file]);
                }}
                selectedInstanceId={selectedInstanceId}
                selectedModel={selectedModelForPickerWithCustomFallback}
                lockedProvider={lockedProvider}
                lockedContinuationGroupKey={lockedContinuationGroupKey}
                providerInstanceEntries={providerInstanceEntries}
                keybindings={keybindings}
                modelOptionsByInstance={modelOptionsByInstance}
                terminalOpen={terminalOpen}
                isModelPickerOpen={isComposerModelPickerOpen}
                {...(composerProviderState.modelPickerIconClassName
                  ? { modelPickerIconClassName: composerProviderState.modelPickerIconClassName }
                  : {})}
                onModelPickerOpenChange={setIsComposerModelPickerOpen}
                onProviderModelSelect={onProviderModelSelect}
                showInteractionModeToggle={composerProviderControls.showInteractionModeToggle}
                askModeSupported={composerProviderControls.askModeSupported}
                showPlanSidebarToggle={showPlanSidebarToggle}
                interactionMode={interactionMode}
                runtimeMode={runtimeMode}
                tokenMode={tokenMode}
                planSidebarLabel={planSidebarLabel}
                planSidebarOpen={planSidebarOpen}
                providerTraitsMenuContent={providerTraitsMenuContent}
                providerTraitsChips={providerTraitsChips}
                onInteractionModeChange={handleInteractionModeChange}
                onTogglePlanSidebar={togglePlanSidebar}
                onRuntimeModeChange={handleRuntimeModeChange}
                onTokenModeChange={handleTokenModeChange}
                activeContextWindow={activeContextWindow}
                contextWindowRateLimits={contextWindowRateLimits}
                pendingAction={pendingPrimaryAction}
                isRunning={phase === "running"}
                showPlanFollowUpPrompt={pendingUserInputs.length === 0 && showPlanFollowUpPrompt}
                promptHasText={prompt.trim().length > 0}
                isSendBusy={isSendBusy}
                isConnecting={isConnecting}
                isEnvironmentUnavailable={environmentUnavailable !== null}
                isPreparingWorktree={isPreparingWorktree}
                hasSendableContent={composerSendState.hasSendableContent}
                onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
                onInterrupt={handleInterruptPrimaryAction}
                onImplementPlanInNewThread={handleImplementPlanInNewThreadPrimaryAction}
              />
            )}
          </div>
        </div>
      </form>
    );
  }),
);
