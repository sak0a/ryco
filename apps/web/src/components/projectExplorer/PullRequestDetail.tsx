import type {
  EnvironmentId,
  SourceControlCommentReactionContent,
  SourceControlChangeRequestCommit,
  SourceControlChangeRequestDetail,
  SourceControlChangeRequestFile,
} from "@ryco/contracts";
import { DateTime, Option } from "effect";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ChevronRightIcon,
  Clock3Icon,
  ExternalLinkIcon,
  FileIcon,
  FileTextIcon,
  GitBranchIcon,
  GitCommitIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  SendIcon,
} from "lucide-react";
import {
  changeRequestDetailQueryOptions,
  changeRequestDiffQueryOptions,
  useAddChangeRequestCommentMutation,
  useAddChangeRequestCommentReactionMutation,
  workflowRunsQueryOptions,
} from "~/lib/sourceControlContextRpc";
import { cn } from "~/lib/utils";
import { ContextPickerTabs } from "../chat/ContextPickerTabs";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { CommentComposer, CommentItem, type CommentQuoteInsertion } from "./CommentThread";
import { buildCommentQuoteMarkdown, deriveOriginalPostAuthorRole } from "./CommentThread.logic";
import { PrCheckStatusBadge } from "./PrCheckStatusBadge";
import {
  SourceControlDetailErrorState,
  SourceControlDetailLayout,
  SourceControlDetailLoadingState,
  SourceControlDetailToolbar,
} from "./SourceControlDetailLayout";
import {
  SourceControlTimeline,
  SourceControlTimelineEntry,
  SourceControlTimelineNotice,
} from "./SourceControlTimeline";
import { changeRequestStateKind, StateBadge } from "./StateBadge";
import { type DiffLine, parseDiffLines } from "./diffLines";
import {
  getPrCheckStatusForQuery,
  getPrCheckStatusFromChangeRequest,
  getPrCheckStatusFromWorkflowRuns,
  shouldRefreshPrCheckStatus,
} from "./prCheckStatus";
import { splitUnifiedDiffByFile } from "./unifiedDiffSplit";
import { usePrCheckPassNotifications } from "./usePrCheckPassNotifications";
import { WorktreeItemSidebar } from "./WorktreeItemSidebar";
import { WorkflowRunsSection } from "./WorkflowRunsSection";

const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const compactDateTimeFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const numberFmt = new Intl.NumberFormat(undefined);
const MAX_TIMELINE_COMMIT_ROWS = 12;

type PullRequestTab = "conversation" | "checks" | "commits" | "files";

interface PullRequestDetailProps {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  pullRequestNumber: number;
  onBack: () => void;
  onSelectLinkedIssue: (issueNumber: number) => void;
  onSelectLinkedWorkItem?: ((workItemKey: string) => void) | undefined;
  onAttach?: ((mode: "local" | "worktree") => Promise<void> | void) | undefined;
  attachInProgress?: "local" | "worktree" | null;
}

