import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { scopedThreadKey, scopeProjectRef, scopeThreadRef } from "@ryco/client-runtime";
import {
  type ScopedThreadRef,
  type ThreadId,
} from "@ryco/contracts";
import { projectScriptCwd, projectScriptRuntimeEnv } from "@ryco/shared/projectScripts";
import {
  BotIcon,
  FileTextIcon,
  FolderIcon,
  GlobeIcon,
  GitCompareIcon,
  MessageSquarePlusIcon,
  MessageSquareTextIcon,
  PlusIcon,
  TerminalIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";

import {
  getRightPanelMode,
  parseRightPanelRouteSearch,
  type RightPanelMode,
} from "../rightPanelRouteSearch";
import {
  buildOpenAgentSearch,
  buildOpenFilesSearch,
  buildOpenReviewSearch,
  buildOpenTerminalSearch,
  buildOpenWorkspaceSearch,
  stripWorkspacePanelSearchParams,
} from "../workspaceRouteSearch";
import {
  deriveThreadSubagents,
  findThreadSubagent,
  type ThreadSubagentStatus,
  type ThreadSubagentView,
} from "../threadWorkspaceViewModel";
import { buildTabs, type WorkspaceTab } from "../threadWorkspaceTabs";
import { readEnvironmentApi } from "../environmentApi";
import { shortcutLabelForCommand } from "../keybindings";
import type { TerminalContextSelection } from "../lib/terminalContext";
import { useServerKeybindings } from "../rpc/serverState";
import { useStore } from "../store";
import { createProjectSelectorByRef, createThreadSelectorByRef } from "../storeSelectors";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useComposerHandleContext } from "../composerHandleContext";
import { cn, randomUUID } from "~/lib/utils";
import type { Thread } from "../types";
import {
  resolveSidebarStatusTextClassName,
  resolveSidebarStatusTextStyle,
} from "./sidebar/sidebarStatusText";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import ChatMarkdown from "./ChatMarkdown";
import type { DiffPanelMode } from "./DiffPanelShell";
import DiffPanel from "./DiffPanel";
import PreviewPanel from "./PreviewPanel";
import ThreadTerminalDrawer from "./ThreadTerminalDrawer";

function statusBucket(status: ThreadSubagentStatus): "idle" | "in_progress" | "review" | "done" {
  if (status === "running") return "in_progress";
  if (status === "failed") return "review";
  if (status === "finished") return "done";
  return "idle";
}

function statusLabel(status: ThreadSubagentStatus): string {
  if (status === "running") return "Working";
  if (status === "failed") return "Needs review";
  if (status === "finished") return "Finished";
  return "Idle";
}

function workspaceTabDomKey(key: string | null | undefined): string {
  return encodeURIComponent(key ?? "none").replace(/%/g, "_");
}

function workspaceTabId(key: string | null | undefined): string {
  return `thread-workspace-tab-${workspaceTabDomKey(key)}`;
}

function workspaceTabPanelId(key: string | null | undefined): string {
  return `thread-workspace-panel-${workspaceTabDomKey(key)}`;
}

function TabIcon(props: { tab: WorkspaceTab; active: boolean }) {
  const className = cn(
    "size-3.5 shrink-0",
    props.active ? "text-foreground" : "text-muted-foreground",
  );
  if (props.tab.mode === "agent") {
    return <BotIcon className={className} />;
  }
  if (props.tab.key === "review") {
    return <GitCompareIcon className={className} />;
  }
  if (props.tab.key === "terminal") {
    return <TerminalIcon className={className} />;
  }
  return <FileTextIcon className={className} />;
}

function AgentStatusName(props: { agent: Pick<ThreadSubagentView, "name" | "status"> }) {
  const bucket = statusBucket(props.agent.status);
  return (
    <span
      className={resolveSidebarStatusTextClassName(bucket, "truncate")}
      style={resolveSidebarStatusTextStyle(props.agent.name, { durationSeconds: 2.2 })}
    >
      {props.agent.name}
    </span>
  );
}

