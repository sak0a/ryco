import {
  ContextHandoffId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
  TurnId,
  type ContextHandoffEndpointSnapshot,
  type OrchestrationThread,
} from "@ryco/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import {
  ContextHandoffRepository,
  type ContextHandoffRecord,
  type ContextHandoffRepositoryShape,
  makeRequestedContextHandoffRecord,
} from "../../persistence/Services/ContextHandoffs.ts";
import {
  ContextHandoffArtifactError,
  ContextHandoffService,
  ContextHandoffServiceLive,
} from "./ContextHandoffService.ts";

const createdAt = "2026-08-04T00:00:00.000Z";

function endpoint(instance: string, model: string): ContextHandoffEndpointSnapshot {
  return {
    providerInstanceId: ProviderInstanceId.make(instance),
    driverKind: ProviderDriverKind.make(instance.startsWith("claude") ? "claudeAgent" : "codex"),
    modelSlug: model,
  };
}

function thread(targetMessageId: MessageId, priorText = "canonical history"): OrchestrationThread {
  return {
    id: ThreadId.make("thread-service"),
    projectId: ProjectId.make("project-service"),
    title: "Service context",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex_a"),
      model: "gpt-a",
    },
    runtimeMode: "full-access",
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages: [
      {
        id: MessageId.make("message-prior"),
        role: "user",
        text: priorText,
        turnId: TurnId.make("turn-prior"),
        streaming: false,
        createdAt: "2026-08-04T00:00:01.000Z",
        updatedAt: "2026-08-04T00:00:01.000Z",
      },
      {
        id: targetMessageId,
        role: "user",
        text: "current message",
        turnId: TurnId.make("turn-target"),
        streaming: false,
        createdAt: "2026-08-04T00:00:02.000Z",
        updatedAt: "2026-08-04T00:00:02.000Z",
      },
    ],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
  };
}

function requestedRecord(handoffId: ContextHandoffId, targetMessageId: MessageId) {
  return makeRequestedContextHandoffRecord({
    handoffId,
    threadId: ThreadId.make("thread-service"),
    sourceSelection: {
      instanceId: ProviderInstanceId.make("codex_a"),
      model: "gpt-a",
    },
    targetSelection: {
      instanceId: ProviderInstanceId.make("claude_b"),
      model: "claude-b",
    },
    sourceRuntimeSessionId: RuntimeSessionId.make("runtime-source"),
    firstMessageId: targetMessageId,
    createdAt,
    updatedAt: createdAt,
  });
}

function memoryRepository(initial: ContextHandoffRecord) {
  let record = initial;
  let storeCalls = 0;
  const service: ContextHandoffRepositoryShape = {
    create: () => Effect.succeed(false),
    getById: ({ handoffId }) =>
      Effect.succeed(handoffId === record.handoffId ? Option.some(record) : Option.none()),
    listByThread: () => Effect.succeed([record]),
    listRecoverable: () => Effect.succeed([record]),
    compareAndSetStatus: () => Effect.succeed(false),
    storeContextIfEmpty: (input) =>
      Effect.sync(() => {
        storeCalls += 1;
        if (record.structuredContext !== null || record.contextDigest !== null) {
          return false;
        }
        record = {
          ...record,
          contextVersion: input.contextVersion,
          structuredContext: input.structuredContext,
          contextDigest: input.contextDigest,
          updatedAt: input.updatedAt,
        };
        return true;
      }),
    storeDeliveryArtifactIfEmpty: (input) =>
      Effect.sync(() => {
        if (record.deliveryArtifact !== null) return false;
        record = {
          ...record,
          deliveryArtifact: input.deliveryArtifact,
          updatedAt: input.updatedAt,
        };
        return true;
      }),
  };
  return {
    layer: ContextHandoffServiceLive.pipe(
      Layer.provide(Layer.succeed(ContextHandoffRepository, service)),
    ),
    record: () => record,
    storeCalls: () => storeCalls,
    replace: (next: ContextHandoffRecord) => {
      record = next;
    },
  };
}

