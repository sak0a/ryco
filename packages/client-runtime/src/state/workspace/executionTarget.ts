import type { EnvironmentId, ProjectId } from "@ryco/contracts";

import type { WorkspaceLogicalProject, WorkspacePhysicalProjectVariant } from "./types.js";

export interface WorkspaceExecutionTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly physicalKey: string;
  readonly machineLabel: string;
}

export type WorkspaceExecutionTargetResolution =
  | {
      readonly status: "resolved";
      readonly target: WorkspaceExecutionTarget;
      readonly source: "override" | "recent" | "local-desktop" | "stable";
    }
  | {
      readonly status: "unavailable";
      readonly message: "No verified machine available";
      readonly reason: "no-eligible-variant" | "override-unavailable" | "override-not-in-project";
    };

export interface WorkspaceExecutionTargetOverride {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

function isEligible(variant: WorkspacePhysicalProjectVariant): boolean {
  return (
    variant.online &&
    variant.canMutate &&
    (variant.nativeTrust === "verified" || variant.nativeTrust === "not-required")
  );
}

function toTarget(variant: WorkspacePhysicalProjectVariant): WorkspaceExecutionTarget {
  return {
    environmentId: variant.environmentId,
    projectId: variant.projectId,
    physicalKey: variant.physicalKey,
    machineLabel: variant.machineLabel,
  };
}

export function resolveWorkspaceExecutionTarget(input: {
  readonly project: WorkspaceLogicalProject;
  readonly override?: WorkspaceExecutionTargetOverride | null;
}): WorkspaceExecutionTargetResolution {
  if (input.override) {
    const override = input.override;
    const overridden = input.project.variants.find(
      (variant) =>
        variant.environmentId === override.environmentId &&
        variant.projectId === override.projectId,
    );
    if (!overridden) {
      return {
        status: "unavailable",
        message: "No verified machine available",
        reason: "override-not-in-project",
      };
    }
    if (!isEligible(overridden)) {
      return {
        status: "unavailable",
        message: "No verified machine available",
        reason: "override-unavailable",
      };
    }
    return { status: "resolved", target: toTarget(overridden), source: "override" };
  }

  const eligible = input.project.variants.filter(isEligible);
  if (eligible.length === 0) {
    return {
      status: "unavailable",
      message: "No verified machine available",
      reason: "no-eligible-variant",
    };
  }

  const sorted = eligible.toSorted((left, right) => {
    const leftUsed = left.lastUsedAt ?? Number.NEGATIVE_INFINITY;
    const rightUsed = right.lastUsedAt ?? Number.NEGATIVE_INFINITY;
    if (leftUsed !== rightUsed) return rightUsed - leftUsed;
    if (left.localDesktop !== right.localDesktop) return left.localDesktop ? -1 : 1;
    return String(left.environmentId).localeCompare(String(right.environmentId));
  });
  const selected = sorted[0]!;
  const maxUsed = Math.max(
    ...eligible.map((variant) => variant.lastUsedAt ?? Number.NEGATIVE_INFINITY),
  );
  const source =
    Number.isFinite(maxUsed) && selected.lastUsedAt === maxUsed
      ? "recent"
      : selected.localDesktop
        ? "local-desktop"
        : "stable";
  return { status: "resolved", target: toTarget(selected), source };
}