export function AgentThreadPanel(props: {
  subagent: ThreadSubagentView | null;
  agentKey: string | null;
}) {
  if (!props.subagent) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
        <div className="max-w-72">
          <div className="mx-auto flex size-10 items-center justify-center rounded-md border border-border/70 bg-card/60 text-muted-foreground">
            <MessageSquareTextIcon className="size-4" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">Subagent unavailable</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            This tab points to a subagent that is no longer present in the current thread activity.
          </p>
          {props.agentKey ? (
            <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground/60">
              {props.agentKey}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="border-b border-border/60 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <BotIcon className="size-4 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 text-sm font-medium">
            <AgentStatusName agent={props.subagent} />
          </p>
          <span className="shrink-0 rounded-md border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {statusLabel(props.subagent.status)}
          </span>
        </div>
        {props.subagent.detail ? (
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {props.subagent.detail}
          </p>
        ) : null}
        {props.subagent.tool || props.subagent.providerThreadIds.length > 0 ? (
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
            {props.subagent.tool ? (
              <span className="rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {props.subagent.tool}
              </span>
            ) : null}
            {props.subagent.providerThreadIds.slice(0, 2).map((threadId) => (
              <span
                key={threadId}
                className="max-w-40 truncate rounded-md border border-border/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70"
              >
                {threadId}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-4">
          {props.subagent.messages.length > 0
            ? props.subagent.messages.map((message) => (
                <div key={message.id} className="rounded-md border border-border/60 bg-card/40 p-3">
                  <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                    <p className="truncate text-xs font-medium text-foreground">Subagent</p>
                    {message.providerThreadId ? (
                      <span className="truncate font-mono text-[10px] text-muted-foreground/55">
                        {message.providerThreadId}
                      </span>
                    ) : null}
                  </div>
                  <ChatMarkdown text={message.text} cwd={undefined} isStreaming={false} />
                </div>
              ))
            : null}
          {props.subagent.entries.length > 0 ? (
            props.subagent.entries.map((entry) => (
              <div key={entry.id} className="rounded-md border border-border/60 bg-card/40 p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      entry.tone === "error"
                        ? "bg-destructive"
                        : props.subagent?.status === "running"
                          ? "bg-sky-400"
                          : "bg-emerald-400",
                    )}
                  />
                  <p className="min-w-0 truncate text-xs font-medium text-foreground">
                    {entry.toolTitle ?? entry.label}
                  </p>
                </div>
                {entry.detail ? (
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {entry.detail}
                  </p>
                ) : null}
                {entry.output && entry.output !== entry.detail ? (
                  <div className="mt-3 rounded-md border border-border/50 bg-background/60 p-2">
                    <ChatMarkdown text={entry.output} cwd={undefined} isStreaming={false} />
                  </div>
                ) : null}
              </div>
            ))
          ) : props.subagent.messages.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-md border border-dashed border-border/70 bg-card/20 p-6 text-center">
              <MessageSquareTextIcon className="size-5 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium text-foreground">No transcript captured yet</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                The subagent is visible from lifecycle events. Detailed messages will appear here
                when the provider exposes them.
              </p>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

function TerminalUnavailableState(props: { title: string; description: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
      <div className="max-w-72">
        <div className="mx-auto flex size-10 items-center justify-center rounded-md border border-border/70 bg-card/60 text-muted-foreground">
          <TerminalIcon className="size-4" />
        </div>
        <p className="mt-3 text-sm font-medium text-foreground">{props.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{props.description}</p>
      </div>
    </div>
  );
}

function WorkspaceTerminalPanel() {
  const params = useParams({ strict: false }) as Record<string, string | undefined>;
  const routeThreadRef = resolveThreadRouteRef(params);
  const draftId = params.draftId ? DraftId.make(params.draftId) : null;
  const draftSession = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : null,
  );
  const threadRef = useMemo<ScopedThreadRef | null>(() => {
    if (routeThreadRef) {
      return routeThreadRef;
    }
    if (!draftSession) {
      return null;
    }
    return scopeThreadRef(draftSession.environmentId, draftSession.threadId);
  }, [draftSession, routeThreadRef]);
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const projectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const project = useStore(useMemo(() => createProjectSelectorByRef(projectRef), [projectRef]));
  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadKey, threadRef),
  );
  const terminalLaunchContext = useTerminalStateStore((state) =>
    threadRef ? (state.terminalLaunchContextByThreadKey[scopedThreadKey(threadRef)] ?? null) : null,
  );
  const storeSetTerminalOpen = useTerminalStateStore((state) => state.setTerminalOpen);
  const storeSetTerminalHeight = useTerminalStateStore((state) => state.setTerminalHeight);
  const storeSplitTerminal = useTerminalStateStore((state) => state.splitTerminal);
  const storeNewTerminal = useTerminalStateStore((state) => state.newTerminal);
  const storeSetActiveTerminal = useTerminalStateStore((state) => state.setActiveTerminal);
  const storeCloseTerminal = useTerminalStateStore((state) => state.closeTerminal);
  const keybindings = useServerKeybindings();
  const composerHandleRef = useComposerHandleContext();
  const [focusRequestId, setFocusRequestId] = useState(0);
  const worktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const effectiveWorktreePath = terminalLaunchContext?.worktreePath ?? worktreePath;
  const cwd = useMemo(
    () =>
      terminalLaunchContext?.cwd ??
      (project
        ? projectScriptCwd({
            project: { cwd: project.cwd },
            worktreePath: effectiveWorktreePath,
          })
        : null),
    [effectiveWorktreePath, project, terminalLaunchContext?.cwd],
  );
  const runtimeEnv = useMemo(
    () =>
      project
        ? projectScriptRuntimeEnv({
            project: { cwd: project.cwd },
            worktreePath: effectiveWorktreePath,
          })
        : {},
    [effectiveWorktreePath, project],
  );
  const terminalShortcutLabelOptions = useMemo(
    () => ({
      context: {
        terminalFocus: true,
        terminalOpen: true,
      },
    }),
    [],
  );
  const splitShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.split", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const newShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.new", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const closeShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.close", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );

  useEffect(() => {
    if (!threadRef || !terminalState.terminalOpen) {
      return;
    }
    storeSetTerminalOpen(threadRef, false);
  }, [storeSetTerminalOpen, terminalState.terminalOpen, threadRef]);

  const bumpFocusRequestId = useCallback(() => {
    setFocusRequestId((value) => value + 1);
  }, []);

  const splitTerminal = useCallback(() => {
    if (!threadRef) return;
    storeSplitTerminal(threadRef, `terminal-${randomUUID()}`);
    storeSetTerminalOpen(threadRef, false);
    bumpFocusRequestId();
  }, [bumpFocusRequestId, storeSetTerminalOpen, storeSplitTerminal, threadRef]);

  const createNewTerminal = useCallback(() => {
    if (!threadRef) return;
    storeNewTerminal(threadRef, `terminal-${randomUUID()}`);
    storeSetTerminalOpen(threadRef, false);
    bumpFocusRequestId();
  }, [bumpFocusRequestId, storeNewTerminal, storeSetTerminalOpen, threadRef]);

  const activateTerminal = useCallback(
    (terminalId: string) => {
      if (!threadRef) return;
      storeSetActiveTerminal(threadRef, terminalId);
      bumpFocusRequestId();
    },
    [bumpFocusRequestId, storeSetActiveTerminal, threadRef],
  );

  const setTerminalHeight = useCallback(
    (height: number) => {
      if (!threadRef) return;
      storeSetTerminalHeight(threadRef, height);
    },
    [storeSetTerminalHeight, threadRef],
  );

  const closeTerminal = useCallback(
    (terminalId: string) => {
      if (!threadRef) return;
      const api = readEnvironmentApi(threadRef.environmentId);
      if (!api) return;
      const isFinalTerminal = terminalState.terminalIds.length <= 1;
      const fallbackExitWrite = () =>
        api.terminal
          .write({ threadId: threadRef.threadId, terminalId, data: "exit\n" })
          .catch(() => undefined);

      if ("close" in api.terminal && typeof api.terminal.close === "function") {
        void (async () => {
          if (isFinalTerminal) {
            await api.terminal
              .clear({ threadId: threadRef.threadId, terminalId })
              .catch(() => undefined);
          }
          await api.terminal.close({
            threadId: threadRef.threadId,
            terminalId,
            deleteHistory: true,
          });
        })().catch(() => fallbackExitWrite());
      } else {
        void fallbackExitWrite();
      }

      storeCloseTerminal(threadRef, terminalId);
      storeSetTerminalOpen(threadRef, false);
      bumpFocusRequestId();
    },
    [
      bumpFocusRequestId,
      storeCloseTerminal,
      storeSetTerminalOpen,
      terminalState.terminalIds.length,
      threadRef,
    ],
  );

  const addTerminalContext = useCallback(
    (selection: TerminalContextSelection) => {
      composerHandleRef?.current?.addTerminalContext(selection);
    },
    [composerHandleRef],
  );

  if (!threadRef) {
    return (
      <TerminalUnavailableState
        title="Terminal unavailable"
        description="No active thread is available for this workspace terminal."
      />
    );
  }

  if (!project || !cwd) {
    return (
      <TerminalUnavailableState
        title="Terminal unavailable"
        description="This thread does not have a resolved project directory."
      />
    );
  }

  return (
    <ThreadTerminalDrawer
      threadRef={threadRef}
      threadId={threadRef.threadId as ThreadId}
      cwd={cwd}
      worktreePath={effectiveWorktreePath}
      runtimeEnv={runtimeEnv}
      layout="panel"
      visible
      height={terminalState.terminalHeight}
      terminalIds={terminalState.terminalIds}
      runningTerminalIds={terminalState.runningTerminalIds}
      activeTerminalId={terminalState.activeTerminalId}
      terminalGroups={terminalState.terminalGroups}
      activeTerminalGroupId={terminalState.activeTerminalGroupId}
      focusRequestId={focusRequestId}
      onSplitTerminal={splitTerminal}
      onNewTerminal={createNewTerminal}
      splitShortcutLabel={splitShortcutLabel ?? undefined}
      newShortcutLabel={newShortcutLabel ?? undefined}
      closeShortcutLabel={closeShortcutLabel ?? undefined}
      keybindings={keybindings}
      onActiveTerminalChange={activateTerminal}
      onCloseTerminal={closeTerminal}
      onHeightChange={setTerminalHeight}
      onAddTerminalContext={addTerminalContext}
    />
  );
}

function LauncherCard(props: {
  label: string;
  description: string;
  icon: LucideIcon;
  shortcutLabel?: string | null;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        "group flex min-h-32 w-full flex-col items-center justify-center rounded-lg border border-border/50 bg-card/35 px-5 py-6 text-center transition-colors",
        props.disabled
          ? "cursor-not-allowed opacity-45"
          : "hover:border-border hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <Icon
        className={cn(
          "size-6 text-muted-foreground transition-colors",
          !props.disabled && "group-hover:text-foreground",
        )}
      />
      <span className="mt-4 text-base font-semibold text-foreground">{props.label}</span>
      <span className="mt-1 text-sm text-muted-foreground">{props.description}</span>
      {props.shortcutLabel ? (
        <span className="mt-3 rounded-md bg-muted px-1.5 py-0.5 font-medium text-[11px] text-muted-foreground">
          {props.shortcutLabel}
        </span>
      ) : null}
    </button>
  );
}

function WorkspaceLauncher(props: {
  tabs: ReadonlyArray<WorkspaceTab>;
  activeThread: Thread | null | undefined;
  onSelectTab: (tab: WorkspaceTab) => void;
}) {
  const keybindings = useServerKeybindings();
  const filesTab: WorkspaceTab = { key: "files", label: "Files", mode: "files" };
  const reviewTab: WorkspaceTab = { key: "review", label: "Review", mode: "review" };
  const terminalTab: WorkspaceTab = { key: "terminal", label: "Terminal", mode: "terminal" };
  const filesShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "workspace.files"),
    [keybindings],
  );
  const reviewShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "workspace.review"),
    [keybindings],
  );
  const terminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "workspace.terminal"),
    [keybindings],
  );
  const agentTabs = props.tabs.filter((tab) => tab.mode === "agent");

  return (
    <ScrollArea className="h-full">
      <div className="flex min-h-full items-center justify-center p-5 sm:p-6">
        <div className="w-full max-w-lg space-y-4">
          <LauncherCard
            label="Files"
            description="Browse project files"
            icon={FolderIcon}
            shortcutLabel={filesShortcutLabel}
            onClick={() => props.onSelectTab(filesTab)}
          />
          <LauncherCard
            label="Side chat"
            description="Start a side conversation"
            icon={MessageSquarePlusIcon}
            disabled
          />
          <LauncherCard label="Browser" description="Open a website" icon={GlobeIcon} disabled />
          <LauncherCard
            label="Review"
            description="View code changes"
            icon={GitCompareIcon}
            shortcutLabel={reviewShortcutLabel}
            onClick={() => props.onSelectTab(reviewTab)}
          />
          <LauncherCard
            label="Terminal"
            description="Start an interactive shell"
            icon={TerminalIcon}
            shortcutLabel={terminalShortcutLabel}
            onClick={() => props.onSelectTab(terminalTab)}
          />
          {agentTabs.length > 0 ? (
            <div className="space-y-2 pt-1">
              {agentTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-border/50 bg-card/35 px-4 py-3 text-left transition-colors hover:border-border hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => props.onSelectTab(tab)}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/50 text-muted-foreground">
                    <BotIcon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-sm font-medium",
                        resolveSidebarStatusTextClassName(statusBucket(tab.status)),
                      )}
                      style={resolveSidebarStatusTextStyle(tab.label, { durationSeconds: 2.2 })}
                    >
                      {tab.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {statusLabel(tab.status)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </ScrollArea>
  );
}

export default function ThreadWorkspacePanel(props: {
  mode: DiffPanelMode;
  panelMode: RightPanelMode | null;
  openedPanelModes: ReadonlyArray<RightPanelMode>;
  openedAgentKeys: ReadonlyArray<string>;
  onClosePanelTab: (input: { mode: RightPanelMode; agentKey?: string }) => void;
}) {
  const { onClosePanelTab } = props;
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as Record<string, string | undefined>;
  const search = useSearch({
    strict: false,
    select: (value) => parseRightPanelRouteSearch(value),
  });
  const routeThreadRef = resolveThreadRouteRef(params);
  const activeThread = useStore(
    useMemo(() => createThreadSelectorByRef(routeThreadRef), [routeThreadRef]),
  );
  const subagents = useMemo(
    () => deriveThreadSubagents(activeThread?.activities ?? []),
    [activeThread?.activities],
  );
  const agentKey =
    search.workspaceTab === "agent" && search.workspaceAgentKey ? search.workspaceAgentKey : null;
  const activeAgent = useMemo(() => findThreadSubagent(subagents, agentKey), [agentKey, subagents]);
  const activeMode = getRightPanelMode(search) ?? props.panelMode;
  const openedPanelModes = useMemo(() => {
    if (activeMode === "files" || activeMode === "review" || activeMode === "terminal") {
      return props.openedPanelModes.includes(activeMode)
        ? props.openedPanelModes
        : [...props.openedPanelModes, activeMode];
    }
    return props.openedPanelModes;
  }, [activeMode, props.openedPanelModes]);
  const tabs = useMemo(
    () =>
      buildTabs({
        subagents,
        activeAgentKey: agentKey,
        openedAgentKeys: props.openedAgentKeys,
        openedPanelModes,
      }),
    [agentKey, openedPanelModes, props.openedAgentKeys, subagents],
  );
  const activeTabKey = activeMode === "agent" ? agentKey : activeMode;

  const navigateSearch = useCallback(
    (buildSearch: (previous: Record<string, unknown>) => Record<string, unknown>) => {
      if (params.draftId) {
        void navigate({
          to: "/draft/$draftId",
          params: { draftId: DraftId.make(params.draftId) },
          replace: true,
          search: buildSearch,
        });
        return;
      }
      if (!routeThreadRef) {
        return;
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(routeThreadRef),
        replace: true,
        search: buildSearch,
      });
    },
    [navigate, params.draftId, routeThreadRef],
  );

  const selectTab = useCallback(
    (tab: WorkspaceTab) => {
      if (tab.mode === "review") {
        navigateSearch((previous) => buildOpenReviewSearch(previous));
        return;
      }
      if (tab.mode === "files") {
        navigateSearch((previous) => buildOpenFilesSearch(previous));
        return;
      }
      if (tab.mode === "terminal") {
        navigateSearch((previous) => buildOpenTerminalSearch(previous));
        return;
      }
      if (tab.mode === "agent") {
        navigateSearch((previous) => buildOpenAgentSearch(previous, tab.agentKey));
      }
    },
    [navigateSearch],
  );
  const openLauncher = useCallback(() => {
    navigateSearch((previous) => buildOpenWorkspaceSearch(previous));
  }, [navigateSearch]);
  const closeTab = useCallback(
    (tab: WorkspaceTab) => {
      onClosePanelTab({
        mode: tab.mode,
        ...(tab.mode === "agent" ? { agentKey: tab.agentKey } : {}),
      });
    },
    [onClosePanelTab],
  );
  const onTabKeyDown = useCallback(
    (tab: WorkspaceTab, event: KeyboardEvent<HTMLButtonElement>) => {
      const currentIndex = tabs.findIndex((candidate) => candidate.key === tab.key);
      if (currentIndex < 0) {
        return;
      }
      const selectAt = (index: number) => {
        const nextTab = tabs[(index + tabs.length) % tabs.length];
        if (nextTab) {
          selectTab(nextTab);
        }
      };

      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          event.preventDefault();
          selectAt(currentIndex + 1);
          return;
        case "ArrowLeft":
        case "ArrowUp":
          event.preventDefault();
          selectAt(currentIndex - 1);
          return;
        case "Home":
          event.preventDefault();
          selectAt(0);
          return;
        case "End":
          event.preventDefault();
          selectAt(tabs.length - 1);
          return;
      }
    },
    [selectTab, tabs],
  );

  const closePanel = useCallback(() => {
    navigateSearch((previous) => ({
      ...stripWorkspacePanelSearchParams(previous),
      diff: undefined,
      diffTurnId: undefined,
      diffFilePath: undefined,
      preview: undefined,
      workspaceOpen: undefined,
      workspaceTab: undefined,
      workspaceAgentKey: undefined,
    }));
  }, [navigateSearch]);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-background w-full">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-card/40 px-2">
        <div
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          role="tablist"
          aria-label="Workspace tabs"
        >
          {tabs.map((tab) => {
            const active = activeTabKey === tab.key;
            return (
              <div
                key={tab.key}
                className={cn(
                  "flex h-8 min-w-0 shrink-0 items-center rounded-md text-sm transition-colors",
                  active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  id={workspaceTabId(tab.key)}
                  role="tab"
                  aria-selected={active}
                  aria-controls={workspaceTabPanelId(tab.key)}
                  tabIndex={active ? 0 : -1}
                  className="flex h-full min-w-0 items-center gap-1.5 pl-2.5 pr-1"
                  onClick={() => selectTab(tab)}
                  onKeyDown={(event) => onTabKeyDown(tab, event)}
                >
                  <TabIcon tab={tab} active={active} />
                  <span
                    className={cn(
                      "max-w-32 truncate",
                      tab.mode === "agent" &&
                        resolveSidebarStatusTextClassName(statusBucket(tab.status)),
                    )}
                    style={
                      tab.mode === "agent"
                        ? resolveSidebarStatusTextStyle(tab.label, { durationSeconds: 2.2 })
                        : undefined
                    }
                  >
                    {tab.label}
                  </span>
                </button>
                <button
                  type="button"
                  className="mr-1 flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-background/60 hover:text-foreground"
                  aria-label={`Close ${tab.label} tab`}
                  onClick={() => closeTab(tab)}
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            );
          })}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-foreground",
                    !activeMode && "bg-muted text-foreground",
                  )}
                  aria-label="Workspace launcher"
                  aria-pressed={!activeMode}
                  onClick={openLauncher}
                />
              }
            >
              <PlusIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">Workspace launcher</TooltipPopup>
          </Tooltip>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          className="shrink-0 text-muted-foreground/70 hover:text-foreground"
          onClick={closePanel}
          aria-label="Close workspace panel"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        id={workspaceTabPanelId(activeTabKey)}
        role="tabpanel"
        aria-labelledby={activeTabKey ? workspaceTabId(activeTabKey) : undefined}
      >
        {activeMode === "review" ? (
          <DiffPanel mode={props.mode} />
        ) : activeMode === "files" ? (
          <PreviewPanel mode={props.mode} />
        ) : activeMode === "terminal" ? (
          <WorkspaceTerminalPanel />
        ) : activeMode === "agent" ? (
          <AgentThreadPanel subagent={activeAgent} agentKey={agentKey} />
        ) : (
          <WorkspaceLauncher tabs={tabs} activeThread={activeThread} onSelectTab={selectTab} />
        )}
      </div>
    </div>
  );
}
