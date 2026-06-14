import type {
  EnvironmentId,
  SourceControlCommentReactionContent,
  SourceControlIssueDetail,
} from "@ryco/contracts";
import { DateTime, Option } from "effect";
import { useCallback, useRef, useState } from "react";
import { CircleDotIcon, FileTextIcon, MessageSquareIcon, SendIcon } from "lucide-react";
import { errorMessage } from "~/lib/errorMessage";
import {
  useAddIssueCommentMutation,
  useAddIssueCommentReactionMutation,
  useSourceControlIssueDetail,
} from "~/rpc/useSourceControl";
import { Button } from "../ui/button";
import { CommentComposer, CommentItem, type CommentQuoteInsertion } from "./CommentThread";
import { buildCommentQuoteMarkdown, deriveOriginalPostAuthorRole } from "./CommentThread.logic";
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
import { StateBadge } from "./StateBadge";
import { WorktreeItemSidebar } from "./WorktreeItemSidebar";

const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "long",
  day: "numeric",
});

interface IssueDetailProps {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  issueNumber: number;
  onBack: () => void;
  onSelectLinkedChangeRequest?: ((number: number) => void) | undefined;
  onAttach?: ((mode: "local" | "worktree") => Promise<void> | void) | undefined;
  attachInProgress?: "local" | "worktree" | null;
  attachLabel?: string;
}

export function IssueDetail(props: IssueDetailProps) {
  const reference = String(props.issueNumber);
  const detailQuery = useSourceControlIssueDetail({
    environmentId: props.environmentId,
    cwd: props.cwd,
    reference,
    fullContent: true,
  });
  const addCommentMutation = useAddIssueCommentMutation({
    environmentId: props.environmentId,
    cwd: props.cwd,
    reference,
  });
  const addReactionMutation = useAddIssueCommentReactionMutation({
    environmentId: props.environmentId,
    cwd: props.cwd,
    reference,
  });

  const detail = detailQuery.data;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SourceControlDetailToolbar onBack={props.onBack} githubUrl={detail?.url} />

      <div className="min-h-0 flex-1 overflow-hidden">
        {detailQuery.isLoading ? (
          <SourceControlDetailLoadingState label="issue" />
        ) : detailQuery.error ? (
          <SourceControlDetailErrorState
            message={errorMessage(detailQuery.error, "Failed to load issue.")}
          />
        ) : detail ? (
          <IssueDetailBody
            detail={detail}
            onSelectLinkedChangeRequest={props.onSelectLinkedChangeRequest}
            onSubmitComment={
              detail.provider === "github" && props.environmentId !== null && props.cwd !== null
                ? (input) => addCommentMutation.mutateAsync(input).then(() => undefined)
                : undefined
            }
            onAddCommentReaction={
              detail.provider === "github" && props.environmentId !== null && props.cwd !== null
                ? (input) => addReactionMutation.mutateAsync(input).then(() => undefined)
                : undefined
            }
          />
        ) : null}
      </div>

      {props.onAttach ? (
        <footer className="flex items-center justify-end gap-2 border-border/60 border-t bg-muted/30 px-4 py-3">
          <span className="mr-auto text-muted-foreground text-xs">
            {props.attachLabel ?? "Open issue in a chat thread"}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!detail || props.attachInProgress !== null}
            onClick={() => props.onAttach?.("local")}
          >
            {props.attachInProgress === "local" ? "Preparing local…" : "Attach (Local)"}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!detail || props.attachInProgress !== null}
            onClick={() => props.onAttach?.("worktree")}
          >
            {props.attachInProgress === "worktree" ? "Preparing worktree…" : "Attach (Worktree)"}
          </Button>
        </footer>
      ) : null}
    </div>
  );
}