export function PullRequestDetail(props: PullRequestDetailProps) {
  const reference = String(props.pullRequestNumber);
  const detailQuery = useQuery(
    changeRequestDetailQueryOptions({
      environmentId: props.environmentId,
      cwd: props.cwd,
      reference,
      fullContent: true,
    }),
  );
  const addCommentMutation = useAddChangeRequestCommentMutation({
    environmentId: props.environmentId,
    cwd: props.cwd,
    reference,
  });
  const addReactionMutation = useAddChangeRequestCommentReactionMutation({
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
          <SourceControlDetailLoadingState label="pull request" />
        ) : detailQuery.isError ? (
          <SourceControlDetailErrorState
            message={
              detailQuery.error instanceof Error ? detailQuery.error.message : "Failed to load."
            }
          />
        ) : detail ? (
          <PullRequestDetailBody
            detail={detail}
            environmentId={props.environmentId}
            cwd={props.cwd}
            onSelectLinkedIssue={props.onSelectLinkedIssue}
            onSelectLinkedWorkItem={props.onSelectLinkedWorkItem}
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
            Check out this pull request in a chat thread
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

function PullRequestDetailBody(props: {
  detail: SourceControlChangeRequestDetail;
  environmentId: EnvironmentId | null;
  cwd: string | null;
  onSelectLinkedIssue: (issueNumber: number) => void;
  onSelectLinkedWorkItem?: ((workItemKey: string) => void) | undefined;
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
  const [activeTab, setActiveTab] = useState<PullRequestTab>("conversation");
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

  const opCreatedAt =
    detail.updatedAt && Option.isSome(detail.updatedAt)
      ? detail.updatedAt.value
      : DateTime.fromDateUnsafe(new Date());
  const opAuthorRole = deriveOriginalPostAuthorRole(detail);

  const conversationCount = detail.comments.length + 1;
  const checkCount = detail.checkRollup?.length ?? 0;
  const commitCount = detail.commits?.length ?? 0;
  const fileCount = detail.changedFiles ?? detail.files?.length ?? 0;
  const additions = detail.additions ?? 0;
  const deletions = detail.deletions ?? 0;
  const updatedLabel =
    detail.updatedAt && Option.isSome(detail.updatedAt)
      ? dateFmt.format(DateTime.toDate(detail.updatedAt.value))
      : null;
  const reviewersCount = detail.reviewers?.length ?? 0;
  const checkStatus = getPrCheckStatusFromChangeRequest(detail);
  const onSubmitComment = props.onSubmitComment;
  const canComment = onSubmitComment !== undefined;
  const onAddCommentReaction = props.onAddCommentReaction;

  usePrCheckPassNotifications([
    {
      environmentId: props.environmentId,
      cwd: props.cwd,
      provider: detail.provider,
      number: detail.number,
      title: detail.title,
      url: detail.url,
      status: checkStatus,
    },
  ]);

  return (
    <SourceControlDetailLayout
      sidebar={
        <WorktreeItemSidebar
          assignees={detail.assignees}
          labels={detail.labels}
          reviewers={detail.reviewers ?? []}
          linkedIssueNumbers={detail.linkedIssueNumbers ?? []}
          linkedWorkItemKeys={detail.linkedWorkItemKeys ?? []}
          onSelectLinkedIssue={props.onSelectLinkedIssue}
          onSelectLinkedWorkItem={props.onSelectLinkedWorkItem}
        />
      }
    >
      <div className="flex min-h-0 flex-col lg:h-full">
        <header className="border-border/60 border-b bg-background px-5 py-4 lg:px-6">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-balance font-heading font-semibold text-xl leading-tight lg:text-2xl">
                {detail.title}{" "}
                <span className="font-normal text-muted-foreground">#{detail.number}</span>
              </h2>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
                {detail.author ? <span>Opened by {detail.author}</span> : <span>Opened</span>}
                {updatedLabel ? <span>Updated {updatedLabel}</span> : null}
                <span className="inline-flex min-w-0 items-center gap-1">
                  <GitBranchIcon className="size-3 shrink-0" />
                  <span className="truncate font-mono">
                    {detail.headRefName} → {detail.baseRefName}
                  </span>
                </span>
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <DiffStatsBadge additions={additions} deletions={deletions} />
              <PrCheckStatusBadge
                view={checkStatus}
                mode="compact"
                onClick={() => setActiveTab("checks")}
                title={
                  checkStatus.kind === "failed"
                    ? "Open failed check details"
                    : "Open pull request checks"
                }
              />
              <StateBadge kind={changeRequestStateKind(detail.state, detail.isDraft)} />
            </div>
          </div>
        </header>

        <ContextPickerTabs
          tabs={[
            { id: "conversation", label: "Conversation", count: conversationCount },
            { id: "checks", label: "Checks", count: checkCount },
            { id: "commits", label: "Commits", count: commitCount },
            { id: "files", label: "Files changed", count: fileCount },
          ]}
          activeId={activeTab}
          onSelect={(id) => setActiveTab(id as PullRequestTab)}
        />

        <div
          className={cn(
            "min-h-0 bg-muted/8 lg:flex-1",
            activeTab === "checks"
              ? "overflow-hidden"
              : "overflow-visible px-4 py-5 sm:px-5 lg:overflow-y-auto lg:px-6",
          )}
        >
          {activeTab === "conversation" ? (
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
                              contextLabel: "pull request description",
                            })
                        : undefined
                    }
                  />
                </SourceControlTimelineEntry>
                <SourceControlTimelineEntry
                  tone="workflow"
                  icon={<GitBranchIcon className="size-4" />}
                >
                  <SourceControlTimelineNotice
                    tone="workflow"
                    title="Workflow overview"
                    description={`${commitCount} commits · ${fileCount} files changed`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <StateBadge kind={changeRequestStateKind(detail.state, detail.isDraft)} />
                      <DiffStatsBadge additions={additions} deletions={deletions} />
                      <PrCheckStatusBadge
                        view={checkStatus}
                        mode="compact"
                        onClick={() => setActiveTab("checks")}
                        title="Open pull request checks"
                      />
                      <span className="rounded-md border border-border/60 bg-background/70 px-2 py-0.5 text-muted-foreground text-xs">
                        {reviewersCount === 1 ? "1 reviewer" : `${reviewersCount} reviewers`}
                      </span>
                    </div>
                  </SourceControlTimelineNotice>
                </SourceControlTimelineEntry>
                {detail.commits && detail.commits.length > 0 ? (
                  <SourceControlTimelineEntry
                    tone="commit"
                    icon={<GitCommitIcon className="size-4" />}
                  >
                    <PullRequestTimelineCommits
                      commits={detail.commits}
                      provider={detail.provider}
                      environmentId={props.environmentId}
                      cwd={props.cwd}
                      pullRequestUrl={detail.url}
                      onOpenCommits={() => setActiveTab("commits")}
                    />
                  </SourceControlTimelineEntry>
                ) : null}
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
                                  contextLabel: "PR conversation",
                                })
                            : undefined
                        }
                      />
                    </SourceControlTimelineEntry>
                  );
                })}
                {onSubmitComment ? (
                  <SourceControlTimelineEntry
                    tone="composer"
                    icon={<SendIcon className="size-4" />}
                  >
                    <CommentComposer
                      placeholder="Write a conversation comment"
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
          ) : activeTab === "checks" ? (
            <WorkflowRunsSection
              environmentId={props.environmentId}
              cwd={props.cwd}
              pullRequestNumber={detail.number}
              title="Checks"
              description="GitHub Actions workflow runs for this pull request head commit."
            />
          ) : activeTab === "commits" ? (
            <div className="mx-auto w-full max-w-[1100px]">
              <CommitsTab commits={detail.commits ?? []} pullRequestUrl={detail.url} />
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[1180px]">
              <FilesTab
                files={detail.files ?? []}
                environmentId={props.environmentId}
                cwd={props.cwd}
                reference={String(detail.number)}
                active={activeTab === "files"}
              />
            </div>
          )}
        </div>
      </div>
    </SourceControlDetailLayout>
  );
}

