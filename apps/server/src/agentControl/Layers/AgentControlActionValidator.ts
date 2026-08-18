import type {
  AgentControlActionPlan,
  AgentControlProviderSessionPrincipal,
  AgentControlProposal,
  ModelSelection,
  OrchestrationShellSnapshot,
  OrchestrationThreadShell,
  RuntimeMode,
  ServerProvider,
} from "@ryco/contracts";
import { Effect, Layer } from "effect";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { ProjectionSnapshotQueryShape } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import type { GitWorkflowServiceShape } from "../../git/GitWorkflowService.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { AgentControlPlanValidationError } from "../Errors.ts";
import {
  AgentControlActionValidator,
  agentControlThreadEnvMode,
  isAgentControlProviderReady,
  type AgentControlActionValidatorShape,
} from "../Services/AgentControlActionValidator.ts";

const fail = (
  reason: ConstructorParameters<typeof AgentControlPlanValidationError>[0]["reason"],
  detail: string,
) => Effect.fail(new AgentControlPlanValidationError({ reason, detail }));

const runtimeRank: Record<RuntimeMode, number> = {
  "approval-required": 0,
  "auto-accept-edits": 1,
  auto: 2,
  "full-access": 3,
};

const providerForSelection = (
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection,
) => {
  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  if (!provider || !isAgentControlProviderReady(provider)) {
    return fail(
      "provider-unavailable",
      `Provider instance '${selection.instanceId}' is unavailable.`,
    );
  }
  const model = provider.models.find((candidate) => candidate.slug === selection.model);
  if (!model) {
    return fail(
      "model-unavailable",
      `Model '${selection.model}' is unavailable on instance '${selection.instanceId}'.`,
    );
  }

  const seen = new Set<string>();
  for (const option of selection.options ?? []) {
    if (seen.has(option.id)) {
      return fail("invalid-options", `Model option '${option.id}' is duplicated.`);
    }
    seen.add(option.id);
    const descriptor = model.capabilities?.optionDescriptors?.find(
      (candidate) => candidate.id === option.id,
    );
    if (!descriptor) {
      return fail("invalid-options", `Model option '${option.id}' is unavailable.`);
    }
    if (descriptor.type === "boolean") {
      if (typeof option.value !== "boolean") {
        return fail("invalid-options", `Model option '${option.id}' must be boolean.`);
      }
    } else if (
      typeof option.value !== "string" ||
      !descriptor.options.some((candidate) => candidate.id === option.value)
    ) {
      return fail("invalid-options", `Model option '${option.id}' has an unavailable value.`);
    }
  }
  return Effect.succeed(provider);
};

const targetThreadIds = (plan: AgentControlActionPlan): ReadonlyArray<string> =>
  plan.kind === "createThreads" ? [] : [plan.threadId];

const requireThread = (snapshot: OrchestrationShellSnapshot, threadId: string) => {
  const thread = snapshot.threads.find((candidate) => candidate.id === threadId);
  return thread
    ? Effect.succeed(thread)
    : fail("thread-unavailable", "Target thread is unavailable.");
};

const validateBaseRef = (baseRef: string | undefined) => {
  if (baseRef === undefined) return Effect.void;
  if (
    baseRef.startsWith("-") ||
    baseRef.includes("\0") ||
    baseRef.includes("\n") ||
    baseRef.includes("\r")
  ) {
    return fail("invalid-plan", "The requested base ref is invalid.");
  }
  return Effect.void;
};

