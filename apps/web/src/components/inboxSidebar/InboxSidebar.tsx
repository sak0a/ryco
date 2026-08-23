import { scopeThreadRef } from "@ryco/client-runtime/scoped";
import type {
  Project,
  SidebarThreadSummary,
  SidebarWorktreeSummary,
} from "@ryco/client-runtime/state/threads";
import type { EnvironmentId, ScopedThreadRef } from "@ryco/contracts";
import { SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { Input } from "../ui/input";
import { SidebarContent } from "../ui/sidebar";
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
];

function statusTone(state: InboxSidebarRow["state"]): string {
  switch (state) {
    case "needs-input":
      return "bg-warning/12 text-warning-foreground";
    case "delivery-unknown":
    case "error":
      return "bg-destructive/10 text-destructive";
    case "working":
      return "bg-success/10 text-success-foreground";
    case "connecting":
    case "reconnecting":
      return "bg-info/10 text-info-foreground";
    case "offline":
    case "idle":
      return "bg-muted text-muted-foreground";
  }
}

function InboxThreadRow(props: {
  readonly row: InboxSidebarRow;
  readonly active: boolean;
  readonly onOpen: () => void;
}) {
  const ProviderIcon = props.row.providerDriver
    ? (PROVIDER_ICON_BY_PROVIDER[props.row.providerDriver] ?? null)
    : null;
  return (
    <button
      type="button"
      aria-current={props.active ? "page" : undefined}
      className="group relative flex w-full min-w-0 flex-col gap-1 rounded-lg px-2.5 py-2 text-left outline-hidden ring-ring transition-colors hover:bg-sidebar-accent focus-visible:ring-2 aria-[current=page]:bg-sidebar-accent"
      onClick={props.onOpen}
    >
      <div className="flex w-full min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-sidebar-foreground">
          {props.row.title}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/65">
          {formatRelativeTimeLabel(props.row.updatedAt)}
        </span>
      </div>
      <div className="flex w-full min-w-0 items-end gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] text-muted-foreground/75">{props.row.contextLabel}</p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
            <span
              className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${statusTone(props.row.state)}`}
            >
              {props.row.statusLabel}
            </span>
            {props.row.trustLabel ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                {props.row.trustLabel}
              </span>
            ) : null}
            {props.row.roleLabel ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                {props.row.roleLabel}
              </span>
            ) : null}
          </div>
        </div>
        <span
          aria-label={props.row.providerLabel ? `${props.row.providerLabel} provider` : "Provider"}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70"
          title={props.row.providerLabel ?? "Provider"}
        >
          {ProviderIcon ? (
            <ProviderIcon className="size-3.5" />
          ) : (
            <span className="size-1.5 rounded-full bg-current" />
          )}
        </span>
      </div>
    </button>
  );
}

export function InboxSidebar(props: InboxSidebarProps) {
  const [query, setQuery] = useState("");
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(null);
  const [status, setStatus] = useState<InboxSidebarStatusFilter>("all");
  const sections = useMemo(
    () =>
      buildInboxSidebarSections({
        projects: props.projects,
        worktrees: props.worktrees,
        threads: props.threads,
        environments: props.environments,
        filters: { query, environmentId, status },
        deliveryUnknownThreadKeys: props.deliveryUnknownThreadKeys,
      }),
    [
      environmentId,
      props.deliveryUnknownThreadKeys,
      props.environments,
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
        sections.map((section) => (
          <section
            key={section.key}
            aria-labelledby={`inbox-section-${section.key}`}
            className="pb-2"
          >
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
            <div className="space-y-0.5">
              {section.rows.map((row) => (
                <InboxThreadRow
                  key={row.key}
                  active={props.activeThreadKey === row.key}
                  onOpen={() => props.onOpenThread(scopeThreadRef(row.environmentId, row.threadId))}
                  row={row}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </SidebarContent>
  );
}
