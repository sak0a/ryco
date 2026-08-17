/**
 * Agent Control contracts.
 *
 * Schema-only definitions for the Agent Control control plane: principals,
 * capabilities, immutable action plans, approval proposals, and durable
 * execution operations. Agents never receive ambient write access — every
 * mutation is first captured as an immutable `AgentControlProposal` that a
 * user must approve, and only the server-side executor may move an accepted
 * proposal into execution.
 *
 * Extension rules
 * ---------------
 * These schemas are designed for additive extension:
 *
 *   - `AgentControlActionPlan` is a closed union discriminated by `kind`.
 *     New action kinds are added as new union members; previously persisted
 *     plans keep decoding unchanged.
 *   - Capabilities, risk tags, and error codes are open branded slugs (the
 *     same forward-compatibility posture as `ProviderDriverKind`): payloads
 *     persisted by a newer build must decode on this build. Authorization is
 *     the runtime's job and fails closed on capabilities it does not grant.
 *   - Target selection always uses `ProviderInstanceId` + `ModelSelection`.
 *     A static provider-kind targeting API would lose configured provider
 *     instances and is deliberately not part of this contract.
 *
 * @module agentControl
 */
import { Effect, Schema } from "effect";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  RuntimeSessionId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";
import { ModelSelection, RuntimeMode } from "./orchestration.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { ThreadEnvMode } from "./settings.ts";
import { WorktreeId } from "./worktree.ts";

// ── Identifiers ───────────────────────────────────────────────────────

export const AgentControlProposalId = TrimmedNonEmptyString.pipe(
  Schema.brand("AgentControlProposalId"),
);
export type AgentControlProposalId = typeof AgentControlProposalId.Type;

export const AgentControlOperationId = TrimmedNonEmptyString.pipe(
  Schema.brand("AgentControlOperationId"),
);
export type AgentControlOperationId = typeof AgentControlOperationId.Type;

export const AgentControlIntegrationId = TrimmedNonEmptyString.check(Schema.isMaxLength(128)).pipe(
  Schema.brand("AgentControlIntegrationId"),
);
export type AgentControlIntegrationId = typeof AgentControlIntegrationId.Type;

/**
 * Caller-chosen idempotency key. Unique within one principal's request-id
 * scope: retrying an identical plan under the same id must return the
 * original proposal, and reusing an id with a different plan must fail.
 */
export const AGENT_CONTROL_REQUEST_ID_MAX_CHARS = 128;
export const AgentControlRequestId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(AGENT_CONTROL_REQUEST_ID_MAX_CHARS),
).pipe(Schema.brand("AgentControlRequestId"));
export type AgentControlRequestId = typeof AgentControlRequestId.Type;

// ── Principals ────────────────────────────────────────────────────────

/**
 * An agent already running inside a Ryco thread. Its credential is
 * per-provider-runtime, in-memory, thread-bound, and revoked on runtime
 * teardown — none of that credential material appears in this contract.
 */
export const AgentControlProviderSessionPrincipal = Schema.Struct({
  kind: Schema.Literal("provider-session"),
  threadId: ThreadId,
  providerInstanceId: ProviderInstanceId,
  /** Runtime epoch of the session that issued the request, when known. */
  runtimeSessionId: Schema.optional(RuntimeSessionId),
  /** The exact running turn the request was bound to, when known. */
  turnId: Schema.optional(TurnId),
});
export type AgentControlProviderSessionPrincipal = typeof AgentControlProviderSessionPrincipal.Type;

/**
 * A separately paired local MCP client. Pairing, credential issuance, and
 * scope grants are owned by later PRs; the principal identity is defined
 * here so proposals persist a stable, audit-safe origin from day one.
 */
export const AgentControlExternalIntegrationPrincipal = Schema.Struct({
  kind: Schema.Literal("external-integration"),
  integrationId: AgentControlIntegrationId,
  label: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(120))),
});
export type AgentControlExternalIntegrationPrincipal =
  typeof AgentControlExternalIntegrationPrincipal.Type;

export const AgentControlPrincipal = Schema.Union([
  AgentControlProviderSessionPrincipal,
  AgentControlExternalIntegrationPrincipal,
]);
export type AgentControlPrincipal = typeof AgentControlPrincipal.Type;

// ── Capabilities ──────────────────────────────────────────────────────

