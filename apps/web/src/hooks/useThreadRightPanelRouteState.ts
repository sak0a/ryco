import { useLayoutEffect, useRef } from "react";

import { isRightPanelOpen, type RightPanelRouteSearch } from "../rightPanelRouteSearch";
import {
  applyRightPanelSessionSearch,
  readRightPanelSessionSearch,
  rememberRightPanelSessionSearch,
  type RightPanelSessionSearch,
} from "../rightPanelSessionState";

export function useThreadRightPanelRouteState(input: {
  threadKey: string | null;
  search: RightPanelRouteSearch;
  replaceSearch: (search: RightPanelRouteSearch) => void;
}): RightPanelRouteSearch {
  const previousThreadKeyRef = useRef<string | null>(null);
  const pendingRestoreRef = useRef<{
    threadKey: string;
    search: RightPanelSessionSearch;
  } | null>(null);
  const enteringThread = previousThreadKeyRef.current !== input.threadKey;
  if (enteringThread) {
    const remembered = input.threadKey ? readRightPanelSessionSearch(input.threadKey) : undefined;
    pendingRestoreRef.current =
      input.threadKey && remembered && isRightPanelOpen(remembered)
        ? { threadKey: input.threadKey, search: remembered }
        : null;
  } else if (isRightPanelOpen(input.search)) {
    pendingRestoreRef.current = null;
  }
  const pendingRestore =
    pendingRestoreRef.current?.threadKey === input.threadKey && !isRightPanelOpen(input.search)
      ? pendingRestoreRef.current.search
      : undefined;
  const shouldRestore = enteringThread && pendingRestore !== undefined;
  const resolvedSearch = pendingRestore
    ? applyRightPanelSessionSearch(input.search, pendingRestore)
    : input.search;

  useLayoutEffect(() => {
    previousThreadKeyRef.current = input.threadKey;
    if (!input.threadKey) {
      return;
    }
    if (shouldRestore) {
      input.replaceSearch(resolvedSearch);
      return;
    }
    if (pendingRestore) {
      return;
    }
    rememberRightPanelSessionSearch(input.threadKey, input.search);
  }, [input, pendingRestore, resolvedSearch, shouldRestore]);

  return resolvedSearch;
}
