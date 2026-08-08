import type {
  EnvironmentId,
  PullRequestAssociationSubject,
  PullRequestDetailResult,
  PullRequestInboxItem,
  SourceControlChangeRequestCommit,
  SourceControlChangeRequestDetail,
  SourceControlChangeRequestFile,
  SourceControlCommentReactionContent,
} from "@ryco/contracts";
import { DateTime, Option } from "effect";
import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleDashedIcon,
  CircleDotIcon,
  Clock3Icon,
  ExternalLinkIcon,
  FileCode2Icon,
  FileTextIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitMergeIcon,
  Link2Icon,
  MessageSquareIcon,
  ShieldCheckIcon,
  TagIcon,
  UserRoundIcon,
  UsersIcon,
  XCircleIcon,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import {
  useAddChangeRequestCommentMutation,
  useAddChangeRequestCommentReactionMutation,
  useSourceControlChangeRequestDiff,
} from "~/rpc/useSourceControl";
import {
  CommentComposer,
  CommentItem,
  type CommentQuoteInsertion,
} from "../projectExplorer/CommentThread";
import { buildCommentQuoteMarkdown } from "../projectExplorer/CommentThread.logic";
import { LabelChip } from "../projectExplorer/LabelChip";
import { MarkdownView } from "../projectExplorer/MarkdownView";
import { PrCheckStatusBadge } from "../projectExplorer/PrCheckStatusBadge";
import { changeRequestStateKind, StateBadge } from "../projectExplorer/StateBadge";
import { type DiffLine, parseDiffLines } from "../projectExplorer/diffLines";
import { getPrCheckStatusFromChangeRequest } from "../projectExplorer/prCheckStatus";
import { splitUnifiedDiffByFile } from "../projectExplorer/unifiedDiffSplit";
import { WorkflowRunsSection } from "../projectExplorer/WorkflowRunsSection";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";

export type PullRequestManagementTab = "conversation" | "checks" | "commits" | "files";

export interface RelatedRycoWorkCandidate {
  readonly key: string;
  readonly subject: PullRequestAssociationSubject;
  readonly label: string;
  readonly description: string;
  readonly threadId?: string | undefined;
}

interface PullRequestManagementDetailProps {
  readonly item: PullRequestInboxItem;
  readonly result: PullRequestDetailResult;
  readonly activeTab: PullRequestManagementTab;
  readonly onActiveTabChange: (tab: PullRequestManagementTab) => void;
  readonly relatedWorkCandidates: ReadonlyArray<RelatedRycoWorkCandidate>;
  readonly onAttachRelationship: (subject: PullRequestAssociationSubject) => Promise<void>;
  readonly onRemoveRelationship: (subject: PullRequestAssociationSubject) => Promise<void>;
  readonly onOpenThread: (threadId: string) => void;
  readonly onRefreshDetail: () => void;
}

const compactDateFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const numberFmt = new Intl.NumberFormat();

function formatDateTime(value: DateTime.Utc | undefined): string | null {
  return value ? compactDateFmt.format(DateTime.toDate(value)) : null;
}

function optionDate(value: Option.Option<DateTime.Utc> | undefined): DateTime.Utc | undefined {
  return value && Option.isSome(value) ? value.value : undefined;
}

function reviewLabel(detail: SourceControlChangeRequestDetail, item: PullRequestInboxItem): string {
  const disposition = detail.reviewDisposition ?? item.pullRequest.review.disposition;
  switch (disposition) {
    case "approved":
      return "Approved";
    case "changes-requested":
      return "Changes requested";
    case "review-required":
      return "Review required";
    case "reviewed":
      return "Reviewed";
    case "none":
      return "No review rule";
    case "unknown":
      return "Review unknown";
  }
}

function mergeabilityLabel(detail: SourceControlChangeRequestDetail): string {
  switch (detail.mergeability) {
    case "mergeable":
      return "Mergeable";
    case "conflicting":
      return "Conflicts";
    case "unknown":
    case undefined:
      return "Not calculated";
  }
}

function readinessFor(
  detail: SourceControlChangeRequestDetail,
  item: PullRequestInboxItem,
): {
  readonly label: string;
  readonly description: string;
  readonly tone: "success" | "warning" | "danger" | "neutral";
  readonly icon: ReactNode;
} {
  const review = detail.reviewDisposition ?? item.pullRequest.review.disposition;
  if (detail.isDraft || item.pullRequest.isDraft) {
    return {
      label: "Draft in progress",
      description: "The author has not marked this change ready for review.",
      tone: "neutral",
      icon: <CircleDashedIcon className="size-4" />,
    };
  }
  if (detail.mergeability === "conflicting") {
    return {
      label: "Resolve conflicts",
      description: "The branch cannot merge cleanly into the target branch.",
      tone: "danger",
      icon: <GitMergeIcon className="size-4" />,
    };
  }
  if (item.pullRequest.checks.status === "failing") {
    return {
      label: "Checks are blocking",
      description: `${item.pullRequest.checks.failing} failing check${item.pullRequest.checks.failing === 1 ? "" : "s"} need attention.`,
      tone: "danger",
      icon: <XCircleIcon className="size-4" />,
    };
  }
  if (review === "changes-requested") {
    return {
      label: "Changes requested",
      description: "Review feedback needs to be addressed before another pass.",
      tone: "warning",
      icon: <AlertTriangleIcon className="size-4" />,
    };
  }
  if (item.pullRequest.checks.status === "pending") {
    return {
      label: "Checks are running",
      description: "Wait for the current validation run before making a decision.",
      tone: "warning",
      icon: <Clock3Icon className="size-4" />,
    };
  }
  if (review === "review-required" || review === "none" || review === "unknown") {
    return {
      label: "Review is the next action",
      description: "The change is available for a focused review pass.",
      tone: "neutral",
      icon: <ShieldCheckIcon className="size-4" />,
    };
  }
  return {
    label: "Ready for a decision",
    description: "Known checks and review requirements are satisfied.",
    tone: "success",
    icon: <CheckCircle2Icon className="size-4" />,
  };
}

