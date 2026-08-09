import type {
  ModelCapabilities,
  PullRequestAiConfiguration,
  PullRequestAiModelSelection,
  PullRequestAiRun,
  ProviderOptionDescriptor,
} from "@ryco/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
} from "@ryco/shared/model";
import {
  BrainCircuitIcon,
  ChevronDownIcon,
  CircleStopIcon,
  Clock3Icon,
  Settings2Icon,
  SparklesIcon,
} from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";

export interface PullRequestAiModelChoice {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly selection: PullRequestAiModelSelection;
  readonly capabilities: ModelCapabilities;
}

interface PullRequestAiInboxControlsProps {
  readonly configuration: PullRequestAiConfiguration;
  readonly models: ReadonlyArray<PullRequestAiModelChoice>;
  readonly activeRuns: ReadonlyArray<PullRequestAiRun>;
  readonly analyzedCount: number;
  readonly visibleCount: number;
  readonly error: string | null;
  readonly onModelChange: (selection: PullRequestAiModelSelection) => void;
  readonly onConfigurationChange: (configuration: PullRequestAiConfiguration) => void;
  readonly onAnalyze: () => void;
  readonly onCancel: (run: PullRequestAiRun) => void;
}

const intervals: ReadonlyArray<{ readonly value: number; readonly label: string }> = [
  { value: 30, label: "Every 30 minutes" },
  { value: 60, label: "Every hour" },
  { value: 180, label: "Every 3 hours" },
  { value: 360, label: "Every 6 hours" },
  { value: 720, label: "Every 12 hours" },
  { value: 1440, label: "Daily" },
];

const EFFORT_DESCRIPTOR_IDS = new Set(["effort", "reasoningEffort", "reasoning"]);

function replaceDescriptorValue(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  descriptorId: string,
  value: string | boolean,
): ReadonlyArray<ProviderOptionDescriptor> {
  return descriptors.map((descriptor) =>
    descriptor.id !== descriptorId ? descriptor : { ...descriptor, currentValue: value },
  ) as ReadonlyArray<ProviderOptionDescriptor>;
}

function runProgress(run: PullRequestAiRun): number {
  if (run.status === "deep-analysis") {
    if (run.progress.deepPlanned === 0) return 85;
    return Math.min(
      98,
      70 + Math.round((run.progress.deepCompleted / run.progress.deepPlanned) * 28),
    );
  }
  if (run.status === "ranking") {
    if (run.progress.planned === 0) return 12;
    return Math.max(12, Math.round((run.progress.ranked / run.progress.planned) * 65));
  }
  return 6;
}

function runLabel(run: PullRequestAiRun): string {
  if (run.status === "deep-analysis") {
    return `Deep review ${run.progress.deepCompleted}/${run.progress.deepPlanned}`;
  }
  if (run.status === "ranking") return `Ranking ${run.progress.ranked}/${run.progress.planned}`;
  if (run.status === "cancelling") return "Cancelling";
  return "Preparing analysis";
}

