import { deriveNodeTrustByEnvironment, type NodeTrust } from "./nodeTrustModel";
import { useAuthoritativeNodeTrust } from "./useAuthoritativeNodeTrust";

/**
 * The store binding for {@link deriveNodeTrustByEnvironment}. All judgement
 * lives in `nodeTrustModel.ts`; this file exists only because that module may
 * not import react or a platform adapter.
 *
 * It narrows the environment-scoped result produced by the async durable
 * classifier. It never reads the trust document synchronously and remains a
 * presentation adapter only; eligibility is owned by the shared machine
 * catalog in `useHomeEnvironments`.
 *
 * Unknown/unavailable evidence remains unverified presentation; it never enters
 * the workspace because the catalog keeps the authoritative `unknown` state.
 */
export function useNodeTrust(
  rosterNodes: ReadonlyArray<{ readonly environmentId: string; readonly nodeId: string }>,
): ReadonlyMap<string, NodeTrust> {
  const authoritativeTrustByEnvironmentId = useAuthoritativeNodeTrust(rosterNodes);
  return deriveNodeTrustByEnvironment({ authoritativeTrustByEnvironmentId });
}
