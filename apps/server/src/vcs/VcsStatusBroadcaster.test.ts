import { assert, it, describe } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  Deferred,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Fiber,
  Layer,
  Option,
  Path,
  Scope,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import type {
  VcsStatusLocalResult,
  VcsStatusRemoteResult,
  VcsStatusResult,
  VcsStatusStreamEvent,
} from "@ryco/contracts";

import * as VcsStatusBroadcaster from "./VcsStatusBroadcaster.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";

const baseLocalStatus: VcsStatusLocalResult = {
  isRepo: true,
  sourceControlProvider: {
    kind: "github",
    name: "GitHub",
    baseUrl: "https://github.com",
  },
  hasPrimaryRemote: true,
  isDefaultRef: false,
  refName: "feature/status-broadcast",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
};

const baseRemoteStatus: VcsStatusRemoteResult = {
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
};

const baseStatus: VcsStatusResult = {
  ...baseLocalStatus,
  ...baseRemoteStatus,
};

function makeTestLayer(state: {
  currentLocalStatus: VcsStatusLocalResult;
  currentRemoteStatus: VcsStatusRemoteResult | null;
  localStatusCalls: number;
  remoteStatusCalls: number;
  localInvalidationCalls: number;
  remoteInvalidationCalls: number;
}) {
  return VcsStatusBroadcaster.layer.pipe(
    Layer.provide(
      Layer.mock(GitWorkflowService.GitWorkflowService)({
        localStatus: () =>
          Effect.sync(() => {
            state.localStatusCalls += 1;
            return state.currentLocalStatus;
          }),
        remoteStatus: () =>
          Effect.sync(() => {
            state.remoteStatusCalls += 1;
            return state.currentRemoteStatus;
          }),
        invalidateLocalStatus: () =>
          Effect.sync(() => {
            state.localInvalidationCalls += 1;
          }),
        invalidateRemoteStatus: () =>
          Effect.sync(() => {
            state.remoteInvalidationCalls += 1;
          }),
      }),
    ),
  );
}

