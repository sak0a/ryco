import {
  applyPullRequestSnapshot,
  markPullRequestEnvironmentStale,
  selectFederatedPullRequests,
  usePullRequestStore,
} from "@ryco/client-runtime/state/pullRequests";
import type {
  EnvironmentId,
  PullRequestAssociationSubject,
  PullRequestDetailResult,
  PullRequestInboxItem,
  PullRequestRepositoryCoverage,
  SourceControlProviderKind,
} from "@ryco/contracts";
import { useNavigate } from "@tanstack/react-router";
import { DateTime, Option } from "effect";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleDashedIcon,
  ExternalLinkIcon,
  FilterIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  Link2Icon,
  Maximize2Icon,
  Minimize2Icon,
  RefreshCwIcon,
  SearchIcon,
  UserRoundIcon,
  XCircleIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as React from "react";

import { readEnvironmentConnection } from "~/environments/runtime";
import { usePresentationTier } from "~/hooks/usePresentationTier";
import { cn } from "~/lib/utils";
import type { PullRequestRouteSearch, PullRequestView } from "~/pullRequestRouteSearch";
import { useStore } from "~/store";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { changeRequestStateKind, StateBadge } from "../projectExplorer/StateBadge";
import { filterPullRequestInbox } from "./pullRequestInboxViewModel";
import {
  PullRequestManagementDetail,
  type PullRequestManagementTab,
  type RelatedRycoWorkCandidate,
} from "./PullRequestManagementDetail";

const PRIMARY_VIEWS: ReadonlyArray<{ id: PullRequestView; label: string }> = [
  { id: "latest", label: "Latest" },
  { id: "review", label: "Requires my review" },
  { id: "assigned", label: "Assigned to me" },
  { id: "authored", label: "Authored by me" },
];

const MORE_VIEWS: ReadonlyArray<{ id: PullRequestView; label: string }> = [
  { id: "changes-requested", label: "Changes requested" },
  { id: "failing", label: "Failing checks" },
  { id: "drafts", label: "Drafts" },
  { id: "merged", label: "Merged" },
  { id: "closed", label: "Closed" },
];

const dateTimeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function relativeDate(value: DateTime.Utc): string {
  const deltaMinutes = Math.round((DateTime.toEpochMillis(value) - Date.now()) / 60_000);
  if (Math.abs(deltaMinutes) < 60) return dateTimeFormat.format(deltaMinutes, "minute");
  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 24) return dateTimeFormat.format(deltaHours, "hour");
  const deltaDays = Math.round(deltaHours / 24);
  if (Math.abs(deltaDays) < 30) return dateTimeFormat.format(deltaDays, "day");
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    DateTime.toDate(value),
  );
}

function itemUpdatedAt(item: PullRequestInboxItem): DateTime.Utc {
  return Option.getOrElse(
    item.pullRequest.freshness.providerUpdatedAt,
    () => item.pullRequest.freshness.observedAt,
  );
}

function environmentIdsFromState(input: {
  readonly activeEnvironmentId: EnvironmentId | null;
  readonly environmentStateById: Readonly<Record<string, unknown>>;
}): ReadonlyArray<EnvironmentId> {
  const ids = new Set<EnvironmentId>(Object.keys(input.environmentStateById) as EnvironmentId[]);
  if (input.activeEnvironmentId) ids.add(input.activeEnvironmentId);
  return [...ids];
}

export interface PullRequestsPageProps {
  readonly search: PullRequestRouteSearch;
}

