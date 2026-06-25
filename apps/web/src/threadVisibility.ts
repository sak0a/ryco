import type { SidebarThreadSummary, ThreadShell } from "./types";

type ThreadVisibilityInput = Pick<SidebarThreadSummary | ThreadShell, "threadKind" | "visibility">;

export function isNormalThreadVisibility(thread: ThreadVisibilityInput): boolean {
  return thread.visibility !== "nested" && thread.threadKind !== "managed-subagent";
}
