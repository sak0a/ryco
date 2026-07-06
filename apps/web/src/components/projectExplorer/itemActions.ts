import type {
  SourceControlChangeRequestDetail,
  SourceControlIssueDetail,
  WorkItemDetail,
} from "@ryco/contracts";
import { getPrCheckStatusFromChangeRequest } from "./prCheckStatus";

export type ItemActionKind =
  | "pr-conflicts"
  | "pr-review"
  | "pr-checks"
  | "implement-issue"
  | "implement-work-item";

export interface ItemAction {
  readonly kind: ItemActionKind;
  /** Short badge text, e.g. "Conflicts". */
  readonly badge: string;
  /** One-line summary shown next to the badge. */
  readonly summary: string;
  /** Button label. */
  readonly label: string;
  readonly severity: "warning" | "error";
}

function timestampMillis(value: unknown): number {
  if (typeof value === "object" && value !== null && "toJSON" in value) {
    const iso = (value as { toJSON(): string }).toJSON();
    const parsed = Date.parse(iso);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Latest review state per reviewer: the newest review-comment per author
 * wins, so an approval or dismissal after a changes-requested review
 * clears that reviewer's block.
 */
function reviewersRequestingChanges(detail: SourceControlChangeRequestDetail): string[] {
  const latestByAuthor = new Map<string, { state: string; at: number }>();
  for (const comment of detail.comments) {
    if (!comment.reviewState) continue;
    const at = timestampMillis(comment.createdAt);
    const existing = latestByAuthor.get(comment.author);
    if (!existing || at >= existing.at) {
      latestByAuthor.set(comment.author, { state: comment.reviewState, at });
    }
  }
  return [...latestByAuthor.entries()]
    .filter(([, entry]) => entry.state === "changes_requested")
    .map(([author]) => author);
}

export function derivePullRequestActions(detail: SourceControlChangeRequestDetail): ItemAction[] {
  if (detail.state !== "open") {
    return [];
  }
  const actions: ItemAction[] = [];

  if (detail.mergeability === "conflicting") {
    actions.push({
      kind: "pr-conflicts",
      badge: "Conflicts",
      summary: `This branch has merge conflicts with ${detail.baseRefName}`,
      label: "Resolve in agent thread",
      severity: "warning",
    });
  }

  const blockingReviewers = reviewersRequestingChanges(detail);
  if (blockingReviewers.length > 0) {
    const who =
      blockingReviewers.length === 1
        ? `@${blockingReviewers[0]}`
        : `@${blockingReviewers[0]} +${blockingReviewers.length - 1}`;
    actions.push({
      kind: "pr-review",
      badge: "Changes requested",
      summary: `${who} requested changes`,
      label: "Address feedback",
      severity: "warning",
    });
  }

  const checkStatus = getPrCheckStatusFromChangeRequest(detail);
  if (checkStatus.kind === "failed") {
    const names = checkStatus.failedChecks.map((check) => check.name).slice(0, 2);
    const extra = checkStatus.failedChecks.length - names.length;
    actions.push({
      kind: "pr-checks",
      badge: "CI failing",
      summary:
        names.length > 0
          ? `${names.join(", ")}${extra > 0 ? ` +${extra}` : ""} failing`
          : "Checks are failing",
      label: "Fix checks",
      severity: "error",
    });
  }

  return actions;
}

export function deriveIssueActions(detail: SourceControlIssueDetail): ItemAction[] {
  if (detail.state !== "open") {
    return [];
  }
  return [
    {
      kind: "implement-issue",
      badge: "Open",
      summary: "Start implementing this issue in an agent thread",
      label: "Implement",
      severity: "warning",
    },
  ];
}

export function deriveWorkItemActions(detail: WorkItemDetail): ItemAction[] {
  if (detail.state !== "open" && detail.state !== "in_progress") {
    return [];
  }
  return [
    {
      kind: "implement-work-item",
      badge: detail.stateName?.trim() || (detail.state === "in_progress" ? "In progress" : "Open"),
      summary: "Start implementing this work item in an agent thread",
      label: "Implement",
      severity: "warning",
    },
  ];
}