export function PullRequestManagementDetail(props: PullRequestManagementDetailProps) {
  const { detail } = props.result;
  const cwd = props.result.accessTargets[0]?.cwd ?? null;
  const environmentId = props.item.pullRequest.identity.environmentId;
  const updatedAt = formatDateTime(optionDate(detail.updatedAt));
  const checkStatus = getPrCheckStatusFromChangeRequest(detail);
  const readiness = readinessFor(detail, props.item);
  const addCommentMutation = useAddChangeRequestCommentMutation({
    environmentId,
    cwd,
    reference: String(detail.number),
  });
  const addReactionMutation = useAddChangeRequestCommentReactionMutation({
    environmentId,
    cwd,
    reference: String(detail.number),
  });
  const canComment = detail.provider === "github" && cwd !== null;

  const submitComment = useCallback(
    async (input: { readonly body: string; readonly clientMutationId: string }) => {
      await addCommentMutation.mutateAsync(input);
      props.onRefreshDetail();
    },
    [addCommentMutation, props],
  );
  const addReaction = useCallback(
    async (input: {
      readonly commentId: string;
      readonly content: SourceControlCommentReactionContent;
    }) => {
      await addReactionMutation.mutateAsync(input);
      props.onRefreshDetail();
    },
    [addReactionMutation, props],
  );

  return (
    <div className="@container/pr-detail pull-request-detail-workspace flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-border/45 border-b px-5 pt-5 pb-4 @[52rem]/pr-detail:px-7 @[52rem]/pr-detail:pt-6">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          <span className="font-medium text-foreground/68">
            {props.item.pullRequest.repository.displayName}
          </span>
          <span className="opacity-35">/</span>
          <span className="font-mono tabular-nums">#{detail.number}</span>
          <StateBadge
            kind={changeRequestStateKind(detail.state, detail.isDraft)}
            className="ml-1 px-1.5 py-0 text-[9px]"
          />
          {props.item.viewState.isUnread ? (
            <span className="ml-auto inline-flex items-center gap-1.5 text-foreground/62">
              <span className="size-1.5 rounded-full bg-sky-500" /> Updated since last view
            </span>
          ) : null}
        </div>
        <div className="mt-2.5 flex min-w-0 flex-col gap-4 @[52rem]/pr-detail:flex-row @[52rem]/pr-detail:items-start">
          <div className="min-w-0 flex-1">
            <h1 className="max-w-[52rem] text-pretty font-heading font-semibold text-[clamp(1.35rem,2.6cqi,2rem)] leading-[1.08] tracking-[-0.03em]">
              {detail.title}
            </h1>
            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <UserRoundIcon className="size-3" />
                {detail.author ?? "Unknown author"}
              </span>
              {updatedAt ? (
                <span className="inline-flex items-center gap-1.5">
                  <Clock3Icon className="size-3" /> Updated {updatedAt}
                </span>
              ) : null}
              <span className="inline-flex min-w-0 items-center gap-1.5 font-mono">
                <GitBranchIcon className="size-3 shrink-0" />
                <span className="truncate">{detail.headRefName}</span>
                <ArrowRightIcon className="size-3 shrink-0 opacity-45" />
                <span className="truncate">{detail.baseRefName}</span>
              </span>
            </div>
          </div>
          <div
            className={cn(
              "pull-request-detail-glass flex max-w-sm items-start gap-2.5 rounded-xl border px-3 py-2.5 @[52rem]/pr-detail:w-64",
              readinessTone(readiness.tone),
            )}
          >
            <span className="mt-0.5 shrink-0">{readiness.icon}</span>
            <div className="min-w-0">
              <p className="font-medium text-xs">{readiness.label}</p>
              <p className="mt-0.5 text-[10px] leading-relaxed opacity-75">
                {readiness.description}
              </p>
            </div>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/45 bg-border/35 @[40rem]/pr-detail:grid-cols-4">
          <ManagementSignal
            label="Review"
            value={reviewLabel(detail, props.item)}
            icon={<UsersIcon className="size-3.5" />}
            onClick={() => props.onActiveTabChange("conversation")}
          />
          <ManagementSignal
            label="Checks"
            value={checkStatus.shortLabel}
            icon={<ActivityIcon className="size-3.5" />}
            tone={itemCheckTone(props.item.pullRequest.checks.status)}
            onClick={() => props.onActiveTabChange("checks")}
          />
          <ManagementSignal
            label="Merge"
            value={mergeabilityLabel(detail)}
            icon={<GitMergeIcon className="size-3.5" />}
            tone={detail.mergeability === "conflicting" ? "danger" : undefined}
          />
          <ManagementSignal
            label="Scope"
            value={`${numberFmt.format(detail.changedFiles ?? detail.files?.length ?? 0)} files · +${numberFmt.format(detail.additions ?? 0)} / −${numberFmt.format(detail.deletions ?? 0)}`}
            icon={<FileCode2Icon className="size-3.5" />}
            onClick={() => props.onActiveTabChange("files")}
          />
        </div>
      </header>

      <ManagementTabs
        activeTab={props.activeTab}
        detail={detail}
        onChange={props.onActiveTabChange}
      />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {props.activeTab === "conversation" ? (
          <OverviewWorkspace
            item={props.item}
            detail={detail}
            readiness={readiness}
            relatedWorkCandidates={props.relatedWorkCandidates}
            onAttachRelationship={props.onAttachRelationship}
            onRemoveRelationship={props.onRemoveRelationship}
            onOpenThread={props.onOpenThread}
            onOpenChecks={() => props.onActiveTabChange("checks")}
            onSubmitComment={canComment ? submitComment : undefined}
            onAddReaction={canComment ? addReaction : undefined}
          />
        ) : props.activeTab === "checks" ? (
          <ChecksWorkspace
            item={props.item}
            detail={detail}
            environmentId={environmentId}
            cwd={cwd}
          />
        ) : props.activeTab === "commits" ? (
          <CommitLedger commits={detail.commits ?? []} pullRequestUrl={detail.url} />
        ) : (
          <FileReviewWorkspace
            files={detail.files ?? []}
            environmentId={environmentId}
            cwd={cwd}
            reference={String(detail.number)}
          />
        )}
      </div>
    </div>
  );
}

