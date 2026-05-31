import type {
  SourceControlCommentAuthorRole,
  SourceControlIssueComment,
  SourceControlReviewState,
} from "@ryco/contracts";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CodeIcon,
  FileTextIcon,
  MessageSquareIcon,
  SendIcon,
  XCircleIcon,
} from "lucide-react";
import { DateTime } from "effect";
import { memo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import {
  authorAssociationLabel,
  avatarUrlForAuthor,
  commentRoleBadges,
  commentToneForAuthorRole,
  hashAuthorToHue,
  type CommentRoleBadgeTone,
  type CommentRoleTone,
} from "./CommentThread.logic";
import { MarkdownView } from "./MarkdownView";

const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function createClientMutationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "Failed to post comment.";
}

function avatarInitials(author: string): string {
  const trimmed = author.trim();
  if (trimmed.length === 0) return "?";
  return trimmed.charAt(0).toUpperCase();
}

export function CommentAvatar({ author, size = 28 }: { author: string; size?: number }) {
  const [imageFailed, setImageFailed] = useState(false);
  const url = avatarUrlForAuthor(author);
  const hue = hashAuthorToHue(author);
  const initials = avatarInitials(author);

  if (!url || imageFailed) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
        style={{ backgroundColor: `hsl(${hue} 60% 40%)`, width: size, height: size }}
        aria-hidden
      >
        {initials}
      </span>
    );
  }

  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setImageFailed(true)}
      className="inline-flex shrink-0 rounded-full bg-muted/40 object-cover"
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}

