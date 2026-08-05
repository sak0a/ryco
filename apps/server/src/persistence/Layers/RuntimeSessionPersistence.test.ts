import { ProviderInstanceId, RuntimeSessionId, ThreadId } from "@ryco/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { ProjectionThreadSessionRepository } from "../Services/ProjectionThreadSessions.ts";
import { ProviderSessionRuntimeRepository } from "../Services/ProviderSessionRuntime.ts";
import { ProjectionThreadSessionRepositoryLive } from "./ProjectionThreadSessions.ts";
import { ProviderSessionRuntimeRepositoryLive } from "./ProviderSessionRuntime.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  Layer.merge(ProviderSessionRuntimeRepositoryLive, ProjectionThreadSessionRepositoryLive).pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
  ),
);

layer("runtime session persistence", (it) => {
  it.effect("round-trips exact runtime epochs in operational and projected session rows", () =>
    Effect.gen(function* () {
      const runtimeRepository = yield* ProviderSessionRuntimeRepository;
      const projectionRepository = yield* ProjectionThreadSessionRepository;
      const threadId = ThreadId.make("thread-runtime-epoch");
      const runtimeSessionId = RuntimeSessionId.make("runtime-session-42");

      yield* runtimeRepository.upsert({
        threadId,
        providerName: "codex",
        providerInstanceId: ProviderInstanceId.make("codex_work"),
        runtimeSessionId,
        adapterKey: "codex",
        runtimeMode: "full-access",
        status: "running",
        lastSeenAt: "2026-08-04T00:00:00.000Z",
        resumeCursor: null,
        runtimePayload: null,
      });
      yield* projectionRepository.upsert({
        threadId,
        status: "running",
        providerName: "codex",
        providerInstanceId: ProviderInstanceId.make("codex_work"),
        runtimeSessionId,
        runtimeMode: "full-access",
        tokenMode: "balanced",
        activeTurnId: null,
        lastError: null,
        updatedAt: "2026-08-04T00:00:00.000Z",
      });

      assert.strictEqual(
        Option.getOrThrow(yield* runtimeRepository.getByThreadId({ threadId })).runtimeSessionId,
        runtimeSessionId,
      );
      assert.strictEqual(
        Option.getOrThrow(yield* projectionRepository.getByThreadId({ threadId })).runtimeSessionId,
        runtimeSessionId,
      );
    }),
  );
});
