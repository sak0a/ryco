import type {
  AgentControlCapability,
  AgentControlExternalIntegration,
  AgentControlExternalIntegrationCreateInput,
  AgentControlExternalIntegrationDeleteResult,
  AgentControlExternalIntegrationDetail,
  AgentControlExternalIntegrationListResult,
  AgentControlExternalIntegrationMutationResult,
  AgentControlExternalIntegrationUpdateInput,
  AgentControlExternalPairingResult,
  AgentControlIntegrationId,
  ProjectId,
} from "@ryco/contracts";
import { Context } from "effect";
import type { Effect, PubSub, Redacted, Scope } from "effect";

import type { AgentControlExternalRepositoryError } from "../../persistence/Errors.ts";
import type {
  AgentControlExternalAuditRecord,
  StoredAgentControlExternalIntegration,
} from "../../persistence/Services/AgentControlExternal.ts";
import type { AgentControlDisabledError, AgentControlExternalIntegrationError } from "../Errors.ts";

export type AgentControlExternalIntegrationServiceError =
  | AgentControlDisabledError
  | AgentControlExternalIntegrationError
  | AgentControlExternalRepositoryError;

export interface AgentControlExternalAuthenticatedIdentity {
  readonly integration: AgentControlExternalIntegration;
}

export interface AgentControlExternalPairingExchange {
  readonly integrationId: AgentControlIntegrationId;
  readonly credential: Redacted.Redacted<string>;
}

export interface AgentControlExternalIntegrationServiceShape {
  readonly list: () => Effect.Effect<
    AgentControlExternalIntegrationListResult,
    AgentControlExternalIntegrationServiceError
  >;
  readonly create: (
    input: AgentControlExternalIntegrationCreateInput,
  ) => Effect.Effect<
    AgentControlExternalPairingResult,
    AgentControlExternalIntegrationServiceError
  >;
  readonly update: (
    input: AgentControlExternalIntegrationUpdateInput,
  ) => Effect.Effect<
    AgentControlExternalIntegrationMutationResult,
    AgentControlExternalIntegrationServiceError
  >;
  readonly resumePairing: (
    integrationId: AgentControlIntegrationId,
  ) => Effect.Effect<
    AgentControlExternalPairingResult,
    AgentControlExternalIntegrationServiceError
  >;
  readonly revoke: (
    integrationId: AgentControlIntegrationId,
  ) => Effect.Effect<
    AgentControlExternalIntegrationMutationResult,
    AgentControlExternalIntegrationServiceError
  >;
  readonly delete: (
    integrationId: AgentControlIntegrationId,
  ) => Effect.Effect<
    AgentControlExternalIntegrationDeleteResult,
    AgentControlExternalIntegrationServiceError
  >;
  readonly exchangePairing: (input: {
    readonly integrationId: AgentControlIntegrationId;
    readonly pairingCode: string;
  }) => Effect.Effect<
    AgentControlExternalPairingExchange,
    AgentControlExternalIntegrationServiceError
  >;
  readonly authenticate: (
    authorizationHeader: string | undefined,
  ) => Effect.Effect<
    AgentControlExternalAuthenticatedIdentity,
    AgentControlExternalIntegrationServiceError
  >;
  readonly revalidate: (
    integrationId: AgentControlIntegrationId,
  ) => Effect.Effect<AgentControlExternalIntegration, AgentControlExternalIntegrationServiceError>;
  /** Rate-limit first, then capability/project checks, so failures reveal no resource state. */
  readonly authorizeTool: (input: {
    readonly integrationId: AgentControlIntegrationId;
    readonly tool: string;
    readonly requiredCapability?: AgentControlCapability | undefined;
    readonly projectId?: ProjectId | undefined;
  }) => Effect.Effect<AgentControlExternalIntegration, AgentControlExternalIntegrationServiceError>;
  readonly appendAudit: (
    record: Omit<AgentControlExternalAuditRecord, "auditId" | "createdAt">,
  ) => Effect.Effect<void, AgentControlExternalRepositoryError>;
  readonly detailFor: (
    integration: StoredAgentControlExternalIntegration,
  ) => AgentControlExternalIntegrationDetail;
  readonly subscribeChanges: Effect.Effect<
    PubSub.Subscription<AgentControlIntegrationId>,
    never,
    Scope.Scope
  >;
}

export class AgentControlExternalIntegrationService extends Context.Service<
  AgentControlExternalIntegrationService,
  AgentControlExternalIntegrationServiceShape
>()("ryco/agentControl/Services/AgentControlExternalIntegration") {}
