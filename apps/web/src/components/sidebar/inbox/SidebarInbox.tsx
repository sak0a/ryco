import { getQueuedThreadKeys } from "@ryco/client-runtime/state/message-queue";
import {
  deriveProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "@ryco/client-runtime/state/composer";
import { LegendList, type LegendListRenderItemProps } from "@legendapp/list/react";
import { scopedProjectKey, scopedThreadKey, scopeThreadRef } from "@ryco/client-runtime/scoped";
import {
  buildThreadInbox,
  scopedInboxWorktreeKey,
  type Project,
  type ThreadInboxDraftSummary,
  type ThreadInboxEntry,
  type ThreadInboxEnvironment,
} from "@ryco/client-runtime/state/threads";
import type { DraftId } from "@ryco/client-runtime/state/composer";
import type { EnvironmentId } from "@ryco/contracts";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CloudIcon,
  GitBranchIcon,
  InboxIcon,
  MonitorIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useComposerDraftStore } from "../../../composerDraftStore";
import { readEnvironmentApi } from "../../../environmentApi";
import { usePrimaryEnvironmentDescriptor } from "../../../environments/primary";
import {
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
} from "../../../environments/runtime";
import { useMessageQueueStore } from "../../../messageQueueStore";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  selectSidebarWorktreesAcrossEnvironments,
  useStore,
} from "../../../store";
import { useUiStateStore } from "../../../uiStateStore";
import { useThreadSelectionStore } from "../../../threadSelectionStore";
import { useServerProviders } from "../../../rpc/serverState";
import { SidebarContent } from "../../ui/sidebar";
import { TooltipProvider } from "../../ui/tooltip";
import { SidebarInboxRow } from "./SidebarInboxRow";
import { ProjectFavicon } from "../../ProjectFavicon";
import { SidebarInboxFilters } from "./SidebarInboxFilters";
import type { InboxFilterOption } from "./InboxFilterCombobox";
import {
  SETTLED_PAGE_SIZE,
  shouldVirtualizeInbox,
  visibleSettledEntries,
} from "./sidebarInbox.logic";
import { useThreadSettlementActions } from "./useThreadSettlementActions";

interface SidebarInboxProps {
  readonly currentThreadKey: string | null;
  readonly onNavigateThread: (entry: ThreadInboxEntry) => void;
  readonly onNavigateDraft: (draftId: DraftId) => void;
}

type VirtualInboxRow =
  | {
      readonly kind: "entry";
      readonly key: string;
      readonly entry: ThreadInboxEntry;
    }
  | { readonly kind: "current-label"; readonly key: "current-label" }
  | { readonly kind: "settled-toggle"; readonly key: "settled-toggle" }
  | { readonly kind: "show-more"; readonly key: "show-more" };

const EMPTY_KEYS = new Set<string>();

function logicalProjectKey(project: Project): string {
  const repositoryKey = project.repositoryIdentity?.canonicalKey;
  return repositoryKey
    ? `repository:${repositoryKey}`
    : `project:${scopedProjectKey({
        environmentId: project.environmentId,
        projectId: project.id,
      })}`;
}

function draftTitle(prompt: string | undefined): string {
  const firstLine = prompt?.trim().split(/\r?\n/, 1)[0]?.trim();
  if (!firstLine) return "New thread";
  return firstLine.length > 72 ? `${firstLine.slice(0, 71)}…` : firstLine;
}

function sortedOptions(options: Iterable<InboxFilterOption>): InboxFilterOption[] {
  return [...options].toSorted((left, right) => left.label.localeCompare(right.label));
}

