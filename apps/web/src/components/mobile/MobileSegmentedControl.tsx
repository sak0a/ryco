import { useId, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { boundedDisabledReason } from "~/components/mobile/MobileListRow";

/**
 * The phone segmented control: for an enumeration of about three options where
 * a sheet would be heavier than the choice itself.
 *
 * Each segment is a discrete ≥44 px button that commits only on its own
 * activation. That is the point of the primitive for a security-relevant
 * enumeration: there is no wheel, slider, or drag to sweep past neighbouring
 * options into the consequential one, so choosing it is deliberate. A segment
 * may additionally carry the `caution` tone, which is the warning treatment the
 * composer already gives full access.
 *
 * Selected state is announced through `aria-pressed`, following the precedent
 * `MobileListRow` sets — styling alone never conveys it.
 *
 * Presentation only: props in, callbacks out. No store, RPC, lifecycle, or
 * connectivity access lives in `components/mobile/`.
 */

export type MobileSegmentedControlTone = "default" | "caution";

export interface MobileSegmentedControlOption {
  readonly id: string;
  readonly label: string;
  /** Decorative — the label carries the accessible name. */
  readonly icon?: ReactNode | undefined;
  /** Shown under the group while this option is the selected one. */
  readonly description?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly disabledReason?: string | undefined;
  /** `caution` renders the warning treatment for a consequential option. */
  readonly tone?: MobileSegmentedControlTone | undefined;
}

export interface MobileSegmentedControlProps {
  /** Accessible name for the group. */
  readonly label: string;
  readonly value: string;
  readonly options: ReadonlyArray<MobileSegmentedControlOption>;
  /** Renders the disabled presentation and blocks every change. */
  readonly disabled?: boolean | undefined;
  /** Shown and announced when `disabled`. Bounded before it is rendered. */
  readonly disabledReason?: string | undefined;
  readonly onChange: (optionId: string) => void;
  readonly className?: string | undefined;
}

export function MobileSegmentedControl({
  label,
  value,
  options,
  disabled = false,
  disabledReason,
  onChange,
  className,
}: MobileSegmentedControlProps) {
  const baseId = useId();
  const reasonId = `${baseId}-reason`;
  const reason = disabled && disabledReason ? boundedDisabledReason(disabledReason) : null;
  const selected = options.find((option) => option.id === value) ?? null;
  const selectedDescription =
    selected?.disabled === true && selected.disabledReason
      ? boundedDisabledReason(selected.disabledReason)
      : (selected?.description ?? null);

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)} data-slot="mobile-segmented">
      <div className="font-medium text-muted-foreground text-xs">{label}</div>
      <div
        role="group"
        aria-label={label}
        {...(reason ? { "aria-describedby": reasonId } : {})}
        className="flex min-w-0 items-stretch gap-1 rounded-lg bg-muted/50 p-1"
        data-slot="mobile-segmented-group"
      >
        {options.map((option) => {
          const optionDisabled = disabled || (option.disabled ?? false);
          const isSelected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={isSelected}
              disabled={optionDisabled}
              data-tone={option.tone ?? "default"}
              // `min-h-11` is the 44px floor, and `basis-0 grow` keeps every
              // segment the same width regardless of label length.
              className={cn(
                "flex min-h-11 min-w-0 basis-0 grow flex-col items-center justify-center gap-0.5 rounded-md px-1 text-center text-xs",
                "transition-colors duration-[var(--app-motion-duration-chip)] ease-[var(--app-motion-ease)] motion-reduce:transition-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:pointer-events-none disabled:text-muted-foreground/60",
                isSelected ? "bg-background font-medium shadow-sm" : "text-muted-foreground",
                // The warning treatment full access already carries in the
                // composer, kept rather than translated away.
                option.tone === "caution" &&
                  !optionDisabled &&
                  "text-orange-700 dark:text-orange-400",
              )}
              data-slot="mobile-segmented-option"
              // Activation only. No pointer-enter or drag path may commit a
              // change: sweeping past a consequential option must not select it.
              onClick={() => {
                if (optionDisabled) return;
                onChange(option.id);
              }}
            >
              {option.icon}
              <span className="w-full truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
      {reason ? (
        <p
          id={reasonId}
          className="text-muted-foreground/80 text-xs"
          data-slot="mobile-segmented-reason"
        >
          {reason}
        </p>
      ) : selectedDescription ? (
        <p className="text-muted-foreground text-xs" data-slot="mobile-segmented-description">
          {selectedDescription}
        </p>
      ) : null}
    </div>
  );
}
