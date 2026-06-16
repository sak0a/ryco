import type { DiagnosticsSnapshot, DiagnosticsSpan } from "@ryco/contracts";
import { PauseIcon, PlayIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { cn } from "../../lib/utils";
import { useSlowRpcAckRequests } from "../../rpc/requestLatencyState";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SettingsPageContainer, SettingsSection, useRelativeTimeTick } from "./settingsLayout";
import {
  durationBucketSeries,
  formatBytes,
  formatDuration,
  formatPercent,
  latestFailureLabel,
  relativeTimeLabel,
  resourceCpuSeries,
  resourceMemorySeries,
  topSpanSeries,
} from "./DiagnosticsSettings.logic";

const POLL_INTERVAL_MS = 5_000;

interface SeriesPoint {
  readonly label: string;
  readonly value: number;
}

function MiniLineChart({
  points,
  formatValue,
}: {
  points: ReadonlyArray<SeriesPoint>;
  formatValue: (value: number) => string;
}) {
  const width = 320;
  const height = 96;
  const path = useMemo(() => {
    if (points.length === 0) return "";
    const max = Math.max(...points.map((point) => point.value), 1);
    return points
      .map((point, index) => {
        const x = points.length === 1 ? width : (index / (points.length - 1)) * width;
        const y = height - (point.value / max) * (height - 12) - 6;
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [points]);
  const latest = points.at(-1)?.value ?? 0;

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[11px] text-muted-foreground/70">
          {points.length} samples
        </span>
        <span className="font-mono text-xs text-foreground">{formatValue(latest)}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-24 w-full overflow-visible text-info"
        role="img"
        aria-label="Diagnostics history chart"
      >
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <line x1="0" y1={height - 1} x2={width} y2={height - 1} className="stroke-border" />
      </svg>
    </div>
  );
}

function BarList({
  points,
  formatValue = String,
}: {
  points: ReadonlyArray<SeriesPoint>;
  formatValue?: (value: number) => string;
}) {
  const max = Math.max(...points.map((point) => point.value), 1);
  if (points.length === 0) {
    return <p className="px-4 py-4 text-muted-foreground text-sm">No data yet.</p>;
  }

  return (
    <div className="divide-y divide-border/60">
      {points.map((point) => (
        <div
          key={point.label}
          className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-3 px-4 py-2.5"
        >
          <div className="min-w-0">
            <div className="mb-1 truncate text-[12px] font-medium">{point.label}</div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-info"
                style={{ width: `${Math.max(4, (point.value / max) * 100)}%` }}
              />
            </div>
          </div>
          <div className="text-right font-mono text-[11px] text-muted-foreground">
            {formatValue(point.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

function OverviewMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string | undefined;
}) {
  return (
    <div className="min-w-0 border-border/60 border-t px-4 py-3 first:border-t-0 sm:px-5">
      <div className="truncate text-[11px] font-medium text-muted-foreground uppercase tracking-[0.08em]">
        {label}
      </div>
      <div className="mt-1 truncate text-[15px] font-semibold text-foreground">{value}</div>
      {detail ? (
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{detail}</div>
      ) : null}
    </div>
  );
}

function RawDetails({ value }: { value: unknown }) {
  return (
    <details className="group">
      <summary className="cursor-pointer select-none text-[11px] text-muted-foreground hover:text-foreground">
        raw
      </summary>
      <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted/60 p-3 text-[11px] leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function SpanRows({ spans }: { spans: ReadonlyArray<DiagnosticsSpan> }) {
  if (spans.length === 0) {
    return <p className="px-4 py-4 text-muted-foreground text-sm">No spans retained yet.</p>;
  }
  return (
    <div className="divide-y divide-border/60">
      {spans.slice(0, 10).map((span) => (
        <div
          key={span.id}
          className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_6rem_5rem] sm:items-start"
        >
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[13px] font-medium">{span.name}</span>
              <Badge size="sm" variant={span.status === "success" ? "outline" : "error"}>
                {span.status}
              </Badge>
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
              {span.source} / {span.kind} / {span.spanId}
            </div>
            {span.failureMessage ? (
              <div className="mt-1 line-clamp-2 text-[11px] text-destructive">
                {span.failureMessage}
              </div>
            ) : null}
            <div className="mt-2">
              <RawDetails value={span} />
            </div>
          </div>
          <div className="font-mono text-[11px] text-muted-foreground sm:text-right">
            {formatDuration(span.durationMs)}
          </div>
          <div className="font-mono text-[11px] text-muted-foreground sm:text-right">
            {relativeTimeLabel(span.endTime)}
          </div>
        </div>
      ))}
    </div>
  );
}

function DiagnosticsWarnings({
  snapshot,
  error,
}: {
  snapshot: DiagnosticsSnapshot | null;
  error: string | null;
}) {
  if (!error && (!snapshot || snapshot.warnings.length === 0)) return null;

  return (
    <Alert variant={error ? "error" : "warning"}>
      <TriangleAlertIcon />
      <AlertTitle>{error ? "Diagnostics refresh failed" : "Diagnostics warnings"}</AlertTitle>
      <AlertDescription>
        {error ? <span>{error}</span> : null}
        {snapshot?.warnings.slice(0, 4).map((warning) => (
          <span key={`${warning.code}:${warning.source ?? ""}`}>
            {warning.message}
            {warning.count ? ` (${warning.count})` : ""}
          </span>
        ))}
      </AlertDescription>
    </Alert>
  );
}

export function DiagnosticsSettings() {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const refreshInFlightRef = useRef(false);
  const hasSnapshotRef = useRef(false);
  const cancelledRef = useRef(false);
  const slowRpcAcks = useSlowRpcAckRequests();
  const nowMs = useRelativeTimeTick(1_000);

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setLoading((current) => current && !hasSnapshotRef.current);
    try {
      const next = await ensureLocalApi().server.getDiagnosticsSnapshot();
      if (cancelledRef.current) return;
      setSnapshot(next);
      setError(null);
      hasSnapshotRef.current = true;
    } catch (refreshError) {
      if (cancelledRef.current) return;
      setError(
        refreshError instanceof Error ? refreshError.message : "Unable to refresh diagnostics.",
      );
    } finally {
      refreshInFlightRef.current = false;
      if (!cancelledRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    void refresh();
    if (paused) {
      return () => {
        cancelledRef.current = true;
      };
    }
    const id = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(id);
    };
  }, [paused, refresh]);

  const memorySeries = useMemo(
    () => resourceMemorySeries(snapshot?.resources.history ?? []),
    [snapshot],
  );
  const cpuSeries = useMemo(() => resourceCpuSeries(snapshot?.resources.history ?? []), [snapshot]);
  const latestFailure = snapshot ? latestFailureLabel(snapshot) : "No snapshot";

  return (
    <SettingsPageContainer>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-base font-semibold">Diagnostics</h1>
          <p className="mt-1 text-muted-foreground text-xs">
            {snapshot
              ? `Updated ${relativeTimeLabel(snapshot.generatedAt, nowMs)}`
              : "Waiting for snapshot"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="xs" variant="outline" onClick={() => setPaused((value) => !value)}>
            {paused ? <PlayIcon className="size-3.5" /> : <PauseIcon className="size-3.5" />}
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button size="xs" variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      <DiagnosticsWarnings snapshot={snapshot} error={error} />

      <SettingsSection title="Overview">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3">
          <OverviewMetric
            label="Uptime"
            value={snapshot ? formatDuration(snapshot.uptimeMs) : "n/a"}
            detail={
              snapshot ? `Started ${relativeTimeLabel(snapshot.serverStartedAt, nowMs)}` : undefined
            }
          />
          <OverviewMetric
            label="Memory"
            value={snapshot ? formatBytes(snapshot.resources.current.memory.rssBytes) : "n/a"}
            detail={
              snapshot
                ? `${formatBytes(snapshot.resources.current.memory.heapUsedBytes)} heap used`
                : undefined
            }
          />
          <OverviewMetric
            label="CPU"
            value={
              snapshot ? formatPercent(snapshot.resources.current.cpu.utilizationPercent) : "n/a"
            }
            detail={
              snapshot?.resources.current.eventLoopDelayMs !== undefined
                ? `${formatDuration(snapshot.resources.current.eventLoopDelayMs)} event loop delay`
                : undefined
            }
          />
          <OverviewMetric
            label="Activity"
            value={`${snapshot?.liveProcesses.providers.filter((provider) => provider.enabled).length ?? 0} providers`}
            detail={`${snapshot?.liveProcesses.terminals.length ?? 0} terminal sessions`}
          />
          <OverviewMetric
            label="Tracing"
            value={`${snapshot?.tracing.retainedSpanCount ?? 0} spans`}
            detail={snapshot ? `${snapshot.limits.fileTailBytes / 1024} KB file tail` : undefined}
          />
          <OverviewMetric label="Latest failure" value={latestFailure} />
        </div>
      </SettingsSection>

      <SettingsSection title="Resource history">
        <div className="grid gap-0 divide-y divide-border/60 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <div className="min-w-0 p-4">
            <div className="mb-1 text-[12px] font-semibold">RSS memory</div>
            <MiniLineChart points={memorySeries} formatValue={formatBytes} />
          </div>
          <div className="min-w-0 p-4">
            <div className="mb-1 text-[12px] font-semibold">CPU utilization</div>
            <MiniLineChart points={cpuSeries} formatValue={(value) => `${value.toFixed(1)}%`} />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Tracing diagnostics">
        <div className="grid gap-0 divide-y divide-border/60 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <div className="min-w-0">
            <div className="border-border/60 border-b px-4 py-2 text-[12px] font-semibold">
              Top span names
            </div>
            <BarList points={topSpanSeries(snapshot?.tracing.topSpanNames ?? [])} />
          </div>
          <div className="min-w-0">
            <div className="border-border/60 border-b px-4 py-2 text-[12px] font-semibold">
              Duration buckets
            </div>
            <BarList points={durationBucketSeries(snapshot?.tracing.durationBuckets ?? [])} />
          </div>
        </div>
        <div className="border-border/60 border-t">
          <div className="border-border/60 border-b px-4 py-2 text-[12px] font-semibold">
            Slowest spans
          </div>
          <SpanRows spans={snapshot?.tracing.slowestSpans ?? []} />
        </div>
      </SettingsSection>

      <SettingsSection title="Failures">
        <div className="divide-y divide-border/60">
          {(snapshot?.failures.latest ?? []).slice(0, 8).map((failure) => (
            <div
              key={failure.id}
              className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_6rem]"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge size="sm" variant="error">
                    {failure.category}
                  </Badge>
                  <span className="truncate text-[13px] font-medium">{failure.message}</span>
                </div>
                <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                  {failure.source} / {failure.signature}
                </div>
                <div className="mt-2">
                  <RawDetails value={failure.raw ?? failure} />
                </div>
              </div>
              <div className="font-mono text-[11px] text-muted-foreground sm:text-right">
                {relativeTimeLabel(failure.occurredAt, nowMs)}
              </div>
            </div>
          ))}
          {snapshot && snapshot.failures.latest.length === 0 ? (
            <p className="px-4 py-4 text-muted-foreground text-sm">No failures retained.</p>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection title="Live activity">
        <div className="grid gap-0 divide-y divide-border/60 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <div className="min-w-0">
            <div className="border-border/60 border-b px-4 py-2 text-[12px] font-semibold">
              Providers
            </div>
            <div className="divide-y divide-border/60">
              {(snapshot?.liveProcesses.providers ?? []).map((provider) => (
                <div
                  key={provider.instanceId}
                  className="flex min-w-0 items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">
                      {provider.displayName ?? provider.instanceId}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {provider.driver}
                    </div>
                  </div>
                  <Badge
                    size="sm"
                    variant={
                      provider.status === "error"
                        ? "error"
                        : provider.status === "warning"
                          ? "warning"
                          : "outline"
                    }
                  >
                    {provider.status}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
          <div className="min-w-0">
            <div className="border-border/60 border-b px-4 py-2 text-[12px] font-semibold">
              Terminals and slow RPCs
            </div>
            <div className="divide-y divide-border/60">
              {(snapshot?.liveProcesses.terminals ?? []).map((terminal) => (
                <div key={`${terminal.threadId}:${terminal.terminalId}`} className="px-4 py-2.5">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="truncate text-[13px] font-medium">{terminal.terminalId}</span>
                    <Badge size="sm" variant={terminal.status === "error" ? "error" : "outline"}>
                      {terminal.status}
                    </Badge>
                  </div>
                  <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                    pid {terminal.pid ?? "n/a"} / subprocess{" "}
                    {terminal.hasRunningSubprocess ? "yes" : "no"}
                  </div>
                </div>
              ))}
              {slowRpcAcks.map((request) => (
                <div key={request.requestId} className="px-4 py-2.5">
                  <div className="truncate text-[13px] font-medium">{request.tag}</div>
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                    slow ack / {relativeTimeLabel(request.startedAt, nowMs)}
                  </div>
                </div>
              ))}
              {(snapshot?.liveProcesses.terminals.length ?? 0) === 0 && slowRpcAcks.length === 0 ? (
                <p className="px-4 py-4 text-muted-foreground text-sm">
                  No live terminal or slow RPC activity.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