function readinessTone(tone: "success" | "warning" | "danger" | "neutral"): string {
  switch (tone) {
    case "success":
      return "border-emerald-500/22 text-emerald-800 dark:text-emerald-200";
    case "warning":
      return "border-amber-500/22 text-amber-800 dark:text-amber-200";
    case "danger":
      return "border-rose-500/25 text-rose-800 dark:text-rose-200";
    case "neutral":
      return "border-border/55 text-foreground/78";
  }
}

function itemCheckTone(
  status: PullRequestInboxItem["pullRequest"]["checks"]["status"],
): "success" | "warning" | "danger" | undefined {
  if (status === "passing") return "success";
  if (status === "pending") return "warning";
  if (status === "failing") return "danger";
  return undefined;
}

function ManagementSignal(props: {
  readonly label: string;
  readonly value: string;
  readonly icon: ReactNode;
  readonly tone?: "success" | "warning" | "danger" | undefined;
  readonly onClick?: (() => void) | undefined;
}) {
  const content = (
    <>
      <span className="text-muted-foreground/65">{props.icon}</span>
      <span className="min-w-0">
        <span className="block text-[9px] text-muted-foreground">{props.label}</span>
        <span
          className={cn(
            "mt-0.5 block truncate font-medium text-[11px]",
            props.tone === "success"
              ? "text-emerald-700 dark:text-emerald-300"
              : props.tone === "warning"
                ? "text-amber-700 dark:text-amber-300"
                : props.tone === "danger"
                  ? "text-rose-700 dark:text-rose-300"
                  : "text-foreground/78",
          )}
        >
          {props.value}
        </span>
      </span>
    </>
  );
  return props.onClick ? (
    <button
      type="button"
      onClick={props.onClick}
      className="flex min-w-0 items-center gap-2 bg-background/38 px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.045] focus-visible:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px"
    >
      {content}
    </button>
  ) : (
    <div className="flex min-w-0 items-center gap-2 bg-background/38 px-3 py-2.5">{content}</div>
  );
}

