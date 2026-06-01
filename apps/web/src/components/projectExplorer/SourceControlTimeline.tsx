import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export type SourceControlTimelineTone =
  | "body"
  | "comment"
  | "review"
  | "system"
  | "workflow"
  | "composer";

interface SourceControlTimelineProps {
  children: ReactNode;
  className?: string | undefined;
}

export function SourceControlTimeline({ children, className }: SourceControlTimelineProps) {
  return (
    <ol
      className={cn(
        "relative space-y-4 before:absolute before:top-5 before:bottom-5 before:left-4 before:w-px before:bg-border/70",
        className,
      )}
    >
      {children}
    </ol>
  );
}

export function SourceControlTimelineEntry(props: {
  tone: SourceControlTimelineTone;
  icon: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <li className={cn("relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3", props.className)}>
      <span
        className={cn(
          "relative z-10 flex size-8 items-center justify-center rounded-lg border bg-background shadow-xs",
          timelineMarkerToneClassName(props.tone),
        )}
        aria-hidden
      >
        {props.icon}
      </span>
      <div className="min-w-0 pb-1">{props.children}</div>
    </li>
  );
}

export function SourceControlTimelineNotice(props: {
  tone: Exclude<SourceControlTimelineTone, "body" | "comment" | "review" | "composer">;
  title: string;
  description?: string | undefined;
  children?: ReactNode | undefined;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border px-3 py-2.5 text-sm",
        timelineNoticeToneClassName(props.tone),
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="font-medium text-foreground/90 text-sm">{props.title}</h3>
        {props.description ? (
          <p className="min-w-0 text-muted-foreground text-xs">{props.description}</p>
        ) : null}
      </div>
      {props.children ? <div className="mt-2">{props.children}</div> : null}
    </section>
  );
}

function timelineMarkerToneClassName(tone: SourceControlTimelineTone): string {
  switch (tone) {
    case "body":
      return "border-primary/28 bg-primary/8 text-primary";
    case "review":
      return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "system":
      return "border-violet-500/28 bg-violet-500/10 text-violet-700 dark:text-violet-300";
    case "workflow":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "composer":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "comment":
      return "border-border/70 bg-muted/40 text-muted-foreground";
  }
}

function timelineNoticeToneClassName(tone: "system" | "workflow"): string {
  switch (tone) {
    case "system":
      return "border-violet-500/22 bg-violet-500/6";
    case "workflow":
      return "border-amber-500/24 bg-amber-500/7";
  }
}
