import { scopeThreadRef } from "@ryco/client-runtime/scoped";
import type {
  Project,
  SidebarThreadSummary,
  SidebarWorktreeSummary,
} from "@ryco/client-runtime/state/threads";
import type { EnvironmentId, ScopedThreadRef } from "@ryco/contracts";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  LoaderCircleIcon,
  SearchIcon,
  ServerIcon,
  Undo2Icon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import { newCommandId } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { Input } from "../ui/input";
import { SidebarContent } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  buildInboxSidebarSections,
  type InboxSidebarEnvironment,
  type InboxSidebarRow,
  type InboxSidebarStatusFilter,
} from "./inboxSidebarModel";

export interface InboxSidebarProps {
  readonly projects: ReadonlyArray<Project>;
  readonly worktrees: ReadonlyArray<SidebarWorktreeSummary>;
  readonly threads: ReadonlyArray<SidebarThreadSummary>;
  readonly environments: ReadonlyArray<InboxSidebarEnvironment>;
  readonly deliveryUnknownThreadKeys: ReadonlySet<string>;
  readonly localQueuedThreadKeys: ReadonlySet<string>;
  readonly activeThreadKey: string | null;
  readonly onOpenThread: (threadRef: ScopedThreadRef) => void;
}

const STATUS_FILTERS: ReadonlyArray<{
  readonly value: InboxSidebarStatusFilter;
  readonly label: string;
}> = [
  { value: "all", label: "All status" },
  { value: "active", label: "Active now" },
  { value: "needs-input", label: "Needs input" },
  { value: "recent", label: "Recent" },
  { value: "settled", label: "Settled" },
];

function statusTone(state: InboxSidebarRow["state"]): string {
  switch (state) {
    case "needs-input":
      return "text-warning-foreground";
    case "delivery-unknown":
    case "error":
      return "text-destructive";
    case "working":
      return "text-success-foreground";
    case "connecting":
    case "reconnecting":
      return "text-info-foreground";
    case "offline":
    case "idle":
      return "text-muted-foreground";
  }
}

