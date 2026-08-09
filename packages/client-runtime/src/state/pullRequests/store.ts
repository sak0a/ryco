import type {
  EnvironmentId,
  PullRequestAiAnalysis,
  PullRequestAiRun,
  PullRequestAiSnapshot,
  PullRequestId,
  PullRequestInboxItem,
  PullRequestInboxSnapshot,
  PullRequestRepositoryCoverage,
} from "@ryco/contracts";
import { DateTime, Option } from "effect";
import { create } from "zustand";

export interface PullRequestEnvironmentState {
  readonly generation: number;
  readonly itemIds: ReadonlyArray<PullRequestId>;
  readonly itemById: Readonly<Record<string, PullRequestInboxItem>>;
  readonly coverage: ReadonlyArray<PullRequestRepositoryCoverage>;
  readonly stale: boolean;
  readonly lastSuccessAt: PullRequestInboxSnapshot["lastSuccessAt"];
}

export interface PullRequestState {
  readonly environmentById: Readonly<Record<string, PullRequestEnvironmentState>>;
  readonly aiEnvironmentById: Readonly<Record<string, PullRequestAiEnvironmentState>>;
}

export interface PullRequestAiEnvironmentState {
  readonly generation: number;
  readonly analysisById: Readonly<Record<string, PullRequestAiAnalysis>>;
  readonly currentRun: Option.Option<PullRequestAiRun>;
  readonly latestRun: Option.Option<PullRequestAiRun>;
  readonly stale: boolean;
  readonly lastSuccessAt: PullRequestAiSnapshot["lastSuccessAt"];
}

const initialState: PullRequestState = { environmentById: {}, aiEnvironmentById: {} };

export const usePullRequestStore = create<PullRequestState>(() => initialState);

export function applyPullRequestSnapshot(
  environmentId: EnvironmentId,
  snapshot: PullRequestInboxSnapshot,
): boolean {
  const current = usePullRequestStore.getState().environmentById[environmentId];
  if (current && snapshot.generation < current.generation) return false;
  const itemById = Object.fromEntries(
    snapshot.items.map((item) => [item.pullRequest.identity.id, item]),
  );
  usePullRequestStore.setState((state) => ({
    environmentById: {
      ...state.environmentById,
      [environmentId]: {
        generation: snapshot.generation,
        itemIds: snapshot.items.map((item) => item.pullRequest.identity.id),
        itemById,
        coverage: snapshot.coverage,
        stale: false,
        lastSuccessAt: snapshot.lastSuccessAt,
      },
    },
  }));
  return true;
}

export function markPullRequestEnvironmentStale(environmentId: EnvironmentId): void {
  usePullRequestStore.setState((state) => {
    const current = state.environmentById[environmentId];
    if (!current || current.stale) return state;
    return {
      environmentById: {
        ...state.environmentById,
        [environmentId]: { ...current, stale: true },
      },
    };
  });
}

export function applyPullRequestAiSnapshot(
  environmentId: EnvironmentId,
  snapshot: PullRequestAiSnapshot,
): boolean {
  const current = usePullRequestStore.getState().aiEnvironmentById[environmentId];
  if (current && snapshot.generation < current.generation) return false;
  usePullRequestStore.setState((state) => ({
    aiEnvironmentById: {
      ...state.aiEnvironmentById,
      [environmentId]: {
        generation: snapshot.generation,
        analysisById: Object.fromEntries(
          snapshot.analyses.map((analysis) => [analysis.pullRequestId, analysis]),
        ),
        currentRun: snapshot.currentRun,
        latestRun: snapshot.latestRun,
        stale: false,
        lastSuccessAt: snapshot.lastSuccessAt,
      },
    },
  }));
  return true;
}

export function markPullRequestAiEnvironmentStale(environmentId: EnvironmentId): void {
  usePullRequestStore.setState((state) => {
    const current = state.aiEnvironmentById[environmentId];
    if (!current || current.stale) return state;
    return {
      aiEnvironmentById: {
        ...state.aiEnvironmentById,
        [environmentId]: { ...current, stale: true },
      },
    };
  });
}

export function resetPullRequestStore(): void {
  usePullRequestStore.setState(initialState, true);
}

function updatedAt(item: PullRequestInboxItem): number {
  return Option.match(item.pullRequest.freshness.providerUpdatedAt, {
    onNone: () => DateTime.toEpochMillis(item.pullRequest.freshness.observedAt),
    onSome: DateTime.toEpochMillis,
  });
}

export function selectFederatedPullRequests(
  state: Pick<PullRequestState, "environmentById">,
): ReadonlyArray<PullRequestInboxItem> {
  return Object.values(state.environmentById)
    .flatMap((environment) =>
      environment.itemIds.flatMap((id) => {
        const item = environment.itemById[id];
        return item ? [item] : [];
      }),
    )
    .toSorted((left, right) => {
      const byUpdate = updatedAt(right) - updatedAt(left);
      return byUpdate !== 0
        ? byUpdate
        : left.pullRequest.identity.id.localeCompare(right.pullRequest.identity.id);
    });
}

export function selectUnreadPullRequestCount(
  state: Pick<PullRequestState, "environmentById">,
): number {
  return selectFederatedPullRequests(state).filter((item) => item.viewState.isUnread).length;
}

export function selectFederatedPullRequestAiAnalyses(
  state: PullRequestState,
): Readonly<Record<string, PullRequestAiAnalysis>> {
  return Object.assign(
    {},
    ...Object.values(state.aiEnvironmentById).map((environment) => environment.analysisById),
  );
}

export function selectActivePullRequestAiRuns(
  state: PullRequestState,
): ReadonlyArray<PullRequestAiRun> {
  return Object.values(state.aiEnvironmentById).flatMap((environment) =>
    Option.isSome(environment.currentRun) ? [environment.currentRun.value] : [],
  );
}

export function selectPullRequestsForSubject(
  state: Pick<PullRequestState, "environmentById">,
  subjectKind: "thread" | "worktree",
  subjectId: string,
): ReadonlyArray<PullRequestInboxItem> {
  return selectFederatedPullRequests(state).filter((item) =>
    item.associations.some((association) => {
      if (Option.isSome(association.endedAt) || association.subject.kind !== subjectKind) {
        return false;
      }
      return association.subject.kind === "thread"
        ? association.subject.threadId === subjectId
        : association.subject.worktreeId === subjectId;
    }),
  );
}
