import { memo, useCallback, useMemo, useState } from "react";
import {
  ArchiveIcon,
  ChevronRightIcon,
  CopyIcon,
  Edit3Icon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import {
  resolveStateBadgeVariant,
  type StateBadgeVariant,
} from "../sourceControl/stateBadgeVariants";
import { scopedThreadKey, scopeThreadRef } from "@ryco/client-runtime";
import { cn } from "../../lib/utils";
import {
  ContextMenu,
  ContextMenuPopup,
  ContextMenuTrigger,
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { SidebarMenuSub, SidebarMenuSubItem } from "../ui/sidebar";
import type { SidebarStatusBucket } from "../Sidebar.logic";
import {
  normalizeWorktreePath,
  type SidebarTreeProject,
  type SidebarTreeThread,
  type SidebarTreeWorktree,
  type SidebarWorktree,
} from "./hooks/useSidebarTree";
import { LinkedWorktreeItemDialog, type LinkedWorktreeItem } from "./LinkedWorktreeItemDialog";

const WORKTREE_STATUS_CLASSNAMES: Record<SidebarStatusBucket, string> = {
  done: "bg-muted-foreground/45",
  idle: "bg-muted-foreground/30",
  in_progress: "bg-sky-500 dark:bg-sky-300/80",
  review: "bg-amber-500 dark:bg-amber-300/90",
};
const WORKTREE_STATUS_LABELS: Record<SidebarStatusBucket, string> = {
  done: "Done",
  idle: "Idle",
  in_progress: "In progress",
  review: "Review",
};

export interface SidebarWorktreeListProps {
  attachThreadListAutoAnimateRef: (node: HTMLElement | null) => void;
  projectExpanded: boolean;
  renderThread: (
    thread: SidebarTreeThread,
    orderedProjectThreadKeys: readonly string[],
  ) => React.ReactNode;
  treeProject: SidebarTreeProject;
  visibleThreadKeys: ReadonlySet<string> | null;
  onArchiveWorktree: (worktree: SidebarTreeWorktree) => void;
  onCopyWorktreePath: (worktree: SidebarTreeWorktree) => void;
  onDeleteWorktree: (worktree: SidebarTreeWorktree) => void;
  onNewSession: (worktree: SidebarTreeWorktree) => void;
  onOpenInEditor: (worktree: SidebarTreeWorktree) => void;
  onOpenWorktree: (worktree: SidebarTreeWorktree) => void;
  onRenameWorktree: (worktree: SidebarTreeWorktree, title: string) => Promise<void> | void;
  onRestoreWorktree: (worktree: SidebarTreeWorktree) => void;
}

export const SidebarWorktreeList = memo(function SidebarWorktreeList(
  props: SidebarWorktreeListProps,
) {
  const orderedProjectThreadKeys = useMemo(
    () => getOrderedThreadKeys(props.treeProject, props.visibleThreadKeys),
    [props.treeProject, props.visibleThreadKeys],
  );
  const visibleWorktrees = useMemo(
    () =>
      props.treeProject.worktrees.filter((worktree) => {
        if (props.projectExpanded) {
          return true;
        }
        return getVisibleThreadsForWorktree(worktree, props.visibleThreadKeys).length > 0;
      }),
    [props.projectExpanded, props.treeProject.worktrees, props.visibleThreadKeys],
  );
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [linkedItem, setLinkedItem] = useState<LinkedWorktreeItem | null>(null);

  const handleOpenLinkedItem = useCallback((next: LinkedWorktreeItem) => {
    setLinkedItem(next);
  }, []);
  const handleLinkedItemDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setLinkedItem(null);
    }
  }, []);

  if (visibleWorktrees.length === 0 && props.treeProject.archivedWorktrees.length === 0) {
    return null;
  }

  return (
    <>
      <SidebarMenuSub
        ref={props.attachThreadListAutoAnimateRef}
        className="mx-1 my-0 w-full translate-x-0 gap-0.5 overflow-hidden px-1.5 py-0"
      >
        {visibleWorktrees.map((worktree) => (
          <SidebarWorktreeSection
            key={worktree.worktree.worktreeId}
            orderedProjectThreadKeys={orderedProjectThreadKeys}
            projectCwd={props.treeProject.project.cwd}
            projectExpanded={props.projectExpanded}
            renderThread={props.renderThread}
            visibleThreadKeys={props.visibleThreadKeys}
            worktree={worktree}
            onArchiveWorktree={props.onArchiveWorktree}
            onCopyWorktreePath={props.onCopyWorktreePath}
            onDeleteWorktree={props.onDeleteWorktree}
            onNewSession={props.onNewSession}
            onOpenInEditor={props.onOpenInEditor}
            onOpenLinkedItem={handleOpenLinkedItem}
            onOpenWorktree={props.onOpenWorktree}
            onRenameWorktree={props.onRenameWorktree}
          />
        ))}
        {props.treeProject.archivedWorktrees.length > 0 ? (
          <>
            <SidebarMenuSubItem className="w-full" data-thread-selection-safe>
              <button
                type="button"
                className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => setArchivedOpen((open) => !open)}
              >
                <ChevronRightIcon className={archivedOpen ? "size-3 rotate-90" : "size-3"} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  Archived ({props.treeProject.archivedWorktrees.length})
                </span>
              </button>
            </SidebarMenuSubItem>
            {archivedOpen
              ? props.treeProject.archivedWorktrees.map((worktree) => (
                  <ArchivedWorktreeRow
                    key={worktree.worktree.worktreeId}
                    projectCwd={props.treeProject.project.cwd}
                    worktree={worktree}
                    onDeleteWorktree={props.onDeleteWorktree}
                    onOpenLinkedItem={handleOpenLinkedItem}
                    onRestoreWorktree={props.onRestoreWorktree}
                  />
                ))
              : null}
          </>
        ) : null}
      </SidebarMenuSub>
      <LinkedWorktreeItemDialog
        open={linkedItem !== null}
        item={linkedItem}
        environmentId={props.treeProject.project.environmentId}
        cwd={props.treeProject.project.cwd}
        onOpenChange={handleLinkedItemDialogOpenChange}
      />
    </>
  );
});