const validatePlanAgainstSnapshot = (input: {
  readonly plan: AgentControlActionPlan;
  readonly originProjectId: string;
  readonly originRuntimeMode: RuntimeMode;
  readonly originEnvMode: "local" | "worktree";
  readonly snapshot: OrchestrationShellSnapshot;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly requireBaseRef: (
    cwd: string,
    baseRef: string,
  ) => Effect.Effect<void, AgentControlPlanValidationError>;
}) =>
  Effect.gen(function* () {
    const assertPrivilege = (target: OrchestrationThreadShell) =>
      Effect.gen(function* () {
        if (runtimeRank[target.runtimeMode] > runtimeRank[input.originRuntimeMode]) {
          return yield* fail(
            "privilege-escalation",
            "The target thread has a more privileged runtime mode than the caller.",
          );
        }
        if (
          input.originEnvMode === "worktree" &&
          agentControlThreadEnvMode(target) !== "worktree"
        ) {
          return yield* fail(
            "worktree-escalation",
            "A worktree-isolated caller cannot target a shared local checkout.",
          );
        }
      });

    if (input.plan.kind === "createThreads") {
      for (const entry of input.plan.entries) {
        if (entry.projectId !== input.originProjectId) {
          return yield* fail("project-scope", "The requested project is outside caller scope.");
        }
        const project = input.snapshot.projects.find(
          (candidate) => candidate.id === entry.projectId,
        );
        if (!project) {
          return yield* fail("project-unavailable", "The requested project is unavailable.");
        }
        if (runtimeRank[entry.runtimeMode] > runtimeRank[input.originRuntimeMode]) {
          return yield* fail(
            "privilege-escalation",
            "The requested runtime mode is more privileged than the caller.",
          );
        }
        if (input.originEnvMode === "worktree" && entry.envMode !== "worktree") {
          return yield* fail(
            "worktree-escalation",
            "A worktree-isolated caller cannot create a shared local thread.",
          );
        }
        if (entry.envMode === "local" && entry.baseRef !== undefined) {
          return yield* fail("invalid-plan", "A local-checkout thread cannot request a base ref.");
        }
        yield* validateBaseRef(entry.baseRef);
        if (
          entry.envMode === "worktree" &&
          entry.baseRef !== undefined &&
          entry.baseRef !== "HEAD"
        ) {
          yield* input.requireBaseRef(project.workspaceRoot, entry.baseRef);
        }
        yield* providerForSelection(input.providers, entry.modelSelection);
      }
      return;
    }

    const target = yield* requireThread(input.snapshot, input.plan.threadId);
    if (target.projectId !== input.originProjectId) {
      return yield* fail("project-scope", "The target thread is outside caller project scope.");
    }
    yield* assertPrivilege(target);

    if (input.plan.kind === "updateThread") {
      if (
        input.plan.title === undefined &&
        input.plan.archived === undefined &&
        input.plan.persistentGoal === undefined
      ) {
        return yield* fail("invalid-plan", "At least one supported thread update is required.");
      }
      if (
        target.archivedAt !== null &&
        input.plan.archived !== false &&
        (input.plan.title !== undefined || input.plan.persistentGoal !== undefined)
      ) {
        return yield* fail("thread-unavailable", "Archived thread metadata cannot be updated.");
      }
      return;
    }

    if (target.archivedAt !== null) {
      return yield* fail("thread-unavailable", "The target thread is archived.");
    }

    if (input.plan.kind === "interruptThread") {
      const activeTurnId = target.session?.activeTurnId ?? null;
      if (activeTurnId === null || target.session?.status !== "running") {
        return yield* fail("thread-unavailable", "The target thread has no running turn.");
      }
      if (input.plan.turnId !== undefined && input.plan.turnId !== activeTurnId) {
        return yield* fail("thread-stale", "The requested turn is no longer active.");
      }
      return;
    }

    yield* providerForSelection(input.providers, target.modelSelection);
  });

