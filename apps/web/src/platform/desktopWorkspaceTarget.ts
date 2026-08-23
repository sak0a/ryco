import type { DesktopWorkspaceStateProjection, ScopedProjectRef } from "@ryco/contracts";
import { scopedProjectKey, scopeProjectRef } from "@ryco/client-runtime/scoped";
import {
  resolveWorkspaceExecutionTarget,
  type WorkspaceLogicalProject,
} from "@ryco/client-runtime/state/workspace";
import type { Project } from "@ryco/client-runtime/state/threads";

/** Select within the first logical project; an explicitly clicked project remains the override. */
export function resolveDesktopDefaultProjectRef(input: {
  readonly orderedProjects: ReadonlyArray<Project>;
  readonly workspace: DesktopWorkspaceStateProjection;
  readonly logicalKey: (project: Project) => string;
}): ScopedProjectRef | null {
  const first = input.orderedProjects[0];
  if (!first) return null;
  if (input.workspace.status !== "ready") {
    return scopeProjectRef(first.environmentId, first.id);
  }
  const firstKey = input.logicalKey(first);
  const machineByEnvironment = new Map(
    input.workspace.machines.map((machine) => [machine.environmentId, machine] as const),
  );
  const candidates = input.orderedProjects.filter(
    (project) => input.logicalKey(project) === firstKey,
  );
  const logicalProject: WorkspaceLogicalProject = {
    key: firstKey,
    label: first.name,
    repositoryIdentity: first.repositoryIdentity ?? null,
    ambiguous: candidates.length > 1,
    variants: candidates.flatMap((project) => {
      const machine = machineByEnvironment.get(project.environmentId);
      if (!machine) return [];
      return [
        {
          environmentId: project.environmentId,
          projectId: project.id,
          physicalKey: scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
          name: project.name,
          cwd: project.cwd,
          repositoryIdentity: project.repositoryIdentity ?? null,
          machineLabel: machine.label,
          online: machine.online,
          canMutate: machine.canMutate,
          nativeTrust: machine.nativeTrust,
          effectiveRole: machine.canMutate ? "owner" : null,
          lastUsedAt: null,
          lastLiveAt: null,
          localDesktop: input.workspace.localEnvironmentId === project.environmentId,
        },
      ];
    }),
  };
  const resolution = resolveWorkspaceExecutionTarget({ project: logicalProject });
  return resolution.status === "resolved"
    ? scopeProjectRef(resolution.target.environmentId, resolution.target.projectId)
    : null;
}
