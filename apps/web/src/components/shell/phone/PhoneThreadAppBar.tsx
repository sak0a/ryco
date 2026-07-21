import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { EnvironmentId, ThreadId } from "@ryco/contracts";
import { scopedThreadKey, scopeThreadRef } from "@ryco/client-runtime";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CheckIcon,
  EllipsisVerticalIcon,
  PanelRightIcon,
  SearchIcon,
} from "lucide-react";

import { selectSidebarThreadsAcrossEnvironments, useStore } from "../../../store";
import type { SidebarThreadSummary } from "../../../types";
import { cn } from "~/lib/utils";
import type { ChatSessionTabsItem } from "../../chat/ChatSessionTabs";
import { HostedConnectionPill } from "../../hostedHub/HostedConnectionControls";
import { ThreadRowLeadingStatus } from "../../ThreadStatusIndicators";
import { Button } from "../../ui/button";
import { Toggle } from "../../ui/toggle";
import { PhoneThreadActionsSheet, PhoneThreadRenameDialog } from "./PhoneThreadActionsSheet";
import { usePhoneThreadActions } from "./usePhoneThreadActions";

const EMPTY_MEMBER_PROJECTS = new Map<string, never>();

export interface PhoneThreadAppBarProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly projectCwd: string | null;
  readonly workspacePanelOpen: boolean;
  readonly onToggleWorkspacePanel: () => void;
  readonly onOpenFindInThread: () => void;
  readonly sessionTabs: ReadonlyArray<ChatSessionTabsItem>;
  readonly activeSessionTabKey: string | null;
  readonly onSelectSessionTab: ((key: string) => void) | null;
}

/**
 * The compact phone app bar for the thread surface (L2 of the phone
 * navigation stack): back to Home, title with always-visible status, the
 * hosted connection pill, the workspace-panel toggle (URL-driven panel
 * state), and a kebab opening the bottom-sheet with the full shared thread
 * action inventory plus find-in-thread and the session tab list.
 */
export function PhoneThreadAppBar(props: PhoneThreadAppBarProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const threadKey = scopedThreadKey(scopeThreadRef(props.environmentId, props.threadId));
  const summaries = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const summary = useMemo(
    () =>
      summaries.find(
        (thread) => thread.id === props.threadId && thread.environmentId === props.environmentId,
      ) ?? null,
    [props.environmentId, props.threadId, summaries],
  );
  const summaryByKeyRef = useRef<ReadonlyMap<string, SidebarThreadSummary>>(new Map());
  summaryByKeyRef.current = useMemo(
    () => new Map(summary ? [[threadKey, summary] as const] : []),
    [summary, threadKey],
  );
  const threadActions = usePhoneThreadActions({
    sidebarThreadByKeyRef: summaryByKeyRef,
    memberProjectByScopedKey: EMPTY_MEMBER_PROJECTS,
    projectCwd: props.projectCwd,
  });
  const menuItems = summary ? threadActions.listThreadMenuActions(threadKey) : [];

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 py-2">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Back to threads"
          className="shrink-0"
          onClick={() => void navigate({ to: "/" })}
        >
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{props.title}</p>
          {summary ? (
            <span className="flex items-center gap-1.5">
              <ThreadRowLeadingStatus thread={summary} alwaysShowStatusLabel />
            </span>
          ) : null}
        </div>
        <HostedConnectionPill />
        <Toggle
          pressed={props.workspacePanelOpen}
          onPressedChange={props.onToggleWorkspacePanel}
          aria-label="Toggle workspace panel"
          size="sm"
          className="shrink-0"
        >
          <PanelRightIcon className="size-4" />
        </Toggle>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Thread actions"
          className="shrink-0"
          onClick={() => setMenuOpen(true)}
        >
          <EllipsisVerticalIcon />
        </Button>
      </div>
      <PhoneThreadActionsSheet
        open={menuOpen}
        onOpenChange={setMenuOpen}
        title={props.title}
        items={menuItems}
        onAction={(actionId) => {
          void threadActions.performThreadMenuAction(
            scopeThreadRef(props.environmentId, props.threadId),
            actionId,
          );
        }}
        leadingSections={
          <>
            <div role="group" aria-label="Thread tools" className="space-y-0.5">
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  setMenuOpen(false);
                  props.onOpenFindInThread();
                }}
              >
                <SearchIcon aria-hidden className="size-4" /> Find in thread
              </button>
            </div>
            {props.sessionTabs.length > 0 && props.onSelectSessionTab ? (
              <div
                role="group"
                aria-label="Sessions in this worktree"
                className="mt-2 space-y-0.5 border-t border-border pt-2"
              >
                <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Sessions</p>
                {props.sessionTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      tab.key === props.activeSessionTabKey && "bg-accent/60 font-medium",
                    )}
                    onClick={() => {
                      setMenuOpen(false);
                      props.onSelectSessionTab?.(tab.key);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                    {tab.key === props.activeSessionTabKey ? (
                      <CheckIcon aria-hidden className="size-4 shrink-0" />
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
            {menuItems.length > 0 ? <div className="mt-2 border-t border-border pt-2" /> : null}
          </>
        }
      />
      <PhoneThreadRenameDialog
        renamingThreadKey={threadActions.renamingThreadKey}
        originalTitle={summary?.title ?? props.title}
        renamingTitle={threadActions.renamingTitle}
        setRenamingTitle={threadActions.setRenamingTitle}
        commitRename={threadActions.commitRename}
        cancelRename={threadActions.cancelRename}
      />
    </>
  );
}