function ArchivedWorktreeRow(props: {
  projectCwd: string;
  worktree: SidebarTreeWorktree;
  onDeleteWorktree: (worktree: SidebarTreeWorktree) => void;
  onOpenLinkedItem: (item: LinkedWorktreeItem) => void;
  onRestoreWorktree: (worktree: SidebarTreeWorktree) => void;
}) {
  const isProjectRoot = isProjectRootWorktree(props.worktree.worktree, props.projectCwd);
  return (
    <SidebarMenuSubItem className="w-full" data-thread-selection-safe>
      <div className="ml-3 flex h-7 items-center gap-1.5 rounded-md px-2 text-muted-foreground">
        <ArchiveIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs">
          {getWorktreeDisplayTitle(props.worktree)}
        </span>
        <WorktreeSourceControlBadges
          worktree={props.worktree}
          onOpenLinkedItem={props.onOpenLinkedItem}
        />
        <button
          type="button"
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-secondary hover:text-foreground"
          aria-label={`Restore ${props.worktree.worktree.branch}`}
          onClick={() => props.onRestoreWorktree(props.worktree)}
        >
          <RotateCcwIcon className="size-3.5" />
        </button>
        {isProjectRoot ? null : (
          <button
            type="button"
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-secondary hover:text-destructive"
            aria-label={`Delete ${props.worktree.worktree.branch}`}
            onClick={() => props.onDeleteWorktree(props.worktree)}
          >
            <Trash2Icon className="size-3.5" />
          </button>
        )}
      </div>
    </SidebarMenuSubItem>
  );
}

