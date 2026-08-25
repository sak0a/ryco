import { Effect, Option, Queue, Ref, Stream } from "effect";
import {
  type OrchestrationEvent,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamEvent,
  OrchestrationGetSnapshotError,
  ThreadId,
  WorktreeId,
} from "@ryco/contracts";

import type { OrchestrationEngineShape } from "../../orchestration/Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQueryShape } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { RepositoryIdentityResolverShape } from "../../project/Services/RepositoryIdentityResolver.ts";
import {
  type WsReplayMetrics,
  type WsReplayStreamKind,
  makeWsReplayMetrics,
} from "../../wsReplayMetrics.ts";
import {
  ORCHESTRATION_LIVE_QUEUE_MAX_EVENTS,
  ORCHESTRATION_REPLAY_PAGE_MAX_LIMIT,
} from "./constants.ts";
import { isThreadDetailEvent } from "./orchestrationEvents.ts";
import { randomShortId } from "./branchNaming.ts";

const makeLiveQueueOverflowError = (input: {
  readonly stream: WsReplayStreamKind;
  readonly sequence: number;
  readonly capacity: number;
}) =>
  new OrchestrationGetSnapshotError({
    message: `Orchestration ${input.stream} live event queue overflowed; reconnect to resynchronize`,
    cause: new Error(
      `orchestration ${input.stream} live queue overflow at sequence ${input.sequence} with capacity ${input.capacity}`,
    ),
  });

export const offerOrchestrationLiveEventOrFail = (input: {
  readonly stream: WsReplayStreamKind;
  readonly event: OrchestrationEvent;
  readonly liveQueue: Queue.Queue<OrchestrationEvent, OrchestrationGetSnapshotError>;
  readonly overflowedRef: Ref.Ref<boolean>;
  readonly replayMetrics: WsReplayMetrics;
  readonly capacity?: number;
}) =>
  Effect.gen(function* () {
    const capacity = input.capacity ?? ORCHESTRATION_LIVE_QUEUE_MAX_EVENTS;
    if (Queue.offerUnsafe(input.liveQueue, input.event)) {
      yield* input.replayMetrics.recordLiveEnqueued(input.event.sequence);
      return;
    }

    const shouldFail = yield* Ref.modify(input.overflowedRef, (overflowed) => [!overflowed, true]);
    if (!shouldFail) {
      return;
    }

    yield* input.replayMetrics.recordLiveOverflow(input.event.sequence, capacity);
    yield* Effect.logWarning("orchestration live stream queue overflow; forcing resync", {
      stream: input.stream,
      sequence: input.event.sequence,
      capacity,
    });
    yield* Queue.fail(
      input.liveQueue,
      makeLiveQueueOverflowError({
        stream: input.stream,
        sequence: input.event.sequence,
        capacity,
      }),
    );
  });

export const offerOrchestrationThreadLiveEventOrFail = (input: {
  readonly threadId: ThreadId;
  readonly event: OrchestrationEvent;
  readonly recordLiveSequence: (sequence: number) => Effect.Effect<void, never, never>;
  readonly liveQueue: Queue.Queue<OrchestrationEvent, OrchestrationGetSnapshotError>;
  readonly overflowedRef: Ref.Ref<boolean>;
  readonly replayMetrics: WsReplayMetrics;
  readonly capacity?: number;
}) =>
  Effect.gen(function* () {
    yield* input.recordLiveSequence(input.event.sequence);
    if (
      input.event.aggregateKind !== "thread" ||
      input.event.aggregateId !== input.threadId ||
      !isThreadDetailEvent(input.event)
    ) {
      return false;
    }

    yield* offerOrchestrationLiveEventOrFail({
      stream: "thread",
      event: input.event,
      liveQueue: input.liveQueue,
      overflowedRef: input.overflowedRef,
      replayMetrics: input.replayMetrics,
      ...(input.capacity === undefined ? {} : { capacity: input.capacity }),
    });
    return true;
  });

