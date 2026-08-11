import type { MergedUsageSummary } from "@ryco/client-runtime/usage";
import {
  AlertCircleIcon,
  BrainCircuitIcon,
  CircleDollarSignIcon,
  DatabaseIcon,
  Layers3Icon,
  RefreshCwIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Button } from "~/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "~/components/ui/chart";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";
import {
  formatDayLabel,
  formatInteger,
  formatModelLabel,
  formatProviderLabel,
  formatTimestamp,
  formatTokens,
} from "~/lib/statisticsFormat";

import { Panel, StatePanel, StatSkeleton } from "../../settings/statistics/parts";
import type { StatisticsSearch } from "../statisticsSearch";
import { useUsageSummary } from "../useUsageSummary";
import {
  buildUsageBreakdown,
  buildUsageDaySeries,
  filterUsageBuckets,
  sumUsageTotals,
} from "./selectors";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const USAGE_PROVIDER_COLORS = {
  claude: "#d97757",
  codex: "var(--foreground)",
} as const;

function formatCost(value: number | null): string {
  return value === null ? "Unavailable" : usd.format(value);
}

export function UsageView({
  search,
  onSearchChange,
}: {
  readonly search: StatisticsSearch;
  readonly onSearchChange: (next: StatisticsSearch) => void;
}) {
  const result = useUsageSummary({
    range: search.range,
    environmentIds: search.environmentIds,
  });
  const { merged } = result;
  const derived = useMemo(() => {
    if (!merged) return null;
    const buckets = filterUsageBuckets(merged, search.providers);
    return {
      buckets,
      totals: sumUsageTotals(merged, buckets),
      days: buildUsageDaySeries(merged, buckets),
      breakdown: buildUsageBreakdown(buckets, search.usageBreakdown),
    };
  }, [merged, search.providers, search.usageBreakdown]);

  if (result.loading && !merged) return <StatSkeleton />;
  if (!merged || !derived) {
    const failed = result.environments.filter(
      (environment) =>
        environment.status === "failed" ||
        environment.status === "unavailable" ||
        environment.status === "stale-contract",
    );
    return (
      <StatePanel
        icon={failed.length > 0 ? AlertCircleIcon : DatabaseIcon}
        title={failed.length > 0 ? "Couldn’t load usage" : "No usage environments are connected"}
        description={
          failed.length > 0
            ? `Usage failed for ${failed.map((environment) => environment.label).join(", ")}. ${failed[0]?.message ?? "Retry after checking the environment connection."}`
            : "Connect an environment with Claude Code or Codex transcripts, then refresh this view."
        }
        action={
          <Button size="sm" variant="outline" onClick={result.refresh}>
            <RefreshCwIcon /> Refresh
          </Button>
        }
      />
    );
  }

  const { totals, days, breakdown } = derived;
  const pricedShare =
    totals.pricedTokenCount + totals.unpricedTokenCount > 0
      ? totals.pricedTokenCount / (totals.pricedTokenCount + totals.unpricedTokenCount)
      : 0;
  const cacheShare =
    totals.uncachedInputTokens + totals.cachedInputTokens + totals.cacheCreationInputTokens > 0
      ? totals.cachedInputTokens /
        (totals.uncachedInputTokens + totals.cachedInputTokens + totals.cacheCreationInputTokens)
      : 0;
  const allSelectedEnvironments = search.environmentIds === undefined;
  const selectedEnvironmentValue =
    allSelectedEnvironments || search.environmentIds?.length !== 1
      ? "all"
      : search.environmentIds[0]!;
  const foundTranscriptSource = merged.sources.some(
    (source) => source.included && source.status !== "not-found",
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <RangeControl search={search} onSearchChange={onSearchChange} />
          <Select
            value={selectedEnvironmentValue}
            onValueChange={(value: string | null) =>
              onSearchChange({
                ...search,
                ...(value === null || value === "all"
                  ? { environmentIds: undefined }
                  : { environmentIds: [value] }),
              })
            }
          >
            <SelectTrigger size="sm" className="w-48" aria-label="Usage environment">
              <SelectValue>
                {selectedEnvironmentValue === "all"
                  ? `All environments (${result.availableEnvironments.length})`
                  : (result.availableEnvironments.find(
                      (item) => item.environmentId === selectedEnvironmentValue,
                    )?.label ?? "Environment")}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              <SelectItem value="all">All environments</SelectItem>
              {result.availableEnvironments.map((environment) => (
                <SelectItem key={environment.environmentId} value={environment.environmentId}>
                  {environment.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <ProviderControl search={search} onSearchChange={onSearchChange} />
        </div>
        <Button size="sm" variant="outline" onClick={result.refresh} disabled={result.refreshing}>
          <RefreshCwIcon className={result.refreshing ? "animate-spin" : undefined} />
          {result.refreshing ? "Refreshing" : "Refresh"}
        </Button>
      </div>

      <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
        Provider-recorded usage from Claude Code and Codex transcripts on the selected machines.
        This includes sessions run outside Ryco and is intentionally not attributed to projects.
      </p>

      {derived.buckets.length === 0 ? (
        <StatePanel
          icon={Layers3Icon}
          title={foundTranscriptSource ? "No usage in this range" : "No transcript sources found"}
          description={
            foundTranscriptSource
              ? "The transcript sources were found, but no provider-recorded usage matched these filters."
              : "Claude Code and Codex transcript directories were not found on the selected environments."
          }
        />
      ) : (
        <>
          <section className="grid overflow-hidden rounded-2xl border border-border/75 bg-card shadow-sm/5 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.55fr)]">
            <div className="flex min-h-80 flex-col justify-between border-b border-border/70 p-6 lg:border-r lg:border-b-0 lg:p-8">
              <div>
                <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  <CircleDollarSignIcon className="size-3.5" /> Raw API-equivalent cost
                </div>
                <div className="mt-5 text-4xl font-semibold tracking-[-0.045em] tabular-nums sm:text-5xl">
                  {formatCost(totals.estimatedCostUsd)}
                </div>
                <p className="mt-3 max-w-sm text-xs leading-relaxed text-muted-foreground">
                  Estimate based on base API rates. Subscription, credits, batch, negotiated, and
                  provider billing may differ.
                </p>
              </div>
              <div className="space-y-4 border-t border-border/65 pt-5">
                <SummaryLine
                  label="Priced coverage"
                  value={`${Math.round(pricedShare * 100)}% of tokens`}
                />
                <SummaryLine
                  label="Estimated cache savings"
                  value={formatCost(totals.estimatedCacheSavingsUsd)}
                />
                <SummaryLine
                  label="Provider-recorded tokens"
                  value={formatInteger(totals.totalTokens)}
                />
              </div>
            </div>
            <div className="min-w-0 p-4 sm:p-6">
              <div className="mb-2 flex items-center justify-between gap-3 px-1">
                <div>
                  <h2 className="text-sm font-semibold">Usage over time</h2>
                  <p className="text-xs text-muted-foreground">Daily values in {merged.timeZone}</p>
                </div>
                <MetricToggle search={search} onSearchChange={onSearchChange} />
              </div>
              <UsageAreaChart data={days} metric={search.usageMetric} />
              <div className="flex items-center justify-end gap-4 px-2 text-[11px] text-muted-foreground">
                <LegendDot color={USAGE_PROVIDER_COLORS.claude} label="Claude" />
                <LegendDot color={USAGE_PROVIDER_COLORS.codex} label="Codex" />
              </div>
            </div>
          </section>

          <div className="grid grid-cols-2 border-y border-border/65 md:grid-cols-5">
            <MetricRail label="Total tokens" value={formatTokens(totals.totalTokens)} />
            <MetricRail label="Sessions" value={formatInteger(totals.distinctSessionCount)} />
            <MetricRail label="Responses" value={formatInteger(totals.responseCount)} />
            <MetricRail label="Cache read" value={`${Math.round(cacheShare * 100)}%`} />
            <MetricRail
              label="Reasoning"
              value={formatTokens(totals.reasoningTokens)}
              detail="included in output"
            />
          </div>

          <Panel
            title="Breakdown"
            icon={Layers3Icon}
            action={<BreakdownToggle search={search} onSearchChange={onSearchChange} />}
            bodyClassName="overflow-hidden"
          >
            <div className="divide-y divide-border/60">
              {breakdown.slice(0, 20).map((row) => (
                <div
                  key={row.key}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-5 px-4 py-3.5 sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {search.usageBreakdown === "model"
                        ? formatModelLabel(row.label)
                        : formatDayLabel(row.label)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {row.provider
                        ? formatProviderLabel(row.provider)
                        : `${row.responses} responses`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium tabular-nums">{formatTokens(row.tokens)}</p>
                    <p className="text-[11px] text-muted-foreground">tokens</p>
                  </div>
                  <div className="w-24 text-right">
                    <p className="text-sm font-medium tabular-nums">{formatCost(row.costUsd)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {row.unpricedTokens > 0
                        ? `${formatTokens(row.unpricedTokens)} unpriced`
                        : "estimated"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Coverage summary={merged} />
        </>
      )}
    </div>
  );
}

function RangeControl({ search, onSearchChange }: SearchControlProps) {
  return (
    <div className="inline-flex rounded-lg border bg-card p-0.5">
      {(["7d", "30d", "90d", "all"] as const).map((range) => (
        <button
          key={range}
          type="button"
          onClick={() => onSearchChange({ ...search, range })}
          className={cn(
            "h-7 rounded-md px-2.5 text-xs font-medium transition-colors",
            search.range === range
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {range === "all" ? "All" : range.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

interface SearchControlProps {
  readonly search: StatisticsSearch;
  readonly onSearchChange: (next: StatisticsSearch) => void;
}

function ProviderControl({ search, onSearchChange }: SearchControlProps) {
  const selected = new Set<"claude" | "codex">(search.providers ?? (["claude", "codex"] as const));
  return (
    <div className="inline-flex rounded-lg border bg-card p-0.5">
      {(["claude", "codex"] as const).map((provider) => (
        <button
          key={provider}
          type="button"
          aria-pressed={selected.has(provider)}
          onClick={() => {
            const next = new Set(selected);
            if (next.has(provider) && next.size > 1) next.delete(provider);
            else next.add(provider);
            const providers = [...next].toSorted();
            onSearchChange({
              ...search,
              ...(providers.length === 2 ? { providers: undefined } : { providers }),
            });
          }}
          className={cn(
            "inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium capitalize transition-colors",
            selected.has(provider)
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span
            aria-hidden
            className="mr-1.5 inline-block size-1.5 rounded-full"
            style={{ backgroundColor: USAGE_PROVIDER_COLORS[provider] }}
          />
          {provider}
        </button>
      ))}
    </div>
  );
}

function MetricToggle({ search, onSearchChange }: SearchControlProps) {
  return (
    <div className="inline-flex rounded-md bg-muted p-0.5">
      {(["cost", "tokens"] as const).map((metric) => (
        <button
          key={metric}
          type="button"
          onClick={() => onSearchChange({ ...search, usageMetric: metric })}
          className={cn(
            "h-6 rounded-sm px-2 text-[11px] font-medium capitalize",
            search.usageMetric === metric
              ? "bg-background text-foreground shadow-xs"
              : "text-muted-foreground",
          )}
        >
          {metric}
        </button>
      ))}
    </div>
  );
}

function BreakdownToggle({ search, onSearchChange }: SearchControlProps) {
  return (
    <div className="inline-flex items-center gap-1 text-[11px]">
      {(["model", "day"] as const).map((dimension) => (
        <button
          key={dimension}
          type="button"
          onClick={() => onSearchChange({ ...search, usageBreakdown: dimension })}
          className={cn(
            "rounded-md px-2 py-1 capitalize",
            search.usageBreakdown === dimension
              ? "bg-accent text-foreground"
              : "text-muted-foreground",
          )}
        >
          {dimension}
        </button>
      ))}
    </div>
  );
}

function UsageAreaChart({
  data,
  metric,
}: {
  readonly data: ReturnType<typeof buildUsageDaySeries>;
  readonly metric: "cost" | "tokens";
}) {
  const suffix = metric === "cost" ? "Cost" : "Tokens";
  return (
    <ChartContainer className="h-[300px]">
      <AreaChart data={[...data]} margin={{ left: 4, right: 10, top: 18, bottom: 0 }}>
        <defs>
          <linearGradient id="usageClaude" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={USAGE_PROVIDER_COLORS.claude} stopOpacity={0.3} />
            <stop offset="95%" stopColor={USAGE_PROVIDER_COLORS.claude} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="usageCodex" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={USAGE_PROVIDER_COLORS.codex} stopOpacity={0.18} />
            <stop offset="95%" stopColor={USAGE_PROVIDER_COLORS.codex} stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 5" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          minTickGap={30}
          tickFormatter={(value) => formatDayLabel(String(value))}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={(value) =>
            metric === "cost"
              ? `$${Number(value).toFixed(Number(value) < 10 ? 1 : 0)}`
              : formatTokens(Number(value))
          }
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(label) => formatDayLabel(String(label))}
              formatter={(value) =>
                metric === "cost"
                  ? usd.format(Number(value) || 0)
                  : formatInteger(Number(value) || 0)
              }
            />
          }
        />
        <Area
          dataKey={`claude${suffix}`}
          name="Claude"
          type="monotone"
          stroke={USAGE_PROVIDER_COLORS.claude}
          fill="url(#usageClaude)"
          strokeWidth={1.75}
        />
        <Area
          dataKey={`codex${suffix}`}
          name="Codex"
          type="monotone"
          stroke={USAGE_PROVIDER_COLORS.codex}
          fill="url(#usageCodex)"
          strokeWidth={1.75}
        />
      </AreaChart>
    </ChartContainer>
  );
}

function SummaryLine({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function MetricRail({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
}) {
  return (
    <div className="border-r border-border/60 px-4 py-5 last:border-r-0">
      <p className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold tracking-tight tabular-nums">{value}</p>
      {detail ? <p className="mt-1 text-[10px] text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function LegendDot({ color, label }: { readonly color: string; readonly label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function Coverage({ summary }: { readonly summary: MergedUsageSummary }) {
  const included = summary.sources.filter((source) => source.included);
  const issues = included.filter((source) => source.status !== "complete");
  const failedEnvironments = summary.environments.filter(
    (environment) =>
      environment.status === "failed" ||
      environment.status === "unavailable" ||
      environment.status === "stale-contract",
  );
  const pricingStates = summary.environments.flatMap((environment) =>
    environment.summary === undefined ? [] : [environment.summary.pricing.state],
  );
  const pricingState =
    pricingStates.length === 0
      ? "Unavailable"
      : pricingStates.every((state) => state === "live")
        ? "Live"
        : pricingStates.every((state) => state === "cached")
          ? "Cached"
          : pricingStates.every((state) => state === "unavailable")
            ? "Unavailable"
            : "Mixed";
  const pricingFetch = summary.environments
    .flatMap((environment) => {
      const fetchedAt = environment.summary?.pricing.fetchedAt;
      return fetchedAt === undefined ? [] : [fetchedAt];
    })
    .toSorted()
    .at(-1);
  const latestScan = included
    .map((source) => source.scanFinishedAt)
    .toSorted()
    .at(-1);
  return (
    <Panel title="Coverage & estimates" icon={BrainCircuitIcon} bodyClassName="p-5">
      {failedEnvironments.length > 0 ? (
        <div className="mb-5 flex gap-2 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2.5 text-xs text-muted-foreground">
          <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span>
            No usage was included from{" "}
            {failedEnvironments.map((environment) => environment.label).join(", ")}.
          </span>
        </div>
      ) : null}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <CoverageItem
          icon={DatabaseIcon}
          label="Transcript sources"
          value={`${included.length} included`}
          detail={
            summary.duplicateSourceCount > 0
              ? `${summary.duplicateSourceCount} duplicate source excluded`
              : "No physical duplicates detected"
          }
        />
        <CoverageItem
          icon={SparklesIcon}
          label="Last scan"
          value={latestScan ? formatTimestamp(latestScan) : "Not scanned"}
          detail={`${included.reduce((sum, source) => sum + source.reusedCacheFileCount, 0)} cached files reused`}
        />
        <CoverageItem
          icon={CircleDollarSignIcon}
          label="Pricing"
          value={pricingState}
          detail={
            pricingFetch
              ? `Rates fetched ${formatTimestamp(pricingFetch)}`
              : "Token totals remain available without rates"
          }
        />
        <CoverageItem
          icon={AlertCircleIcon}
          label="Coverage state"
          value={
            issues.length === 0
              ? "Complete"
              : `${issues.length} source notice${issues.length === 1 ? "" : "s"}`
          }
          detail={
            summary.environmentOnlyDeduplicationWarning
              ? "Some sources could only be scoped per environment"
              : `${included.reduce((sum, source) => sum + source.malformedLineCount, 0)} malformed lines skipped`
          }
        />
      </div>
    </Panel>
  );
}

function CoverageItem({
  icon: Icon,
  label,
  value,
  detail,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-sm font-medium">{value}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
