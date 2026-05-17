import { scopeProjectRef, scopeThreadRef, scopedThreadKey } from "@ryco/client-runtime";
import type { EnvironmentId, ThreadId } from "@ryco/contracts";
import { TerminalSquareIcon } from "lucide-react";
import { memo, useMemo } from "react";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { useDetectedServerStore } from "../detectedServerStore";
import { useStore } from "../store";
import { createProjectSelectorByRef, createThreadSelectorByRef } from "../storeSelectors";
import { type EnvironmentOption } from "./BranchToolbar.logic";
import { BranchToolbarBranchSelector } from "./BranchToolbarBranchSelector";
import { BranchToolbarEnvironmentSelector } from "./BranchToolbarEnvironmentSelector";
import { DetectedServersBadge } from "./BranchToolbar/DetectedServersBadge";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

interface BranchToolbarProps {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  draftId?: DraftId;
  activeThreadBranchOverride?: string | null;
  onActiveThreadBranchOverrideChange?: (branch: string | null) => void;
  envLocked: boolean;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
  availableEnvironments?: readonly EnvironmentOption[];
  onEnvironmentChange?: (environmentId: EnvironmentId) => void;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  onToggleTerminal: () => void;
  terminalCount: number;
  onOpenServersTab?: () => void;
}

export const BranchToolbar = memo(function BranchToolbar({
  environmentId,
  threadId,
  draftId,
  activeThreadBranchOverride,
  onActiveThreadBranchOverrideChange,
  envLocked,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
  availableEnvironments,
  onEnvironmentChange,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  onToggleTerminal,
  terminalCount,
  onOpenServersTab,
}: BranchToolbarProps) {
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const serverThreadSelector = useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]);
  const serverThread = useStore(serverThreadSelector);
  const draftThread = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : store.getDraftThreadByRef(threadRef),
  );
  const activeProjectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const activeProjectSelector = useMemo(
    () => createProjectSelectorByRef(activeProjectRef),
    [activeProjectRef],
  );
  const activeProject = useStore(activeProjectSelector);
  const hasActiveThread = serverThread !== undefined || draftThread !== null;

  const threadKey = useMemo(() => scopedThreadKey(threadRef), [threadRef]);
  const serversMap = useDetectedServerStore((s) => s.serversByThreadKey[threadKey]);
  const detectedServers = useMemo(() => (serversMap ? [...serversMap.values()] : []), [serversMap]);

  const showEnvironmentPicker = Boolean(
    availableEnvironments && availableEnvironments.length > 1 && onEnvironmentChange,
  );

  if (!hasActiveThread || !activeProject) return null;

  return (
    <div className="mx-auto flex w-full max-w-208 items-center gap-2 px-2.5 pb-3 pt-1 sm:px-3">
      {showEnvironmentPicker && availableEnvironments && onEnvironmentChange && (
        <div className="flex min-w-0 shrink-0 items-center gap-1">
          <BranchToolbarEnvironmentSelector
            envLocked={envLocked}
            environmentId={environmentId}
            availableEnvironments={availableEnvironments}
            onEnvironmentChange={onEnvironmentChange}
          />
        </div>
      )}

      <div className="hidden flex-1 items-center justify-center gap-1 md:flex">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="xs"
                className="font-medium text-muted-foreground/70 hover:text-foreground/80"
                disabled={!terminalAvailable}
                onClick={onToggleTerminal}
                aria-label="Toggle terminal drawer"
                aria-pressed={terminalOpen}
              >
                <TerminalSquareIcon className="size-3 shrink-0" />
                <span>{terminalOpen ? "Close Terminal" : "Open Terminal"}</span>
                {terminalCount >= 2 && (
                  <span
                    className="text-muted-foreground/70 tabular-nums"
                    aria-label={`${terminalCount} open terminals`}
                  >
                    · {terminalCount}
                  </span>
                )}
              </Button>
            }
          />
          <TooltipPopup side="top">
            {!terminalAvailable
              ? "Terminal is unavailable until this thread has an active project."
              : terminalToggleShortcutLabel
                ? `Toggle terminal drawer (${terminalToggleShortcutLabel})`
                : "Toggle terminal drawer"}
          </TooltipPopup>
        </Tooltip>
        <DetectedServersBadge servers={detectedServers} onClick={onOpenServersTab ?? (() => {})} />
      </div>

      <BranchToolbarBranchSelector
        className="min-w-0 flex-1 justify-end md:ml-auto md:flex-none"
        environmentId={environmentId}
        threadId={threadId}
        {...(draftId ? { draftId } : {})}
        envLocked={envLocked}
        {...(activeThreadBranchOverride !== undefined ? { activeThreadBranchOverride } : {})}
        {...(onActiveThreadBranchOverrideChange ? { onActiveThreadBranchOverrideChange } : {})}
        {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
        {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
      />
    </div>
  );
});
