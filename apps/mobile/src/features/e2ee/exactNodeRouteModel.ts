import type { HostedHubNode } from "@ryco/client-runtime/authorization";
import type { EnvironmentId } from "@ryco/contracts";

export interface ExactNodeRouteParams {
  readonly nodeId?: string | readonly string[];
  readonly environmentId?: string | readonly string[];
}

export interface ExactNodeRouteTarget {
  readonly nodeId: string;
  readonly environmentId: EnvironmentId;
  readonly node: HostedHubNode;
}

function first(value: string | readonly string[] | undefined): string | null {
  if (typeof value === "string") return value;
  return value?.[0] ?? null;
}

/** Fail closed: both route identifiers must resolve to the same directory row. */
export function resolveExactNodeRoute(
  params: ExactNodeRouteParams | undefined,
  nodes: ReadonlyArray<HostedHubNode>,
): ExactNodeRouteTarget | null {
  const nodeId = first(params?.nodeId);
  const environmentId = first(params?.environmentId);
  if (!nodeId || !environmentId) return null;
  const node = nodes.find(
    (candidate) => candidate.id === nodeId && candidate.environmentId === environmentId,
  );
  return node ? { nodeId, environmentId: node.environmentId, node } : null;
}

export function exactNodeRouteParams(node: Pick<HostedHubNode, "id" | "environmentId">): {
  readonly nodeId: string;
  readonly environmentId: string;
} {
  return { nodeId: node.id, environmentId: node.environmentId };
}
