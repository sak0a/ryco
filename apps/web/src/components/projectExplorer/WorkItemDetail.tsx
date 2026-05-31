import type {
  ChangeRequest,
  EnvironmentId,
  ProjectId,
  WorkItemDetail as WorkItemDetailModel,
} from "@ryco/contracts";
import { DateTime, Option } from "effect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, ExternalLinkIcon, GitPullRequestIcon, TicketCheckIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { requireEnvironmentConnection } from "~/environments/runtime";
import { searchChangeRequestsQueryOptions } from "~/lib/sourceControlContextRpc";
import { workItemDetailQueryOptions, workItemsQueryKeys } from "~/lib/workItemsRpc";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { CommentItem } from "./CommentThread";
import { PrCheckStatusBadge } from "./PrCheckStatusBadge";
import { getPrCheckStatusFromChangeRequest } from "./prCheckStatus";

const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "long",
  day: "numeric",
});

interface WorkItemDetailProps {
  environmentId: EnvironmentId | null;
  projectId: ProjectId | null;
  cwd: string | null;
  workItemKey: string;
  onBack: () => void;
  onSelectLinkedChangeRequest?: ((number: number) => void) | undefined;
}

export function WorkItemDetail(props: WorkItemDetailProps) {
  const queryClient = useQueryClient();
  const [comment, setComment] = useState("");
  const detailQuery = useQuery(
    workItemDetailQueryOptions({
      environmentId: props.environmentId,
      projectId: props.projectId,
      key: props.workItemKey,
      fullContent: true,
    }),
  );
  const linkedPrQuery = useQuery(
    searchChangeRequestsQueryOptions({
      environmentId: props.environmentId,
      cwd: props.cwd,
      query: props.workItemKey,
      limit: 8,
      enabled: props.cwd !== null,
    }),
  );

  const invalidateDetail = () =>
    queryClient.invalidateQueries({
      queryKey: workItemsQueryKeys.detail(
        props.environmentId,
        props.projectId,
        props.workItemKey,
        true,
      ),
    });

  const addCommentMutation = useMutation({
    mutationFn: async () => {
      if (!props.environmentId || !props.projectId || comment.trim().length === 0) {
        throw new Error("Cannot add an empty Jira comment.");
      }
      const client = requireEnvironmentConnection(props.environmentId).client;
      return client.workItems.addComment({
        projectId: props.projectId,
        key: props.workItemKey,
        body: comment.trim(),
      });
    },
    onSuccess: () => {
      setComment("");
      void invalidateDetail();
      void queryClient.invalidateQueries({ queryKey: workItemsQueryKeys.all });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not add Jira comment",
          description: error instanceof Error ? error.message : "The comment was not posted.",
        }),
      );
    },
  });

  const transitionMutation = useMutation({
    mutationFn: async (transitionId: string) => {
      if (!props.environmentId || !props.projectId) {
        throw new Error("Cannot transition this Jira work item.");
      }
      const client = requireEnvironmentConnection(props.environmentId).client;
      return client.workItems.transition({
        projectId: props.projectId,
        key: props.workItemKey,
        transitionId,
      });
    },
    onSuccess: () => {
      void invalidateDetail();
      void queryClient.invalidateQueries({ queryKey: workItemsQueryKeys.all });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not transition Jira work item",
          description:
            error instanceof Error ? error.message : "The work item transition was not applied.",
        }),
      );
    },
  });

  const detail = detailQuery.data;
  const linkedChangeRequests = useMemo(
    () =>
      mergeLinkedChangeRequests(
        detail?.linkedChangeRequests ?? [],
        linkedPrQuery.data ?? [],
        props.workItemKey,
      ),
    [detail?.linkedChangeRequests, linkedPrQuery.data, props.workItemKey],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-border/60 border-b py-2 pr-12 pl-4">
        <Button type="button" size="sm" variant="ghost" onClick={props.onBack}>
          <ArrowLeftIcon className="size-3.5" />
          Back
        </Button>
        {detail ? (
          <a
            href={detail.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
          >
            <ExternalLinkIcon className="size-3" />
            View in Jira
          </a>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {detailQuery.isLoading ? (
          <div className="flex items-center gap-2 px-5 py-4 text-muted-foreground text-sm">
            <Spinner className="size-4" />
            Loading Jira work item…
          </div>
        ) : detailQuery.isError ? (
          <p className="px-5 py-4 text-destructive text-sm">
            {detailQuery.error instanceof Error ? detailQuery.error.message : "Failed to load."}
          </p>
        ) : detail ? (
          <WorkItemDetailBody
            detail={detail}
            linkedChangeRequests={linkedChangeRequests}
            linkedChangeRequestsLoading={linkedPrQuery.isLoading}
            onSelectLinkedChangeRequest={props.onSelectLinkedChangeRequest}
          />
        ) : null}
      </div>

      {detail ? (
        <footer className="grid gap-3 border-border/60 border-t bg-muted/30 px-4 py-3">
          {detail.transitions.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-muted-foreground text-xs">Transition</span>
              {detail.transitions.map((transition) => (
                <Button
                  key={transition.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={transitionMutation.isPending}
                  onClick={() => transitionMutation.mutate(transition.id)}
                >
                  {transitionMutation.isPending ? <Spinner className="size-3" /> : null}
                  {transition.name}
                </Button>
              ))}
            </div>
          ) : null}
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              if (!addCommentMutation.isPending && comment.trim().length > 0) {
                addCommentMutation.mutate();
              }
            }}
          >
            <Textarea
              value={comment}
              onChange={(event) => setComment(event.currentTarget.value)}
              placeholder="Add a Jira comment"
              className="min-h-18 text-sm"
            />
            <Button
              type="submit"
              size="sm"
              className="h-8 shrink-0"
              disabled={addCommentMutation.isPending || comment.trim().length === 0}
            >
              {addCommentMutation.isPending ? <Spinner className="size-3" /> : null}
              Comment
            </Button>
          </form>
        </footer>
      ) : null}
    </div>
  );
}

