import {
  AgentControlProposalId,
  AgentControlRequestId,
  OrchestrationProjectShell,
  OrchestrationThreadShell,
  ProjectId,
  ProviderInstanceId,
  RuntimeSessionId,
  ServerProvider,
  ThreadId,
  TurnId,
  WorktreeId,
  type AgentControlProposal,
  type OrchestrationShellSnapshot,
} from "@ryco/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Ref, Schema } from "effect";

import type { ProjectionSnapshotQueryShape } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import type {
  AgentControlSessionRecord,
  AgentControlTurnAuthority,
} from "../Services/AgentControlSessionRegistry.ts";
import { makeAgentControlActionValidatorFromDeps } from "./AgentControlActionValidator.ts";

const now = "2026-08-18T00:00:00.000Z";
const projectId = ProjectId.make("project-1");
const providerInstanceId = ProviderInstanceId.make("codex");
const callerThreadId = ThreadId.make("thread-caller");
const targetThreadId = ThreadId.make("thread-target");
const runtimeSessionId = RuntimeSessionId.make("runtime-caller");
const turnId = TurnId.make("turn-caller");

const project = Schema.decodeUnknownSync(OrchestrationProjectShell)({
  id: projectId,
  title: "Project",
  workspaceRoot: "/workspace/project",
  defaultModelSelection: null,
  scripts: [],
  createdAt: now,
  updatedAt: now,
});

