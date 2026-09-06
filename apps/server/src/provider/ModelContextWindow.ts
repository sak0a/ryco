import type { ModelSelection, ProviderDriverKind } from "@ryco/contracts";
import { resolveContextHandoffInputBudget } from "@ryco/shared/contextWindow";

import {
  resolveClaudeCatalogContextWindow,
  resolveClaudeCatalogModel,
  resolveClaudeModelCatalog,
} from "./ClaudeModelCatalog.ts";
import type { ModelManifestData } from "./ModelManifest.ts";

export function resolveHandoffBudgetFromManifest(
  manifest: ModelManifestData,
  driverKind: ProviderDriverKind,
  selection: ModelSelection,
) {
  if (driverKind !== "claudeAgent") {
    return resolveContextHandoffInputBudget(driverKind, selection.model, selection);
  }

  // Use the same alias, option normalization, and fallback rules as the provider.
  const catalog = resolveClaudeModelCatalog(manifest);
  const entry = resolveClaudeCatalogModel(catalog, selection.model);
  const contextWindow = resolveClaudeCatalogContextWindow(catalog, selection);
  const model = entry?.model.slug ?? selection.model;
  return resolveContextHandoffInputBudget(
    driverKind,
    model,
    undefined,
    entry
      ? [
          {
            slug: model,
            ...(contextWindow ? { defaultContextWindow: contextWindow } : {}),
            ...entry.runtime,
          },
        ]
      : [],
  );
}