export function PullRequestAiInboxControls(props: PullRequestAiInboxControlsProps) {
  const selectionKey = `${props.configuration.modelSelection.instanceId}::${props.configuration.modelSelection.model}`;
  const selectedModel = props.models.find((model) => model.key === selectionKey);
  const modelDescriptors = selectedModel
    ? getProviderOptionDescriptors({
        caps: selectedModel.capabilities,
        selections: props.configuration.modelSelection.options,
      })
    : [];
  const effortDescriptor = modelDescriptors.find(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "select" }> =>
      descriptor.type === "select" && EFFORT_DESCRIPTOR_IDS.has(descriptor.id),
  );
  const fastModeDescriptor = modelDescriptors.find(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "boolean" }> =>
      descriptor.type === "boolean" && descriptor.id === "fastMode",
  );
  const activeRun = props.activeRuns[0] ?? null;
  const update = (patch: Partial<PullRequestAiConfiguration>) =>
    props.onConfigurationChange({ ...props.configuration, ...patch });
  const selectModel = (model: PullRequestAiModelChoice) => {
    const descriptors = getProviderOptionDescriptors({ caps: model.capabilities });
    const options = buildProviderOptionSelectionsFromDescriptors(descriptors);
    props.onModelChange({ ...model.selection, ...(options ? { options } : {}) });
  };
  const updateModelDescriptor = (descriptorId: string, value: string | boolean) => {
    const options = buildProviderOptionSelectionsFromDescriptors(
      replaceDescriptorValue(modelDescriptors, descriptorId, value),
    );
    props.onModelChange({
      ...props.configuration.modelSelection,
      ...(options ? { options } : {}),
    });
  };

  return (
    <div className="relative z-[1] shrink-0 border-sky-500/12 border-b bg-sky-500/[0.025] px-3 py-2 backdrop-blur-xl">
      <div className="flex min-h-9 flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 pr-1">
          <span className="flex size-7 items-center justify-center rounded-lg border border-sky-500/16 bg-sky-500/7 text-sky-700 shadow-[inset_0_1px_0_rgb(255_255_255/0.13)] dark:text-sky-300">
            <BrainCircuitIcon className="size-3.5" />
          </span>
          <div>
            <p className="font-heading font-medium text-[11px]">Priority intelligence</p>
            <p className="text-[9px] text-muted-foreground">
              {props.analyzedCount > 0
                ? `${props.analyzedCount} of ${props.visibleCount} in this view analyzed`
                : "Advisory ranking from provider truth and a selected Ryco model"}
            </p>
          </div>
        </div>

        {activeRun ? (
          <div className="ml-auto flex min-w-52 max-w-72 flex-1 items-center gap-2 rounded-xl border border-sky-500/16 bg-background/28 px-2.5 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2 text-[9px]">
                <span className="truncate text-sky-800 dark:text-sky-200">
                  {runLabel(activeRun)}
                </span>
                <span className="font-mono text-muted-foreground">{runProgress(activeRun)}%</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-foreground/8">
                <div
                  className="h-full rounded-full bg-sky-500 transition-[width] duration-500"
                  style={{ width: `${runProgress(activeRun)}%` }}
                />
              </div>
            </div>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Cancel pull request analysis"
              onClick={() => props.onCancel(activeRun)}
            >
              <CircleStopIcon className="size-3" />
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={props.visibleCount === 0 || props.models.length === 0}
            onClick={props.onAnalyze}
            className="ml-auto rounded-xl border-sky-500/18 bg-background/38 text-sky-800 dark:text-sky-200"
          >
            <SparklesIcon className="size-3.5" /> Analyze current view
          </Button>
        )}

        <Popover>
          <PopoverTrigger
            render={
              <Button size="sm" variant="ghost" className="rounded-xl">
                <Settings2Icon className="size-3.5" /> Configure
                <ChevronDownIcon className="size-3 opacity-50" />
              </Button>
            }
          />
          <PopoverPopup surface="glass" align="end" className="w-[420px]" viewportClassName="p-4">
            <div>
              <p className="font-heading font-medium text-sm">Analysis model</p>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                Choose which configured Ryco model ranks and reviews the pull request inbox.
              </p>
              <Select
                value={selectionKey}
                onValueChange={(key) => {
                  const model = props.models.find((candidate) => candidate.key === key);
                  if (model) selectModel(model);
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="mt-2 rounded-xl border-border/50 bg-background/38"
                  aria-label="AI inbox model"
                >
                  <SelectValue>
                    {selectedModel?.label ?? props.configuration.modelSelection.model}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false} className="min-w-80">
                  {props.models.map((model) => (
                    <SelectItem key={model.key} value={model.key}>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{model.label}</span>
                        <span className="truncate text-[9px] text-muted-foreground">
                          {model.description}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>

            {effortDescriptor || fastModeDescriptor ? (
              <div className="mt-3 grid grid-cols-2 gap-3">
                {effortDescriptor ? (
                  <label className="grid gap-1 text-[9px] font-medium text-muted-foreground">
                    {effortDescriptor.label}
                    <Select
                      value={String(getProviderOptionCurrentValue(effortDescriptor) ?? "")}
                      onValueChange={(value) => {
                        if (value !== null) updateModelDescriptor(effortDescriptor.id, value);
                      }}
                    >
                      <SelectTrigger
                        size="sm"
                        className="bg-background/38"
                        aria-label="AI analysis effort"
                      >
                        <SelectValue>
                          {effortDescriptor.options.find(
                            (option) =>
                              option.id === getProviderOptionCurrentValue(effortDescriptor),
                          )?.label ?? "Default"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup align="start" alignItemWithTrigger={false}>
                        {effortDescriptor.options.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </label>
                ) : null}
                {fastModeDescriptor ? (
                  <label className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-border/40 bg-background/22 px-3 py-2 text-[10px]">
                    <span>
                      {fastModeDescriptor.label}
                      <span className="mt-0.5 block text-[9px] text-muted-foreground">
                        Prefer lower-latency analysis when supported.
                      </span>
                    </span>
                    <Switch
                      checked={getProviderOptionCurrentValue(fastModeDescriptor) === true}
                      onCheckedChange={(checked) =>
                        updateModelDescriptor(fastModeDescriptor.id, checked)
                      }
                      aria-label="Fast analysis"
                    />
                  </label>
                ) : null}
              </div>
            ) : null}

            <div className="my-4 border-border/45 border-t" />
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-heading font-medium text-sm">Background intelligence</p>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  Pre-analyze active PRs while Ryco is running. Disabled by default; generated
                  results are cached locally.
                </p>
              </div>
              <Switch
                checked={props.configuration.backgroundEnabled}
                onCheckedChange={(checked) => update({ backgroundEnabled: checked })}
                aria-label="Enable background pull request analysis"
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-border/45 border-t pt-4">
              <label className="grid gap-1 text-[9px] font-medium text-muted-foreground">
                Frequency
                <Select
                  value={String(props.configuration.intervalMinutes)}
                  onValueChange={(value) =>
                    update({
                      intervalMinutes: Number(
                        value,
                      ) as PullRequestAiConfiguration["intervalMinutes"],
                    })
                  }
                >
                  <SelectTrigger size="sm" className="bg-background/38">
                    <SelectValue>
                      {intervals.find(
                        (interval) => interval.value === props.configuration.intervalMinutes,
                      )?.label ?? "Every 3 hours"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="start" alignItemWithTrigger={false}>
                    {intervals.map((interval) => (
                      <SelectItem key={interval.value} value={String(interval.value)}>
                        {interval.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </label>
              <label className="grid gap-1 text-[9px] font-medium text-muted-foreground">
                Resource mode
                <Select
                  value={props.configuration.resourceMode}
                  onValueChange={(value) =>
                    update({ resourceMode: value as PullRequestAiConfiguration["resourceMode"] })
                  }
                >
                  <SelectTrigger size="sm" className="bg-background/38 capitalize">
                    <SelectValue>{props.configuration.resourceMode}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="start" alignItemWithTrigger={false}>
                    <SelectItem value="economical">Economical</SelectItem>
                    <SelectItem value="balanced">Balanced</SelectItem>
                    <SelectItem value="thorough">Thorough</SelectItem>
                  </SelectPopup>
                </Select>
              </label>
              <label className="grid gap-1 text-[9px] font-medium text-muted-foreground">
                PR limit per run
                <Input
                  nativeInput
                  size="sm"
                  type="number"
                  min={1}
                  max={25}
                  value={props.configuration.maxPullRequests}
                  onChange={(event) =>
                    update({
                      maxPullRequests: Math.max(
                        1,
                        Math.min(25, Number(event.currentTarget.value) || 1),
                      ),
                    })
                  }
                />
              </label>
              <label className="grid gap-1 text-[9px] font-medium text-muted-foreground">
                Deep reviews
                <Input
                  nativeInput
                  size="sm"
                  type="number"
                  min={0}
                  max={25}
                  value={props.configuration.maxDeepAnalyses}
                  onChange={(event) =>
                    update({
                      maxDeepAnalyses: Math.max(
                        0,
                        Math.min(25, Number(event.currentTarget.value) || 0),
                      ),
                    })
                  }
                />
              </label>
              <label className="grid gap-1 text-[9px] font-medium text-muted-foreground">
                Active window (days)
                <Input
                  nativeInput
                  size="sm"
                  type="number"
                  min={1}
                  max={90}
                  value={props.configuration.activeWindowDays}
                  onChange={(event) =>
                    update({
                      activeWindowDays: Math.max(
                        1,
                        Math.min(90, Number(event.currentTarget.value) || 1),
                      ),
                    })
                  }
                />
              </label>
            </div>
            <label className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border/40 bg-background/22 px-3 py-2.5 text-[10px]">
              <span>
                Include drafts
                <span className="mt-0.5 block text-[9px] text-muted-foreground">
                  Drafts are otherwise skipped by scheduled runs.
                </span>
              </span>
              <Switch
                checked={props.configuration.includeDrafts}
                onCheckedChange={(checked) => update({ includeDrafts: checked })}
              />
            </label>
            <p className="mt-3 flex items-start gap-1.5 text-[9px] leading-relaxed text-muted-foreground">
              <Clock3Icon className="mt-0.5 size-3 shrink-0" />
              PR metadata—and descriptions, comments, files, and bounded diffs for deep reviews—is
              sent to the selected model provider. Analysis is advisory and read-only; models cannot
              approve, merge, comment on, or modify pull requests.
            </p>
          </PopoverPopup>
        </Popover>
      </div>
      {props.error ? (
        <p className="mt-1.5 truncate px-1 text-[9px] text-rose-700 dark:text-rose-300">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}
