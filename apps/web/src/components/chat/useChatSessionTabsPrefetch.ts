import { useEffect } from "react";
import { parseScopedThreadKey } from "@ryco/client-runtime/scoped";
import { retainThreadDetailSubscription } from "../../environments/runtime/service";
import { markTabSwitchFirstPaint } from "../../perf/tabSwitchInstrumentation";
import type { SessionTabItem } from "../../sessionTabs.selectors";

export interface UseChatSessionTabsPrefetchInput {
  activeWorktreeSessionTabs: ReadonlyArray<SessionTabItem>;
  activeSessionTabKey: string | null;
}

export const MAX_SPECULATIVE_SIBLING_TAB_PREFETCH = 6;

export function selectSpeculativeSiblingTabPrefetchKeys(
  activeWorktreeSessionTabs: ReadonlyArray<SessionTabItem>,
  activeSessionTabKey: string | null,
  limit = MAX_SPECULATIVE_SIBLING_TAB_PREFETCH,
): ReadonlyArray<string> {
  if (limit <= 0 || activeWorktreeSessionTabs.length === 0) {
    return [];
  }

  const cappedLimit = Math.floor(limit);
  const activeIndex =
    activeSessionTabKey === null
      ? -1
      : activeWorktreeSessionTabs.findIndex((tab) => tab.key === activeSessionTabKey);
  if (activeIndex < 0) {
    return activeWorktreeSessionTabs
      .map((tab) => tab.key)
      .filter((key) => key !== activeSessionTabKey)
      .slice(0, cappedLimit);
  }

  const keys: string[] = [];
  for (let offset = 1; keys.length < cappedLimit; offset += 1) {
    const left = activeWorktreeSessionTabs[activeIndex - offset];
    const right = activeWorktreeSessionTabs[activeIndex + offset];
    if (!left && !right) {
      break;
    }
    if (left) {
      keys.push(left.key);
      if (keys.length >= cappedLimit) {
        break;
      }
    }
    if (right) {
      keys.push(right.key);
    }
  }

  return keys;
}

/**
 * Speculatively warms WS subscriptions for nearby sibling sessions in the
 * active worktree and records the first-paint perf mark when the active
 * session changes.
 */
export function useChatSessionTabsPrefetch(input: UseChatSessionTabsPrefetchInput): void {
  const { activeWorktreeSessionTabs, activeSessionTabKey } = input;

  // Speculatively warm WS subscriptions for nearby sibling sessions in the
  // active worktree. Subscriptions are reference-counted by
  // retainThreadDetailSubscription, so the active route's own retain
  // is not duplicated and idle ones are evicted by the existing cap.
  // This makes switching to a sibling session land on warm data.
  useEffect(() => {
    if (activeWorktreeSessionTabs.length === 0) return;
    const releases: Array<() => void> = [];
    for (const key of selectSpeculativeSiblingTabPrefetchKeys(
      activeWorktreeSessionTabs,
      activeSessionTabKey,
    )) {
      const ref = parseScopedThreadKey(key);
      if (!ref) continue;
      releases.push(retainThreadDetailSubscription(ref.environmentId, ref.threadId));
    }
    return () => {
      for (const release of releases) release();
    };
  }, [activeWorktreeSessionTabs, activeSessionTabKey]);

  useEffect(() => {
    if (!activeSessionTabKey) return;
    const key = activeSessionTabKey;
    queueMicrotask(() => markTabSwitchFirstPaint(key));
  }, [activeSessionTabKey]);
}
