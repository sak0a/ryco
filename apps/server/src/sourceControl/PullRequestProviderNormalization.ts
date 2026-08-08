import type {
  ChangeRequest,
  EnvironmentId,
  ProjectId,
  PullRequestAccessTarget,
  PullRequestCapabilities,
  PullRequestCheckStatus,
  PullRequestRecord,
  RepositoryIdentity,
  SourceControlProviderKind,
} from "@ryco/contracts";
import { encodePullRequestId } from "@ryco/shared/pullRequestIdentity";
import { DateTime, Option } from "effect";

import { SourceControlProviderError } from "@ryco/contracts";

const FAILURE_CONCLUSIONS = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "startup_failure",
  "stale",
]);
const PENDING_STATUSES = new Set(["queued", "requested", "waiting", "pending", "in_progress"]);

export function pullRequestCapabilitiesForProvider(
  provider: SourceControlProviderKind,
): PullRequestCapabilities {
  return {
    detail: provider !== "unknown",
    comments: provider !== "unknown",
    reviews: provider !== "unknown",
    checks: provider !== "unknown",
    commits: provider !== "unknown",
    files: provider !== "unknown",
    viewerIdentity: false,
  };
}

function checkSummary(changeRequest: ChangeRequest): PullRequestRecord["checks"] {
  const checks = changeRequest.checkRollup ?? [];
  let passing = 0;
  let failing = 0;
  let pending = 0;
  for (const check of checks) {
    const conclusion = Option.getOrNull(check.conclusion)?.toLowerCase() ?? null;
    const status = Option.getOrNull(check.status)?.toLowerCase() ?? null;
    if (conclusion !== null && FAILURE_CONCLUSIONS.has(conclusion)) failing += 1;
    else if (conclusion === "success" || conclusion === "skipped" || conclusion === "neutral") {
      passing += 1;
    } else if (conclusion === null || (status !== null && PENDING_STATUSES.has(status)))
      pending += 1;
  }
  const status: PullRequestCheckStatus =
    checks.length === 0
      ? "unknown"
      : failing > 0
        ? "failing"
        : pending > 0
          ? "pending"
          : passing === checks.length
            ? "passing"
            : "neutral";
  return { status, total: checks.length, passing, failing, pending };
}

function splitRepositoryIdentity(identity: RepositoryIdentity) {
  const separator = identity.canonicalKey.indexOf("/");
  if (separator <= 0 || separator === identity.canonicalKey.length - 1) {
    throw new SourceControlProviderError({
      provider: (identity.provider as SourceControlProviderKind | undefined) ?? "unknown",
      operation: "normalizePullRequest",
      detail: "The repository does not have a canonical provider host and path.",
    });
  }
  return {
    host: identity.canonicalKey.slice(0, separator),
    repositoryPath: identity.canonicalKey.slice(separator + 1),
  };
}

export function normalizeProviderPullRequest(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId?: ProjectId;
  readonly cwd: string;
  readonly repositoryIdentity: RepositoryIdentity;
  readonly provider: SourceControlProviderKind;
  readonly changeRequest: ChangeRequest;
  readonly observedAt: DateTime.Utc;
  readonly refreshGeneration: number;
}): { readonly record: PullRequestRecord; readonly accessTarget: PullRequestAccessTarget } {
  const { host, repositoryPath } = splitRepositoryIdentity(input.repositoryIdentity);
  let url: URL;
  try {
    url = new URL(input.changeRequest.url);
  } catch {
    throw new SourceControlProviderError({
      provider: input.provider,
      operation: "normalizePullRequest",
      detail: "Provider returned a malformed pull request URL.",
    });
  }
  if (url.host.toLowerCase() !== host.toLowerCase()) {
    throw new SourceControlProviderError({
      provider: input.provider,
      operation: "normalizePullRequest",
      detail: "Provider response host does not match the requested repository.",
    });
  }
  if (
    input.changeRequest.provider !== "unknown" &&
    input.provider !== "unknown" &&
    input.changeRequest.provider !== input.provider
  ) {
    throw new SourceControlProviderError({
      provider: input.provider,
      operation: "normalizePullRequest",
      detail: "Provider response kind does not match the requested repository.",
    });
  }

  const id = encodePullRequestId({
    environmentId: input.environmentId,
    provider: input.provider,
    host,
    repositoryPath,
    number: input.changeRequest.number,
  });
  const providerUpdatedAt = input.changeRequest.updatedAt;
  const record: PullRequestRecord = {
    identity: {
      id,
      environmentId: input.environmentId,
      provider: input.provider,
      host: host.toLowerCase(),
      repositoryPath: repositoryPath.toLowerCase(),
      number: input.changeRequest.number,
    },
    repository: {
      canonicalKey: input.repositoryIdentity.canonicalKey,
      host: host.toLowerCase(),
      path: repositoryPath.toLowerCase(),
      displayName: input.repositoryIdentity.displayName ?? repositoryPath,
    },
    title: input.changeRequest.title,
    url: input.changeRequest.url,
    state: input.changeRequest.state,
    isDraft: input.changeRequest.isDraft ?? false,
    ...(input.changeRequest.author ? { author: input.changeRequest.author } : {}),
    assignees: [...(input.changeRequest.assignees ?? [])],
    baseRefName: input.changeRequest.baseRefName,
    headRefName: input.changeRequest.headRefName,
    labels: (input.changeRequest.labels ?? []).map((label) => label.name),
    review: {
      disposition: input.changeRequest.reviewDisposition ?? "unknown",
      requestedReviewers: [...(input.changeRequest.reviewers ?? [])],
      approvedBy: [],
    },
    checks: checkSummary(input.changeRequest),
    capabilities: pullRequestCapabilitiesForProvider(input.provider),
    freshness: {
      observedAt: input.observedAt,
      providerUpdatedAt,
      refreshGeneration: input.refreshGeneration,
    },
  };
  return {
    record,
    accessTarget: {
      pullRequestId: id,
      environmentId: input.environmentId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      cwd: input.cwd,
      remoteUrl: input.repositoryIdentity.locator.remoteUrl,
      lastVerifiedAt: input.observedAt,
    },
  };
}
