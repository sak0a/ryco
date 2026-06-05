import {
  type EnvironmentId,
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
} from "@ryco/contracts";
import { memo } from "react";
import { ListChecksIcon, PanelRightIcon } from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";
import { usePrimaryEnvironmentId } from "../../environments/primary";
import { ChatHeaderBar } from "./ChatHeaderBar";
import { ChatSessionTabs, type ChatSessionTabsItem } from "./ChatSessionTabs";
import type { WorktreeOriginLike } from "./ChatSessionTabs.logic";
import { HEADER_CHROME_ICON_BUTTON_CLASS_NAME } from "./headerChrome";
import type { LinkedWorktreeItem } from "../worktrees/LinkedWorktreeItemDialog";
import { usePerfMark, useDevPropDiff } from "../../perf/tabSwitchInstrumentation";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  // New, optional props for the breadcrumb / tab strip. When omitted the
  // header still renders correctly with degraded info (no worktree segment,
  // no tab strip, no source-control counts).
  worktreeBranch?: string | null;
  worktreeTitle?: string | null;
  worktreeOrigin?: WorktreeOriginLike;
  worktreeIssueNumber?: number | null;
  worktreePrNumber?: number | null;
  worktreeIssueState?: "open" | "closed" | null;
  worktreePrState?: "open" | "closed" | "merged" | null;
  worktreePrIsDraft?: boolean | null;
  sessionTabs?: ReadonlyArray<ChatSessionTabsItem>;
  activeSessionTabKey?: string | null;
  onSelectSessionTab?: (key: string) => void;
  onPrefetchTabEnter?: (key: string) => void;
  onPrefetchTabLeave?: (key: string) => void;
  onNewSessionInWorktree?: () => void;
  onSelectProject?: () => void;
  onSelectWorktree?: () => void;
  onOpenLinkedWorktreeItem?: (item: LinkedWorktreeItem) => void;
  workspacePanelOpen: boolean;
  onToggleWorkspacePanel: () => void;
  overviewSidebarOpen: boolean;
  onToggleOverviewSidebar: (open?: boolean) => void;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
}

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly activeThreadEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): boolean {
  return (
    Boolean(input.activeProjectName) &&
    input.primaryEnvironmentId !== null &&
    input.activeThreadEnvironmentId === input.primaryEnvironmentId
  );
}

export const ChatHeader = memo(function ChatHeader(props: ChatHeaderProps) {
  usePerfMark("ChatHeader");
  useDevPropDiff(props as unknown as Record<string, unknown>, "ChatHeader");
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName: props.activeProjectName,
    activeThreadEnvironmentId: props.activeThreadEnvironmentId,
    primaryEnvironmentId,
  });

  const inlineActions = (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              pressed={props.overviewSidebarOpen}
              onPressedChange={props.onToggleOverviewSidebar}
              aria-label="Toggle overview panel"
              className={HEADER_CHROME_ICON_BUTTON_CLASS_NAME}
              size="sm"
            >
              <ListChecksIcon className="size-4" />
            </Toggle>
          }
        />
        <TooltipPopup side="bottom">Toggle overview panel</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              pressed={props.workspacePanelOpen}
              onPressedChange={props.onToggleWorkspacePanel}
              aria-label="Toggle workspace panel"
              className={HEADER_CHROME_ICON_BUTTON_CLASS_NAME}
              size="sm"
            >
              <PanelRightIcon className="size-4" />
            </Toggle>
          }
        />
        <TooltipPopup side="bottom">Toggle workspace panel</TooltipPopup>
      </Tooltip>
      {props.activeProjectScripts ? (
        <ProjectScriptsControl
          scripts={props.activeProjectScripts}
          keybindings={props.keybindings}
          preferredScriptId={props.preferredScriptId}
          onRunScript={props.onRunProjectScript}
          onAddScript={props.onAddProjectScript}
          onUpdateScript={props.onUpdateProjectScript}
          onDeleteScript={props.onDeleteProjectScript}
        />
      ) : null}
      {showOpenInPicker ? (
        <OpenInPicker
          keybindings={props.keybindings}
          availableEditors={props.availableEditors}
          openInCwd={props.openInCwd}
        />
      ) : null}
    </>
  );

  const tabs = props.sessionTabs ?? [];
  const showTabs = tabs.length > 0;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center gap-2 pt-4 pb-2.5">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <ChatHeaderBar
          projectName={props.activeProjectName}
          isGitRepo={props.isGitRepo}
          worktreeBranch={props.worktreeBranch}
          worktreeTitle={props.worktreeTitle}
          worktreeOrigin={props.worktreeOrigin}
          worktreeIssueNumber={props.worktreeIssueNumber}
          worktreeIssueState={props.worktreeIssueState}
          worktreePrNumber={props.worktreePrNumber}
          worktreePrState={props.worktreePrState}
          worktreePrIsDraft={props.worktreePrIsDraft}
          sessionTitle={props.activeThreadTitle}
          {...(props.onSelectProject ? { onSelectProject: props.onSelectProject } : {})}
          {...(props.onSelectWorktree ? { onSelectWorktree: props.onSelectWorktree } : {})}
          {...(props.onOpenLinkedWorktreeItem
            ? { onOpenLinkedWorktreeItem: props.onOpenLinkedWorktreeItem }
            : {})}
          inlineActions={inlineActions}
        />
      </div>
      {showTabs && props.onSelectSessionTab ? (
        <ChatSessionTabs
          items={tabs}
          activeKey={props.activeSessionTabKey ?? null}
          onSelect={props.onSelectSessionTab}
          {...(props.onPrefetchTabEnter ? { onPrefetchEnter: props.onPrefetchTabEnter } : {})}
          {...(props.onPrefetchTabLeave ? { onPrefetchLeave: props.onPrefetchTabLeave } : {})}
          {...(props.onNewSessionInWorktree ? { onNew: props.onNewSessionInWorktree } : {})}
        />
      ) : null}
    </div>
  );
});
