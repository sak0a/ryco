import type {
  EnvironmentId,
  PullRequestAiConfiguration,
  PullRequestInboxItem,
} from "@ryco/contracts";
import { sortPullRequestsByAiPriority } from "@ryco/shared/pullRequestIntelligence";
import { DateTime, Option } from "effect";

export function isPullRequestAiScheduleDue(input: {
  readonly configuration: PullRequestAiConfiguration;
  readonly lastSuccessAt: Option.Option<DateTime.Utc> | undefined;
  readonly lastAttemptAt: number | undefined;
  readonly now: number;
}): boolean {
  const intervalMs = input.configuration.intervalMinutes * 60_000;
  if (input.lastAttemptAt !== undefined && input.now - input.lastAttemptAt < intervalMs) {
    return false;
  }
  return Option.match(input.lastSuccessAt ?? Option.none(), {
    onNone: () => true,
    onSome: (lastSuccessAt) => input.now - DateTime.toEpochMillis(lastSuccessAt) >= intervalMs,
  });
}

export function selectScheduledPullRequestCandidates(input: {
  readonly environmentId: EnvironmentId;
  readonly items: ReadonlyArray<PullRequestInboxItem>;
  readonly configuration: PullRequestAiConfiguration;
  readonly now: number;
}): ReadonlyArray<PullRequestInboxItem> {
  const activeWindowStart = input.now - input.configuration.activeWindowDays * 86_400_000;
  const candidates = input.items
    .filter((item) => item.pullRequest.identity.environmentId === input.environmentId)
    .filter((item) => item.pullRequest.state === "open")
    .filter((item) => input.configuration.includeDrafts || !item.pullRequest.isDraft)
    .filter(
      (item) =>
        item.viewState.isUnread ||
        item.pullRequest.viewer?.isAssignee === true ||
        item.pullRequest.viewer?.reviewRequested === true ||
        item.associations.some(
          (association) =>
            Option.isNone(association.endedAt) &&
            DateTime.toEpochMillis(association.createdAt) >= activeWindowStart,
        ),
    );
  return sortPullRequestsByAiPriority(candidates, {}).slice(0, input.configuration.maxPullRequests);
}