export function AuthorAssociationBadge({
  association,
  override,
  tone,
  variant = "default",
}: {
  association?: string | undefined;
  override?: string | undefined;
  tone?: CommentRoleBadgeTone | undefined;
  variant?: "default" | "highlight";
}) {
  const label = override ?? authorAssociationLabel(association);
  if (label === null) return null;
  const badgeTone = tone ?? (variant === "highlight" ? "author" : "default");
  return (
    <span
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded-full border px-1.5 text-[10px] font-medium",
        badgeTone === "author"
          ? "border-primary/30 bg-primary/10 text-primary"
          : badgeTone === "owner"
            ? "border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300"
            : badgeTone === "maintainer"
              ? "border-sky-500/35 bg-sky-500/12 text-sky-700 dark:text-sky-300"
              : "border-border/60 bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

export interface CommentItemProps {
  author: string;
  body: string;
  createdAt: DateTime.Utc;
  authorAssociation?: string | undefined;
  authorRole?: SourceControlCommentAuthorRole | undefined;
  reviewState?: SourceControlReviewState | undefined;
  isOriginalPost?: boolean;
  className?: string;
}

const REVIEW_STATE_META: Record<
  SourceControlReviewState,
  { label: string; tone: string; icon: React.ReactNode }
> = {
  approved: {
    label: "Approved",
    tone: "border-emerald-500/30 bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
    icon: <CheckCircle2Icon className="size-3" />,
  },
  changes_requested: {
    label: "Changes requested",
    tone: "border-rose-500/30 bg-rose-500/12 text-rose-600 dark:text-rose-400",
    icon: <XCircleIcon className="size-3" />,
  },
  commented: {
    label: "Reviewed",
    tone: "border-sky-500/30 bg-sky-500/12 text-sky-600 dark:text-sky-400",
    icon: <MessageSquareIcon className="size-3" />,
  },
  dismissed: {
    label: "Dismissed",
    tone: "border-border/60 bg-muted text-muted-foreground",
    icon: <XCircleIcon className="size-3" />,
  },
  pending: {
    label: "Pending review",
    tone: "border-amber-500/30 bg-amber-500/12 text-amber-600 dark:text-amber-400",
    icon: <MessageSquareIcon className="size-3" />,
  },
};

function ReviewStateBadge({ state }: { state: SourceControlReviewState }) {
  const meta = REVIEW_STATE_META[state];
  return (
    <span
      className={cn(
        "inline-flex h-4 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium",
        meta.tone,
      )}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
}

function commentArticleToneClassName(tone: CommentRoleTone): string {
  switch (tone) {
    case "author":
      return "border-primary/30 bg-primary/4";
    case "owner":
      return "border-amber-500/28 bg-amber-500/8";
    case "maintainer":
      return "border-sky-500/28 bg-sky-500/8";
    case "participant":
      return "border-border/60 bg-muted/24";
  }
}

export const CommentItem = memo(function CommentItem(props: CommentItemProps) {
  const [showRaw, setShowRaw] = useState(false);
  const isoDate = DateTime.toDate(props.createdAt).toISOString();
  const roleTone = commentToneForAuthorRole(
    props.authorRole,
    props.isOriginalPost,
    props.authorAssociation,
  );
  const roleBadges = commentRoleBadges({
    role: props.authorRole,
    association: props.authorAssociation,
    isOriginalPost: props.isOriginalPost,
  });
  return (
    <article
      className={cn(
        "rounded-xl border p-3",
        commentArticleToneClassName(roleTone),
        props.className,
      )}
    >
      <header className="mb-2 flex items-center gap-2">
        <CommentAvatar author={props.author} />
        <span className="font-medium text-sm">{props.author}</span>
        {roleBadges.map((badge) => (
          <AuthorAssociationBadge
            key={`${badge.tone}-${badge.label}`}
            override={badge.label}
            tone={badge.tone}
          />
        ))}
        {props.reviewState ? <ReviewStateBadge state={props.reviewState} /> : null}
        <time dateTime={isoDate} className="text-muted-foreground text-xs" title={isoDate}>
          {dateTimeFmt.format(DateTime.toDate(props.createdAt))}
        </time>
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="ml-auto inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-secondary hover:text-foreground"
          aria-label={showRaw ? "Show rendered markdown" : "Show raw source"}
          title={showRaw ? "Show rendered markdown" : "Show raw source"}
        >
          {showRaw ? <FileTextIcon className="size-3.5" /> : <CodeIcon className="size-3.5" />}
        </button>
      </header>
      <MarkdownView text={props.body} raw={showRaw} />
    </article>
  );
});

export function CommentComposer(props: {
  placeholder: string;
  submitLabel: string;
  onSubmit: (input: { readonly body: string; readonly clientMutationId: string }) => Promise<void>;
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  const [draft, setDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const mutationIdRef = useRef<string | null>(null);
  const submittedBodyRef = useRef<string | null>(null);

  const trimmedDraft = draft.trim();
  const canSubmit = !props.disabled && !isSubmitting && trimmedDraft.length > 0;

  const handleDraftChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextDraft = event.target.value;
    const nextBody = nextDraft.trim();
    setDraft(nextDraft);
    setSuccessMessage(null);
    setSubmitError(null);
    if (submittedBodyRef.current !== null && submittedBodyRef.current !== nextBody) {
      mutationIdRef.current = null;
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    const body = trimmedDraft;
    const clientMutationId = mutationIdRef.current ?? createClientMutationId();
    mutationIdRef.current = clientMutationId;
    submittedBodyRef.current = body;
    setIsSubmitting(true);
    setSubmitError(null);
    setSuccessMessage(null);

    try {
      await props.onSubmit({ body, clientMutationId });
      setDraft("");
      mutationIdRef.current = null;
      submittedBodyRef.current = null;
      setSuccessMessage("Comment posted.");
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn("rounded-xl border border-border/60 bg-muted/12 p-3", props.className)}
    >
      <Textarea
        aria-label="Comment body"
        placeholder={props.placeholder}
        value={draft}
        onChange={handleDraftChange}
        disabled={props.disabled || isSubmitting}
        size="sm"
        className="bg-background/70"
      />
      <div className="mt-2 flex min-h-7 items-center gap-2">
        <div className="min-w-0 flex-1 text-xs" aria-live="polite">
          {isSubmitting ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Spinner className="size-3" />
              Posting comment...
            </span>
          ) : submitError ? (
            <span className="inline-flex items-center gap-1.5 text-destructive">
              <AlertCircleIcon className="size-3.5 shrink-0" />
              <span className="truncate">{submitError}</span>
            </span>
          ) : successMessage ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2Icon className="size-3.5 shrink-0" />
              {successMessage}
            </span>
          ) : null}
        </div>
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {isSubmitting ? <Spinner className="size-3.5" /> : <SendIcon className="size-3.5" />}
          {submitError ? "Retry" : props.submitLabel}
        </Button>
      </div>
    </form>
  );
}

export const CommentThread = memo(function CommentThread(props: {
  comments: ReadonlyArray<SourceControlIssueComment>;
}) {
  if (props.comments.length === 0) {
    return null;
  }
  return (
    <ol className="space-y-4">
      {props.comments.map((comment) => (
        <li key={`${comment.author}-${comment.createdAt}-${comment.body}`}>
          <CommentItem
            author={comment.author}
            body={comment.body}
            createdAt={comment.createdAt}
            authorAssociation={comment.authorAssociation}
            authorRole={comment.authorRole}
            reviewState={comment.reviewState}
          />
        </li>
      ))}
    </ol>
  );
});
