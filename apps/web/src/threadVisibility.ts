import type { ThreadKind, ThreadVisibility } from "@ryco/contracts";

interface ThreadVisibilityInput {
  readonly threadKind?: ThreadKind | undefined;
  readonly visibility?: ThreadVisibility | undefined;
}

export function isNormalThreadVisibility(thread: ThreadVisibilityInput): boolean {
  return thread.visibility !== "nested" && thread.threadKind !== "managed-subagent";
}
