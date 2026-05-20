import type { EnvironmentId, SourceControlIssueDetail } from "@ryco/contracts";
import { DateTime, Option } from "effect";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import { issueDetailQueryOptions } from "~/lib/sourceControlContextRpc";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { CommentItem } from "./CommentThread";
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
  const detailQuery = useQuery(
    issueDetailQueryOptions({
      environmentId: props.environmentId,
      cwd: props.cwd,
      reference,
      fullContent: true,
    }),
  );

  const detail = detailQuery.data;

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
            View on GitHub
          </a>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {detailQuery.isLoading ? (
          <div className="flex items-center gap-2 px-5 py-4 text-muted-foreground text-sm">
            <Spinner className="size-4" />
            Loading issue…
          </div>
        ) : detailQuery.isError ? (
          <p className="px-5 py-4 text-destructive text-sm">
            {detailQuery.error instanceof Error ? detailQuery.error.message : "Failed to load."}
          </p>
        ) : detail ? (
          <IssueDetailBody
            detail={detail}
            onSelectLinkedChangeRequest={props.onSelectLinkedChangeRequest}
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
}) {
  const { detail } = props;
  const opCreatedAt =
    detail.updatedAt && Option.isSome(detail.updatedAt)
      ? detail.updatedAt.value
      : DateTime.fromDateUnsafe(new Date());
  const opAuthor = detail.author ?? "unknown";

  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4">
        <header className="mb-5 space-y-2">
          <div className="flex items-start gap-3">
            <h2 className="flex-1 font-heading font-semibold text-xl leading-tight">
              {detail.title}{" "}
              <span className="font-normal text-muted-foreground">#{detail.number}</span>
            </h2>
            <StateBadge
              kind={detail.state === "open" ? "issue-open" : "issue-closed"}
              className="mt-1"
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {detail.author ? `Opened by ${detail.author}` : "Opened"}
            {detail.updatedAt && Option.isSome(detail.updatedAt) ? (
              <> · updated {dateFmt.format(DateTime.toDate(detail.updatedAt.value))}</>
            ) : null}
          </p>
        </header>

        <ol className="space-y-4">
          <li>
            <CommentItem
              author={opAuthor}
              body={detail.body}
              createdAt={opCreatedAt}
              isOriginalPost
            />
          </li>
          {detail.comments.map((comment) => (
            <li key={`${comment.author}-${comment.createdAt}-${comment.body}`}>
              <CommentItem
                author={comment.author}
                body={comment.body}
                createdAt={comment.createdAt}
                authorAssociation={comment.authorAssociation}
                reviewState={comment.reviewState}
              />
            </li>
          ))}
        </ol>
      </div>

      <WorktreeItemSidebar
        assignees={detail.assignees}
        labels={detail.labels}
        linkedChangeRequestNumbers={detail.linkedChangeRequestNumbers ?? []}
        onSelectLinkedChangeRequest={props.onSelectLinkedChangeRequest}
      />
    </div>
  );
}
