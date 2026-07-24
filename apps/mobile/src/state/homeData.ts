import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
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

export function useHomeThreadGroups(): ReadonlyArray<HomeThreadGroup> {
  const preferences = usePreferences();
  const groupingMode = resolveHomeGroupingMode(preferences.projectGroupingEnabled);
  // zustand's useStore memoizes per selector; the grouping is cheap for MVP sizes.
  const projects = useStore(selectProjectsAcrossEnvironments);
  const threads = useStore(selectSidebarThreadsAcrossEnvironments);
  return buildHomeThreadGroups({ projects, threads, groupingMode });
}
