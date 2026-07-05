import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { formatModelLabel, formatProviderLabel } from "~/lib/statisticsFormat";
import { cn } from "~/lib/utils";

import type { StatFilter, StatRange } from "./selectors";

const RANGES: ReadonlyArray<{ value: StatRange; label: string }> = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "all", label: "All" },
];

const MODEL_VALUE_SEPARATOR = "::";

function modelFilterValue(model: string | null, provider: string | null): string {
  return model
    ? `${encodeURIComponent(provider ?? "")}${MODEL_VALUE_SEPARATOR}${encodeURIComponent(model)}`
    : "all";
}

function parseModelFilterValue(value: string | null): Pick<StatFilter, "model" | "provider"> {
  if (!value || value === "all") {
    return { model: null, provider: null };
  }
  const separatorIndex = value.indexOf(MODEL_VALUE_SEPARATOR);
  if (separatorIndex < 0) {
    return { model: value, provider: null };
  }
  const provider = decodeURIComponent(value.slice(0, separatorIndex));
  const model = decodeURIComponent(value.slice(separatorIndex + MODEL_VALUE_SEPARATOR.length));
  return {
    model: model || null,
    provider: provider || null,
  };
}

function modelLabel(entry: { model: string; provider?: string | undefined }): string {
  return entry.provider
    ? `${formatProviderLabel(entry.provider)} · ${formatModelLabel(entry.model)}`
    : formatModelLabel(entry.model);
}

export function StatFilters({
  filter,
  onChange,
  projects,
  models,
}: {
  filter: StatFilter;
  onChange: (next: StatFilter) => void;
  projects: ReadonlyArray<{ id: string; title: string }>;
  models: ReadonlyArray<{ model: string; provider?: string | undefined }>;
}) {
  const activeProjectTitle = filter.projectId
    ? (projects.find((project) => project.id === filter.projectId)?.title ?? "Project")
    : "All projects";
  const activeModel = filter.model
    ? models.find(
        (entry) => entry.model === filter.model && (entry.provider ?? null) === filter.provider,
      )
    : undefined;

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
        value={modelFilterValue(filter.model, filter.provider)}
        onValueChange={(value: string | null) =>
          onChange({ ...filter, ...parseModelFilterValue(value) })
        }
      >
        <SelectTrigger className="h-8 w-48" aria-label="Filter by model">
          <SelectValue>{activeModel ? modelLabel(activeModel) : "All models"}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          <SelectItem value="all">All models</SelectItem>
          {models.map((entry) => (
            <SelectItem
              key={`${entry.provider ?? "unknown"}:${entry.model}`}
              value={modelFilterValue(entry.model, entry.provider ?? null)}
            >
              {modelLabel(entry)}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}
