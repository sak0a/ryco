import type { ModelSelection, ServerConfig } from "@ryco/contracts";

import { buildModelOptions, groupByProvider, type ModelOption } from "../../lib/modelOptions";

// Pure model for the thread's provider+model picker.
//
// Two things separate this from the New Task picker, and both are correctness
// rather than polish:
//
// 1. A thread that has already started is LOCKED to its provider instance.
//    Switching a live session to a different provider mid-thread is not a
//    supported transition, and `buildModelOptions` has no concept of it — so
//    offering the other providers here would ship a way to break the session.
//    Other providers are still listed, but disabled and labelled, because
//    silently hiding them reads as "the app lost my providers".
//
// 2. `serverConfigAtom` is scoped to the ACTIVE environment and is nulled while
//    switching nodes. With a null config `buildModelOptions` returns exactly one
//    option — the fallback — and rendering that as "one model available" or as
//    an empty state would both be lies. It is a loading state.

export interface ModelPickerEntry {
  readonly key: string;
  readonly label: string;
  readonly providerKey: string;
  readonly providerDriver: string;
  readonly selection: ModelSelection;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly disabledReason: string | null;
}

export interface ModelPickerGroup {
  readonly providerKey: string;
  readonly providerLabel: string;
  readonly providerDriver: string;
  readonly entries: ReadonlyArray<ModelPickerEntry>;
}

export interface ModelPickerModel {
  /** Rail pill text: the short model name, or a stand-in while config loads. */
  readonly pillLabel: string;
  readonly pillProviderDriver: string | null;
  readonly pillAccessibilityLabel: string;
  readonly groups: ReadonlyArray<ModelPickerGroup>;
  /** True while the server config has not arrived for this environment. */
  readonly loading: boolean;
  /** Set when the thread is pinned to one provider. */
  readonly lockedProviderKey: string | null;
  readonly lockNotice: string | null;
  /** True when a query matched nothing — distinct from having no models. */
  readonly emptyForQuery: boolean;
}

export interface ModelPickerInput {
  readonly serverConfig: ServerConfig | null | undefined;
  readonly currentSelection: ModelSelection | null;
  /**
   * True once the thread has a real session, i.e. a provider is committed.
   * New Task passes false.
   */
  readonly providerLocked: boolean;
  readonly query?: string;
}

const LOCK_NOTICE = "This task already started on its provider, so its model choices are limited.";

function matches(option: ModelOption, query: string): boolean {
  if (!query) return true;
  return `${option.label} ${option.providerLabel}`.toLocaleLowerCase().includes(query);
}

export function buildModelPickerModel(input: ModelPickerInput): ModelPickerModel {
  const query = input.query?.trim().toLocaleLowerCase() ?? "";
  // A config that has not arrived is different from a config with no providers.
  const loading = input.serverConfig === null || input.serverConfig === undefined;
  const options = buildModelOptions(input.serverConfig, input.currentSelection);
  const lockedProviderKey = input.providerLocked
    ? (input.currentSelection?.instanceId ?? null)
    : null;

  const selectedKey = input.currentSelection
    ? `${input.currentSelection.instanceId}:${input.currentSelection.model}`
    : null;
  const selectedOption = options.find((option) => option.key === selectedKey) ?? null;

  const groups = groupByProvider(options)
    .map((group) => {
      const locked = lockedProviderKey !== null && group.providerKey !== lockedProviderKey;
      return {
        providerKey: group.providerKey,
        providerLabel: group.providerLabel,
        providerDriver: group.models[0]?.providerDriver ?? "",
        entries: group.models
          .filter((option) => matches(option, query))
          .map((option) => ({
            key: option.key,
            label: option.label,
            providerKey: option.providerKey,
            providerDriver: option.providerDriver,
            selection: option.selection,
            selected: option.key === selectedKey,
            disabled: locked,
            disabledReason: locked ? LOCK_NOTICE : null,
          })),
      };
    })
    .filter((group) => group.entries.length > 0);

  return {
    pillLabel:
      selectedOption?.label ?? input.currentSelection?.model ?? (loading ? "Loading…" : "Model"),
    pillProviderDriver: selectedOption?.providerDriver ?? null,
    pillAccessibilityLabel: selectedOption
      ? `Model: ${selectedOption.label}, ${selectedOption.providerLabel}.`
      : loading
        ? "Model: loading."
        : "Model: none selected.",
    groups,
    loading,
    lockedProviderKey,
    lockNotice: lockedProviderKey !== null ? LOCK_NOTICE : null,
    emptyForQuery: query.length > 0 && groups.length === 0,
  };
}

/** The selection a tap should produce, or null when the tap must be ignored. */
export function resolveModelPickerSelection(
  model: ModelPickerModel,
  key: string,
): ModelSelection | null {
  for (const group of model.groups) {
    const entry = group.entries.find((candidate) => candidate.key === key);
    if (!entry) continue;
    if (entry.disabled || entry.selected) return null;
    return entry.selection;
  }
  return null;
}
