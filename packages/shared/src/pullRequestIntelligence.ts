import type {
  PullRequestAiAnalysis,
  PullRequestAiModelAssessment,
  PullRequestAiPriority,
  PullRequestInboxItem,
  PullRequestMergeReadiness,
  PullRequestMergeReadinessFactor,
  SourceControlChangeRequestMergeability,
} from "@ryco/contracts";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { DateTime, Option } from "effect";

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, Math.round(value)));

export function pullRequestAiPriorityForScore(score: number): PullRequestAiPriority {
  if (score >= 80) return "urgent";
  if (score >= 60) return "high";
  if (score >= 35) return "normal";
  return "low";
}

export function deterministicPullRequestPriorityPoints(item: PullRequestInboxItem): number {
  const pullRequest = item.pullRequest;
  let score = 0;
  if (pullRequest.viewer?.reviewRequested === true) score += 18;
  if (pullRequest.viewer?.isAssignee === true) score += 10;
  if (item.viewState.isUnread) score += 10;
  if (pullRequest.checks.status === "failing") score += 8;
  if (pullRequest.review.disposition === "changes-requested") score += 7;
  if (item.associations.some((association) => association.endedAt._tag === "None")) score += 7;
  return Math.min(60, score);
}

export function modelPullRequestPriorityPoints(assessment: PullRequestAiModelAssessment): number {
  return Math.min(
    40,
    assessment.riskPoints +
      assessment.blockerPoints +
      assessment.reviewImpactPoints +
      assessment.timeSensitivityPoints,
  );
}

function factor(
  kind: PullRequestMergeReadinessFactor["kind"],
  points: number,
  possiblePoints: number,
  known: boolean,
  explanation: string,
): PullRequestMergeReadinessFactor {
  return {
    kind,
    points: clamp(points, 0, possiblePoints),
    possiblePoints,
    known,
    explanation,
  };
}

export function calculatePullRequestMergeReadiness(input: {
  readonly item: PullRequestInboxItem;
  readonly mergeability?: SourceControlChangeRequestMergeability | undefined;
  readonly assessment: PullRequestAiModelAssessment;
}): PullRequestMergeReadiness | null {
  const { item, assessment } = input;
  const pullRequest = item.pullRequest;
  if (pullRequest.state !== "open") return null;

  const mergeability = input.mergeability ?? "unknown";
  const mergeabilityFactor =
    mergeability === "mergeable"
      ? factor("provider-mergeability", 25, 25, true, "The provider reports no merge conflict.")
      : mergeability === "conflicting"
        ? factor("provider-mergeability", 0, 25, true, "The provider reports merge conflicts.")
        : factor(
            "provider-mergeability",
            0,
            25,
            false,
            "The provider did not calculate mergeability.",
          );

  const checkFactor = (() => {
    switch (pullRequest.checks.status) {
      case "passing":
        return factor("checks", 25, 25, true, "All reported checks are passing.");
      case "failing":
        return factor("checks", 0, 25, true, "One or more reported checks are failing.");
      case "pending":
        return factor("checks", 10, 25, true, "Reported checks are still running.");
      case "neutral":
        return factor("checks", 18, 25, true, "Reported checks completed without a failure.");
      case "unknown":
        return factor("checks", 0, 25, false, "Check status is unavailable.");
    }
  })();

  const reviewFactor = (() => {
    switch (pullRequest.review.disposition) {
      case "approved":
        return factor("review", 20, 20, true, "The pull request is approved.");
      case "reviewed":
        return factor("review", 15, 20, true, "Review activity is complete without approval.");
      case "none":
        return factor("review", 10, 20, true, "No review requirement is reported.");
      case "review-required":
        return factor("review", 5, 20, true, "A review is still required.");
      case "changes-requested":
        return factor("review", 0, 20, true, "Changes were requested.");
      case "unknown":
        return factor("review", 0, 20, false, "Review disposition is unavailable.");
    }
  })();

  const lifecycleFactor = pullRequest.isDraft
    ? factor("lifecycle", 0, 10, true, "The pull request is still a draft.")
    : factor("lifecycle", 10, 10, true, "The pull request is open and not a draft.");
  const implementationFactor = factor(
    "implementation-completeness",
    assessment.implementationCompletenessPoints,
    15,
    true,
    `AI assessment: ${assessment.implementationPhase.replaceAll("-", " ")}.`,
  );
  const discussionFactor = factor(
    "discussion-risk",
    5 - assessment.unresolvedDiscussionRiskPoints,
    5,
    true,
    assessment.unresolvedDiscussionRiskPoints > 0
      ? "The analysis found unresolved discussion or implementation risk."
      : "The analysis found no material unresolved discussion risk.",
  );
  const factors = [
    mergeabilityFactor,
    checkFactor,
    reviewFactor,
    lifecycleFactor,
    implementationFactor,
    discussionFactor,
  ];
  const rawScore = factors.reduce((total, candidate) => total + candidate.points, 0);
  const appliedCaps: string[] = [];
  let score = rawScore;
  const applyCap = (maximum: number, reason: string) => {
    if (score > maximum) score = maximum;
    appliedCaps.push(reason);
  };
  if (mergeability === "conflicting") applyCap(35, "Merge conflicts cap readiness at 35%.");
  if (pullRequest.checks.status === "failing") applyCap(55, "Failing checks cap readiness at 55%.");
  if (pullRequest.review.disposition === "changes-requested")
    applyCap(60, "Requested changes cap readiness at 60%.");
  if (pullRequest.isDraft) applyCap(70, "Draft state caps readiness at 70%.");

  const factualFactors = factors.slice(0, 4);
  const knownFactualWeight = factualFactors.reduce(
    (total, candidate) => total + (candidate.known ? candidate.possiblePoints : 0),
    0,
  );
  const confidence = clamp(
    (knownFactualWeight / 80) * 70 + (assessment.confidence / 100) * 30,
    0,
    100,
  );

  return {
    score: clamp(score, 0, 100),
    confidence,
    insufficientEvidence: knownFactualWeight < 40,
    factors,
    appliedCaps,
  };
}