function DiffStatsBadge({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions === 0 && deletions === 0) return null;
  return (
    <span
      className="mt-1 inline-flex shrink-0 items-baseline gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[11px] tabular-nums"
      aria-label={`Diff: ${additions} additions, ${deletions} deletions`}
    >
      <span className="text-emerald-600 dark:text-emerald-400">+{numberFmt.format(additions)}</span>
      <span className="text-rose-600 dark:text-rose-400">−{numberFmt.format(deletions)}</span>
    </span>
  );
}

function formatCommitDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return compactDateTimeFmt.format(date);
}

function PullRequestTimelineCommits(props: {
  commits: ReadonlyArray<SourceControlChangeRequestCommit>;
  provider: SourceControlChangeRequestDetail["provider"];
  environmentId: EnvironmentId | null;
  cwd: string | null;
  pullRequestUrl: string;
  onOpenCommits: () => void;
}) {
  const commits =
    props.commits.length > MAX_TIMELINE_COMMIT_ROWS
      ? props.commits.slice(-MAX_TIMELINE_COMMIT_ROWS)
      : props.commits;
  const hiddenCount = props.commits.length - commits.length;
  const commitLabel = props.commits.length === 1 ? "1 commit" : `${props.commits.length} commits`;

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-background/80 text-sm">
      <header className="flex flex-wrap items-center gap-2 border-border/60 border-b px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-foreground/90 text-sm">Commits</h3>
          <p className="mt-0.5 text-muted-foreground text-xs">
            {hiddenCount > 0
              ? `Latest ${commits.length} of ${commitLabel}`
              : `${commitLabel} in this pull request`}
          </p>
        </div>
        {hiddenCount > 0 ? (
          <Button type="button" size="sm" variant="ghost" onClick={props.onOpenCommits}>
            View all
          </Button>
        ) : null}
      </header>
      <ol className="divide-y divide-border/50">
        {commits.map((commit) => (
          <PullRequestTimelineCommitRow
            key={commit.oid}
            commit={commit}
            provider={props.provider}
            environmentId={props.environmentId}
            cwd={props.cwd}
            pullRequestUrl={props.pullRequestUrl}
          />
        ))}
      </ol>
    </section>
  );
}