function ManagementTabs(props: {
  readonly activeTab: PullRequestManagementTab;
  readonly detail: SourceControlChangeRequestDetail;
  readonly onChange: (tab: PullRequestManagementTab) => void;
}) {
  const tabs: ReadonlyArray<{
    id: PullRequestManagementTab;
    label: string;
    count?: number | undefined;
  }> = [
    { id: "conversation", label: "Overview", count: props.detail.comments.length },
    { id: "checks", label: "Checks", count: props.detail.checkRollup?.length },
    { id: "commits", label: "Commits", count: props.detail.commits?.length },
    {
      id: "files",
      label: "Files",
      count: props.detail.changedFiles ?? props.detail.files?.length,
    },
  ];
  return (
    <nav
      aria-label="Pull request workspace"
      className="flex h-11 shrink-0 items-end gap-5 overflow-x-auto border-border/45 border-b bg-background/22 px-5 @[52rem]/pr-detail:px-7"
    >
      {tabs.map((tab) => {
        const active = props.activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => props.onChange(tab.id)}
            className={cn(
              "relative flex h-full shrink-0 items-center gap-1.5 pt-0.5 text-[11px] transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-px after:origin-center after:scale-x-0 after:bg-foreground after:transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "font-medium text-foreground after:scale-x-100"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 ? (
              <span className="font-mono text-[9px] opacity-50 tabular-nums">{tab.count}</span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

function OverviewWorkspace(props: {
  readonly item: PullRequestInboxItem;
  readonly detail: SourceControlChangeRequestDetail;
  readonly readiness: ReturnType<typeof readinessFor>;
  readonly relatedWorkCandidates: ReadonlyArray<RelatedRycoWorkCandidate>;
  readonly onAttachRelationship: (subject: PullRequestAssociationSubject) => Promise<void>;
  readonly onRemoveRelationship: (subject: PullRequestAssociationSubject) => Promise<void>;
  readonly onOpenThread: (threadId: string) => void;
  readonly onOpenChecks: () => void;
  readonly onSubmitComment?:
    | ((input: { readonly body: string; readonly clientMutationId: string }) => Promise<void>)
    | undefined;
  readonly onAddReaction?:
    | ((input: {
        readonly commentId: string;
        readonly content: SourceControlCommentReactionContent;
      }) => Promise<void>)
    | undefined;
}) {
  const [quoteInsertion, setQuoteInsertion] = useState<CommentQuoteInsertion | null>(null);
  const quoteIdRef = useRef(0);
  const queueQuote = useCallback((author: string, body: string, createdAt: DateTime.Utc) => {
    quoteIdRef.current += 1;
    setQuoteInsertion({
      id: quoteIdRef.current,
      markdown: buildCommentQuoteMarkdown({
        author,
        body,
        createdAt,
        contextLabel: "PR review",
      }),
    });
  }, []);
  return (
    <div className="mx-auto grid w-full max-w-[92rem] gap-5 p-4 @[52rem]/pr-detail:p-6 @[68rem]/pr-detail:grid-cols-[minmax(0,1fr)_18rem] @[68rem]/pr-detail:gap-6">
      <main className="min-w-0 space-y-5">
        <section className="pull-request-detail-glass rounded-2xl border border-border/48 px-4 pt-4 pb-5 @[52rem]/pr-detail:px-5">
          <SectionHeading
            eyebrow="Change intent"
            title="What this pull request changes"
            icon={<FileTextIcon className="size-4" />}
          />
          <div className="mt-4 max-w-[76ch]">
            <MarkdownView text={props.detail.body} className="text-[13px] leading-[1.7]" />
          </div>
          {props.detail.truncated ? (
            <p className="mt-4 border-amber-500/16 border-t pt-3 text-[10px] text-amber-700 dark:text-amber-300">
              Ryco received a bounded provider response. Open the provider view for the complete
              description.
            </p>
          ) : null}
        </section>

        <section aria-labelledby="pr-review-activity">
          <div className="flex items-end justify-between gap-3 px-1">
            <div>
              <p className="text-[9px] text-muted-foreground tracking-[0.12em]">Collaboration</p>
              <h2 id="pr-review-activity" className="mt-1 font-heading font-semibold text-base">
                Review activity
              </h2>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
              {props.detail.comments.length} comment
              {props.detail.comments.length === 1 ? "" : "s"}
            </span>
          </div>
          {props.detail.comments.length > 0 ? (
            <ol className="mt-3 space-y-3">
              {props.detail.comments.map((comment) => (
                <li key={`${comment.id ?? "comment"}:${comment.author}:${comment.createdAt}`}>
                  <CommentItem
                    author={comment.author}
                    body={comment.body}
                    createdAt={comment.createdAt}
                    authorAssociation={comment.authorAssociation}
                    authorRole={comment.authorRole}
                    reviewState={comment.reviewState}
                    reactions={comment.reactions}
                    itemKind={comment.reviewState ? "review" : "comment"}
                    className="pull-request-detail-glass rounded-xl border-border/48 bg-transparent p-3.5"
                    onQuote={
                      props.onSubmitComment
                        ? () => queueQuote(comment.author, comment.body, comment.createdAt)
                        : undefined
                    }
                    onAddReaction={
                      props.onAddReaction && comment.id
                        ? (content) => props.onAddReaction?.({ commentId: comment.id!, content })
                        : undefined
                    }
                  />
                </li>
              ))}
            </ol>
          ) : (
            <div className="pull-request-detail-glass mt-3 flex items-center gap-3 rounded-xl border border-dashed border-border/55 px-4 py-5">
              <MessageSquareIcon className="size-4 text-muted-foreground/55" />
              <div>
                <p className="font-medium text-xs">No review conversation yet</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  The change intent and current signals are ready for the first pass.
                </p>
              </div>
            </div>
          )}
          {props.onSubmitComment ? (
            <CommentComposer
              placeholder="Add context, ask a question, or leave review notes…"
              submitLabel="Post comment"
              onSubmit={props.onSubmitComment}
              quoteInsertion={quoteInsertion}
              onQuoteInsertionHandled={(id) =>
                setQuoteInsertion((current) => (current?.id === id ? null : current))
              }
              className="pull-request-detail-glass mt-3 rounded-xl border-border/55 bg-transparent"
            />
          ) : null}
        </section>
      </main>

      <aside className="min-w-0 space-y-3 @[68rem]/pr-detail:sticky @[68rem]/pr-detail:top-0 @[68rem]/pr-detail:self-start">
        <DecisionPanel
          item={props.item}
          detail={props.detail}
          readiness={props.readiness}
          onOpenChecks={props.onOpenChecks}
        />
        <PeoplePanel detail={props.detail} />
        <RelatedWorkPanel
          item={props.item}
          candidates={props.relatedWorkCandidates}
          onAttach={props.onAttachRelationship}
          onRemove={props.onRemoveRelationship}
          onOpenThread={props.onOpenThread}
        />
        <MetadataPanel detail={props.detail} />
      </aside>
    </div>
  );
}

function SectionHeading(props: {
  readonly eyebrow: string;
  readonly title: string;
  readonly icon: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/45 bg-foreground/[0.035] text-muted-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]">
        {props.icon}
      </span>
      <div>
        <p className="text-[9px] text-muted-foreground tracking-[0.12em]">{props.eyebrow}</p>
        <h2 className="mt-0.5 font-heading font-semibold text-base tracking-[-0.015em]">
          {props.title}
        </h2>
      </div>
    </div>
  );
}

function Panel(props: {
  readonly title: string;
  readonly icon: ReactNode;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <section
      className={cn(
        "pull-request-detail-glass rounded-xl border border-border/48 px-3.5 py-3.5",
        props.className,
      )}
    >
      <h3 className="flex items-center gap-2 font-medium text-[11px] text-foreground/82">
        <span className="text-muted-foreground/65">{props.icon}</span>
        {props.title}
      </h3>
      <div className="mt-3">{props.children}</div>
    </section>
  );
}

function DecisionPanel(props: {
  readonly item: PullRequestInboxItem;
  readonly detail: SourceControlChangeRequestDetail;
  readonly readiness: ReturnType<typeof readinessFor>;
  readonly onOpenChecks: () => void;
}) {
  return (
    <Panel title="Review readiness" icon={<ShieldCheckIcon className="size-3.5" />}>
      <div className={cn("flex items-start gap-2", readinessTone(props.readiness.tone))}>
        <span className="mt-0.5">{props.readiness.icon}</span>
        <div>
          <p className="font-medium text-xs">{props.readiness.label}</p>
          <p className="mt-0.5 text-[10px] leading-relaxed opacity-75">
            {props.readiness.description}
          </p>
        </div>
      </div>
      <dl className="mt-3 divide-y divide-border/35 border-border/40 border-y">
        <DecisionRow label="Review" value={reviewLabel(props.detail, props.item)} />
        <DecisionRow
          label="Checks"
          value={`${props.item.pullRequest.checks.passing}/${props.item.pullRequest.checks.total} passing`}
          tone={itemCheckTone(props.item.pullRequest.checks.status)}
        />
        <DecisionRow label="Merge" value={mergeabilityLabel(props.detail)} />
      </dl>
      <button
        type="button"
        onClick={props.onOpenChecks}
        className="mt-3 inline-flex items-center gap-1 text-[10px] font-medium text-foreground/65 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Inspect validation <ArrowRightIcon className="size-3" />
      </button>
    </Panel>
  );
}

function DecisionRow(props: {
  readonly label: string;
  readonly value: string;
  readonly tone?: "success" | "warning" | "danger" | undefined;
}) {
  return (
    <div className="flex items-center gap-3 py-2 text-[10px]">
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd
        className={cn(
          "ml-auto text-right font-medium",
          props.tone === "success"
            ? "text-emerald-700 dark:text-emerald-300"
            : props.tone === "warning"
              ? "text-amber-700 dark:text-amber-300"
              : props.tone === "danger"
                ? "text-rose-700 dark:text-rose-300"
                : "text-foreground/75",
        )}
      >
        {props.value}
      </dd>
    </div>
  );
}

function PeoplePanel({ detail }: { readonly detail: SourceControlChangeRequestDetail }) {
  const participants = detail.participants ?? [];
  const reviewers = detail.reviewers ?? [];
  const visiblePeople =
    participants.length > 0
      ? participants.map((participant) => ({
          name: participant.username ?? participant.displayName,
          detail: participant.approved ? "Approved" : (participant.role ?? "Participant"),
          approved: participant.approved === true,
        }))
      : reviewers.map((reviewer) => ({ name: reviewer, detail: "Reviewer", approved: false }));
  return (
    <Panel title="People" icon={<UsersIcon className="size-3.5" />}>
      {visiblePeople.length > 0 ? (
        <ul className="space-y-2">
          {visiblePeople.map((person) => (
            <li key={`${person.name}:${person.detail}`} className="flex items-center gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-lg border border-border/45 bg-foreground/[0.035] font-semibold text-[9px] text-foreground/72">
                {person.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-[10px]">{person.name}</span>
                <span className="block truncate text-[9px] text-muted-foreground">
                  {person.detail}
                </span>
              </span>
              {person.approved ? (
                <CheckCircle2Icon className="size-3.5 text-emerald-500" aria-label="Approved" />
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[10px] text-muted-foreground">No reviewers are listed.</p>
      )}
      {detail.assignees && detail.assignees.length > 0 ? (
        <p className="mt-3 border-border/35 border-t pt-2 text-[9px] text-muted-foreground">
          Assigned to {detail.assignees.join(", ")}
        </p>
      ) : null}
    </Panel>
  );
}

function RelatedWorkPanel(props: {
  readonly item: PullRequestInboxItem;
  readonly candidates: ReadonlyArray<RelatedRycoWorkCandidate>;
  readonly onAttach: (subject: PullRequestAssociationSubject) => Promise<void>;
  readonly onRemove: (subject: PullRequestAssociationSubject) => Promise<void>;
  readonly onOpenThread: (threadId: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = props.item.associations.filter((association) =>
    Option.isNone(association.endedAt),
  );
  const associatedKeys = new Set(
    active.map((association) =>
      association.subject.kind === "thread"
        ? `thread:${association.subject.threadId}`
        : `worktree:${association.subject.worktreeId}`,
    ),
  );
  const available = props.candidates.filter((candidate) => !associatedKeys.has(candidate.key));
  const run = async (operation: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Relationship update failed.");
    } finally {
      setPending(false);
    }
  };
  return (
    <Panel title="Related Ryco work" icon={<Link2Icon className="size-3.5" />}>
      {active.length > 0 ? (
        <ul className="space-y-1.5">
          {active.map((association) => {
            const key =
              association.subject.kind === "thread"
                ? `thread:${association.subject.threadId}`
                : `worktree:${association.subject.worktreeId}`;
            const candidate = props.candidates.find((entry) => entry.key === key);
            return (
              <li
                key={`${key}:${association.relationship}`}
                className="group flex items-center gap-2 rounded-lg bg-foreground/[0.025] px-2 py-1.5"
              >
                <button
                  type="button"
                  disabled={!candidate?.threadId}
                  onClick={() => candidate?.threadId && props.onOpenThread(candidate.threadId)}
                  className="min-w-0 flex-1 text-left disabled:cursor-default"
                >
                  <span className="block truncate font-medium text-[10px]">
                    {candidate?.label ?? key}
                  </span>
                  <span className="block truncate text-[9px] text-muted-foreground">
                    {association.relationship.replaceAll("-", " ")}
                  </span>
                </button>
                {association.relationship === "explicitly-attached" ? (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={pending}
                    aria-label={`Remove ${candidate?.label ?? key}`}
                    onClick={() => void run(() => props.onRemove(association.subject))}
                  >
                    <XCircleIcon className="size-3" />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          No thread or worktree is attached to this pull request.
        </p>
      )}
      {available.length > 0 ? (
        <Select
          value="attach"
          disabled={pending}
          onValueChange={(key) => {
            const candidate = props.candidates.find((entry) => entry.key === key);
            if (candidate) void run(() => props.onAttach(candidate.subject));
          }}
        >
          <SelectTrigger size="xs" className="mt-3 w-full bg-background/32">
            <SelectValue>Attach thread or worktree…</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {available.map((candidate) => (
              <SelectItem key={candidate.key} value={candidate.key}>
                <span className="truncate">{candidate.label}</span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : null}
      {error ? <p className="mt-2 text-[9px] text-rose-600 dark:text-rose-400">{error}</p> : null}
    </Panel>
  );
}

function MetadataPanel({ detail }: { readonly detail: SourceControlChangeRequestDetail }) {
  const issueCount = detail.linkedIssueNumbers?.length ?? 0;
  const workItemCount = detail.linkedWorkItemKeys?.length ?? 0;
  return (
    <Panel title="Context" icon={<TagIcon className="size-3.5" />}>
      {detail.labels && detail.labels.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {detail.labels.map((label) => (
            <LabelChip key={label.name} label={label} />
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground">No labels</p>
      )}
      {issueCount > 0 || workItemCount > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1 border-border/35 border-t pt-2">
          {detail.linkedIssueNumbers?.map((number) => (
            <span
              key={number}
              className="inline-flex items-center gap-1 rounded-md bg-foreground/[0.035] px-1.5 py-1 text-[9px]"
            >
              <CircleDotIcon className="size-2.5 text-muted-foreground" />#{number}
            </span>
          ))}
          {detail.linkedWorkItemKeys?.map((key) => (
            <span
              key={key}
              className="rounded-md bg-foreground/[0.035] px-1.5 py-1 font-mono text-[9px]"
            >
              {key}
            </span>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function ChecksWorkspace(props: {
  readonly item: PullRequestInboxItem;
  readonly detail: SourceControlChangeRequestDetail;
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
}) {
  const checkStatus = getPrCheckStatusFromChangeRequest(props.detail);
  return (
    <div className="mx-auto w-full max-w-[88rem] p-4 @[52rem]/pr-detail:p-6">
      <div className="pull-request-detail-glass mb-4 flex flex-wrap items-center gap-4 rounded-xl border border-border/48 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[9px] text-muted-foreground tracking-[0.12em]">Validation</p>
          <h2 className="mt-0.5 font-heading font-semibold text-base">Checks and workflows</h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Inspect failures, open logs, and rerun eligible jobs without leaving the inbox.
          </p>
        </div>
        <PrCheckStatusBadge view={checkStatus} mode="compact" />
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
          {props.item.pullRequest.checks.passing} passing · {props.item.pullRequest.checks.failing}{" "}
          failing · {props.item.pullRequest.checks.pending} pending
        </span>
      </div>
      <div className="pull-request-detail-glass min-h-96 overflow-hidden rounded-xl border border-border/48">
        <WorkflowRunsSection
          environmentId={props.environmentId}
          cwd={props.cwd}
          pullRequestNumber={props.detail.number}
          title="Workflow runs"
          description="Current and recent validation for this pull request head."
        />
      </div>
    </div>
  );
}

function CommitLedger(props: {
  readonly commits: ReadonlyArray<SourceControlChangeRequestCommit>;
  readonly pullRequestUrl: string;
}) {
  if (props.commits.length === 0) {
    return (
      <WorkspaceEmpty icon={<GitCommitIcon className="size-5" />} message="No commits to show." />
    );
  }
  return (
    <div className="mx-auto w-full max-w-[72rem] p-4 @[52rem]/pr-detail:p-6">
      <div className="mb-5 flex items-end justify-between gap-4 px-1">
        <div>
          <p className="text-[9px] text-muted-foreground tracking-[0.12em]">Change history</p>
          <h2 className="mt-0.5 font-heading font-semibold text-base">Commit ledger</h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Read the change as a sequence of author decisions.
          </p>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
          {props.commits.length} commit{props.commits.length === 1 ? "" : "s"}
        </span>
      </div>
      <ol className="relative ml-3 border-border/50 border-l pl-6">
        {props.commits.map((commit, index) => {
          const date = commit.committedDate ? new Date(commit.committedDate) : null;
          return (
            <li key={commit.oid} className="relative pb-3 last:pb-0">
              <span className="absolute top-4 -left-[1.79rem] flex size-3 items-center justify-center rounded-full border border-border/60 bg-background shadow-[0_0_0_4px_color-mix(in_srgb,var(--background)_88%,transparent)]">
                <span className="size-1 rounded-full bg-foreground/45" />
              </span>
              <article className="pull-request-detail-glass group rounded-xl border border-border/48 px-4 py-3 transition-transform hover:-translate-y-px">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 font-mono text-[9px] text-muted-foreground/55 tabular-nums">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-pretty font-medium text-[12px] leading-snug">
                      {commit.messageHeadline || "No commit message"}
                    </h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-muted-foreground">
                      <code className="font-mono text-foreground/58">{commit.shortOid}</code>
                      {commit.author ? <span>{commit.author}</span> : null}
                      {date && Number.isFinite(date.getTime()) ? (
                        <time dateTime={date.toISOString()}>{compactDateFmt.format(date)}</time>
                      ) : null}
                    </div>
                  </div>
                  <a
                    href={`${props.pullRequestUrl}/changes/${commit.oid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground/55 transition-colors hover:bg-foreground/[0.045] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Open commit ${commit.shortOid}`}
                  >
                    <ExternalLinkIcon className="size-3.5" />
                  </a>
                </div>
              </article>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function FileReviewWorkspace(props: {
  readonly files: ReadonlyArray<SourceControlChangeRequestFile>;
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly reference: string;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(
    () => props.files[0]?.path ?? null,
  );
  const diffQuery = useSourceControlChangeRequestDiff({
    environmentId: props.environmentId,
    cwd: props.cwd,
    reference: props.reference,
    enabled: selectedPath !== null && props.cwd !== null,
  });
  const diffByPath = useMemo(
    () => (diffQuery.data ? splitUnifiedDiffByFile(diffQuery.data) : null),
    [diffQuery.data],
  );
  if (props.files.length === 0) {
    return (
      <WorkspaceEmpty
        icon={<FileCode2Icon className="size-5" />}
        message="No file changes available."
      />
    );
  }
  const selectedFile = props.files.find((file) => file.path === selectedPath) ?? props.files[0]!;
  const patch = diffByPath?.get(selectedFile.path) ?? null;
  return (
    <div className="flex min-h-[34rem] flex-col @[54rem]/pr-detail:grid @[54rem]/pr-detail:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="border-border/45 border-b bg-background/20 @[54rem]/pr-detail:border-r @[54rem]/pr-detail:border-b-0">
        <div className="border-border/40 border-b px-4 py-3">
          <p className="text-[9px] text-muted-foreground tracking-[0.12em]">Review surface</p>
          <h2 className="mt-0.5 font-heading font-semibold text-sm">Changed files</h2>
          <p className="mt-1 font-mono text-[9px] text-muted-foreground tabular-nums">
            {props.files.length} file{props.files.length === 1 ? "" : "s"}
          </p>
        </div>
        <ol className="max-h-56 overflow-y-auto p-2 @[54rem]/pr-detail:max-h-[calc(100dvh-22rem)]">
          {props.files.map((file) => {
            const selected = file.path === selectedFile.path;
            return (
              <li key={file.path}>
                <button
                  type="button"
                  onClick={() => setSelectedPath(file.path)}
                  className={cn(
                    "group flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? "bg-foreground/[0.07] text-foreground"
                      : "text-foreground/72 hover:bg-foreground/[0.035]",
                  )}
                >
                  <FileCode2Icon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[10px]">{file.path}</span>
                    <span className="mt-1 flex items-center gap-2 font-mono text-[8px] tabular-nums">
                      <span className="text-emerald-600 dark:text-emerald-400">
                        +{file.additions}
                      </span>
                      <span className="text-rose-600 dark:text-rose-400">−{file.deletions}</span>
                    </span>
                  </span>
                  <ChevronRightIcon
                    className={cn(
                      "mt-0.5 size-3 shrink-0 transition-transform",
                      selected
                        ? "translate-x-0 opacity-60"
                        : "-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-40",
                    )}
                  />
                </button>
              </li>
            );
          })}
        </ol>
      </aside>
      <main className="min-w-0 bg-background/12">
        <header className="flex min-w-0 items-center gap-3 border-border/40 border-b px-4 py-3">
          <FileCode2Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <code className="min-w-0 flex-1 truncate font-mono text-[11px]">{selectedFile.path}</code>
          <span className="shrink-0 font-mono text-[9px] tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">
              +{selectedFile.additions}
            </span>
            <span className="mx-1 text-muted-foreground/45">/</span>
            <span className="text-rose-600 dark:text-rose-400">−{selectedFile.deletions}</span>
          </span>
        </header>
        <WorkspaceDiff
          patch={patch}
          isLoading={diffQuery.isLoading || diffQuery.isFetching}
          error={diffQuery.error instanceof Error ? diffQuery.error.message : null}
        />
      </main>
    </div>
  );
}

function WorkspaceDiff(props: {
  readonly patch: string | null;
  readonly isLoading: boolean;
  readonly error: string | null;
}) {
  if (props.isLoading && props.patch === null) {
    return (
      <div className="flex items-center gap-2 px-5 py-8 text-[10px] text-muted-foreground">
        <Spinner className="size-3" /> Loading file diff…
      </div>
    );
  }
  if (props.error) {
    return (
      <div
        role="alert"
        className="m-4 rounded-lg border border-rose-500/20 bg-rose-500/6 px-3 py-2 text-[10px] text-rose-700 dark:text-rose-300"
      >
        {props.error}
      </div>
    );
  }
  const lines = props.patch ? parseDiffLines(props.patch) : [];
  if (lines.length === 0) {
    return (
      <div className="px-5 py-8 text-[10px] text-muted-foreground">
        No inline diff is available for this file.
      </div>
    );
  }
  const maxLine = lines.reduce(
    (max, line) => Math.max(max, line.oldLineNumber ?? 0, line.newLineNumber ?? 0),
    0,
  );
  const gutter = `${Math.max(2, String(maxLine).length)}ch`;
  return (
    <div className="overflow-x-auto">
      <pre className="min-w-max font-mono text-[10px] leading-[1.55]">
        {lines.map((line, index) => (
          <WorkspaceDiffLine
            key={`${index}:${line.oldLineNumber}:${line.newLineNumber}`}
            line={line}
            gutter={gutter}
          />
        ))}
      </pre>
    </div>
  );
}

function WorkspaceDiffLine(props: { readonly line: DiffLine; readonly gutter: string }) {
  const tone =
    props.line.kind === "add"
      ? "bg-emerald-500/9 text-emerald-800 dark:text-emerald-200"
      : props.line.kind === "remove"
        ? "bg-rose-500/9 text-rose-800 dark:text-rose-200"
        : props.line.kind === "hunk"
          ? "bg-sky-500/7 text-sky-800 dark:text-sky-200"
          : "text-foreground/76";
  return (
    <div className={cn("flex whitespace-pre", tone)}>
      <span
        className="shrink-0 select-none border-border/30 border-r bg-foreground/[0.018] px-1.5 text-right text-muted-foreground/45"
        style={{ width: props.gutter }}
      >
        {props.line.oldLineNumber ?? ""}
      </span>
      <span
        className="shrink-0 select-none border-border/30 border-r bg-foreground/[0.012] px-1.5 text-right text-muted-foreground/45"
        style={{ width: props.gutter }}
      >
        {props.line.newLineNumber ?? ""}
      </span>
      <span className="min-w-0 flex-1 px-2.5">{props.line.text || " "}</span>
    </div>
  );
}

function WorkspaceEmpty(props: { readonly icon: ReactNode; readonly message: string }) {
  return (
    <div className="flex min-h-80 items-center justify-center p-8 text-center">
      <div>
        <span className="mx-auto flex size-10 items-center justify-center rounded-xl border border-border/50 bg-foreground/[0.025] text-muted-foreground/55">
          {props.icon}
        </span>
        <p className="mt-3 text-xs text-muted-foreground">{props.message}</p>
      </div>
    </div>
  );
}
