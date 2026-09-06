import type { ModelSelection, ProviderDriverKind } from "@ryco/contracts";
import { resolveContextHandoffInputBudget } from "@ryco/shared/contextWindow";
import { Option } from "effect";

import { decodeClaudeProfileAdapter } from "./ClaudeModelManifest.ts";
import { resolveProviderCatalog, type ModelManifestData } from "./ModelManifest.ts";

export function resolveHandoffBudgetFromManifest(
  manifest: ModelManifestData,
  driverKind: ProviderDriverKind,
  selection: ModelSelection,
) {
  const catalog = resolveProviderCatalog(manifest, driverKind);
  const metadata =
    driverKind === "claudeAgent"
      ? catalog?.models.map((entry) => {
          const adapter = Option.getOrUndefined(decodeClaudeProfileAdapter(entry.profileAdapter));
          const descriptor = entry.model.capabilities?.optionDescriptors?.find(
            (option) => option.id === "contextWindow",
          );
          const defaultContextWindow =
            descriptor?.type === "select"
              ? descriptor.options.find((option) => option.isDefault)?.id
              : undefined;
          return {
            slug: entry.model.slug,
            ...(entry.model.aliases ? { aliases: entry.model.aliases } : {}),
            ...(defaultContextWindow ? { defaultContextWindow } : {}),
            ...adapter?.claudeCode,
          };
        })
      : undefined;
  return resolveContextHandoffInputBudget(driverKind, selection.model, selection, metadata);
}