export const makeOrchestrationStreamHelpers = (deps: {
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly projectionSnapshotQuery: ProjectionSnapshotQueryShape;
  readonly repositoryIdentityResolver: RepositoryIdentityResolverShape;
  readonly threadPriorityChanges?: Stream.Stream<void>;
}) => {
  const { orchestrationEngine, projectionSnapshotQuery, repositoryIdentityResolver } = deps;
  const threadPriorityChanges = deps.threadPriorityChanges ?? Stream.empty;

  const enrichProjectEvent = (
    event: OrchestrationEvent,
  ): Effect.Effect<OrchestrationEvent, never, never> => {
    switch (event.type) {
      case "project.created":
        return repositoryIdentityResolver.resolve(event.payload.workspaceRoot).pipe(
          Effect.map((repositoryIdentity) => ({
            ...event,
            payload: {
              ...event.payload,
              repositoryIdentity,
            },
          })),
        );
      case "project.meta-updated":
        return Effect.gen(function* () {
          const workspaceRoot =
            event.payload.workspaceRoot ??
            Option.match(
              yield* projectionSnapshotQuery.getProjectShellById(event.payload.projectId),
              {
                onNone: () => null,
                onSome: (project) => project.workspaceRoot,
              },
            ) ??
            null;
          if (workspaceRoot === null) {
            return event;
          }

          const repositoryIdentity = yield* repositoryIdentityResolver.resolve(workspaceRoot);
          return {
            ...event,
            payload: {
              ...event.payload,
              repositoryIdentity,
            },
          } satisfies OrchestrationEvent;
        }).pipe(Effect.catch(() => Effect.succeed(event)));
      default:
        return Effect.succeed(event);
    }
  };

  const enrichOrchestrationEvents = (events: ReadonlyArray<OrchestrationEvent>) =>
    Effect.forEach(events, enrichProjectEvent, { concurrency: 4 });

  const toShellStreamEvent = (
    event: OrchestrationEvent,
  ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> => {
    switch (event.type) {
      case "project.created":
      case "project.meta-updated":
        return projectionSnapshotQuery.getProjectShellById(event.payload.projectId).pipe(
          Effect.map((project) =>
            Option.map(project, (nextProject) => ({
              kind: "project-upserted" as const,
              sequence: event.sequence,
              project: nextProject,
            })),
          ),
          Effect.catch(() => Effect.succeed(Option.none())),
        );
      case "project.deleted":
        return Effect.succeed(
          Option.some({
            kind: "project-removed" as const,
            sequence: event.sequence,
            projectId: event.payload.projectId,
          }),
        );
      case "thread.deleted":
        return Effect.succeed(
          Option.some({
            kind: "thread-removed" as const,
            sequence: event.sequence,
            threadId: event.payload.threadId,
          }),
        );
      case "worktree.created":
      case "worktree.archived":
      case "worktree.metaUpdated":
      case "worktree.restored": {
        const getWorktreeShellById = projectionSnapshotQuery.getWorktreeShellById;
        if (getWorktreeShellById === undefined) {
          return Effect.succeed(Option.none());
        }
        return getWorktreeShellById(WorktreeId.make(event.payload.worktreeId)).pipe(
          Effect.map((worktree) =>
            Option.map(worktree, (nextWorktree) => ({
              kind: "worktree-upserted" as const,
              sequence: event.sequence,
              worktree: nextWorktree,
            })),
          ),
          Effect.catch(() => Effect.succeed(Option.none())),
        );
      }
      case "worktree.deleted":
        return Effect.succeed(
          Option.some({
            kind: "worktree-removed" as const,
            sequence: event.sequence,
            worktreeId: event.payload.worktreeId,
          }),
        );
      default:
        if (event.aggregateKind !== "thread") {
          return Effect.succeed(Option.none());
        }
        return projectionSnapshotQuery.getThreadShellById(ThreadId.make(event.aggregateId)).pipe(
          Effect.map((thread) =>
            Option.map(thread, (nextThread) => ({
              kind: "thread-upserted" as const,
              sequence: event.sequence,
              thread: nextThread,
            })),
          ),
          Effect.catch(() => Effect.succeed(Option.none())),
        );
    }
  };

  const dedupeBySequence =
    <A>(getSequence: (item: A) => number, sequenceRef: Ref.Ref<number>) =>
    <E, R>(stream: Stream.Stream<A, E, R>): Stream.Stream<A, E, R> =>
      stream.pipe(
        Stream.filterEffect((item) =>
          Ref.modify(sequenceRef, (lastSequence) => {
            const nextSequence = getSequence(item);
            if (nextSequence <= lastSequence) {
              return [false, lastSequence] as const;
            }
            return [true, nextSequence] as const;
          }),
        ),
      );

  const makeReplayBoundaryTracker = (snapshotSequence: number) =>
    Effect.gen(function* () {
      const latestLiveSequence = yield* Ref.make(snapshotSequence);
      const replayUpperBound = yield* Ref.make<Option.Option<number>>(Option.none());

      const captureReplayUpperBound = Effect.gen(function* () {
        const existingUpperBound = yield* Ref.get(replayUpperBound);
        if (Option.isSome(existingUpperBound)) {
          return existingUpperBound;
        }

        const latestSequence = yield* Ref.get(latestLiveSequence);
        if (latestSequence <= snapshotSequence) {
          return Option.none<number>();
        }

        const upperBound = Option.some(latestSequence);
        yield* Ref.set(replayUpperBound, upperBound);
        return upperBound;
      });

      return {
        recordLiveSequence: (sequence: number) =>
          Ref.update(latestLiveSequence, (current) => Math.max(current, sequence)),
        captureReplayUpperBound,
      };
    });

  const makeBoundedReplayStream = (input: {
    readonly snapshotSequence: number;
    readonly captureReplayUpperBound: Effect.Effect<Option.Option<number>>;
    readonly errorMessage: string;
  }): Stream.Stream<OrchestrationEvent, OrchestrationGetSnapshotError> => {
    const readPage = (
      fromSequenceExclusive: number,
    ): Stream.Stream<OrchestrationEvent, OrchestrationGetSnapshotError> =>
      Stream.unwrap(
        Effect.gen(function* () {
          const upperBoundBeforeRead = yield* input.captureReplayUpperBound;
          if (
            Option.isSome(upperBoundBeforeRead) &&
            fromSequenceExclusive >= upperBoundBeforeRead.value
          ) {
            return Stream.empty;
          }

          const page = yield* orchestrationEngine
            .readEventsPage(fromSequenceExclusive, ORCHESTRATION_REPLAY_PAGE_MAX_LIMIT)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetSnapshotError({
                    message: input.errorMessage,
                    cause,
                  }),
              ),
            );
          const upperBound = Option.isSome(upperBoundBeforeRead)
            ? upperBoundBeforeRead
            : yield* input.captureReplayUpperBound;
          const replayEvents = Option.isSome(upperBound)
            ? page.events.filter((event) => event.sequence <= upperBound.value)
            : page.events;

          if (replayEvents.length === 0) {
            return Stream.empty;
          }

          const nextSequence = replayEvents[replayEvents.length - 1]?.sequence ?? page.nextSequence;
          const reachedUpperBound = Option.isSome(upperBound) && nextSequence >= upperBound.value;
          const reachedReplayEnd = !page.hasMore || page.nextSequence <= fromSequenceExclusive;
          const currentPageStream = Stream.fromIterable(replayEvents);
          return reachedUpperBound || reachedReplayEnd
            ? currentPageStream
            : Stream.concat(currentPageStream, readPage(page.nextSequence));
        }),
      );

    return readPage(input.snapshotSequence);
  };

  const shellEventsFromDomainEvents = <E, R>(
    stream: Stream.Stream<OrchestrationEvent, E, R>,
  ): Stream.Stream<OrchestrationShellStreamEvent, E, R> =>
    stream.pipe(
      Stream.mapEffect(toShellStreamEvent),
      Stream.flatMap((event) =>
        Option.isSome(event) ? Stream.succeed(event.value) : Stream.empty,
      ),
    );

  const makeReplayableShellStream = (
    snapshot: Effect.Effect<OrchestrationShellSnapshot, OrchestrationGetSnapshotError>,
  ) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const loadedSnapshot = yield* snapshot;
        const snapshotSequence = loadedSnapshot.snapshotSequence;
        const liveSubscription = yield* orchestrationEngine.subscribeDomainEvents;
        const liveQueue = yield* Queue.bounded<OrchestrationEvent, OrchestrationGetSnapshotError>(
          ORCHESTRATION_LIVE_QUEUE_MAX_EVENTS,
        );
        const lastSequenceRef = yield* Ref.make(snapshotSequence);
        const overflowedRef = yield* Ref.make(false);
        const replayBoundary = yield* makeReplayBoundaryTracker(snapshotSequence);
        const replayMetrics = yield* makeWsReplayMetrics({
          stream: "shell",
          subscriptionId: randomShortId(),
          snapshotSequence,
        });

        yield* Stream.fromSubscription(liveSubscription).pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              yield* replayBoundary.recordLiveSequence(event.sequence);
              yield* offerOrchestrationLiveEventOrFail({
                stream: "shell",
                event,
                liveQueue,
                overflowedRef,
                replayMetrics,
              });
            }),
          ),
          Effect.ensuring(Queue.shutdown(liveQueue)),
          Effect.ignoreCause({ log: true }),
          Effect.forkScoped,
        );

        const replayStream = makeBoundedReplayStream({
          snapshotSequence,
          captureReplayUpperBound: replayBoundary.captureReplayUpperBound,
          errorMessage: "Failed to replay orchestration shell events",
        }).pipe(Stream.tap((event) => replayMetrics.recordReplayEvent(event.sequence)));
        const liveStream = Stream.fromQueue(liveQueue).pipe(
          Stream.tap((event) => replayMetrics.recordLiveDequeued(event.sequence)),
        );

        const eventStream = Stream.concat(
          shellEventsFromDomainEvents(replayStream),
          shellEventsFromDomainEvents(liveStream),
        ).pipe(dedupeBySequence((event) => event.sequence, lastSequenceRef));
        const prioritySnapshotStream = threadPriorityChanges.pipe(
          Stream.mapEffect(() => snapshot),
          Stream.map((nextSnapshot) => ({
            kind: "snapshot" as const,
            snapshot: nextSnapshot,
          })),
        );

        return Stream.concat(
          Stream.make({
            kind: "snapshot" as const,
            snapshot: loadedSnapshot,
          }),
          Stream.merge(eventStream, prioritySnapshotStream),
        ).pipe(Stream.ensuring(replayMetrics.reset));
      }),
    );

  const makeReplayableThreadStream = <
    Snapshot extends { readonly snapshotSequence: number },
    SnapshotError,
  >(
    snapshot: Effect.Effect<Snapshot, SnapshotError>,
    threadId: ThreadId,
  ) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const loadedSnapshot = yield* snapshot;
        const snapshotSequence = loadedSnapshot.snapshotSequence;
        const liveSubscription = yield* orchestrationEngine.subscribeDomainEvents;
        const liveQueue = yield* Queue.bounded<OrchestrationEvent, OrchestrationGetSnapshotError>(
          ORCHESTRATION_LIVE_QUEUE_MAX_EVENTS,
        );
        const lastSequenceRef = yield* Ref.make(snapshotSequence);
        const overflowedRef = yield* Ref.make(false);
        const replayBoundary = yield* makeReplayBoundaryTracker(snapshotSequence);
        const replayMetrics = yield* makeWsReplayMetrics({
          stream: "thread",
          subscriptionId: randomShortId(),
          snapshotSequence,
        });

        const isMatchingThreadEvent = (event: OrchestrationEvent) =>
          event.aggregateKind === "thread" &&
          event.aggregateId === threadId &&
          isThreadDetailEvent(event);

        const threadEvents = <E, R>(stream: Stream.Stream<OrchestrationEvent, E, R>) =>
          stream.pipe(
            Stream.filter(isMatchingThreadEvent),
            Stream.map((event) => ({
              kind: "event" as const,
              event,
            })),
          );

        yield* Stream.fromSubscription(liveSubscription).pipe(
          Stream.runForEach((event) =>
            offerOrchestrationThreadLiveEventOrFail({
              threadId,
              event,
              recordLiveSequence: replayBoundary.recordLiveSequence,
              liveQueue,
              overflowedRef,
              replayMetrics,
            }),
          ),
          Effect.ensuring(Queue.shutdown(liveQueue)),
          Effect.ignoreCause({ log: true }),
          Effect.forkScoped,
        );

        const replayStream = makeBoundedReplayStream({
          snapshotSequence,
          captureReplayUpperBound: replayBoundary.captureReplayUpperBound,
          errorMessage: "Failed to replay orchestration thread events",
        }).pipe(Stream.tap((event) => replayMetrics.recordReplayEvent(event.sequence)));
        const liveStream = Stream.fromQueue(liveQueue).pipe(
          Stream.tap((event) => replayMetrics.recordLiveDequeued(event.sequence)),
        );

        const eventStream = Stream.concat(
          threadEvents(replayStream),
          threadEvents(liveStream),
        ).pipe(dedupeBySequence((item) => item.event.sequence, lastSequenceRef));

        return Stream.concat(
          Stream.make({
            kind: "snapshot" as const,
            snapshot: loadedSnapshot,
          }),
          eventStream,
        ).pipe(Stream.ensuring(replayMetrics.reset));
      }),
    );

  return {
    enrichOrchestrationEvents,
    makeReplayableShellStream,
    makeReplayableThreadStream,
  };
};
