import { useShallow } from "zustand/react/shallow";

import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  selectSidebarWorktreesAcrossEnvironments,
  useStore,
} from "./threadsRuntime";
import {
  buildHomeThreadGroups,
  resolveHomeGroupingMode,
  type HomeThreadGroup,
} from "./homeGrouping";
import { usePreferences } from "./preferencesStore";

export { buildHomeThreadGroups, resolveHomeGroupingMode } from "./homeGrouping";
export type { HomeThreadGroup } from "./homeGrouping";

export function useHomeWorkspaceData() {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const worktrees = useStore(useShallow(selectSidebarWorktreesAcrossEnvironments));
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  return { projects, worktrees, threads } as const;
}

export function useHomeThreadGroups(): ReadonlyArray<HomeThreadGroup> {
  const preferences = usePreferences();
  const groupingMode = resolveHomeGroupingMode(preferences.projectGroupingEnabled);
  // Both selectors build a FRESH array every call (.flatMap across environments);
  // zustand v5's useStore has no equality arg, so without useShallow the snapshot
  // changes every render and React infinite-loops. useShallow memoizes per
  // component with a shallow compare (matches apps/web PhoneHome).
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  return buildHomeThreadGroups({ projects, threads, groupingMode });
}
