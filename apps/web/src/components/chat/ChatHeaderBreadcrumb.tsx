import { ChevronRightIcon } from "lucide-react";
import { memo } from "react";
import { cn } from "~/lib/utils";
import {
  shouldShowWorktreeBreadcrumbSegment,
  type WorktreeOriginLike,
} from "./ChatSessionTabs.logic";

export interface ChatHeaderBreadcrumbProps {
  projectName: string | null | undefined;
  worktreeBranch: string | null | undefined;
  worktreeTitle: string | null | undefined;
  worktreeOrigin: WorktreeOriginLike;
  sessionTitle: string;
  onSelectProject?: (() => void) | undefined;
  onSelectWorktree?: (() => void) | undefined;
}

export const ChatHeaderBreadcrumb = memo(function ChatHeaderBreadcrumb(
  props: ChatHeaderBreadcrumbProps,
) {
  const showWorktree = shouldShowWorktreeBreadcrumbSegment({
    origin: props.worktreeOrigin,
    branch: props.worktreeBranch,
  });
  const worktreeLabel = (props.worktreeTitle?.trim() || props.worktreeBranch?.trim()) ?? null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium"
    >
      {props.projectName ? (
        <Segment label={props.projectName} onSelect={props.onSelectProject} prominent />
      ) : null}
      {showWorktree && worktreeLabel ? (
        <>
          <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
          <Segment label={worktreeLabel} onSelect={props.onSelectWorktree} mono />
        </>
      ) : null}
      <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
      <span className="min-w-0 truncate text-foreground/85" title={props.sessionTitle}>
        {props.sessionTitle}
      </span>
    </nav>
  );
});

function Segment(props: {
  label: string;
  onSelect: (() => void) | undefined;
  prominent?: boolean;
  mono?: boolean;
}) {
  const text = (
    <span
      className={cn("min-w-0 truncate", props.mono ? "font-mono text-xs" : "")}
      title={props.label}
    >
      {props.label}
    </span>
  );
  if (props.onSelect) {
    return (
      <button
        type="button"
        onClick={props.onSelect}
        className={cn(
          "inline-flex min-w-0 items-center rounded-md px-1 py-0.5 -mx-1 text-foreground/80 hover:bg-accent/50 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
          props.prominent ? "text-foreground" : "",
        )}
      >
        {text}
      </button>
    );
  }
  return (
    <span className={cn("min-w-0", props.prominent ? "text-foreground" : "text-foreground/80")}>
      {text}
    </span>
  );
}
