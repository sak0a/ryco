import type {
  ChangeRequest,
  EnvironmentId,
  ProjectId,
  SourceControlIssueSummary,
  WorkItemSummary,
} from "@ryco/contracts";
import { type DragEvent, type ChangeEvent, useRef, useState } from "react";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { PaperclipIcon } from "lucide-react";
import {
  useSourceControlChangeRequestList,
  useSourceControlChangeRequestSearch,
  useSourceControlIssueList,
  useSourceControlIssueSearch,
} from "~/rpc/useSourceControl";
import { useWorkItemList, useWorkItemSearch } from "~/rpc/useWorkItems";
import { workItemStateLabel } from "~/lib/workItemState";
import { cn } from "~/lib/utils";
import { searchSourceControlSummaries } from "./composerSourceControlContextSearch";
import { ContextPickerList } from "./ContextPickerList";
import { ContextPickerTabs } from "./ContextPickerTabs";

type TabId = "issues" | "prs" | "jira";

export function ContextPickerPopup(props: {
  environmentId: EnvironmentId | null;
  cwd: string;
  projectId: ProjectId | null;
  hasSourceControlRemote: boolean;
  hasJiraProvider: boolean;
  onSelectIssue: (issue: SourceControlIssueSummary) => void;
  onSelectChangeRequest: (cr: ChangeRequest) => void;
  onSelectWorkItem: (workItem: WorkItemSummary) => void;
  onAttachFile: (file: File) => void;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("issues");
  const [query, setQuery] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const availableTabs: TabId[] = [
    ...(props.hasSourceControlRemote ? (["issues", "prs"] as TabId[]) : []),
    ...(props.hasJiraProvider ? (["jira"] as TabId[]) : []),
  ];
  const effectiveTab: TabId = availableTabs.includes(activeTab)
    ? activeTab
    : (availableTabs[0] ?? "issues");

  const [debouncedQuery] = useDebouncedValue(query, { wait: 200 });

  // Cached list queries
  const issueListQuery = useSourceControlIssueList({
    environmentId: props.environmentId,
    cwd: props.cwd,
    state: "open",
  });
  const prListQuery = useSourceControlChangeRequestList({
    environmentId: props.environmentId,
    cwd: props.cwd,
    state: "open",
  });

  // Client-side filter
  const cachedIssues = issueListQuery.data ?? [];
  const cachedPrs = prListQuery.data ?? [];

  const filteredIssues = searchSourceControlSummaries(cachedIssues, query);
  // For PRs, ChangeRequest has number and title, so it satisfies the constraint
  const filteredPrs = searchSourceControlSummaries(
    cachedPrs as unknown as ReadonlyArray<SourceControlIssueSummary>,
    query,
  ) as unknown as ReadonlyArray<ChangeRequest>;

  // Fall-through server search when client filter is empty and query is long enough
  const needsServerSearchIssues =
    effectiveTab === "issues" && filteredIssues.length === 0 && debouncedQuery.length >= 2;
  const needsServerSearchPrs =
    effectiveTab === "prs" && filteredPrs.length === 0 && debouncedQuery.length >= 2;

  const serverIssueSearchQuery = useSourceControlIssueSearch({
    environmentId: props.environmentId,
    cwd: props.cwd,
    query: debouncedQuery,
    enabled: needsServerSearchIssues,
  });
  const serverPrSearchQuery = useSourceControlChangeRequestSearch({
    environmentId: props.environmentId,
    cwd: props.cwd,
    query: debouncedQuery,
    enabled: needsServerSearchPrs,
  });

  // Jira work items (tab rendered only when the project has a Jira link)
  const workItemListQuery = useWorkItemList({
    environmentId: props.environmentId,
    projectId: props.projectId,
    state: "open",
    limit: 50,
    enabled: props.hasJiraProvider,
  });
  const cachedWorkItems = workItemListQuery.data ?? [];
  const filteredWorkItems = filterWorkItemsByQuery(cachedWorkItems, query);
  const needsServerSearchWorkItems =
    props.hasJiraProvider &&
    effectiveTab === "jira" &&
    filteredWorkItems.length === 0 &&
    debouncedQuery.length >= 2;
  const serverWorkItemSearchQuery = useWorkItemSearch({
    environmentId: props.environmentId,
    projectId: props.projectId,
    query: debouncedQuery,
    enabled: needsServerSearchWorkItems,
  });
  const displayWorkItems: ReadonlyArray<WorkItemSummary> = needsServerSearchWorkItems
    ? (serverWorkItemSearchQuery.data ?? [])
    : filteredWorkItems;
  const isLoadingWorkItems =
    workItemListQuery.isLoading ||
    (needsServerSearchWorkItems && serverWorkItemSearchQuery.isLoading);

  // Effective display lists
  const displayIssues: ReadonlyArray<SourceControlIssueSummary> = needsServerSearchIssues
    ? (serverIssueSearchQuery.data ?? [])
    : filteredIssues;
  const displayPrs: ReadonlyArray<ChangeRequest> = needsServerSearchPrs
    ? (serverPrSearchQuery.data ?? [])
    : filteredPrs;

  const isLoadingIssues =
    issueListQuery.isLoading || (needsServerSearchIssues && serverIssueSearchQuery.isLoading);
  const isLoadingPrs =
    prListQuery.isLoading || (needsServerSearchPrs && serverPrSearchQuery.isLoading);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      props.onAttachFile(file);
    }
    // Reset so the same file can be re-selected
    e.target.value = "";
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      props.onAttachFile(file);
    }
  }

  return (
    <div
      className="flex w-80 flex-col"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-drag-over={isDragOver || undefined}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-sm font-medium">Add context</span>
        <button
          type="button"
          aria-label="Attach file"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => fileInputRef.current?.click()}
        >
          <PaperclipIcon className="size-4" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={handleFileChange}
        />
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border">
        <input
          type="text"
          className="w-full rounded-md bg-muted px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {props.hasSourceControlRemote || props.hasJiraProvider ? (
        <>
          {/* Tabs */}
          <ContextPickerTabs
            tabs={[
              ...(props.hasSourceControlRemote
                ? [
                    { id: "issues", label: "Issues", count: cachedIssues.length },
                    { id: "prs", label: "PRs", count: cachedPrs.length },
                  ]
                : []),
              ...(props.hasJiraProvider
                ? [{ id: "jira", label: "Jira", count: cachedWorkItems.length }]
                : []),
            ]}
            activeId={effectiveTab}
            onSelect={(id) => setActiveTab(id as TabId)}
          />

          {/* List */}
          {effectiveTab === "issues" ? (
            <ContextPickerList
              items={displayIssues}
              isLoading={isLoadingIssues}
              emptyText={query.length > 0 ? "No matching issues" : "No open issues"}
              onSelect={props.onSelectIssue}
            />
          ) : effectiveTab === "prs" ? (
            <ContextPickerList
              items={displayPrs as unknown as ReadonlyArray<SourceControlIssueSummary>}
              isLoading={isLoadingPrs}
              emptyText={query.length > 0 ? "No matching PRs" : "No open PRs"}
              onSelect={(item) => props.onSelectChangeRequest(item as unknown as ChangeRequest)}
            />
          ) : (
            <WorkItemPickerList
              items={displayWorkItems}
              isLoading={isLoadingWorkItems}
              emptyText={query.length > 0 ? "No matching work items" : "No open work items"}
              onSelect={props.onSelectWorkItem}
            />
          )}
        </>
      ) : (
        <p className="px-3 py-4 text-xs text-muted-foreground">
          No source-control remote detected. File attach is still available above.
        </p>
      )}
    </div>
  );
}

function filterWorkItemsByQuery(
  workItems: ReadonlyArray<WorkItemSummary>,
  query: string,
): ReadonlyArray<WorkItemSummary> {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return workItems;
  return workItems.filter((item) => {
    const key = item.key.toLowerCase();
    const title = item.title.toLowerCase();
    return key === q || key.startsWith(q) || title.includes(q);
  });
}

function WorkItemPickerList(props: {
  items: ReadonlyArray<WorkItemSummary>;
  isLoading: boolean;
  emptyText: string;
  onSelect: (item: WorkItemSummary) => void;
}) {
  if (props.isLoading && props.items.length === 0) {
    return <div className="px-3 py-4 text-xs text-muted-foreground">Loading…</div>;
  }
  if (props.items.length === 0) {
    return <div className="px-3 py-4 text-xs text-muted-foreground">{props.emptyText}</div>;
  }
  return (
    <ul className="max-h-72 overflow-y-auto" role="listbox">
      {props.items.map((item) => (
        <li key={`${item.provider}:${item.key}`}>
          <button
            type="button"
            onClick={() => props.onSelect(item)}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
              "hover:bg-accent",
            )}
          >
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{item.key}</span>
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {workItemStateLabel(item)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
