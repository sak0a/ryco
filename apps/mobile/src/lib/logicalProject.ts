import { scopedProjectKey } from "@ryco/client-runtime/scoped";
import type { Project } from "@ryco/client-runtime/state/threads";
import {
  deriveLogicalProjectKey,
  deriveProjectGroupLabel,
  derivePhysicalProjectKey,
  derivePhysicalProjectKeyFromPath,
  normalizeProjectPathForComparison,
} from "@ryco/client-runtime/state/workspace";
import type { ScopedProjectRef, SidebarProjectGroupingMode } from "@ryco/contracts";

/** Compatibility adapter; the algorithm now has one owner in client-runtime. */
export {
  deriveLogicalProjectKey,
  deriveProjectGroupLabel,
  derivePhysicalProjectKey,
  derivePhysicalProjectKeyFromPath,
  normalizeProjectPathForComparison,
};

export type ProjectGroupingMode = SidebarProjectGroupingMode;

export function deriveLogicalProjectKeyFromRef(
  projectRef: ScopedProjectRef,
  project: Pick<Project, "environmentId" | "id" | "cwd" | "repositoryIdentity"> | null | undefined,
  options?: { readonly groupingMode?: SidebarProjectGroupingMode },
): string {
  return project ? deriveLogicalProjectKey(project, options) : scopedProjectKey(projectRef);
}
