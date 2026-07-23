import type { EnvironmentId, OrchestrationShellSnapshot } from "@ryco/contracts";

export interface ProjectionVersion {
  readonly sequence: number;
  readonly updatedAt: string | null;
}

function compare(left: ProjectionVersion, right: ProjectionVersion): number {
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  const leftUpdatedAt = left.updatedAt ?? "";
  const rightUpdatedAt = right.updatedAt ?? "";
  if (leftUpdatedAt === rightUpdatedAt) return 0;
  return leftUpdatedAt < rightUpdatedAt ? -1 : 1;
}

function fromSnapshot(
  snapshot: Pick<OrchestrationShellSnapshot, "snapshotSequence" | "updatedAt">,
): ProjectionVersion {
  return { sequence: snapshot.snapshotSequence, updatedAt: snapshot.updatedAt };
}

export function classifyProjectionSnapshot(input: {
  readonly current: ProjectionVersion | null;
  readonly next: Pick<OrchestrationShellSnapshot, "snapshotSequence" | "updatedAt">;
}): "newer" | "current" | "stale" {
  if (input.current === null) return "newer";
  const comparison = compare(input.current, fromSnapshot(input.next));
  return comparison < 0 ? "newer" : comparison === 0 ? "current" : "stale";
}

export function shouldApplyProjectionSnapshot(input: {
  readonly current: ProjectionVersion | null;
  readonly next: Pick<OrchestrationShellSnapshot, "snapshotSequence" | "updatedAt">;
}): boolean {
  return classifyProjectionSnapshot(input) === "newer";
}

export function shouldApplyProjectionEvent(input: {
  readonly current: ProjectionVersion | null;
  readonly sequence: number;
}): boolean {
  return input.current === null || input.sequence > input.current.sequence;
}

export function createProjectionTracker() {
  const versions = new Map<EnvironmentId, ProjectionVersion>();
  return {
    read: (environmentId: EnvironmentId) => versions.get(environmentId) ?? null,
    markSnapshot: (
      environmentId: EnvironmentId,
      snapshot: Pick<OrchestrationShellSnapshot, "snapshotSequence" | "updatedAt">,
    ) => {
      const next = fromSnapshot(snapshot);
      const current = versions.get(environmentId);
      if (current === undefined || compare(current, next) < 0) versions.set(environmentId, next);
    },
    markEvent: (environmentId: EnvironmentId, sequence: number) => {
      const current = versions.get(environmentId);
      if (current === undefined || sequence > current.sequence)
        versions.set(environmentId, { sequence, updatedAt: current?.updatedAt ?? null });
    },
    clearEnvironment: (environmentId: EnvironmentId) => versions.delete(environmentId),
    clear: () => versions.clear(),
  };
}
