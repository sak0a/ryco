import type { ChangeRequest, EnvironmentId, SourceControlIssueSummary } from "@ryco/contracts";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { SearchIcon, RotateCwIcon } from "lucide-react";
import { useMemo, type RefObject } from "react";
import {
  changeRequestListQueryOptions,
  searchChangeRequestsQueryOptions,
} from "~/lib/sourceControlContextRpc";
import { searchSourceControlSummaries } from "../chat/composerSourceControlContextSearch";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { PullRequestList } from "./PullRequestList";
import { getPrCheckStatusFromChangeRequest, shouldRefreshPrCheckStatus } from "./prCheckStatus";
import {
  ChangeRequestStateFilterButtons,
  type ChangeRequestStateFilter,
} from "./StateFilterButtons";
import { usePrCheckPassNotifications } from "./usePrCheckPassNotifications";

interface PullRequestsTabProps {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  searchInputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (value: string) => void;
  selectedKey?: string | null;
  stateFilter: ChangeRequestStateFilter;
  onStateFilterChange: (state: ChangeRequestStateFilter) => void;
  onSelect: (changeRequest: ChangeRequest) => void;
}

export function PullRequestsTab(props: PullRequestsTabProps) {
  const [debouncedQuery] = useDebouncedValue(props.query, { wait: 200 });

  const listQuery = useQuery({
    ...changeRequestListQueryOptions({
      environmentId: props.environmentId,
      cwd: props.cwd,
      state: props.stateFilter,
      limit: 100,
    }),
    refetchInterval: (query) => {
      const data = query.state.data;
      return Array.isArray(data) &&
        data.some((pr) => shouldRefreshPrCheckStatus(getPrCheckStatusFromChangeRequest(pr)))
        ? 30_000
        : false;
    },
  });

  const cachedItems = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const filteredItems = useMemo(
    () =>
      // ChangeRequest has the same number/title shape as SourceControlIssueSummary
      // for filtering purposes, so reuse the existing helper.
      searchSourceControlSummaries(
        cachedItems as unknown as ReadonlyArray<SourceControlIssueSummary>,
        props.query,
      ) as unknown as ReadonlyArray<ChangeRequest>,
    [cachedItems, props.query],
  );

  const needsServerSearch = filteredItems.length === 0 && debouncedQuery.trim().length >= 2;
  const serverSearchQuery = useQuery(
    searchChangeRequestsQueryOptions({
      environmentId: props.environmentId,
      cwd: props.cwd,
      query: debouncedQuery,
      limit: 50,
      enabled: needsServerSearch,
    }),
  );

  const items = useMemo<ReadonlyArray<ChangeRequest>>(
    () => (needsServerSearch ? (serverSearchQuery.data ?? []) : filteredItems),
    [filteredItems, needsServerSearch, serverSearchQuery.data],
  );
  const isLoading = listQuery.isLoading || (needsServerSearch && serverSearchQuery.isLoading);
  const error = listQuery.error ?? (needsServerSearch ? serverSearchQuery.error : null);
  const notificationTargets = useMemo(
    () =>
      items.map((pr) => ({
        environmentId: props.environmentId,
        cwd: props.cwd,
        provider: pr.provider,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        status: getPrCheckStatusFromChangeRequest(pr),
      })),
    [items, props.cwd, props.environmentId],
  );

  usePrCheckPassNotifications(notificationTargets);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-border/60 border-b px-4 py-2.5">
        <div className="relative flex-1">
          <SearchIcon className="-translate-y-1/2 absolute top-1/2 left-2 size-3.5 text-muted-foreground" />
          <Input
            ref={props.searchInputRef}
            value={props.query}
            onChange={(event) => props.onQueryChange(event.target.value)}
            placeholder="Search pull requests by title or number…"
            className="h-8 pl-7 text-sm"
          />
        </div>
        <ChangeRequestStateFilterButtons
          value={props.stateFilter}
          onChange={props.onStateFilterChange}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => listQuery.refetch()}
          disabled={listQuery.isFetching}
          aria-label="Refresh"
        >
          <RotateCwIcon className={listQuery.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p className="px-4 py-6 text-destructive text-sm">
            {error instanceof Error ? error.message : "Failed to load pull requests."}
          </p>
        ) : (
          <PullRequestList
            items={items}
            isLoading={isLoading}
            emptyText={
              props.query.trim().length > 0
                ? "No pull requests match this search."
                : "No pull requests to show."
            }
            selectedKey={props.selectedKey}
            onSelect={props.onSelect}
          />
        )}
      </div>
    </div>
  );
}
