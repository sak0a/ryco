import { ChevronDownIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { cn } from "../../../lib/utils";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "../../ui/combobox";

export interface InboxFilterOption {
  readonly value: string;
  readonly label: string;
  readonly artwork: ReactNode;
  readonly searchText?: string;
}

interface InboxFilterComboboxProps {
  readonly category: string;
  readonly allLabel: string;
  readonly allArtwork: ReactNode;
  readonly value: string;
  readonly options: readonly InboxFilterOption[];
  readonly onChange: (value: string) => void;
}

const SEARCH_THRESHOLD = 6;

export function InboxFilterCombobox({
  category,
  allLabel,
  allArtwork,
  value,
  options,
  onChange,
}: InboxFilterComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const allOptions = useMemo<readonly InboxFilterOption[]>(
    () => [{ value: "all", label: allLabel, artwork: allArtwork }, ...options],
    [allArtwork, allLabel, options],
  );
  const selectedOption = allOptions.find((option) => option.value === value) ?? allOptions[0]!;
  const searchable = options.length > SEARCH_THRESHOLD;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleOptions = useMemo(() => {
    if (!searchable || normalizedQuery.length === 0) return allOptions;
    return allOptions.filter((option) =>
      `${option.label} ${option.searchText ?? ""}`.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [allOptions, normalizedQuery, searchable]);
  const itemValues = useMemo(() => allOptions.map((option) => option.value), [allOptions]);
  const visibleItemValues = useMemo(
    () => visibleOptions.map((option) => option.value),
    [visibleOptions],
  );

  const selectOption = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    setQuery("");
  };
  const accessibleLabel = `Filter by ${category}: ${selectedOption.label}`;
  const displayCategory = `${category.slice(0, 1).toLocaleUpperCase()}${category.slice(1)}`;

  return (
    <div className="@container/inbox-filter min-w-0">
      <Combobox
        autoHighlight
        filteredItems={visibleItemValues}
        items={itemValues}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setQuery("");
        }}
        open={open}
        value={selectedOption.value}
      >
        <ComboboxTrigger
          aria-label={accessibleLabel}
          className={cn(
            "group/filter inline-flex h-6 w-full min-w-0 cursor-pointer items-center gap-1 rounded-md border border-border bg-background px-1.5 text-[10px] text-muted-foreground outline-hidden ring-ring transition-[border-color,background-color,color]",
            "hover:bg-accent/80 hover:text-foreground focus-visible:ring-2",
            value !== "all" && "border-ring/35 bg-accent text-foreground",
          )}
          render={<button aria-label={accessibleLabel} type="button" />}
          title={`${displayCategory}: ${selectedOption.label}`}
        >
          <span className="sr-only">Filter by {category}: </span>
          <span
            aria-hidden
            className="inline-flex size-3.5 shrink-0 items-center justify-center overflow-hidden rounded-sm [&_img]:size-3.5 [&_svg]:size-3"
          >
            {selectedOption.artwork}
          </span>
          <span
            className="hidden min-w-0 flex-1 truncate text-left @[5.25rem]/inbox-filter:block"
            data-testid="inbox-filter-label"
          >
            {selectedOption.label}
          </span>
          <ChevronDownIcon
            aria-hidden
            className="ml-auto size-2.5 shrink-0 opacity-55 transition-transform group-data-[popup-open]/filter:rotate-180"
            data-testid="inbox-filter-chevron"
          />
        </ComboboxTrigger>
        <ComboboxPopup
          align="start"
          className="w-[min(15rem,var(--available-width))] data-ending-style:translate-y-1 data-starting-style:translate-y-1"
        >
          {searchable ? (
            <div className="border-b p-1">
              <ComboboxInput
                aria-label={`Search ${category.toLocaleLowerCase()} options`}
                className="rounded-md"
                inputClassName="h-7 text-xs ring-0"
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${category.toLocaleLowerCase()}s`}
                showTrigger={false}
                size="sm"
                value={query}
              />
            </div>
          ) : null}
          <ComboboxEmpty className="py-3 text-xs font-normal">
            No {category.toLocaleLowerCase()}s found.
          </ComboboxEmpty>
          <ComboboxList className="max-h-64">
            {visibleOptions.map((option, index) => (
              <ComboboxItem
                className="min-h-7 text-xs"
                contentClassName="min-w-0"
                index={index}
                indicatorPosition="end"
                key={option.value}
                onClick={() => selectOption(option.value)}
                value={option.value}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-sm [&_img]:size-4 [&_svg]:size-3.5"
                  >
                    {option.artwork}
                  </span>
                  <span className="truncate">{option.label}</span>
                </span>
              </ComboboxItem>
            ))}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
    </div>
  );
}