const AGENT_CONTROL_SLUG_MAX_CHARS = 64;
const agentControlSlug = TrimmedNonEmptyString.check(
  Schema.isMaxLength(AGENT_CONTROL_SLUG_MAX_CHARS),
  Schema.isPattern(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/),
);

/**
 * Open branded capability slug. Grants persisted by a newer build must
 * decode here; the policy layer only ever authorizes capabilities it
 * knows and grants, so unknown slugs fail closed at evaluation time.
 */
export const AgentControlCapability = agentControlSlug.pipe(Schema.brand("AgentControlCapability"));
export type AgentControlCapability = typeof AgentControlCapability.Type;

export const AGENT_CONTROL_CAPABILITIES = {
  read: AgentControlCapability.make("read"),
  createThreads: AgentControlCapability.make("threads.create"),
  sendMessage: AgentControlCapability.make("threads.send-message"),
  interruptThread: AgentControlCapability.make("threads.interrupt"),
  updateThread: AgentControlCapability.make("threads.update"),
} as const;

// ── Action plans ──────────────────────────────────────────────────────

export const AgentControlActionKind = Schema.Literals([
  "createThreads",
  "sendMessage",
  "interruptThread",
  "updateThread",
]);
export type AgentControlActionKind = typeof AgentControlActionKind.Type;

/** Required capability per mutation action kind. */
export const AGENT_CONTROL_ACTION_CAPABILITIES: Record<
  AgentControlActionKind,
  AgentControlCapability
> = {
  createThreads: AGENT_CONTROL_CAPABILITIES.createThreads,
  sendMessage: AGENT_CONTROL_CAPABILITIES.sendMessage,
  interruptThread: AGENT_CONTROL_CAPABILITIES.interruptThread,
  updateThread: AGENT_CONTROL_CAPABILITIES.updateThread,
};

export const AGENT_CONTROL_PLAN_VERSION = 1;
/** Matches `PROVIDER_SEND_TURN_MAX_INPUT_CHARS` — a plan prompt becomes a turn input. */
export const AGENT_CONTROL_PROMPT_MAX_CHARS = 120_000;
export const AGENT_CONTROL_TITLE_MAX_CHARS = 200;
export const AGENT_CONTROL_CREATE_THREADS_MAX_ENTRIES = 10;
export const AGENT_CONTROL_PERSISTENT_GOAL_MAX_CHARS = 4_000;

const AgentControlPrompt = TrimmedNonEmptyString.check(
  Schema.isMaxLength(AGENT_CONTROL_PROMPT_MAX_CHARS),
);
const AgentControlTitle = TrimmedNonEmptyString.check(
  Schema.isMaxLength(AGENT_CONTROL_TITLE_MAX_CHARS),
);

export const AgentControlCreateThreadEntry = Schema.Struct({
  projectId: ProjectId,
  title: AgentControlTitle,
  prompt: AgentControlPrompt,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  /** Isolated worktree vs the project's shared local checkout. */
  envMode: ThreadEnvMode,
  /** Base ref for worktree creation; the project default when absent. */
  baseRef: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
});
export type AgentControlCreateThreadEntry = typeof AgentControlCreateThreadEntry.Type;

/** One exact immutable batch — never a generic spawning loop. */
export const AgentControlCreateThreadsPlan = Schema.Struct({
  kind: Schema.Literal("createThreads"),
  entries: Schema.Array(AgentControlCreateThreadEntry).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(AGENT_CONTROL_CREATE_THREADS_MAX_ENTRIES),
  ),
});
export type AgentControlCreateThreadsPlan = typeof AgentControlCreateThreadsPlan.Type;

export const AgentControlSendMessageDelivery = Schema.Literals(["queue", "steer"]);
export type AgentControlSendMessageDelivery = typeof AgentControlSendMessageDelivery.Type;

export const AgentControlSendMessagePlan = Schema.Struct({
  kind: Schema.Literal("sendMessage"),
  threadId: ThreadId,
  text: AgentControlPrompt,
  delivery: AgentControlSendMessageDelivery,
});
export type AgentControlSendMessagePlan = typeof AgentControlSendMessagePlan.Type;

export const AgentControlInterruptThreadPlan = Schema.Struct({
  kind: Schema.Literal("interruptThread"),
  threadId: ThreadId,
  /** When present, only this exact turn may be interrupted. */
  turnId: Schema.optional(TurnId),
});
export type AgentControlInterruptThreadPlan = typeof AgentControlInterruptThreadPlan.Type;

