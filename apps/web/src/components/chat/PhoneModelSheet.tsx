import type { ProviderDriverKind, ProviderInstanceId } from "@ryco/contracts";
import { memo, useCallback, useMemo, useState } from "react";
import { CheckIcon, StarIcon } from "lucide-react";

import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { MobileSelectSheet, type MobileSelectSheetGroup } from "../mobile/MobileSelectSheet";
import { providerModelKey } from "../../modelOrdering";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { buildPhoneModelSheetGroups } from "./phoneModelSheetOptions";
import type { ModelEsque } from "./providerIconUtils";

/**
 * The phone presentation of the model picker: one `MobileSelectSheet` instead
 * of the desktop two-pane popover.
 *
 * It carries **no keyboard shortcut hints**. The desktop picker labels its
 * first eight rows `⌘1`–`⌘8`; those hints are meaningless on a phone and the
 * audit found all eight rendering under `pointer: coarse`, so this presentation
 * simply has no place to put them. The shortcut handler itself is a desktop
 * concern and lives in the desktop content component, which never mounts here.
 *
 * Grouping and favourites survive the translation — see
 * `phoneModelSheetOptions.ts` — and the favourite toggle stays reachable as a
 * sibling control beside each row.
 */
export const PhoneModelSheet = memo(function PhoneModelSheet(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly activeInstanceId: ProviderInstanceId;
  readonly model: string;
  readonly lockedProvider: ProviderDriverKind | null;
  readonly lockedContinuationGroupKey: string | null;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  readonly disabled?: boolean | undefined;
  readonly disabledReason?: string | undefined;
  readonly onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const favorites = useSettings((state) => state.favorites ?? []);
  const { updateSettings } = useUpdateSettings();
  const favoriteKeys = useMemo(
    () => new Set(favorites.map((favorite) => providerModelKey(favorite.provider, favorite.model))),
    [favorites],
  );

  const toggleFavorite = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      const next = [...favorites];
      const index = next.findIndex(
        (favorite) => favorite.provider === instanceId && favorite.model === model,
      );
      if (index >= 0) {
        next.splice(index, 1);
      } else {
        next.push({ provider: instanceId, model });
      }
      updateSettings({ favorites: next });
    },
    [favorites, updateSettings],
  );

  const modelGroups = useMemo(
    () =>
      buildPhoneModelSheetGroups({
        instanceEntries: props.instanceEntries,
        modelOptionsByInstance: props.modelOptionsByInstance,
        favoriteKeys,
        searchQuery,
        lockedProvider: props.lockedProvider,
        lockedContinuationGroupKey: props.lockedContinuationGroupKey,
        activeInstanceId: props.activeInstanceId,
        model: props.model,
      }),
    [
      favoriteKeys,
      props.activeInstanceId,
      props.instanceEntries,
      props.lockedContinuationGroupKey,
      props.lockedProvider,
      props.model,
      props.modelOptionsByInstance,
      searchQuery,
    ],
  );

  const itemByKey = useMemo(
    () => new Map(modelGroups.flatMap((group) => group.items.map((item) => [item.key, item]))),
    [modelGroups],
  );

  const groups: ReadonlyArray<MobileSelectSheetGroup> = useMemo(
    () =>
      modelGroups.map((group) => ({
        id: group.id,
        label: group.label,
        options: group.items.map((item) => ({
          // Keys repeat across sections only if a model were listed twice, and
          // the derivation guarantees it is not.
          id: item.key,
          label: item.label,
          secondaryText: item.providerLabel,
          selected: item.isSelected,
          ...(item.isSelected
            ? { trailing: <CheckIcon aria-hidden className="size-4 shrink-0" /> }
            : {}),
          action: {
            label: item.isFavorite ? "Remove from favorites" : "Add to favorites",
            pressed: item.isFavorite,
            icon: (
              <StarIcon
                aria-hidden
                className={item.isFavorite ? "size-4 fill-current text-yellow-500" : "size-4"}
              />
            ),
            onSelect: () => toggleFavorite(item.instanceId, item.slug),
          },
        })),
      })),
    [modelGroups, toggleFavorite],
  );

  return (
    <MobileSelectSheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open) setSearchQuery("");
        props.onOpenChange(open);
      }}
      label="Model"
      // Browse-first at the partial detent; the search field is not focused on
      // open and moves the sheet to the full detent only when it is tapped.
      detent="medium"
      search={{ value: searchQuery, placeholder: "Search models", onChange: setSearchQuery }}
      groups={groups}
      emptyText="No models found"
      disabled={props.disabled ?? false}
      {...(props.disabledReason ? { disabledReason: props.disabledReason } : {})}
      onSelect={(optionId) => {
        const item = itemByKey.get(optionId);
        if (!item) return;
        props.onInstanceModelChange(item.instanceId, item.slug);
        setSearchQuery("");
        props.onOpenChange(false);
      }}
    />
  );
});
