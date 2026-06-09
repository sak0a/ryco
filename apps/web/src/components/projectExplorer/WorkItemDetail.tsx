import type {
  ChangeRequest,
  EnvironmentId,
  ProjectId,
  VcsRef,
  WorkItemComment,
  WorkItemDetail as WorkItemDetailModel,
  WorkItemEditableFieldId,
  WorkItemEditableFieldMetadata,
  WorkItemEditableFieldOption,
  WorkItemPriority,
  WorkItemUpdateFields,
} from "@ryco/contracts";
import { scopeProjectRef } from "@ryco/client-runtime";
import { DateTime, Option } from "effect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsDownIcon,
  ChevronsUpIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  HistoryIcon,
  MessageSquareIcon,
  MinusIcon,
  PencilIcon,
  SparklesIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { requireEnvironmentConnection } from "~/environments/runtime";
import { readEnvironmentApi } from "~/environmentApi";
import {
  findLinkedWorkItemBranches,
  findLinkedWorkItemWorktrees,
  type LinkedWorkItemWorktree,
} from "~/lib/workItemLocalLinks";
import { searchChangeRequestsQueryOptions } from "~/lib/sourceControlContextRpc";
import { workItemStateLabel } from "~/lib/workItemState";
import { workItemDetailQueryOptions, workItemsQueryKeys } from "~/lib/workItemsRpc";
import { selectSidebarWorktreesForProjectRef, useStore } from "~/store";
import { AtlassianJiraIcon } from "../Icons";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { CommentComposer, CommentItem, type CommentQuoteInsertion } from "./CommentThread";
import { buildCommentQuoteMarkdown } from "./CommentThread.logic";
import { LabelChip } from "./LabelChip";
import { PrCheckStatusBadge } from "./PrCheckStatusBadge";
import { getPrCheckStatusFromChangeRequest } from "./prCheckStatus";
import {
  SourceControlDetailErrorState,
  SourceControlDetailLayout,
  SourceControlDetailLoadingState,
  SourceControlDetailToolbar,
  SourceControlMetricStrip,
} from "./SourceControlDetailLayout";
import {
  SourceControlTimeline,
  SourceControlTimelineEntry,
  SourceControlTimelineNotice,
} from "./SourceControlTimeline";
import { StateBadge, type StateBadgeKind } from "./StateBadge";