export function buildPullRequestAiAnalysis(input: {
  readonly item: PullRequestInboxItem;
  readonly viewerKey: string;
  readonly modelSelection: PullRequestAiAnalysis["modelSelection"];
  readonly assessment: PullRequestAiModelAssessment;
  readonly mergeability?: SourceControlChangeRequestMergeability | undefined;
  readonly promptVersion: number;
  readonly schemaVersion: number;
  readonly sourceFingerprint: string;
  readonly analyzedAt: PullRequestAiAnalysis["analyzedAt"];
  readonly expiresAt: PullRequestAiAnalysis["expiresAt"];
}): PullRequestAiAnalysis {
  const deterministicPriorityPoints = deterministicPullRequestPriorityPoints(input.item);
  const modelPriorityPoints = modelPullRequestPriorityPoints(input.assessment);
  const priorityScore = clamp(deterministicPriorityPoints + modelPriorityPoints, 0, 100);
  return {
    pullRequestId: input.item.pullRequest.identity.id,
    viewerKey: input.viewerKey,
    modelSelection: input.modelSelection,
    promptVersion: input.promptVersion,
    schemaVersion: input.schemaVersion,
    sourceFingerprint: input.sourceFingerprint,
    sourceProviderUpdatedAt: input.item.pullRequest.freshness.providerUpdatedAt,
    depth: input.assessment.depth,
    priorityScore,
    priority: pullRequestAiPriorityForScore(priorityScore),
    deterministicPriorityPoints,
    modelPriorityPoints,
    priorityExplanation: input.assessment.attentionReason,
    assessment: input.assessment,
    mergeReadiness:
      input.item.pullRequest.state === "open"
        ? Option.some(
            calculatePullRequestMergeReadiness({
              item: input.item,
              assessment: input.assessment,
              ...(input.mergeability ? { mergeability: input.mergeability } : {}),
            })!,
          )
        : Option.none(),
    analyzedAt: input.analyzedAt,
    expiresAt: input.expiresAt,
    isStale: false,
  };
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJsonValue(entry)]),
    );
  }
  return value;
}

export function pullRequestAiSourceFingerprint(value: unknown): string {
  const canonical = JSON.stringify(stableJsonValue(value));
  return bytesToHex(sha256(utf8ToBytes(canonical)));
}

export function isPullRequestAiAnalysisCurrent(input: {
  readonly analysis: PullRequestAiAnalysis;
  readonly sourceFingerprint: string;
  readonly now?: number | undefined;
}): boolean {
  return (
    !input.analysis.isStale &&
    input.analysis.sourceFingerprint === input.sourceFingerprint &&
    DateTime.toEpochMillis(input.analysis.expiresAt) > (input.now ?? Date.now())
  );
}

export function sortPullRequestsByAiPriority(
  items: ReadonlyArray<PullRequestInboxItem>,
  analysisById: Readonly<Record<string, PullRequestAiAnalysis | undefined>>,
): ReadonlyArray<PullRequestInboxItem> {
  return items.toSorted((left, right) => {
    const leftAnalysis = analysisById[left.pullRequest.identity.id];
    const rightAnalysis = analysisById[right.pullRequest.identity.id];
    if (
      leftAnalysis &&
      rightAnalysis &&
      leftAnalysis.priorityScore !== rightAnalysis.priorityScore
    ) {
      return rightAnalysis.priorityScore - leftAnalysis.priorityScore;
    }
    if (leftAnalysis !== undefined) return -1;
    if (rightAnalysis !== undefined) return 1;
    const byDeterministicPriority =
      deterministicPullRequestPriorityPoints(right) - deterministicPullRequestPriorityPoints(left);
    if (byDeterministicPriority !== 0) return byDeterministicPriority;
    const leftUpdatedAt = Option.match(left.pullRequest.freshness.providerUpdatedAt, {
      onNone: () => DateTime.toEpochMillis(left.pullRequest.freshness.observedAt),
      onSome: DateTime.toEpochMillis,
    });
    const rightUpdatedAt = Option.match(right.pullRequest.freshness.providerUpdatedAt, {
      onNone: () => DateTime.toEpochMillis(right.pullRequest.freshness.observedAt),
      onSome: DateTime.toEpochMillis,
    });
    if (leftUpdatedAt !== rightUpdatedAt) return rightUpdatedAt - leftUpdatedAt;
    return left.pullRequest.identity.id.localeCompare(right.pullRequest.identity.id);
  });
}
