/**
 * ProviderService - Service interface for provider sessions, turns, and checkpoints.
 *
 * Acts as the cross-provider facade used by transports (WebSocket/RPC). It
 * resolves provider adapters through `ProviderAdapterRegistry`, routes
 * session-scoped calls via `ProviderSessionDirectory`, and exposes one unified
 * provider event stream to callers.
 *
 * Uses Effect `Context.Service` for dependency injection and returns typed
 * domain errors for validation, session, codex, and checkpoint workflows.
 *
 * @module ProviderService
 */
import type {
  ProviderInterruptTurnInput,
  ProviderInstanceId,
  ProviderRespondToRequestInput,
  ProviderRespondToUserInputInput,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  RuntimeSessionId,
  ProviderStopSessionInput,
  ThreadId,
  ProviderTurnStartResult,
} from "@ryco/contracts";
import { Context } from "effect";
import type { Effect, Option, Stream } from "effect";

import type { ProviderServiceError } from "../Errors.ts";
import type { ProviderAdapterCapabilities } from "./ProviderAdapter.ts";
import type { ProviderInstanceRoutingInfo } from "./ProviderAdapterRegistry.ts";
import type { ProviderRuntimeBinding } from "./ProviderSessionDirectory.ts";

export type ProviderFreshSessionStartInput = Omit<
  ProviderSessionStartInput,
  "runtimeSessionId" | "resumeCursor" | "resumePolicy"
> & {
  readonly runtimeSessionId: RuntimeSessionId;
};

export interface ProviderFreshSessionStartResult {
  readonly session: ProviderSession;
  readonly previousBinding?: ProviderRuntimeBinding;
}

export type ProviderSessionBindingStopResult = "stopped" | "not-found" | "timed-out";

/**
 * ProviderServiceShape - Service API for provider session and turn orchestration.
 */
export interface ProviderServiceShape {
  /**
   * Start a provider session.
   */
  readonly startSession: (
    threadId: ThreadId,
    input: ProviderSessionStartInput,
  ) => Effect.Effect<ProviderSession, ProviderServiceError>;

  /** Start a fresh epoch and return the exact prior binding as a rollback token. */
  readonly startFreshSession: (
    threadId: ThreadId,
    input: ProviderFreshSessionStartInput,
  ) => Effect.Effect<ProviderFreshSessionStartResult, ProviderServiceError>;

  /** Resolve only the adapter session matching the authoritative persisted binding. */
  readonly getSession: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<ProviderSession>, ProviderServiceError>;

  /** Restore a prior binding only while its exact instance/runtime is still live. */
  readonly restoreSessionBinding: (
    binding: ProviderRuntimeBinding,
  ) => Effect.Effect<boolean, ProviderServiceError>;

  /**
   * Retire an exact failed target epoch if it is still authoritative.
   * Clears provider-native resume state without reviving an exited source.
   */
  readonly retireSessionBinding: (
    binding: ProviderRuntimeBinding,
  ) => Effect.Effect<boolean, ProviderServiceError>;

  /** Stop one exact binding with a bounded deadline and queue timed-out cleanup. */
  readonly stopSessionBinding: (
    binding: ProviderRuntimeBinding,
  ) => Effect.Effect<ProviderSessionBindingStopResult, ProviderServiceError>;

  /** In-memory stale bindings awaiting a later bounded reaper retry. */
  readonly listStaleSessionBindings: () => Effect.Effect<ReadonlyArray<ProviderRuntimeBinding>>;

  /**
   * Send a provider turn.
   */
  readonly sendTurn: (
    input: ProviderSendTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, ProviderServiceError>;

  /**
   * Interrupt a running provider turn.
   */
  readonly interruptTurn: (
    input: ProviderInterruptTurnInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Stop one live background task without interrupting the turn. Fails with
   * ProviderUnsupportedError when the routed adapter cannot stop tasks
   * individually.
   */
  readonly stopBackgroundTask: (
    input: ProviderStopBackgroundTaskInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Respond to a provider approval request.
   */
  readonly respondToRequest: (
    input: ProviderRespondToRequestInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Respond to a provider structured user-input request.
   */
  readonly respondToUserInput: (
    input: ProviderRespondToUserInputInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Stop a provider session.
   */
  readonly stopSession: (
    input: ProviderStopSessionInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * List active provider sessions.
   *
   * Aggregates runtime session lists from all registered adapters.
   */
  readonly listSessions: () => Effect.Effect<ReadonlyArray<ProviderSession>>;

  /**
   * Read capabilities for the adapter bound to a configured provider instance.
   */
  readonly getCapabilities: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderAdapterCapabilities, ProviderServiceError>;

  readonly getInstanceInfo: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderInstanceRoutingInfo, ProviderServiceError>;

  /**
   * Roll back provider conversation state by a number of turns.
   */
  readonly rollbackConversation: (input: {
    readonly threadId: ThreadId;
    readonly numTurns: number;
  }) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Canonical provider runtime event stream.
   *
   * Fan-out is owned by ProviderService (not by a standalone event-bus service).
   */
  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;
}

/**
 * ProviderService - Service tag for provider orchestration.
 */
export class ProviderService extends Context.Service<ProviderService, ProviderServiceShape>()(
  "ryco/provider/Services/ProviderService",
) {}
