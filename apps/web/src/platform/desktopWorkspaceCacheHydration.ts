import type { EnvironmentId } from "@ryco/contracts";
import {
  isWorkspaceMetadataSnapshot,
  type WorkspaceMetadataSnapshot,
} from "@ryco/client-runtime/state/workspace";

export interface DesktopWorkspaceCacheHydrationPort {
  readonly hydrate: (snapshot: WorkspaceMetadataSnapshot) => void;
  readonly isCacheHydrated: (environmentId: EnvironmentId) => boolean;
  readonly remove: (environmentId: EnvironmentId) => void;
}

/**
 * Keep Desktop main's durable metadata cache reflected in the renderer store.
 * The store's cache hydration is deliberately a no-op over live state, so this
 * cannot replace a current shell snapshot while a retained connection is open.
 */
export function reconcileDesktopWorkspaceCacheHydration(input: {
  readonly snapshots: ReadonlyArray<unknown>;
  readonly previouslyHydratedEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly port: DesktopWorkspaceCacheHydrationPort;
}): ReadonlySet<EnvironmentId> {
  const currentEnvironmentIds = new Set<EnvironmentId>();
  for (const candidate of input.snapshots) {
    if (!isWorkspaceMetadataSnapshot(candidate)) continue;
    currentEnvironmentIds.add(candidate.environmentId);
    input.port.hydrate(candidate);
  }

  for (const environmentId of input.previouslyHydratedEnvironmentIds) {
    if (currentEnvironmentIds.has(environmentId)) continue;
    if (input.port.isCacheHydrated(environmentId)) input.port.remove(environmentId);
  }
  return currentEnvironmentIds;
}
