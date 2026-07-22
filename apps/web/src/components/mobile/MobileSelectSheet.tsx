"use client";

import { useState, type ReactNode } from "react";
import { SearchIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { boundedDisabledReason, MobileListRow } from "~/components/mobile/MobileListRow";
import {
  MobileSheet,
  MobileSheetHeader,
  MobileSheetPanel,
  MobileSheetTitle,
  type MobileSheetDetent,
} from "~/components/mobile/MobileSheet";

/**
 * The phone selection sheet: the replacement for a desktop popover/combobox on
 * the phone tier.
 *
 * What it guarantees over the desktop control it replaces:
 *
 * - **Rows are `MobileListRow`s**, so every option is a ≥44 px target and its
 *   selected state is announced through `aria-pressed` rather than being
 *   conveyed by styling alone.
 * - **Browse-first.** It opens at the partial detent and the focus trap is
 *   pointed at the list, not at the search field, so the software keyboard does
 *   not cover an already height-capped list the instant the sheet opens.
 *   Focusing search moves the sheet to the full detent so the keyboard has
 *   somewhere to go.
 * - **A disabled presentation with a bounded reason**, because both of its
 *   consumers are gated by mutation capability and neither may render a raw
 *   error, identifier, ticket, or payload.
 *
 * Momentum scrolling, the suppressed desktop scrollbar, the focus trap and the
 * focus restore are all inherited from `MobileSheet`.
 *
 * Presentation only: props in, callbacks out. No store, RPC, lifecycle, or
 * connectivity access lives in `components/mobile/`.
 */

export interface MobileSelectSheetOptionAction {
  /** The action's accessible name. It is icon-only, so this is required. */
  readonly label: string;
  /** Decorative — `label` carries the accessible name. */
  readonly icon: ReactNode;
  /** Toggle state, announced through `aria-pressed` when present. */
  readonly pressed?: boolean | undefined;
  readonly onSelect: () => void;
}

export interface MobileSelectSheetOption {
  readonly id: string;
  readonly label: ReactNode;
  readonly secondaryText?: ReactNode | undefined;
  /** Decorative — the label carries the accessible name. */
  readonly icon?: ReactNode | undefined;
  readonly trailing?: ReactNode | undefined;
  readonly selected?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly disabledReason?: string | undefined;
  /**
   * A secondary control rendered *beside* the row rather than inside it — a
   * favourite toggle, for example. It is a sibling because a row is a button
   * and a button may not nest another one.
   */
  readonly action?: MobileSelectSheetOptionAction | undefined;
}

export interface MobileSelectSheetGroup {
  readonly id: string;
  /** Section heading. Omit for an ungrouped list. */
  readonly label?: string | undefined;
  readonly options: ReadonlyArray<MobileSelectSheetOption>;
}

export interface MobileSelectSheetSearch {
  readonly value: string;
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
}

export interface MobileSelectSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Accessible name for the sheet and for its option list. */
  readonly label: string;
  readonly title?: ReactNode | undefined;
  readonly groups: ReadonlyArray<MobileSelectSheetGroup>;
  /** Omit to render a sheet with no search field at all. */
  readonly search?: MobileSelectSheetSearch | undefined;
  /** Opening detent. Partial by default — the sheet is browse-first. */
  readonly detent?: MobileSheetDetent | undefined;
  /** Renders the disabled presentation and blocks every selection. */
  readonly disabled?: boolean | undefined;
  /** Shown and announced when `disabled`. Bounded before it is rendered. */
  readonly disabledReason?: string | undefined;
  readonly emptyText?: string | undefined;
  readonly onSelect: (optionId: string) => void;
  readonly className?: string | undefined;
}