function PullRequestTimelineCommitRow(props: {
  commit: SourceControlChangeRequestCommit;
  provider: SourceControlChangeRequestDetail["provider"];
  environmentId: EnvironmentId | null;
  cwd: string | null;
  pullRequestUrl: string;
}) {
  const runsQuery = useQuery({
    ...workflowRunsQueryOptions({
      environmentId: props.environmentId,
      cwd: props.cwd,
      commitSha: props.commit.oid,
      limit: 20,
      enabled: props.provider === "github",
    }),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const status = getPrCheckStatusFromWorkflowRuns({
        runs: data.runs,
        headSha: props.commit.oid,
      });
      return shouldRefreshPrCheckStatus(status) ? 30_000 : false;
    },
  });
  const status = getPrCheckStatusForQuery({
    isLoading: runsQuery.isLoading,
    error: runsQuery.error,
    status: runsQuery.data
      ? getPrCheckStatusFromWorkflowRuns({
          runs: runsQuery.data.runs,
          headSha: props.commit.oid,
        })
      : null,
  });
  const runCount = runsQuery.data?.runs.length ?? null;
  const committedAt = formatCommitDate(props.commit.committedDate);

  return (
    <li className="flex min-w-0 items-start gap-3 bg-muted/10 px-3 py-2.5 text-xs">
      <code className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
        {props.commit.shortOid}
      </code>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 flex-1 truncate font-medium text-foreground/90">
            {props.commit.messageHeadline || "No commit message"}
          </span>
          <PrCheckStatusBadge view={status} mode="compact" />
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-[11px]">
          {props.commit.author ? <span>{props.commit.author}</span> : null}
          {committedAt ? (
            <span className="inline-flex items-center gap-1">
              <Clock3Icon className="size-3" />
              {committedAt}
            </span>
          ) : null}
          {runCount !== null ? <span>{runCount === 1 ? "1 run" : `${runCount} runs`}</span> : null}
        </div>
      </div>
      <a
        href={`${props.pullRequestUrl}/changes/${props.commit.oid}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-secondary hover:text-foreground"
        aria-label={`Open commit ${props.commit.shortOid}`}
        title={`Open commit ${props.commit.shortOid}`}
      >
        <ExternalLinkIcon className="size-3.5" />
      </a>
    </li>
  );
}

function CommitsTab({
  commits,
  pullRequestUrl,
}: {
  commits: ReadonlyArray<SourceControlChangeRequestCommit>;
  pullRequestUrl: string;
}) {
  if (commits.length === 0) {
    return <EmptyTabState message="No commits to show." />;
  }
  return (
    <ol className="overflow-hidden rounded-lg border border-border/60 divide-y divide-border/60">
      {commits.map((commit) => (
        <li key={commit.oid} className="flex items-center gap-3 bg-muted/12 px-3 py-2 text-xs">
          <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {commit.shortOid}
          </code>
          <span className="min-w-0 flex-1 truncate text-foreground/90">
            {commit.messageHeadline}
          </span>
          {commit.author ? (
            <span className="shrink-0 text-muted-foreground">{commit.author}</span>
          ) : null}
          <a
            href={`${pullRequestUrl}/changes/${commit.oid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-secondary hover:text-foreground"
            aria-label={`Open commit ${commit.shortOid} on GitHub`}
            title={`Open commit ${commit.shortOid} on GitHub`}
          >
            <ExternalLinkIcon className="size-3.5" />
          </a>
        </li>
      ))}
    </ol>
  );
}

