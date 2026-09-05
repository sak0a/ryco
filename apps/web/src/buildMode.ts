import type { ModelSelection, ProviderDriverKind } from "@ryco/contracts";

/** OpenCode's agent option takes precedence over the shared interaction mode. */
export function resolveBuildModeModelSelection(
  provider: ProviderDriverKind,
  selection: ModelSelection,
): ModelSelection {
  if (provider !== "opencode") return selection;

  return {
    ...selection,
    options: [
      ...(selection.options ?? []).filter((option) => option.id !== "agent"),
      { id: "agent", value: "build" },
    ],
  };
}