function IssueDetailBody(props: {
  detail: SourceControlIssueDetail;
  onSelectLinkedChangeRequest?: ((number: number) => void) | undefined;
  onSubmitComment?:
    | ((input: { readonly body: string; readonly clientMutationId: string }) => Promise<void>)
    | undefined;
  onAddCommentReaction?:
    | ((input: {
        readonly commentId: string;
        readonly content: SourceControlCommentReactionContent;
      }) => Promise<void>)
    | undefined;
}) {
  const { detail } = props;
  const opCreatedAt =
    detail.updatedAt && Option.isSome(detail.updatedAt)
      ? detail.updatedAt.value
      : DateTime.fromDateUnsafe(new Date());
  const opAuthorRole = deriveOriginalPostAuthorRole(detail);
  const commentsCount = detail.comments.length;
  const labelsCount = detail.labels?.length ?? 0;
  const assigneesCount = detail.assignees?.length ?? 0;
  const updatedLabel =
    detail.updatedAt && Option.isSome(detail.updatedAt)
      ? dateFmt.format(DateTime.toDate(detail.updatedAt.value))
      : null;
  const [quoteInsertion, setQuoteInsertion] = useState<CommentQuoteInsertion | null>(null);
  const nextQuoteInsertionIdRef = useRef(0);
  const queueQuoteInsertion = useCallback(
    (input: Parameters<typeof buildCommentQuoteMarkdown>[0]) => {
      nextQuoteInsertionIdRef.current += 1;
      setQuoteInsertion({
        id: nextQuoteInsertionIdRef.current,
        markdown: buildCommentQuoteMarkdown(input),
      });
    },
    [],
  );
  const handleQuoteInsertionHandled = useCallback((id: number) => {
    setQuoteInsertion((current) => (current?.id === id ? null : current));
  }, []);
  const onSubmitComment = props.onSubmitComment;
  const canComment = onSubmitComment !== undefined;
  const onAddCommentReaction = props.onAddCommentReaction;

  return (
    <SourceControlDetailLayout
      sidebar={
        <WorktreeItemSidebar
          assignees={detail.assignees}
          labels={detail.labels}
          linkedChangeRequestNumbers={detail.linkedChangeRequestNumbers ?? []}
          onSelectLinkedChangeRequest={props.onSelectLinkedChangeRequest}
        />
      }
    >
      <div className="flex min-h-0 flex-col lg:h-full">
        <header className="border-border/60 border-b bg-background/50 px-5 py-4 lg:px-6">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-balance font-heading font-semibold text-xl leading-tight lg:text-2xl">
                {detail.title}{" "}
                <span className="font-normal text-muted-foreground">#{detail.number}</span>
              </h2>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
                {detail.author ? <span>Opened by {detail.author}</span> : <span>Opened</span>}
                {updatedLabel ? <span>Updated {updatedLabel}</span> : null}
              </p>
            </div>
            <StateBadge
              kind={detail.state === "open" ? "issue-open" : "issue-closed"}
              className="mt-1"
            />
          </div>
          <SourceControlMetricStrip
            className="mt-4"
            items={[
              { label: "Conversation", value: `${commentsCount} comments` },
              { label: "Labels", value: labelsCount === 0 ? "None" : labelsCount },
              { label: "Assignees", value: assigneesCount === 0 ? "Unassigned" : assigneesCount },
              { label: "Linked PRs", value: detail.linkedChangeRequestNumbers?.length ?? 0 },
            ]}
          />
        </header>

        <div className="min-h-0 overflow-visible bg-muted/8 px-4 py-5 sm:px-5 lg:flex-1 lg:overflow-y-auto lg:px-6">
          <div className="mx-auto w-full max-w-[980px]">
            <SourceControlTimeline>
              <SourceControlTimelineEntry tone="body" icon={<FileTextIcon className="size-4" />}>
                <CommentItem
                  author={opAuthorRole.author}
                  body={detail.body}
                  createdAt={opCreatedAt}
                  authorRole={opAuthorRole.role}
                  isOriginalPost
                  itemKind="body"
                  onQuote={
                    canComment
                      ? () =>
                          queueQuoteInsertion({
                            author: opAuthorRole.author,
                            body: detail.body,
                            createdAt: opCreatedAt,
                            contextLabel: "issue description",
                          })
                      : undefined
                  }
                />
              </SourceControlTimelineEntry>
              <SourceControlTimelineEntry tone="system" icon={<CircleDotIcon className="size-4" />}>
                <SourceControlTimelineNotice
                  tone="system"
                  title="Current status"
                  description={updatedLabel ? `Updated ${updatedLabel}` : undefined}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StateBadge kind={detail.state === "open" ? "issue-open" : "issue-closed"} />
                    <span className="text-muted-foreground text-xs">
                      {commentsCount === 1 ? "1 comment" : `${commentsCount} comments`}
                    </span>
                  </div>
                </SourceControlTimelineNotice>
              </SourceControlTimelineEntry>
              {detail.comments.map((comment) => {
                const commentId = comment.id;
                return (
                  <SourceControlTimelineEntry
                    key={`${comment.author}-${comment.createdAt}-${comment.body}`}
                    tone={comment.reviewState ? "review" : "comment"}
                    icon={<MessageSquareIcon className="size-4" />}
                  >
                    <CommentItem
                      author={comment.author}
                      body={comment.body}
                      createdAt={comment.createdAt}
                      authorAssociation={comment.authorAssociation}
                      authorRole={comment.authorRole}
                      reviewState={comment.reviewState}
                      reactions={comment.reactions}
                      itemKind={comment.reviewState ? "review" : "comment"}
                      eyebrow={comment.reviewState ? "Review comment" : "Comment"}
                      onAddReaction={
                        onAddCommentReaction && commentId
                          ? (content) => onAddCommentReaction({ commentId, content })
                          : undefined
                      }
                      onQuote={
                        canComment
                          ? () =>
                              queueQuoteInsertion({
                                author: comment.author,
                                body: comment.body,
                                createdAt: comment.createdAt,
                                contextLabel: "issue comment",
                              })
                          : undefined
                      }
                    />
                  </SourceControlTimelineEntry>
                );
              })}
              {onSubmitComment ? (
                <SourceControlTimelineEntry tone="composer" icon={<SendIcon className="size-4" />}>
                  <CommentComposer
                    placeholder="Write a comment on this issue"
                    submitLabel="Comment"
                    onSubmit={onSubmitComment}
                    quoteInsertion={quoteInsertion}
                    onQuoteInsertionHandled={handleQuoteInsertionHandled}
                    className="border-emerald-500/25 bg-emerald-500/5"
                  />
                </SourceControlTimelineEntry>
              ) : null}
            </SourceControlTimeline>
          </div>
        </div>
      </div>
    </SourceControlDetailLayout>
  );
}