export function PullRequestsPage({ search }: PullRequestsPageProps) {
  const navigate = useNavigate({ from: "/pull-requests" });
  const presentationTier = usePresentationTier();
  const activeEnvironmentId = useStore((state) => state.activeEnvironmentId);
  const environmentStateById = useStore((state) => state.environmentStateById);
  const pullRequestEnvironments = usePullRequestStore((state) => state.environmentById);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<ReadonlyArray<string>>([]);
  const [detail, setDetail] = useState<PullRequestDetailResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRefreshTick, setDetailRefreshTick] = useState(0);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const environmentIds = useMemo(
    () => environmentIdsFromState({ activeEnvironmentId, environmentStateById }),
    [activeEnvironmentId, environmentStateById],
  );
  const allItems = useMemo(
    () => selectFederatedPullRequests({ environmentById: pullRequestEnvironments }),
    [pullRequestEnvironments],
  );
  const relatedLabelBySubject = useMemo(() => {
    const labels = new Map<string, string>();
    for (const environment of Object.values(environmentStateById)) {
      for (const threadId of environment.threadIds) {
        const thread = environment.threadShellById[threadId];
        if (thread) labels.set(`thread:${thread.id}`, `${thread.title} ${thread.branch ?? ""}`);
      }
      for (const worktreeId of environment.worktreeIds ?? []) {
        const worktree = environment.worktreeById?.[worktreeId];
        if (worktree) {
          labels.set(`worktree:${worktree.id}`, `${worktree.title ?? ""} ${worktree.branch}`);
        }
      }
    }
    return labels;
  }, [environmentStateById]);
  const filteredItems = useMemo(
    () => filterPullRequestInbox(allItems, search, relatedLabelBySubject),
    [allItems, relatedLabelBySubject, search],
  );
  const selectedItem = useMemo(
    () => allItems.find((item) => item.pullRequest.identity.id === search.pr) ?? null,
    [allItems, search.pr],
  );
  const selectedPullRequestId = selectedItem?.pullRequest.identity.id;
  const selectedEnvironmentId = selectedItem?.pullRequest.identity.environmentId;
  const selectedPullRequestState = selectedItem?.pullRequest.state;
  const relatedWorkCandidates = useMemo(() => {
    if (!selectedItem) return [];
    const environmentId = selectedItem.pullRequest.identity.environmentId;
    const environment = environmentStateById[environmentId];
    if (!environment) return [];
    const threads = environment.threadIds.flatMap((threadId) => {
      const thread = environment.threadShellById[threadId];
      return thread && thread.archivedAt === null
        ? [
            {
              key: `thread:${thread.id}`,
              subject: { kind: "thread" as const, threadId: thread.id },
              label: thread.title,
              description: thread.branch ?? "Thread",
              threadId: thread.id,
            },
          ]
        : [];
    });
    const worktrees = (environment.worktreeIds ?? []).flatMap((worktreeId) => {
      const worktree = environment.worktreeById?.[worktreeId];
      if (!worktree || worktree.archivedAt !== null) return [];
      const linkedThread = threads.find((candidate) => {
        const thread = environment.threadShellById[candidate.threadId];
        return thread?.worktreeId === worktree.id;
      });
      return [
        {
          key: `worktree:${worktree.id}`,
          subject: { kind: "worktree" as const, worktreeId: worktree.id },
          label: worktree.title ?? worktree.branch,
          description: worktree.branch,
          ...(linkedThread ? { threadId: linkedThread.threadId } : {}),
        },
      ];
    });
    return [...threads, ...worktrees];
  }, [environmentStateById, selectedItem]);
  const providers = useMemo(
    () => [...new Set(allItems.map((item) => item.pullRequest.identity.provider))].toSorted(),
    [allItems],
  );
  const repositories = useMemo(
    () =>
      [
        ...new Map(
          allItems.map((item) => [
            item.pullRequest.repository.canonicalKey,
            item.pullRequest.repository,
          ]),
        ).values(),
      ].toSorted((left, right) => left.displayName.localeCompare(right.displayName)),
    [allItems],
  );
  const coverage = useMemo(
    () => Object.values(pullRequestEnvironments).flatMap((environment) => environment.coverage),
    [pullRequestEnvironments],
  );
  const unreadCount = allItems.filter((item) => item.viewState.isUnread).length;

  const updateSearch = useCallback(
    (patch: Partial<PullRequestRouteSearch>, replace = true) => {
      void navigate({
        search: (current) => ({ ...current, ...patch }),
        replace,
      });
    },
    [navigate],
  );

  const applyEnvironmentSnapshot = useCallback(
    async (environmentId: EnvironmentId, refresh: boolean) => {
      const connection = readEnvironmentConnection(environmentId);
      if (!connection) {
        markPullRequestEnvironmentStale(environmentId);
        throw new Error("Environment is not connected.");
      }
      const snapshot = refresh
        ? await connection.client.pullRequests.refresh({})
        : await connection.client.pullRequests.listInbox({});
      applyPullRequestSnapshot(environmentId, snapshot);
    },
    [],
  );

  const loadAll = useCallback(
    (refresh: boolean) => {
      if (refresh && refreshInFlightRef.current) return refreshInFlightRef.current;
      const run = (async () => {
        if (refresh) setRefreshing(true);
        const failures: string[] = [];
        await Promise.all(
          environmentIds.map(async (environmentId) => {
            try {
              await applyEnvironmentSnapshot(environmentId, refresh);
            } catch (error) {
              failures.push(
                `${environmentId}: ${error instanceof Error ? error.message : "Pull request sync failed."}`,
              );
            }
          }),
        );
        setErrors(failures);
        setLoading(false);
        setRefreshing(false);
      })();
      if (refresh) {
        refreshInFlightRef.current = run;
        void run.finally(() => {
          if (refreshInFlightRef.current === run) refreshInFlightRef.current = null;
        });
      }
      return run;
    },
    [applyEnvironmentSnapshot, environmentIds],
  );

  useEffect(() => {
    let active = true;
    void loadAll(false).then(() => {
      if (active) void loadAll(true);
    });
    return () => {
      active = false;
    };
  }, [loadAll]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadAll(true);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [loadAll]);

  useEffect(() => {
    if (!selectedPullRequestId || selectedPullRequestState !== "open") return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") setDetailRefreshTick((tick) => tick + 1);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [selectedPullRequestId, selectedPullRequestState]);

  useEffect(() => {
    if (filteredItems.length === 0) {
      if (search.pr) updateSearch({ pr: undefined }, true);
      return;
    }
    const selectedIsVisible = filteredItems.some(
      (item) => item.pullRequest.identity.id === search.pr,
    );
    if (!selectedIsVisible) {
      updateSearch({ pr: filteredItems[0]!.pullRequest.identity.id }, true);
    }
  }, [filteredItems, search.pr, updateSearch]);

  useEffect(() => {
    if (!selectedPullRequestId || !selectedEnvironmentId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    const connection = readEnvironmentConnection(selectedEnvironmentId);
    if (!connection) {
      setDetail(null);
      setDetailError("This environment is currently disconnected.");
      return;
    }
    let active = true;
    setDetailLoading(true);
    setDetailError(null);
    void connection.client.pullRequests
      .getDetail({ pullRequestId: selectedPullRequestId })
      .then(async (result) => {
        if (!active) return;
        setDetail(result);
        const snapshot = await connection.client.pullRequests.listInbox({});
        if (active) applyPullRequestSnapshot(selectedEnvironmentId, snapshot);
      })
      .catch((error: unknown) => {
        if (active) {
          setDetail(null);
          setDetailError(error instanceof Error ? error.message : "Pull request detail failed.");
        }
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [detailRefreshTick, selectedEnvironmentId, selectedPullRequestId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, select, [contenteditable=true]") ?? false;
      if (event.key === "/" && !editing) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.key === "Escape") {
        listRef.current?.focus();
        return;
      }
      if (editing || filteredItems.length === 0) return;
      const currentIndex = filteredItems.findIndex(
        (item) => item.pullRequest.identity.id === search.pr,
      );
      const direction =
        event.key === "ArrowDown" || event.key.toLowerCase() === "j"
          ? 1
          : event.key === "ArrowUp" || event.key.toLowerCase() === "k"
            ? -1
            : 0;
      if (direction !== 0) {
        event.preventDefault();
        const nextIndex = Math.max(
          0,
          Math.min(filteredItems.length - 1, (currentIndex < 0 ? 0 : currentIndex) + direction),
        );
        updateSearch({ pr: filteredItems[nextIndex]!.pullRequest.identity.id }, true);
      } else if (event.key === "Enter" && selectedItem) {
        event.preventDefault();
        detailRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filteredItems, search.pr, selectedItem, updateSearch]);

  const markUnread = useCallback(async () => {
    if (!selectedItem) return;
    const connection = readEnvironmentConnection(selectedItem.pullRequest.identity.environmentId);
    if (!connection) return;
    await connection.client.pullRequests.markUnread({
      pullRequestId: selectedItem.pullRequest.identity.id,
    });
    const snapshot = await connection.client.pullRequests.listInbox({});
    applyPullRequestSnapshot(selectedItem.pullRequest.identity.environmentId, snapshot);
  }, [selectedItem]);

  const updateExplicitRelationship = useCallback(
    async (subject: PullRequestAssociationSubject, remove: boolean) => {
      if (!selectedItem) return;
      const environmentId = selectedItem.pullRequest.identity.environmentId;
      const connection = readEnvironmentConnection(environmentId);
      if (!connection) throw new Error("This environment is currently disconnected.");
      const input = {
        pullRequestId: selectedItem.pullRequest.identity.id,
        subject,
        relationship: "explicitly-attached" as const,
      };
      const snapshot = remove
        ? await connection.client.pullRequests.removeExplicitRelationship(input)
        : await connection.client.pullRequests.attachRelationship(input);
      applyPullRequestSnapshot(environmentId, snapshot);
    },
    [selectedItem],
  );

  const openRelatedThread = useCallback(
    (threadId: string) => {
      if (!selectedItem) return;
      void navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: selectedItem.pullRequest.identity.environmentId,
          threadId,
        },
      });
    },
    [navigate, selectedItem],
  );

  if (presentationTier === "phone") {
    return (
      <div className="flex size-full items-center justify-center p-8 text-center">
        <div className="max-w-sm">
          <GitPullRequestIcon className="mx-auto size-7 text-muted-foreground" />
          <h1 className="mt-4 font-heading font-semibold text-lg">Pull Requests</h1>
          <p className="mt-2 text-muted-foreground text-sm">
            This workspace is available in Ryco desktop and web on larger screens.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pull-request-page-material flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <PullRequestHeader
        search={search}
        unreadCount={unreadCount}
        itemCount={allItems.length}
        repositoryCount={repositories.length}
        refreshing={refreshing}
        searchInputRef={searchInputRef}
        onSearchChange={(q) => updateSearch({ q }, true)}
        onRefresh={() => void loadAll(true)}
      />
      <PullRequestViewBar
        search={search}
        items={allItems}
        providers={providers}
        repositories={repositories}
        onChange={updateSearch}
      />
      {errors.length > 0 ? (
        <div className="mx-3 mt-2 flex shrink-0 items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/7 px-3 py-2 text-amber-800 text-xs dark:text-amber-300">
          <AlertCircleIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            Some environments could not refresh. Persisted results remain available.
          </span>
        </div>
      ) : null}
      <div
        ref={workspaceRef}
        className={cn(
          "relative grid min-h-0 flex-1 gap-2 p-2.5 pt-2",
          search.focus && "grid-cols-1",
        )}
        style={
          search.focus
            ? undefined
            : ({
                "--pr-list-width": `${search.listWidth}px`,
                gridTemplateColumns: "var(--pr-list-width) minmax(0,1fr)",
              } as React.CSSProperties)
        }
      >
        {!search.focus ? (
          <PullRequestListPane
            ref={listRef}
            loading={loading}
            items={filteredItems}
            selectedId={search.pr}
            viewerUnsupported={
              search.view === "review" || search.view === "assigned" || search.view === "authored"
            }
            onSelect={(pr) => updateSearch({ pr }, false)}
          />
        ) : null}
        {!search.focus ? (
          <PaneResizeHandle
            workspaceRef={workspaceRef}
            initialWidth={search.listWidth}
            onCommit={(listWidth) => updateSearch({ listWidth }, true)}
          />
        ) : null}
        <PullRequestDetailPane
          ref={detailRef}
          selectedItem={selectedItem}
          detail={detail}
          loading={detailLoading}
          error={detailError}
          focus={search.focus}
          activeTab={search.tab}
          onActiveTabChange={(tab) => updateSearch({ tab }, true)}
          onToggleFocus={() => updateSearch({ focus: !search.focus }, false)}
          onMarkUnread={() => void markUnread()}
          onBack={() => updateSearch({ focus: false }, false)}
          relatedWorkCandidates={relatedWorkCandidates}
          onAttachRelationship={(subject) => updateExplicitRelationship(subject, false)}
          onRemoveRelationship={(subject) => updateExplicitRelationship(subject, true)}
          onOpenThread={openRelatedThread}
          onRefreshDetail={() => setDetailRefreshTick((tick) => tick + 1)}
        />
      </div>
      <CoverageFooter coverage={coverage} />
    </div>
  );
}

function PullRequestHeader(props: {
  readonly search: PullRequestRouteSearch;
  readonly unreadCount: number;
  readonly itemCount: number;
  readonly repositoryCount: number;
  readonly refreshing: boolean;
  readonly searchInputRef: React.RefObject<HTMLInputElement | null>;
  readonly onSearchChange: (value: string) => void;
  readonly onRefresh: () => void;
}) {
  return (
    <header className="app-glass-surface app-glass-surface-sheet project-glass-surface relative z-[1] flex h-16 shrink-0 items-center gap-4 border-border/60 border-b px-5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-foreground/[0.045] shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]">
          <GitPullRequestIcon className="size-4.5 text-foreground/75" />
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h1 className="truncate font-heading font-semibold text-base tracking-[-0.015em]">
              Pull Requests
            </h1>
            {props.unreadCount > 0 ? (
              <span className="font-mono text-[10px] text-foreground/48 tabular-nums">
                {props.unreadCount} unread
              </span>
            ) : null}
          </div>
          <p className="truncate text-[10px] text-muted-foreground/70">
            {props.itemCount} across {props.repositoryCount} repositories
          </p>
        </div>
      </div>
      <label className="relative ml-auto w-full max-w-xl">
        <span className="sr-only">Search pull requests</span>
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 z-[1] size-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          ref={props.searchInputRef}
          nativeInput
          type="search"
          value={props.search.q}
          onChange={(event) => props.onSearchChange(event.currentTarget.value)}
          placeholder="Search title, number, repository, branch, author, thread, or worktree"
          className="h-8 rounded-xl border-border/55 bg-background/42 pl-7.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] backdrop-blur-xl"
        />
        <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border/50 bg-background/35 px-1.5 font-mono text-[9px] text-muted-foreground/55">
          /
        </kbd>
      </label>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Refresh pull requests"
        disabled={props.refreshing}
        onClick={props.onRefresh}
      >
        <RefreshCwIcon className={cn("size-3.5", props.refreshing && "animate-spin")} />
      </Button>
    </header>
  );
}

function PullRequestViewBar(props: {
  readonly search: PullRequestRouteSearch;
  readonly items: ReadonlyArray<PullRequestInboxItem>;
  readonly providers: ReadonlyArray<SourceControlProviderKind>;
  readonly repositories: ReadonlyArray<PullRequestInboxItem["pullRequest"]["repository"]>;
  readonly onChange: (patch: Partial<PullRequestRouteSearch>, replace?: boolean) => void;
}) {
  const moreActive = MORE_VIEWS.some((view) => view.id === props.search.view);
  const viewerIdentitySupported = props.items.some(
    (item) => item.pullRequest.capabilities.viewerIdentity && item.pullRequest.viewer !== undefined,
  );
  const activeFilterCount = [
    props.search.provider,
    props.search.repository,
    props.search.state,
    props.search.check,
    props.search.author,
    props.search.reviewer,
  ].filter(Boolean).length;
  return (
    <div className="flex min-h-11 shrink-0 items-center gap-1.5 border-border/45 border-b bg-background/24 px-3 backdrop-blur-md">
      <div
        role="tablist"
        aria-label="Pull request inbox views"
        className="flex min-w-0 items-center gap-0.5"
      >
        {PRIMARY_VIEWS.filter((view) => view.id === "latest" || viewerIdentitySupported).map(
          (view) => {
            const active = props.search.view === view.id;
            const count = filterPullRequestInbox(props.items, {
              ...props.search,
              view: view.id,
            }).length;
            return (
              <button
                key={view.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => props.onChange({ view: view.id }, false)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs outline-none transition-[background-color,color,transform] focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px",
                  active
                    ? "bg-foreground/[0.075] font-medium text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]"
                    : "text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground",
                )}
              >
                {view.label}
                {count > 0 ? (
                  <span className="ml-1 font-mono text-[9px] opacity-45">{count}</span>
                ) : null}
              </button>
            );
          },
        )}
        <Select
          value={moreActive ? props.search.view : "more"}
          onValueChange={(value) => {
            if (value && value !== "more")
              props.onChange({ view: value as PullRequestView }, false);
          }}
        >
          <SelectTrigger
            size="xs"
            variant="ghost"
            className={cn(
              "ml-0.5 min-w-0 rounded-lg",
              moreActive && "bg-foreground/[0.075] text-foreground",
            )}
            aria-label="More pull request views"
          >
            <SelectValue>
              {moreActive
                ? MORE_VIEWS.find((view) => view.id === props.search.view)?.label
                : "More"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="start" alignItemWithTrigger={false}>
            {MORE_VIEWS.map((view) => (
              <SelectItem key={view.id} value={view.id}>
                {view.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <div className="ml-auto">
        <Popover>
          <PopoverTrigger
            render={
              <Button
                size="xs"
                variant="ghost"
                className={cn(activeFilterCount > 0 && "bg-foreground/[0.065]")}
              >
                <FilterIcon className="size-3" />
                Filters
                {activeFilterCount > 0 ? (
                  <span className="font-mono text-[9px] opacity-60">{activeFilterCount}</span>
                ) : null}
                <ChevronDownIcon className="size-3 opacity-45" />
              </Button>
            }
          />
          <PopoverPopup surface="glass" align="end" className="w-[330px]" viewportClassName="p-3">
            <div className="grid grid-cols-2 gap-3">
              <InboxSelect
                label="Provider"
                value={props.search.provider ?? "all"}
                onChange={(provider) =>
                  props.onChange({ provider: provider === "all" ? undefined : provider }, true)
                }
                items={[
                  { value: "all", label: "All providers" },
                  ...props.providers.map((provider) => ({ value: provider, label: provider })),
                ]}
              />
              <InboxSelect
                label="State"
                value={props.search.state ?? "all"}
                onChange={(state) =>
                  props.onChange(
                    {
                      state:
                        state === "all" ? undefined : (state as PullRequestRouteSearch["state"]),
                    },
                    true,
                  )
                }
                items={[
                  { value: "all", label: "All states" },
                  { value: "open", label: "Open" },
                  { value: "merged", label: "Merged" },
                  { value: "closed", label: "Closed" },
                ]}
              />
              <div className="col-span-2">
                <InboxSelect
                  label="Repository"
                  value={props.search.repository ?? "all"}
                  onChange={(repository) =>
                    props.onChange(
                      { repository: repository === "all" ? undefined : repository },
                      true,
                    )
                  }
                  items={[
                    { value: "all", label: "All repositories" },
                    ...props.repositories.map((repository) => ({
                      value: repository.canonicalKey,
                      label: repository.displayName,
                    })),
                  ]}
                />
              </div>
              <InboxSelect
                label="Checks"
                value={props.search.check ?? "all"}
                onChange={(check) =>
                  props.onChange(
                    {
                      check:
                        check === "all" ? undefined : (check as PullRequestRouteSearch["check"]),
                    },
                    true,
                  )
                }
                items={[
                  { value: "all", label: "Any check status" },
                  { value: "passing", label: "Passing" },
                  { value: "failing", label: "Failing" },
                  { value: "pending", label: "Pending" },
                  { value: "unknown", label: "Unknown" },
                ]}
              />
              <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
                Author
                <Input
                  nativeInput
                  size="sm"
                  value={props.search.author ?? ""}
                  onChange={(event) =>
                    props.onChange({ author: event.currentTarget.value || undefined }, true)
                  }
                  placeholder="Login or name"
                />
              </label>
              <label className="col-span-2 grid gap-1 text-[10px] font-medium text-muted-foreground">
                Reviewer
                <Input
                  nativeInput
                  size="sm"
                  value={props.search.reviewer ?? ""}
                  onChange={(event) =>
                    props.onChange({ reviewer: event.currentTarget.value || undefined }, true)
                  }
                  placeholder="Login or name"
                />
              </label>
              {activeFilterCount > 0 ? (
                <Button
                  size="xs"
                  variant="ghost"
                  className="col-span-2 justify-self-end"
                  onClick={() =>
                    props.onChange(
                      {
                        provider: undefined,
                        repository: undefined,
                        state: undefined,
                        check: undefined,
                        author: undefined,
                        reviewer: undefined,
                      },
                      true,
                    )
                  }
                >
                  Clear filters
                </Button>
              ) : null}
            </div>
          </PopoverPopup>
        </Popover>
      </div>
    </div>
  );
}

function InboxSelect(props: {
  readonly label: string;
  readonly value: string;
  readonly items: ReadonlyArray<{ value: string; label: string }>;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
      {props.label}
      <Select value={props.value} onValueChange={(value) => value && props.onChange(value)}>
        <SelectTrigger size="sm" className="min-w-0 bg-background/48">
          <SelectValue>{props.items.find((item) => item.value === props.value)?.label}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="start" alignItemWithTrigger={false}>
          {props.items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </label>
  );
}

const PullRequestListPane = React.forwardRef<
  HTMLDivElement,
  {
    readonly loading: boolean;
    readonly items: ReadonlyArray<PullRequestInboxItem>;
    readonly selectedId?: string | undefined;
    readonly viewerUnsupported: boolean;
    readonly onSelect: (id: PullRequestInboxItem["pullRequest"]["identity"]["id"]) => void;
  }
>(function PullRequestListPane(props, ref) {
  return (
    <section className="pull-request-pane-material relative min-h-0 overflow-hidden rounded-xl border border-border/55 shadow-[0_18px_48px_rgb(15_23_42/0.055),inset_0_1px_0_rgb(255_255_255/0.12)] dark:shadow-[0_22px_64px_rgb(0_0_0/0.18),inset_0_1px_0_rgb(255_255_255/0.055)]">
      <div
        ref={ref}
        role="listbox"
        aria-label="Pull requests"
        tabIndex={0}
        className="h-full overflow-y-auto overscroll-contain p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {props.loading ? (
          <PullRequestListSkeleton />
        ) : props.items.length > 0 ? (
          props.items.map((item) => (
            <PullRequestRow
              key={item.pullRequest.identity.id}
              item={item}
              selected={item.pullRequest.identity.id === props.selectedId}
              onSelect={props.onSelect}
            />
          ))
        ) : (
          <PullRequestListEmpty viewerUnsupported={props.viewerUnsupported} />
        )}
      </div>
    </section>
  );
});

function PullRequestRow(props: {
  readonly item: PullRequestInboxItem;
  readonly selected: boolean;
  readonly onSelect: (id: PullRequestInboxItem["pullRequest"]["identity"]["id"]) => void;
}) {
  const { pullRequest, associations, viewState } = props.item;
  return (
    <button
      type="button"
      role="option"
      aria-selected={props.selected}
      onClick={() => props.onSelect(pullRequest.identity.id)}
      className={cn(
        "group relative mb-1 w-full rounded-lg border px-3 py-2.5 text-left outline-none transition-[background-color,border-color,transform,box-shadow] last:mb-0 focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px",
        props.selected
          ? "border-foreground/10 bg-foreground/[0.065] shadow-[inset_0_1px_0_rgb(255_255_255/0.09)]"
          : "border-transparent hover:border-border/50 hover:bg-foreground/[0.028]",
      )}
    >
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground/72">
        <span className="min-w-0 flex-1 truncate font-medium text-foreground/62">
          {pullRequest.repository.displayName}
        </span>
        <span className="shrink-0 font-mono tabular-nums">#{pullRequest.identity.number}</span>
        <span className="shrink-0">{relativeDate(itemUpdatedAt(props.item))}</span>
        {viewState.isUnread ? (
          <span className="size-1.5 shrink-0 rounded-full bg-sky-500" aria-label="Unread updates" />
        ) : null}
      </div>
      <h2
        className={cn(
          "mt-1 line-clamp-2 text-[13px] leading-[1.35] tracking-[-0.005em]",
          viewState.isUnread ? "font-semibold text-foreground" : "font-medium text-foreground/84",
        )}
      >
        {pullRequest.title}
      </h2>
      <div className="mt-2 flex min-w-0 items-center gap-1.5">
        <StateBadge
          kind={changeRequestStateKind(pullRequest.state, pullRequest.isDraft)}
          className="px-1.5 py-0 text-[9px]"
        />
        <CheckStatus status={pullRequest.checks.status} />
        {pullRequest.review.disposition === "changes-requested" ? (
          <span className="truncate rounded-md border border-amber-500/18 bg-amber-500/8 px-1.5 py-0.5 text-[9px] text-amber-700 dark:text-amber-300">
            Changes requested
          </span>
        ) : pullRequest.review.disposition === "review-required" ? (
          <span className="truncate rounded-md border border-sky-500/16 bg-sky-500/7 px-1.5 py-0.5 text-[9px] text-sky-700 dark:text-sky-300">
            Review required
          </span>
        ) : null}
        <span className="ml-auto inline-flex min-w-0 items-center gap-1 text-[9px] text-muted-foreground/65">
          <UserRoundIcon className="size-2.5" />
          <span className="max-w-20 truncate">{pullRequest.author ?? "Unknown"}</span>
        </span>
        {associations.length > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-foreground/[0.035] px-1.5 py-0.5 text-[9px] text-muted-foreground">
            <Link2Icon className="size-2.5" />
            {associations.length}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function CheckStatus({
  status,
}: {
  status: PullRequestInboxItem["pullRequest"]["checks"]["status"];
}) {
  const classes =
    status === "passing"
      ? "text-emerald-600 dark:text-emerald-400"
      : status === "failing"
        ? "text-rose-600 dark:text-rose-400"
        : status === "pending"
          ? "text-amber-600 dark:text-amber-400"
          : "text-muted-foreground/60";
  const Icon =
    status === "passing" ? CheckCircle2Icon : status === "failing" ? XCircleIcon : CircleDashedIcon;
  return (
    <span
      title={`${status} checks`}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border/45 bg-background/28 px-1.5 py-0.5 text-[9px] capitalize",
        classes,
      )}
    >
      <Icon className="size-2.5" />
      {status}
    </span>
  );
}

function PullRequestListSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 7 }, (_, index) => (
        <div key={index} className="rounded-lg px-3 py-3">
          <div className="flex gap-2">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="ml-auto h-2.5 w-12" />
          </div>
          <Skeleton className="mt-2 h-3.5 w-[88%]" />
          <Skeleton className="mt-1.5 h-3.5 w-[64%]" />
          <div className="mt-3 flex gap-2">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

function PullRequestListEmpty({ viewerUnsupported }: { viewerUnsupported: boolean }) {
  return (
    <div className="flex min-h-full items-center justify-center p-8 text-center">
      <div className="max-w-60">
        <GitPullRequestIcon className="mx-auto size-6 text-muted-foreground/50" />
        <h2 className="mt-3 font-medium text-sm">Nothing in this view</h2>
        <p className="mt-1.5 text-muted-foreground text-xs leading-relaxed">
          {viewerUnsupported
            ? "The connected provider cannot verify the current viewer yet. Use Latest or repository filters instead."
            : "Try another inbox view, clear filters, or refresh connected repositories."}
        </p>
      </div>
    </div>
  );
}

const PullRequestDetailPane = React.forwardRef<
  HTMLDivElement,
  {
    readonly selectedItem: PullRequestInboxItem | null;
    readonly detail: PullRequestDetailResult | null;
    readonly loading: boolean;
    readonly error: string | null;
    readonly focus: boolean;
    readonly activeTab: PullRequestRouteSearch["tab"];
    readonly onActiveTabChange: (tab: PullRequestManagementTab) => void;
    readonly onToggleFocus: () => void;
    readonly onMarkUnread: () => void;
    readonly onBack: () => void;
    readonly relatedWorkCandidates: ReadonlyArray<RelatedRycoWorkCandidate>;
    readonly onAttachRelationship: (subject: PullRequestAssociationSubject) => Promise<void>;
    readonly onRemoveRelationship: (subject: PullRequestAssociationSubject) => Promise<void>;
    readonly onOpenThread: (threadId: string) => void;
    readonly onRefreshDetail: () => void;
  }
>(function PullRequestDetailPane(props, ref) {
  const item = props.selectedItem;
  return (
    <section
      ref={ref}
      tabIndex={-1}
      className="pull-request-pane-material relative min-h-0 min-w-0 overflow-hidden rounded-xl border border-border/55 outline-none shadow-[0_18px_48px_rgb(15_23_42/0.055),inset_0_1px_0_rgb(255_255_255/0.12)] focus-visible:ring-2 focus-visible:ring-ring dark:shadow-[0_22px_64px_rgb(0_0_0/0.18),inset_0_1px_0_rgb(255_255_255/0.055)]"
    >
      {item ? (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-2 border-border/50 border-b bg-background/24 px-2.5 backdrop-blur-xl">
            {props.focus ? (
              <Button size="xs" variant="ghost" onClick={props.onBack}>
                <ArrowLeftIcon className="size-3" />
                Inbox
              </Button>
            ) : null}
            <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground/70">
                {item.pullRequest.repository.displayName}
              </span>
              <span className="mx-1.5 opacity-35">/</span>#{item.pullRequest.identity.number}
            </span>
            {item.viewState.isUnread ? null : (
              <Button size="xs" variant="ghost" onClick={props.onMarkUnread}>
                Mark unread
              </Button>
            )}
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={props.focus ? "Exit focused detail" : "Open focused detail"}
              onClick={props.onToggleFocus}
            >
              {props.focus ? (
                <Minimize2Icon className="size-3" />
              ) : (
                <Maximize2Icon className="size-3" />
              )}
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Open pull request in provider"
              onClick={() => window.open(item.pullRequest.url, "_blank", "noopener,noreferrer")}
            >
              <ExternalLinkIcon className="size-3" />
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            {props.loading ? (
              <DetailSkeleton />
            ) : props.error ? (
              <DetailError message={props.error} />
            ) : props.detail ? (
              <PullRequestManagementDetail
                item={item}
                result={props.detail}
                activeTab={props.activeTab}
                onActiveTabChange={props.onActiveTabChange}
                relatedWorkCandidates={props.relatedWorkCandidates}
                onAttachRelationship={props.onAttachRelationship}
                onRemoveRelationship={props.onRemoveRelationship}
                onOpenThread={props.onOpenThread}
                onRefreshDetail={props.onRefreshDetail}
              />
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex size-full items-center justify-center p-8 text-center">
          <div className="max-w-xs">
            <GitBranchIcon className="mx-auto size-6 text-muted-foreground/45" />
            <h2 className="mt-3 font-medium text-sm">Select a pull request</h2>
            <p className="mt-1.5 text-muted-foreground text-xs">
              Choose an item to open its conversation, checks, commits, files, and related Ryco
              work.
            </p>
          </div>
        </div>
      )}
    </section>
  );
});

function DetailSkeleton() {
  return (
    <div className="p-6">
      <div className="flex gap-3">
        <Skeleton className="h-7 w-7" />
        <div className="flex-1">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="mt-2 h-3 w-1/3" />
        </div>
      </div>
      <div className="mt-8 grid grid-cols-[minmax(0,1fr)_220px] gap-6">
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-36 w-full rounded-lg" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
function DetailError({ message }: { message: string }) {
  return (
    <div className="flex size-full items-center justify-center p-8 text-center">
      <div className="max-w-sm">
        <AlertCircleIcon className="mx-auto size-6 text-rose-500" />
        <h2 className="mt-3 font-medium text-sm">Could not open pull request</h2>
        <p className="mt-1.5 text-muted-foreground text-xs leading-relaxed">{message}</p>
      </div>
    </div>
  );
}

function PaneResizeHandle(props: {
  readonly workspaceRef: React.RefObject<HTMLDivElement | null>;
  readonly initialWidth: number;
  readonly onCommit: (width: number) => void;
}) {
  return (
    <button
      type="button"
      aria-label="Resize pull request list"
      className="absolute top-3 bottom-3 z-[2] w-2 -translate-x-1/2 cursor-col-resize rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ left: `calc(0.625rem + var(--pr-list-width) + 0.25rem)` }}
      onPointerDown={(event) => {
        const startX = event.clientX;
        const startWidth = props.initialWidth;
        const element = event.currentTarget;
        element.setPointerCapture(event.pointerId);
        const onMove = (moveEvent: PointerEvent) => {
          const next = Math.max(
            320,
            Math.min(560, Math.round(startWidth + moveEvent.clientX - startX)),
          );
          props.workspaceRef.current?.style.setProperty("--pr-list-width", `${next}px`);
        };
        const onUp = (upEvent: PointerEvent) => {
          element.releasePointerCapture(upEvent.pointerId);
          const next = Math.max(
            320,
            Math.min(560, Math.round(startWidth + upEvent.clientX - startX)),
          );
          element.removeEventListener("pointermove", onMove);
          element.removeEventListener("pointerup", onUp);
          props.onCommit(next);
        };
        element.addEventListener("pointermove", onMove);
        element.addEventListener("pointerup", onUp);
      }}
    >
      <span className="absolute top-1/2 left-1/2 h-9 w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-border/70 transition-colors hover:bg-foreground/25" />
    </button>
  );
}

function CoverageFooter({ coverage }: { coverage: ReadonlyArray<PullRequestRepositoryCoverage> }) {
  const failed = coverage.filter((entry) => entry.state === "failed").length;
  const partial = coverage.filter((entry) => entry.state === "partial").length;
  if (coverage.length === 0) return null;
  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-border/35 border-t bg-background/28 px-4 font-mono text-[9px] text-muted-foreground/60">
      <span>{coverage.length} repositories scanned</span>
      {partial > 0 ? (
        <span className="text-amber-600 dark:text-amber-400">{partial} partial</span>
      ) : null}
      {failed > 0 ? (
        <span className="text-rose-600 dark:text-rose-400">{failed} unavailable</span>
      ) : null}
      <span className="ml-auto">J/K select · Enter detail · / search · Esc list</span>
    </footer>
  );
}