const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const NONE_VALUE = "__none__";

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
  const [editingComment, setEditingComment] = useState<WorkItemComment | null>(null);
  const [quoteInsertion, setQuoteInsertion] = useState<CommentQuoteInsertion | null>(null);
  const [descriptionDialogOpen, setDescriptionDialogOpen] = useState(false);

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
  const localBranchQuery = useQuery({
    queryKey: [
      "workItems",
      "localBranches",
      props.environmentId,
      props.cwd ?? null,
      props.workItemKey,
    ] as const,
    queryFn: async () => {
      const api = props.environmentId ? readEnvironmentApi(props.environmentId) : null;
      if (!api || !props.cwd) return [];
      const result = await api.vcs.listRefs({
        cwd: props.cwd,
        query: props.workItemKey,
        limit: 100,
      });
      return result.refs;
    },
    enabled: props.environmentId !== null && props.cwd !== null,
    staleTime: 30_000,
  });
  const projectWorktrees = useStore(
    useShallow((state) =>
      props.environmentId && props.projectId
        ? selectSidebarWorktreesForProjectRef(
            state,
            scopeProjectRef(props.environmentId, props.projectId),
          )
        : [],
    ),
  );

  const setDetailCache = (detail: WorkItemDetailModel) => {
    queryClient.setQueryData(
      workItemsQueryKeys.detail(props.environmentId, props.projectId, props.workItemKey, true),
      detail,
    );
  };

  const updateMutation = useMutation({
    mutationFn: async (fields: WorkItemUpdateFields) => {
      if (!props.environmentId || !props.projectId) {
        throw new Error("Cannot update this Jira work item.");
      }
      const client = requireEnvironmentConnection(props.environmentId).client;
      return client.workItems.update({
        projectId: props.projectId,
        key: props.workItemKey,
        fields,
      });
    },
    onSuccess: (detail) => {
      setDetailCache(detail);
      void queryClient.invalidateQueries({ queryKey: workItemsQueryKeys.all });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not update Jira work item",
          description: error instanceof Error ? error.message : "The Jira update was not saved.",
        }),
      );
    },
  });

  const addCommentMutation = useMutation({
    mutationFn: async (body: string) => {
      if (!props.environmentId || !props.projectId || body.trim().length === 0) {
        throw new Error("Cannot add an empty Jira comment.");
      }
      const client = requireEnvironmentConnection(props.environmentId).client;
      return client.workItems.addComment({
        projectId: props.projectId,
        key: props.workItemKey,
        body: body.trim(),
      });
    },
    onSuccess: (detail) => {
      setDetailCache(detail);
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

  const editCommentMutation = useMutation({
    mutationFn: async (input: { readonly commentId: string; readonly body: string }) => {
      if (!props.environmentId || !props.projectId || input.body.trim().length === 0) {
        throw new Error("Cannot save an empty Jira comment.");
      }
      const client = requireEnvironmentConnection(props.environmentId).client;
      return client.workItems.editComment({
        projectId: props.projectId,
        key: props.workItemKey,
        commentId: input.commentId,
        body: input.body.trim(),
      });
    },
    onSuccess: (detail) => {
      setEditingComment(null);
      setDetailCache(detail);
      void queryClient.invalidateQueries({ queryKey: workItemsQueryKeys.all });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not edit Jira comment",
          description: error instanceof Error ? error.message : "The comment edit was not saved.",
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
    onSuccess: (detail) => {
      setDetailCache(detail);
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

  const improveDescriptionMutation = useMutation({
    mutationFn: async (input: { readonly rough: string; readonly instructions: string }) => {
      if (!props.environmentId || !props.cwd) {
        throw new Error("AI description improvement requires an active project path.");
      }
      const client = requireEnvironmentConnection(props.environmentId).client;
      return client.textGeneration.generateIssueContent({
        cwd: props.cwd,
        mode: "polish",
        rough: input.rough,
        currentTitle: detailQuery.data?.title,
        ...(input.instructions.trim().length > 0
          ? { customInstructions: input.instructions.trim() }
          : {}),
      });
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
  const linkedBranches = useMemo(
    () =>
      findLinkedWorkItemBranches({
        key: props.workItemKey,
        refs: localBranchQuery.data ?? [],
      }),
    [localBranchQuery.data, props.workItemKey],
  );
  const linkedWorktrees = useMemo(
    () =>
      findLinkedWorkItemWorktrees({
        key: props.workItemKey,
        worktrees: projectWorktrees,
      }),
    [projectWorktrees, props.workItemKey],
  );

  const queueQuoteInsertion = (comment: {
    readonly author: string;
    readonly body: string;
    readonly createdAt: DateTime.Utc;
    readonly contextLabel: string;
  }) => {
    setQuoteInsertion({
      id: Date.now(),
      markdown: buildCommentQuoteMarkdown(comment),
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SourceControlDetailToolbar
        onBack={props.onBack}
        githubUrl={detail?.url}
        githubLabel="Open in Jira"
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        {detailQuery.isLoading ? (
          <SourceControlDetailLoadingState label="Jira work item" />
        ) : detailQuery.isError ? (
          <SourceControlDetailErrorState
            message={
              detailQuery.error instanceof Error ? detailQuery.error.message : "Failed to load."
            }
          />
        ) : detail ? (
          <SourceControlDetailLayout
            sidebar={
              <WorkItemSidebar
                detail={detail}
                linkedChangeRequests={linkedChangeRequests}
                linkedChangeRequestsLoading={linkedPrQuery.isLoading}
                linkedBranches={linkedBranches}
                linkedBranchesLoading={localBranchQuery.isLoading}
                linkedWorktrees={linkedWorktrees}
                mutationPending={updateMutation.isPending}
                onUpdate={(fields) => updateMutation.mutate(fields)}
                onSelectLinkedChangeRequest={props.onSelectLinkedChangeRequest}
              />
            }
          >
            <WorkItemConversation
              detail={detail}
              canImproveDescription={
                props.cwd !== null && editableField(detail, "description") !== null
              }
              addCommentPending={addCommentMutation.isPending}
              transitionPending={transitionMutation.isPending}
              onAddComment={(body) => addCommentMutation.mutateAsync(body)}
              onEditComment={(comment) => setEditingComment(comment)}
              onImproveDescription={() => setDescriptionDialogOpen(true)}
              onQuote={queueQuoteInsertion}
              onTransition={(transitionId) => transitionMutation.mutate(transitionId)}
              quoteInsertion={quoteInsertion}
              onQuoteInsertionHandled={(id) => {
                if (quoteInsertion?.id === id) setQuoteInsertion(null);
              }}
            />
          </SourceControlDetailLayout>
        ) : null}
      </div>

      {editingComment ? (
        <EditCommentDialog
          comment={editingComment}
          pending={editCommentMutation.isPending}
          onOpenChange={(open) => {
            if (!open && !editCommentMutation.isPending) setEditingComment(null);
          }}
          onSave={(body) => {
            if (!editingComment.id) return;
            editCommentMutation.mutate({ commentId: editingComment.id, body });
          }}
        />
      ) : null}

      {detail ? (
        <ImproveDescriptionDialog
          open={descriptionDialogOpen}
          detail={detail}
          generatePending={improveDescriptionMutation.isPending}
          savePending={updateMutation.isPending}
          generateError={improveDescriptionMutation.error}
          onOpenChange={setDescriptionDialogOpen}
          onGenerate={(input) => improveDescriptionMutation.mutateAsync(input)}
          onSave={(description) => {
            updateMutation.mutate(
              { description },
              {
                onSuccess: () => setDescriptionDialogOpen(false),
              },
            );
          }}
        />
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

function WorkItemConversation(props: {
  readonly detail: WorkItemDetailModel;
  readonly canImproveDescription: boolean;
  readonly addCommentPending: boolean;
  readonly transitionPending: boolean;
  readonly quoteInsertion: CommentQuoteInsertion | null;
  readonly onAddComment: (body: string) => Promise<unknown>;
  readonly onEditComment: (comment: WorkItemComment) => void;
  readonly onImproveDescription: () => void;
  readonly onQuote: (comment: {
    readonly author: string;
    readonly body: string;
    readonly createdAt: DateTime.Utc;
    readonly contextLabel: string;
  }) => void;
  readonly onQuoteInsertionHandled: (id: number) => void;
  readonly onTransition: (transitionId: string) => void;
}) {
  const { detail } = props;
  const opCreatedAt =
    detail.createdAt && Option.isSome(detail.createdAt)
      ? detail.createdAt.value
      : detail.updatedAt && Option.isSome(detail.updatedAt)
        ? detail.updatedAt.value
        : DateTime.fromDateUnsafe(new Date());

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-border/60 border-b px-5 py-4 lg:px-6">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-muted-foreground text-xs">{detail.key}</span>
              <StateBadge kind={workItemStateBadgeKind(detail.state)} />
              {detail.issueType ? (
                <span className="rounded-full border border-border/60 bg-muted/35 px-2 py-0.5 text-muted-foreground text-xs">
                  {detail.issueType}
                </span>
              ) : null}
            </div>
            <h2 className="font-heading font-semibold text-xl leading-tight">{detail.title}</h2>
            {detail.labels && detail.labels.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {detail.labels.map((label) => (
                  <LabelChip key={label} label={label} />
                ))}
              </div>
            ) : null}
          </div>
          {props.canImproveDescription ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              onClick={props.onImproveDescription}
            >
              <SparklesIcon className="size-3.5" />
              Improve description with AI
            </Button>
          ) : null}
        </div>
        <SourceControlMetricStrip
          className="mt-4"
          items={[
            { label: "Status", value: workItemStateLabel(detail) },
            {
              label: "Priority",
              value: <PriorityDisplay priority={detail.priorityDetail ?? detail.priority} />,
            },
            { label: "Assignee", value: detail.assignee ?? "Unassigned" },
            { label: "Updated", value: formatOptionDate(detail.updatedAt) ?? "Unknown" },
          ]}
        />
        {detail.transitions.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs">Transition</span>
            {detail.transitions.map((transition) => (
              <Button
                key={transition.id}
                type="button"
                size="sm"
                variant="outline"
                className="h-7"
                disabled={props.transitionPending}
                onClick={() => props.onTransition(transition.id)}
              >
                {props.transitionPending ? <Spinner className="size-3" /> : null}
                {transition.name}
              </Button>
            ))}
          </div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/8 px-4 py-5 sm:px-5 lg:px-6">
        <div className="mx-auto w-full max-w-[980px]">
          <SourceControlTimeline>
            <SourceControlTimelineEntry tone="body" icon={<FileTextIcon className="size-4" />}>
              <CommentItem
                author={detail.reporter ?? "Jira"}
                body={detail.description}
                createdAt={opCreatedAt}
                isOriginalPost
                itemKind="body"
                onQuote={() =>
                  props.onQuote({
                    author: detail.reporter ?? "Jira",
                    body: detail.description,
                    createdAt: opCreatedAt,
                    contextLabel: "Jira description",
                  })
                }
              />
            </SourceControlTimelineEntry>
            <SourceControlTimelineEntry tone="system" icon={<CircleDotIcon className="size-4" />}>
              <SourceControlTimelineNotice
                tone="system"
                title="Current Jira status"
                description={
                  formatOptionDate(detail.updatedAt)
                    ? `Updated ${formatOptionDate(detail.updatedAt)}`
                    : undefined
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StateBadge kind={workItemStateBadgeKind(detail.state)} />
                  {detail.assignee ? (
                    <span className="text-muted-foreground text-xs">
                      Assigned to {detail.assignee}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">Unassigned</span>
                  )}
                </div>
              </SourceControlTimelineNotice>
            </SourceControlTimelineEntry>
            {detail.activity.length > 0 ? (
              detail.activity.map((entry) => (
                <SourceControlTimelineEntry
                  key={entry.id}
                  tone="system"
                  icon={<HistoryIcon className="size-4" />}
                >
                  <SourceControlTimelineNotice
                    tone="system"
                    title={entry.author ? `${entry.author} updated Jira` : "Jira activity"}
                    description={formatDateTime(entry.createdAt)}
                  >
                    <ul className="grid gap-1 text-xs">
                      {entry.items.map((item) => (
                        <li
                          key={`${entry.id}-${item.field}-${item.from ?? ""}-${item.to ?? ""}`}
                          className="text-muted-foreground"
                        >
                          <span className="font-medium text-foreground/80">{item.field}</span>
                          {": "}
                          {item.from ?? "None"} {"->"} {item.to ?? "None"}
                        </li>
                      ))}
                    </ul>
                  </SourceControlTimelineNotice>
                </SourceControlTimelineEntry>
              ))
            ) : (
              <SourceControlTimelineEntry tone="system" icon={<HistoryIcon className="size-4" />}>
                <SourceControlTimelineNotice
                  tone="system"
                  title="Jira activity"
                  description="No recent changelog entries returned."
                />
              </SourceControlTimelineEntry>
            )}
            {detail.comments.map((comment) => (
              <SourceControlTimelineEntry
                key={
                  comment.id ??
                  `${comment.author}-${DateTime.toDate(comment.createdAt).toISOString()}`
                }
                tone="comment"
                icon={<MessageSquareIcon className="size-4" />}
              >
                <CommentItem
                  author={comment.author}
                  body={comment.body}
                  createdAt={comment.createdAt}
                  reactions={comment.reactions}
                  itemKind="comment"
                  eyebrow={
                    comment.updatedAt ? `Edited ${formatDateTime(comment.updatedAt)}` : "Comment"
                  }
                  onQuote={() =>
                    props.onQuote({
                      author: comment.author,
                      body: comment.body,
                      createdAt: comment.createdAt,
                      contextLabel: "Jira comment",
                    })
                  }
                  actions={
                    comment.editable && comment.id ? (
                      <button
                        type="button"
                        onClick={() => props.onEditComment(comment)}
                        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Edit Jira comment"
                        title="Edit comment"
                      >
                        <PencilIcon className="size-3.5" />
                      </button>
                    ) : null
                  }
                />
              </SourceControlTimelineEntry>
            ))}
            <SourceControlTimelineEntry
              tone="composer"
              icon={<MessageSquareIcon className="size-4" />}
            >
              <CommentComposer
                placeholder="Add a Jira comment"
                submitLabel="Comment"
                disabled={props.addCommentPending}
                quoteInsertion={props.quoteInsertion}
                onQuoteInsertionHandled={props.onQuoteInsertionHandled}
                onSubmit={({ body }) => props.onAddComment(body).then(() => undefined)}
              />
            </SourceControlTimelineEntry>
          </SourceControlTimeline>
        </div>
      </div>
    </div>
  );
}

function WorkItemSidebar(props: {
  readonly detail: WorkItemDetailModel;
  readonly linkedChangeRequests: ReadonlyArray<WorkItemLinkedChangeRequest>;
  readonly linkedChangeRequestsLoading: boolean;
  readonly linkedBranches: ReadonlyArray<VcsRef>;
  readonly linkedBranchesLoading: boolean;
  readonly linkedWorktrees: ReadonlyArray<LinkedWorkItemWorktree>;
  readonly mutationPending: boolean;
  readonly onUpdate: (fields: WorkItemUpdateFields) => void;
  readonly onSelectLinkedChangeRequest?: ((number: number) => void) | undefined;
}) {
  const { detail } = props;
  const assigneeField = editableField(detail, "assignee");
  const priorityField = editableField(detail, "priority");
  const parentField = editableField(detail, "parent");
  const dueDateField = editableField(detail, "dueDate");
  const startDateField = editableField(detail, "startDate");
  const reporterField = editableField(detail, "reporter");
  const hasEditableDetails =
    assigneeField ||
    priorityField ||
    parentField ||
    dueDateField ||
    startDateField ||
    reporterField;

  return (
    <aside className="border-border/60 border-t bg-muted/12 px-4 py-4 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:border-l">
      <div className="space-y-5 text-xs">
        <section className="space-y-2">
          <h3 className="font-medium text-foreground text-sm">Jira details</h3>
          <SidebarField label="Status" value={workItemStateLabel(detail)} />
          <SidebarField label="Issue type" value={detail.issueType ?? "Work item"} />
          <SidebarField label="Assignee" value={detail.assignee ?? "Unassigned"} />
          <SidebarField label="Reporter" value={detail.reporter ?? "Unknown"} />
          <SidebarField
            label="Priority"
            value={<PriorityDisplay priority={detail.priorityDetail ?? detail.priority} />}
          />
          <SidebarField label="Parent" value={detail.parentKey ?? detail.epicKey ?? "None"} />
          <SidebarField label="Due date" value={detail.dueDate ?? "None"} />
          <SidebarField label="Start date" value={detail.startDate ?? "None"} />
          {detail.createdAt && Option.isSome(detail.createdAt) ? (
            <SidebarField
              label="Created"
              value={dateFmt.format(DateTime.toDate(detail.createdAt.value))}
            />
          ) : null}
          {detail.updatedAt && Option.isSome(detail.updatedAt) ? (
            <SidebarField
              label="Updated"
              value={dateFmt.format(DateTime.toDate(detail.updatedAt.value))}
            />
          ) : null}
        </section>

        {hasEditableDetails ? (
          <section className="space-y-2">
            <h3 className="font-medium text-foreground text-sm">Editable fields</h3>
            {assigneeField ? (
              <EditableOptionSelect
                label="Assignee"
                field={assigneeField}
                currentLabel={detail.assignee ?? "Unassigned"}
                disabled={props.mutationPending}
                valueForOption={(option) => option.accountId ?? option.id ?? option.name}
                onChange={(value) => props.onUpdate({ assigneeAccountId: value })}
                onClear={() => props.onUpdate({ assigneeAccountId: null })}
              />
            ) : null}
            {priorityField ? (
              <EditableOptionSelect
                label="Priority"
                field={priorityField}
                currentLabel={detail.priority ?? "None"}
                selectedValue={detail.priorityDetail?.id}
                disabled={props.mutationPending}
                valueForOption={(option) => option.id ?? option.name}
                renderOptionPrefix={(option) => <PriorityDisplay priority={option} compact />}
                onChange={(value) => props.onUpdate({ priorityId: value })}
                onClear={() => props.onUpdate({ priorityId: null })}
              />
            ) : null}
            {parentField ? (
              parentField.options && parentField.options.length > 0 ? (
                <EditableOptionSelect
                  label="Parent"
                  field={parentField}
                  currentLabel={detail.parentKey ?? "None"}
                  selectedValue={detail.parentKey}
                  disabled={props.mutationPending}
                  valueForOption={(option) => option.key ?? option.id ?? option.name}
                  onChange={(value) => props.onUpdate({ parentKey: value })}
                  onClear={() => props.onUpdate({ parentKey: null })}
                />
              ) : (
                <EditableTextField
                  label="Parent"
                  value={detail.parentKey ?? ""}
                  placeholder="PROJ-123"
                  disabled={props.mutationPending}
                  onSave={(value) => props.onUpdate({ parentKey: value.trim() || null })}
                />
              )
            ) : null}
            {dueDateField ? (
              <EditableTextField
                label="Due date"
                type="date"
                value={detail.dueDate ?? ""}
                disabled={props.mutationPending}
                onSave={(value) => props.onUpdate({ dueDate: value.trim() || null })}
              />
            ) : null}
            {startDateField ? (
              <EditableTextField
                label="Start date"
                type="date"
                value={detail.startDate ?? ""}
                disabled={props.mutationPending}
                onSave={(value) => props.onUpdate({ startDate: value.trim() || null })}
              />
            ) : null}
            {reporterField ? (
              <EditableOptionSelect
                label="Reporter"
                field={reporterField}
                currentLabel={detail.reporter ?? "Unknown"}
                disabled={props.mutationPending}
                valueForOption={(option) => option.accountId ?? option.id ?? option.name}
                onChange={(value) => props.onUpdate({ reporterAccountId: value })}
                onClear={() => props.onUpdate({ reporterAccountId: null })}
              />
            ) : null}
          </section>
        ) : (
          <section className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-muted-foreground">
            Jira did not expose editable fields for this issue.
          </section>
        )}

        {detail.labels && detail.labels.length > 0 ? (
          <section>
            <div className="mb-2 text-muted-foreground">Labels</div>
            <div className="flex flex-wrap gap-1">
              {detail.labels.map((label) => (
                <LabelChip key={label} label={label} />
              ))}
            </div>
          </section>
        ) : null}

        <LinkedLocalWorkItemSection
          branches={props.linkedBranches}
          branchesLoading={props.linkedBranchesLoading}
          worktrees={props.linkedWorktrees}
        />
        <LinkedPullRequestsSection
          loading={props.linkedChangeRequestsLoading}
          items={props.linkedChangeRequests}
          onSelect={props.onSelectLinkedChangeRequest}
        />
      </div>
    </aside>
  );
}

function SidebarField(props: { readonly label: string; readonly value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-muted-foreground">{props.label}</div>
      <div className="min-w-0 truncate font-medium text-foreground">{props.value}</div>
    </div>
  );
}

function EditableOptionSelect(props: {
  readonly label: string;
  readonly field: WorkItemEditableFieldMetadata;
  readonly currentLabel: string;
  readonly selectedValue?: string | undefined;
  readonly disabled: boolean;
  readonly valueForOption: (option: WorkItemEditableFieldOption) => string;
  readonly renderOptionPrefix?: ((option: WorkItemEditableFieldOption) => ReactNode) | undefined;
  readonly onChange: (value: string) => void;
  readonly onClear: () => void;
}) {
  const options = props.field.options ?? [];
  if (options.length === 0) {
    return <SidebarField label={props.label} value={props.currentLabel} />;
  }
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground">{props.label}</div>
      <Select
        value={props.selectedValue ?? ""}
        onValueChange={(value) => {
          if (typeof value !== "string") return;
          if (value === NONE_VALUE) props.onClear();
          else props.onChange(value);
        }}
      >
        <SelectTrigger size="sm" disabled={props.disabled} className="w-full">
          <SelectValue placeholder={props.currentLabel} />
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value={NONE_VALUE}>None</SelectItem>
          {options.map((option) => {
            const value = props.valueForOption(option);
            return (
              <SelectItem key={`${props.field.id}:${value}`} value={value}>
                <span className="inline-flex min-w-0 items-center gap-2">
                  {props.renderOptionPrefix?.(option)}
                  <span className="truncate">{option.displayName ?? option.name}</span>
                </span>
              </SelectItem>
            );
          })}
        </SelectPopup>
      </Select>
    </div>
  );
}

function EditableTextField(props: {
  readonly label: string;
  readonly value: string;
  readonly type?: "text" | "date" | undefined;
  readonly placeholder?: string | undefined;
  readonly disabled: boolean;
  readonly onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => {
    setDraft(props.value);
  }, [props.value]);
  const dirty = draft !== props.value;
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground">{props.label}</div>
      <div className="flex items-center gap-1.5">
        <Input
          type={props.type ?? "text"}
          size="sm"
          value={draft}
          disabled={props.disabled}
          placeholder={props.placeholder}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        {dirty ? (
          <Button
            type="button"
            size="sm"
            className="h-8 px-2"
            disabled={props.disabled}
            onClick={() => props.onSave(draft)}
          >
            Save
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function LinkedLocalWorkItemSection(props: {
  readonly branches: ReadonlyArray<VcsRef>;
  readonly branchesLoading: boolean;
  readonly worktrees: ReadonlyArray<LinkedWorkItemWorktree>;
}) {
  const hasLinks = props.branches.length > 0 || props.worktrees.length > 0;
  return (
    <section>
      <div className="mb-2 text-muted-foreground">Local links</div>
      {props.branchesLoading && !hasLinks ? (
        <span className="text-muted-foreground/70 text-xs italic">Checking...</span>
      ) : hasLinks ? (
        <div className="grid gap-2">
          {props.branches.length > 0 ? (
            <div className="grid gap-1">
              {props.branches.map((branch) => (
                <span
                  key={branch.name}
                  className="flex min-w-0 items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-1.5"
                  title={branch.worktreePath ?? branch.name}
                >
                  <GitBranchIcon className="size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate font-mono text-[11px]">{branch.name}</span>
                </span>
              ))}
            </div>
          ) : null}
          {props.worktrees.length > 0 ? (
            <div className="grid gap-1">
              {props.worktrees.map((worktree) => (
                <span
                  key={worktree.id}
                  className="flex min-w-0 items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-1.5"
                  title={worktree.worktreePath ?? worktree.branch}
                >
                  <AtlassianJiraIcon className="size-3 shrink-0" />
                  <span className="min-w-0 truncate font-mono text-[11px]">{worktree.branch}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <span className="text-muted-foreground/70 text-xs italic">None found</span>
      )}
    </section>
  );
}

function LinkedPullRequestsSection(props: {
  readonly loading: boolean;
  readonly items: ReadonlyArray<WorkItemLinkedChangeRequest>;
  readonly onSelect?: ((number: number) => void) | undefined;
}) {
  return (
    <section>
      <div className="mb-2 text-muted-foreground">Linked PRs</div>
      {props.loading ? (
        <span className="text-muted-foreground/70 text-xs italic">Searching...</span>
      ) : props.items.length > 0 ? (
        <ul className="space-y-1.5">
          {props.items.map((pr) => {
            const checkStatus = getPrCheckStatusFromChangeRequest(pr);
            return (
              <li key={pr.number}>
                <div className="flex min-w-0 items-start gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5">
                  <GitPullRequestIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                  <button
                    type="button"
                    onClick={() => props.onSelect?.(pr.number)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-foreground text-xs">
                      #{pr.number} {pr.title}
                    </span>
                    <span className="mt-1 flex items-center gap-1 text-muted-foreground text-[10px] capitalize">
                      {pr.state}
                      <PrCheckStatusBadge view={checkStatus} mode="compact" />
                    </span>
                  </button>
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 text-muted-foreground hover:text-foreground"
                    title="Open pull request"
                  >
                    <ExternalLinkIcon className="size-3" />
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <span className="text-muted-foreground/70 text-xs italic">None found</span>
      )}
    </section>
  );
}

function EditCommentDialog(props: {
  readonly comment: WorkItemComment;
  readonly pending: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: (body: string) => void;
}) {
  const [body, setBody] = useState(props.comment.body);
  useEffect(() => {
    setBody(props.comment.body);
  }, [props.comment.body]);
  return (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogPopup className="w-full max-w-xl p-0">
        <DialogHeader className="border-border/60 border-b px-5 py-3">
          <DialogTitle className="text-base">Edit Jira comment</DialogTitle>
          <DialogDescription className="text-xs">
            Review changes before saving them to Jira.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="px-5 py-4">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.currentTarget.value)}
            className="min-h-40 text-sm"
          />
        </DialogPanel>
        <DialogFooter className="border-border/60 border-t px-5 py-3">
          <Button
            variant="outline"
            disabled={props.pending}
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={props.pending || body.trim().length === 0}
            onClick={() => props.onSave(body)}
          >
            {props.pending ? <Spinner className="size-3.5" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ImproveDescriptionDialog(props: {
  readonly open: boolean;
  readonly detail: WorkItemDetailModel;
  readonly generatePending: boolean;
  readonly savePending: boolean;
  readonly generateError: unknown;
  readonly onOpenChange: (open: boolean) => void;
  readonly onGenerate: (input: {
    readonly rough: string;
    readonly instructions: string;
  }) => Promise<{ readonly body?: string | undefined }>;
  readonly onSave: (description: string) => void;
}) {
  const [instructions, setInstructions] = useState("");
  const [draft, setDraft] = useState(props.detail.description);
  useEffect(() => {
    if (props.open) setDraft(props.detail.description);
  }, [props.detail.description, props.open]);
  const generate = async () => {
    const result = await props.onGenerate({
      rough: props.detail.description,
      instructions,
    });
    if (result.body !== undefined) setDraft(result.body);
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="flex max-h-[82vh] w-full max-w-2xl flex-col p-0">
        <DialogHeader className="border-border/60 border-b px-5 py-3">
          <DialogTitle className="text-base">Improve Jira description with AI</DialogTitle>
          <DialogDescription className="text-xs">
            Generate a draft, review it, then save it to Jira.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <Input
            value={instructions}
            onChange={(event) => setInstructions(event.currentTarget.value)}
            placeholder='Optional guidance, e.g. "make acceptance criteria explicit"'
            className="h-8 text-xs"
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={props.generatePending || props.savePending}
              onClick={() => void generate()}
            >
              {props.generatePending ? (
                <Spinner className="size-3.5" />
              ) : (
                <SparklesIcon className="size-3.5" />
              )}
              Generate draft
            </Button>
          </div>
          {props.generateError ? (
            <p className="text-destructive text-xs">
              {props.generateError instanceof Error
                ? props.generateError.message
                : "AI draft generation failed."}
            </p>
          ) : null}
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            className="min-h-72 text-sm"
          />
        </DialogPanel>
        <DialogFooter className="border-border/60 border-t px-5 py-3">
          <Button
            variant="outline"
            disabled={props.generatePending || props.savePending}
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={props.generatePending || props.savePending}
            onClick={() => props.onSave(draft)}
          >
            {props.savePending ? <Spinner className="size-3.5" /> : null}
            Save to Jira
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function editableField(
  detail: WorkItemDetailModel,
  id: WorkItemEditableFieldId,
): WorkItemEditableFieldMetadata | null {
  return detail.editableFields.find((field) => field.id === id) ?? null;
}

function PriorityDisplay(props: {
  readonly priority: WorkItemPriority | WorkItemEditableFieldOption | string | undefined;
  readonly compact?: boolean | undefined;
}) {
  const priority =
    typeof props.priority === "string"
      ? { name: props.priority }
      : props.priority && "name" in props.priority
        ? props.priority
        : undefined;
  if (!priority) return <span>None</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <PriorityIcon priority={priority} />
      {props.compact ? null : <span className="truncate">{priority.name}</span>}
    </span>
  );
}

function PriorityIcon(props: { readonly priority: Pick<WorkItemPriority, "iconUrl" | "name"> }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (props.priority.iconUrl && !imageFailed) {
    return (
      <img
        src={props.priority.iconUrl}
        alt=""
        className="size-3.5 shrink-0"
        loading="lazy"
        decoding="async"
        onError={() => setImageFailed(true)}
      />
    );
  }
  const normalized = props.priority.name.toLowerCase();
  if (normalized.includes("highest") || normalized.includes("blocker")) {
    return <ChevronsUpIcon className="size-3.5 shrink-0 text-rose-500" />;
  }
  if (
    normalized.includes("high") ||
    normalized.includes("major") ||
    normalized.includes("critical")
  ) {
    return <ArrowUpIcon className="size-3.5 shrink-0 text-orange-500" />;
  }
  if (normalized.includes("low") || normalized.includes("minor")) {
    return <ArrowDownIcon className="size-3.5 shrink-0 text-sky-500" />;
  }
  if (normalized.includes("lowest") || normalized.includes("trivial")) {
    return <ChevronsDownIcon className="size-3.5 shrink-0 text-slate-500" />;
  }
  return <MinusIcon className="size-3.5 shrink-0 text-muted-foreground" />;
}

function workItemStateBadgeKind(state: WorkItemDetailModel["state"]): StateBadgeKind {
  if (state === "done" || state === "closed") return "issue-closed";
  if (state === "unknown") return "issue-unknown";
  return "issue-open";
}

function formatOptionDate(value: Option.Option<DateTime.Utc>): string | null {
  return Option.isSome(value) ? dateFmt.format(DateTime.toDate(value.value)) : null;
}

function formatDateTime(value: DateTime.Utc): string {
  return dateTimeFmt.format(DateTime.toDate(value));
}
