import type { EnvironmentId } from "@ryco/contracts";

import { derivePhysicalProjectKey, groupWorkspaceLogicalProjects } from "./logicalProjects.js";
import type {
  UnifiedWorkspaceIndex,
  WorkspaceMachineCatalogEntry,
  WorkspaceMetadataSnapshot,
  WorkspacePhysicalProjectVariant,
} from "./types.js";

function parseTimestamp(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Build the client-side aggregate. Ineligible snapshots never contribute physical rows;
 * identity-conflict snapshots contribute only a locked stale marker.
 */
export function buildUnifiedWorkspaceIndex(input: {
  readonly machines: ReadonlyArray<WorkspaceMachineCatalogEntry>;
  readonly snapshots: ReadonlyArray<WorkspaceMetadataSnapshot>;
  readonly localDesktopEnvironmentId?: EnvironmentId | null;
  readonly lastUsedAtByPhysicalProjectKey?: Readonly<Record<string, number>>;
}): UnifiedWorkspaceIndex {
  const machineByEnvironment = new Map(
    input.machines.map((machine) => [machine.environmentId, machine] as const),
  );
  const newestSnapshotByEnvironment = new Map<EnvironmentId, WorkspaceMetadataSnapshot>();
  for (const snapshot of input.snapshots) {
    const current = newestSnapshotByEnvironment.get(snapshot.environmentId);
    if (!current || snapshot.capturedAt > current.capturedAt) {
      newestSnapshotByEnvironment.set(snapshot.environmentId, snapshot);
    }
  }

  const availableSnapshots: WorkspaceMetadataSnapshot[] = [];
  const snapshots: UnifiedWorkspaceIndex["snapshots"][number][] = [];
  for (const [environmentId, snapshot] of newestSnapshotByEnvironment) {
    const machine = machineByEnvironment.get(environmentId);
    if (!machine || machine.cacheDisposition === "purge") continue;
    if (machine.cacheDisposition === "locked-stale") {
      snapshots.push({ status: "locked-stale", environmentId, capturedAt: snapshot.capturedAt });
      continue;
    }
    if (!machine.canReadMetadata) continue;
    snapshots.push({ status: "available", snapshot });
    availableSnapshots.push(snapshot);
  }

  const projects = availableSnapshots.flatMap((snapshot) => snapshot.projects);
  const worktrees = availableSnapshots.flatMap((snapshot) => snapshot.worktrees);
  const threads = availableSnapshots.flatMap((snapshot) => {
    const machine = machineByEnvironment.get(snapshot.environmentId);
    return snapshot.threads.map((thread) => ({
      ...thread,
      deliveryUnknown: thread.deliveryUnknown || machine?.deliveryUnknown === true,
    }));
  });
  const variants: WorkspacePhysicalProjectVariant[] = projects.flatMap((project) => {
    const machine = machineByEnvironment.get(project.environmentId);
    if (!machine) return [];
    const physicalKey = derivePhysicalProjectKey(project);
    return [
      {
        environmentId: project.environmentId,
        projectId: project.id,
        physicalKey,
        name: project.name,
        cwd: project.cwd,
        repositoryIdentity: project.repositoryIdentity,
        machineLabel: machine.label,
        online: machine.presence.online,
        canMutate: machine.canMutate,
        nativeTrust: machine.nativeTrust,
        effectiveRole: machine.effectiveRole,
        lastUsedAt: input.lastUsedAtByPhysicalProjectKey?.[physicalKey] ?? null,
        lastLiveAt: parseTimestamp(project.updatedAt) ?? machine.presence.lastSeenAt,
        localDesktop: input.localDesktopEnvironmentId === project.environmentId,
      },
    ];
  });

  return {
    machines: input.machines,
    snapshots: snapshots.toSorted((left, right) => {
      const leftId = left.status === "available" ? left.snapshot.environmentId : left.environmentId;
      const rightId =
        right.status === "available" ? right.snapshot.environmentId : right.environmentId;
      return String(leftId).localeCompare(String(rightId));
    }),
    projects,
    worktrees,
    threads,
    logicalProjects: groupWorkspaceLogicalProjects(variants),
  };
}