const SidebarWorktreeSection = memo(function SidebarWorktreeSection(props: {
  orderedProjectThreadKeys: readonly string[];
  projectCwd: string;
  projectExpanded: boolean;
  renderThread: (
    thread: SidebarTreeThread,
    orderedProjectThreadKeys: readonly string[],
  ) => React.ReactNode;
  visibleThreadKeys: ReadonlySet<string> | null;
  worktree: SidebarTreeWorktree;
  onArchiveWorktree: (worktree: SidebarTreeWorktree) => void;
  onCopyWorktreePath: (worktree: SidebarTreeWorktree) => void;
  onDeleteWorktree: (worktree: SidebarTreeWorktree) => void;
  onNewSession: (worktree: SidebarTreeWorktree) => void;
  onOpenInEditor: (worktree: SidebarTreeWorktree) => void;
  onOpenLinkedItem: (item: LinkedWorktreeItem) => void;
  onOpenWorktree: (worktree: SidebarTreeWorktree) => void;
  onRenameWorktree: (worktree: SidebarTreeWorktree, title: string) => Promise<void> | void;
}) {
  const isProjectRoot = isProjectRootWorktree(props.worktree.worktree, props.projectCwd);
  const visibleThreads = useMemo(
    () =>
      props.worktree.sessions.filter((thread) =>
        shouldRenderThread(thread, props.visibleThreadKeys),
      ),
    [props.visibleThreadKeys, props.worktree.sessions],
  );
  const [collapsed, setCollapsed] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(() => getWorktreeDisplayTitle(props.worktree));
  const isCollapsed = props.visibleThreadKeys ? false : collapsed;
  const showEmptyState = props.projectExpanded && !isCollapsed && visibleThreads.length === 0;
  const showSessions = !isCollapsed;
  const toggleCollapsed = () => setCollapsed((open) => !open);
  const displayTitle = getWorktreeDisplayTitle(props.worktree);
  const startRename = () => {
    setRenameTitle(displayTitle);
    setRenaming(true);
  };
  const cancelRename = () => {
    setRenameTitle(displayTitle);
    setRenaming(false);
  };
  const commitRename = () => {
    const trimmed = renameTitle.trim();
    if (trimmed.length === 0 || trimmed === displayTitle) {
      cancelRename();
      return;
    }
    void Promise.resolve(props.onRenameWorktree(props.worktree, trimmed)).finally(() => {
      setRenaming(false);
    });
  };

  return (
    <>
      <SidebarMenuSubItem className="w-full" data-thread-selection-safe>
        <ContextMenu>
          <ContextMenuTrigger
            render={
              <div
                role="button"
                tabIndex={0}
                aria-expanded={!isCollapsed}
                className="group/worktree flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => props.onOpenWorktree(props.worktree)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    setCollapsed(true);
                    return;
                  }
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    setCollapsed(false);
                    return;
                  }
                  if (event.key !== "Enter" && event.key !== " ") {
                    return;
                  }
                  event.preventDefault();
                  props.onOpenWorktree(props.worktree);
                }}
              />
            }
          >
            <button
              type="button"
              aria-label={
                isCollapsed
                  ? `Expand ${props.worktree.worktree.branch}`
                  : `Collapse ${props.worktree.worktree.branch}`
              }
              className="-ml-1 inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-secondary hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleCollapsed();
              }}
            >
              <ChevronRightIcon
                className={cn(
                  "size-3.5 transition-transform duration-150",
                  isCollapsed ? "" : "rotate-90",
                )}
              />
            </button>
            <span
              className={cn(
                "inline-flex size-3 shrink-0 items-center justify-center",
                props.worktree.aggregateStatus === "in_progress" ? "animate-pulse" : "",
              )}
              title={WORKTREE_STATUS_LABELS[props.worktree.aggregateStatus]}
              aria-hidden={props.worktree.aggregateStatus === "idle"}
            >
              {props.worktree.aggregateStatus === "idle" ? null : (
                <span
                  className={cn(
                    "size-2 rounded-full",
                    WORKTREE_STATUS_CLASSNAMES[props.worktree.aggregateStatus],
                  )}
                />
              )}
            </span>
            {renaming ? (
              <input
                value={renameTitle}
                className="min-w-0 flex-1 rounded-sm border border-border bg-background px-1 py-0.5 text-xs font-medium text-foreground outline-hidden focus:border-ring"
                autoFocus
                onBlur={commitRename}
                onChange={(event) => setRenameTitle(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitRename();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelRename();
                  }
                }}
              />
            ) : (
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span
                  className="min-w-0 truncate text-xs font-medium text-foreground/85"
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    startRename();
                  }}
                >
                  {displayTitle}
                </span>
                <WorktreeSourceControlBadges
                  worktree={props.worktree}
                  onOpenLinkedItem={props.onOpenLinkedItem}
                />
              </span>
            )}
            <WorktreeOriginLabel worktree={props.worktree} />
            <WorktreeDiffStats worktree={props.worktree} />
            {props.worktree.shouldSuggestArchive && !isProjectRoot ? (
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  props.onArchiveWorktree(props.worktree);
                }}
              >
                <ArchiveIcon className="size-3" />
                Archive?
              </button>
            ) : null}
            <button
              type="button"
              aria-label={`New session in ${props.worktree.worktree.branch}`}
              className="ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/55 opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover/worktree:opacity-100 group-focus-within/worktree:opacity-100 max-sm:opacity-100"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                props.onNewSession(props.worktree);
              }}
            >
              <PlusIcon className="size-3.5" />
            </button>
            <WorktreeMenu
              isProjectRoot={isProjectRoot}
              worktree={props.worktree}
              onArchiveWorktree={props.onArchiveWorktree}
              onCopyWorktreePath={props.onCopyWorktreePath}
              onDeleteWorktree={props.onDeleteWorktree}
              onNewSession={props.onNewSession}
              onOpenInEditor={props.onOpenInEditor}
              onRenameWorktree={startRename}
            />
          </ContextMenuTrigger>
          <ContextMenuPopup align="start" side="bottom" className="min-w-48">
            <WorktreeMenuItems
              isProjectRoot={isProjectRoot}
              worktree={props.worktree}
              onArchiveWorktree={props.onArchiveWorktree}
              onCopyWorktreePath={props.onCopyWorktreePath}
              onDeleteWorktree={props.onDeleteWorktree}
              onNewSession={props.onNewSession}
              onOpenInEditor={props.onOpenInEditor}
              onRenameWorktree={startRename}
            />
          </ContextMenuPopup>
        </ContextMenu>
      </SidebarMenuSubItem>

      {showEmptyState ? (
        <SidebarMenuSubItem className="w-full" data-thread-selection-safe>
          <div className="ml-5 flex h-6 items-center border-l border-sidebar-border/70 px-4 text-[10px] text-muted-foreground/60">
            No sessions yet
          </div>
        </SidebarMenuSubItem>
      ) : null}
      {showSessions
        ? visibleThreads.map((thread) => props.renderThread(thread, props.orderedProjectThreadKeys))
        : null}
    </>
  );
});