export const makeAgentControlActionValidatorFromDeps = (deps: {
  readonly projections: ProjectionSnapshotQueryShape;
  readonly getProviders: Effect.Effect<ReadonlyArray<ServerProvider>>;
  readonly listRefs: GitWorkflowServiceShape["listRefs"];
}): AgentControlActionValidatorShape => {
  const loadState = Effect.all({
    snapshot: deps.projections.getShellSnapshot(),
    providers: deps.getProviders,
  }).pipe(
    Effect.mapError(
      () =>
        new AgentControlPlanValidationError({
          reason: "project-unavailable",
          detail: "Current Ryco state is unavailable.",
        }),
    ),
  );

  const requireBaseRef = (cwd: string, baseRef: string) =>
    deps.listRefs({ cwd, query: baseRef, limit: 200 }).pipe(
      Effect.mapError(
        () =>
          new AgentControlPlanValidationError({
            reason: "worktree-preflight",
            detail: "The requested worktree base ref could not be verified.",
          }),
      ),
      Effect.flatMap((result) =>
        result.refs.some((ref) => ref.name === baseRef)
          ? Effect.void
          : fail("worktree-preflight", "The requested worktree base ref is unavailable."),
      ),
    );

  const validateSubmission: AgentControlActionValidatorShape["validateSubmission"] = (input) =>
    Effect.gen(function* () {
      const { snapshot, providers } = yield* loadState;
      const caller = snapshot.threads.find((thread) => thread.id === input.session.threadId);
      if (
        !caller ||
        caller.archivedAt !== null ||
        caller.session?.status !== "running" ||
        caller.session.activeTurnId !== input.authority.turnId ||
        input.authority.sessionId !== input.session.sessionId ||
        input.authority.threadId !== input.session.threadId ||
        caller.session.providerInstanceId !== input.session.providerInstanceId ||
        caller.session.runtimeSessionId !== input.session.runtimeSessionId
      ) {
        return yield* fail("caller-stale", "Exact active-turn write authority is unavailable.");
      }

      const originEnvMode = agentControlThreadEnvMode(caller);
      yield* validatePlanAgainstSnapshot({
        plan: input.plan,
        originProjectId: caller.projectId,
        originRuntimeMode: caller.runtimeMode,
        originEnvMode,
        snapshot,
        providers,
        requireBaseRef,
      });

      const targetSnapshots: Array<
        NonNullable<AgentControlProviderSessionPrincipal["targetSnapshots"]>[number]
      > = [];
      for (const threadId of targetThreadIds(input.plan)) {
        const target = yield* requireThread(snapshot, threadId);
        targetSnapshots.push({
          threadId: target.id,
          projectId: target.projectId,
          runtimeMode: target.runtimeMode,
          envMode: agentControlThreadEnvMode(target),
          archived: target.archivedAt !== null,
          activeTurnId: target.session?.activeTurnId ?? null,
        });
      }

      return {
        kind: "provider-session",
        threadId: input.session.threadId,
        providerInstanceId: input.session.providerInstanceId,
        runtimeSessionId: input.session.runtimeSessionId,
        turnId: input.authority.turnId,
        originProjectId: caller.projectId,
        originRuntimeMode: caller.runtimeMode,
        originEnvMode,
        targetSnapshots,
      } satisfies AgentControlProviderSessionPrincipal;
    });

  const revalidateExecution: AgentControlActionValidatorShape["revalidateExecution"] = (
    proposal: AgentControlProposal,
    options,
  ) =>
    Effect.gen(function* () {
      const originProjectId =
        proposal.principal.kind === "provider-session"
          ? proposal.principal.originProjectId
          : undefined;
      const originRuntimeMode =
        proposal.principal.kind === "provider-session"
          ? proposal.principal.originRuntimeMode
          : undefined;
      const originEnvMode =
        proposal.principal.kind === "provider-session"
          ? proposal.principal.originEnvMode
          : undefined;
      if (
        proposal.principal.kind !== "provider-session" ||
        originProjectId === undefined ||
        originRuntimeMode === undefined ||
        originEnvMode === undefined
      ) {
        return yield* fail("caller-stale", "Proposal origin evidence is incomplete.");
      }
      const principal = proposal.principal;
      const { snapshot, providers } = yield* loadState;
      const origin = snapshot.threads.find((thread) => thread.id === principal.threadId);
      if (!origin || origin.projectId !== originProjectId) {
        return yield* fail("caller-stale", "The originating thread is unavailable.");
      }

      yield* validatePlanAgainstSnapshot({
        plan: proposal.plan,
        originProjectId,
        originRuntimeMode,
        originEnvMode,
        snapshot,
        providers,
        requireBaseRef,
      });

      for (const expected of principal.targetSnapshots ?? []) {
        const current = snapshot.threads.find((thread) => thread.id === expected.threadId);
        if (!current) {
          return yield* fail("thread-unavailable", "The approved target thread was deleted.");
        }
        const commonChanged =
          current.projectId !== expected.projectId ||
          current.runtimeMode !== expected.runtimeMode ||
          agentControlThreadEnvMode(current) !== expected.envMode ||
          (current.archivedAt !== null) !== expected.archived;
        const activeTurnChanged =
          options?.allowTurnAdvance !== true &&
          (proposal.plan.kind === "interruptThread" ||
            (proposal.plan.kind === "sendMessage" && proposal.plan.delivery === "steer")) &&
          (current.session?.activeTurnId ?? null) !== expected.activeTurnId;
        if (commonChanged || activeTurnChanged) {
          return yield* fail("thread-stale", "The approved target thread state changed.");
        }
      }
    });

  return { validateSubmission, revalidateExecution } satisfies AgentControlActionValidatorShape;
};

const makeAgentControlActionValidator = Effect.gen(function* () {
  const projections = yield* ProjectionSnapshotQuery;
  const providerRegistry = yield* ProviderRegistry;
  const git = yield* GitWorkflowService;
  return makeAgentControlActionValidatorFromDeps({
    projections,
    getProviders: providerRegistry.getProviders,
    listRefs: git.listRefs,
  });
});

export const AgentControlActionValidatorLive = Layer.effect(
  AgentControlActionValidator,
  makeAgentControlActionValidator,
);
