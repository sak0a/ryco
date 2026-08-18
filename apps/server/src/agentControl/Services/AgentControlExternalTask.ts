import type {
  AgentControlExternalCreateTaskInput,
  AgentControlExternalTaskId,
  AgentControlExternalTaskResult,
  AgentControlExternalWaitForTaskInput,
  AgentControlIntegrationId,
} from "@ryco/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

import type { AgentControlExternalRepositoryError } from "../../persistence/Errors.ts";
import type {
  AgentControlExternalIntegrationError,
  AgentControlPlanValidationError,
} from "../Errors.ts";
import type { AgentControlProposalStoreError } from "./AgentControlProposalStore.ts";

export type AgentControlExternalTaskServiceError =
  | AgentControlExternalIntegrationError
  | AgentControlExternalRepositoryError
  | AgentControlPlanValidationError
  | AgentControlProposalStoreError;

export interface AgentControlExternalTaskServiceShape {
  readonly create: (input: {
    readonly integrationId: AgentControlIntegrationId;
    readonly request: AgentControlExternalCreateTaskInput;
  }) => Effect.Effect<AgentControlExternalTaskResult, AgentControlExternalTaskServiceError>;
  readonly read: (input: {
    readonly integrationId: AgentControlIntegrationId;
    readonly taskId: AgentControlExternalTaskId;
  }) => Effect.Effect<AgentControlExternalTaskResult, AgentControlExternalTaskServiceError>;
  readonly wait: (input: {
    readonly integrationId: AgentControlIntegrationId;
    readonly request: AgentControlExternalWaitForTaskInput;
  }) => Effect.Effect<AgentControlExternalTaskResult, AgentControlExternalTaskServiceError>;
  readonly recoverCapacity: Effect.Effect<void, AgentControlExternalTaskServiceError>;
}

export class AgentControlExternalTaskService extends Context.Service<
  AgentControlExternalTaskService,
  AgentControlExternalTaskServiceShape
>()("ryco/agentControl/Services/AgentControlExternalTask") {}
