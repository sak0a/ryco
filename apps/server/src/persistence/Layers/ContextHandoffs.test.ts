import {
  ContextHandoffId,
  MessageId,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
  TurnId,
} from "@ryco/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import {
  ContextHandoffRepository,
  makeRequestedContextHandoffRecord,
} from "../Services/ContextHandoffs.ts";
import { ContextHandoffRepositoryLive } from "./ContextHandoffs.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ContextHandoffRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

const createdAt = "2026-08-04T00:00:00.000Z";

function requestedRecord(handoffIdValue: string, threadIdValue: string) {
  const handoffId = ContextHandoffId.make(handoffIdValue);
  const threadId = ThreadId.make(threadIdValue);
  return makeRequestedContextHandoffRecord({
    handoffId,
    threadId,
    sourceSelection: {
      instanceId: ProviderInstanceId.make("codex_work"),
      model: "gpt-5.6",
    },
    targetSelection: {
      instanceId: ProviderInstanceId.make("claude_work"),
      model: "claude-fable-5",
    },
    sourceRuntimeSessionId: RuntimeSessionId.make("runtime-source"),
    firstMessageId: MessageId.make("message-1"),
    createdAt,
    updatedAt: createdAt,
  });
}

layer("ContextHandoffRepository", (it) => {
  it.effect("creates idempotently and round-trips canonical selections and runtime epochs", () =>
    Effect.gen(function* () {
      const repository = yield* ContextHandoffRepository;
      const handoffId = ContextHandoffId.make("handoff-create");
      const record = requestedRecord(handoffId, "thread-create");
      assert.isTrue(yield* repository.create(record));
      assert.isFalse(yield* repository.create(record));

      const row = Option.getOrThrow(yield* repository.getById({ handoffId }));
      assert.strictEqual(row.sourceSelection.instanceId, "codex_work");
      assert.strictEqual(row.targetSelection.model, "claude-fable-5");
      assert.strictEqual(row.sourceRuntimeSessionId, "runtime-source");
      assert.strictEqual(row.structuredContext, null);
      assert.strictEqual(row.deliveryArtifact, null);
    }),
  );

  it.effect("stores an exact delivery artifact once without replacing it", () =>
    Effect.gen(function* () {
      const repository = yield* ContextHandoffRepository;
      const handoffId = ContextHandoffId.make("handoff-delivery-artifact");
      yield* repository.create(requestedRecord(handoffId, "thread-delivery-artifact"));
      const first = {
        artifactVersion: 1,
        providerInput: "exact provider bytes 😀",
      };
      const conflicting = {
        artifactVersion: 1,
        providerInput: "different bytes",
      };

      assert.isTrue(
        yield* repository.storeDeliveryArtifactIfEmpty({
          handoffId,
          deliveryArtifact: first,
          updatedAt: "2026-08-04T00:00:01.000Z",
        }),
      );
      assert.isFalse(
        yield* repository.storeDeliveryArtifactIfEmpty({
          handoffId,
          deliveryArtifact: conflicting,
          updatedAt: "2026-08-04T00:00:02.000Z",
        }),
      );

      const row = Option.getOrThrow(yield* repository.getById({ handoffId }));
      assert.deepStrictEqual(row.deliveryArtifact, first);
      assert.strictEqual(row.updatedAt, "2026-08-04T00:00:01.000Z");
    }),
  );

  it.effect("stores the original context once and preserves it across retries", () =>
    Effect.gen(function* () {
      const repository = yield* ContextHandoffRepository;
      const handoffId = ContextHandoffId.make("handoff-context");
      yield* repository.create(requestedRecord(handoffId, "thread-context"));
      const firstDigest = "a".repeat(64);
      const secondDigest = "b".repeat(64);

      assert.isTrue(
        yield* repository.storeContextIfEmpty({
          handoffId,
          contextVersion: 1,
          structuredContext: { messages: [{ id: "message-before", text: "canonical" }] },
          contextDigest: firstDigest,
          updatedAt: "2026-08-04T00:00:01.000Z",
        }),
      );
      assert.isFalse(
        yield* repository.storeContextIfEmpty({
          handoffId,
          contextVersion: 1,
          structuredContext: { messages: [{ id: "changed", text: "must not replace" }] },
          contextDigest: secondDigest,
          updatedAt: "2026-08-04T00:00:02.000Z",
        }),
      );

      const row = Option.getOrThrow(yield* repository.getById({ handoffId }));
      assert.strictEqual(row.contextDigest, firstDigest);
      assert.deepStrictEqual(row.structuredContext, {
        messages: [{ id: "message-before", text: "canonical" }],
      });
    }),
  );

  it.effect("allows one compare-and-set winner and exposes recoverable operations", () =>
    Effect.gen(function* () {
      const repository = yield* ContextHandoffRepository;
      const handoffId = ContextHandoffId.make("handoff-cas");
      yield* repository.create(requestedRecord(handoffId, "thread-cas"));

      assert.isTrue(
        yield* repository.compareAndSetStatus({
          handoffId,
          expectedStatus: "requested",
          nextStatus: "preparing",
          targetRuntimeSessionId: null,
          acceptedProviderTurnId: null,
          error: null,
          updatedAt: "2026-08-04T00:00:01.000Z",
        }),
      );
      assert.isFalse(
        yield* repository.compareAndSetStatus({
          handoffId,
          expectedStatus: "requested",
          nextStatus: "preparing",
          targetRuntimeSessionId: null,
          acceptedProviderTurnId: null,
          error: null,
          updatedAt: "2026-08-04T00:00:02.000Z",
        }),
      );
      assert.deepStrictEqual(
        (yield* repository.listRecoverable())
          .filter((row) => row.handoffId === handoffId)
          .map((row) => row.handoffId),
        [handoffId],
      );

      const targetRuntimeSessionId = RuntimeSessionId.make("runtime-target");
      const acceptedProviderTurnId = TurnId.make("provider-turn-1");
      assert.isTrue(
        yield* repository.compareAndSetStatus({
          handoffId,
          expectedStatus: "preparing",
          nextStatus: "dispatching",
          targetRuntimeSessionId,
          acceptedProviderTurnId: null,
          error: null,
          updatedAt: "2026-08-04T00:00:03.000Z",
        }),
      );
      assert.isTrue(
        yield* repository.compareAndSetStatus({
          handoffId,
          expectedStatus: "dispatching",
          nextStatus: "consumed",
          targetRuntimeSessionId,
          acceptedProviderTurnId,
          error: null,
          updatedAt: "2026-08-04T00:00:04.000Z",
        }),
      );
      assert.isFalse(
        (yield* repository.listRecoverable()).some((row) => row.handoffId === handoffId),
      );
      assert.strictEqual(
        Option.getOrThrow(yield* repository.getById({ handoffId })).acceptedProviderTurnId,
        acceptedProviderTurnId,
      );
    }),
  );

  it.effect("lists repeated handoffs in stable thread chronology", () =>
    Effect.gen(function* () {
      const repository = yield* ContextHandoffRepository;
      const threadId = ThreadId.make("thread-list");
      yield* repository.create(requestedRecord("handoff-list-1", threadId));
      yield* repository.create({
        ...requestedRecord("handoff-list-2", threadId),
        firstMessageId: MessageId.make("message-2"),
        createdAt: "2026-08-04T00:00:05.000Z",
        updatedAt: "2026-08-04T00:00:05.000Z",
      });
      assert.deepStrictEqual(
        (yield* repository.listByThread({ threadId })).map((row) => row.handoffId),
        ["handoff-list-1", "handoff-list-2"],
      );
    }),
  );
});
