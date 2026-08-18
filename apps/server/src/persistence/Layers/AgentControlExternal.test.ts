import {
  AGENT_CONTROL_CAPABILITIES,
  AgentControlExternalTaskId,
  AgentControlIntegrationId,
  AgentControlProposalId,
  AgentControlRequestId,
  ProjectId,
  ProviderInstanceId,
} from "@ryco/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import {
  AgentControlExternalRepository,
  AgentControlExternalSecretHash,
  type StoredAgentControlExternalIntegration,
  type StoredAgentControlExternalTask,
} from "../Services/AgentControlExternal.ts";
import { AgentControlExternalRepositoryLive } from "./AgentControlExternal.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  AgentControlExternalRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

const integrationId = AgentControlIntegrationId.make("external-repository-integration");
const createdAt = "2026-08-18T00:00:00.000Z";

const integration = (
  overrides: Partial<StoredAgentControlExternalIntegration> = {},
): StoredAgentControlExternalIntegration => ({
  integrationId,
  displayName: "Local Codex",
  clientKind: "codex",
  projectScope: { kind: "selected", projectIds: [ProjectId.make("project-1")] },
  capabilities: [
    AGENT_CONTROL_CAPABILITIES.externalCreateTask,
    AGENT_CONTROL_CAPABILITIES.externalReadTask,
  ],
  rateLimitPerMinute: 60,
  activeTaskLimit: 1,
  activeTaskCount: 0,
  expiresAt: null,
  revokedAt: null,
  pairingState: "paired",
  pairingCodeHash: null,
  pairingCodeExpiresAt: null,
  pairedAt: createdAt,
  credentialAudience: "external-mcp",
  credentialHash: AgentControlExternalSecretHash.make("a".repeat(64)),
  createdAt,
  updatedAt: createdAt,
  lastUsedAt: null,
  ...overrides,
});

const task = (
  requestId: string,
  overrides: Partial<StoredAgentControlExternalTask> = {},
): StoredAgentControlExternalTask => ({
  taskId: AgentControlExternalTaskId.make(`task-${requestId}`),
  integrationId,
  requestId: AgentControlRequestId.make(requestId),
  planDigest: "b".repeat(64),
  proposalId: AgentControlProposalId.make(`proposal-${requestId}`),
  projectId: ProjectId.make("project-1"),
  providerInstanceId: ProviderInstanceId.make("codex-main"),
  environment: "worktree",
  runtimeMode: "approval-required",
  createdAt,
  updatedAt: createdAt,
  releasedAt: null,
  ...overrides,
});

layer("AgentControlExternalRepository", (it) => {
  it.effect("round-trips only hashed credential material under the external audience", () =>
    Effect.gen(function* () {
      const repository = yield* AgentControlExternalRepository;
      assert.isTrue(yield* repository.insertIntegration(integration()));
      const stored = Option.getOrThrow(yield* repository.getIntegration(integrationId));
      assert.strictEqual(stored.credentialAudience, "external-mcp");
      assert.strictEqual(stored.credentialHash, "a".repeat(64));
      assert.notProperty(stored, "credential");
      assert.isTrue(
        Option.isSome(
          yield* repository.findByCredentialHash(
            AgentControlExternalSecretHash.make("a".repeat(64)),
          ),
        ),
      );
      assert.isTrue(
        Option.isNone(
          yield* repository.findByCredentialHash(
            AgentControlExternalSecretHash.make("c".repeat(64)),
          ),
        ),
      );
    }),
  );

  it.effect("reserves capacity once, persists idempotency, and reconciles after restart", () =>
    Effect.gen(function* () {
      const repository = yield* AgentControlExternalRepository;
      yield* repository.insertIntegration(integration());
      assert.isTrue(yield* repository.reserveCapacity(integrationId));
      assert.isFalse(yield* repository.reserveCapacity(integrationId));

      const first = task("request-1");
      assert.isTrue(yield* repository.insertTask(first));
      assert.isFalse(yield* repository.deleteIntegration(integrationId));
      assert.isFalse(
        yield* repository.insertTask({
          ...first,
          taskId: AgentControlExternalTaskId.make("task-retry"),
        }),
      );
      assert.strictEqual(
        Option.getOrThrow(
          yield* repository.findTaskByRequest({
            integrationId,
            requestId: AgentControlRequestId.make("request-1"),
          }),
        ).planDigest,
        first.planDigest,
      );

      yield* repository.replaceIntegration({
        ...Option.getOrThrow(yield* repository.getIntegration(integrationId)),
        activeTaskCount: 0,
      });
      yield* repository.reconcileCapacity();
      assert.strictEqual(
        Option.getOrThrow(yield* repository.getIntegration(integrationId)).activeTaskCount,
        1,
      );

      assert.isTrue(
        yield* repository.releaseTask({
          taskId: first.taskId,
          integrationId,
          releasedAt: "2026-08-18T00:01:00.000Z",
        }),
      );
      assert.isFalse(
        yield* repository.releaseTask({
          taskId: first.taskId,
          integrationId,
          releasedAt: "2026-08-18T00:02:00.000Z",
        }),
      );
      assert.strictEqual(
        Option.getOrThrow(yield* repository.getIntegration(integrationId)).activeTaskCount,
        0,
      );
    }),
  );

  it.effect("prunes audit history without retaining prompt fields", () =>
    Effect.gen(function* () {
      const repository = yield* AgentControlExternalRepository;
      yield* repository.insertIntegration(integration());
      for (let index = 0; index < 4; index += 1) {
        yield* repository.insertAudit({
          auditId: `audit-${index}`,
          integrationId,
          tool: "ryco_create_task",
          requestId: AgentControlRequestId.make(`request-${index}`),
          projectId: ProjectId.make("project-1"),
          runtimeMode: "approval-required",
          environment: "worktree",
          proposalId: null,
          operationId: null,
          threadId: null,
          outcome: "request-admitted",
          createdAt: `2026-08-18T00:00:0${index}.000Z`,
        });
      }
      yield* repository.pruneAudit({
        integrationId,
        before: "2026-08-18T00:00:00.000Z",
        keepNewest: 2,
      });
      assert.strictEqual(
        yield* repository.countAuditSince({
          integrationId,
          since: "2026-08-18T00:00:00.000Z",
        }),
        2,
      );
    }),
  );
});
