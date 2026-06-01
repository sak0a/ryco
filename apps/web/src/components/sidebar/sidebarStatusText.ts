import type { CSSProperties } from "react";
import { cn } from "../../lib/utils";
import { type SidebarStatusBucket, type ThreadStatusPill } from "../Sidebar.logic";

const SIDEBAR_STATUS_TEXT_CLASSNAMES: Record<SidebarStatusBucket, string> = {
  done: "sidebar-status-text sidebar-status-text--done",
  idle: "",
  in_progress: "sidebar-status-text sidebar-status-text--in-progress sidebar-status-text--shimmer",
  review: "sidebar-status-text sidebar-status-text--review sidebar-status-text--shimmer",
};

const THREAD_STATUS_TEXT_CLASSNAMES: Record<ThreadStatusPill["label"], string> = {
  "Awaiting Input":
    "sidebar-status-text sidebar-status-text--awaiting-input sidebar-status-text--shimmer",
  Completed: "sidebar-status-text sidebar-status-text--done",
  Connecting: "sidebar-status-text sidebar-status-text--in-progress sidebar-status-text--shimmer",
  "Pending Approval":
    "sidebar-status-text sidebar-status-text--pending-approval sidebar-status-text--shimmer",
  "Plan Ready": "sidebar-status-text sidebar-status-text--plan-ready sidebar-status-text--shimmer",
  Working: "sidebar-status-text sidebar-status-text--in-progress sidebar-status-text--shimmer",
};

export function resolveSidebarStatusTextClassName(
  bucket: SidebarStatusBucket,
  className?: string,
): string {
  return cn(className, SIDEBAR_STATUS_TEXT_CLASSNAMES[bucket]);
}

export function resolveThreadStatusTextClassName(
  status: ThreadStatusPill | null,
  className?: string,
): string {
  if (status === null) {
    return cn(className);
  }

  return cn(className, THREAD_STATUS_TEXT_CLASSNAMES[status.label]);
}

export function resolveSidebarStatusTextStyle(
  text: string,
  options?: {
    durationSeconds?: number;
    spreadPerCharacterPx?: number;
  },
): CSSProperties {
  const durationSeconds = options?.durationSeconds ?? 2;
  const spreadPerCharacterPx = options?.spreadPerCharacterPx ?? 2;
  const spreadPx = Math.max(12, Math.round(text.length * spreadPerCharacterPx));

  return {
    "--sidebar-status-text-duration": `${durationSeconds}s`,
    "--sidebar-status-text-spread": `${spreadPx}px`,
  } as CSSProperties;
}
