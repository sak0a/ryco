import { Effect, Schema } from "effect";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./orchestration.ts";

export const THREAD_PRIORITY_REASON_MAX_LENGTH = 160;

export const ThreadPriorityTier = Schema.Literals(["now", "soon", "later", "none"]);
export type ThreadPriorityTier = typeof ThreadPriorityTier.Type;

export const ThreadPriorityConfidence = Schema.Literals(["high", "medium", "low"]);
export type ThreadPriorityConfidence = typeof ThreadPriorityConfidence.Type;

export const ThreadPriorityReason = TrimmedNonEmptyString.check(
  Schema.isMaxLength(THREAD_PRIORITY_REASON_MAX_LENGTH),
);
export type ThreadPriorityReason = typeof ThreadPriorityReason.Type;

export const ThreadPriorityCandidateId = TrimmedNonEmptyString.check(Schema.isMaxLength(64)).pipe(
  Schema.brand("ThreadPriorityCandidateId"),
);
export type ThreadPriorityCandidateId = typeof ThreadPriorityCandidateId.Type;

export const ThreadPriorityBatchId = TrimmedNonEmptyString.check(Schema.isMaxLength(128)).pipe(
  Schema.brand("ThreadPriorityBatchId"),
);
export type ThreadPriorityBatchId = typeof ThreadPriorityBatchId.Type;

export const ThreadPriorityFingerprint = TrimmedNonEmptyString.check(Schema.isMaxLength(128)).pipe(
  Schema.brand("ThreadPriorityFingerprint"),
);
export type ThreadPriorityFingerprint = typeof ThreadPriorityFingerprint.Type;

/** Structured provider output before an opaque candidate ID is mapped to a thread. */
export const ThreadPriorityCandidateRanking = Schema.Struct({
  candidateId: ThreadPriorityCandidateId,
  tier: ThreadPriorityTier,
  confidence: ThreadPriorityConfidence,
  reason: ThreadPriorityReason,
});
export type ThreadPriorityCandidateRanking = typeof ThreadPriorityCandidateRanking.Type;

/** Server-owned ranking projected to clients after candidate validation. */
export const ThreadPriorityRankedEntry = Schema.Struct({
  threadId: ThreadId,
  tier: ThreadPriorityTier,
  confidence: ThreadPriorityConfidence,
  reason: ThreadPriorityReason,
  inputFingerprint: ThreadPriorityFingerprint,
});
export type ThreadPriorityRankedEntry = typeof ThreadPriorityRankedEntry.Type;

export const ThreadPriorityFreshnessMetadata = Schema.Struct({
  rankedAt: IsoDateTime,
  usableUntil: IsoDateTime,
  checkedAt: IsoDateTime,
});
export type ThreadPriorityFreshnessMetadata = typeof ThreadPriorityFreshnessMetadata.Type;

export const ThreadPriorityBatchSnapshot = Schema.Struct({
  batchId: ThreadPriorityBatchId,
  modelSelection: ModelSelection,
  modelFingerprint: ThreadPriorityFingerprint,
  promptVersion: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  freshness: ThreadPriorityFreshnessMetadata,
  entries: Schema.Array(ThreadPriorityRankedEntry),
});
export type ThreadPriorityBatchSnapshot = typeof ThreadPriorityBatchSnapshot.Type;

export const ThreadPriorityFailureKind = Schema.Literals([
  "unsupported",
  "provider-unavailable",
  "provider-failure",
  "malformed-response",
  "duplicate-candidate-id",
  "unknown-candidate-id",
  "rate-limited",
  "internal",
]);
export type ThreadPriorityFailureKind = typeof ThreadPriorityFailureKind.Type;

export const ThreadPriorityFailure = Schema.Struct({
  kind: ThreadPriorityFailureKind,
  detail: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  candidateId: Schema.optionalKey(ThreadPriorityCandidateId),
});
export type ThreadPriorityFailure = typeof ThreadPriorityFailure.Type;

export class ThreadPriorityRpcError extends Schema.TaggedError<ThreadPriorityRpcError>()(
  "ThreadPriorityRpcError",
  {
    failure: ThreadPriorityFailure,
  },
) {
  override get message(): string {
    return `Thread priority ranking failed (${this.failure.kind}): ${this.failure.detail}`;
  }
}

export const ThreadPriorityEnsureCurrentInput = Schema.Struct({
  force: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type ThreadPriorityEnsureCurrentInput = typeof ThreadPriorityEnsureCurrentInput.Type;

export const ThreadPriorityEnsureCurrentDisposition = Schema.Literals(["cache-hit", "ranked"]);
export type ThreadPriorityEnsureCurrentDisposition =
  typeof ThreadPriorityEnsureCurrentDisposition.Type;

export const ThreadPriorityEnsureCurrentResult = Schema.Struct({
  batchId: ThreadPriorityBatchId,
  disposition: ThreadPriorityEnsureCurrentDisposition,
  freshness: ThreadPriorityFreshnessMetadata,
});
export type ThreadPriorityEnsureCurrentResult = typeof ThreadPriorityEnsureCurrentResult.Type;