describe("VcsStatusBroadcaster", () => {
  it("backs off remote refresh failures from the configured interval", () => {
    assert.equal(
      Duration.toMillis(VcsStatusBroadcaster.remoteRefreshFailureDelay(1, Duration.seconds(5))),
      30_000,
    );
    assert.equal(
      Duration.toMillis(VcsStatusBroadcaster.remoteRefreshFailureDelay(2, Duration.seconds(5))),
      60_000,
    );
    assert.equal(
      Duration.toMillis(VcsStatusBroadcaster.remoteRefreshFailureDelay(10, Duration.seconds(5))),
      Duration.toMillis(Duration.minutes(15)),
    );
    assert.equal(
      Duration.toMillis(
        VcsStatusBroadcaster.remoteRefreshFailureDelay(10_000, Duration.seconds(5)),
      ),
      Duration.toMillis(Duration.minutes(15)),
    );
  });

  it.effect("reuses the cached VCS status across repeated reads", () => {
    const state = {
      currentLocalStatus: baseLocalStatus,
      currentRemoteStatus: baseRemoteStatus,
      localStatusCalls: 0,
      remoteStatusCalls: 0,
      localInvalidationCalls: 0,
      remoteInvalidationCalls: 0,
    };

    return Effect.gen(function* () {
      const broadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;

      const first = yield* broadcaster.getStatus({ cwd: "/repo" });
      const second = yield* broadcaster.getStatus({ cwd: "/repo" });

      assert.deepStrictEqual(first, baseStatus);
      assert.deepStrictEqual(second, baseStatus);
      assert.equal(state.localStatusCalls, 1);
      assert.equal(state.remoteStatusCalls, 1);
      assert.equal(state.localInvalidationCalls, 0);
      assert.equal(state.remoteInvalidationCalls, 0);
    }).pipe(Effect.provide(makeTestLayer(state)));
  });

  it.effect("expires local and remote broadcaster cache entries at their workflow TTLs", () => {
    const state = {
      currentLocalStatus: baseLocalStatus,
      currentRemoteStatus: baseRemoteStatus,
      localStatusCalls: 0,
      remoteStatusCalls: 0,
      localInvalidationCalls: 0,
      remoteInvalidationCalls: 0,
    };

    return Effect.gen(function* () {
      const broadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;

      yield* broadcaster.getStatus({ cwd: "/repo" });
      yield* TestClock.adjust(Duration.millis(4_999));
      yield* broadcaster.getStatus({ cwd: "/repo" });

      assert.equal(state.localStatusCalls, 1);
      assert.equal(state.remoteStatusCalls, 1);

      state.currentLocalStatus = {
        ...baseLocalStatus,
        refName: "feature/expired-local-status",
      };
      yield* TestClock.adjust(Duration.millis(1));
      const remountedSnapshot = yield* Stream.runHead(broadcaster.streamStatus({ cwd: "/repo" }));

      assert.deepStrictEqual(Option.getOrThrow(remountedSnapshot), {
        _tag: "snapshot",
        local: state.currentLocalStatus,
        remote: baseRemoteStatus,
      } satisfies VcsStatusStreamEvent);
      assert.equal(state.localStatusCalls, 2);
      assert.equal(state.remoteStatusCalls, 1);

      state.currentRemoteStatus = {
        ...baseRemoteStatus,
        behindCount: 3,
      };
      yield* TestClock.adjust(Duration.seconds(25));
      const expiredStreamSnapshot = yield* Stream.runHead(
        broadcaster.streamStatus({ cwd: "/repo" }),
      );

      assert.deepStrictEqual(Option.getOrThrow(expiredStreamSnapshot), {
        _tag: "snapshot",
        local: state.currentLocalStatus,
        remote: null,
      } satisfies VcsStatusStreamEvent);
      assert.equal(state.localStatusCalls, 3);
      assert.equal(state.remoteStatusCalls, 1);

      const expired = yield* broadcaster.getStatus({ cwd: "/repo" });

      assert.deepStrictEqual(expired, {
        ...state.currentLocalStatus,
        ...state.currentRemoteStatus,
      });
      assert.equal(state.localStatusCalls, 3);
      assert.equal(state.remoteStatusCalls, 2);
      assert.equal(state.localInvalidationCalls, 0);
      assert.equal(state.remoteInvalidationCalls, 0);
    }).pipe(Effect.provide(Layer.merge(makeTestLayer(state), TestClock.layer())));
  });

  it.effect("refreshes the cached snapshot after explicit invalidation", () => {
    const state = {
      currentLocalStatus: baseLocalStatus,
      currentRemoteStatus: baseRemoteStatus,
      localStatusCalls: 0,
      remoteStatusCalls: 0,
      localInvalidationCalls: 0,
      remoteInvalidationCalls: 0,
    };

    return Effect.gen(function* () {
      const broadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
      const initial = yield* broadcaster.getStatus({ cwd: "/repo" });

      state.currentLocalStatus = {
        ...baseLocalStatus,
        refName: "feature/updated-status",
      };
      state.currentRemoteStatus = {
        ...baseRemoteStatus,
        aheadCount: 2,
      };
      const refreshed = yield* broadcaster.refreshStatus("/repo");
      const cached = yield* broadcaster.getStatus({ cwd: "/repo" });

      assert.deepStrictEqual(initial, baseStatus);
      assert.deepStrictEqual(refreshed, {
        ...state.currentLocalStatus,
        ...state.currentRemoteStatus,
      });
      assert.deepStrictEqual(cached, {
        ...state.currentLocalStatus,
        ...state.currentRemoteStatus,
      });
      assert.equal(state.localStatusCalls, 2);
      assert.equal(state.remoteStatusCalls, 2);
      assert.equal(state.localInvalidationCalls, 1);
      assert.equal(state.remoteInvalidationCalls, 1);
    }).pipe(Effect.provide(makeTestLayer(state)));
  });

  it.effect("refreshes only the cached local snapshot when requested", () => {
    const state = {
      currentLocalStatus: baseLocalStatus,
      currentRemoteStatus: baseRemoteStatus,
      localStatusCalls: 0,
      remoteStatusCalls: 0,
      localInvalidationCalls: 0,
      remoteInvalidationCalls: 0,
    };

    return Effect.gen(function* () {
      const broadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
      const initial = yield* broadcaster.getStatus({ cwd: "/repo" });

      state.currentLocalStatus = {
        ...baseLocalStatus,
        refName: "feature/local-only-refresh",
        hasWorkingTreeChanges: true,
      };

      const refreshedLocal = yield* broadcaster.refreshLocalStatus("/repo");
      const cached = yield* broadcaster.getStatus({ cwd: "/repo" });

      assert.deepStrictEqual(initial, baseStatus);
      assert.deepStrictEqual(refreshedLocal, state.currentLocalStatus);
      assert.deepStrictEqual(cached, {
        ...state.currentLocalStatus,
        ...baseRemoteStatus,
      });
      assert.equal(state.localStatusCalls, 2);
      assert.equal(state.remoteStatusCalls, 1);
      assert.equal(state.localInvalidationCalls, 1);
      assert.equal(state.remoteInvalidationCalls, 0);
    }).pipe(Effect.provide(makeTestLayer(state)));
  });

  it.effect("coalesces concurrent refreshes across normalized CWD aliases", () => {
    const state = {
      currentLocalStatus: baseLocalStatus,
      currentRemoteStatus: baseRemoteStatus,
      localStatusCalls: 0,
      remoteStatusCalls: 0,
      localInvalidationCalls: 0,
      remoteInvalidationCalls: 0,
    };
    let localStartedDeferred: Deferred.Deferred<void> | null = null;
    let remoteStartedDeferred: Deferred.Deferred<void> | null = null;
    let releaseLocalDeferred: Deferred.Deferred<void> | null = null;
    let releaseRemoteDeferred: Deferred.Deferred<void> | null = null;
    const testLayer = VcsStatusBroadcaster.layer.pipe(
      Layer.provide(
        Layer.mock(GitWorkflowService.GitWorkflowService)({
          localStatus: () =>
            Effect.gen(function* () {
              state.localStatusCalls += 1;
              if (localStartedDeferred) {
                yield* Deferred.succeed(localStartedDeferred, undefined).pipe(Effect.ignore);
              }
              if (releaseLocalDeferred) {
                yield* Deferred.await(releaseLocalDeferred);
              }
              return state.currentLocalStatus;
            }),
          remoteStatus: () =>
            Effect.gen(function* () {
              state.remoteStatusCalls += 1;
              if (remoteStartedDeferred) {
                yield* Deferred.succeed(remoteStartedDeferred, undefined).pipe(Effect.ignore);
              }
              if (releaseRemoteDeferred) {
                yield* Deferred.await(releaseRemoteDeferred);
              }
              return state.currentRemoteStatus;
            }),
          invalidateLocalStatus: () =>
            Effect.sync(() => {
              state.localInvalidationCalls += 1;
            }),
          invalidateRemoteStatus: () =>
            Effect.sync(() => {
              state.remoteInvalidationCalls += 1;
            }),
        } satisfies Partial<GitWorkflowService.GitWorkflowServiceShape>),
      ),
    );

    return Effect.gen(function* () {
      localStartedDeferred = yield* Deferred.make<void>();
      remoteStartedDeferred = yield* Deferred.make<void>();
      releaseLocalDeferred = yield* Deferred.make<void>();
      releaseRemoteDeferred = yield* Deferred.make<void>();

      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const realDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "ryco-vcs-status-coalesced-real-",
      });
      const linkParent = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "ryco-vcs-status-coalesced-link-",
      });
      const linkDir = path.join(linkParent, "repo-link");
      yield* fileSystem.symlink(realDir, linkDir);

      const broadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
      const first = yield* broadcaster.refreshStatus(linkDir).pipe(Effect.forkScoped);
      yield* Deferred.await(localStartedDeferred);

      const second = yield* broadcaster.refreshStatus(realDir).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      assert.equal(state.localInvalidationCalls, 1);
      assert.equal(state.localStatusCalls, 1);
      assert.equal(state.remoteInvalidationCalls, 0);
      assert.equal(state.remoteStatusCalls, 0);

      yield* Deferred.succeed(releaseLocalDeferred, undefined);
      yield* Deferred.await(remoteStartedDeferred);
      yield* Effect.yieldNow;

      assert.equal(state.remoteInvalidationCalls, 1);
      assert.equal(state.remoteStatusCalls, 1);

      yield* Deferred.succeed(releaseRemoteDeferred, undefined);
      const [firstResult, secondResult] = yield* Effect.all([
        Fiber.join(first),
        Fiber.join(second),
      ]);

      assert.deepStrictEqual(firstResult, baseStatus);
      assert.deepStrictEqual(secondResult, baseStatus);

      state.currentLocalStatus = { ...baseLocalStatus, refName: "feature/after-coalescing" };
      state.currentRemoteStatus = { ...baseRemoteStatus, aheadCount: 1 };
      const explicitlyRefreshed = yield* broadcaster.refreshStatus(realDir);

      assert.deepStrictEqual(explicitlyRefreshed, {
        ...state.currentLocalStatus,
        ...state.currentRemoteStatus,
      });
      assert.equal(state.localInvalidationCalls, 2);
      assert.equal(state.remoteInvalidationCalls, 2);
      assert.equal(state.localStatusCalls, 2);
      assert.equal(state.remoteStatusCalls, 2);
    }).pipe(Effect.provide(Layer.mergeAll(testLayer, NodeServices.layer)));
  });

  it.effect("keeps a shared refresh alive when its first caller is interrupted", () => {
    const state = {
      currentLocalStatus: baseLocalStatus,
      currentRemoteStatus: baseRemoteStatus,
      localStatusCalls: 0,
      remoteStatusCalls: 0,
      localInvalidationCalls: 0,
      remoteInvalidationCalls: 0,
    };
    let localStartedDeferred: Deferred.Deferred<void> | null = null;
    let localInterruptedDeferred: Deferred.Deferred<void> | null = null;
    let releaseLocalDeferred: Deferred.Deferred<void> | null = null;
    const testLayer = VcsStatusBroadcaster.layer.pipe(
      Layer.provide(
        Layer.mock(GitWorkflowService.GitWorkflowService)({
          localStatus: () =>
            Effect.gen(function* () {
              state.localStatusCalls += 1;
              if (localStartedDeferred) {
                yield* Deferred.succeed(localStartedDeferred, undefined).pipe(Effect.ignore);
              }
              if (releaseLocalDeferred) {
                yield* Deferred.await(releaseLocalDeferred);
              }
              return state.currentLocalStatus;
            }).pipe(
              Effect.onInterrupt(() =>
                localInterruptedDeferred
                  ? Deferred.succeed(localInterruptedDeferred, undefined).pipe(Effect.ignore)
                  : Effect.void,
              ),
            ),
          remoteStatus: () => Effect.succeed(state.currentRemoteStatus),
          invalidateLocalStatus: () =>
            Effect.sync(() => {
              state.localInvalidationCalls += 1;
            }),
          invalidateRemoteStatus: () =>
            Effect.sync(() => {
              state.remoteInvalidationCalls += 1;
            }),
        } satisfies Partial<GitWorkflowService.GitWorkflowServiceShape>),
      ),
    );

    return Effect.gen(function* () {
      localStartedDeferred = yield* Deferred.make<void>();
      localInterruptedDeferred = yield* Deferred.make<void>();
      releaseLocalDeferred = yield* Deferred.make<void>();

      const broadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
      const firstCaller = yield* broadcaster.refreshLocalStatus("/repo").pipe(Effect.forkScoped);
      yield* Deferred.await(localStartedDeferred);
      const joinedCaller = yield* broadcaster.refreshLocalStatus("/repo").pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      yield* Fiber.interrupt(firstCaller);

      assert.isTrue(Option.isNone(yield* Deferred.poll(localInterruptedDeferred)));
      assert.equal(state.localInvalidationCalls, 1);
      assert.equal(state.localStatusCalls, 1);

      yield* Deferred.succeed(releaseLocalDeferred, undefined);
      const result = yield* Fiber.join(joinedCaller);

      assert.deepStrictEqual(result, baseLocalStatus);
      assert.isTrue(Option.isNone(yield* Deferred.poll(localInterruptedDeferred)));
      assert.equal(state.localInvalidationCalls, 1);
      assert.equal(state.localStatusCalls, 1);
    }).pipe(Effect.provide(testLayer));
  });

  it.effect("serializes an explicit refresh behind a blocked initial load", () => {
    const initialLocalStatus = {
      ...baseLocalStatus,
      refName: "feature/initial-load",
    };
    const refreshedLocalStatus = {
      ...baseLocalStatus,
      refName: "feature/refreshed-after-load",
    };
    const state = {
      currentLocalStatus: initialLocalStatus,
      currentRemoteStatus: baseRemoteStatus,
      localStatusCalls: 0,
      remoteStatusCalls: 0,
      localInvalidationCalls: 0,
      remoteInvalidationCalls: 0,
    };
    let initialLoadStartedDeferred: Deferred.Deferred<void> | null = null;
    let releaseInitialLoadDeferred: Deferred.Deferred<void> | null = null;
    const testLayer = VcsStatusBroadcaster.layer.pipe(
      Layer.provide(
        Layer.mock(GitWorkflowService.GitWorkflowService)({
          localStatus: () =>
            Effect.gen(function* () {
              state.localStatusCalls += 1;
              const statusAtStart = state.currentLocalStatus;
              if (state.localStatusCalls === 1) {
                if (initialLoadStartedDeferred) {
                  yield* Deferred.succeed(initialLoadStartedDeferred, undefined).pipe(
                    Effect.ignore,
                  );
                }
                if (releaseInitialLoadDeferred) {
                  yield* Deferred.await(releaseInitialLoadDeferred);
                }
              }
              return statusAtStart;
            }),
          remoteStatus: () =>
            Effect.sync(() => {
              state.remoteStatusCalls += 1;
              return state.currentRemoteStatus;
            }),
          invalidateLocalStatus: () =>
            Effect.sync(() => {
              state.localInvalidationCalls += 1;
            }),
          invalidateRemoteStatus: () =>
            Effect.sync(() => {
              state.remoteInvalidationCalls += 1;
            }),
        } satisfies Partial<GitWorkflowService.GitWorkflowServiceShape>),
      ),
    );

    return Effect.gen(function* () {
      initialLoadStartedDeferred = yield* Deferred.make<void>();
      releaseInitialLoadDeferred = yield* Deferred.make<void>();

      const broadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
      const initialRead = yield* broadcaster.getStatus({ cwd: "/repo" }).pipe(Effect.forkScoped);
      yield* Deferred.await(initialLoadStartedDeferred);

      state.currentLocalStatus = refreshedLocalStatus;
      const refresh = yield* broadcaster.refreshLocalStatus("/repo").pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      assert.equal(state.localStatusCalls, 1);
      assert.equal(state.localInvalidationCalls, 0);

      yield* Deferred.succeed(releaseInitialLoadDeferred, undefined);
      const initial = yield* Fiber.join(initialRead);
      const refreshed = yield* Fiber.join(refresh);
      const cached = yield* broadcaster.getStatus({ cwd: "/repo" });

      assert.deepStrictEqual(initial, {
        ...initialLocalStatus,
        ...baseRemoteStatus,
      });
      assert.deepStrictEqual(refreshed, refreshedLocalStatus);
      assert.deepStrictEqual(cached, {
        ...refreshedLocalStatus,
        ...baseRemoteStatus,
      });
      assert.equal(state.localStatusCalls, 2);
      assert.equal(state.localInvalidationCalls, 1);
      assert.equal(state.remoteStatusCalls, 1);
      assert.equal(state.remoteInvalidationCalls, 0);
    }).pipe(Effect.provide(testLayer));
  });

  it.effect("normalizes symlinked CWDs before cache lookup and workflow calls", () => {
    const seenCwds: string[] = [];
    const state = {
      currentLocalStatus: baseLocalStatus,
      currentRemoteStatus: baseRemoteStatus,
      localStatusCalls: 0,
      remoteStatusCalls: 0,
      localInvalidationCalls: 0,
      remoteInvalidationCalls: 0,
    };
    const testLayer = VcsStatusBroadcaster.layer.pipe(
      Layer.provide(
        Layer.mock(GitWorkflowService.GitWorkflowService)({
          localStatus: (input) =>
            Effect.sync(() => {
              seenCwds.push(input.cwd);
              state.localStatusCalls += 1;
              return state.currentLocalStatus;
            }),
          remoteStatus: (input) =>
            Effect.sync(() => {
              seenCwds.push(input.cwd);
              state.remoteStatusCalls += 1;
              return state.currentRemoteStatus;
            }),
          invalidateLocalStatus: () =>
            Effect.sync(() => {
              state.localInvalidationCalls += 1;
            }),
          invalidateRemoteStatus: () =>
            Effect.sync(() => {
              state.remoteInvalidationCalls += 1;
            }),
        } satisfies Partial<GitWorkflowService.GitWorkflowServiceShape>),
      ),
    );

    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const realDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "ryco-vcs-status-real-",
      });
      const linkParent = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "ryco-vcs-status-link-",
      });
      const linkDir = path.join(linkParent, "repo-link");
      yield* fileSystem.symlink(realDir, linkDir);
      const realPath = yield* fileSystem.realPath(realDir);

      const broadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
      yield* broadcaster.getStatus({ cwd: linkDir });
      yield* broadcaster.getStatus({ cwd: realDir });

      assert.deepStrictEqual(seenCwds, [realPath, realPath]);
      assert.equal(state.localStatusCalls, 1);
      assert.equal(state.remoteStatusCalls, 1);
    }).pipe(Effect.provide(Layer.mergeAll(testLayer, NodeServices.layer)));
  });

  it.effect("streams a local snapshot first and recoverable current snapshots later", () => {
    const state = {
      currentLocalStatus: baseLocalStatus,
      currentRemoteStatus: baseRemoteStatus,
      localStatusCalls: 0,
      remoteStatusCalls: 0,
      localInvalidationCalls: 0,
      remoteInvalidationCalls: 0,
    };

    return Effect.gen(function* () {
      const broadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
      const snapshotDeferred = yield* Deferred.make<VcsStatusStreamEvent>();
      const currentSnapshotDeferred = yield* Deferred.make<VcsStatusStreamEvent>();
      yield* Stream.runForEach(broadcaster.streamStatus({ cwd: "/repo" }), (event) => {
        if (event._tag === "snapshot" && event.remote === null) {
          return Deferred.succeed(snapshotDeferred, event).pipe(Effect.ignore);
        }
        if (event._tag === "snapshot" && event.remote !== null) {
          return Deferred.succeed(currentSnapshotDeferred, event).pipe(Effect.ignore);
        }
        return Effect.void;
      }).pipe(Effect.forkScoped);

      const snapshot = yield* Deferred.await(snapshotDeferred);
      yield* broadcaster.refreshStatus("/repo");
      const currentSnapshot = yield* Deferred.await(currentSnapshotDeferred);

      assert.deepStrictEqual(snapshot, {
        _tag: "snapshot",
        local: baseLocalStatus,
        remote: null,
      } satisfies VcsStatusStreamEvent);
      assert.deepStrictEqual(currentSnapshot, {
        _tag: "snapshot",
        local: baseLocalStatus,
        remote: baseRemoteStatus,
      } satisfies VcsStatusStreamEvent);
    }).pipe(Effect.provide(makeTestLayer(state)));
  });

  it.effect("does not start a remote poller for status streams by default", () => {
    const state = {
      currentLocalStatus: baseLocalStatus,
      currentRemoteStatus: baseRemoteStatus,
      localStatusCalls: 0,
      remoteStatusCalls: 0,
      localInvalidationCalls: 0,
      remoteInvalidationCalls: 0,
    };

    return Effect.gen(function* () {
      const broadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
      const snapshotDeferred = yield* Deferred.make<VcsStatusStreamEvent>();
      yield* Stream.runForEach(broadcaster.streamStatus({ cwd: "/repo" }), (event) =>
        event._tag === "snapshot"
          ? Deferred.succeed(snapshotDeferred, event).pipe(Effect.ignore)
          : Effect.void,
      ).pipe(Effect.forkScoped);

      yield* Deferred.await(snapshotDeferred);
      yield* Effect.yieldNow;

      assert.equal(state.localStatusCalls, 1);
      assert.equal(state.remoteStatusCalls, 0);
      assert.equal(state.remoteInvalidationCalls, 0);
    }).pipe(Effect.provide(makeTestLayer(state)));
  });

  it.effect(
    "stops an enabled remote poller without cancelling its shared in-flight refresh",
    () => {
      const state = {
        currentLocalStatus: baseLocalStatus,
        currentRemoteStatus: baseRemoteStatus,
        localStatusCalls: 0,
        remoteStatusCalls: 0,
        localInvalidationCalls: 0,
        remoteInvalidationCalls: 0,
      };
      let releaseRemoteDeferred: Deferred.Deferred<void, never> | null = null;
      let remoteCompletedDeferred: Deferred.Deferred<void, never> | null = null;
      let remoteStartedDeferred: Deferred.Deferred<void, never> | null = null;
      const testLayer = VcsStatusBroadcaster.layer.pipe(
        Layer.provide(
          Layer.mock(GitWorkflowService.GitWorkflowService)({
            localStatus: () =>
              Effect.sync(() => {
                state.localStatusCalls += 1;
                return state.currentLocalStatus;
              }),
            remoteStatus: () =>
              Effect.gen(function* () {
                state.remoteStatusCalls += 1;
                if (remoteStartedDeferred) {
                  yield* Deferred.succeed(remoteStartedDeferred, undefined).pipe(Effect.ignore);
                }
                if (releaseRemoteDeferred) {
                  yield* Deferred.await(releaseRemoteDeferred);
                }
                if (remoteCompletedDeferred) {
                  yield* Deferred.succeed(remoteCompletedDeferred, undefined).pipe(Effect.ignore);
                }
                return state.currentRemoteStatus;
              }),
            invalidateLocalStatus: () =>
              Effect.sync(() => {
                state.localInvalidationCalls += 1;
              }),
            invalidateRemoteStatus: () =>
              Effect.sync(() => {
                state.remoteInvalidationCalls += 1;
              }),
          } satisfies Partial<GitWorkflowService.GitWorkflowServiceShape>),
        ),
      );

      return Effect.gen(function* () {
        const releaseRemote = yield* Deferred.make<void>();
        const remoteCompleted = yield* Deferred.make<void>();
        const remoteStarted = yield* Deferred.make<void>();
        releaseRemoteDeferred = releaseRemote;
        remoteCompletedDeferred = remoteCompleted;
        remoteStartedDeferred = remoteStarted;

        const broadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
        const firstSnapshot = yield* Deferred.make<VcsStatusStreamEvent>();
        const secondSnapshot = yield* Deferred.make<VcsStatusStreamEvent>();
        const firstScope = yield* Scope.make();
        const secondScope = yield* Scope.make();
        const options = {
          automaticRemoteRefreshInterval: Effect.succeed(Duration.seconds(30)),
        };
        yield* Stream.runForEach(broadcaster.streamStatus({ cwd: "/repo" }, options), (event) =>
          event._tag === "snapshot"
            ? Deferred.succeed(firstSnapshot, event).pipe(Effect.ignore)
            : Effect.void,
        ).pipe(Effect.forkIn(firstScope));
        yield* Stream.runForEach(broadcaster.streamStatus({ cwd: "/repo" }, options), (event) =>
          event._tag === "snapshot"
            ? Deferred.succeed(secondSnapshot, event).pipe(Effect.ignore)
            : Effect.void,
        ).pipe(Effect.forkIn(secondScope));

        yield* Deferred.await(firstSnapshot);
        yield* Deferred.await(secondSnapshot);
        yield* Deferred.await(remoteStarted);

        assert.equal(state.remoteStatusCalls, 1);

        yield* Scope.close(firstScope, Exit.void);
        assert.isTrue(Option.isNone(yield* Deferred.poll(releaseRemote)));

        yield* Scope.close(secondScope, Exit.void);
        assert.isTrue(Option.isNone(yield* Deferred.poll(releaseRemote)));

        yield* Deferred.succeed(releaseRemote, undefined);
        yield* Deferred.await(remoteCompleted);

        assert.equal(state.remoteStatusCalls, 1);
      }).pipe(Effect.provide(testLayer));
    },
  );
});