export const AgentControlUpdateThreadPlan = Schema.Struct({
  kind: Schema.Literal("updateThread"),
  threadId: ThreadId,
  title: Schema.optional(AgentControlTitle),
  archived: Schema.optional(Schema.Boolean),
  /** An explicitly requested persistent goal; `null` clears it. */
  persistentGoal: Schema.optional(
    Schema.NullOr(
      TrimmedNonEmptyString.check(Schema.isMaxLength(AGENT_CONTROL_PERSISTENT_GOAL_MAX_CHARS)),
    ),
  ),
});
export type AgentControlUpdateThreadPlan = typeof AgentControlUpdateThreadPlan.Type;

export const AgentControlActionPlan = Schema.Union([
  AgentControlCreateThreadsPlan,
  AgentControlSendMessagePlan,
  AgentControlInterruptThreadPlan,
  AgentControlUpdateThreadPlan,
]);
export type AgentControlActionPlan = typeof AgentControlActionPlan.Type;

// ── Digest, risk tags, prompt summary ─────────────────────────────────

/** sha-256 hex over the canonical encoded plan payload. */
export const AgentControlPlanDigest = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[a-f0-9]{64}$/),
);
export type AgentControlPlanDigest = typeof AgentControlPlanDigest.Type;

/** Open branded risk-tag slug; same forward-compat rules as capabilities. */
export const AgentControlRiskTag = agentControlSlug.pipe(Schema.brand("AgentControlRiskTag"));
export type AgentControlRiskTag = typeof AgentControlRiskTag.Type;

export const AGENT_CONTROL_RISK_TAGS = {
  createsThreads: AgentControlRiskTag.make("creates-threads"),
  startsProviderTurn: AgentControlRiskTag.make("starts-provider-turn"),
  interruptsThread: AgentControlRiskTag.make("interrupts-thread"),
  modifiesThreadMetadata: AgentControlRiskTag.make("modifies-thread-metadata"),
  sharedLocalCheckout: AgentControlRiskTag.make("shared-local-checkout"),
  elevatedRuntimeMode: AgentControlRiskTag.make("elevated-runtime-mode"),
} as const;

/**
 * Audit-safe compact summary shown on approval cards and retained in audit
 * rows. Never a full prompt: bounded, and produced server-side.
 */
export const AGENT_CONTROL_PROMPT_SUMMARY_MAX_CHARS = 500;
export const AgentControlPromptSummary = TrimmedNonEmptyString.check(
  Schema.isMaxLength(AGENT_CONTROL_PROMPT_SUMMARY_MAX_CHARS),
);
export type AgentControlPromptSummary = typeof AgentControlPromptSummary.Type;

// ── Result and error envelopes ────────────────────────────────────────

export const AGENT_CONTROL_ERROR_MESSAGE_MAX_CHARS = 2_000;
const AgentControlResultMessage = TrimmedNonEmptyString.check(
  Schema.isMaxLength(AGENT_CONTROL_ERROR_MESSAGE_MAX_CHARS),
);

/** Open branded error-code slug; same forward-compat rules as capabilities. */
export const AgentControlErrorCode = agentControlSlug.pipe(Schema.brand("AgentControlErrorCode"));
export type AgentControlErrorCode = typeof AgentControlErrorCode.Type;

export const AGENT_CONTROL_ERROR_CODES = {
  rejected: AgentControlErrorCode.make("rejected"),
  expired: AgentControlErrorCode.make("expired"),
  cancelled: AgentControlErrorCode.make("cancelled"),
  duplicateRequest: AgentControlErrorCode.make("duplicate-request"),
  revalidationFailed: AgentControlErrorCode.make("revalidation-failed"),
  executionFailed: AgentControlErrorCode.make("execution-failed"),
  featureDisabled: AgentControlErrorCode.make("feature-disabled"),
  capabilityDenied: AgentControlErrorCode.make("capability-denied"),
} as const;

export const AgentControlErrorEnvelope = Schema.Struct({
  code: AgentControlErrorCode,
  message: AgentControlResultMessage,
  /** Whether a fresh request (with a new request id) could succeed. */
  retryable: Schema.Boolean,
});
export type AgentControlErrorEnvelope = typeof AgentControlErrorEnvelope.Type;