function WorktreeMenuItems(props: {
  isProjectRoot: boolean;
  worktree: SidebarTreeWorktree;
  onArchiveWorktree: (worktree: SidebarTreeWorktree) => void;
  onCopyWorktreePath: (worktree: SidebarTreeWorktree) => void;
  onDeleteWorktree: (worktree: SidebarTreeWorktree) => void;
  onNewSession: (worktree: SidebarTreeWorktree) => void;
  onOpenInEditor: (worktree: SidebarTreeWorktree) => void;
  onRenameWorktree: () => void;
}) {
  return (
    <>
      <MenuItem onClick={() => props.onNewSession(props.worktree)}>
        <PlusIcon className="size-4" />
        New session here
      </MenuItem>
      <MenuItem onClick={props.onRenameWorktree}>
        <Edit3Icon className="size-4" />
        Rename worktree
      </MenuItem>
      <MenuItem onClick={() => props.onOpenInEditor(props.worktree)}>
        <ExternalLinkIcon className="size-4" />
        Open in editor
      </MenuItem>
      <MenuItem onClick={() => props.onCopyWorktreePath(props.worktree)}>
        <CopyIcon className="size-4" />
        Copy path
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        disabled={props.isProjectRoot}
        onClick={() => props.onArchiveWorktree(props.worktree)}
      >
        <ArchiveIcon className="size-4" />
        Archive worktree
      </MenuItem>
      <MenuItem
        disabled={props.isProjectRoot}
        variant="destructive"
        onClick={() => props.onDeleteWorktree(props.worktree)}
      >
        <Trash2Icon className="size-4" />
        Delete worktree
      </MenuItem>
    </>
  );
}

function WorktreeMenu(props: {
  isProjectRoot: boolean;
  worktree: SidebarTreeWorktree;
  onArchiveWorktree: (worktree: SidebarTreeWorktree) => void;
  onCopyWorktreePath: (worktree: SidebarTreeWorktree) => void;
  onDeleteWorktree: (worktree: SidebarTreeWorktree) => void;
  onNewSession: (worktree: SidebarTreeWorktree) => void;
  onOpenInEditor: (worktree: SidebarTreeWorktree) => void;
  onRenameWorktree: () => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/55 opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover/worktree:opacity-100 group-focus-within/worktree:opacity-100 max-sm:opacity-100"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        aria-label={`Worktree actions for ${props.worktree.worktree.branch}`}
      >
        <MoreHorizontalIcon className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end" side="bottom" className="min-w-48">
        <WorktreeMenuItems
          isProjectRoot={props.isProjectRoot}
          worktree={props.worktree}
          onArchiveWorktree={props.onArchiveWorktree}
          onCopyWorktreePath={props.onCopyWorktreePath}
          onDeleteWorktree={props.onDeleteWorktree}
          onNewSession={props.onNewSession}
          onOpenInEditor={props.onOpenInEditor}
          onRenameWorktree={props.onRenameWorktree}
        />
      </MenuPopup>
    </Menu>
  );
}

function WorktreeOriginLabel({ worktree }: { worktree: SidebarTreeWorktree }) {
  const origin = worktree.worktree.origin;
  if (origin === "main" || origin === "branch") {
    return null;
  }
  if (origin === "pr" && worktree.worktree.prNumber != null) {
    return null;
  }
  if (origin === "issue" && worktree.worktree.issueNumber != null) {
    return null;
  }
  const label = origin === "pr" ? "PR" : origin === "issue" ? "Issue" : "Manual";
  return (
    <span className="shrink-0 rounded-sm bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
      {label}
    </span>
  );
}

