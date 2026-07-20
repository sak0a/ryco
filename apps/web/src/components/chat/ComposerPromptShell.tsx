import type { ComposerSourceControlContext, ServerProviderSkill } from "@ryco/contracts";
import { memo } from "react";
import { CircleAlertIcon, XIcon } from "lucide-react";
import type { ComposerImageAttachment } from "../../composerDraftStore";
import type { ComposerTrigger } from "../../composer-logic";
import type { TerminalContextDraft } from "../../lib/terminalContext";
import type { SessionPhase, Thread } from "../../types";
import { type ComposerPromptEditorHandle, ComposerPromptEditor } from "../ComposerPromptEditor";
import { ComposerCommandMenuOverlay } from "./ComposerAttachmentMenus";
import { type ComposerCommandItem } from "./ComposerCommandMenu";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { buildExpandedImagePreview, type ExpandedImagePreview } from "./ExpandedImagePreview";
import { SourceControlContextChip } from "./SourceControlContextChip";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";

interface ComposerPromptShellPendingProgress {
  customAnswer: string;
}

interface ComposerPromptShellPendingPrimaryAction {
  questionIndex: number;
  isLastQuestion: boolean;
  canAdvance: boolean;
  isResponding: boolean;
  isComplete: boolean;
}

export interface ComposerPromptShellProps {
  editorRef: React.RefObject<ComposerPromptEditorHandle | null>;

  isComposerCollapsedMobile: boolean;
  hasComposerHeader: boolean;
  isComposerApprovalState: boolean;
  resolvedTheme: "light" | "dark";

  // Command menu overlay
  composerMenuOpen: boolean;
  composerMenuItems: ComposerCommandItem[];
  isComposerMenuLoading: boolean;
  composerTriggerKind: ComposerTrigger["kind"] | null;
  composerTrigger: ComposerTrigger | null;
  composerMenuEmptyState: string;
  activeComposerMenuItemId: string | null;
  onComposerMenuItemHighlighted: (itemId: string | null) => void;
  onSelectComposerItem: (item: ComposerCommandItem) => void;

  // Source-control context chips
  composerSourceControlContexts: ReadonlyArray<ComposerSourceControlContext>;
  onRemoveSourceControlContext: (id: string) => void;

  // Image attachments
  composerImages: ComposerImageAttachment[];
  nonPersistedComposerImageIdSet: ReadonlySet<string>;
  onExpandImage: (preview: ExpandedImagePreview) => void;
  onRemoveImage: (imageId: string) => void;

  // Prompt editor
  pendingUserInputCount: number;
  prompt: string;
  composerCursor: number;
  composerTerminalContexts: TerminalContextDraft[];
  skills: ReadonlyArray<ServerProviderSkill>;
  showMobilePendingAnswerActions: boolean;
  onRemoveTerminalContext: (contextId: string) => void;
  onPromptChange: (
    nextValue: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
    terminalContextIds: string[],
  ) => void;
  onComposerCommandKey: (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab",
    event: KeyboardEvent,
  ) => boolean;
  onComposerPaste: (event: React.ClipboardEvent<HTMLElement>) => void;

  // Placeholder / disabled state
  activePendingProgress: ComposerPromptShellPendingProgress | null;
  showPlanFollowUpPrompt: boolean;
  activeProposedPlan: Thread["proposedPlans"][number] | null;
  environmentUnavailable: {
    readonly label: string;
    readonly connectionState: "connecting" | "disconnected" | "error";
  } | null;
  phase: SessionPhase;
  isConnecting: boolean;

  // Mobile pending answer actions
  isSendBusy: boolean;
  pendingPrimaryAction: ComposerPromptShellPendingPrimaryAction | null;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
}

/**
 * Prompt editor layout shell: command menu overlay, source-control/image
 * attachment previews, and the Lexical-backed prompt editor. Purely
 * presentational — all state and handlers are owned by ChatComposer.
 */
