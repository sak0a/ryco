import { scopedProjectKey } from "@ryco/client-runtime/scoped";
import {
  deriveLogicalProjectKey,
  deriveProjectGroupLabel,
  derivePhysicalProjectKey,
  derivePhysicalProjectKeyFromPath,
} from "@ryco/client-runtime/state/workspace";
import type { ScopedProjectRef, SidebarProjectGroupingMode } from "@ryco/contracts";

import type { Project } from "./types";

export interface ProjectGroupingSettings {
  sidebarProjectGroupingMode: SidebarProjectGroupingMode;
  sidebarProjectGroupingOverrides: Record<string, SidebarProjectGroupingMode>;
}

export type ProjectGroupingMode = SidebarProjectGroupingMode;

/** Compatibility exports; the grouping algorithm is shared with native clients. */
export {
  deriveLogicalProjectKey,
  deriveProjectGroupLabel,
  derivePhysicalProjectKey,
  derivePhysicalProjectKeyFromPath,
};

export function deriveProjectGroupingOverrideKey(
  project: Pick<Project, "environmentId" | "cwd">,
): string {
  return derivePhysicalProjectKey(project);
}

export function getProjectOrderKey(project: Pick<Project, "environmentId" | "cwd">): string {
  return derivePhysicalProjectKey(project);
}

export function resolveProjectGroupingMode(
  project: Pick<Project, "environmentId" | "cwd">,
  settings: ProjectGroupingSettings,
): SidebarProjectGroupingMode {
  return (
    settings.sidebarProjectGroupingOverrides?.[deriveProjectGroupingOverrideKey(project)] ??
    settings.sidebarProjectGroupingMode
  );
}

export function deriveLogicalProjectKeyFromSettings(
  project: Pick<Project, "environmentId" | "id" | "cwd" | "repositoryIdentity">,
  settings: ProjectGroupingSettings,
): string {
  return deriveLogicalProjectKey(project, {
    groupingMode: resolveProjectGroupingMode(project, settings),
  });
}

export function deriveLogicalProjectKeyFromRef(
  projectRef: ScopedProjectRef,
  project: Pick<Project, "environmentId" | "id" | "cwd" | "repositoryIdentity"> | null | undefined,
  options?: { readonly groupingMode?: SidebarProjectGroupingMode },
): string {
  return project ? deriveLogicalProjectKey(project, options) : scopedProjectKey(projectRef);
}