function WorktreeSourceControlBadges({
  worktree,
  onOpenLinkedItem,
}: {
  worktree: SidebarTreeWorktree;
  onOpenLinkedItem?: (item: LinkedWorktreeItem) => void;
}) {
  const issueNumber = worktree.worktree.issueNumber ?? null;
  const prNumber = worktree.worktree.prNumber ?? null;

  if (issueNumber === null && prNumber === null) {
    return null;
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {issueNumber !== null ? (
        <WorktreeSourceControlBadge
          variant={resolveStateBadgeVariant({
            kind: "issue",
            state: worktree.worktree.issueState ?? null,
          })}
          number={issueNumber}
          kindLabel="Issue"
          onClick={
            onOpenLinkedItem
              ? () => onOpenLinkedItem({ kind: "issue", number: issueNumber })
              : undefined
          }
        />
      ) : null}
      {prNumber !== null ? (
        <WorktreeSourceControlBadge
          variant={resolveStateBadgeVariant({
            kind: "pr",
            state: worktree.worktree.prState ?? null,
            isDraft: worktree.worktree.prIsDraft ?? null,
          })}
          number={prNumber}
          kindLabel="Pull request"
          onClick={
            onOpenLinkedItem ? () => onOpenLinkedItem({ kind: "pr", number: prNumber }) : undefined
          }
        />
      ) : null}
    </span>
  );
}

function WorktreeSourceControlBadge(props: {
  variant: StateBadgeVariant;
  number: number;
  kindLabel: string;
  onClick?: (() => void) | undefined;
}) {
  const Icon = props.variant.Icon;
  const title = props.variant.label
    ? `${props.kindLabel} #${props.number} — ${props.variant.label}`
    : `${props.kindLabel} #${props.number}`;
  const baseClass =
    "inline-flex h-4 shrink-0 items-center justify-center gap-0.5 rounded-sm border px-1 text-[9px] font-semibold tabular-nums leading-none";

  if (props.onClick) {
    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      props.onClick?.();
    };
    return (
      <button
        type="button"
        className={cn(
          baseClass,
          props.variant.compactClassName,
          "cursor-pointer hover:brightness-125 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-current",
        )}
        title={title}
        aria-label={title}
        onClick={handleClick}
      >
        <Icon className="size-2.5" />
        <span>#{props.number}</span>
      </button>
    );
  }

  return (
    <span
      className={cn(baseClass, props.variant.compactClassName)}
      title={title}
      aria-label={title}
    >
      <Icon className="size-2.5" />
      <span>#{props.number}</span>
    </span>
  );
}

function getWorktreeDisplayTitle(worktree: SidebarTreeWorktree): string {
  return worktree.worktree.title ?? worktree.worktree.branch;
}

function isProjectRootWorktree(worktree: SidebarWorktree, projectCwd: string): boolean {
  if (worktree.origin === "main") return true;
  if (worktree.worktreePath === null) return true;
  return normalizeWorktreePath(worktree.worktreePath) === normalizeWorktreePath(projectCwd);
}

function WorktreeDiffStats({ worktree }: { worktree: SidebarTreeWorktree }) {
  if (!worktree.diffStats) {
    return null;
  }
  return (
    <span className="shrink-0 text-[10px] text-muted-foreground/70">
      +{worktree.diffStats.added} / -{worktree.diffStats.removed}
    </span>
  );
}

function getOrderedThreadKeys(
  treeProject: SidebarTreeProject,
  visibleThreadKeys: ReadonlySet<string> | null,
): string[] {
  return treeProject.worktrees.flatMap((worktree) =>
    worktree.sessions
      .filter((thread) => shouldRenderThread(thread, visibleThreadKeys))
      .map((thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
  );
}

function getVisibleThreadsForWorktree(
  worktree: SidebarTreeWorktree,
  visibleThreadKeys: ReadonlySet<string> | null,
): SidebarTreeThread[] {
  return worktree.sessions.filter((thread) => shouldRenderThread(thread, visibleThreadKeys));
}

function shouldRenderThread(
  thread: SidebarTreeThread,
  visibleThreadKeys: ReadonlySet<string> | null,
): boolean {
  if (thread.archivedAt !== null) {
    return false;
  }
  if (!visibleThreadKeys) {
    return true;
  }
  return visibleThreadKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)));
}
