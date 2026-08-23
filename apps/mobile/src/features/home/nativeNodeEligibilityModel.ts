import type { WorkspaceNativeTrustState } from "@ryco/client-runtime/state/workspace";

import type { E2eeTrustClassification } from "../../platform/e2eeTrustModel";

export interface NativeNodeTrustTarget {
  readonly environmentId: string;
  readonly nodeId: string;
}

export interface NativeNodeTrustScope {
  readonly hubOrigin: string;
  readonly accountId: string;
}

export type NativeNodeTrustClassifier = (input: {
  readonly kind: "node-id-hint";
  readonly hubOrigin: string;
  readonly accountId: string;
  readonly nodeId: string;
}) => Promise<E2eeTrustClassification>;

/**
 * Resolve native trust through the durable async classifier. This is the
 * authorization input used by Mobile workspace projection; synchronous display
 * readers are deliberately not accepted by this seam.
 */
export async function resolveAuthoritativeNativeNodeTrust(input: {
  readonly scope: NativeNodeTrustScope | null;
  readonly targets: ReadonlyArray<NativeNodeTrustTarget>;
  readonly classify: NativeNodeTrustClassifier;
  readonly identityConflictEnvironmentIds?: ReadonlySet<string>;
}): Promise<ReadonlyMap<string, WorkspaceNativeTrustState>> {
  const conflicts = input.identityConflictEnvironmentIds ?? new Set<string>();
  const entries = await Promise.all(
    input.targets.map(async (target) => {
      if (conflicts.has(target.environmentId)) {
        return [target.environmentId, "identity-conflict"] as const;
      }
      if (input.scope === null) return [target.environmentId, "unknown"] as const;
      try {
        const classification = await input.classify({
          kind: "node-id-hint",
          hubOrigin: input.scope.hubOrigin,
          accountId: input.scope.accountId,
          nodeId: target.nodeId,
        });
        return [
          target.environmentId,
          classification.class === "latched" ? "verified" : "unverified",
        ] as const;
      } catch {
        return [target.environmentId, "unknown"] as const;
      }
    }),
  );
  return new Map(entries);
}

export function workspaceEligibleEnvironmentIds(
  trustByEnvironmentId: ReadonlyMap<string, WorkspaceNativeTrustState>,
): ReadonlySet<string> {
  return new Set(
    Array.from(trustByEnvironmentId, ([environmentId, trust]) =>
      trust === "verified" ? environmentId : null,
    ).filter((environmentId): environmentId is string => environmentId !== null),
  );
}

export function needsVerificationEnvironmentIds(
  trustByEnvironmentId: ReadonlyMap<string, WorkspaceNativeTrustState>,
): ReadonlySet<string> {
  return new Set(
    Array.from(trustByEnvironmentId, ([environmentId, trust]) =>
      trust === "unverified" || trust === "unknown" || trust === "identity-conflict"
        ? environmentId
        : null,
    ).filter((environmentId): environmentId is string => environmentId !== null),
  );
}