export function MobileSelectSheet({
  open,
  onOpenChange,
  label,
  title,
  groups,
  search,
  detent = "medium",
  disabled = false,
  disabledReason,
  emptyText = "No options",
  onSelect,
  className,
}: MobileSelectSheetProps) {
  const [activeDetent, setActiveDetent] = useState<MobileSheetDetent | null>(detent);
  const [wasOpen, setWasOpen] = useState(open);
  // Base UI resets its own snap point on close, but only for the closes IT
  // resolves — backdrop, swipe, Escape, the close control. A sheet closed by
  // its consumer instead, which is what committing a selection does, flips
  // `open` without that reset. Since this component controls the detent, the
  // reset has to happen here or a sheet whose search was focused once would
  // reopen at the full, keyboard-shaped detent for the life of the page.
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setActiveDetent(detent);
  }
  const reason = disabled && disabledReason ? boundedDisabledReason(disabledReason) : null;
  const hasOptions = groups.some((group) => group.options.length > 0);

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      label={label}
      detent={detent}
      activeDetent={activeDetent}
      onDetentChange={setActiveDetent}
      className={className}
    >
      <MobileSheetHeader>
        <MobileSheetTitle>{title ?? label}</MobileSheetTitle>
      </MobileSheetHeader>
      {reason ? (
        <p
          className="shrink-0 px-4 pb-2 text-muted-foreground text-xs"
          data-slot="mobile-select-sheet-reason"
        >
          {reason}
        </p>
      ) : null}
      {search ? (
        <div className="shrink-0 px-4 pb-2" data-slot="mobile-select-sheet-search">
          <label className="flex min-h-11 items-center gap-2 rounded-md border bg-background/60 px-3">
            <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground/60" />
            <span className="sr-only">{search.placeholder}</span>
            <input
              type="search"
              // Never autofocused, and deliberately not `autoFocus`: the sheet
              // opens browse-first. The detent moves only on an explicit focus.
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/60"
              disabled={disabled}
              placeholder={search.placeholder}
              value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
              onFocus={() => setActiveDetent("large")}
            />
          </label>
        </div>
      ) : null}
      <MobileSheetPanel>
        <div
          role="group"
          aria-label={label}
          className="space-y-0.5"
          data-slot="mobile-select-sheet-list"
        >
          {hasOptions ? (
            groups.map((group) =>
              group.options.length === 0 ? null : (
                <div key={group.id} data-slot="mobile-select-sheet-group">
                  {group.label ? (
                    <div
                      className="px-2 pt-2 pb-1 font-medium text-muted-foreground text-xs"
                      data-slot="mobile-select-sheet-group-label"
                    >
                      {group.label}
                    </div>
                  ) : null}
                  {group.options.map((option) => {
                    const optionDisabled = disabled || (option.disabled ?? false);
                    const optionReason = disabled
                      ? (disabledReason ?? undefined)
                      : option.disabledReason;
                    const row = (
                      <MobileListRow
                        label={option.label}
                        icon={option.icon}
                        secondaryText={option.secondaryText}
                        trailing={option.trailing}
                        selected={option.selected ?? false}
                        disabled={optionDisabled}
                        disabledReason={optionReason}
                        className={option.action ? "min-w-0 flex-1" : undefined}
                        onClick={() => {
                          // Defence in depth: the row is already disabled, so
                          // this only matters if a call site ever renders one
                          // enabled while the sheet itself is gated.
                          if (disabled) return;
                          onSelect(option.id);
                        }}
                      />
                    );
                    return option.action ? (
                      <div key={option.id} className="flex min-w-0 items-center gap-1">
                        {row}
                        <button
                          type="button"
                          aria-label={option.action.label}
                          aria-pressed={option.action.pressed}
                          disabled={optionDisabled}
                          className={cn(
                            "flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground",
                            "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            "disabled:pointer-events-none disabled:text-muted-foreground/60",
                          )}
                          data-slot="mobile-select-sheet-option-action"
                          onClick={option.action.onSelect}
                        >
                          {option.action.icon}
                        </button>
                      </div>
                    ) : (
                      <div key={option.id} className="min-w-0">
                        {row}
                      </div>
                    );
                  })}
                </div>
              ),
            )
          ) : (
            <p className="px-2 py-6 text-center text-muted-foreground text-sm">{emptyText}</p>
          )}
        </div>
      </MobileSheetPanel>
    </MobileSheet>
  );
}
