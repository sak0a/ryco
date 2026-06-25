import { useCallback, useEffect, useRef } from "react";
import { parseScopedThreadKey } from "@ryco/client-runtime";
import { retainThreadDetailSubscription } from "../../environments/runtime/service";
import { markTabSwitchFirstPaint } from "../../perf/tabSwitchInstrumentation";
import { createTabPrefetchController } from "./ChatSessionTabsPrefetch";
import type { ChatSessionTabsItem } from "./ChatSessionTabs";

export interface UseChatSessionTabsPrefetchInput {
  activeWorktreeSessionTabs: ReadonlyArray<ChatSessionTabsItem>;
  activeSessionTabKey: string | null;
}

export interface UseChatSessionTabsPrefetchResult {
  handleTabPrefetchEnter: (key: string) => void;
  handleTabPrefetchLeave: (key: string) => void;
}

export const MAX_SPECULATIVE_SIBLING_TAB_PREFETCH = 6;

export function selectSpeculativeSiblingTabPrefetchKeys(
  activeWorktreeSessionTabs: ReadonlyArray<ChatSessionTabsItem>,
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
 * Warms WS subscriptions for sibling session tabs (on hover and speculatively
 * for nearby tabs in the active worktree) and records the first-paint perf mark
 * when the active tab changes.
 */
export function useChatSessionTabsPrefetch(
  input: UseChatSessionTabsPrefetchInput,
): UseChatSessionTabsPrefetchResult {
  const { activeWorktreeSessionTabs, activeSessionTabKey } = input;

  const prefetchControllerRef = useRef<ReturnType<typeof createTabPrefetchController> | null>(null);
  useEffect(() => {
    const controller = createTabPrefetchController({
      retain: (key) => {
        const ref = parseScopedThreadKey(key);
        if (!ref) return () => {};
        return retainThreadDetailSubscription(ref.environmentId, ref.threadId);
      },
      releaseDelayMs: 250,
    });
    prefetchControllerRef.current = controller;
    return () => {
      controller.dispose();
      prefetchControllerRef.current = null;
    };
  }, []);
  const handleTabPrefetchEnter = useCallback(
    (key: string) => prefetchControllerRef.current?.enter(key),
    [],
  );
  const handleTabPrefetchLeave = useCallback(
    (key: string) => prefetchControllerRef.current?.leave(key),
    [],
  );

  // Speculatively warm WS subscriptions for nearby sibling tabs in the
  // active worktree. Subscriptions are reference-counted by
  // retainThreadDetailSubscription, so the active route's own retain
  // is not duplicated and idle ones are evicted by the existing cap.
  // This makes cold clicks (no hover) behave like warm clicks.
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

  return {
    handleTabPrefetchEnter,
    handleTabPrefetchLeave,
  };
}
