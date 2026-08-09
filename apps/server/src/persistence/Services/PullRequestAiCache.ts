import type {
  EnvironmentId,
  PullRequestAiAnalysis,
  PullRequestAiRun,
  PullRequestAiSnapshot,
  PullRequestId,
} from "@ryco/contracts";
import { Context } from "effect";
import type { Effect, Option, Stream } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export interface PullRequestAiCacheShape {
  readonly streamChanges: Stream.Stream<void>;
  readonly getCurrentAnalysis: (input: {
    readonly pullRequestId: PullRequestId;
    readonly viewerKey: string;
  }) => Effect.Effect<Option.Option<PullRequestAiAnalysis>, ProjectionRepositoryError>;
  readonly upsertAnalysis: (
    analysis: PullRequestAiAnalysis,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertRun: (run: PullRequestAiRun) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listSnapshot: (input: {
    readonly environmentId: EnvironmentId;
    readonly viewerKey: string;
  }) => Effect.Effect<PullRequestAiSnapshot, ProjectionRepositoryError>;
}

export class PullRequestAiCache extends Context.Service<
  PullRequestAiCache,
  PullRequestAiCacheShape
>()("ryco/persistence/Services/PullRequestAiCache") {}