type WorkItemLinkedChangeRequest = Pick<
  ChangeRequest,
  "checkRollup" | "headSha" | "number" | "provider" | "state" | "title" | "url"
>;

function mergeLinkedChangeRequests(
  contractLinks: WorkItemDetailModel["linkedChangeRequests"],
  searchedLinks: ReadonlyArray<ChangeRequest>,
  workItemKey: string,
): ReadonlyArray<WorkItemLinkedChangeRequest> {
  const key = workItemKey.toLowerCase();
  const merged = new Map<number, WorkItemLinkedChangeRequest>();
  for (const link of contractLinks) {
    merged.set(link.number, {
      provider: link.provider,
      number: link.number,
      title: link.title,
      url: link.url,
      state: link.state,
    });
  }
  for (const link of searchedLinks) {
    const haystack = `${link.title} ${link.headRefName} ${link.baseRefName}`.toLowerCase();
    if (!haystack.includes(key) && contractLinks.length > 0) continue;
    merged.set(link.number, {
      provider: link.provider,
      number: link.number,
      title: link.title,
      url: link.url,
      state: link.state,
      ...(link.headSha ? { headSha: link.headSha } : {}),
      ...(link.checkRollup ? { checkRollup: link.checkRollup } : {}),
    });
  }
  return Array.from(merged.values()).toSorted((a, b) => b.number - a.number);
}