export const AgentControlCompletedResult = Schema.Struct({
  outcome: Schema.Literal("completed"),
  createdThreadIds: Schema.optional(Schema.Array(ThreadId)),
  detail: Schema.optional(AgentControlResultMessage),
  completedAt: IsoDateTime,
});
export type AgentControlCompletedResult = typeof AgentControlCompletedResult.Type;

export const AgentControlFailedResult = Schema.Struct({
  outcome: Schema.Literal("failed"),
  error: AgentControlErrorEnvelope,
  failedAt: IsoDateTime,
});
export type AgentControlFailedResult = typeof AgentControlFailedResult.Type;

/** Terminal receipt readable by the originating MCP client. */
export const AgentControlResultEnvelope = Schema.Union([
  AgentControlCompletedResult,
  AgentControlFailedResult,
]);
export type AgentControlResultEnvelope = typeof AgentControlResultEnvelope.Type;

// ── Proposals ─────────────────────────────────────────────────────────

export const AgentControlProposalStatus = Schema.Literals([
  "pending-user-approval",
  "approved",
  "rejected",
  "expired",
  "executing",
  "completed",
  "failed",
  "cancelled",
]);
export type AgentControlProposalStatus = typeof AgentControlProposalStatus.Type;

export const AGENT_CONTROL_TERMINAL_PROPOSAL_STATUSES: ReadonlyArray<AgentControlProposalStatus> = [
  "rejected",
  "expired",
  "completed",
  "failed",
  "cancelled",
];

/**
 * Immutable approval proposal. Accepting a proposal authorizes only its
 * `planDigest` — the plan payload and digest are written once and never
 * updated; a changed plan requires a new request.
 */
export const AgentControlProposal = Schema.Struct({
  proposalId: AgentControlProposalId,
  requestId: AgentControlRequestId,
  principal: AgentControlPrincipal,
  planVersion: Schema.Literal(AGENT_CONTROL_PLAN_VERSION),
  plan: AgentControlActionPlan,
  planDigest: AgentControlPlanDigest,
  riskTags: Schema.Array(AgentControlRiskTag),
  promptSummary: Schema.NullOr(AgentControlPromptSummary),
  status: AgentControlProposalStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  expiresAt: IsoDateTime,
  decidedAt: Schema.NullOr(IsoDateTime),
  result: Schema.NullOr(AgentControlResultEnvelope),
});
export type AgentControlProposal = typeof AgentControlProposal.Type;

// ── Operations ────────────────────────────────────────────────────────

export const AgentControlOperationStatus = Schema.Literals([
  "pending",
  "running",
  "compensating",
  "completed",
  "failed",
  "cancelled",
]);
export type AgentControlOperationStatus = typeof AgentControlOperationStatus.Type;

export const AGENT_CONTROL_TERMINAL_OPERATION_STATUSES: ReadonlyArray<AgentControlOperationStatus> =
  ["completed", "failed", "cancelled"];

/**
 * Resources an operation has created so far. Persisted so restart recovery
 * can prove operation ownership (e.g. of a preflighted worktree) and either
 * clean up safely or surface a clearly terminal failure.
 */
export const AgentControlOperationResources = Schema.Struct({
  threadIds: Schema.Array(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  worktreeIds: Schema.Array(WorktreeId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type AgentControlOperationResources = typeof AgentControlOperationResources.Type;

export const AgentControlOperationState = Schema.Struct({
  completedSteps: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(128))).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  resources: AgentControlOperationResources.pipe(
    Schema.withDecodingDefault(Effect.succeed({ threadIds: [], worktreeIds: [] })),
  ),
  note: Schema.optional(AgentControlResultMessage),
});
export type AgentControlOperationState = typeof AgentControlOperationState.Type;

/**
 * Durable execution record for an accepted proposal. Exactly one operation
 * exists per proposal; its monotonic state and resource evidence are what
 * restart recovery replays.
 */
export const AgentControlOperation = Schema.Struct({
  operationId: AgentControlOperationId,
  proposalId: AgentControlProposalId,
  actionKind: AgentControlActionKind,
  status: AgentControlOperationStatus,
  attempt: NonNegativeInt,
  state: AgentControlOperationState,
  result: Schema.NullOr(AgentControlResultEnvelope),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AgentControlOperation = typeof AgentControlOperation.Type;