export const ComposerPromptShell = memo(function ComposerPromptShell(
  props: ComposerPromptShellProps,
) {
  const {
    editorRef,
    isComposerCollapsedMobile,
    hasComposerHeader,
    isComposerApprovalState,
    resolvedTheme,
    composerMenuOpen,
    composerMenuItems,
    isComposerMenuLoading,
    composerTriggerKind,
    composerTrigger,
    composerMenuEmptyState,
    activeComposerMenuItemId,
    onComposerMenuItemHighlighted,
    onSelectComposerItem,
    composerSourceControlContexts,
    onRemoveSourceControlContext,
    composerImages,
    nonPersistedComposerImageIdSet,
    onExpandImage,
    onRemoveImage,
    pendingUserInputCount,
    prompt,
    composerCursor,
    composerTerminalContexts,
    skills,
    showMobilePendingAnswerActions,
    onRemoveTerminalContext,
    onPromptChange,
    onComposerCommandKey,
    onComposerPaste,
    activePendingProgress,
    showPlanFollowUpPrompt,
    activeProposedPlan,
    environmentUnavailable,
    phase,
    isConnecting,
    isSendBusy,
    pendingPrimaryAction,
    onPreviousPendingQuestion,
    onInterrupt,
    onImplementPlanInNewThread,
  } = props;

  return (
    <div
      className={cn(
        "relative px-3 pb-2 sm:px-4",
        hasComposerHeader ? "pt-2.5 sm:pt-3" : "pt-3.5 sm:pt-4",
        isComposerCollapsedMobile && "hidden",
      )}
    >
      <ComposerCommandMenuOverlay
        open={composerMenuOpen && !isComposerApprovalState}
        items={composerMenuItems}
        resolvedTheme={resolvedTheme}
        isLoading={isComposerMenuLoading}
        triggerKind={composerTriggerKind}
        groupSlashCommandSections={
          composerTrigger?.kind === "slash-command" && composerTrigger.query.trim().length === 0
        }
        emptyStateText={composerMenuEmptyState}
        activeItemId={activeComposerMenuItemId}
        onHighlightedItemChange={onComposerMenuItemHighlighted}
        onSelect={onSelectComposerItem}
      />

      {!isComposerCollapsedMobile &&
        !isComposerApprovalState &&
        pendingUserInputCount === 0 &&
        composerSourceControlContexts.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {composerSourceControlContexts.map((ctx) => (
              <SourceControlContextChip
                key={ctx.id}
                context={ctx}
                onRemove={onRemoveSourceControlContext}
              />
            ))}
          </div>
        )}

      {!isComposerCollapsedMobile &&
        !isComposerApprovalState &&
        pendingUserInputCount === 0 &&
        composerImages.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {composerImages.map((image) => (
              <div
                key={image.id}
                className="relative h-16 w-16 overflow-hidden rounded-lg border border-border/80 bg-background"
              >
                {image.previewUrl ? (
                  <button
                    type="button"
                    className="h-full w-full cursor-zoom-in"
                    aria-label={`Preview ${image.name}`}
                    onClick={() => {
                      const preview = buildExpandedImagePreview(composerImages, image.id);
                      if (!preview) return;
                      onExpandImage(preview);
                    }}
                  >
                    <img
                      src={image.previewUrl}
                      alt={image.name}
                      className="h-full w-full object-cover"
                    />
                  </button>
                ) : (
                  <div className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] text-muted-foreground/70">
                    {image.name}
                  </div>
                )}
                {nonPersistedComposerImageIdSet.has(image.id) && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          role="img"
                          aria-label="Draft attachment may not persist"
                          className="absolute left-1 top-1 inline-flex items-center justify-center rounded bg-background/85 p-0.5 text-amber-600"
                        >
                          <CircleAlertIcon className="size-3" />
                        </span>
                      }
                    />
                    <TooltipPopup side="top" className="max-w-64 whitespace-normal leading-tight">
                      Draft attachment could not be saved locally and may be lost on navigation.
                    </TooltipPopup>
                  </Tooltip>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="absolute right-1 top-1 bg-background/80 hover:bg-background/90"
                  onClick={() => onRemoveImage(image.id)}
                  aria-label={`Remove ${image.name}`}
                >
                  <XIcon />
                </Button>
              </div>
            ))}
          </div>
        )}

      <div className="relative">
        <ComposerPromptEditor
          ref={editorRef}
          value={
            isComposerApprovalState
              ? ""
              : activePendingProgress
                ? activePendingProgress.customAnswer
                : prompt
          }
          cursor={composerCursor}
          terminalContexts={
            !isComposerApprovalState && pendingUserInputCount === 0 ? composerTerminalContexts : []
          }
          skills={skills}
          {...(showMobilePendingAnswerActions ? { className: "max-sm:pb-11" } : {})}
          onRemoveTerminalContext={onRemoveTerminalContext}
          onChange={onPromptChange}
          onCommandKeyDown={onComposerCommandKey}
          onPaste={onComposerPaste}
          placeholder={
            isComposerApprovalState
              ? // The full approval detail renders as a scrollable block in the
                // pending-approval panel; the clipped placeholder only carries
                // the generic hint.
                "Resolve this approval request to continue"
              : activePendingProgress
                ? "Type your own answer, or leave this blank to use the selected option"
                : showPlanFollowUpPrompt && activeProposedPlan
                  ? "Add feedback to refine the plan, or leave this blank to implement it"
                  : environmentUnavailable
                    ? `${environmentUnavailable.label} is ${
                        environmentUnavailable.connectionState === "connecting"
                          ? "connecting"
                          : "disconnected"
                      }`
                    : phase === "disconnected"
                      ? "Ask for follow-up changes or attach images"
                      : "Ask anything, @tag files/folders, or use / to show available commands"
          }
          disabled={
            isConnecting ||
            isComposerApprovalState ||
            (environmentUnavailable !== null && activePendingProgress === null)
          }
        />
        {showMobilePendingAnswerActions ? (
          <div
            data-chat-composer-mobile-pending-actions="true"
            className="absolute bottom-0 right-0 flex justify-end"
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
              onPreviousPendingQuestion={onPreviousPendingQuestion}
              onInterrupt={onInterrupt}
              onImplementPlanInNewThread={onImplementPlanInNewThread}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
});