export function SidebarInbox({
  currentThreadKey,
  onNavigateThread,
  onNavigateDraft,
}: SidebarInboxProps) {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const worktrees = useStore(useShallow(selectSidebarWorktreesAcrossEnvironments));
  const environmentStateById = useStore((state) => state.environmentStateById);
  const primaryDescriptor = usePrimaryEnvironmentDescriptor();
  const savedRegistryById = useSavedEnvironmentRegistryStore((state) => state.byId);
  const savedRuntimeById = useSavedEnvironmentRuntimeStore((state) => state.byId);
  const primaryProviders = useServerProviders();
  const pinnedThreadKeysRecord = useUiStateStore((state) => state.pinnedThreadKeys);
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const queuesByThreadKey = useMessageQueueStore((state) => state.queuesByThreadKey);
  const { draftThreadsByThreadKey, draftsByThreadKey } = useComposerDraftStore(
    useShallow((state) => ({
      draftThreadsByThreadKey: state.draftThreadsByThreadKey,
      draftsByThreadKey: state.draftsByThreadKey,
    })),
  );
  const { settleThread, unsettleThread } = useThreadSettlementActions();

  const [textFilter, setTextFilter] = useState("");
  const [environmentFilter, setEnvironmentFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [worktreeFilter, setWorktreeFilter] = useState("all");
  const [settledOpen, setSettledOpen] = useState(false);
  const [settledVisibleCount, setSettledVisibleCount] = useState(SETTLED_PAGE_SIZE);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setSettledVisibleCount(SETTLED_PAGE_SIZE);
  }, [environmentFilter, projectFilter, textFilter, worktreeFilter]);

  const draftEntries = useMemo(() => {
    const drafts: ThreadInboxDraftSummary[] = [];
    const draftIdByThreadKey = new Map<string, DraftId>();
    for (const [rawDraftId, draft] of Object.entries(draftThreadsByThreadKey)) {
      const draftId = rawDraftId as DraftId;
      const ref = draft.promotedTo ?? scopeThreadRef(draft.environmentId, draft.threadId);
      draftIdByThreadKey.set(scopedThreadKey(ref), draftId);
      drafts.push({
        environmentId: draft.environmentId,
        threadId: draft.threadId,
        projectId: draft.projectId,
        title: draftTitle(draftsByThreadKey[draftId]?.prompt),
        createdAt: draft.createdAt,
        branch: draft.branch,
        worktreePath: draft.worktreePath,
        promotedTo: draft.promotedTo,
      });
    }
    return { drafts, draftIdByThreadKey };
  }, [draftThreadsByThreadKey, draftsByThreadKey]);

  const environmentIds = useMemo(() => {
    const ids = new Set<EnvironmentId>();
    for (const project of projects) ids.add(project.environmentId);
    for (const thread of threads) ids.add(thread.environmentId);
    for (const worktree of worktrees) ids.add(worktree.environmentId);
    for (const draft of draftEntries.drafts) ids.add(draft.environmentId);
    return [...ids];
  }, [draftEntries.drafts, projects, threads, worktrees]);

  const environments = useMemo<ThreadInboxEnvironment[]>(
    () =>
      environmentIds.map((environmentId) => {
        const primary = primaryDescriptor?.environmentId === environmentId;
        const runtime = savedRuntimeById[environmentId];
        const descriptor = primary ? primaryDescriptor : runtime?.descriptor;
        const hasApi = readEnvironmentApi(environmentId) !== undefined;
        const connected = primary ? hasApi : runtime?.connectionState === "connected" && hasApi;
        return {
          environmentId,
          label:
            descriptor?.label ?? savedRegistryById[environmentId]?.label ?? String(environmentId),
          threadSettlementSupported: descriptor?.capabilities.threadSettlement ?? false,
          connected,
          mutationReady: connected && hasApi,
          shellCurrent: environmentStateById[environmentId]?.bootstrapComplete === true,
        };
      }),
    [environmentIds, environmentStateById, primaryDescriptor, savedRegistryById, savedRuntimeById],
  );

  const environmentOptions = useMemo(
    () =>
      sortedOptions(
        environments.map((environment) => ({
          value: environment.environmentId,
          label: environment.label,
          artwork:
            primaryDescriptor?.environmentId === environment.environmentId ? (
              <MonitorIcon />
            ) : (
              <CloudIcon />
            ),
        })),
      ),
    [environments, primaryDescriptor],
  );

  const providerEntriesByEnvironment = useMemo(() => {
    const entriesByEnvironment = new Map<
      EnvironmentId,
      ReadonlyMap<string, ProviderInstanceEntry>
    >();
    for (const environment of environments) {
      const providers =
        primaryDescriptor?.environmentId === environment.environmentId
          ? primaryProviders
          : (savedRuntimeById[environment.environmentId]?.serverConfig?.providers ?? []);
      entriesByEnvironment.set(
        environment.environmentId,
        new Map(deriveProviderInstanceEntries(providers).map((entry) => [entry.instanceId, entry])),
      );
    }
    return entriesByEnvironment;
  }, [environments, primaryDescriptor, primaryProviders, savedRuntimeById]);

  const logicalProjects = useMemo(() => {
    const byKey = new Map<
      string,
      { label: string; projectKeys: string[]; artworkProject: Project }
    >();
    for (const project of projects) {
      if (environmentFilter !== "all" && project.environmentId !== environmentFilter) continue;
      const key = logicalProjectKey(project);
      const scopedKey = scopedProjectKey({
        environmentId: project.environmentId,
        projectId: project.id,
      });
      const existing = byKey.get(key);
      if (existing) {
        existing.projectKeys.push(scopedKey);
      } else {
        byKey.set(key, {
          label: project.name,
          projectKeys: [scopedKey],
          artworkProject: project,
        });
      }
    }
    return byKey;
  }, [environmentFilter, projects]);

  const projectOptions = useMemo(
    () =>
      sortedOptions(
        [...logicalProjects].map(([value, project]) => ({
          value,
          label: project.label,
          artwork: (
            <ProjectFavicon
              className="size-3.5"
              customAvatarContentHash={project.artworkProject.customAvatarContentHash ?? null}
              cwd={project.artworkProject.cwd}
              environmentId={project.artworkProject.environmentId}
              projectId={project.artworkProject.id}
            />
          ),
        })),
      ),
    [logicalProjects],
  );

  const selectedProjectKeys =
    projectFilter === "all" ? undefined : logicalProjects.get(projectFilter)?.projectKeys;
  const worktreeOptions = useMemo(() => {
    const allowedProjects = selectedProjectKeys ? new Set(selectedProjectKeys) : null;
    return sortedOptions(
      worktrees.flatMap((worktree) => {
        if (environmentFilter !== "all" && worktree.environmentId !== environmentFilter) return [];
        if (allowedProjects && !allowedProjects.has(scopedProjectKey(worktree))) return [];
        return [
          {
            value: scopedInboxWorktreeKey(worktree.environmentId, worktree.id),
            label: worktree.title ?? worktree.branch,
            searchText: worktree.branch,
            artwork: <GitBranchIcon />,
          },
        ];
      }),
    );
  }, [environmentFilter, selectedProjectKeys, worktrees]);

  useEffect(() => {
    if (projectFilter !== "all" && !logicalProjects.has(projectFilter)) setProjectFilter("all");
  }, [logicalProjects, projectFilter]);

  useEffect(() => {
    if (
      worktreeFilter !== "all" &&
      !worktreeOptions.some((option) => option.value === worktreeFilter)
    ) {
      setWorktreeFilter("all");
    }
  }, [worktreeFilter, worktreeOptions]);

  const model = useMemo(
    () =>
      buildThreadInbox({
        projects,
        worktrees,
        threads,
        environments,
        pinnedThreadKeys: new Set(
          Object.entries(pinnedThreadKeysRecord).flatMap(([key, pinned]) => (pinned ? [key] : [])),
        ),
        localQueuedThreadKeys: getQueuedThreadKeys(queuesByThreadKey),
        deliveryUnknownThreadKeys: EMPTY_KEYS,
        drafts: draftEntries.drafts,
        filters: {
          ...(environmentFilter === "all"
            ? {}
            : { environmentIds: [environmentFilter as EnvironmentId] }),
          ...(selectedProjectKeys ? { projectKeys: selectedProjectKeys } : {}),
          ...(worktreeFilter === "all" ? {} : { worktreeKeys: [worktreeFilter] }),
          text: textFilter,
        },
        currentThreadKey,
        nowMs,
      }),
    [
      currentThreadKey,
      draftEntries.drafts,
      environmentFilter,
      environments,
      nowMs,
      pinnedThreadKeysRecord,
      projects,
      queuesByThreadKey,
      selectedProjectKeys,
      textFilter,
      threads,
      worktreeFilter,
      worktrees,
    ],
  );

  const handleNavigate = (entry: ThreadInboxEntry) => {
    if (entry.isDraft) {
      const draftId = draftEntries.draftIdByThreadKey.get(entry.key);
      if (draftId) onNavigateDraft(draftId);
      return;
    }
    onNavigateThread(entry);
  };
  const visibleSettled = visibleSettledEntries(model.settled, settledVisibleCount);
  const currentCollapsedSettled = settledOpen
    ? null
    : (model.settled.find((entry) => entry.current) ?? null);
  const showEnvironment = environments.length > 1;
  const hasFilters =
    textFilter.trim().length > 0 ||
    environmentFilter !== "all" ||
    projectFilter !== "all" ||
    worktreeFilter !== "all";

  const filterControls = (
    <SidebarInboxFilters
      environment={environmentFilter}
      environmentOptions={environmentOptions}
      onEnvironmentChange={(value) => {
        clearSelection();
        setEnvironmentFilter(value);
        setProjectFilter("all");
        setWorktreeFilter("all");
      }}
      onProjectChange={(value) => {
        clearSelection();
        setProjectFilter(value);
        setWorktreeFilter("all");
      }}
      onTextChange={(value) => {
        clearSelection();
        setTextFilter(value);
      }}
      onWorktreeChange={(value) => {
        clearSelection();
        setWorktreeFilter(value);
      }}
      project={projectFilter}
      projectOptions={projectOptions}
      text={textFilter}
      worktree={worktreeFilter}
      worktreeOptions={worktreeOptions}
    />
  );

  const virtualVisibleEntryCount =
    model.active.length + (settledOpen ? visibleSettled.length : currentCollapsedSettled ? 1 : 0);
  if (shouldVirtualizeInbox(virtualVisibleEntryCount)) {
    const rows: VirtualInboxRow[] = [
      ...model.active.map((entry) => ({
        kind: "entry" as const,
        key: entry.key,
        entry,
      })),
      ...(currentCollapsedSettled
        ? [
            { kind: "current-label" as const, key: "current-label" as const },
            {
              kind: "entry" as const,
              key: `current:${currentCollapsedSettled.key}`,
              entry: currentCollapsedSettled,
            },
          ]
        : []),
      { kind: "settled-toggle", key: "settled-toggle" },
      ...(settledOpen
        ? visibleSettled.map((entry) => ({
            kind: "entry" as const,
            key: `settled:${entry.key}`,
            entry,
          }))
        : []),
      ...(settledOpen && visibleSettled.length < model.settled.length
        ? [{ kind: "show-more" as const, key: "show-more" as const }]
        : []),
    ];

    const renderVirtualRow = ({ item }: LegendListRenderItemProps<VirtualInboxRow>) => {
      if (item.kind === "entry") {
        return (
          <div className="pb-1">
            <SidebarInboxRow
              entry={item.entry}
              onNavigate={handleNavigate}
              onSettle={settleThread}
              onUnsettle={unsettleThread}
              providerEntryByInstanceId={providerEntriesByEnvironment.get(
                item.entry.environment.environmentId,
              )}
              showEnvironment={showEnvironment}
            />
          </div>
        );
      }
      if (item.kind === "current-label") {
        return (
          <div className="mt-1 flex h-7 items-center border-sidebar-border border-t px-4 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
            Current · settled
          </div>
        );
      }
      if (item.kind === "show-more") {
        return (
          <button
            className="mx-4 my-1 h-7 cursor-pointer text-left text-[10px] font-medium text-muted-foreground outline-hidden ring-ring hover:text-sidebar-foreground focus-visible:ring-2"
            onClick={() => setSettledVisibleCount((count) => count + SETTLED_PAGE_SIZE)}
            type="button"
          >
            Show {Math.min(SETTLED_PAGE_SIZE, model.settled.length - visibleSettled.length)} more
          </button>
        );
      }
      return (
        <button
          aria-expanded={settledOpen}
          className="mt-1 flex h-8 w-full cursor-pointer items-center gap-1.5 border-sidebar-border border-t px-4 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground outline-hidden ring-inset ring-ring hover:text-sidebar-foreground focus-visible:ring-2"
          onClick={() => setSettledOpen((open) => !open)}
          type="button"
        >
          {settledOpen ? (
            <ChevronDownIcon aria-hidden className="size-3" />
          ) : (
            <ChevronRightIcon aria-hidden className="size-3" />
          )}
          Settled
          <span className="ml-auto rounded-full bg-sidebar-accent px-1.5 py-0.5 tabular-nums text-[9px]">
            {model.settled.length}
          </span>
        </button>
      );
    };

    return (
      <TooltipProvider delay={150}>
        <div
          aria-labelledby="sidebar-inbox-tab"
          className="flex min-h-0 flex-1 flex-col"
          id="sidebar-inbox-panel"
          role="tabpanel"
        >
          {filterControls}
          <LegendList<VirtualInboxRow>
            className="min-h-0 flex-1 overscroll-y-contain pb-2"
            data={rows}
            estimatedItemSize={82}
            keyExtractor={(item) => item.key}
            ListHeaderComponent={
              <div className="pb-1">
                <div className="flex h-7 items-center gap-2 px-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <span>Active</span>
                  <span className="tabular-nums text-muted-foreground/60">
                    {model.active.length}
                  </span>
                </div>
              </div>
            }
            recycleItems={false}
            renderItem={renderVirtualRow}
          />
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delay={150}>
      <SidebarContent
        aria-labelledby="sidebar-inbox-tab"
        className="gap-0 pb-2"
        id="sidebar-inbox-panel"
        role="tabpanel"
      >
        {filterControls}

        <section aria-labelledby="sidebar-active-heading" className="pb-1">
          <div className="flex h-7 items-center gap-2 px-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <h2 id="sidebar-active-heading">Active</h2>
            <span className="tabular-nums text-muted-foreground/60">{model.active.length}</span>
          </div>
          {model.active.length > 0 ? (
            <div className="space-y-1">
              {model.active.map((entry) => (
                <SidebarInboxRow
                  key={entry.key}
                  entry={entry}
                  onNavigate={handleNavigate}
                  onSettle={settleThread}
                  onUnsettle={unsettleThread}
                  providerEntryByInstanceId={providerEntriesByEnvironment.get(
                    entry.environment.environmentId,
                  )}
                  showEnvironment={showEnvironment}
                />
              ))}
            </div>
          ) : (
            <div className="mx-3 flex flex-col items-center rounded-lg border border-dashed border-sidebar-border px-4 py-7 text-center">
              <InboxIcon aria-hidden className="mb-2 size-4 text-muted-foreground/45" />
              <p className="text-xs font-medium text-sidebar-foreground">
                {hasFilters
                  ? "No matching threads"
                  : threads.length + draftEntries.drafts.length === 0
                    ? "No threads yet"
                    : "You're all caught up"}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {hasFilters
                  ? "Try widening the Inbox filters."
                  : threads.length + draftEntries.drafts.length === 0
                    ? "Start a thread from Workspace to see it here."
                    : "New and active work will appear here."}
              </p>
            </div>
          )}
        </section>

        {currentCollapsedSettled ? (
          <section
            aria-label="Current settled thread"
            className="border-sidebar-border border-t py-1"
          >
            <div className="flex h-6 items-center px-4 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
              Current · settled
            </div>
            <SidebarInboxRow
              entry={currentCollapsedSettled}
              onNavigate={handleNavigate}
              onSettle={settleThread}
              onUnsettle={unsettleThread}
              providerEntryByInstanceId={providerEntriesByEnvironment.get(
                currentCollapsedSettled.environment.environmentId,
              )}
              showEnvironment={showEnvironment}
            />
          </section>
        ) : null}

        <section
          aria-labelledby="sidebar-settled-heading"
          className="mt-1 border-sidebar-border border-t pt-1"
        >
          <button
            aria-expanded={settledOpen}
            className="flex h-8 w-full cursor-pointer items-center gap-1.5 px-4 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground outline-hidden ring-inset ring-ring hover:text-sidebar-foreground focus-visible:ring-2"
            onClick={() => setSettledOpen((open) => !open)}
            type="button"
          >
            {settledOpen ? (
              <ChevronDownIcon aria-hidden className="size-3" />
            ) : (
              <ChevronRightIcon aria-hidden className="size-3" />
            )}
            <h2 id="sidebar-settled-heading">Settled</h2>
            <span className="ml-auto rounded-full bg-sidebar-accent px-1.5 py-0.5 tabular-nums text-[9px] text-muted-foreground">
              {model.settled.length}
            </span>
          </button>
          {settledOpen ? (
            <div className="space-y-1 pb-1">
              {visibleSettled.map((entry) => (
                <SidebarInboxRow
                  key={entry.key}
                  entry={entry}
                  onNavigate={handleNavigate}
                  onSettle={settleThread}
                  onUnsettle={unsettleThread}
                  providerEntryByInstanceId={providerEntriesByEnvironment.get(
                    entry.environment.environmentId,
                  )}
                  showEnvironment={showEnvironment}
                />
              ))}
              {visibleSettled.length < model.settled.length ? (
                <button
                  className="mx-4 mt-1 h-7 cursor-pointer text-[10px] font-medium text-muted-foreground outline-hidden ring-ring hover:text-sidebar-foreground focus-visible:ring-2"
                  onClick={() => setSettledVisibleCount((count) => count + SETTLED_PAGE_SIZE)}
                  type="button"
                >
                  Show {Math.min(SETTLED_PAGE_SIZE, model.settled.length - visibleSettled.length)}{" "}
                  more
                </button>
              ) : null}
              {model.settled.length === 0 ? (
                <p className="px-4 py-3 text-[10px] text-muted-foreground">No settled threads.</p>
              ) : null}
            </div>
          ) : null}
        </section>
      </SidebarContent>
    </TooltipProvider>
  );
}