const provider = Schema.decodeUnknownSync(ServerProvider)({
  instanceId: providerInstanceId,
  driver: "codex",
  displayName: "Codex",
  enabled: true,
  installed: true,
  version: "1",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: now,
  models: [{ slug: "gpt-5.6", name: "GPT-5.6", isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
});

const thread = (input: {
  readonly id: ThreadId;
  readonly runtimeMode: "approval-required" | "auto" | "full-access";
  readonly envMode: "local" | "worktree";
  readonly archived?: boolean;
  readonly running?: boolean;
}) =>
  Schema.decodeUnknownSync(OrchestrationThreadShell)({
    id: input.id,
    projectId,
    title: String(input.id),
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5.6" },
    runtimeMode: input.runtimeMode,
    interactionMode: "default",
    branch: input.envMode === "worktree" ? "feature" : null,
    worktreePath:
      input.envMode === "worktree" ? `/workspace/worktrees/${input.id}` : "/workspace/project",
    worktreeId: input.envMode === "worktree" ? WorktreeId.make(`worktree-${input.id}`) : null,
    latestTurn: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: input.archived ? now : null,
    session: input.running
      ? {
          threadId: input.id,
          status: "running",
          providerName: "codex",
          providerInstanceId,
          runtimeSessionId: input.id === callerThreadId ? runtimeSessionId : "runtime-target",
          runtimeMode: input.runtimeMode,
          activeTurnId: input.id === callerThreadId ? turnId : "turn-target",
          lastError: null,
          updatedAt: now,
        }
      : null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  });

const session: AgentControlSessionRecord = {
  sessionId: "agent-control-session",
  threadId: callerThreadId,
  providerInstanceId,
  runtimeSessionId,
  grantedCapabilities: [],
  issuedAt: now,
  injectionMode: "codex-http",
};

const authority: AgentControlTurnAuthority = {
  sessionId: session.sessionId,
  threadId: callerThreadId,
  turnId,
  boundAt: now,
};

const makeSnapshot = (
  caller = thread({
    id: callerThreadId,
    runtimeMode: "approval-required",
    envMode: "worktree",
    running: true,
  }),
  target = thread({ id: targetThreadId, runtimeMode: "approval-required", envMode: "worktree" }),
): OrchestrationShellSnapshot => ({
  snapshotSequence: 1,
  projects: [project],
  threads: [caller, target],
  updatedAt: now,
});

const makeValidator = (
  snapshotRef: Ref.Ref<OrchestrationShellSnapshot>,
  providersRef: Ref.Ref<ReadonlyArray<typeof provider>>,
  availableRefs: ReadonlyArray<string> = [],
) =>
  makeAgentControlActionValidatorFromDeps({
    projections: {
      getShellSnapshot: () => Ref.get(snapshotRef),
    } as unknown as ProjectionSnapshotQueryShape,
    getProviders: Ref.get(providersRef),
    listRefs: () =>
      Effect.succeed({
        refs: availableRefs.map((name) => ({
          name,
          current: name === "main",
          isDefault: name === "main",
          worktreePath: null,
        })),
        isRepo: true,
        hasPrimaryRemote: true,
        nextCursor: null,
        totalCount: availableRefs.length,
      }),
  });

it.effect("verifies an exact worktree base ref before creating a proposal", () =>
  Effect.gen(function* () {
    const snapshot = yield* Ref.make(makeSnapshot());
    const providers = yield* Ref.make<ReadonlyArray<typeof provider>>([provider]);
    const plan = {
      kind: "createThreads" as const,
      entries: [
        {
          projectId,
          title: "New task",
          prompt: "Implement it",
          modelSelection: { instanceId: providerInstanceId, model: "gpt-5.6" },
          runtimeMode: "approval-required" as const,
          envMode: "worktree" as const,
          baseRef: "main",
        },
      ],
    };

    const unavailable = yield* Effect.flip(
      makeValidator(snapshot, providers).validateSubmission({ session, authority, plan }),
    );
    assert.strictEqual(unavailable.reason, "worktree-preflight");

    yield* makeValidator(snapshot, providers, ["main"]).validateSubmission({
      session,
      authority,
      plan,
    });
  }),
);

it.effect("blocks runtime and worktree privilege escalation before proposal creation", () =>
  Effect.gen(function* () {
    const providers = yield* Ref.make<ReadonlyArray<typeof provider>>([provider]);

    const runtimeSnapshot = yield* Ref.make(
      makeSnapshot(
        undefined,
        thread({ id: targetThreadId, runtimeMode: "full-access", envMode: "worktree" }),
      ),
    );
    const runtimeError = yield* Effect.flip(
      makeValidator(runtimeSnapshot, providers).validateSubmission({
        session,
        authority,
        plan: {
          kind: "updateThread",
          threadId: targetThreadId,
          title: "No elevation",
        },
      }),
    );
    assert.strictEqual(runtimeError.reason, "privilege-escalation");

    const localSnapshot = yield* Ref.make(
      makeSnapshot(
        undefined,
        thread({ id: targetThreadId, runtimeMode: "approval-required", envMode: "local" }),
      ),
    );
    const localError = yield* Effect.flip(
      makeValidator(localSnapshot, providers).validateSubmission({
        session,
        authority,
        plan: {
          kind: "sendMessage",
          threadId: targetThreadId,
          text: "No checkout proxy",
          delivery: "queue",
        },
      }),
    );
    assert.strictEqual(localError.reason, "worktree-escalation");
  }),
);

it.effect("revalidates target state and provider/model availability at execution time", () =>
  Effect.gen(function* () {
    const snapshot = yield* Ref.make(makeSnapshot());
    const providers = yield* Ref.make<ReadonlyArray<typeof provider>>([provider]);
    const validator = makeValidator(snapshot, providers);
    const principal = yield* validator.validateSubmission({
      session,
      authority,
      plan: {
        kind: "sendMessage",
        threadId: targetThreadId,
        text: "Continue",
        delivery: "queue",
      },
    });
    const proposal: AgentControlProposal = {
      proposalId: AgentControlProposalId.make("proposal-1"),
      requestId: AgentControlRequestId.make("request-1"),
      principal,
      planVersion: 1,
      plan: {
        kind: "sendMessage",
        threadId: targetThreadId,
        text: "Continue",
        delivery: "queue",
      },
      planDigest: "a".repeat(64),
      riskTags: [],
      promptSummary: null,
      status: "approved",
      createdAt: now,
      updatedAt: now,
      expiresAt: "2099-01-01T00:00:00.000Z",
      decidedAt: now,
      result: null,
    };

    yield* Ref.set(snapshot, { ...makeSnapshot(), threads: [makeSnapshot().threads[0]!] });
    const deleted = yield* Effect.flip(validator.revalidateExecution(proposal));
    assert.strictEqual(deleted.reason, "thread-unavailable");

    yield* Ref.set(
      snapshot,
      makeSnapshot(
        undefined,
        thread({ id: targetThreadId, runtimeMode: "auto", envMode: "worktree" }),
      ),
    );
    const changed = yield* Effect.flip(validator.revalidateExecution(proposal));
    assert.strictEqual(changed.reason, "privilege-escalation");

    yield* Ref.set(
      snapshot,
      makeSnapshot(
        undefined,
        thread({
          id: targetThreadId,
          runtimeMode: "approval-required",
          envMode: "worktree",
          archived: true,
        }),
      ),
    );
    const archived = yield* Effect.flip(validator.revalidateExecution(proposal));
    assert.strictEqual(archived.reason, "thread-unavailable");

    yield* Ref.set(snapshot, makeSnapshot());
    yield* Ref.set(providers, [{ ...provider, models: [] }]);
    const missingModel = yield* Effect.flip(validator.revalidateExecution(proposal));
    assert.strictEqual(missingModel.reason, "model-unavailable");

    yield* Ref.set(providers, []);
    const unavailable = yield* Effect.flip(validator.revalidateExecution(proposal));
    assert.strictEqual(unavailable.reason, "provider-unavailable");
  }),
);

it.effect("allows an approved proposal to execute after the origin turn is torn down", () =>
  Effect.gen(function* () {
    const snapshot = yield* Ref.make(makeSnapshot());
    const providers = yield* Ref.make<ReadonlyArray<typeof provider>>([provider]);
    const validator = makeValidator(snapshot, providers);
    const plan = {
      kind: "updateThread" as const,
      threadId: targetThreadId,
      title: "Approved title",
    };
    const principal = yield* validator.validateSubmission({ session, authority, plan });
    const originStopped = thread({
      id: callerThreadId,
      runtimeMode: "approval-required",
      envMode: "worktree",
    });
    yield* Ref.set(snapshot, makeSnapshot(originStopped));

    yield* validator.revalidateExecution({
      proposalId: AgentControlProposalId.make("proposal-origin-stopped"),
      requestId: AgentControlRequestId.make("request-origin-stopped"),
      principal,
      planVersion: 1,
      plan,
      planDigest: "b".repeat(64),
      riskTags: [],
      promptSummary: null,
      status: "approved",
      createdAt: now,
      updatedAt: now,
      expiresAt: "2099-01-01T00:00:00.000Z",
      decidedAt: now,
      result: null,
    });
  }),
);
