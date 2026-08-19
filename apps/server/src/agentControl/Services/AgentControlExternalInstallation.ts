import type {
  AgentControlMcpInstallationConnectInput,
  AgentControlMcpInstallationId,
  AgentControlMcpInstallationListResult,
  AgentControlMcpInstallationMutationResult,
  McpSettingsError,
} from "@ryco/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

import type { AgentControlExternalRepositoryError } from "../../persistence/Errors.ts";
import type { AgentControlMcpInstallationError } from "../Errors.ts";

export type AgentControlExternalInstallationServiceError =
  | AgentControlMcpInstallationError
  | AgentControlExternalRepositoryError
  | McpSettingsError;

export interface AgentControlExternalInstallationServiceShape {
  readonly list: () => Effect.Effect<
    AgentControlMcpInstallationListResult,
    AgentControlExternalInstallationServiceError
  >;
  readonly connect: (
    input: AgentControlMcpInstallationConnectInput,
  ) => Effect.Effect<
    AgentControlMcpInstallationMutationResult,
    AgentControlExternalInstallationServiceError
  >;
  readonly repair: (
    installationId: AgentControlMcpInstallationId,
  ) => Effect.Effect<
    AgentControlMcpInstallationMutationResult,
    AgentControlExternalInstallationServiceError
  >;
  readonly disconnect: (
    installationId: AgentControlMcpInstallationId,
  ) => Effect.Effect<
    AgentControlMcpInstallationMutationResult,
    AgentControlExternalInstallationServiceError
  >;
  readonly recover: Effect.Effect<void>;
}

export class AgentControlExternalInstallationService extends Context.Service<
  AgentControlExternalInstallationService,
  AgentControlExternalInstallationServiceShape
>()("ryco/agentControl/Services/AgentControlExternalInstallation") {}