function InboxThreadRow(props: {
  readonly row: InboxSidebarRow;
  readonly active: boolean;
  readonly onOpen: () => void;
  readonly onSetSettlement: (row: InboxSidebarRow, settled: boolean) => Promise<boolean>;
}) {
  const [pending, setPending] = useState(false);
  const ProviderIcon = props.row.providerDriver
    ? (PROVIDER_ICON_BY_PROVIDER[props.row.providerDriver] ?? null)
    : null;
  const actionLabel = props.row.settled ? "Move to Active" : "Settle";
  const actionEnabled = props.row.settlementActionEnabled && !pending;
  const actionTitle = actionEnabled
    ? actionLabel
    : (props.row.settlementDisabledReason ?? "Settlement is temporarily unavailable.");
  const timestamp = props.row.settled
    ? (props.row.effectiveSettlementTimestamp ?? props.row.updatedAt)
    : props.row.updatedAt;
  const handleSettlement = async () => {
    if (!actionEnabled) return;
    setPending(true);
    try {
      await props.onSetSettlement(props.row, !props.row.settled);
    } finally {
      setPending(false);
    }
  };
  const navigationButton = (
    <button
      type="button"
      aria-current={props.active ? "page" : undefined}
      className={`group/row relative flex w-full min-w-0 overflow-hidden rounded-lg border border-transparent text-left outline-hidden ring-ring transition-[background-color,border-color,box-shadow,translate,scale] duration-200 ease-out will-change-transform hover:-translate-y-px hover:border-sidebar-border/60 hover:bg-sidebar-accent hover:shadow-sm/5 focus-visible:ring-2 active:translate-y-0 active:scale-[0.995] motion-reduce:translate-none motion-reduce:scale-100 motion-reduce:transition-colors aria-[current=page]:border-sidebar-border/60 aria-[current=page]:bg-sidebar-accent aria-[current=page]:shadow-xs/5 ${props.row.settled ? "items-center gap-2 px-2.5 py-2 pr-18 text-muted-foreground" : "flex-col gap-1 px-2.5 py-2"}`}
      data-testid="inbox-thread-row"
      onClick={props.onOpen}
    >
      <span
        aria-hidden
        className={`absolute inset-y-2 left-0 w-0.5 origin-center rounded-full bg-sidebar-foreground/25 transition-[scale,opacity] duration-200 group-hover/row:scale-y-100 group-hover/row:opacity-100 group-focus-visible/row:scale-y-100 group-focus-visible/row:opacity-100 motion-reduce:transition-none ${props.active ? "scale-y-100 opacity-100" : "scale-y-0 opacity-0"}`}
      />
      {props.row.settled ? (
        <>
          <FolderIcon aria-hidden className="size-3.5 shrink-0 opacity-60" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{props.row.title}</span>
          {ProviderIcon ? <ProviderIcon className="size-3.5 shrink-0 opacity-65" /> : null}
          <span className="shrink-0 tabular-nums text-[10px] opacity-60 transition-opacity group-hover/inbox-row:opacity-0 group-focus-within/inbox-row:opacity-0">
            {formatRelativeTimeLabel(timestamp)}
          </span>
        </>
      ) : (
        <>
          <div className="flex w-full min-w-0 items-center gap-2 text-[10px] leading-4 text-muted-foreground/70">
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <ServerIcon aria-hidden className="size-3 shrink-0 opacity-70" />
              <span className="truncate">
                <span className="font-medium text-sidebar-foreground/75">
                  {props.row.machineLabel}
                </span>
                <span aria-hidden className="px-1 text-muted-foreground/40">
                  ·
                </span>
                <span>{props.row.projectLabel}</span>
              </span>
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground/60 transition-opacity group-hover/inbox-row:opacity-0 group-focus-within/inbox-row:opacity-0">
              {formatRelativeTimeLabel(timestamp)}
            </span>
          </div>
          <div className="flex w-full min-w-0 items-center">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-4.5 text-sidebar-foreground transition-[translate] duration-200 group-hover/row:translate-x-0.5 motion-reduce:translate-none">
              {props.row.title}
            </span>
          </div>
          <div className="flex w-full min-w-0 items-center gap-1.5 text-[10px] leading-4">
            <span
              className={`inline-flex shrink-0 items-center gap-1 font-medium ${statusTone(props.row.state)}`}
            >
              <span aria-hidden className="size-1.5 rounded-full bg-current opacity-80" />
              {props.row.statusLabel}
            </span>
            <span aria-hidden className="h-3 w-px shrink-0 bg-sidebar-border/60" />
            <span className="flex min-w-0 flex-1 items-center gap-1 text-muted-foreground/70">
              <GitBranchIcon aria-hidden className="size-3 shrink-0 opacity-70" />
              <span className="truncate">{props.row.workspaceLabel}</span>
            </span>
            {props.row.trustLabel ? (
              <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
                {props.row.trustLabel}
              </span>
            ) : null}
            {props.row.roleLabel ? (
              <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
                {props.row.roleLabel}
              </span>
            ) : null}
            <span
              aria-label={
                props.row.providerLabel ? `${props.row.providerLabel} provider` : "Provider"
              }
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-[color,scale] duration-200 group-hover/row:scale-110 group-hover/row:text-sidebar-foreground/85 motion-reduce:scale-100"
              title={props.row.providerLabel ?? "Provider"}
            >
              {ProviderIcon ? (
                <ProviderIcon className="size-3.5" />
              ) : (
                <span className="size-1.5 rounded-full bg-current" />
              )}
            </span>
          </div>
        </>
      )}
    </button>
  );

  return (
    <div className="group/inbox-row relative">
      <Tooltip>
        <TooltipTrigger closeDelay={80} delay={140} render={navigationButton} />
        <TooltipPopup align="start" className="w-80 p-2.5" side="right" sideOffset={8}>
          <div className="space-y-2 text-left">
            <p className="whitespace-normal text-sm font-semibold leading-5 text-popover-foreground">
              {props.row.title}
            </p>
            <div className="space-y-1.5 text-[11px] leading-4 text-muted-foreground">
              <div className="flex items-center gap-2">
                <FolderIcon aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{props.row.projectLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                <ServerIcon aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{props.row.machineLabel}</span>
              </div>
              {props.row.branchLabel ? (
                <div className="flex items-center gap-2">
                  <GitBranchIcon aria-hidden className="size-3.5 shrink-0" />
                  <span className="truncate">{props.row.branchLabel}</span>
                </div>
              ) : null}
              {props.row.providerLabel ? (
                <div className="flex items-center gap-2">
                  {ProviderIcon ? (
                    <ProviderIcon className="size-3.5 shrink-0" />
                  ) : (
                    <span aria-hidden className="size-2 rounded-full bg-current" />
                  )}
                  <span className="truncate">
                    {props.row.modelLabel
                      ? `${props.row.providerLabel} · ${props.row.modelLabel}`
                      : props.row.providerLabel}
                  </span>
                </div>
              ) : null}
              {props.row.changeRequestLabel ? (
                <div className="flex items-center gap-2">
                  <GitPullRequestIcon aria-hidden className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {props.row.changeRequestStateLabel
                      ? `${props.row.changeRequestLabel} · ${props.row.changeRequestStateLabel}`
                      : props.row.changeRequestLabel}
                  </span>
                </div>
              ) : null}
              {props.row.statusLabel !== "Idle" ? (
                <div className={`flex items-center gap-2 ${statusTone(props.row.state)}`}>
                  <span aria-hidden className="size-1.5 rounded-full bg-current" />
                  <span>{props.row.statusLabel}</span>
                </div>
              ) : null}
            </div>
          </div>
        </TooltipPopup>
      </Tooltip>
      <button
        aria-disabled={!actionEnabled}
        aria-label={`${actionLabel} ${props.row.title}`}
        className="absolute right-2 top-1.5 z-10 inline-flex h-6 items-center gap-1 rounded-md bg-sidebar-accent/95 px-1.5 text-[10px] font-medium text-sidebar-foreground opacity-0 shadow-xs transition-[opacity,translate] duration-150 translate-x-1 group-hover/inbox-row:translate-x-0 group-hover/inbox-row:opacity-100 group-focus-within/inbox-row:translate-x-0 group-focus-within/inbox-row:opacity-100 focus-visible:translate-x-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:text-muted-foreground motion-reduce:translate-x-0 motion-reduce:transition-opacity"
        onClick={() => void handleSettlement()}
        title={actionTitle}
        type="button"
      >
        {pending ? (
          <LoaderCircleIcon aria-hidden className="size-3 animate-spin" />
        ) : props.row.settled ? (
          <Undo2Icon aria-hidden className="size-3" />
        ) : (
          <CheckIcon aria-hidden className="size-3" />
        )}
        <span>{actionLabel}</span>
      </button>
    </div>
  );
}

export function InboxSidebar(props: InboxSidebarProps) {
  const [query, setQuery] = useState("");
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(null);
  const [status, setStatus] = useState<InboxSidebarStatusFilter>("all");
  const [settledOpen, setSettledOpen] = useState(false);
  const setThreadSettlement = useCallback(
    async (row: InboxSidebarRow, settled: boolean): Promise<boolean> => {
      const api = readEnvironmentApi(row.environmentId);
      if (!api) {
        toastManager.add({
          type: "error",
          title: "Could not update thread",
          description: "The owning machine is not connected.",
        });
        return false;
      }
      try {
        await api.orchestration.dispatchCommand(
          settled
            ? {
                type: "thread.settle",
                commandId: newCommandId(),
                threadId: row.threadId,
              }
            : {
                type: "thread.unsettle",
                commandId: newCommandId(),
                threadId: row.threadId,
                reason: "user",
              },
        );
        return true;
      } catch (error) {
        toastManager.add({
          type: "error",
          title: settled ? "Could not settle thread" : "Could not move thread to Active",
          description: error instanceof Error ? error.message : "The request failed.",
        });
        return false;
      }
    },
    [],
  );
  const sections = useMemo(
    () =>
      buildInboxSidebarSections({
        projects: props.projects,
        worktrees: props.worktrees,
        threads: props.threads,
        environments: props.environments,
        filters: { query, environmentId, status },
        deliveryUnknownThreadKeys: props.deliveryUnknownThreadKeys,
        localQueuedThreadKeys: props.localQueuedThreadKeys,
        activeThreadKey: props.activeThreadKey,
      }),
    [
      environmentId,
      props.activeThreadKey,
      props.deliveryUnknownThreadKeys,
      props.environments,
      props.localQueuedThreadKeys,
      props.projects,
      props.threads,
      props.worktrees,
      query,
      status,
    ],
  );
  const hasFilters = query.trim().length > 0 || environmentId !== null || status !== "all";

  return (
    <SidebarContent className="gap-0 px-2 pb-2" data-testid="inbox-sidebar">
      <div className="sticky top-0 z-10 space-y-1.5 bg-sidebar px-0.5 pb-2 pt-1">
        <label className="relative block">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            aria-label="Search inbox"
            className="bg-sidebar shadow-none [&_[data-slot=input]]:pl-8"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks"
            size="sm"
            type="search"
            value={query}
          />
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          <select
            aria-label="Filter Inbox by machine"
            className="h-7 min-w-0 rounded-md border border-input bg-sidebar px-2 text-[11px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(event) =>
              setEnvironmentId(event.target.value ? (event.target.value as EnvironmentId) : null)
            }
            value={environmentId ?? ""}
          >
            <option value="">All machines</option>
            {props.environments.map((environment) => (
              <option key={environment.environmentId} value={environment.environmentId}>
                {environment.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter Inbox by status"
            className="h-7 min-w-0 rounded-md border border-input bg-sidebar px-2 text-[11px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(event) => setStatus(event.target.value as InboxSidebarStatusFilter)}
            value={status}
          >
            {STATUS_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {sections.length === 0 ? (
        <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="text-xs font-medium text-sidebar-foreground">
            {hasFilters ? "No matching tasks" : "No tasks yet"}
          </p>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {hasFilters
              ? "Try a different search or clear a filter."
              : "Open a project and start a task to see it here."}
          </p>
        </div>
      ) : (
        sections.map((section) => {
          const collapsible = section.key === "settled";
          const expanded = !collapsible || settledOpen || status === "settled";
          return (
            <section
              key={section.key}
              aria-labelledby={`inbox-section-${section.key}`}
              className="pb-2"
            >
              {collapsible ? (
                <button
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setSettledOpen((open) => !open)}
                  type="button"
                >
                  {expanded ? (
                    <ChevronDownIcon aria-hidden className="size-3 text-muted-foreground/55" />
                  ) : (
                    <ChevronRightIcon aria-hidden className="size-3 text-muted-foreground/55" />
                  )}
                  <h2
                    id={`inbox-section-${section.key}`}
                    className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/65"
                  >
                    {section.title}
                  </h2>
                  <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/45">
                    {section.rows.length}
                  </span>
                </button>
              ) : (
                <div className="flex items-center gap-2 px-2.5 py-1.5">
                  <h2
                    id={`inbox-section-${section.key}`}
                    className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/65"
                  >
                    {section.title}
                  </h2>
                  <span className="text-[10px] tabular-nums text-muted-foreground/45">
                    {section.rows.length}
                  </span>
                </div>
              )}
              {expanded ? (
                <div className="space-y-0.5">
                  {section.rows.map((row) => (
                    <InboxThreadRow
                      key={row.key}
                      active={props.activeThreadKey === row.key}
                      onOpen={() =>
                        props.onOpenThread(scopeThreadRef(row.environmentId, row.threadId))
                      }
                      onSetSettlement={setThreadSettlement}
                      row={row}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          );
        })
      )}
    </SidebarContent>
  );
}
