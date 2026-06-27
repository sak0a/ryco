"use client";

import * as React from "react";
import { ResponsiveContainer, Tooltip } from "recharts";

import { cn } from "~/lib/utils";

/**
 * Cohesive, restrained chart palette derived around the product's purple-blue
 * primary. Mid-lightness oklch values read well on both light and dark
 * surfaces. Use {@link chartColor} to map a category index to a stable color.
 */
export const CHART_PALETTE = [
  "oklch(0.62 0.19 264)", // primary purple-blue
  "oklch(0.70 0.12 195)", // teal
  "oklch(0.75 0.15 70)", // amber
  "oklch(0.65 0.21 18)", // rose
  "oklch(0.72 0.16 150)", // green
  "oklch(0.62 0.20 300)", // violet
  "oklch(0.70 0.13 232)", // sky
  "oklch(0.70 0.16 45)", // orange
] as const;

export function chartColor(index: number): string {
  return CHART_PALETTE[
    ((index % CHART_PALETTE.length) + CHART_PALETTE.length) % CHART_PALETTE.length
  ]!;
}

/**
 * Responsive wrapper around Recharts. The caller controls the size via
 * `className` (e.g. `h-[240px] w-full`); the chart fills it. Tick/grid/cursor
 * styling is normalised to the design tokens here so individual charts stay
 * declarative.
 */
export function ChartContainer({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { children: React.ReactElement }) {
  return (
    <div
      data-slot="chart"
      className={cn(
        "w-full text-xs",
        "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground",
        "[&_.recharts-cartesian-axis-line]:stroke-border/70",
        "[&_.recharts-cartesian-grid_line]:stroke-border/50",
        "[&_.recharts-curve.recharts-tooltip-cursor]:stroke-border",
        "[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted/50",
        "[&_.recharts-sector]:outline-none [&_.recharts-surface]:outline-none",
        className,
      )}
      {...props}
    >
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

/** Re-export of Recharts' Tooltip for ergonomic imports alongside the content. */
export const ChartTooltip = Tooltip;

export interface ChartTooltipPayloadItem {
  readonly name?: React.ReactNode;
  readonly value?: number | string;
  readonly color?: string;
  readonly dataKey?: string | number;
  readonly payload?: Record<string, unknown>;
}

/**
 * Tooltip body styled to match popovers. Pass as `content` to a Recharts
 * `<Tooltip />`; Recharts injects `active` / `payload` / `label` at render.
 */
export function ChartTooltipContent({
  active,
  payload,
  label,
  hideLabel = false,
  formatter,
  labelFormatter,
}: {
  readonly active?: boolean;
  readonly payload?: ReadonlyArray<ChartTooltipPayloadItem>;
  readonly label?: React.ReactNode;
  readonly hideLabel?: boolean;
  readonly formatter?: (
    value: number | string | undefined,
    name: React.ReactNode,
  ) => React.ReactNode;
  readonly labelFormatter?: (label: React.ReactNode) => React.ReactNode;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }
  return (
    <div className="min-w-32 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md">
      {!hideLabel && label != null && label !== "" ? (
        <div className="mb-1 font-medium text-foreground text-xs">
          {labelFormatter ? labelFormatter(label) : label}
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        {payload.map((item, index) => (
          <div key={index} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-muted-foreground">{item.name}</span>
            <span className="ml-auto font-medium text-foreground tabular-nums">
              {formatter ? formatter(item.value, item.name) : item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
