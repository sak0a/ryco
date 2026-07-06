import { CircleDotIcon, GitBranchIcon } from "lucide-react";
import { memo } from "react";
import type { ChatContextAttachment } from "../../types";
import { AtlassianJiraIcon } from "../Icons";
import { cn } from "~/lib/utils";

const STATE_BADGE_CLASS_NAMES: Record<string, string> = {
  open: "bg-success/15 text-success",
  merged: "bg-info/15 text-info-foreground",
  closed: "bg-destructive/15 text-destructive",
  draft: "bg-muted text-muted-foreground",
};

function stateBadgeClassName(state: string): string {
  return STATE_BADGE_CLASS_NAMES[state.toLowerCase()] ?? "bg-info/15 text-info-foreground";
}

function contextIcon(kind: ChatContextAttachment["kind"]) {
  if (kind === "work-item") return AtlassianJiraIcon;
  if (kind === "change-request") return GitBranchIcon;
  return CircleDotIcon;
}

/**
 * Read-only chip row rendered above a sent user message for its persisted
 * context attachments. The chip shows the snapshot from send time; clicking
 * opens the live detail via `onOpen`.
 */
export const TimelineContextChips = memo(function TimelineContextChips(props: {
  attachments: ReadonlyArray<ChatContextAttachment>;
  onOpen: (attachment: ChatContextAttachment) => void;
}) {
  if (props.attachments.length === 0) return null;
  return (
    <div className="mb-1 flex flex-wrap justify-end gap-1.5">
      {props.attachments.map((attachment) => {
        const Icon = contextIcon(attachment.kind);
        return (
          <button
            key={attachment.id}
            type="button"
            onClick={() => props.onOpen(attachment)}
            title={attachment.title}
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background/60 py-0.5 pl-2 pr-2.5 text-[11px] leading-tight",
              "transition-colors hover:bg-foreground/5",
            )}
            data-context-attachment-id={attachment.id}
          >
            <Icon className="size-3 shrink-0 text-muted-foreground/80" aria-hidden="true" />
            <span className="shrink-0 font-mono text-muted-foreground">{attachment.reference}</span>
            <span className="min-w-0 truncate text-foreground/85">{attachment.title}</span>
            <span
              className={cn(
                "ml-0.5 shrink-0 rounded-sm px-1 text-[9px] font-semibold uppercase",
                stateBadgeClassName(attachment.state),
              )}
            >
              {attachment.state}
            </span>
          </button>
        );
      })}
    </div>
  );
});
