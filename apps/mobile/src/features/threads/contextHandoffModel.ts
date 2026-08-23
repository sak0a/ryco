import type { ContextHandoffEndpointSnapshot, ModelSelection, ServerConfig } from "@ryco/contracts";
import { modelSelectionRequiresContextHandoff } from "@ryco/shared/model";

import { providerDisplayLabel } from "../../lib/providerDisplay";

export interface PendingContextHandoffPresentation {
  readonly source: ContextHandoffEndpointSnapshot;
  readonly target: ContextHandoffEndpointSnapshot;
  readonly accessibilityLabel: string;
}

export function contextHandoffProviderLabel(endpoint: ContextHandoffEndpointSnapshot): string {
  return (
    providerDisplayLabel(endpoint.driverKind, endpoint.providerDisplayName) ??
    endpoint.providerInstanceId
  );
}

export function contextHandoffModelLabel(endpoint: ContextHandoffEndpointSnapshot): string {
  return endpoint.modelDisplayName ?? endpoint.modelSlug;
}

export function contextHandoffEndpointAccessibleLabel(
  endpoint: ContextHandoffEndpointSnapshot,
): string {
  return `${contextHandoffProviderLabel(endpoint)} ${contextHandoffModelLabel(endpoint)}`;
}

function resolveEndpoint(
  selection: ModelSelection,
  config: ServerConfig | null | undefined,
): ContextHandoffEndpointSnapshot | null {
  const provider = config?.providers.find(
    (candidate) => candidate.instanceId === selection.instanceId,
  );
  if (!provider) return null;
  const model = provider.models.find((candidate) => candidate.slug === selection.model);

  return {
    providerInstanceId: provider.instanceId,
    driverKind: provider.driver,
    ...(provider.displayName ? { providerDisplayName: provider.displayName } : {}),
    ...(provider.accentColor ? { providerAccentColor: provider.accentColor } : {}),
    modelSlug: selection.model,
    ...(model ? { modelDisplayName: model.shortName ?? model.name } : {}),
  };
}

export function derivePendingContextHandoff(input: {
  readonly threadStarted: boolean;
  readonly canonicalSelection: ModelSelection | null | undefined;
  readonly targetSelection: ModelSelection;
  readonly serverConfig: ServerConfig | null | undefined;
}): PendingContextHandoffPresentation | null {
  if (!input.threadStarted || !input.canonicalSelection) return null;
  if (
    !modelSelectionRequiresContextHandoff({
      canonicalSelection: input.canonicalSelection,
      targetSelection: input.targetSelection,
    })
  ) {
    return null;
  }

  const source = resolveEndpoint(input.canonicalSelection, input.serverConfig);
  const target = resolveEndpoint(input.targetSelection, input.serverConfig);
  if (!source || !target) return null;

  return {
    source,
    target,
    accessibilityLabel: `Next message will hand off context from ${contextHandoffEndpointAccessibleLabel(source)} to ${contextHandoffEndpointAccessibleLabel(target)}`,
  };
}

export function contextHandoffMarkerAccessibilityLabel(input: {
  readonly sources: ReadonlyArray<ContextHandoffEndpointSnapshot>;
  readonly target: ContextHandoffEndpointSnapshot;
  readonly status: "consumed" | "failed" | "delivery-uncertain";
  readonly error?: string | undefined;
}): string {
  const transition = `Context handoff from ${input.sources
    .map(contextHandoffEndpointAccessibleLabel)
    .join(", ")} to ${contextHandoffEndpointAccessibleLabel(input.target)}`;
  if (input.status === "failed") {
    return `${transition}. Failed${input.error ? `: ${input.error}` : ""}`;
  }
  if (input.status === "delivery-uncertain") {
    return `${transition}. Delivery uncertain${input.error ? `: ${input.error}` : ""}`;
  }
  return `${transition}. Completed`;
}
