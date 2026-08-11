import { useMemo } from "react";

import { formatDayLabel, formatDuration, formatInteger } from "~/lib/statisticsFormat";

import type { DayPoint } from "./selectors";

type HeatmapMetric = "turns" | "activeMs" | "files";

interface Cell {
  readonly date: string;
  readonly value: number;
}

function weekdayOf(date: string): number {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(parsed) ? 0 : new Date(parsed).getUTCDay();
}

function intensityLevel(value: number, max: number): number {
  if (value <= 0) {
    return 0;
  }
  return Math.min(4, Math.ceil((value / max) * 4));
}

const LEVEL_OPACITY = [0, 0.28, 0.5, 0.74, 1] as const;
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export function ActivityHeatmap({
  points,
  metric,
}: {
  points: ReadonlyArray<DayPoint>;
  metric: HeatmapMetric;
}) {
  const { weeks, max } = useMemo(() => {
    const cells: Array<Cell> = points.map((point) => ({
      date: point.date,
      value:
        metric === "turns"
          ? point.turns
          : metric === "activeMs"
            ? point.activeMs
            : point.filesChanged,
    }));
    const maxValue = cells.reduce((acc, cell) => Math.max(acc, cell.value), 0) || 1;
    const leadingPad = cells.length > 0 ? weekdayOf(cells[0]!.date) : 0;
    const padded: Array<Cell | null> = [...Array<null>(leadingPad).fill(null), ...cells];
    const grouped: Array<Array<Cell | null>> = [];
    for (let index = 0; index < padded.length; index += 7) {
      grouped.push(padded.slice(index, index + 7));
    }
    return { weeks: grouped, max: maxValue };
  }, [points, metric]);

  const describe = (cell: Cell) => {
    if (metric === "activeMs") {
      return `${formatDayLabel(cell.date)}: ${formatDuration(cell.value)} active`;
    }
    const unit = metric === "files" ? "files changed" : "turns";
    return `${formatDayLabel(cell.date)}: ${formatInteger(cell.value)} ${unit}`;
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-[3px] overflow-x-auto pb-1">
        {weeks.map((week) => {
          const weekKey = week.find((cell) => cell !== null)?.date ?? "empty-week";
          return (
            <div key={weekKey} className="flex flex-col gap-[3px]">
              {Array.from({ length: 7 }).map((_, dayIndex) => {
                const cell = week[dayIndex];
                if (!cell) {
                  return (
                    <div
                      key={`${weekKey}-${WEEKDAY_KEYS[dayIndex] ?? "unknown"}`}
                      className="size-2.5 rounded-[3px]"
                    />
                  );
                }
                const level = intensityLevel(cell.value, max);
                return (
                  <div
                    key={cell.date}
                    title={describe(cell)}
                    aria-label={describe(cell)}
                    role="img"
                    tabIndex={0}
                    className="size-2.5 rounded-[3px] ring-1 ring-inset ring-border/40"
                    style={
                      level === 0
                        ? { backgroundColor: "var(--muted)" }
                        : { backgroundColor: "var(--primary)", opacity: LEVEL_OPACITY[level] }
                    }
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5 self-end text-[11px] text-muted-foreground">
        <span>Less</span>
        {LEVEL_OPACITY.map((opacity, index) => (
          <span
            key={opacity}
            className="size-2.5 rounded-[3px] ring-1 ring-inset ring-border/40"
            style={
              index === 0
                ? { backgroundColor: "var(--muted)" }
                : { backgroundColor: "var(--primary)", opacity }
            }
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