it.effect("ContextHandoffService stores once and reuses deterministic bytes on retry", () => {
  const handoffId = ContextHandoffId.make("handoff-service");
  const targetMessageId = MessageId.make("message-target");
  const repository = memoryRepository(requestedRecord(handoffId, targetMessageId));
  return Effect.gen(function* () {
    const service = yield* ContextHandoffService;
    const first = yield* service.buildAndStore({
      handoffId,
      thread: thread(targetMessageId),
      targetMessageId,
      source: endpoint("codex_a", "gpt-a"),
      target: endpoint("claude_b", "claude-b"),
      updatedAt: "2026-08-04T00:00:03.000Z",
    });
    const retry = yield* service.buildAndStore({
      handoffId,
      thread: thread(targetMessageId, "history changed after preparation"),
      targetMessageId,
      source: endpoint("codex_a", "gpt-a"),
      target: endpoint("claude_b", "claude-b"),
      updatedAt: "2026-08-04T00:00:04.000Z",
    });

    assert.strictEqual(first.origin, "built");
    assert.strictEqual(retry.origin, "stored");
    assert.strictEqual(retry.canonicalJson, first.canonicalJson);
    assert.strictEqual(retry.digest, first.digest);
    assert.isFalse(retry.canonicalJson.includes("history changed after preparation"));
    assert.strictEqual(repository.storeCalls(), 1);
  }).pipe(Effect.provide(repository.layer));
});

it.effect("ContextHandoffService renders stored context with the exact separate message", () => {
  const handoffId = ContextHandoffId.make("handoff-render-service");
  const targetMessageId = MessageId.make("message-target");
  const repository = memoryRepository(requestedRecord(handoffId, targetMessageId));
  return Effect.gen(function* () {
    const service = yield* ContextHandoffService;
    yield* service.buildAndStore({
      handoffId,
      thread: thread(targetMessageId),
      targetMessageId,
      source: endpoint("codex_a", "gpt-a"),
      target: endpoint("claude_b", "claude-b"),
      updatedAt: "2026-08-04T00:00:03.000Z",
    });
    const currentMessage = "  exact message 😀\nwith whitespace  ";
    const rendered = yield* service.renderStoredContext({
      handoffId,
      currentMessage,
    });
    assert.isTrue(
      rendered.providerInput.includes(
        `<current_user_message>\n${currentMessage}\n</current_user_message>`,
      ),
    );
    assert.isFalse(rendered.renderedContextJson.includes(currentMessage));
  }).pipe(Effect.provide(repository.layer));
});

it.effect("ContextHandoffService persists and reuses the exact delivery artifact", () => {
  const handoffId = ContextHandoffId.make("handoff-delivery-service");
  const targetMessageId = MessageId.make("message-target");
  const repository = memoryRepository(requestedRecord(handoffId, targetMessageId));
  return Effect.gen(function* () {
    const service = yield* ContextHandoffService;
    yield* service.buildAndStore({
      handoffId,
      thread: thread(targetMessageId),
      targetMessageId,
      source: endpoint("codex_a", "gpt-a"),
      target: endpoint("claude_b", "claude-b"),
      updatedAt: "2026-08-04T00:00:03.000Z",
    });
    const currentMessage = "  exact message 😀  ";
    const first = yield* service.prepareDeliveryArtifact({
      handoffId,
      triggeringMessageId: targetMessageId,
      currentMessage,
      preparedAt: "2026-08-04T00:00:04.000Z",
    });
    const retry = yield* service.prepareDeliveryArtifact({
      maxInputChars: 1_400_000,
      budgetSource: "manifest",
      contextWindowTokens: 1_000_000,
      handoffId,
      triggeringMessageId: targetMessageId,
      currentMessage,
      preparedAt: "2026-08-04T00:00:05.000Z",
    });

    assert.strictEqual(first.providerInput, retry.providerInput);
    assert.strictEqual(first.providerInputDigest, retry.providerInputDigest);
    assert.strictEqual(first.preparedAt, "2026-08-04T00:00:04.000Z");
    assert.strictEqual(retry.preparedAt, first.preparedAt);
    assert.strictEqual(first.triggeringMessage.text, currentMessage);
    assert.deepStrictEqual(repository.record().deliveryArtifact, first);
  }).pipe(Effect.provide(repository.layer));
});

it.effect(
  "ContextHandoffService rejects tampered stored artifacts without exposing their body",
  () => {
    const handoffId = ContextHandoffId.make("handoff-tampered");
    const targetMessageId = MessageId.make("message-target");
    const repository = memoryRepository({
      ...requestedRecord(handoffId, targetMessageId),
      structuredContext: { secret: "must remain operational" },
      contextDigest: "a".repeat(64),
    });
    return Effect.gen(function* () {
      const service = yield* ContextHandoffService;
      const error = yield* service.loadStoredContext({ handoffId }).pipe(Effect.flip);
      assert.instanceOf(error, ContextHandoffArtifactError);
      assert.strictEqual(error.reason, "invalid-stored-context");
      assert.isFalse(error.message.includes("must remain operational"));
    }).pipe(Effect.provide(repository.layer));
  },
);