function FilesTab(props: {
  files: ReadonlyArray<SourceControlChangeRequestFile>;
  environmentId: EnvironmentId | null;
  cwd: string | null;
  reference: string;
  active: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const anyExpanded = expanded.size > 0;
  const diffQuery = useQuery({
    ...changeRequestDiffQueryOptions({
      environmentId: props.environmentId,
      cwd: props.cwd,
      reference: props.reference,
    }),
    enabled:
      props.active &&
      anyExpanded &&
      props.environmentId !== null &&
      props.cwd !== null &&
      props.reference !== "",
  });

  const diffByPath = useMemo(
    () => (diffQuery.data ? splitUnifiedDiffByFile(diffQuery.data) : null),
    [diffQuery.data],
  );

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  if (props.files.length === 0) {
    return <EmptyTabState message="No file change information available." />;
  }

  return (
    <ol className="overflow-hidden rounded-lg border border-border/60 divide-y divide-border/60">
      {props.files.map((file) => {
        const isOpen = expanded.has(file.path);
        const filePatch = diffByPath?.get(file.path) ?? null;
        return (
          <li key={file.path} className="bg-muted/12">
            <button
              type="button"
              onClick={() => toggle(file.path)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-xs hover:bg-accent/40"
            >
              <ChevronRightIcon
                className={cn(
                  "size-3 shrink-0 text-muted-foreground/60 transition-transform duration-150",
                  isOpen ? "rotate-90" : "",
                )}
              />
              <FileIcon className="size-3 shrink-0 text-muted-foreground/70" />
              <span className="min-w-0 flex-1 truncate font-mono text-foreground/90">
                {file.path}
              </span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums">
                <span className="text-emerald-600 dark:text-emerald-400">
                  +{numberFmt.format(file.additions)}
                </span>
                <span className="text-muted-foreground/60"> / </span>
                <span className="text-rose-600 dark:text-rose-400">
                  −{numberFmt.format(file.deletions)}
                </span>
              </span>
            </button>
            {isOpen ? (
              <FileDiffViewer
                patch={filePatch}
                isLoading={diffQuery.isLoading || diffQuery.isFetching}
                error={diffQuery.error instanceof Error ? diffQuery.error.message : null}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function FileDiffViewer(props: { patch: string | null; isLoading: boolean; error: string | null }) {
  if (props.isLoading && props.patch === null) {
    return (
      <div className="flex items-center gap-2 border-border/60 border-t bg-background/40 px-3 py-2 text-muted-foreground text-xs">
        <Spinner className="size-3" />
        Loading diff…
      </div>
    );
  }
  if (props.error !== null) {
    return (
      <div className="border-border/60 border-t bg-background/40 px-3 py-2 text-destructive text-xs">
        {props.error}
      </div>
    );
  }

  const parsedLines = props.patch ? parseDiffLines(props.patch) : [];
  if (parsedLines.length === 0) {
    return (
      <div className="border-border/60 border-t bg-background/40 px-3 py-2 text-muted-foreground/70 text-xs italic">
        No diff available for this file.
      </div>
    );
  }
  const maxLine = parsedLines.reduce((max, line) => {
    const n = Math.max(line.oldLineNumber ?? 0, line.newLineNumber ?? 0);
    return n > max ? n : max;
  }, 0);
  const gutterDigits = Math.max(2, String(maxLine).length);
  const gutterCh = `${gutterDigits}ch`;
  return (
    <div className="overflow-x-auto border-border/60 border-t bg-background/40">
      <pre className="font-mono text-[11px] leading-snug">
        {parsedLines.map((line, index) => (
          <DiffLineRow
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            line={line}
            gutterCh={gutterCh}
          />
        ))}
      </pre>
    </div>
  );
}

function DiffLineRow({ line, gutterCh }: { line: DiffLine; gutterCh: string }) {
  const tone = lineToneForKind(line.kind);
  const oldText = line.oldLineNumber === null ? "" : String(line.oldLineNumber);
  const newText = line.newLineNumber === null ? "" : String(line.newLineNumber);
  return (
    <div className={cn("flex whitespace-pre", tone)}>
      <span
        className="shrink-0 select-none border-border/40 border-r bg-muted/24 px-1.5 text-right text-muted-foreground/60"
        style={{ width: gutterCh }}
      >
        {oldText}
      </span>
      <span
        className="shrink-0 select-none border-border/40 border-r bg-muted/16 px-1.5 text-right text-muted-foreground/60"
        style={{ width: gutterCh }}
      >
        {newText}
      </span>
      <span className="min-w-0 flex-1 px-2">{line.text === "" ? " " : line.text}</span>
    </div>
  );
}

function lineToneForKind(kind: DiffLine["kind"]): string {
  if (kind === "hunk") {
    return "bg-sky-500/8 text-sky-700 dark:text-sky-400";
  }
  if (kind === "add") {
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (kind === "remove") {
    return "bg-rose-500/10 text-rose-700 dark:text-rose-300";
  }
  return "text-foreground/80";
}

function EmptyTabState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground/70 text-sm">
      <MessagesSquareIcon className="size-6 opacity-40" />
      {message}
    </div>
  );
}
