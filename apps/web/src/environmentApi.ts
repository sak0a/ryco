import type { EnvironmentApi, EnvironmentId } from "@ryco/contracts";
import { createEnvironmentApi, createEnvironmentApiLookup } from "@ryco/client-runtime/connection";
import type { WsRpcClient } from "@ryco/client-runtime/rpc";

import { readEnvironmentConnection } from "./environments/runtime";

export { createEnvironmentApi };

const environmentApiOverridesForTests = new Map<EnvironmentId, EnvironmentApi>();
const lookup = createEnvironmentApiLookup({
  canReadConnections: () => true,
  readClient: (environmentId) => readEnvironmentConnection(environmentId)?.client ?? null,
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
