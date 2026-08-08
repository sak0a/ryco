import type { PullRequestInboxItem } from "@ryco/contracts";
import { DateTime, Option } from "effect";

import type { PullRequestRouteSearch } from "~/pullRequestRouteSearch";

function normalized(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function matchesView(item: PullRequestInboxItem, view: PullRequestRouteSearch["view"]): boolean {
  const pullRequest = item.pullRequest;
  switch (view) {
    case "latest":
      return true;
    case "review":
      return (
        pullRequest.viewer?.reviewRequested === true &&
        (pullRequest.review.disposition === "review-required" ||
          pullRequest.review.disposition === "changes-requested")
      );
    case "assigned":
      return pullRequest.viewer?.isAssignee === true;
    case "authored":
      return pullRequest.viewer?.isAuthor === true;
    case "changes-requested":
      return pullRequest.review.disposition === "changes-requested";
    case "failing":
      return pullRequest.checks.status === "failing";
    case "drafts":
      return pullRequest.state === "open" && pullRequest.isDraft;
    case "merged":
      return pullRequest.state === "merged";
    case "closed":
      return pullRequest.state === "closed";
  }
}

function updatedAt(item: PullRequestInboxItem): number {
  return Option.match(item.pullRequest.freshness.providerUpdatedAt, {
    onNone: () => DateTime.toEpochMillis(item.pullRequest.freshness.observedAt),
    onSome: DateTime.toEpochMillis,
  });
}

export function filterPullRequestInbox(
  items: ReadonlyArray<PullRequestInboxItem>,
  search: PullRequestRouteSearch,
  relatedLabelBySubject?: ReadonlyMap<string, string> | undefined,
): ReadonlyArray<PullRequestInboxItem> {
  const query = normalized(search.q);
  const author = normalized(search.author);
  const reviewer = normalized(search.reviewer);
  return items
    .filter((item) => matchesView(item, search.view))
    .filter((item) => !search.provider || item.pullRequest.identity.provider === search.provider)
    .filter(
      (item) =>
        !search.repository || item.pullRequest.repository.canonicalKey === search.repository,
    )
    .filter((item) => !search.state || item.pullRequest.state === search.state)
    .filter((item) => !search.check || item.pullRequest.checks.status === search.check)
    .filter((item) => !author || normalized(item.pullRequest.author).includes(author))
    .filter(
      (item) =>
        !reviewer ||
        item.pullRequest.review.requestedReviewers.some((name) =>
          normalized(name).includes(reviewer),
        ),
    )
    .filter((item) => {
      if (!query) return true;
      const pullRequest = item.pullRequest;
      const searchable = [
        pullRequest.title,
        String(pullRequest.identity.number),
        pullRequest.repository.displayName,
        pullRequest.repository.canonicalKey,
        pullRequest.baseRefName,
        pullRequest.headRefName,
        pullRequest.author ?? "",
        ...pullRequest.assignees,
        ...pullRequest.review.requestedReviewers,
        ...item.associations.map((association) =>
          association.subject.kind === "thread"
            ? `${association.subject.threadId} ${relatedLabelBySubject?.get(`thread:${association.subject.threadId}`) ?? ""}`
            : `${association.subject.worktreeId} ${relatedLabelBySubject?.get(`worktree:${association.subject.worktreeId}`) ?? ""}`,
        ),
      ];
      return searchable.some((value) => normalized(String(value)).includes(query));
    })
    .toSorted((left, right) => {
      const byUpdate = updatedAt(right) - updatedAt(left);
      return byUpdate !== 0
        ? byUpdate
        : left.pullRequest.identity.id.localeCompare(right.pullRequest.identity.id);
    });
}
