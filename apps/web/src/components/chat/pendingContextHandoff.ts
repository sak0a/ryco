import type { ContextHandoffEndpointSnapshot, ModelSelection } from "@ryco/contracts";
import { getModelDisplayLabel } from "@ryco/shared/model";

import { modelSelectionRequiresContextHandoff } from "../ChatView.logic";
import type { AppModelOption } from "../../modelSelection";
import type { ProviderInstanceEntry } from "../../providerInstances";

export interface PendingContextHandoffPresentation {
  readonly source: ContextHandoffEndpointSnapshot;
  readonly target: ContextHandoffEndpointSnapshot;
}

function resolveEndpoint(input: {
  readonly selection: ModelSelection;
  readonly providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<
    ModelSelection["instanceId"],
    ReadonlyArray<AppModelOption>
  >;
}): ContextHandoffEndpointSnapshot | null {
  const entry = input.providerInstanceEntries.find(
    (candidate) => candidate.instanceId === input.selection.instanceId,
  );
  if (!entry) return null;

  const model =
    input.modelOptionsByInstance
      .get(input.selection.instanceId)
      ?.find((candidate) => candidate.slug === input.selection.model) ??
    entry.models.find((candidate) => candidate.slug === input.selection.model);

  return {
    providerInstanceId: entry.instanceId,
    driverKind: entry.driverKind,
    providerDisplayName: entry.displayName,
    ...(entry.accentColor ? { providerAccentColor: entry.accentColor } : {}),
    modelSlug: input.selection.model,
    ...(model ? { modelDisplayName: getModelDisplayLabel(model, { preferShortName: true }) } : {}),
  };
}

export function derivePendingContextHandoff(input: {
  readonly threadStarted: boolean;
  readonly isPhoneTier: boolean;
  readonly canonicalSelection: ModelSelection | null | undefined;
  readonly targetSelection: ModelSelection;
  readonly providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<
    ModelSelection["instanceId"],
    ReadonlyArray<AppModelOption>
  >;
}): PendingContextHandoffPresentation | null {
  if (!input.threadStarted || input.isPhoneTier || !input.canonicalSelection) {
    return null;
  }
  if (
    !modelSelectionRequiresContextHandoff({
      canonicalSelection: input.canonicalSelection,
      targetSelection: input.targetSelection,
    })
  ) {
    return null;
  }

  const source = resolveEndpoint({
    selection: input.canonicalSelection,
    providerInstanceEntries: input.providerInstanceEntries,
    modelOptionsByInstance: input.modelOptionsByInstance,
  });
  const target = resolveEndpoint({
    selection: input.targetSelection,
    providerInstanceEntries: input.providerInstanceEntries,
    modelOptionsByInstance: input.modelOptionsByInstance,
  });

  return source && target ? { source, target } : null;
}
