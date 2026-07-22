import { useId, type ReactNode } from "react";

import { boundedDisabledReason } from "~/lib/boundedReason";
import { cn } from "~/lib/utils";

/**
 * The phone touch-row primitive. Replaces the row class string that was
 * duplicated across the phone sheets and app bar.
 *
 * Presentation only: props in, callbacks out. The row never reads a store or
 * decides whether an action is available — the caller passes `disabled` plus a
 * bounded reason.
 */

/**
 * Re-exported so the existing `components/mobile/` call sites keep one import,
 * while the bound itself is shared with the traits controls and the model
 * picker rather than copied per surface.
 */
export { boundedDisabledReason };

export interface MobileListRowProps {
  readonly label: ReactNode;
  /** Leading icon. Decorative — the label carries the accessible name. */
  readonly icon?: ReactNode | undefined;
  /** Optional second line under the label. */
  readonly secondaryText?: ReactNode | undefined;
  /** Optional trailing state (a check, a presence dot, a chevron). */
  readonly trailing?: ReactNode | undefined;
  readonly disabled?: boolean | undefined;
  /** Shown and announced as the row's description when the row is disabled. */
  readonly disabledReason?: string | undefined;
  readonly destructive?: boolean | undefined;
  /**
   * Selected state for a row that is one of a set of choices. Passing it — even
   * as `false` — makes the row announce its state through `aria-pressed`;
   * omitting it leaves the row a plain button, which is what a navigation or
   * action row is. The check glyph call sites render alongside is decorative,
   * so it is not what conveys the state.
   */
  readonly selected?: boolean | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly className?: string | undefined;
}

export function MobileListRow({
  label,
  icon,
  secondaryText,
  trailing,
  disabled = false,
  disabledReason,
  destructive = false,
  selected,
  onClick,
  className,
}: MobileListRowProps) {
  const baseId = useId();
  const reason = disabled && disabledReason ? boundedDisabledReason(disabledReason) : null;
  const labelId = `${baseId}-label`;
  const secondaryId = `${baseId}-secondary`;
  const trailingId = `${baseId}-trailing`;
  const reasonId = `${baseId}-reason`;

  // The reason is a description, not part of the row's name. Redirecting the
  // name at every other content element — rather than at the label alone —
  // keeps it identical to the name the same row has when it is enabled:
  // trailing state such as a presence indicator is content a reader must
  // still hear, and dropping it would silently hide online/offline exactly on
  // the rows a person cannot activate.
  const nameIds = [labelId, secondaryText ? secondaryId : null, trailing ? trailingId : null]
    .filter((id) => id !== null)
    .join(" ");

  return (
    <button
      type="button"
      disabled={disabled}
      aria-labelledby={reason ? nameIds : undefined}
      aria-describedby={reason ? reasonId : undefined}
      // `aria-pressed` rather than `aria-checked`: these rows are buttons, and
      // `aria-checked` would require a `radiogroup`/`listbox` container role
      // that call sites do not have. Without it a reader announces a set of
      // choices as identical plain buttons.
      aria-pressed={selected}
      // `min-h-11` is the 44px effective touch target; the row is full width,
      // so the smaller axis is always the height.
      className={cn(
        "flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:text-muted-foreground/60",
        destructive && !disabled && "text-destructive",
        selected && "bg-accent/60 font-medium",
        className,
      )}
      data-slot="mobile-list-row"
      onClick={onClick}
    >
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span id={labelId} className="truncate">
          {label}
        </span>
        {secondaryText ? (
          <span id={secondaryId} className="truncate text-xs text-muted-foreground">
            {secondaryText}
          </span>
        ) : null}
        {reason ? (
          <span id={reasonId} className="truncate text-xs text-muted-foreground/80">
            {reason}
          </span>
        ) : null}
      </span>
      {trailing ? (
        <span id={trailingId} className="flex shrink-0 items-center gap-2">
          {trailing}
        </span>
      ) : null}
    </button>
  );
}