function WorkItemDetailBody(props: {
  readonly detail: WorkItemDetailModel;
  readonly linkedChangeRequests: ReadonlyArray<WorkItemLinkedChangeRequest>;
  readonly linkedChangeRequestsLoading: boolean;
  readonly onSelectLinkedChangeRequest?: ((number: number) => void) | undefined;
}) {
  const { detail } = props;
  const opCreatedAt =
    detail.updatedAt && Option.isSome(detail.updatedAt)
      ? detail.updatedAt.value
      : DateTime.fromDateUnsafe(new Date());

  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4">
        <header className="mb-5 space-y-2">
          <div className="flex items-start gap-3">
            <h2 className="flex-1 font-heading font-semibold text-xl leading-tight">
              {detail.title} <span className="font-normal text-muted-foreground">{detail.key}</span>
            </h2>
            <Badge
              variant={
                detail.state === "done" || detail.state === "closed" ? "secondary" : "outline"
              }
            >
              {detail.state.replace("_", " ")}
            </Badge>
          </div>
          <p className="text-muted-foreground text-xs">
            {detail.issueType ? detail.issueType : "Work item"}
            {detail.assignee ? <> · assigned to {detail.assignee}</> : null}
            {detail.updatedAt && Option.isSome(detail.updatedAt) ? (
              <> · updated {dateFmt.format(DateTime.toDate(detail.updatedAt.value))}</>
            ) : null}
          </p>
        </header>

        <ol className="space-y-4">
          <li>
            <CommentItem
              author={detail.reporter ?? "Jira"}
              body={detail.description}
              createdAt={opCreatedAt}
              isOriginalPost
            />
          </li>
          {detail.comments.map((comment) => (
            <li key={`${comment.author}-${DateTime.toDate(comment.createdAt).toISOString()}`}>
              <CommentItem
                author={comment.author}
                body={comment.body}
                createdAt={comment.createdAt}
              />
            </li>
          ))}
        </ol>
      </div>

      <aside className="hidden w-56 shrink-0 border-border/60 border-l bg-muted/20 px-4 py-4 lg:block">
        <div className="space-y-4 text-xs">
          <SidebarField label="State" value={detail.state.replace("_", " ")} />
          <SidebarField label="Assignee" value={detail.assignee ?? "Unassigned"} />
          <SidebarField label="Priority" value={detail.priority ?? "None"} />
          <SidebarField label="Parent" value={detail.parentKey ?? detail.epicKey ?? "None"} />
          {detail.labels && detail.labels.length > 0 ? (
            <div>
              <div className="mb-2 text-muted-foreground">Labels</div>
              <div className="flex flex-wrap gap-1">
                {detail.labels.map((label) => (
                  <Badge key={label} variant="outline" size="sm">
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
          <div>
            <div className="mb-2 text-muted-foreground">Linked PRs</div>
            {props.linkedChangeRequestsLoading ? (
              <span className="text-muted-foreground/70 text-xs italic">Searching…</span>
            ) : props.linkedChangeRequests.length > 0 ? (
              <ul className="space-y-1.5">
                {props.linkedChangeRequests.map((pr) => {
                  const checkStatus = getPrCheckStatusFromChangeRequest(pr);
                  return (
                    <li key={pr.number}>
                      <button
                        type="button"
                        onClick={() => props.onSelectLinkedChangeRequest?.(pr.number)}
                        className="flex w-full items-start gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-left hover:bg-accent/50"
                      >
                        <GitPullRequestIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-foreground text-xs">
                            #{pr.number} {pr.title}
                          </span>
                          <span className="mt-1 flex items-center gap-1 text-muted-foreground text-[10px] capitalize">
                            {pr.state}
                            <PrCheckStatusBadge view={checkStatus} mode="compact" />
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <span className="text-muted-foreground/70 text-xs italic">None found</span>
            )}
          </div>
          <div className="rounded-md border border-border/60 bg-background/60 p-3">
            <TicketCheckIcon className="mb-2 size-4 text-blue-600 dark:text-blue-300" />
            <p className="text-muted-foreground leading-relaxed">
              Use transitions and comments here to keep Jira aligned while reviewing repository
              changes.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

function SidebarField(props: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <div className="mb-1 text-muted-foreground">{props.label}</div>
      <div className="font-medium text-foreground capitalize">{props.value}</div>
    </div>
  );
}
