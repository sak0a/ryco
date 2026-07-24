import type { EnvironmentApi, EnvironmentId } from "@ryco/contracts";
import { createEnvironmentApi, createEnvironmentApiLookup } from "@ryco/client-runtime/connection";
import type { WsRpcClient } from "@ryco/client-runtime/rpc";

import { createMobileConnectionRegistry } from "../runtime/bootstrap";

// Mobile analog of apps/web/src/environmentApi.ts. The single seam that turns an
// EnvironmentId into the typed RPC surface the send pipeline, approvals/user-input
// wrappers, and the checkpoint-diff cache dispatch through. Bound to the app's
// single-homed connection registry (bootstrap singletons); the supervisor owns
// the live client per environment, so this stays a thin lookup with no state.
export { createEnvironmentApi };

const registry = createMobileConnectionRegistry();
const environmentApiOverridesForTests = new Map<EnvironmentId, EnvironmentApi>();

const lookup = createEnvironmentApiLookup({
  canReadConnections: () => true,
  readClient: (environmentId): WsRpcClient | null =>
    registry.driver.supervisor.read(environmentId)?.client ?? null,
});

export function readEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi | undefined {
  return environmentApiOverridesForTests.get(environmentId) ?? lookup.read(environmentId);
}

export function ensureEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi {
  const api = readEnvironmentApi(environmentId);
  if (!api) throw new Error(`Environment API not found for environment ${environmentId}`);
  return api;
}

export function __setEnvironmentApiOverrideForTests(
  environmentId: EnvironmentId,
  api: EnvironmentApi,
): void {
  environmentApiOverridesForTests.set(environmentId, api);
}

export function __resetEnvironmentApiOverridesForTests(): void {
  environmentApiOverridesForTests.clear();
}

export type { WsRpcClient };
