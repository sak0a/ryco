import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { formatModelLabel } from "~/lib/statisticsFormat";
import { cn } from "~/lib/utils";

import type { StatFilter, StatRange } from "./selectors";

const RANGES: ReadonlyArray<{ value: StatRange; label: string }> = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "all", label: "All" },
];

export function StatFilters({
  filter,
  onChange,
  projects,
  models,
}: {
  filter: StatFilter;
  onChange: (next: StatFilter) => void;
  projects: ReadonlyArray<{ id: string; title: string }>;
  models: ReadonlyArray<{ model: string }>;
}) {
  const activeProjectTitle = filter.projectId
    ? (projects.find((project) => project.id === filter.projectId)?.title ?? "Project")
    : "All projects";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center rounded-lg border bg-card p-0.5 not-dark:bg-clip-padding">
        {RANGES.map((range) => {
          const active = filter.range === range.value;
          return (
            <button
              key={range.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ ...filter, range: range.value })}
              className={cn(
                "h-7 rounded-md px-2.5 font-medium text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {range.label}
            </button>
          );
        })}
      </div>

      <Select
        value={filter.projectId ?? "all"}
        onValueChange={(value: string | null) =>
          onChange({ ...filter, projectId: !value || value === "all" ? null : value })
        }
      >
        <SelectTrigger className="h-8 w-44" aria-label="Filter by project">
          <SelectValue>{activeProjectTitle}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          <SelectItem value="all">All projects</SelectItem>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.title}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>

      <Select
        value={filter.model ?? "all"}
        onValueChange={(value: string | null) =>
          onChange({ ...filter, model: !value || value === "all" ? null : value })
        }
      >
        <SelectTrigger className="h-8 w-48" aria-label="Filter by model">
          <SelectValue>{filter.model ? formatModelLabel(filter.model) : "All models"}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          <SelectItem value="all">All models</SelectItem>
          {models.map((entry) => (
            <SelectItem key={entry.model} value={entry.model}>
              {formatModelLabel(entry.model)}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}
